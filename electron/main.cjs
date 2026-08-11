const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  screen,
  shell,
} = require("electron");
const path = require("node:path");
const { SupabaseAuthService } = require("./auth-service.cjs");
const { FxService } = require("./fx-service.cjs");
const { OverlayManager, normaliseMode } = require("./overlay-manager.cjs");
const {
  createOverlayTimerActionHandler,
} = require("./overlay-timer-actions.cjs");
const { TimerLeaseService } = require("./timer-lease-service.cjs");
const { CommandService } = require("./command-service.cjs");
const {
  cloudSyncEligibility,
  resolveLocalAccountPrincipal,
} = require("./local-account-policy.cjs");
const { LocalStateRepository } = require("./state-repository.cjs");
const { exportRecoveryCopy } = require("./recovery-export.cjs");
const { SyncService } = require("./sync-service.cjs");
const {
  findOAuthCallbackUrl,
  getAllowedExternalOrigins,
  isAllowedAppNavigation,
  normaliseAllowedExternalUrl,
  normaliseOAuthCallbackUrl,
} = require("./navigation-security.cjs");

const isDev = !app.isPackaged;
const isPackagedSmokeTest =
  app.isPackaged && process.argv.includes("--timefarm-smoke-test");
let repository;
let commandService;
let authService;
let syncService;
let timerLeaseService;
let fxService;
let mainWindow;
let syncInterval;
let syncContinuationTimer;
let overlayManager;
let pendingOAuthCallback;
/** @type {Promise<any>} */
let mutationQueue = Promise.resolve();
let packagedSmokeTimeout;

const protocol = "timefarm";
const devServerUrl = "http://127.0.0.1:5173";
const distDirectory = path.join(__dirname, "..", "dist");

function allowedExternalOrigins() {
  return getAllowedExternalOrigins({
    supabaseUrl: authService?.configuration?.url,
  });
}

function openAllowedExternalUrl(url) {
  const externalUrl = normaliseAllowedExternalUrl(
    url,
    allowedExternalOrigins(),
  );
  if (!externalUrl)
    throw new Error("Blocked an attempt to open an untrusted external URL.");
  return shell.openExternal(externalUrl);
}

function packagedRendererSmokeScript() {
  return `(() => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Timed out waiting for ' + label);
    };
    const click = async (selector, label) => {
      const element = await waitFor(() => document.querySelector(selector), label);
      element.click();
    };
    return (async () => {
      await waitFor(
        () => document.querySelector('#root')?.children.length && !document.querySelector('.fatal-error'),
        'a healthy React root',
      );
      await click('button[title="Analytics"]', 'Analytics navigation');
      await waitFor(
        () => [...document.querySelectorAll('h1')].some((node) => node.textContent?.trim() === 'Analytics'),
        'the lazy Analytics page',
      );
      await click('button[title="Settings"]', 'Settings navigation');
      await waitFor(
        () => [...document.querySelectorAll('h1')].some((node) => node.textContent?.trim() === 'Settings'),
        'the lazy Settings page',
      );
      await click('.sidebar-start', 'start-session action');
      await waitFor(
        () => document.querySelector('.modal[role="dialog"]'),
        'the lazy workspace dialog',
      );
      if (document.querySelector('.fatal-error')) throw new Error('Fatal renderer boundary appeared.');
      return true;
    })();
  })()`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: !isPackagedSmokeTest,
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    icon: path.join(__dirname, "..", "assets", "timefarm-avatar.png"),
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // TimeFarm uses its own in-app navigation. Electron's generated
  // File/Edit/View/Window menu is developer chrome and must never appear in
  // the customer-facing Windows build, even after the user presses Alt.
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  if (isPackagedSmokeTest) {
    packagedSmokeTimeout = setTimeout(() => {
      console.error(
        "Packaged smoke test timed out before the renderer loaded.",
      );
      process.exitCode = 1;
      app.quit();
    }, 15_000);
    mainWindow.webContents.once(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame === false) return;
        console.error(
          `Packaged smoke test failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`,
        );
        process.exitCode = 1;
        app.quit();
      },
    );
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        void mainWindow.webContents
          .executeJavaScript(packagedRendererSmokeScript(), true)
          .then((rendered) => {
            if (!rendered)
              throw new Error(
                "The renderer finished loading without a healthy React root.",
              );
            console.log(
              "Packaged smoke test loaded the React renderer and lazy workspace chunks.",
            );
            process.exitCode = 0;
            app.quit();
          })
          .catch((error) => {
            console.error(
              "Packaged smoke test renderer assertion failed:",
              error,
            );
            process.exitCode = 1;
            app.quit();
          });
      }, 750);
    });
  }

  if (isDev) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(distDirectory, "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openAllowedExternalUrl(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppNavigation(url, { isDev, devServerUrl, distDirectory }))
      event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isAllowedAppNavigation(url, { isDev, devServerUrl, distDirectory }))
      event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    // The overlay is also a BrowserWindow. On Windows, closing the main app must
    // still exit instead of leaving an unreachable click-through timer behind.
    if (process.platform !== "darwin") app.quit();
  });
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id)
    throw new Error("Untrusted renderer IPC request.");
}

function assertOverlaySender(event) {
  if (!overlayManager || event.sender.id !== overlayManager.getWebContentsId())
    throw new Error("Untrusted overlay IPC request.");
}

function notifyAuthChanged(payload) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("workly:auth-changed", payload);
}

function notifyStateChanged(payload) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("workly:state-changed", payload);
}

function notifyTimerLeaseChanged(payload) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("workly:timer-lease-changed", payload);
}

// Renderer and overlay actions can arrive while an online lease request is
// pending. Serializing durable mutations keeps a preflight decision valid
// until its command commits and prevents a late timer action from racing an
// explicit reset, sign-out, or second timer action.
/**
 * @template T
 * @param {() => Promise<T> | T} work
 * @returns {Promise<T>}
 */
function runSerializedMutation(work) {
  const run = mutationQueue.then(work, work);
  mutationQueue = run.catch(() => {});
  return run;
}

function publishSavedState(saved, { sync = false } = {}) {
  if (overlayManager) overlayManager.updateFromState(saved);
  notifyStateChanged(saved);
  if (sync && syncService) void syncAndPublish();
  return saved;
}

async function syncAndPublishNow() {
  if (!syncService || !repository)
    return { state: "not_ready", processed: 0, failed: 0 };
  const account = repository.getAccount();
  if (!cloudSyncEligibility(account).eligible)
    return { state: "not_claimed", processed: 0, failed: 0 };
  let principal;
  try {
    principal = await assertLocalAccountPrincipal();
  } catch {
    return { state: "account_mismatch", processed: 0, failed: 0 };
  }
  // Do not convert normal offline time into failed outbox retries. The cached
  // principal remains valid for local work, while a later interval will retry
  // sync once its identity can again be verified online.
  if (principal.offline) return { state: "offline", processed: 0, failed: 0 };
  const beforeSummary = repository.getSyncSummary();
  const beforeCursor =
    typeof repository.getPullCursor === "function"
      ? repository.getPullCursor()
      : undefined;
  const result = await syncService.syncNow(principal.auth.user.id);
  if (result.state === "pull_pending" && !syncContinuationTimer) {
    syncContinuationTimer = setTimeout(() => {
      syncContinuationTimer = undefined;
      void syncAndPublish();
    }, 100);
    syncContinuationTimer.unref();
  }
  const afterSummary = repository.getSyncSummary();
  const afterCursor =
    typeof repository.getPullCursor === "function"
      ? repository.getPullCursor()
      : undefined;
  // A push changes entity sync statuses, while a pull may change records even
  // when the queue summary stays flat. Notify the renderer/overlay for both.
  if (
    result.processed > 0 ||
    result.failed > 0 ||
    beforeSummary.queued !== afterSummary.queued ||
    beforeSummary.failed !== afterSummary.failed ||
    beforeSummary.conflicts !== afterSummary.conflicts ||
    beforeCursor !== afterCursor
  ) {
    publishSavedState(repository.loadState());
  }
  return result;
}

function syncAndPublish() {
  return runSerializedMutation(syncAndPublishNow);
}

async function acquireTimerLease(principal) {
  let resolvedPrincipal;
  try {
    resolvedPrincipal = principal ?? (await assertLocalAccountPrincipal());
  } catch (error) {
    const outcome = {
      state: "failed",
      reason: "account_owner_mismatch",
      error:
        error instanceof Error
          ? error.message
          : "The local account owner could not be verified.",
    };
    notifyTimerLeaseChanged(outcome);
    return outcome;
  }
  if (!resolvedPrincipal.linked) {
    const outcome = { state: "not_authenticated", reason: "not_claimed" };
    notifyTimerLeaseChanged(outcome);
    return outcome;
  }
  if (resolvedPrincipal.offline) {
    const outcome = {
      state: "failed",
      reason: "auth_offline",
      error: "Cloud timer ownership is unavailable while offline.",
    };
    notifyTimerLeaseChanged(outcome);
    return outcome;
  }
  if (!timerLeaseService) return { state: "not_configured" };
  try {
    const outcome = await timerLeaseService.acquire(
      resolvedPrincipal.auth?.user?.id,
    );
    notifyTimerLeaseChanged(outcome);
    return outcome;
  } catch (error) {
    const outcome = {
      state: "failed",
      error:
        error instanceof Error ? error.message : "Timer lease request failed.",
    };
    notifyTimerLeaseChanged(outcome);
    return outcome;
  }
}

function startTimerLeaseRenewal() {
  if (
    !timerLeaseService ||
    !timerLeaseService.getStatus().held ||
    timerLeaseService.getStatus().renewing
  )
    return;
  try {
    timerLeaseService.startRenewal((outcome) =>
      notifyTimerLeaseChanged(outcome),
    );
  } catch (error) {
    notifyTimerLeaseChanged({
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Timer lease renewal could not start.",
    });
  }
}

function timerLeaseSnapshot() {
  if (!timerLeaseService)
    return { state: "not_configured", held: false, renewing: false };
  const status = timerLeaseService.getStatus();
  return { ...status, ...(status.lastOutcome ?? {}) };
}

async function guardTimerLease(command, principal) {
  if (
    command?.type !== "session.start" &&
    command?.type !== "session.resume" &&
    command?.type !== "project.create-and-start-session"
  )
    return undefined;
  if (!repository.hasAccount()) return undefined;
  const outcome = await acquireTimerLease(principal);
  if (outcome.state === "held_by_other") {
    throw new Error(
      "Another signed-in device currently holds the active timer lease. Finish or wait for that timer before starting here.",
    );
  }
  // Offline operation remains valid: a missing/failed cloud lease is never
  // treated as acquired, but it must not make the local-first timer unusable.
  return outcome;
}

async function assertLocalAccountPrincipal() {
  return resolveLocalAccountPrincipal({
    account: repository.getAccount(),
    authService,
  });
}

function emptyLocalState() {
  return {
    version: 1,
    account: null,
    projects: [],
    sessions: [],
    payments: [],
    goals: [],
    preferences: {
      theme: "system",
      miniTimerMode: "hidden",
      dashboardHiddenWidgets: [],
      dashboardWidgetOrder: [],
      dashboardWidgetSizes: {},
    },
  };
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function handleOAuthCallback(url) {
  const callbackUrl = normaliseOAuthCallbackUrl(url);
  if (!callbackUrl) return;
  if (!authService) {
    pendingOAuthCallback = callbackUrl;
    return;
  }
  try {
    const status = await runSerializedMutation(() =>
      authService.handleOAuthCallback(callbackUrl),
    );
    if (status) notifyAuthChanged(status);
  } catch {
    notifyAuthChanged({
      configured: authService.isConfigured(),
      authenticated: false,
      error: "Google sign-in could not be completed.",
    });
  }
}

function registerProtocolHandler() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(protocol, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(protocol);
  }
}

if (process.platform === "win32") {
  // Windows sends a protocol launch URL only in the initial argv when there
  // is no already-running instance. Keep it until auth is initialized below.
  pendingOAuthCallback =
    findOAuthCallbackUrl(process.argv) ?? pendingOAuthCallback;
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) app.quit();
  app.on("second-instance", (_, commandLine) => {
    const callbackUrl = findOAuthCallbackUrl(commandLine);
    if (callbackUrl) void handleOAuthCallback(callbackUrl);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  void handleOAuthCallback(url);
});

app
  .whenReady()
  .then(() => {
    Menu.setApplicationMenu(null);
    const userDataPath = app.getPath("userData");
    repository = new LocalStateRepository(path.join(userDataPath, "workly.db"));
    repository.importLegacyJson(path.join(userDataPath, "workly-state.json"));
    commandService = new CommandService({ repository });
    authService = new SupabaseAuthService({ userDataPath, safeStorage });
    timerLeaseService = new TimerLeaseService({
      authService,
      userDataPath,
      renewExecutor: runSerializedMutation,
    });
    syncService = new SyncService({ repository, authService });
    fxService = new FxService({
      cacheFilePath: path.join(userDataPath, "fx-rates.json"),
    });
    overlayManager = new OverlayManager({
      BrowserWindow,
      screen,
      preloadPath: path.join(__dirname, "overlay-preload.cjs"),
      positionFilePath: path.join(userDataPath, "mini-timer-position.json"),
      onAction: createOverlayTimerActionHandler({
        repository,
        commandService,
        acquireTimerLease,
        startLeaseRenewal: startTimerLeaseRenewal,
        onOpen: focusMainWindow,
        onStopRequested: (request) => {
          notifyStateChanged(request.state);
          if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send("workly:overlay-stop-request", request);
        },
        onStateChanged: (saved) => {
          overlayManager.updateFromState(saved);
          notifyStateChanged(saved);
        },
        syncNow: () => syncAndPublish(),
      }),
    });
    overlayManager.updateFromState(repository.loadState());
    registerProtocolHandler();
    if (pendingOAuthCallback) {
      const callback = pendingOAuthCallback;
      pendingOAuthCallback = undefined;
      void handleOAuthCallback(callback);
    }

    ipcMain.handle("workly:load-state", (event) => {
      assertTrustedSender(event);
      return repository.loadState();
    });
    ipcMain.handle("workly:execute-command", (event, command) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        // This performs strict schema and timer-state validation without writing
        // SQLite, so an invalid command cannot reserve a cross-device lease.
        commandService.preflight(command);
        const principal = await assertLocalAccountPrincipal();
        const leaseOutcome = await guardTimerLease(command, principal);
        const response = commandService.execute(command);
        // Initializing a profile only creates local data. Linking it to a cloud
        // identity remains an explicit, main-owned claim action, so a newly
        // opened device cannot silently push a different profile before consent.
        if (
          (command?.type === "session.start" ||
            command?.type === "session.resume" ||
            command?.type === "project.create-and-start-session") &&
          leaseOutcome?.state === "acquired"
        )
          startTimerLeaseRenewal();
        if (
          command?.type === "session.complete" ||
          command?.type === "session.recover-complete" ||
          command?.type === "session.discard"
        )
          timerLeaseService.stopRenewal();
        publishSavedState(response.state, { sync: true });
        return response;
      });
    });
    ipcMain.handle("workly:claim-authenticated-account", (event) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        const auth = await authService.getStatus();
        if (!auth.authenticated || !auth.user)
          throw new Error("Sign in before linking local data to an account.");
        if (auth.offline)
          throw new Error(
            "Connect to the internet before linking local data to a cloud account.",
          );
        const localAccount = repository.getAccount();
        const claim = await syncService.claimCloudWorkspace(
          localAccount,
          auth.user.id,
        );
        if (claim.state !== "ready")
          throw new Error(
            "Cloud account verification is unavailable. Reconnect before linking local data.",
          );
        if (!claim.data.claimed) {
          throw new Error(
            "This cloud account already has a workspace. TimeFarm kept the local data separate to prevent an automatic overwrite.",
          );
        }
        const response = commandService.linkAuthenticatedAccount(auth.user.id);
        publishSavedState(response.state, { sync: true });
        return response;
      });
    });
    ipcMain.handle("workly:bootstrap-authenticated-account", (event) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        if (repository.hasAccount()) return { state: "already_initialized" };
        const auth = await authService.getStatus();
        if (!auth.configured) return { state: "not_configured" };
        if (!auth.authenticated || !auth.user)
          return { state: "not_authenticated" };
        // Do not use a cached/offline identity to decide that no cloud workspace
        // exists. That could let a new device create an outbox which overwrites
        // the existing account after reconnect.
        if (auth.offline) return { state: "offline" };
        try {
          const result = await syncService.bootstrapAuthenticatedAccount(
            auth.user.id,
          );
          if (result.state === "restored") {
            publishSavedState(result.saved);
            return { state: "restored" };
          }
          return { state: result.state };
        } catch (error) {
          return {
            state: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Cloud bootstrap failed.",
          };
        }
      });
    });
    ipcMain.handle("workly:reset-local-data", (event) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          buttons: ["Cancel", "Delete local data"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          title: "Clear TimeFarm local data?",
          message: "Delete all TimeFarm data stored on this Windows account?",
          detail:
            "This removes the local database and any legacy import backup. Cloud data is not deleted. This action cannot be undone.",
        });
        if (confirmation.response !== 1)
          return { cancelled: true, state: repository.loadState() };
        const saved = repository.replaceState(emptyLocalState());
        repository.clearLegacyDataFiles(
          path.join(app.getPath("userData"), "workly-state.json"),
        );
        timerLeaseService.stopRenewal();
        publishSavedState(saved);
        return { cancelled: false, state: saved };
      });
    });
    ipcMain.handle("workly:overlay:get-preferences", (event) => {
      assertTrustedSender(event);
      return overlayManager.getPreferences();
    });
    ipcMain.handle("workly:overlay:set-preferences", (event, input) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        const next = input && typeof input === "object" ? input : {};
        if (Object.hasOwn(next, "mode")) {
          if (repository.hasAccount()) {
            await assertLocalAccountPrincipal();
            const response = commandService.execute({
              type: "preferences.update",
              payload: { miniTimerMode: normaliseMode(next.mode) },
            });
            publishSavedState(response.state, { sync: true });
          } else {
            overlayManager.setPreferences({ mode: normaliseMode(next.mode) });
          }
        }
        if (Object.hasOwn(next, "position"))
          overlayManager.setPreferences({ position: next.position });
        return overlayManager.getPreferences();
      });
    });
    ipcMain.handle("workly:overlay:action", (event, action) => {
      assertOverlaySender(event);
      return runSerializedMutation(async () => {
        if (action === "open" || action === "stop")
          return overlayManager.handleAction(action);
        await assertLocalAccountPrincipal();
        return overlayManager.handleAction(action);
      });
    });
    ipcMain.handle("workly:get-sync-summary", (event) => {
      assertTrustedSender(event);
      return repository.getSyncSummary();
    });
    ipcMain.handle("workly:get-timer-lease-status", (event) => {
      assertTrustedSender(event);
      return timerLeaseSnapshot();
    });
    ipcMain.handle("workly:acquire-timer-lease", (event) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        if (!repository.hasActiveSession()) {
          throw new Error(
            "An active local timer is required before acquiring a cloud timer lease.",
          );
        }
        const principal = await assertLocalAccountPrincipal();
        const outcome = await acquireTimerLease(principal);
        if (outcome.state === "acquired") startTimerLeaseRenewal();
        return outcome;
      });
    });
    ipcMain.handle("workly:get-sync-conflicts", (event, limit) => {
      assertTrustedSender(event);
      return repository.getSyncConflicts({
        limit: Number.isInteger(limit) ? limit : 100,
      });
    });
    ipcMain.handle("workly:resolve-sync-conflict", (event, conflictId) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        await assertLocalAccountPrincipal();
        const resolved = repository.resolveSyncConflict(conflictId);
        if (resolved) publishSavedState(repository.loadState(), { sync: true });
        return { resolved, summary: repository.getSyncSummary() };
      });
    });
    ipcMain.handle(
      "workly:accept-remote-sync-conflict",
      (event, conflictId) => {
        assertTrustedSender(event);
        return runSerializedMutation(async () => {
          await assertLocalAccountPrincipal();
          const result = repository.acceptRemoteSyncConflict(conflictId);
          if (result.accepted) publishSavedState(repository.loadState());
          return { ...result, summary: repository.getSyncSummary() };
        });
      },
    );
    ipcMain.handle("workly:fx-status", (event) => {
      assertTrustedSender(event);
      const account = repository.getAccount();
      return account
        ? fxService.getStatus(account.currency)
        : fxService.getStatus(undefined);
    });
    ipcMain.handle("workly:fx-refresh", async (event) => {
      assertTrustedSender(event);
      const account = repository.getAccount();
      return account
        ? fxService.refresh(account.currency)
        : fxService.getStatus(undefined);
    });
    ipcMain.handle("workly:fx-convert", (event, money, targetCurrency) => {
      assertTrustedSender(event);
      const account = repository.getAccount();
      if (!account)
        return {
          ok: false,
          error: "Account setup is required before converting money.",
        };
      return fxService.convert(money, targetCurrency, account.currency);
    });
    ipcMain.handle("workly:sync-now", async (event) => {
      assertTrustedSender(event);
      return syncAndPublish();
    });
    ipcMain.handle("workly:get-auth-status", async (event) => {
      assertTrustedSender(event);
      return runSerializedMutation(() => authService.getStatus());
    });
    ipcMain.handle("workly:auth-sign-up", (event, input) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        const result = await authService.signUp(input ?? {});
        notifyAuthChanged(result.status);
        return result;
      });
    });
    ipcMain.handle("workly:auth-sign-in", (event, input) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        const status = await authService.signIn(input ?? {});
        notifyAuthChanged(status);
        return status;
      });
    });
    ipcMain.handle("workly:auth-google", (event) => {
      assertTrustedSender(event);
      return runSerializedMutation(() =>
        authService.beginGoogleSignIn(openAllowedExternalUrl),
      );
    });
    ipcMain.handle("workly:auth-sign-out", (event) => {
      assertTrustedSender(event);
      return runSerializedMutation(async () => {
        timerLeaseService.stopRenewal();
        const status = await authService.signOut();
        notifyAuthChanged(status);
        return status;
      });
    });
    if (isPackagedSmokeTest && !repository.hasAccount()) {
      commandService.execute({
        type: "account.initialize",
        payload: {
          displayName: "Package Smoke",
          country: "us",
          language: "en",
          currency: "USD",
        },
      });
    }
    createWindow();
    if (isPackagedSmokeTest) return;
    void syncAndPublish();
    const account = repository.getAccount();
    if (account) void fxService.refresh(account.currency);
    if (repository.hasActiveSession()) {
      void runSerializedMutation(() => acquireTimerLease()).then((outcome) => {
        if (outcome.state === "acquired") startTimerLeaseRenewal();
      });
    }
    syncInterval = setInterval(() => {
      void syncAndPublish();
    }, 30_000);
    syncInterval.unref();
    app.on("activate", () => {
      if (!mainWindow) createWindow();
    });
  })
  .catch(async (error) => {
    const message =
      error instanceof Error ? error.message : "Unknown startup error.";
    const userDataPath = app.getPath("userData");
    try {
      const choice = await dialog.showMessageBox({
        type: "error",
        buttons: ["Export recovery copy…", "Open data folder", "Quit"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: "TimeFarm could not open its local data",
        message: "TimeFarm stopped before changing your workspace.",
        detail: `${message}\n\nKeep workly.db and any workly.db.pre-v*.backup file for recovery.`,
      });
      if (choice.response === 0) {
        const destination = await dialog.showOpenDialog({
          title: "Choose where to save the TimeFarm recovery copy",
          buttonLabel: "Export recovery copy",
          properties: ["openDirectory", "createDirectory"],
        });
        if (!destination.canceled && destination.filePaths[0]) {
          try {
            const exported = exportRecoveryCopy({
              userDataPath,
              parentDirectory: destination.filePaths[0],
            });
            await dialog.showMessageBox({
              type: "info",
              buttons: ["OK"],
              title: "Recovery copy exported",
              message: "TimeFarm copied the recoverable local database files.",
              detail: exported.destination,
            });
          } catch (exportError) {
            dialog.showErrorBox(
              "TimeFarm could not export the recovery copy",
              exportError instanceof Error
                ? exportError.message
                : "Unknown recovery export error.",
            );
          }
        }
      } else if (choice.response === 1) {
        const openError = await shell.openPath(userDataPath);
        if (openError)
          dialog.showErrorBox(
            "TimeFarm could not open the data folder",
            openError,
          );
      }
    } finally {
      app.quit();
    }
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (packagedSmokeTimeout) clearTimeout(packagedSmokeTimeout);
  if (syncInterval) clearInterval(syncInterval);
  if (syncContinuationTimer) clearTimeout(syncContinuationTimer);
  if (overlayManager) overlayManager.dispose();
  if (timerLeaseService) timerLeaseService.stopRenewal();
  if (repository) repository.close();
});
