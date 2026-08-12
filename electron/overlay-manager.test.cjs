const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  OverlayManager,
  activeDurationAt,
  buildTimerSnapshot,
  clampPosition,
  overlayHtml,
} = require("./overlay-manager.cjs");

class FakeWebContents extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.sent = [];
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }
}

class FakeWindow extends EventEmitter {
  static instances = [];
  static nextId = 1;

  constructor(options) {
    super();
    this.options = options;
    this.bounds = {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    };
    this.webContents = new FakeWebContents(FakeWindow.nextId++);
    this.destroyed = false;
    this.ignoreMouseCalls = [];
    this.focusableCalls = [];
    FakeWindow.instances.push(this);
  }

  loadURL(url) {
    this.url = url;
    this.webContents.emit("did-finish-load");
  }

  setAlwaysOnTop(...value) {
    this.alwaysOnTop = value;
  }
  setVisibleOnAllWorkspaces(...value) {
    this.visibleOnAllWorkspaces = value;
  }
  setIgnoreMouseEvents(...value) {
    this.ignoreMouseCalls.push(value);
  }
  setFocusable(value) {
    this.focusableCalls.push(value);
  }
  showInactive() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  getBounds() {
    return { ...this.bounds };
  }
  setPosition(x, y) {
    this.bounds.x = x;
    this.bounds.y = y;
    this.emit("moved");
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.emit("closed");
  }
}

function fakeScreen(width = 1440, height = 900) {
  const display = { workArea: { x: 0, y: 0, width, height } };
  return {
    getPrimaryDisplay: () => display,
    getDisplayNearestPoint: () => display,
  };
}

function activeState(mode = "interactive") {
  return {
    preferences: { miniTimerMode: mode },
    projects: [{ id: "project-1", name: "Client project" }],
    sessions: [
      {
        id: "session-1",
        projectId: "project-1",
        status: "running",
        startedAt: "2026-08-10T00:00:00.000Z",
        pauses: [],
      },
    ],
  };
}

test("builds an active timer snapshot with pauses excluded", () => {
  const now = Date.parse("2026-08-10T00:10:00.000Z");
  const session = {
    startedAt: "2026-08-10T00:00:00.000Z",
    pauses: [
      {
        startedAt: "2026-08-10T00:03:00.000Z",
        endedAt: "2026-08-10T00:05:00.000Z",
      },
    ],
  };
  assert.equal(activeDurationAt(session, now), 8 * 60 * 1000);
  const snapshot = buildTimerSnapshot(
    {
      sessions: [{ ...session, id: "s1", status: "running", projectId: "p1" }],
      projects: [{ id: "p1", name: "Writing" }],
    },
    now,
  );
  assert.deepEqual(snapshot, {
    status: "running",
    projectName: "Writing",
    activeDurationMs: 8 * 60 * 1000,
    tickedAt: now,
  });
});

test("view-only overlay is transparent, click-through, and rejects actions", async () => {
  FakeWindow.instances = [];
  const manager = new OverlayManager({
    BrowserWindow: FakeWindow,
    screen: fakeScreen(),
    preloadPath: "/overlay-preload.cjs",
  });
  manager.updateFromState(activeState("view_only"));
  const overlay = FakeWindow.instances[0];
  assert.equal(overlay.options.frame, false);
  assert.equal(overlay.options.transparent, true);
  assert.equal(overlay.options.alwaysOnTop, true);
  assert.equal(overlay.options.skipTaskbar, true);
  assert.equal(overlay.options.webPreferences.sandbox, true);
  assert.deepEqual(overlay.ignoreMouseCalls.at(-1), [true, { forward: true }]);
  assert.equal(overlay.focusableCalls.at(-1), false);
  assert.equal((await manager.handleAction("pause")).ok, false);
  assert.equal(
    overlay.webContents.sent.at(-1).channel,
    "workly:overlay-snapshot",
  );
});

test("interactive overlay sends timer actions and persists a clamped local position", async () => {
  FakeWindow.instances = [];
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "workly-overlay-test-"),
  );
  const positionFilePath = path.join(tempDirectory, "mini-timer-position.json");
  const actions = [];
  try {
    const manager = new OverlayManager({
      BrowserWindow: FakeWindow,
      screen: fakeScreen(500, 300),
      preloadPath: "/overlay-preload.cjs",
      positionFilePath,
      onAction: async (action) => {
        actions.push(action);
        return { ok: true };
      },
    });
    manager.updateFromState(activeState());
    const overlay = FakeWindow.instances[0];
    assert.deepEqual(overlay.ignoreMouseCalls.at(-1), [false]);
    assert.equal(overlay.focusableCalls.at(-1), true);
    assert.equal((await manager.handleAction("pause")).ok, true);
    assert.deepEqual(actions, ["pause"]);
    manager.setPosition({ x: 9999, y: -200 });
    assert.deepEqual(manager.getPreferences().position, { x: 214, y: 0 });
    assert.deepEqual(JSON.parse(fs.readFileSync(positionFilePath, "utf8")), {
      x: 214,
      y: 0,
    });
    manager.setMode("hidden");
    assert.equal(overlay.visible, false);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("overlay blocks all navigation and redirects away from its generated document", () => {
  FakeWindow.instances = [];
  const manager = new OverlayManager({
    BrowserWindow: FakeWindow,
    screen: fakeScreen(),
    preloadPath: "/overlay-preload.cjs",
  });
  manager.updateFromState(activeState());
  const overlay = FakeWindow.instances[0];

  for (const eventName of ["will-navigate", "will-redirect"]) {
    const blocked = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    overlay.webContents.emit(eventName, blocked, "https://evil.example/");
    assert.equal(blocked.prevented, true);

    const allowed = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    overlay.webContents.emit(eventName, allowed, overlay.url);
    assert.equal(allowed.prevented, false);
  }
});

test("clamps a saved position onto the current display work area", () => {
  assert.deepEqual(clampPosition({ x: -4, y: 800 }, fakeScreen(500, 300)), {
    x: 0,
    y: 188,
  });
});

test("embedded controls serialize actions and keep accessible action feedback", () => {
  const html = overlayHtml();
  assert.match(html, /id="timer-card"[^>]+aria-busy="false"/);
  assert.match(html, /id="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="hint"[^>]+aria-live="polite"/);
  assert.match(html, /let actionBusy = false/);
  assert.match(html, /if \(actionBusy\) return/);
  assert.match(html, /result\.ok !== true/);
  assert.match(html, /persistent: Boolean\(persistent\)/);
  assert.match(html, /data-feedback="none"/);
  assert.match(html, /showFeedback\([^\n]+true, 'pending'\)/);
  assert.match(html, /showFeedback\([^\n]+true, 'error'\)/);
  assert.match(
    html,
    /elements\.hint\.textContent = actionFeedback\.message \|\| defaultHint\(\)/,
  );
});

test("quiet instrument styling keeps view-only passive and reserves lime for start or continue", () => {
  const html = overlayHtml();
  assert.match(html, /color-scheme: light dark/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /--teal: #0f9889/);
  assert.match(html, /--lime: #d5ff7d/);
  assert.match(
    html,
    /id="timer-card"[^>]+data-mode="view-only"[^>]+data-state="idle"/,
  );
  assert.match(
    html,
    /id="actions"[^>]+role="group"[^>]+aria-label="Timer actions" hidden/,
  );
  assert.match(html, /elements\.actions\.hidden = !interactive/);
  assert.match(html, /element\.disabled = actionBusy \|\| !interactive/);
  assert.match(html, /id="start" class="action action--main action--continue"/);
  assert.match(
    html,
    /id="resume" class="action action--main action--continue"[^>]+aria-label="Continue timer"/,
  );
  assert.doesNotMatch(
    html,
    /id="(?:pause|stop|open)" class="[^"]*action--continue/,
  );
  assert.match(html, /<svg viewBox="0 0 16 16" aria-hidden="true">/);
  assert.doesNotMatch(html, /<output id="time"/);
});
