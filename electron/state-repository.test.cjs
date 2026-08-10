const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { LocalStateRepository, StateIntegrityError, emptyState, normalizeState } = require('./state-repository.cjs')

const START = '2026-08-10T00:00:00.000Z'
const ONE_HOUR_LATER = '2026-08-10T01:00:00.000Z'
const TWO_HOURS_LATER = '2026-08-10T02:00:00.000Z'
const THREE_HOURS_LATER = '2026-08-10T03:00:00.000Z'
const FOUR_HOURS_LATER = '2026-08-10T04:00:00.000Z'

function fixture() {
  const state = emptyState()
  state.account = {
    id: 'user-1',
    displayName: 'Minh',
    country: 'VN',
    language: 'vi',
    currency: 'VND',
    timezone: 'Asia/Saigon',
    createdAt: START,
  }
  state.projects = [{
    id: 'project-1',
    name: 'Website',
    paymentModel: 'progressive',
    color: '#7c3aed',
    icon: '✦',
    status: 'active',
    createdAt: START,
    updatedAt: START,
    syncStatus: 'local',
  }]
  state.sessions = [activeSession()]
  return state
}

function activeSession(overrides = {}) {
  return {
    id: 'session-1',
    projectId: 'project-1',
    startedAt: START,
    timezone: 'Asia/Saigon',
    pauses: [],
    status: 'running',
    createdAt: START,
    updatedAt: START,
    syncStatus: 'local',
    ...overrides,
  }
}

function completedSession(overrides = {}) {
  const startedAt = overrides.startedAt ?? START
  const endedAt = overrides.endedAt ?? TWO_HOURS_LATER
  return {
    id: 'session-1',
    projectId: 'project-1',
    startedAt,
    endedAt,
    timezone: 'Asia/Saigon',
    pauses: [],
    activeDurationMs: Date.parse(endedAt) - Date.parse(startedAt),
    status: 'completed',
    earnings: { amountMinor: 500000, currency: 'VND' },
    createdAt: startedAt,
    updatedAt: endedAt,
    syncStatus: 'queued',
    ...overrides,
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function withRepository(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workly-repository-'))
  const databasePath = path.join(directory, 'workly.db')
  const repository = new LocalStateRepository(databasePath)
  try {
    callback(repository, databasePath)
  } finally {
    repository.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function expectIntegrity(action, code) {
  assert.throws(action, (error) => error instanceof StateIntegrityError && error.code === code)
}

function operationFor(repository, entityType, entityId) {
  const operation = repository.getQueuedOperations(500).find((item) => item.entityType === entityType && item.entityId === entityId)
  assert.ok(operation, 'expected queued ' + entityType + ' operation for ' + entityId)
  return operation
}

function markAllOperationsSynced(repository) {
  for (const operation of repository.getQueuedOperations(500)) repository.markOperationSynced(operation.id)
}

function remoteProject(overrides = {}) {
  return {
    id: 'project-1',
    name: 'Website from another device',
    paymentModel: 'progressive',
    color: '#7c3aed',
    icon: 'âœ¦',
    status: 'active',
    createdAt: START,
    updatedAt: ONE_HOUR_LATER,
    ...overrides,
  }
}

function remoteBootstrapSnapshot(overrides = {}) {
  return {
    cursor: 42,
    profile: {
      displayName: 'Minh from cloud',
      country: 'VN',
      language: 'vi',
      currency: 'VND',
      timezone: 'Asia/Saigon',
      createdAt: START,
    },
    preferences: {
      theme: 'dark',
      miniTimerMode: 'view_only',
      dashboardHiddenWidgets: ['comparison'],
      dashboardWidgetOrder: ['timer', 'goals'],
      dashboardWidgetSizes: { timer: 'large' },
    },
    projects: [remoteProject()],
    sessions: [completedSession({ syncStatus: 'synced' })],
    payments: [{
      id: 'payment-1', projectId: 'project-1', money: { amountMinor: 500000, currency: 'VND' },
      receivedAt: TWO_HOURS_LATER, kind: 'progressive', createdAt: TWO_HOURS_LATER, syncStatus: 'synced',
    }],
    goals: [{ id: 'goal-1', kind: 'hours_weekly', target: 10, createdAt: START, syncStatus: 'synced' }],
    ...overrides,
  }
}

test('deterministically closes an open terminal pause when a paused session is completed', () => {
  const state = fixture()
  state.sessions = [completedSession({
    pauses: [{ startedAt: ONE_HOUR_LATER }],
    activeDurationMs: 3_600_000,
  })]

  const normalized = normalizeState(state)
  assert.deepEqual(normalized.sessions[0].pauses, [{ startedAt: ONE_HOUR_LATER, endedAt: TWO_HOURS_LATER }])
  assert.equal(normalized.sessions[0].activeDurationMs, 3_600_000)
})

test('bootstraps an empty device from a cloud snapshot without echoing any outbox records', () => withRepository((repository, databasePath) => {
  const saved = repository.bootstrapRemoteSnapshot('auth-user-1', remoteBootstrapSnapshot())
  assert.equal(saved.account.id, 'auth-user-1')
  assert.equal(saved.account.authUserId, 'auth-user-1')
  assert.equal(saved.account.displayName, 'Minh from cloud')
  assert.equal(saved.projects[0].syncStatus, 'synced')
  assert.equal(saved.sessions[0].status, 'completed')
  assert.equal(saved.payments.length, 1)
  assert.equal(saved.goals.length, 1)
  assert.equal(saved.preferences.theme, 'dark')
  assert.equal(repository.getPullCursor(), 42)
  assert.deepEqual(repository.getSyncSummary(), { queued: 0, failed: 0, conflicts: 0 })

  repository.close()
  const reopened = new LocalStateRepository(databasePath)
  try {
    assert.equal(reopened.loadState().account?.authUserId, 'auth-user-1')
    assert.equal(reopened.getPullCursor(), 42)
    assert.equal(reopened.getQueuedOperations(50).length, 0)
  } finally {
    reopened.close()
  }
}))

test('refuses cloud bootstrap when the snapshot contains an active remote timer or local setup already exists', () => withRepository((repository) => {
  const unsafe = remoteBootstrapSnapshot({ sessions: [activeSession({ syncStatus: 'synced' })] })
  expectIntegrity(() => repository.bootstrapRemoteSnapshot('auth-user-1', unsafe), 'REMOTE_ACTIVE_TIMER_IGNORED')
  assert.equal(repository.loadState().account, null)

  repository.replaceState(fixture())
  expectIntegrity(() => repository.bootstrapRemoteSnapshot('auth-user-2', remoteBootstrapSnapshot()), 'BOOTSTRAP_REQUIRES_EMPTY_LOCAL_STATE')
}))

test('rejects duplicate active sessions without mutating the previously durable timer', () => withRepository((repository) => {
  const state = fixture()
  repository.replaceState(state)

  const invalid = clone(state)
  invalid.sessions.push(activeSession({
    id: 'session-2',
    status: 'paused',
    pauses: [{ startedAt: ONE_HOUR_LATER }],
    updatedAt: ONE_HOUR_LATER,
  }))
  expectIntegrity(() => repository.replaceState(invalid), 'MULTIPLE_ACTIVE_SESSIONS')

  const stored = repository.loadState()
  assert.equal(stored.sessions.length, 1)
  assert.equal(stored.sessions[0].id, 'session-1')
  assert.equal(stored.sessions[0].status, 'running')
}))

test('rejects malformed duration and pause intervals rather than rewriting completed history', () => withRepository((repository) => {
  const valid = fixture()
  valid.sessions = [completedSession()]
  repository.replaceState(valid)

  const durationMismatch = clone(valid)
  durationMismatch.sessions[0].activeDurationMs = 1
  expectIntegrity(() => repository.replaceState(durationMismatch), 'DURATION_MISMATCH')

  const overlappingPauses = clone(valid)
  overlappingPauses.sessions[0] = completedSession({
    pauses: [
      { startedAt: ONE_HOUR_LATER, endedAt: THREE_HOURS_LATER },
      { startedAt: TWO_HOURS_LATER, endedAt: FOUR_HOURS_LATER },
    ],
    endedAt: FOUR_HOURS_LATER,
    activeDurationMs: 0,
    updatedAt: FOUR_HOURS_LATER,
  })
  expectIntegrity(() => repository.replaceState(overlappingPauses), 'OVERLAPPING_PAUSES')

  const stored = repository.loadState().sessions[0]
  assert.equal(stored.activeDurationMs, 7_200_000)
  assert.equal(stored.earnings.amountMinor, 500000)
}))

test('rejects completing a project while its session remains active', () => withRepository((repository) => {
  const invalid = fixture()
  invalid.projects[0] = {
    ...invalid.projects[0],
    status: 'completed',
    completedAt: ONE_HOUR_LATER,
    updatedAt: ONE_HOUR_LATER,
  }
  expectIntegrity(() => repository.replaceState(invalid), 'COMPLETED_PROJECT_HAS_ACTIVE_SESSION')
  assert.equal(repository.loadState().account, null)
}))

test('queues a completed session once, updates its sync status after acknowledgement, and survives restart', () => withRepository((repository, databasePath) => {
  const state = fixture()
  repository.replaceState(state)
  state.sessions = [completedSession()]
  repository.replaceState(state)
  repository.replaceState(state)

  const operation = operationFor(repository, 'work_session', 'session-1')
  assert.equal(repository.getQueuedOperations(500).filter((item) => item.entityType === 'work_session').length, 1)
  assert.equal(repository.markOperationSynced(operation.id), true)
  assert.equal(repository.loadState().sessions[0].syncStatus, 'synced')

  repository.close()
  const reopened = new LocalStateRepository(databasePath)
  try {
    const saved = reopened.loadState()
    assert.equal(saved.sessions[0].status, 'completed')
    assert.equal(saved.sessions[0].earnings.amountMinor, 500000)
    assert.equal(saved.sessions[0].pauses.length, 0)
  } finally {
    reopened.close()
  }
}))

test('allows discarding an unfinished session but never emits a cloud delete for it', () => withRepository((repository) => {
  const state = fixture()
  repository.replaceState(state)
  state.sessions = []
  repository.replaceState(state)

  assert.equal(repository.loadState().sessions.length, 0)
  assert.equal(repository.getQueuedOperations(500).some((item) => item.entityType === 'work_session'), false)
}))

test('locks completed history against deletion and edits to an older completed session', () => withRepository((repository) => {
  const state = fixture()
  state.sessions = [
    completedSession({ id: 'older', endedAt: TWO_HOURS_LATER, updatedAt: TWO_HOURS_LATER }),
    completedSession({ id: 'latest', startedAt: THREE_HOURS_LATER, endedAt: FOUR_HOURS_LATER, activeDurationMs: 3_600_000, createdAt: THREE_HOURS_LATER, updatedAt: FOUR_HOURS_LATER }),
  ]
  repository.replaceState(state)

  const editedOlder = clone(state)
  editedOlder.sessions[0].note = 'changed'
  editedOlder.sessions[0].updatedAt = FOUR_HOURS_LATER
  expectIntegrity(() => repository.replaceState(editedOlder), 'HISTORICAL_SESSION_LOCKED')

  const deleted = clone(state)
  deleted.sessions = [deleted.sessions[1]]
  expectIntegrity(() => repository.replaceState(deleted), 'COMPLETED_SESSION_DELETE_FORBIDDEN')

  const stored = repository.loadState().sessions
  assert.equal(stored.length, 2)
  assert.equal(stored.find((session) => session.id === 'older').note, undefined)
}))

test('blocks a project deletion that would rewrite linked session or payment history', () => withRepository((repository) => {
  const state = fixture()
  state.sessions = [completedSession()]
  repository.replaceState(state)

  const invalid = clone(state)
  invalid.projects = []
  invalid.sessions[0].projectId = undefined
  expectIntegrity(() => repository.replaceState(invalid), 'PROJECT_DELETE_HAS_HISTORY')
  assert.equal(repository.loadState().projects.length, 1)
}))

test('coalesces unsynced operations by entity while retaining the newest payload', () => withRepository((repository) => {
  const state = fixture()
  repository.replaceState(state)

  const updated = clone(state)
  updated.projects[0].name = 'Website v2'
  updated.projects[0].updatedAt = ONE_HOUR_LATER
  repository.replaceState(updated)

  const projectOperations = repository.getQueuedOperations(500).filter((item) => item.entityType === 'project' && item.entityId === 'project-1')
  assert.equal(projectOperations.length, 1)
  assert.equal(projectOperations[0].payload.name, 'Website v2')
  assert.equal(repository.db.prepare("SELECT COUNT(*) AS total FROM sync_outbox WHERE entity_type = 'project' AND entity_id = 'project-1'").get().total, 1)
}))

test('orders account setup before preferences even when claiming requeues the account later', () => withRepository((repository) => {
  const state = fixture()
  repository.replaceState(state)
  // Linking changes the account payload and coalesces/reinserts only that
  // operation. Preferences retain their earlier timestamp, so chronological
  // ordering alone would send the dependent preference first.
  state.account.authUserId = 'auth-user-1'
  repository.replaceState(state)

  const queue = repository.getQueuedOperations(50)
  assert.equal(queue[0].entityType, 'account')
  assert.equal(queue.at(-1).entityType, 'preferences')
}))

test('uses a fresh idempotency key when an entity returns to a previously synced payload', () => withRepository((repository) => {
  const state = fixture()
  state.sessions = []
  repository.replaceState(state)
  const firstUpsert = operationFor(repository, 'project', 'project-1')
  repository.markOperationSynced(firstUpsert.id)

  const removed = clone(state)
  removed.projects = []
  repository.replaceState(removed)
  const deleteOperation = operationFor(repository, 'project', 'project-1')
  assert.equal(deleteOperation.operation, 'delete')
  repository.markOperationSynced(deleteOperation.id)

  repository.replaceState(state)
  const secondUpsert = operationFor(repository, 'project', 'project-1')
  assert.equal(secondUpsert.operation, 'upsert')
  assert.notEqual(secondUpsert.idempotencyKey, firstUpsert.idempotencyKey)
  assert.equal(repository.db.prepare("SELECT COUNT(*) AS total FROM sync_outbox WHERE entity_type = 'project' AND entity_id = 'project-1'").get().total, 3)
}))

test('backs off failed operations, keeps them retryable, and reflects the current entity error state', () => withRepository((repository) => {
  const state = fixture()
  state.sessions = [completedSession()]
  repository.replaceState(state)
  const operation = operationFor(repository, 'work_session', 'session-1')

  assert.equal(repository.markOperationFailed(operation.id, 'Network unavailable'), true)
  assert.equal(repository.getSyncSummary().failed, 1)
  assert.equal(repository.getQueuedOperations(500).some((item) => item.id === operation.id), false)
  assert.equal(repository.loadState().sessions[0].syncStatus, 'error')

  repository.db.prepare("UPDATE sync_outbox SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(operation.id)
  const retry = repository.getQueuedOperations(500).find((item) => item.id === operation.id)
  assert.equal(retry.attempts, 1)
  assert.equal(retry.status, 'error')

  repository.markOperationSynced(operation.id)
  assert.equal(repository.loadState().sessions[0].syncStatus, 'synced')
}))

test('database guards reject a second active timer even when bypassing snapshot normalization', () => withRepository((repository) => {
  repository.replaceState(fixture())
  assert.throws(() => repository.db.prepare([
    'INSERT INTO work_sessions (id, account_id, project_id, started_at, ended_at, timezone, active_duration_ms, status, earnings_amount_minor, earnings_currency, note, created_at, updated_at, sync_status, data_hash)',
    "VALUES ('session-2', 'user-1', 'project-1', '2026-08-10T01:00:00.000Z', NULL, 'Asia/Saigon', NULL, 'running', NULL, NULL, NULL, '2026-08-10T01:00:00.000Z', '2026-08-10T01:00:00.000Z', 'local', 'direct-write')",
  ].join(' ')).run())
  assert.equal(repository.loadState().sessions.length, 1)
}))

test('requires an explicit empty state before clearing an existing account', () => withRepository((repository) => {
  repository.replaceState(fixture())
  const invalid = emptyState()
  invalid.projects = [{
    id: 'orphan-project',
    name: 'Should fail',
    paymentModel: 'progressive',
    color: '#000000',
    icon: 'x',
    status: 'active',
    createdAt: START,
    updatedAt: START,
    syncStatus: 'local',
  }]
  expectIntegrity(() => repository.replaceState(invalid), 'ORPHANED_STATE')

  const cleared = repository.replaceState(emptyState())
  assert.equal(cleared.account, null)
  assert.equal(repository.getSyncSummary().queued, 0)
}))

test('persists a pull cursor and applies a remote entity without creating an outbox echo', () => withRepository((repository, databasePath) => {
  repository.replaceState(fixture())
  markAllOperationsSynced(repository)

  const result = repository.applyRemoteChanges([{
    cursor: 41,
    entity_type: 'project',
    entity_id: 'project-1',
    operation: 'upsert',
    payload: remoteProject(),
  }])
  assert.deepEqual(result, { cursor: 41, applied: 1, conflicts: 0 })
  assert.equal(repository.getPullCursor(), 41)
  assert.equal(repository.loadState().projects[0].name, 'Website from another device')
  assert.equal(repository.getQueuedOperations(500).length, 0)
  assert.equal(repository.loadState().projects[0].syncStatus, 'synced')

  repository.close()
  const reopened = new LocalStateRepository(databasePath)
  try {
    assert.equal(reopened.getPullCursor(), 41)
    assert.equal(reopened.loadState().projects[0].name, 'Website from another device')
  } finally {
    reopened.close()
  }
}))

test('records a conflict and retains a locally pending change instead of overwriting it', () => withRepository((repository) => {
  const state = fixture()
  repository.replaceState(state)
  markAllOperationsSynced(repository)

  const localEdit = clone(state)
  localEdit.projects[0].name = 'Local pending name'
  localEdit.projects[0].updatedAt = TWO_HOURS_LATER
  repository.replaceState(localEdit)

  const result = repository.applyRemoteChanges([{
    cursor: 42,
    entityType: 'project',
    entityId: 'project-1',
    operation: 'upsert',
    payload: remoteProject({ name: 'Remote conflicting name', updatedAt: THREE_HOURS_LATER }),
  }])
  assert.deepEqual(result, { cursor: 42, applied: 0, conflicts: 1 })
  assert.equal(repository.loadState().projects[0].name, 'Local pending name')
  assert.equal(repository.getPullCursor(), 42)
  assert.equal(repository.getQueuedOperations(500).filter((item) => item.entityType === 'project').length, 0, 'an open conflict pauses the losing local operation')
  assert.equal(repository.db.prepare("SELECT COUNT(*) AS total FROM sync_outbox WHERE entity_type = 'project' AND status IN ('queued', 'error')").get().total, 1)
  const [conflict] = repository.getSyncConflicts()
  assert.equal(conflict.reason, 'local_pending_change')
  assert.equal(conflict.entityId, 'project-1')
  assert.equal(conflict.localPayload.name, 'Local pending name')
  assert.equal(conflict.remotePayload.name, 'Remote conflicting name')
  assert.equal(repository.getSyncSummary().conflicts, 1)
}))

test('accepts the stored cloud project version and cancels the losing local operation atomically', () => withRepository((repository) => {
  const state = fixture()
  repository.replaceState(state)
  markAllOperationsSynced(repository)

  const localEdit = clone(state)
  localEdit.projects[0].name = 'Local pending name'
  localEdit.projects[0].updatedAt = TWO_HOURS_LATER
  repository.replaceState(localEdit)

  repository.applyRemoteChanges([{
    cursor: 44,
    entityType: 'project',
    entityId: 'project-1',
    operation: 'upsert',
    payload: remoteProject({ name: 'Remote accepted name', updatedAt: THREE_HOURS_LATER }),
  }])
  const [conflict] = repository.getSyncConflicts()
  assert.ok(conflict)
  assert.equal(repository.getQueuedOperations(500).filter((item) => item.entityType === 'project').length, 0, 'the local operation remains durable but is paused until a decision')
  assert.equal(repository.db.prepare("SELECT COUNT(*) AS total FROM sync_outbox WHERE entity_type = 'project' AND status IN ('queued', 'error')").get().total, 1)

  const accepted = repository.acceptRemoteSyncConflict(conflict.id)
  assert.deepEqual(accepted, {
    accepted: true,
    applied: true,
    entityType: 'project',
    entityId: 'project-1',
    operation: 'upsert',
    cancelledOperations: 1,
  })
  assert.equal(repository.loadState().projects[0].name, 'Remote accepted name')
  assert.equal(repository.loadState().projects[0].syncStatus, 'synced')
  assert.equal(repository.getQueuedOperations(500).filter((item) => item.entityType === 'project').length, 0)
  assert.equal(repository.getSyncConflicts().length, 0)
  assert.equal(repository.getSyncConflicts({ includeResolved: true })[0].resolution, 'resolved')
  assert.deepEqual(repository.getSyncSummary(), { queued: 0, failed: 0, conflicts: 0 })
  assert.deepEqual(repository.acceptRemoteSyncConflict(conflict.id), { accepted: false, reason: 'conflict_not_open' })
}))

test('refuses a cloud conflict that would let a remote timer control the local timer', () => withRepository((repository) => {
  repository.replaceState(fixture())
  markAllOperationsSynced(repository)

  repository.applyRemoteChanges([{
    cursor: 45,
    entityType: 'work_session',
    entityId: 'session-1',
    operation: 'upsert',
    payload: { id: 'session-1', status: 'paused' },
  }])
  const [conflict] = repository.getSyncConflicts()
  assert.equal(conflict.reason, 'remote_active_timer_ignored')

  assert.deepEqual(repository.acceptRemoteSyncConflict(conflict.id), {
    accepted: false,
    reason: 'remote_active_timer_ignored',
  })
  assert.equal(repository.loadState().sessions[0].status, 'running')
  assert.equal(repository.getSyncConflicts()[0].id, conflict.id)
  assert.equal(repository.getSyncConflicts()[0].resolution, 'open')
}))

test('refuses a cloud conflict that would delete protected completed history', () => withRepository((repository) => {
  const state = fixture()
  state.sessions = [completedSession()]
  repository.replaceState(state)
  markAllOperationsSynced(repository)

  repository.applyRemoteChanges([{
    cursor: 46,
    entityType: 'work_session',
    entityId: 'session-1',
    operation: 'delete',
    payload: {},
  }])
  const [conflict] = repository.getSyncConflicts()
  assert.equal(conflict.reason, 'remote_completed_session_delete_forbidden')

  assert.deepEqual(repository.acceptRemoteSyncConflict(conflict.id), {
    accepted: false,
    reason: 'remote_completed_session_delete_forbidden',
  })
  assert.equal(repository.loadState().sessions.length, 1)
  assert.equal(repository.loadState().sessions[0].status, 'completed')
  assert.equal(repository.getSyncConflicts()[0].id, conflict.id)
  assert.equal(repository.getSyncConflicts()[0].resolution, 'open')
}))

test('advances the pull cursor but never lets a remote change control an active timer', () => withRepository((repository) => {
  repository.replaceState(fixture())
  markAllOperationsSynced(repository)

  const result = repository.applyRemoteChanges([{
    cursor: 43,
    entityType: 'work_session',
    entityId: 'session-1',
    operation: 'upsert',
    payload: { id: 'session-1', status: 'paused' },
  }])
  assert.deepEqual(result, { cursor: 43, applied: 0, conflicts: 1 })
  assert.equal(repository.getPullCursor(), 43)
  assert.equal(repository.loadState().sessions[0].status, 'running')
  assert.equal(repository.getSyncConflicts()[0].reason, 'remote_active_timer_ignored')
}))
