const PULL_PAGE_LIMIT = 100;
const MAX_PULL_PAGES_PER_RUN = 50;
const BOOTSTRAP_PAGE_LIMIT = 250;
const MAX_BOOTSTRAP_PAGES = 200;
const BOOTSTRAP_COLLECTIONS = Object.freeze({
  project: "projects",
  work_session: "sessions",
  payment: "payments",
  goal: "goals",
});
// A sync RPC can otherwise remain pending forever when the network stack is
// offline. Keep the deadline independent from the transport so a later sync
// attempt is always able to make progress.
const DEFAULT_RPC_TIMEOUT_MS = 10_000;

class SyncRpcTimeoutError extends Error {
  constructor(operation, timeoutMs) {
    super(`Sync RPC ${operation} timed out after ${timeoutMs}ms.`);
    this.name = "SyncRpcTimeoutError";
    this.code = "RPC_TIMEOUT";
  }
}

function normaliseRpcTimeoutMs(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      "Sync rpcTimeoutMs must be a positive integer number of milliseconds.",
    );
  }
  return value;
}

class SyncService {
  /** @param {{repository: any, authService: any, logger?: any, rpcTimeoutMs?: number, timeoutScheduler?: any}} options */
  constructor({
    repository,
    authService,
    logger = { warn: () => {} },
    rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS,
    timeoutScheduler = { setTimeout, clearTimeout },
  }) {
    if (
      !timeoutScheduler ||
      typeof timeoutScheduler.setTimeout !== "function" ||
      typeof timeoutScheduler.clearTimeout !== "function"
    ) {
      throw new TypeError(
        "Sync timeoutScheduler must provide setTimeout() and clearTimeout().",
      );
    }
    this.repository = repository;
    this.authService = authService;
    this.logger = logger;
    this.rpcTimeoutMs = normaliseRpcTimeoutMs(rpcTimeoutMs);
    this.timeoutScheduler = timeoutScheduler;
    this.running = false;
    this.lastPull = {
      cursor: 0,
      applied: 0,
      conflicts: 0,
      pages: 0,
      hasMore: false,
    };
  }

  supportsPull() {
    return (
      typeof this.repository.getPullCursor === "function" &&
      typeof this.repository.applyRemoteChanges === "function"
    );
  }

  supportsBootstrap() {
    return typeof this.repository.bootstrapRemoteSnapshot === "function";
  }

  supportsRevisionCas() {
    return (
      typeof this.repository.setOperationExpectedRevision === "function" &&
      typeof this.repository.markOperationSynced === "function"
    );
  }

  /**
   * Restores an already-provisioned cloud account before any normal outbox
   * operation can be queued on a fresh device.  This is intentionally a
   * separate RPC from the incremental pull: it can operate with no local
   * account/cursor and is only useful during first-run setup.
   */
  async bootstrapAuthenticatedAccount(authUserId) {
    if (!this.supportsBootstrap())
      throw new Error("The local database does not support cloud bootstrap.");
    const remote = await this.getCloudBootstrapSnapshot(authUserId);
    if (remote.state !== "ready") return remote;
    const { data } = remote;
    if (data.found !== true) return { state: "not_found" };
    const saved = this.repository.bootstrapRemoteSnapshot(authUserId, data);
    this.lastPull = {
      cursor:
        Number.isSafeInteger(data.cursor) && data.cursor >= 0 ? data.cursor : 0,
      applied: 0,
      conflicts: 0,
      pages: 0,
      hasMore: false,
    };
    return { state: "restored", saved };
  }

  async claimCloudWorkspace(account, expectedAuthUserId) {
    if (!this.authService.isConfigured()) return { state: "not_configured" };
    if (!account || typeof account.id !== "string" || !account.id.trim()) {
      throw new Error(
        "A local workspace is required before it can be claimed.",
      );
    }
    const token = await this.authService.getAccessToken(expectedAuthUserId);
    if (!token) return { state: "not_authenticated" };
    const profile = {
      displayName: account.displayName,
      country: account.country,
      language: account.language,
      currency: account.currency,
      timezone: account.timezone,
    };
    const { data, error } = await this.callRpc(
      "workly_claim_workspace",
      {
        p_workspace_id: account.id,
        p_profile: profile,
      },
      token,
    );
    if (error?.code === "PGRST202")
      throw new Error(
        "Cloud workspace claiming is not deployed. Apply Supabase migration 0003_atomic_workspace_claim.sql before linking local data.",
      );
    if (error)
      throw new Error(error.message || "Cloud workspace claim failed.");
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.claimed !== "boolean"
    ) {
      throw new Error("Cloud workspace claim returned an invalid response.");
    }
    return { state: "ready", data };
  }

  /**
   * Reads, but never imports, the account snapshot. Main uses this before an
   * explicit claim of previously-local data: a user must not accidentally
   * attach that data to an already-populated cloud workspace and overwrite it.
   */
  async getCloudBootstrapSnapshot(expectedAuthUserId) {
    if (!this.authService.isConfigured()) return { state: "not_configured" };
    const token = await this.authService.getAccessToken(expectedAuthUserId);
    if (!token) return { state: "not_authenticated" };
    let afterType = null;
    let afterId = null;
    let snapshotCursor = null;
    let snapshot = null;
    const seenCursors = new Set();

    for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page += 1) {
      const { data, error } = await this.callRpc(
        "workly_bootstrap_page_v2",
        {
          p_after_type: afterType,
          p_after_id: afterId,
          p_snapshot_cursor: snapshotCursor,
          p_limit: BOOTSTRAP_PAGE_LIMIT,
        },
        token,
      );
      if (error?.code === "PGRST202")
        throw new Error(
          "Revision-aware cloud bootstrap is not deployed. Apply Supabase migration 0005_optimistic_revisions.sql before connecting this device.",
        );
      if (error) throw new Error(error.message || "Cloud bootstrap failed.");
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        typeof data.found !== "boolean" ||
        !Number.isSafeInteger(data.cursor) ||
        data.cursor < 0
      ) {
        throw new Error("Cloud bootstrap returned an invalid response.");
      }
      if (data.found === false) {
        if (page !== 0)
          throw new Error("Cloud bootstrap account disappeared between pages.");
        return { state: "ready", data };
      }
      if (
        !data.profile ||
        typeof data.profile !== "object" ||
        Array.isArray(data.profile) ||
        !data.preferences ||
        typeof data.preferences !== "object" ||
        Array.isArray(data.preferences) ||
        !Number.isSafeInteger(data.profile.remoteRevision) ||
        data.profile.remoteRevision < 0 ||
        !Number.isSafeInteger(data.preferences.remoteRevision) ||
        data.preferences.remoteRevision < 0 ||
        !Array.isArray(data.items) ||
        typeof data.hasMore !== "boolean"
      ) {
        throw new Error("Cloud bootstrap page returned an invalid response.");
      }

      if (snapshotCursor === null) {
        snapshotCursor = data.cursor;
        snapshot = {
          version: 2,
          found: true,
          cursor: snapshotCursor,
          profile: data.profile,
          preferences: data.preferences,
          projects: [],
          sessions: [],
          payments: [],
          goals: [],
        };
      } else if (data.cursor !== snapshotCursor) {
        throw new Error(
          "Cloud bootstrap snapshot cursor changed between pages.",
        );
      }

      for (const item of data.items) {
        if (
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          typeof item.entityType !== "string" ||
          typeof item.entityId !== "string" ||
          !item.payload ||
          typeof item.payload !== "object" ||
          Array.isArray(item.payload) ||
          !Number.isSafeInteger(item.payload.remoteRevision) ||
          item.payload.remoteRevision < 0
        ) {
          throw new Error("Cloud bootstrap item returned an invalid response.");
        }
        const collection = BOOTSTRAP_COLLECTIONS[item.entityType];
        if (!collection)
          throw new Error(
            `Cloud bootstrap returned unsupported entity type ${item.entityType}.`,
          );
        snapshot[collection].push(item.payload);
      }

      if (!data.hasMore) return { state: "ready", data: snapshot };
      const next = data.nextAfter;
      if (
        data.items.length === 0 ||
        !next ||
        typeof next !== "object" ||
        Array.isArray(next) ||
        typeof next.entityType !== "string" ||
        typeof next.entityId !== "string"
      ) {
        throw new Error("Cloud bootstrap page did not provide a valid cursor.");
      }
      const cursorKey = `${next.entityType}:${next.entityId}`;
      if (seenCursors.has(cursorKey))
        throw new Error("Cloud bootstrap page cursor did not advance.");
      seenCursors.add(cursorKey);
      afterType = next.entityType;
      afterId = next.entityId;
    }

    throw new Error(
      `Cloud bootstrap exceeded the safe ${MAX_BOOTSTRAP_PAGES * BOOTSTRAP_PAGE_LIMIT}-item limit; archive older history before connecting a new device.`,
    );
  }

  async syncNow(expectedAuthUserId) {
    if (this.running)
      return { state: "already_running", processed: 0, failed: 0 };
    if (!this.authService.isConfigured())
      return { state: "not_configured", processed: 0, failed: 0 };
    const token = await this.authService.getAccessToken(expectedAuthUserId);
    if (!token) return { state: "not_authenticated", processed: 0, failed: 0 };
    this.running = true;
    let processed = 0;
    let failed = 0;
    try {
      // Pull before writing. If another device changed an entity while this
      // device was offline, the repository records that conflict and omits
      // the pending local operation from this run instead of silently
      // last-writing it over the cloud version. A failed pull is a safety
      // stop: keep the durable outbox untouched until cloud state is known.
      if (this.supportsPull()) {
        try {
          this.lastPull = await this.pullChanges(token);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Remote pull failed.";
          this.logger.warn("TimeFarm sync pull failed before push", {
            message,
          });
          return { state: "partial", processed: 0, failed: 1 };
        }
        // Pull-before-push is a correctness boundary, not a best-effort hint.
        // If the bounded pull still has another page, a remote conflict may be
        // waiting beyond the current cursor. Never push stale local work until
        // a later run has caught up completely.
        if (this.lastPull.hasMore) {
          return { state: "pull_pending", processed: 0, failed: 0 };
        }
      }

      let operations = this.repository.getQueuedOperations(50);
      if (this.supportsRevisionCas()) {
        try {
          await this.hydrateExpectedRevisions(operations, token);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Cloud revision lookup failed.";
          this.logger.warn("TimeFarm revision hydration failed before push", {
            message,
          });
          return { state: "partial", processed: 0, failed: 1 };
        }
        operations = this.repository.getQueuedOperations(50);
      }
      for (const operation of operations) {
        try {
          const result = await this.applyOperation(operation, token);
          this.repository.markOperationSynced(
            operation.id,
            result?.remoteRevision,
          );
          processed += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Sync failed.";
          this.repository.markOperationFailed(operation.id, message);
          failed += 1;
          this.logger.warn("TimeFarm sync operation failed", {
            operationId: operation.id,
            entityType: operation.entityType,
          });
          // Account creation is the root dependency for every other cloud
          // entity.  Do not keep attempting dependent writes in this run if
          // it failed: a direct or stale client must never produce cloud rows
          // that cannot be identified by a profile-backed bootstrap.
          if (operation.entityType === "account") {
            return { state: "partial", processed, failed };
          }
        }
      }

      return { state: failed > 0 ? "partial" : "complete", processed, failed };
    } finally {
      this.running = false;
    }
  }

  async pullChanges(accessToken) {
    if (!this.supportsPull())
      return { cursor: 0, applied: 0, conflicts: 0, pages: 0, hasMore: false };
    let cursor = this.repository.getPullCursor();
    let applied = 0;
    let conflicts = 0;
    let pages = 0;
    let hasMore = false;

    while (pages < MAX_PULL_PAGES_PER_RUN) {
      const beforeCursor = cursor;
      const { data, error } = await this.callRpc(
        "workly_pull_changes",
        {
          p_cursor: cursor,
          p_limit: PULL_PAGE_LIMIT,
        },
        accessToken,
      );
      if (error) throw new Error(error.message);
      if (data !== null && data !== undefined && !Array.isArray(data)) {
        throw new Error("Remote pull returned an invalid response.");
      }
      const changes = data ?? [];
      const result = this.repository.applyRemoteChanges(changes);
      if (
        !result ||
        !Number.isSafeInteger(result.cursor) ||
        result.cursor < beforeCursor
      ) {
        throw new Error("Remote pull did not return a valid cursor.");
      }
      cursor = result.cursor;
      applied += Number.isSafeInteger(result.applied) ? result.applied : 0;
      conflicts += Number.isSafeInteger(result.conflicts)
        ? result.conflicts
        : 0;
      pages += 1;
      if (changes.length < PULL_PAGE_LIMIT)
        return { cursor, applied, conflicts, pages, hasMore: false };
      if (cursor <= beforeCursor) {
        throw new Error("Remote pull did not advance its cursor.");
      }
      hasMore = true;
    }

    return { cursor, applied, conflicts, pages, hasMore };
  }

  async applyOperation(operation, accessToken) {
    const revisionAware = this.supportsRevisionCas();
    const params = {
      p_operation_id: operation.id,
      p_entity_type: operation.entityType,
      p_entity_id: operation.entityId,
      p_operation: operation.operation,
      p_payload: operation.payload,
    };
    if (revisionAware)
      params.p_expected_revision = operation.expectedRevision ?? null;
    const { data, error } = await this.callRpc(
      "workly_apply_sync_operation",
      params,
      accessToken,
    );
    if (error) throw new Error(error.message);
    if (!revisionAware) return data;
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error(
        "Revision-aware cloud write returned an invalid response.",
      );
    if (data.conflict === true) {
      const expected = Number.isSafeInteger(data.expectedRevision)
        ? data.expectedRevision
        : operation.expectedRevision;
      const current = Number.isSafeInteger(data.currentRevision)
        ? data.currentRevision
        : "unknown";
      throw new Error(
        `Cloud revision conflict for ${operation.entityType}/${operation.entityId}: expected ${expected ?? "unknown"}, current ${current}. Pull the cloud version before retrying.`,
      );
    }
    if (
      data.conflict !== false ||
      !Number.isSafeInteger(data.remoteRevision) ||
      data.remoteRevision < 1
    ) {
      throw new Error("Cloud write did not return a valid entity revision.");
    }
    return data;
  }

  async hydrateExpectedRevisions(operations, accessToken) {
    const missing = operations.filter(
      (operation) => !Number.isSafeInteger(operation.expectedRevision),
    );
    if (missing.length === 0) return;
    const { data, error } = await this.callRpc(
      "workly_get_entity_revisions",
      {
        p_entities: missing.map((operation) => ({
          entityType: operation.entityType,
          entityId: operation.entityId,
        })),
      },
      accessToken,
    );
    if (error?.code === "PGRST202")
      throw new Error(
        "Cloud revision lookup is not deployed. Apply Supabase migration 0005_optimistic_revisions.sql before synchronizing this device.",
      );
    if (!Array.isArray(data) || data.length !== missing.length)
      throw new Error("Cloud revision lookup returned an invalid response.");
    const revisions = new Map();
    for (const item of data) {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof item.entityType !== "string" ||
        typeof item.entityId !== "string" ||
        !Number.isSafeInteger(item.remoteRevision) ||
        item.remoteRevision < 0
      ) {
        throw new Error("Cloud revision lookup returned an invalid entity.");
      }
      revisions.set(`${item.entityType}:${item.entityId}`, item.remoteRevision);
    }
    for (const operation of missing) {
      const revision = revisions.get(
        `${operation.entityType}:${operation.entityId}`,
      );
      if (!Number.isSafeInteger(revision))
        throw new Error("Cloud revision lookup omitted a queued entity.");
      if (!this.repository.setOperationExpectedRevision(operation.id, revision))
        throw new Error(
          "A queued operation changed while its cloud revision was loading.",
        );
    }
  }

  callRpc(operation, params, accessToken) {
    const client = this.authService.client;
    if (!client || typeof client.rpc !== "function")
      throw new Error("Supabase client is unavailable.");
    // Supabase PostgREST's rpc() options only accept head/get/count; a
    // `headers` property there is silently ignored by current supabase-js.
    // Set the bearer on the underlying request headers so security-definer
    // functions receive the authenticated user's JWT instead of anon.
    const requestHeaders = client.rest?.headers;
    const previousAuthorization = requestHeaders?.get?.("Authorization");
    if (requestHeaders?.set)
      requestHeaders.set("Authorization", `Bearer ${accessToken}`);
    let response;
    try {
      response = client.rpc(operation, params);
    } catch (error) {
      if (requestHeaders?.delete) {
        if (previousAuthorization)
          requestHeaders.set("Authorization", previousAuthorization);
        else requestHeaders.delete("Authorization");
      }
      return Promise.reject(error);
    }
    return this.waitForRpcResponse(response, operation).finally(() => {
      if (requestHeaders?.delete) {
        if (previousAuthorization)
          requestHeaders.set("Authorization", previousAuthorization);
        else requestHeaders.delete("Authorization");
      }
    });
  }

  /**
   * Supabase RPC promises can remain pending when an offline transport never
   * settles. The original response is deliberately observed but made inert
   * after the local deadline wins, so it cannot mutate repository state during
   * a later sync run.
   */
  waitForRpcResponse(rpcResponse, operation) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutHandle;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== undefined)
          this.timeoutScheduler.clearTimeout(timeoutHandle);
        callback(value);
      };

      try {
        timeoutHandle = this.timeoutScheduler.setTimeout(() => {
          settle(reject, new SyncRpcTimeoutError(operation, this.rpcTimeoutMs));
        }, this.rpcTimeoutMs);
        timeoutHandle?.unref?.();
        Promise.resolve(rpcResponse).then(
          (response) => settle(resolve, response),
          (error) => settle(reject, error),
        );
      } catch (error) {
        settle(reject, error);
      }
    });
  }
}

module.exports = {
  DEFAULT_RPC_TIMEOUT_MS,
  MAX_PULL_PAGES_PER_RUN,
  PULL_PAGE_LIMIT,
  SyncRpcTimeoutError,
  SyncService,
  normaliseRpcTimeoutMs,
};
