declare global {
  interface Window {
    worklyDesktop?: DesktopBridge;
  }

  interface DesktopBridge {
    loadState: () => Promise<unknown>;
    getLegacyImportStatus: () => Promise<LegacyImportStatus>;
    legacyImportAction: (
      action: "retry" | "open_data_folder" | "export_recovery" | "skip",
    ) => Promise<LegacyImportStatus>;
    executeCommand: (command: unknown) => Promise<unknown>;
    claimAuthenticatedAccount: () => Promise<unknown>;
    bootstrapAuthenticatedAccount: () => Promise<CloudBootstrapResult>;
    resetLocalData: () => Promise<unknown>;
    rebuildLocalCache: () => Promise<unknown>;
    getSyncSummary: () => Promise<SyncSummary>;
    getTimerLeaseStatus: () => Promise<TimerLeaseStatus>;
    acquireTimerLease: () => Promise<TimerLeaseStatus>;
    getSyncConflicts: (limit?: number) => Promise<SyncConflict[]>;
    resolveSyncConflict: (
      conflictId: string,
    ) => Promise<{ resolved: boolean; summary: SyncSummary }>;
    acceptRemoteSyncConflict: (
      conflictId: string,
    ) => Promise<SyncConflictResolution>;
    syncNow: () => Promise<unknown>;
    getFxStatus: () => Promise<FxStatus>;
    refreshFxRates: () => Promise<FxStatus>;
    convertMoney: (
      money: { amountMinor: number; currency: string },
      targetCurrency: string,
    ) => Promise<FxConversionResult>;
    getAuthStatus: () => Promise<AuthStatus>;
    signUp: (input: {
      email?: string;
      password?: string;
      displayName?: string;
    }) => Promise<{
      status: AuthStatus;
      requiresEmailConfirmation: boolean;
    }>;
    signIn: (input: {
      email?: string;
      password?: string;
    }) => Promise<AuthStatus>;
    signInWithGoogle: () => Promise<{ pending: boolean }>;
    signOut: () => Promise<AuthStatus>;
    onAuthChanged: (listener: (status: AuthStatus) => void) => () => void;
    getOverlayPreferences: () => Promise<OverlayPreferences>;
    setOverlayPreferences: (
      input: Partial<OverlayPreferences>,
    ) => Promise<OverlayPreferences>;
    onStateChanged: (listener: (state: unknown) => void) => () => void;
    onTimerLeaseChanged: (
      listener: (status: TimerLeaseStatus) => void,
    ) => () => void;
    onOverlayStopRequested: (
      listener: (request: { sessionId: string; session?: unknown }) => void,
    ) => () => void;
  }

  interface SyncSummary {
    queued: number;
    failed: number;
    conflicts: number;
  }

  interface LegacyImportStatus {
    status:
      | "success"
      | "not_found"
      | "already_initialized"
      | "already_migrated"
      | "invalid_data"
      | "filesystem_error"
      | "unsupported_version"
      | "skipped";
    errorCode?: string;
    version?: unknown;
    warning?: "archive_failed";
  }

  interface OverlayPreferences {
    mode: "interactive" | "view_only" | "hidden";
    position: { x: number; y: number };
  }

  interface AuthStatus {
    configured: boolean;
    authenticated: boolean;
    user: {
      id: string;
      email: string | null;
      displayName: string | null;
    } | null;
    offline?: boolean;
    error?: string;
  }

  interface CloudBootstrapResult {
    state:
      | "already_initialized"
      | "not_configured"
      | "not_authenticated"
      | "not_found"
      | "offline"
      | "restored"
      | "failed";
    error?: string;
  }

  interface FxStatus {
    state: "available" | "stale" | "unavailable";
    baseCurrency: string | undefined;
    provider: string;
    fetchedAt: string | null;
    sourceDate: string | null;
    rates: Record<string, number>;
    error: string | null;
    staleReasons?: string[];
  }

  interface FxConversionResult {
    ok: boolean;
    money?: { amountMinor: number; currency: string };
    rate?: number;
    fetchedAt?: string | null;
    provider?: string;
    error?: string;
  }

  interface SyncConflict {
    id: string;
    cursor: number;
    entityType:
      | "account"
      | "project"
      | "work_session"
      | "payment"
      | "goal"
      | "preferences";
    entityId: string;
    operation: "upsert" | "delete";
    reason: string;
    detectedAt: string;
    resolution: "open" | "resolved";
  }

  interface SyncConflictResolution {
    accepted: boolean;
    reason?: string;
    entityType?: SyncConflict["entityType"];
    entityId?: string;
    operation?: SyncConflict["operation"];
    applied?: boolean;
    cancelledOperations?: number;
    summary: SyncSummary;
  }

  interface TimerLeaseStatus {
    state?:
      | "acquired"
      | "not_configured"
      | "not_authenticated"
      | "held_by_other"
      | "failed";
    held?: boolean;
    renewing?: boolean;
    error?: string;
    deviceId?: string;
    acquiredAt?: string;
  }
}

export type DesktopBridgeContract = DesktopBridge;
export {};
