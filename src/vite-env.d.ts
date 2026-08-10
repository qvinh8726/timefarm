/// <reference types="vite/client" />

interface Window {
  worklyDesktop?: {
    loadState: () => Promise<unknown>
    executeCommand: (command: unknown) => Promise<unknown>
    claimAuthenticatedAccount: () => Promise<unknown>
    bootstrapAuthenticatedAccount: () => Promise<CloudBootstrapResult>
    resetLocalData: () => Promise<unknown>
    getSyncSummary: () => Promise<{ queued: number; failed: number; conflicts: number }>
    getTimerLeaseStatus: () => Promise<TimerLeaseStatus>
    acquireTimerLease: () => Promise<TimerLeaseStatus>
    getSyncConflicts: (limit?: number) => Promise<SyncConflict[]>
    resolveSyncConflict: (conflictId: string) => Promise<{ resolved: boolean; summary: { queued: number; failed: number; conflicts: number } }>
    acceptRemoteSyncConflict: (conflictId: string) => Promise<SyncConflictResolution>
    syncNow: () => Promise<unknown>
    getFxStatus: () => Promise<FxStatus>
    refreshFxRates: () => Promise<FxStatus>
    convertMoney: (money: { amountMinor: number; currency: string }, targetCurrency: string) => Promise<FxConversionResult>
    getAuthStatus: () => Promise<AuthStatus>
    signUp: (input: { email?: string; password?: string; displayName?: string }) => Promise<{ status: AuthStatus; requiresEmailConfirmation: boolean }>
    signIn: (input: { email?: string; password?: string }) => Promise<AuthStatus>
    signInWithGoogle: () => Promise<{ pending: boolean }>
    signOut: () => Promise<AuthStatus>
    onAuthChanged: (listener: (status: AuthStatus) => void) => () => void
    getOverlayPreferences: () => Promise<{ mode: 'interactive' | 'view_only' | 'hidden'; position: { x: number; y: number } }>
    setOverlayPreferences: (input: { mode?: 'interactive' | 'view_only' | 'hidden'; position?: { x: number; y: number } }) => Promise<{ mode: 'interactive' | 'view_only' | 'hidden'; position: { x: number; y: number } }>
    onStateChanged: (listener: (state: unknown) => void) => () => void
    onTimerLeaseChanged: (listener: (status: TimerLeaseStatus) => void) => () => void
    onOverlayStopRequested: (listener: (request: { sessionId: string; session?: unknown }) => void) => () => void
  }
}

interface AuthStatus {
  configured: boolean
  authenticated: boolean
  user: { id: string; email: string | null; displayName: string | null } | null
  offline?: boolean
  error?: string
}

interface CloudBootstrapResult {
  state: 'already_initialized' | 'not_configured' | 'not_authenticated' | 'not_found' | 'offline' | 'restored' | 'failed'
  error?: string
}

interface FxStatus {
  state: 'available' | 'stale' | 'unavailable'
  baseCurrency: string | undefined
  provider: string
  fetchedAt: string | null
  sourceDate: string | null
  rates: Record<string, number>
  error: string | null
}

interface FxConversionResult {
  ok: boolean
  money?: { amountMinor: number; currency: string }
  rate?: number
  fetchedAt?: string | null
  provider?: string
  error?: string
}

interface SyncConflict {
  id: string
  cursor: number
  entityType: 'account' | 'project' | 'work_session' | 'payment' | 'goal' | 'preferences'
  entityId: string
  operation: 'upsert' | 'delete'
  reason: string
  detectedAt: string
  resolution: 'open' | 'resolved'
}

interface SyncConflictResolution {
  accepted: boolean
  reason?: string
  entityType?: SyncConflict['entityType']
  entityId?: string
  operation?: SyncConflict['operation']
  applied?: boolean
  cancelledOperations?: number
  summary: { queued: number; failed: number; conflicts: number }
}

interface TimerLeaseStatus {
  state?: 'acquired' | 'not_configured' | 'not_authenticated' | 'held_by_other' | 'failed'
  held?: boolean
  renewing?: boolean
  error?: string
  deviceId?: string
  acquiredAt?: string
}
