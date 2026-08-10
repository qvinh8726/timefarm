const { app, BrowserWindow, ipcMain, safeStorage, screen, shell } = require('electron')
const path = require('node:path')
const { SupabaseAuthService } = require('./auth-service.cjs')
const { FxService } = require('./fx-service.cjs')
const { OverlayManager, normaliseMode } = require('./overlay-manager.cjs')
const { createOverlayTimerActionHandler } = require('./overlay-timer-actions.cjs')
const { TimerLeaseService } = require('./timer-lease-service.cjs')
const { CommandService } = require('./command-service.cjs')
const { cloudSyncEligibility, resolveLocalAccountPrincipal } = require('./local-account-policy.cjs')
const { LocalStateRepository } = require('./state-repository.cjs')
const { SyncService } = require('./sync-service.cjs')
const {
  findOAuthCallbackUrl,
  getAllowedExternalOrigins,
  isAllowedAppNavigation,
  normaliseAllowedExternalUrl,
  normaliseOAuthCallbackUrl,
} = require('./navigation-security.cjs')

const isDev = !app.isPackaged
let repository
let commandService
let authService
let syncService
let timerLeaseService
let fxService
let mainWindow
let syncInterval
let overlayManager
let pendingOAuthCallback
let mutationQueue = Promise.resolve()

const protocol = 'timefarm'
const devServerUrl = 'http://127.0.0.1:5173'
const distDirectory = path.join(__dirname, '..', 'dist')

function appUrl() {
  return isDev ? devServerUrl : `file://${path.join(distDirectory, 'index.html')}`
}

function allowedExternalOrigins() {
  return getAllowedExternalOrigins({ supabaseUrl: authService?.configuration?.url })
}

function openAllowedExternalUrl(url) {
  const externalUrl = normaliseAllowedExternalUrl(url, allowedExternalOrigins())
  if (!externalUrl) throw new Error('Blocked an attempt to open an untrusted external URL.')
  return shell.openExternal(externalUrl)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0b1020',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  if (isDev) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(distDirectory, 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openAllowedExternalUrl(url).catch(() => {})
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppNavigation(url, { isDev, devServerUrl, distDirectory })) event.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedAppNavigation(url, { isDev, devServerUrl, distDirectory })) event.preventDefault()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    // The overlay is also a BrowserWindow. On Windows, closing the main app must
    // still exit instead of leaving an unreachable click-through timer behind.
    if (process.platform !== 'darwin') app.quit()
  })
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) throw new Error('Untrusted renderer IPC request.')
}

function assertOverlaySender(event) {
  if (!overlayManager || event.sender.id !== overlayManager.getWebContentsId()) throw new Error('Untrusted overlay IPC request.')
}

function notifyAuthChanged(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workly:auth-changed', payload)
}

function notifyStateChanged(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workly:state-changed', payload)
}

function notifyTimerLeaseChanged(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workly:timer-lease-changed', payload)
}

// Renderer and overlay actions can arrive while an online lease request is
// pending. Serializing durable mutations keeps a preflight decision valid
// until its command commits and prevents a late timer action from racing an
// explicit reset, sign-out, or second timer action.
function runSerializedMutation(work) {
  const run = mutationQueue.then(work, work)
  mutationQueue = run.catch(() => {})
  return run
}

function publishSavedState(saved, { sync = false } = {}) {
  if (overlayManager) overlayManager.updateFromState(saved)
  notifyStateChanged(saved)
  if (sync && syncService) void syncAndPublish()
  return saved
}

async function syncAndPublish() {
  if (!syncService || !repository) return { state: 'not_ready', processed: 0, failed: 0 }
  const account = repository.loadState().account
  if (!cloudSyncEligibility(account).eligible) return { state: 'not_claimed', processed: 0, failed: 0 }
  let principal
  try {
    principal = await assertLocalAccountPrincipal()
  } catch {
    return { state: 'account_mismatch', processed: 0, failed: 0 }
  }
  // Do not convert normal offline time into failed outbox retries. The cached
  // principal remains valid for local work, while a later interval will retry
  // sync once its identity can again be verified online.
  if (principal.offline) return { state: 'offline', processed: 0, failed: 0 }
  const beforeSummary = repository.getSyncSummary()
  const beforeCursor = typeof repository.getPullCursor === 'function' ? repository.getPullCursor() : undefined
  const result = await syncService.syncNow()
  const afterSummary = repository.getSyncSummary()
  const afterCursor = typeof repository.getPullCursor === 'function' ? repository.getPullCursor() : undefined
  // A push changes entity sync statuses, while a pull may change records even
  // when the queue summary stays flat. Notify the renderer/overlay for both.
  if (result.processed > 0 || result.failed > 0
    || beforeSummary.queued !== afterSummary.queued
    || beforeSummary.failed !== afterSummary.failed
    || beforeSummary.conflicts !== afterSummary.conflicts
    || beforeCursor !== afterCursor) {
    publishSavedState(repository.loadState())
  }
  return result
}

async function acquireTimerLease(principal) {
  let resolvedPrincipal
  try {
    resolvedPrincipal = principal ?? await assertLocalAccountPrincipal()
  } catch (error) {
    const outcome = { state: 'failed', reason: 'account_owner_mismatch', error: error instanceof Error ? error.message : 'The local account owner could not be verified.' }
    notifyTimerLeaseChanged(outcome)
    return outcome
  }
  if (!resolvedPrincipal.linked) {
    const outcome = { state: 'not_authenticated', reason: 'not_claimed' }
    notifyTimerLeaseChanged(outcome)
    return outcome
  }
  if (resolvedPrincipal.offline) {
    const outcome = { state: 'failed', reason: 'auth_offline', error: 'Cloud timer ownership is unavailable while offline.' }
    notifyTimerLeaseChanged(outcome)
    return outcome
  }
  if (!timerLeaseService) return { state: 'not_configured' }
  try {
    const outcome = await timerLeaseService.acquire()
    notifyTimerLeaseChanged(outcome)
    return outcome
  } catch (error) {
    const outcome = { state: 'failed', error: error instanceof Error ? error.message : 'Timer lease request failed.' }
    notifyTimerLeaseChanged(outcome)
    return outcome
  }
}

function startTimerLeaseRenewal() {
  if (!timerLeaseService || !timerLeaseService.getStatus().held || timerLeaseService.getStatus().renewing) return
  try {
    timerLeaseService.startRenewal((outcome) => notifyTimerLeaseChanged(outcome))
  } catch (error) {
    notifyTimerLeaseChanged({ state: 'failed', error: error instanceof Error ? error.message : 'Timer lease renewal could not start.' })
  }
}

function timerLeaseSnapshot() {
  if (!timerLeaseService) return { state: 'not_configured', held: false, renewing: false }
  const status = timerLeaseService.getStatus()
  return { ...status, ...(status.lastOutcome ?? {}) }
}

async function guardTimerLease(command, principal) {
  if (command?.type !== 'session.start' && command?.type !== 'session.resume') return undefined
  if (!repository.loadState().account) return undefined
  const outcome = await acquireTimerLease(principal)
  if (outcome.state === 'held_by_other') {
    throw new Error('Another signed-in device currently holds the active timer lease. Finish or wait for that timer before starting here.')
  }
  // Offline operation remains valid: a missing/failed cloud lease is never
  // treated as acquired, but it must not make the local-first timer unusable.
  return outcome
}

async function assertLocalAccountPrincipal() {
  return resolveLocalAccountPrincipal({ account: repository.loadState().account, authService })
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
      theme: 'system',
      miniTimerMode: 'hidden',
      dashboardHiddenWidgets: [],
      dashboardWidgetOrder: [],
      dashboardWidgetSizes: {},
    },
  }
}

function getActiveSessionFromState(state) {
  return state.sessions.find((session) => session.status === 'running' || session.status === 'paused')
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function handleOAuthCallback(url) {
  const callbackUrl = normaliseOAuthCallbackUrl(url)
  if (!callbackUrl) return
  if (!authService) {
    pendingOAuthCallback = callbackUrl
    return
  }
  try {
    const status = await authService.handleOAuthCallback(callbackUrl)
    if (status) notifyAuthChanged(status)
  } catch {
    notifyAuthChanged({ configured: authService.isConfigured(), authenticated: false, error: 'Google sign-in could not be completed.' })
  }
}

function registerProtocolHandler() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(protocol)
  }
}

if (process.platform === 'win32') {
  // Windows sends a protocol launch URL only in the initial argv when there
  // is no already-running instance. Keep it until auth is initialized below.
  pendingOAuthCallback = findOAuthCallbackUrl(process.argv) ?? pendingOAuthCallback
  const hasLock = app.requestSingleInstanceLock()
  if (!hasLock) app.quit()
  app.on('second-instance', (_, commandLine) => {
    const callbackUrl = findOAuthCallbackUrl(commandLine)
    if (callbackUrl) void handleOAuthCallback(callbackUrl)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  void handleOAuthCallback(url)
})

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData')
  repository = new LocalStateRepository(path.join(userDataPath, 'workly.db'))
  repository.importLegacyJson(path.join(userDataPath, 'workly-state.json'))
  commandService = new CommandService({ repository })
  authService = new SupabaseAuthService({ userDataPath, safeStorage })
  timerLeaseService = new TimerLeaseService({ authService, userDataPath })
  syncService = new SyncService({ repository, authService })
  fxService = new FxService({ cacheFilePath: path.join(userDataPath, 'fx-rates.json') })
  overlayManager = new OverlayManager({
    BrowserWindow,
    screen,
    preloadPath: path.join(__dirname, 'overlay-preload.cjs'),
    positionFilePath: path.join(userDataPath, 'mini-timer-position.json'),
    onAction: createOverlayTimerActionHandler({
      repository,
      commandService,
      acquireTimerLease,
      startLeaseRenewal: startTimerLeaseRenewal,
      onOpen: focusMainWindow,
      onStopRequested: (request) => {
        notifyStateChanged(request.state)
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workly:overlay-stop-request', request)
      },
      onStateChanged: (saved) => {
        overlayManager.updateFromState(saved)
        notifyStateChanged(saved)
      },
      syncNow: () => syncAndPublish(),
    }),
  })
  overlayManager.updateFromState(repository.loadState())
  registerProtocolHandler()
  if (pendingOAuthCallback) {
    const callback = pendingOAuthCallback
    pendingOAuthCallback = undefined
    void handleOAuthCallback(callback)
  }

  ipcMain.handle('workly:load-state', (event) => { assertTrustedSender(event); return repository.loadState() })
  ipcMain.handle('workly:execute-command', (event, command) => {
    assertTrustedSender(event)
    return runSerializedMutation(async () => {
      // This performs strict schema and timer-state validation without writing
      // SQLite, so an invalid command cannot reserve a cross-device lease.
      commandService.preflight(command)
      const principal = await assertLocalAccountPrincipal()
      const leaseOutcome = await guardTimerLease(command, principal)
      const response = commandService.execute(command)
      // Initializing a profile only creates local data. Linking it to a cloud
      // identity remains an explicit, main-owned claim action, so a newly
      // opened device cannot silently push a different profile before consent.
      if ((command?.type === 'session.start' || command?.type === 'session.resume') && leaseOutcome?.state === 'acquired') startTimerLeaseRenewal()
      if (command?.type === 'session.complete' || command?.type === 'session.recover-complete' || command?.type === 'session.discard') timerLeaseService.stopRenewal()
      publishSavedState(response.state, { sync: true })
      return response
    })
  })
  ipcMain.handle('workly:claim-authenticated-account', (event) => {
    assertTrustedSender(event)
    return runSerializedMutation(async () => {
      const auth = await authService.getStatus()
      if (!auth.authenticated || !auth.user) throw new Error('Sign in before linking local data to an account.')
      if (auth.offline) throw new Error('Connect to the internet before linking local data to a cloud account.')
      const remote = await syncService.getCloudBootstrapSnapshot()
      if (remote.state !== 'ready') throw new Error('Cloud account verification is unavailable. Reconnect before linking local data.')
      if (remote.data.found) {
        throw new Error('This cloud account already has a workspace. TimeFarm kept the local data separate to prevent an automatic overwrite.')
      }
      const response = commandService.linkAuthenticatedAccount(auth.user.id)
      publishSavedState(response.state, { sync: true })
      return response
    })
  })
  ipcMain.handle('workly:bootstrap-authenticated-account', (event) => {
    assertTrustedSender(event)
    return runSerializedMutation(async () => {
      if (repository.loadState().account) return { state: 'already_initialized' }
      const auth = await authService.getStatus()
      if (!auth.configured) return { state: 'not_configured' }
      if (!auth.authenticated || !auth.user) return { state: 'not_authenticated' }
      // Do not use a cached/offline identity to decide that no cloud workspace
      // exists. That could let a new device create an outbox which overwrites
      // the existing account after reconnect.
      if (auth.offline) return { state: 'offline' }
      try {
        const result = await syncService.bootstrapAuthenticatedAccount(auth.user.id)
        if (result.state === 'restored') {
          publishSavedState(result.saved)
          return { state: 'restored' }
        }
        return { state: result.state }
      } catch (error) {
        return { state: 'failed', error: error instanceof Error ? error.message : 'Cloud bootstrap failed.' }
      }
    })
  })
  ipcMain.handle('workly:reset-local-data', (event) => {
    assertTrustedSender(event)
    return runSerializedMutation(async () => {
      await assertLocalAccountPrincipal()
      // This is an explicit, narrow destructive action from the Settings UI;
      // it is intentionally not a generic renderer snapshot write.
      const saved = repository.replaceState(emptyLocalState())
      timerLeaseService.stopRenewal()
      publishSavedState(saved)
      return saved
    })
  })
  ipcMain.handle('workly:overlay:get-preferences', (event) => {
    assertTrustedSender(event)
    return overlayManager.getPreferences()
  })
  ipcMain.handle('workly:overlay:set-preferences', (event, input) => {
    assertTrustedSender(event)
    return runSerializedMutation(async () => {
      const next = input && typeof input === 'object' ? input : {}
      if (Object.hasOwn(next, 'mode')) {
        const state = repository.loadState()
        if (state.account) {
          await assertLocalAccountPrincipal()
          const response = commandService.execute({
            type: 'preferences.update',
            payload: { miniTimerMode: normaliseMode(next.mode) },
          })
          publishSavedState(response.state, { sync: true })
        } else {
          overlayManager.setPreferences({ mode: normaliseMode(next.mode) })
        }
      }
      if (Object.hasOwn(next, 'position')) overlayManager.setPreferences({ position: next.position })
      return overlayManager.getPreferences()
    })
  })
  ipcMain.handle('workly:overlay:action', (event, action) => {
    assertOverlaySender(event)
    return runSerializedMutation(async () => {
      await assertLocalAccountPrincipal()
      return overlayManager.handleAction(action)
    })
  })
  ipcMain.handle('workly:get-sync-summary', (event) => { assertTrustedSender(event); return repository.getSyncSummary() })
  ipcMain.handle('workly:get-timer-lease-status', (event) => { assertTrustedSender(event); return timerLeaseSnapshot() })
  ipcMain.handle('workly:acquire-timer-lease', (event) => {
    assertTrustedSender(event)
    return runSerializedMutation(async () => {
      if (!getActiveSessionFromState(repository.loadState())) {
        throw new Error('An active local timer is required before acquiring a cloud timer lease.')
      }
      const principal = await assertLocalAccountPrincipal()
      const outcome = await acquireTimerLease(principal)
      if (outcome.state === 'acquired') startTimerLeaseRenewal()
      return outcome
    })
  })
  ipcMain.handle('workly:get-sync-conflicts', (event, limit) => {
    assertTrustedSender(event)
    return repository.getSyncConflicts({ limit: Number.isInteger(limit) ? limit : 100 })
  })
  ipcMain.handle('workly:resolve-sync-conflict', (event, conflictId) => {
    assertTrustedSender(event)
    return runSerializedMutation(async () => {
      await assertLocalAccountPrincipal()
      const resolved = repository.resolveSyncConflict(conflictId)
      if (resolved) publishSavedState(repository.loadState(), { sync: true })
      return { resolved, summary: repository.getSyncSummary() }
    })
  })
  ipcMain.handle('workly:accept-remote-sync-conflict', (event, conflictId) => {
    assertTrustedSender(event)
    return runSerializedMutation(async () => {
      await assertLocalAccountPrincipal()
      const result = repository.acceptRemoteSyncConflict(conflictId)
      if (result.accepted) publishSavedState(repository.loadState())
      return { ...result, summary: repository.getSyncSummary() }
    })
  })
  ipcMain.handle('workly:fx-status', (event) => {
    assertTrustedSender(event)
    const account = repository.loadState().account
    return account ? fxService.getStatus(account.currency) : fxService.getStatus(undefined)
  })
  ipcMain.handle('workly:fx-refresh', async (event) => {
    assertTrustedSender(event)
    const account = repository.loadState().account
    return account ? fxService.refresh(account.currency) : fxService.getStatus(undefined)
  })
  ipcMain.handle('workly:fx-convert', (event, money, targetCurrency) => {
    assertTrustedSender(event)
    const account = repository.loadState().account
    if (!account) return { ok: false, error: 'Account setup is required before converting money.' }
    return fxService.convert(money, targetCurrency, account.currency)
  })
  ipcMain.handle('workly:sync-now', async (event) => { assertTrustedSender(event); return syncAndPublish() })
  ipcMain.handle('workly:get-auth-status', async (event) => { assertTrustedSender(event); return authService.getStatus() })
  ipcMain.handle('workly:auth-sign-up', async (event, input) => { assertTrustedSender(event); const result = await authService.signUp(input ?? {}); notifyAuthChanged(result.status); return result })
  ipcMain.handle('workly:auth-sign-in', async (event, input) => { assertTrustedSender(event); const status = await authService.signIn(input ?? {}); notifyAuthChanged(status); return status })
  ipcMain.handle('workly:auth-google', async (event) => { assertTrustedSender(event); return authService.beginGoogleSignIn(openAllowedExternalUrl) })
  ipcMain.handle('workly:auth-sign-out', (event) => {
    assertTrustedSender(event)
    return runSerializedMutation(async () => {
      timerLeaseService.stopRenewal()
      const status = await authService.signOut()
      notifyAuthChanged(status)
      return status
    })
  })
  createWindow()
  void syncAndPublish()
  const account = repository.loadState().account
  if (account) void fxService.refresh(account.currency)
  if (getActiveSessionFromState(repository.loadState())) {
    void acquireTimerLease().then((outcome) => { if (outcome.state === 'acquired') startTimerLeaseRenewal() })
  }
  syncInterval = setInterval(() => { void syncAndPublish() }, 30_000)
  syncInterval.unref()
  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (syncInterval) clearInterval(syncInterval)
  if (overlayManager) overlayManager.dispose()
  if (timerLeaseService) timerLeaseService.stopRenewal()
  if (repository) repository.close()
})
