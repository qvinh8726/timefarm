const { contextBridge, ipcRenderer } = require("electron");

/** @type {import('../src/desktop-contract').DesktopBridgeContract} */
const desktopBridge = {
  loadState: () => ipcRenderer.invoke("workly:load-state"),
  getLegacyImportStatus: () =>
    ipcRenderer.invoke("workly:get-legacy-import-status"),
  legacyImportAction: (action) =>
    ipcRenderer.invoke("workly:legacy-import-action", action),
  executeCommand: (command) =>
    ipcRenderer.invoke("workly:execute-command", command),
  claimAuthenticatedAccount: () =>
    ipcRenderer.invoke("workly:claim-authenticated-account"),
  bootstrapAuthenticatedAccount: () =>
    ipcRenderer.invoke("workly:bootstrap-authenticated-account"),
  resetLocalData: () => ipcRenderer.invoke("workly:reset-local-data"),
  rebuildLocalCache: () => ipcRenderer.invoke("workly:rebuild-local-cache"),
  getSyncSummary: () => ipcRenderer.invoke("workly:get-sync-summary"),
  getTimerLeaseStatus: () =>
    ipcRenderer.invoke("workly:get-timer-lease-status"),
  acquireTimerLease: () => ipcRenderer.invoke("workly:acquire-timer-lease"),
  getSyncConflicts: (limit) =>
    ipcRenderer.invoke("workly:get-sync-conflicts", limit),
  resolveSyncConflict: (conflictId) =>
    ipcRenderer.invoke("workly:resolve-sync-conflict", conflictId),
  acceptRemoteSyncConflict: (conflictId) =>
    ipcRenderer.invoke("workly:accept-remote-sync-conflict", conflictId),
  syncNow: () => ipcRenderer.invoke("workly:sync-now"),
  getFxStatus: () => ipcRenderer.invoke("workly:fx-status"),
  refreshFxRates: () => ipcRenderer.invoke("workly:fx-refresh"),
  convertMoney: (money, targetCurrency) =>
    ipcRenderer.invoke("workly:fx-convert", money, targetCurrency),
  getOverlayPreferences: () =>
    ipcRenderer.invoke("workly:overlay:get-preferences"),
  setOverlayPreferences: (input) =>
    ipcRenderer.invoke("workly:overlay:set-preferences", input),
  getAuthStatus: () => ipcRenderer.invoke("workly:get-auth-status"),
  signUp: (input) => ipcRenderer.invoke("workly:auth-sign-up", input),
  signIn: (input) => ipcRenderer.invoke("workly:auth-sign-in", input),
  signInWithGoogle: () => ipcRenderer.invoke("workly:auth-google"),
  signOut: () => ipcRenderer.invoke("workly:auth-sign-out"),
  onAuthChanged: (listener) => {
    const callback = (_, value) => listener(value);
    ipcRenderer.on("workly:auth-changed", callback);
    return () => ipcRenderer.removeListener("workly:auth-changed", callback);
  },
  onStateChanged: (listener) => {
    const callback = (_, value) => listener(value);
    ipcRenderer.on("workly:state-changed", callback);
    return () => ipcRenderer.removeListener("workly:state-changed", callback);
  },
  onTimerLeaseChanged: (listener) => {
    const callback = (_, value) => listener(value);
    ipcRenderer.on("workly:timer-lease-changed", callback);
    return () =>
      ipcRenderer.removeListener("workly:timer-lease-changed", callback);
  },
  onOverlayStopRequested: (listener) => {
    const callback = (_, value) => listener(value);
    ipcRenderer.on("workly:overlay-stop-request", callback);
    return () =>
      ipcRenderer.removeListener("workly:overlay-stop-request", callback);
  },
};

contextBridge.exposeInMainWorld("worklyDesktop", desktopBridge);
