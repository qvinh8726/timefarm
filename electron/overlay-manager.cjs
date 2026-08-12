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
    :root {
      color-scheme: light dark;
      font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
      --paper: #fafbf8;
      --surface: #ffffff;
      --ink: #17201f;
      --muted: #68716e;
      --faint: #8e9693;
      --rule: #d5d9d5;
      --rule-strong: #b9c0bc;
      --teal: #0f9889;
      --teal-dark: #08786d;
      --teal-wash: #e4f3f0;
      --lime: #d5ff7d;
      --lime-border: #9aba54;
      --danger: #aa4051;
      --danger-wash: #f8ecee;
      --focus: #08786d;
      --shadow: 0 3px 10px rgba(31, 42, 39, 0.14);
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
    body { padding: 4px; }
    button { font: inherit; }
    .card {
      -webkit-app-region: no-drag;
      position: relative;
      display: grid;
      grid-template-rows: 25px minmax(0, 1fr) 25px;
      height: 100%;
      overflow: hidden;
      border: 1px solid var(--rule-strong);
      border-radius: 8px;
      background: var(--paper);
      box-shadow: var(--shadow);
      color: var(--ink);
    }
    .card::before {
      position: absolute;
      z-index: 2;
      top: 0;
      bottom: 0;
      left: 0;
      width: 3px;
      background: var(--rule-strong);
      content: "";
    }
    .card[data-mode="interactive"] { -webkit-app-region: drag; cursor: move; }
    .card[data-state="running"]::before,
    .card[data-state="paused"]::before { background: var(--teal); }
    .card[data-feedback="error"]::before { background: var(--danger); }
    .titlebar,
    .statusbar { min-width: 0; padding: 0 9px 0 11px; }
    .titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      border-bottom: 1px solid var(--rule);
    }
    .project {
      min-width: 0;
      overflow: hidden;
      font-size: 12px;
      font-weight: 650;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mode-label {
      flex: none;
      color: var(--muted);
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 9.5px;
      letter-spacing: .055em;
      line-height: 1;
      text-transform: uppercase;
    }
    .instrument {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      min-width: 0;
      padding: 0 8px 0 11px;
    }
    .time {
      min-width: 0;
      overflow: hidden;
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 21px;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      letter-spacing: -.035em;
      line-height: 1;
      text-overflow: clip;
      white-space: nowrap;
    }
    .actions {
      -webkit-app-region: no-drag;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .actions[hidden],
    button[hidden] { display: none; }
    .action {
      display: inline-grid;
      grid-auto-flow: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 1px solid var(--rule-strong);
      border-radius: 5px;
      background: var(--surface);
      color: var(--ink);
      cursor: pointer;
      font-size: 11.5px;
      font-weight: 650;
      line-height: 1;
      transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
    }
    .action--main { width: auto; min-width: 60px; padding: 0 8px; }
    #resume { min-width: 78px; }
    .action--continue {
      border-color: var(--lime-border);
      background: var(--lime);
      color: #17201f;
    }
    .action--end { color: var(--danger); }
    .action svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
    .action--continue svg { fill: currentColor; stroke: none; }
    .action:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    .action:disabled { cursor: wait; opacity: .52; }
    .statusbar {
      display: grid;
      grid-template-columns: minmax(0, auto) minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      border-top: 1px solid var(--rule);
    }
    .status {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
    }
    .status-dot {
      flex: none;
      width: 7px;
      height: 7px;
      border: 1px solid var(--faint);
      border-radius: 50%;
      background: transparent;
    }
    .card[data-state="running"] .status,
    .card[data-state="paused"] .status { color: var(--teal-dark); }
    .card[data-state="running"] .status-dot { border-color: var(--teal); background: var(--teal); }
    .card[data-state="paused"] .status-dot { border: 2px solid var(--teal); }
    .hint {
      min-width: 0;
      overflow: hidden;
      color: var(--faint);
      font-size: 10.5px;
      line-height: 1;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card[data-feedback="pending"] .hint,
    .card[data-feedback="success"] .hint { color: var(--teal-dark); }
    .card[data-feedback="error"] .hint { color: var(--danger); }
    @media (hover: hover) {
      .action:not(:disabled):hover { border-color: var(--teal); background: var(--teal-wash); color: var(--teal-dark); }
      .action--continue:not(:disabled):hover { border-color: #789d35; background: #c8f36e; color: #17201f; }
      .action--end:not(:disabled):hover { border-color: var(--danger); background: var(--danger-wash); color: var(--danger); }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --paper: #181e1c;
        --surface: #202623;
        --ink: #edf2ee;
        --muted: #9ba6a1;
        --faint: #7e8984;
        --rule: #343c39;
        --rule-strong: #4a5551;
        --teal: #45d6c3;
        --teal-dark: #64e0d0;
        --teal-wash: #193c37;
        --lime-border: #9cc64d;
        --danger: #ff8fa1;
        --danger-wash: #47272d;
        --focus: #64e0d0;
        --shadow: 0 3px 10px rgba(0, 0, 0, 0.34);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .action { transition: none; }
    }
    @media (forced-colors: active) {
      .card::before { background: Highlight; }
      .action:focus-visible { outline-color: Highlight; }
    }
  </style>
</head>
<body>
  <section id="timer-card" class="card" data-mode="view-only" data-state="idle" data-feedback="none" aria-label="TimeFarm mini timer" aria-busy="false">
    <div class="titlebar">
      <div id="project" class="project">No active session</div>
      <div id="mode-label" class="mode-label">View only</div>
    </div>
    <div class="instrument">
      <div id="time" class="time" aria-label="Elapsed time: 00:00:00">00:00:00</div>
      <div id="actions" class="actions" role="group" aria-label="Timer actions" hidden>
        <button id="start" class="action action--main action--continue" type="button" aria-label="Start timer" title="Start timer">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8 13 8l-8.5 5.2Z" /></svg><span>Start</span>
        </button>
        <button id="pause" class="action action--main" type="button" aria-label="Pause timer" title="Pause timer" hidden>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" /></svg><span>Pause</span>
        </button>
        <button id="resume" class="action action--main action--continue" type="button" aria-label="Continue timer" title="Continue timer" hidden>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8 13 8l-8.5 5.2Z" /></svg><span>Continue</span>
        </button>
        <button id="stop" class="action action--end" type="button" aria-label="End timer in TimeFarm" title="End timer in TimeFarm" hidden>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx=".5" /></svg>
        </button>
        <button id="open" class="action" type="button" aria-label="Open TimeFarm" title="Open TimeFarm">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M12 9v3H4V4h3" /></svg>
        </button>
      </div>
    </div>
    <div class="statusbar">
      <div id="status" class="status" role="status" aria-live="polite" aria-atomic="true"><span class="status-dot" aria-hidden="true"></span><span id="status-text">Ready to start</span></div>
      <div id="hint" class="hint" role="status" aria-live="polite" aria-atomic="true">Click-through</div>
    </div>
  </section>
  <script>
    let snapshot = { status: 'idle', activeDurationMs: 0, tickedAt: Date.now(), projectName: null, interactive: false };
    let actionBusy = false;
    let actionFeedback = { message: '', persistent: false, expiresAt: 0, tone: 'none' };
    const elements = {
      card: document.getElementById('timer-card'), project: document.getElementById('project'), time: document.getElementById('time'), status: document.getElementById('status'), statusText: document.getElementById('status-text'), hint: document.getElementById('hint'), modeLabel: document.getElementById('mode-label'), actions: document.getElementById('actions'),
      start: document.getElementById('start'), pause: document.getElementById('pause'), resume: document.getElementById('resume'), stop: document.getElementById('stop'), open: document.getElementById('open')
    };
    const actionElements = ['start', 'pause', 'resume', 'stop', 'open'].map((action) => elements[action]);
    function format(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60;
      return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
    }
    function defaultHint() {
      return snapshot.interactive === true ? 'Drag to move' : 'Click-through';
    }
    function renderFeedback() {
      if (actionFeedback.message && !actionFeedback.persistent && Date.now() >= actionFeedback.expiresAt) {
        actionFeedback = { message: '', persistent: false, expiresAt: 0, tone: 'none' };
      }
      elements.hint.textContent = actionFeedback.message || defaultHint();
      elements.hint.title = actionFeedback.message || '';
      elements.card.dataset.feedback = actionFeedback.message ? actionFeedback.tone : 'none';
    }
    function showFeedback(message, persistent, tone) {
      actionFeedback = {
        message,
        persistent: Boolean(persistent),
        expiresAt: persistent ? 0 : Date.now() + 3000,
        tone: tone || 'success',
      };
      renderFeedback();
    }
    function setActionBusy(next) {
      actionBusy = next;
      elements.card.setAttribute('aria-busy', String(next));
      for (const element of actionElements) element.disabled = next;
    }
    function render() {
      const running = snapshot.status === 'running'; const paused = snapshot.status === 'paused';
      const interactive = snapshot.interactive === true;
      const elapsed = snapshot.activeDurationMs + (running ? Math.max(0, Date.now() - snapshot.tickedAt) : 0);
      elements.time.textContent = format(elapsed);
      elements.time.setAttribute('aria-label', 'Elapsed time: ' + format(elapsed));
      elements.project.textContent = snapshot.projectName || (running || paused ? 'Unassigned session' : 'No active session');
      elements.statusText.textContent = running ? 'Running locally' : paused ? 'Paused locally' : 'Ready to start';
      elements.card.dataset.mode = interactive ? 'interactive' : 'view-only';
      elements.card.dataset.state = running ? 'running' : paused ? 'paused' : 'idle';
      elements.modeLabel.textContent = interactive ? 'Interactive' : 'View only';
      elements.actions.hidden = !interactive;
      elements.actions.setAttribute('aria-hidden', String(!interactive));
      elements.start.hidden = running || paused;
      elements.pause.hidden = !running;
      elements.resume.hidden = !paused;
      elements.stop.hidden = !running && !paused;
      for (const element of actionElements) element.disabled = actionBusy || !interactive;
      renderFeedback();
    }
    for (const action of ['start', 'pause', 'resume', 'stop', 'open']) {
      elements[action].addEventListener('click', async () => {
        if (actionBusy) return;
        setActionBusy(true);
        showFeedback(action === 'open' ? 'Opening TimeFarm…' : 'Updating timer…', true, 'pending');
        try {
          if (!window.worklyOverlay?.action) {
            showFeedback('Timer controls are unavailable. Open TimeFarm to recover.', true, 'error');
            return;
          }
          const result = await window.worklyOverlay.action(action);
          if (!result || result.ok !== true) {
            showFeedback(result?.message || 'Timer action failed. Open TimeFarm to recover.', true, 'error');
            return;
          }
          showFeedback(result.message || (action === 'open' ? 'TimeFarm opened.' : 'Timer updated.'), false, 'success');
        } catch (error) {
          showFeedback(error instanceof Error ? error.message : 'Timer action failed. Open TimeFarm to recover.', true, 'error');
        } finally {
          setActionBusy(false);
          render();
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

  async handleAction(action, options = {}) {
    if (this.mode !== "interactive")
      return { ok: false, message: "The mini timer is view-only." };
    if (!OVERLAY_ACTIONS.has(action))
      return { ok: false, message: "Unsupported timer action." };
    return this.onAction(action, options);
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
