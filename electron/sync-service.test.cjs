const assert = require('node:assert/strict')
const test = require('node:test')
const { SyncService } = require('./sync-service.cjs')

function operation(id) {
  return { id, entityType: 'work_session', entityId: id, operation: 'upsert', payload: { id } }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function controlledTimeoutScheduler() {
  const timers = []
  return {
    timers,
    setTimeout: (callback, milliseconds) => {
      const timer = { callback, cleared: false, milliseconds }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer) => { timer.cleared = true },
  }
}

async function waitForRpcSetup() {
  await new Promise((resolve) => setImmediate(resolve))
}

test('sync worker marks successful outbox operations exactly once per run', async () => {
  const marked = []
  const repository = { getQueuedOperations: () => [operation('one'), operation('two')], markOperationSynced: (id) => marked.push(id), markOperationFailed: () => {} }
  const authService = { isConfigured: () => true, getAccessToken: async () => 'token', client: { rpc: async () => ({ error: null }) } }
  const service = new SyncService({ repository, authService })
  const result = await service.syncNow()
  assert.deepEqual(result, { state: 'complete', processed: 2, failed: 0 })
  assert.deepEqual(marked, ['one', 'two'])
})

test('sync worker preserves failed operations for retry', async () => {
  const failed = []
  const repository = { getQueuedOperations: () => [operation('one')], markOperationSynced: () => {}, markOperationFailed: (id, message) => failed.push([id, message]) }
  const authService = { isConfigured: () => true, getAccessToken: async () => 'token', client: { rpc: async () => ({ error: { message: 'Network unavailable' } }) } }
  const service = new SyncService({ repository, authService })
  const result = await service.syncNow()
  assert.deepEqual(result, { state: 'partial', processed: 0, failed: 1 })
  assert.deepEqual(failed, [['one', 'Network unavailable']])
})

test('stops dependent cloud writes when the root account operation fails', async () => {
  const failed = []
  const calls = []
  const account = { id: 'account-op', entityType: 'account', entityId: 'account-1', operation: 'upsert', payload: { id: 'account-1' } }
  const project = { id: 'project-op', entityType: 'project', entityId: 'project-1', operation: 'upsert', payload: { id: 'project-1' } }
  const repository = {
    getQueuedOperations: () => [account, project],
    markOperationSynced: () => { throw new Error('dependent work must not be acknowledged') },
    markOperationFailed: (id, message) => failed.push([id, message]),
  }
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => 'token',
    client: { rpc: async (_name, args) => {
      calls.push(args.p_entity_type)
      return { error: { message: 'Profile write unavailable' } }
    } },
  }
  const service = new SyncService({ repository, authService })
  assert.deepEqual(await service.syncNow(), { state: 'partial', processed: 0, failed: 1 })
  assert.deepEqual(calls, ['account'])
  assert.deepEqual(failed, [['account-op', 'Profile write unavailable']])
})

test('sync worker stays offline without auth configuration or a session', async () => {
  const repository = { getQueuedOperations: () => { throw new Error('must not read queue') } }
  const notConfigured = new SyncService({ repository, authService: { isConfigured: () => false } })
  assert.equal((await notConfigured.syncNow()).state, 'not_configured')
  const signedOut = new SyncService({ repository, authService: { isConfigured: () => true, getAccessToken: async () => null } })
  assert.equal((await signedOut.syncNow()).state, 'not_authenticated')
})

test('pulls before pushing so a remote change is applied before local outbox work', async () => {
  const calls = []
  const marked = []
  let cursor = 7
  const repository = {
    getQueuedOperations: () => [operation('one')],
    markOperationSynced: (id) => marked.push(id),
    markOperationFailed: () => {},
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      assert.deepEqual(changes, [{ cursor: 8, entity_type: 'goal', entity_id: 'goal-1', operation: 'upsert', payload: { id: 'goal-1' } }])
      cursor = 8
      return { cursor, applied: 1, conflicts: 0 }
    },
  }
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => 'token',
    client: {
      rpc: async (name) => {
        calls.push(name)
        if (name === 'workly_apply_sync_operation') return { error: null }
        return { data: [{ cursor: 8, entity_type: 'goal', entity_id: 'goal-1', operation: 'upsert', payload: { id: 'goal-1' } }], error: null }
      },
    },
  }
  const service = new SyncService({ repository, authService })
  const result = await service.syncNow()
  assert.deepEqual(result, { state: 'complete', processed: 1, failed: 0 })
  assert.deepEqual(marked, ['one'])
  assert.deepEqual(calls, ['workly_pull_changes', 'workly_apply_sync_operation'])
  assert.deepEqual(service.lastPull, { cursor: 8, applied: 1, conflicts: 0, pages: 1, hasMore: false })
})

test('retries a failed pull from the unchanged cursor on the next sync run', async () => {
  let cursor = 0
  let pullAttempts = 0
  const repository = {
    getQueuedOperations: () => [],
    markOperationSynced: () => {},
    markOperationFailed: () => {},
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      cursor = changes.at(-1)?.cursor ?? cursor
      return { cursor, applied: changes.length, conflicts: 0 }
    },
  }
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => 'token',
    client: {
      rpc: async (name, args) => {
        assert.equal(name, 'workly_pull_changes')
        assert.equal(args.p_cursor, cursor)
        pullAttempts += 1
        if (pullAttempts === 1) return { error: { message: 'Temporary network failure' } }
        return { data: [{ cursor: 9, entity_type: 'goal', entity_id: 'goal-1', operation: 'upsert', payload: { id: 'goal-1' } }], error: null }
      },
    },
  }
  const service = new SyncService({ repository, authService })
  assert.deepEqual(await service.syncNow(), { state: 'partial', processed: 0, failed: 1 })
  assert.equal(cursor, 0)
  assert.deepEqual(await service.syncNow(), { state: 'complete', processed: 0, failed: 0 })
  assert.equal(cursor, 9)
  assert.equal(pullAttempts, 2)
})

test('does not push a local operation after the pre-pull records a remote conflict', async () => {
  let cursor = 0
  let conflictOpen = false
  const calls = []
  const repository = {
    getQueuedOperations: () => conflictOpen ? [] : [operation('one')],
    markOperationSynced: () => { throw new Error('a conflicted operation must not be acknowledged') },
    markOperationFailed: () => { throw new Error('a conflicted operation is paused, not failed') },
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      cursor = changes.at(-1)?.cursor ?? cursor
      conflictOpen = true
      return { cursor, applied: 0, conflicts: 1 }
    },
  }
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => 'token',
    client: { rpc: async (name) => {
      calls.push(name)
      if (name === 'workly_apply_sync_operation') throw new Error('unexpected push')
      return { data: [{ cursor: 1, entity_type: 'project', entity_id: 'project-1', operation: 'upsert', payload: { id: 'project-1' } }], error: null }
    } },
  }
  const service = new SyncService({ repository, authService })
  assert.deepEqual(await service.syncNow(), { state: 'complete', processed: 0, failed: 0 })
  assert.deepEqual(calls, ['workly_pull_changes'])
  assert.equal(service.lastPull.conflicts, 1)
})

test('times out a push, leaves it retryable, ignores a late success, and allows the next sync run', async () => {
  const timeoutScheduler = controlledTimeoutScheduler()
  const lateResponse = deferred()
  const failed = []
  const marked = []
  let rpcCalls = 0
  const repository = {
    getQueuedOperations: () => [operation('one')],
    markOperationSynced: (id) => marked.push(id),
    markOperationFailed: (id, message) => failed.push([id, message]),
  }
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => 'token',
    client: { rpc: () => {
      rpcCalls += 1
      return rpcCalls === 1 ? lateResponse.promise : Promise.resolve({ error: null })
    } },
  }
  const service = new SyncService({ repository, authService, rpcTimeoutMs: 250, timeoutScheduler })

  const first = service.syncNow()
  await waitForRpcSetup()
  assert.equal(timeoutScheduler.timers.length, 1)
  assert.equal(timeoutScheduler.timers[0].milliseconds, 250)
  timeoutScheduler.timers[0].callback()

  assert.deepEqual(await first, { state: 'partial', processed: 0, failed: 1 })
  assert.equal(service.running, false)
  assert.deepEqual(failed, [['one', 'Sync RPC workly_apply_sync_operation timed out after 250ms.']])
  assert.deepEqual(marked, [])

  lateResponse.resolve({ error: null })
  await waitForRpcSetup()
  assert.deepEqual(marked, [], 'a late response from the timed-out run must be inert')

  assert.deepEqual(await service.syncNow(), { state: 'complete', processed: 1, failed: 0 })
  assert.deepEqual(marked, ['one'])
  assert.equal(rpcCalls, 2)
})

test('times out a pull without advancing its cursor and ignores a late page before retrying', async () => {
  const timeoutScheduler = controlledTimeoutScheduler()
  const lateResponse = deferred()
  let cursor = 7
  let rpcCalls = 0
  const appliedPages = []
  const repository = {
    getQueuedOperations: () => [],
    markOperationSynced: () => {},
    markOperationFailed: () => {},
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      appliedPages.push(changes)
      cursor = changes.at(-1)?.cursor ?? cursor
      return { cursor, applied: changes.length, conflicts: 0 }
    },
  }
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => 'token',
    client: { rpc: () => {
      rpcCalls += 1
      return rpcCalls === 1
        ? lateResponse.promise
        : Promise.resolve({ data: [{ cursor: 8, entity_type: 'goal', entity_id: 'goal-1', operation: 'upsert', payload: { id: 'goal-1' } }], error: null })
    } },
  }
  const service = new SyncService({ repository, authService, rpcTimeoutMs: 250, timeoutScheduler })

  const first = service.syncNow()
  await waitForRpcSetup()
  assert.equal(timeoutScheduler.timers.length, 1)
  timeoutScheduler.timers[0].callback()

  assert.deepEqual(await first, { state: 'partial', processed: 0, failed: 1 })
  assert.equal(service.running, false)
  assert.equal(cursor, 7)
  assert.deepEqual(appliedPages, [])

  lateResponse.resolve({ data: [{ cursor: 8, entity_type: 'goal', entity_id: 'goal-1', operation: 'upsert', payload: { id: 'goal-1' } }], error: null })
  await waitForRpcSetup()
  assert.equal(cursor, 7, 'a late page must not mutate the local pull cursor')
  assert.deepEqual(appliedPages, [])

  assert.deepEqual(await service.syncNow(), { state: 'complete', processed: 0, failed: 0 })
  assert.equal(cursor, 8)
  assert.equal(rpcCalls, 2)
})

test('bootstraps a fresh device from cloud before it reads or pushes the normal outbox', async () => {
  const snapshot = {
    found: true,
    cursor: 91,
    profile: { displayName: 'Cloud Minh' },
    preferences: {},
    projects: [],
    sessions: [],
    payments: [],
    goals: [],
  }
  const imported = []
  const repository = {
    bootstrapRemoteSnapshot: (authUserId, received) => {
      imported.push([authUserId, received])
      return { version: 1, account: { id: authUserId }, projects: [], sessions: [], payments: [], goals: [], preferences: {} }
    },
    getQueuedOperations: () => { throw new Error('bootstrap must not push an outbox operation') },
  }
  const calls = []
  let authorization
  const requestHeaders = {
    get: () => authorization,
    set: (_name, value) => { authorization = value },
    delete: () => { authorization = undefined },
  }
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => 'token',
    client: { rest: { headers: requestHeaders }, rpc: async (name, args, options) => {
      calls.push([name, args, options, authorization])
      return { data: snapshot, error: null }
    } },
  }
  const service = new SyncService({ repository, authService })
  const result = await service.bootstrapAuthenticatedAccount('auth-user-1')
  assert.equal(result.state, 'restored')
  assert.equal(result.saved.account.id, 'auth-user-1')
  assert.deepEqual(imported, [['auth-user-1', snapshot]])
  assert.deepEqual(calls, [['workly_bootstrap_snapshot', {}, undefined, 'Bearer token']])
  assert.equal(authorization, undefined, 'the per-call bearer must not leak into later requests')
  assert.equal(service.lastPull.cursor, 91)
})

test('reports not-found cloud bootstrap without creating a local account', async () => {
  let imported = false
  const repository = { bootstrapRemoteSnapshot: () => { imported = true } }
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => 'token',
    client: { rpc: async () => ({ data: { found: false }, error: null }) },
  }
  const service = new SyncService({ repository, authService })
  assert.deepEqual(await service.bootstrapAuthenticatedAccount('auth-user-1'), { state: 'not_found' })
  assert.equal(imported, false)
})
