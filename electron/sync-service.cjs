const PULL_PAGE_LIMIT = 100
const MAX_PULL_PAGES_PER_RUN = 50
// A sync RPC can otherwise remain pending forever when the network stack is
// offline. Keep the deadline independent from the transport so a later sync
// attempt is always able to make progress.
const DEFAULT_RPC_TIMEOUT_MS = 10_000

class SyncRpcTimeoutError extends Error {
  constructor(operation, timeoutMs) {
    super(`Sync RPC ${operation} timed out after ${timeoutMs}ms.`)
    this.name = 'SyncRpcTimeoutError'
    this.code = 'RPC_TIMEOUT'
  }
}

function normaliseRpcTimeoutMs(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError('Sync rpcTimeoutMs must be a positive integer number of milliseconds.')
  }
  return value
}

class SyncService {
  constructor({
    repository,
    authService,
    logger = { warn: () => {} },
    rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS,
    timeoutScheduler = { setTimeout, clearTimeout },
  }) {
    if (!timeoutScheduler || typeof timeoutScheduler.setTimeout !== 'function' || typeof timeoutScheduler.clearTimeout !== 'function') {
      throw new TypeError('Sync timeoutScheduler must provide setTimeout() and clearTimeout().')
    }
    this.repository = repository
    this.authService = authService
    this.logger = logger
    this.rpcTimeoutMs = normaliseRpcTimeoutMs(rpcTimeoutMs)
    this.timeoutScheduler = timeoutScheduler
    this.running = false
    this.lastPull = { cursor: 0, applied: 0, conflicts: 0, pages: 0, hasMore: false }
  }

  supportsPull() {
    return typeof this.repository.getPullCursor === 'function' && typeof this.repository.applyRemoteChanges === 'function'
  }

  supportsBootstrap() {
    return typeof this.repository.bootstrapRemoteSnapshot === 'function'
  }

  /**
   * Restores an already-provisioned cloud account before any normal outbox
   * operation can be queued on a fresh device.  This is intentionally a
   * separate RPC from the incremental pull: it can operate with no local
   * account/cursor and is only useful during first-run setup.
   */
  async bootstrapAuthenticatedAccount(authUserId) {
    if (!this.supportsBootstrap()) throw new Error('The local database does not support cloud bootstrap.')
    const remote = await this.getCloudBootstrapSnapshot()
    if (remote.state !== 'ready') return remote
    const { data } = remote
    if (data.found !== true) return { state: 'not_found' }
    const saved = this.repository.bootstrapRemoteSnapshot(authUserId, data)
    this.lastPull = {
      cursor: Number.isSafeInteger(data.cursor) && data.cursor >= 0 ? data.cursor : 0,
      applied: 0,
      conflicts: 0,
      pages: 0,
      hasMore: false,
    }
    return { state: 'restored', saved }
  }

  /**
   * Reads, but never imports, the account snapshot. Main uses this before an
   * explicit claim of previously-local data: a user must not accidentally
   * attach that data to an already-populated cloud workspace and overwrite it.
   */
  async getCloudBootstrapSnapshot() {
    if (!this.authService.isConfigured()) return { state: 'not_configured' }
    const token = await this.authService.getAccessToken()
    if (!token) return { state: 'not_authenticated' }
    const { data, error } = await this.callRpc('workly_bootstrap_snapshot', {}, token)
    if (error) throw new Error(error.message || 'Cloud bootstrap failed.')
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.found !== 'boolean') {
      throw new Error('Cloud bootstrap returned an invalid response.')
    }
    return { state: 'ready', data }
  }

  async syncNow() {
    if (this.running) return { state: 'already_running', processed: 0, failed: 0 }
    if (!this.authService.isConfigured()) return { state: 'not_configured', processed: 0, failed: 0 }
    const token = await this.authService.getAccessToken()
    if (!token) return { state: 'not_authenticated', processed: 0, failed: 0 }
    this.running = true
    let processed = 0
    let failed = 0
    try {
      // Pull before writing. If another device changed an entity while this
      // device was offline, the repository records that conflict and omits
      // the pending local operation from this run instead of silently
      // last-writing it over the cloud version. A failed pull is a safety
      // stop: keep the durable outbox untouched until cloud state is known.
      if (this.supportsPull()) {
        try {
          this.lastPull = await this.pullChanges(token)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Remote pull failed.'
          this.logger.warn('TimeFarm sync pull failed before push', { message })
          return { state: 'partial', processed: 0, failed: 1 }
        }
      }

      for (const operation of this.repository.getQueuedOperations(50)) {
        try {
          await this.applyOperation(operation, token)
          this.repository.markOperationSynced(operation.id)
          processed += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Sync failed.'
          this.repository.markOperationFailed(operation.id, message)
          failed += 1
          this.logger.warn('TimeFarm sync operation failed', { operationId: operation.id, entityType: operation.entityType })
          // Account creation is the root dependency for every other cloud
          // entity.  Do not keep attempting dependent writes in this run if
          // it failed: a direct or stale client must never produce cloud rows
          // that cannot be identified by a profile-backed bootstrap.
          if (operation.entityType === 'account') {
            return { state: 'partial', processed, failed }
          }
        }
      }

      return { state: failed > 0 ? 'partial' : 'complete', processed, failed }
    } finally {
      this.running = false
    }
  }

  async pullChanges(accessToken) {
    if (!this.supportsPull()) return { cursor: 0, applied: 0, conflicts: 0, pages: 0, hasMore: false }
    let cursor = this.repository.getPullCursor()
    let applied = 0
    let conflicts = 0
    let pages = 0
    let hasMore = false

    while (pages < MAX_PULL_PAGES_PER_RUN) {
      const beforeCursor = cursor
      const { data, error } = await this.callRpc('workly_pull_changes', {
        p_cursor: cursor,
        p_limit: PULL_PAGE_LIMIT,
      }, accessToken)
      if (error) throw new Error(error.message)
      if (data !== null && data !== undefined && !Array.isArray(data)) {
        throw new Error('Remote pull returned an invalid response.')
      }
      const changes = data ?? []
      const result = this.repository.applyRemoteChanges(changes)
      if (!result || !Number.isSafeInteger(result.cursor) || result.cursor < beforeCursor) {
        throw new Error('Remote pull did not return a valid cursor.')
      }
      cursor = result.cursor
      applied += Number.isSafeInteger(result.applied) ? result.applied : 0
      conflicts += Number.isSafeInteger(result.conflicts) ? result.conflicts : 0
      pages += 1
      if (changes.length < PULL_PAGE_LIMIT) return { cursor, applied, conflicts, pages, hasMore: false }
      if (cursor <= beforeCursor) {
        throw new Error('Remote pull did not advance its cursor.')
      }
      hasMore = true
    }

    return { cursor, applied, conflicts, pages, hasMore }
  }

  async applyOperation(operation, accessToken) {
    const { error } = await this.callRpc('workly_apply_sync_operation', {
      p_operation_id: operation.id,
      p_entity_type: operation.entityType,
      p_entity_id: operation.entityId,
      p_operation: operation.operation,
      p_payload: operation.payload,
    }, accessToken)
    if (error) throw new Error(error.message)
  }

  callRpc(operation, params, accessToken) {
    const client = this.authService.client
    if (!client || typeof client.rpc !== 'function') throw new Error('Supabase client is unavailable.')
    // Supabase PostgREST's rpc() options only accept head/get/count; a
    // `headers` property there is silently ignored by current supabase-js.
    // Set the bearer on the underlying request headers so security-definer
    // functions receive the authenticated user's JWT instead of anon.
    const requestHeaders = client.rest?.headers
    const previousAuthorization = requestHeaders?.get?.('Authorization')
    if (requestHeaders?.set) requestHeaders.set('Authorization', `Bearer ${accessToken}`)
    let response
    try {
      response = client.rpc(operation, params)
    } catch (error) {
      if (requestHeaders?.delete) {
        if (previousAuthorization) requestHeaders.set('Authorization', previousAuthorization)
        else requestHeaders.delete('Authorization')
      }
      return Promise.reject(error)
    }
    return this.waitForRpcResponse(response, operation).finally(() => {
      if (requestHeaders?.delete) {
        if (previousAuthorization) requestHeaders.set('Authorization', previousAuthorization)
        else requestHeaders.delete('Authorization')
      }
    })
  }

  /**
   * Supabase RPC promises can remain pending when an offline transport never
   * settles. The original response is deliberately observed but made inert
   * after the local deadline wins, so it cannot mutate repository state during
   * a later sync run.
   */
  waitForRpcResponse(rpcResponse, operation) {
    return new Promise((resolve, reject) => {
      let settled = false
      let timeoutHandle
      const settle = (callback, value) => {
        if (settled) return
        settled = true
        if (timeoutHandle !== undefined) this.timeoutScheduler.clearTimeout(timeoutHandle)
        callback(value)
      }

      try {
        timeoutHandle = this.timeoutScheduler.setTimeout(() => {
          settle(reject, new SyncRpcTimeoutError(operation, this.rpcTimeoutMs))
        }, this.rpcTimeoutMs)
        timeoutHandle?.unref?.()
        Promise.resolve(rpcResponse).then(
          (response) => settle(resolve, response),
          (error) => settle(reject, error),
        )
      } catch (error) {
        settle(reject, error)
      }
    })
  }
}

module.exports = {
  DEFAULT_RPC_TIMEOUT_MS,
  MAX_PULL_PAGES_PER_RUN,
  PULL_PAGE_LIMIT,
  SyncRpcTimeoutError,
  SyncService,
  normaliseRpcTimeoutMs,
}
