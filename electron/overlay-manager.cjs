const fs = require("node:fs");
const path = require("node:path");
const { isAllowedOverlayNavigation } = require("./navigation-security.cjs");

const OVERLAY_WIDTH = 286;
const OVERLAY_HEIGHT = 112;
const OVERLAY_MARGIN = 24;
const OVERLAY_MODES = new Set(["interactive", "view_only", "hidden"]);
const OVERLAY_ACTIONS = new Set(["start", "pause", "resume", "stop", "open"]);

function normaliseMode(value) {
  return OVERLAY_MODES.has(value) ? value : "hidden";
}

function normalisePosition(value) {
  if (!value || typeof value !== "object") return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: Math.round(x), y: Math.round(y) };
}

function activeDurationAt(session, now = Date.now()) {
  if (!session || !session.startedAt) return 0;
  const startedAt = Date.parse(session.startedAt);
  if (!Number.isFinite(startedAt)) return 0;
  const endedAt = session.endedAt ? Date.parse(session.endedAt) : now;
  const effectiveEnd = Number.isFinite(endedAt)
    ? Math.max(startedAt, endedAt)
    : now;
  let pausedMs = 0;
  for (const pause of Array.isArray(session.pauses) ? session.pauses : []) {
    const pauseStart = Date.parse(pause?.startedAt);
    if (!Number.isFinite(pauseStart)) continue;
    const pauseEnd = pause?.endedAt ? Date.parse(pause.endedAt) : now;
    if (!Number.isFinite(pauseEnd)) continue;
    pausedMs += Math.max(
      0,
      Math.min(effectiveEnd, pauseEnd) -
        Math.min(effectiveEnd, Math.max(startedAt, pauseStart)),
    );
  }
  return Math.max(0, effectiveEnd - startedAt - pausedMs);
}

function buildTimerSnapshot(state, now = Date.now()) {
  const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  const session = sessions.find(
    (candidate) =>
      candidate?.status === "running" || candidate?.status === "paused",
  );
  if (!session) {
    return {
      status: "idle",
      projectName: null,
      activeDurationMs: 0,
      tickedAt: now,
    };
  }
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  const project = session.projectId
    ? projects.find((candidate) => candidate?.id === session.projectId)
    : undefined;
  return {
    status: session.status === "paused" ? "paused" : "running",
    projectName: project?.name || null,
    activeDurationMs: activeDurationAt(session, now),
    tickedAt: now,
  };
}

function getDisplayWorkArea(screen) {
  const primary = screen?.getPrimaryDisplay?.();
  return primary?.workArea ?? { x: 0, y: 0, width: 1440, height: 900 };
}

function defaultPosition(screen) {
  const area = getDisplayWorkArea(screen);
  return {
    x: area.x + Math.max(0, area.width - OVERLAY_WIDTH - OVERLAY_MARGIN),
    y: area.y + Math.max(0, area.height - OVERLAY_HEIGHT - OVERLAY_MARGIN),
  };
}

function clampPosition(position, screen) {
  const candidate = normalisePosition(position) ?? defaultPosition(screen);
  const display = screen?.getDisplayNearestPoint?.(candidate) ?? {
    workArea: getDisplayWorkArea(screen),
  };
  const area = display.workArea ?? getDisplayWorkArea(screen);
  return {
    x: Math.min(
      Math.max(candidate.x, area.x),
      area.x + Math.max(0, area.width - OVERLAY_WIDTH),
    ),
    y: Math.min(
      Math.max(candidate.y, area.y),
      area.y + Math.max(0, area.height - OVERLAY_HEIGHT),
    ),
  };
}

function overlayHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
  <title>TimeFarm timer</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, Segoe UI, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
    body { padding: 5px; }
    .card { -webkit-app-region: drag; display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; height: 100%; padding: 13px 14px; border: 1px solid rgba(255,255,255,.17); border-radius: 16px; background: rgba(13, 19, 35, .94); box-shadow: 0 14px 36px rgba(0,0,0,.35); color: #f5f7ff; }
    .meta { min-width: 0; }
    .project { overflow: hidden; color: #b8c3ea; font-size: 11px; letter-spacing: .05em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
    .time { margin-top: 3px; font-size: 30px; font-variant-numeric: tabular-nums; font-weight: 700; letter-spacing: -.04em; line-height: 1; }
    .status { margin-top: 6px; color: #91a1d3; font-size: 11px; }
    .actions { -webkit-app-region: no-drag; align-self: center; display: flex; gap: 7px; }
    button { width: 34px; height: 34px; border: 1px solid rgba(255,255,255,.18); border-radius: 10px; background: rgba(255,255,255,.08); color: #fff; cursor: pointer; font: inherit; }
    button:hover { background: rgba(124, 92, 255, .65); }
    button:focus-visible { outline: 2px solid #a793ff; outline-offset: 2px; }
    button[hidden] { display: none; }
    .hint { grid-column: 1 / -1; align-self: end; color: #8c99c7; font-size: 10px; line-height: 1; }
  </style>
</head>
<body>
  <section class="card" aria-label="TimeFarm mini timer">
    <div class="meta"><div id="project" class="project">NO ACTIVE SESSION</div><div id="time" class="time">00:00:00</div><div id="status" class="status">Ready to start</div></div>
    <div class="actions">
      <button id="start" type="button" aria-label="Start timer" title="Start timer">▶</button>
      <button id="pause" type="button" aria-label="Pause timer" title="Pause timer" hidden>Ⅱ</button>
      <button id="resume" type="button" aria-label="Resume timer" title="Resume timer" hidden>▶</button>
      <button id="stop" type="button" aria-label="Finish timer in TimeFarm" title="Finish timer">■</button>
      <button id="open" type="button" aria-label="Open TimeFarm" title="Open TimeFarm">↗</button>
    </div>
    <div id="hint" class="hint">Drag to reposition</div>
  </section>
  <script>
    let snapshot = { status: 'idle', activeDurationMs: 0, tickedAt: Date.now(), projectName: null };
    const elements = {
      project: document.getElementById('project'), time: document.getElementById('time'), status: document.getElementById('status'), hint: document.getElementById('hint'),
      start: document.getElementById('start'), pause: document.getElementById('pause'), resume: document.getElementById('resume'), stop: document.getElementById('stop'), open: document.getElementById('open')
    };
    function format(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60;
      return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
    }
    function render() {
      const running = snapshot.status === 'running'; const paused = snapshot.status === 'paused';
      const elapsed = snapshot.activeDurationMs + (running ? Math.max(0, Date.now() - snapshot.tickedAt) : 0);
      elements.time.textContent = format(elapsed);
      elements.project.textContent = snapshot.projectName || (running || paused ? 'UNASSIGNED SESSION' : 'NO ACTIVE SESSION');
      elements.status.textContent = running ? 'Running' : paused ? 'Paused' : 'Ready to start';
      elements.start.hidden = running || paused;
      elements.pause.hidden = !running;
      elements.resume.hidden = !paused;
      elements.stop.hidden = !running && !paused;
      elements.hint.textContent = snapshot.interactive === false ? 'View-only · click-through' : 'Drag to reposition';
    }
    for (const action of ['start', 'pause', 'resume', 'stop', 'open']) {
      elements[action].addEventListener('click', async () => {
        try {
          const result = await window.worklyOverlay?.action(action);
          if (result?.message) elements.status.textContent = result.message;
        } catch (error) {
          elements.status.textContent = error instanceof Error ? error.message : 'Timer action failed. Open TimeFarm to recover.';
        }
      });
    }
    window.worklyOverlay?.onSnapshot((next) => { snapshot = next || snapshot; render(); });
    render(); setInterval(render, 1000);
  </script>
</body>
</html>`;
}

class OverlayManager {
  /** @param {any} options */
  constructor({
    BrowserWindow,
    screen,
    preloadPath,
    positionFilePath,
    onAction = async () => ({
      ok: false,
      message: "Timer action is unavailable.",
    }),
  }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.preloadPath = preloadPath;
    this.positionFilePath = positionFilePath;
    this.onAction = onAction;
    this.window = null;
    this.mode = "hidden";
    this.snapshot = buildTimerSnapshot(null);
    this.position = this.readPosition();
  }

  readPosition() {
    if (!this.positionFilePath) return undefined;
    try {
      return normalisePosition(
        JSON.parse(fs.readFileSync(this.positionFilePath, "utf8")),
      );
    } catch {
      return undefined;
    }
  }

  persistPosition(position) {
    if (!this.positionFilePath) return;
    try {
      fs.mkdirSync(path.dirname(this.positionFilePath), { recursive: true });
      fs.writeFileSync(this.positionFilePath, JSON.stringify(position), {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      // A timer must remain usable even when the local preference file cannot be written.
    }
  }

  getPreferences() {
    const bounds =
      this.window && !this.window.isDestroyed?.()
        ? this.window.getBounds?.()
        : undefined;
    const position =
      normalisePosition(bounds) ??
      this.position ??
      defaultPosition(this.screen);
    return { mode: this.mode, position };
  }

  setPreferences(input = {}) {
    if (Object.hasOwn(input, "position")) this.setPosition(input.position);
    if (Object.hasOwn(input, "mode")) this.setMode(input.mode);
    return this.getPreferences();
  }

  setPosition(position) {
    const next = normalisePosition(position);
    if (!next) return this.getPreferences();
    this.position = clampPosition(next, this.screen);
    this.persistPosition(this.position);
    if (this.window && !this.window.isDestroyed?.())
      this.window.setPosition?.(this.position.x, this.position.y);
    return this.getPreferences();
  }

  updateFromState(state) {
    this.snapshot = buildTimerSnapshot(state);
    this.setMode(state?.preferences?.miniTimerMode);
    this.sendSnapshot();
  }

  setMode(mode) {
    this.mode = normaliseMode(mode);
    if (this.mode === "hidden") {
      if (this.window && !this.window.isDestroyed?.()) this.window.hide?.();
      return this.getPreferences();
    }
    const win = this.ensureWindow();
    if (!win) return this.getPreferences();
    this.applyModeToWindow(win);
    win.showInactive?.();
    this.sendSnapshot();
    return this.getPreferences();
  }

  ensureWindow() {
    if (this.window && !this.window.isDestroyed?.()) return this.window;
    if (!this.BrowserWindow) return null;
    const position = clampPosition(this.position, this.screen);
    this.position = position;
    const win = new this.BrowserWindow({
      x: position.x,
      y: position.y,
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      minWidth: OVERLAY_WIDTH,
      minHeight: OVERLAY_HEIGHT,
      maxWidth: OVERLAY_WIDTH,
      maxHeight: OVERLAY_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      hasShadow: true,
      title: "TimeFarm mini timer",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        preload: this.preloadPath,
      },
    });
    this.window = win;
    win.setAlwaysOnTop?.(true, "floating");
    win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
    win.webContents?.setWindowOpenHandler?.(() => ({ action: "deny" }));
    const expectedOverlayUrl = `data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml())}`;
    win.webContents?.on?.("will-navigate", (event, url) => {
      if (!isAllowedOverlayNavigation(url, expectedOverlayUrl))
        event.preventDefault();
    });
    win.webContents?.on?.("will-redirect", (event, url) => {
      if (!isAllowedOverlayNavigation(url, expectedOverlayUrl))
        event.preventDefault();
    });
    win.webContents?.on?.("did-finish-load", () => this.sendSnapshot());
    win.on?.("moved", () => {
      if (win.isDestroyed?.()) return;
      this.position = normalisePosition(win.getBounds?.()) ?? this.position;
      if (this.position) this.persistPosition(this.position);
    });
    win.on?.("closed", () => {
      if (this.window === win) this.window = null;
    });
    win.loadURL?.(expectedOverlayUrl);
    return win;
  }

  applyModeToWindow(win) {
    const viewOnly = this.mode === "view_only";
    if (viewOnly) win.setIgnoreMouseEvents?.(true, { forward: true });
    else win.setIgnoreMouseEvents?.(false);
    win.setFocusable?.(!viewOnly);
    win.setAlwaysOnTop?.(true, "floating");
  }

  sendSnapshot() {
    const win = this.window;
    if (!win || win.isDestroyed?.()) return;
    win.webContents?.send?.("workly:overlay-snapshot", {
      ...this.snapshot,
      interactive: this.mode === "interactive",
    });
  }

  async handleAction(action) {
    if (this.mode !== "interactive")
      return { ok: false, message: "The mini timer is view-only." };
    if (!OVERLAY_ACTIONS.has(action))
      return { ok: false, message: "Unsupported timer action." };
    return this.onAction(action);
  }

  getWebContentsId() {
    const win = this.window;
    return win && !win.isDestroyed?.() ? win.webContents?.id : undefined;
  }

  dispose() {
    const win = this.window;
    this.window = null;
    if (win && !win.isDestroyed?.()) win.destroy?.();
  }
}

module.exports = {
  OVERLAY_HEIGHT,
  OVERLAY_WIDTH,
  OverlayManager,
  activeDurationAt,
  buildTimerSnapshot,
  clampPosition,
  normaliseMode,
  normalisePosition,
  overlayHtml,
};
