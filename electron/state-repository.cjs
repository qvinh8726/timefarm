const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const APP_STATE_VERSION = 1
const PROJECT_STATUSES = new Set(['active', 'paused', 'completed'])
const SESSION_STATUSES = new Set(['running', 'paused', 'completed'])
const SYNC_STATUSES = new Set(['local', 'queued', 'synced', 'error'])
const PAYMENT_MODELS = new Set(['per_session', 'on_completion', 'progressive'])
const PAYMENT_KINDS = new Set(['completion', 'progressive'])
const GOAL_KINDS = new Set(['hours_daily', 'hours_weekly', 'earnings_daily', 'earnings_weekly', 'earnings_monthly', 'projects_completed'])
const DASHBOARD_WIDGETS = new Set(['timer', 'goals', 'earningsTrend', 'hoursTrend', 'projectBreakdown', 'rateTrend', 'cumulativeEarnings', 'comparison'])
const DASHBOARD_SIZES = new Set(['small', 'medium', 'large'])
const SYNC_ENTITY_TYPES = new Set(['account', 'project', 'work_session', 'payment', 'goal', 'preferences'])
const SYNC_OPERATIONS = new Set(['upsert', 'delete'])

class StateIntegrityError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'StateIntegrityError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) {
  throw new StateIntegrityError(code, message, details)
}

function emptyState() {
  return {
    version: APP_STATE_VERSION,
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

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function stableJson(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  return '{' + Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + stableJson(value[key]))
    .join(',') + '}'
}

function hash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex')
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200
}

function requireId(value, field) {
  if (!validId(value)) fail('INVALID_ID', field + ' must be a non-empty identifier.')
  return value
}

function requireCollection(value, field) {
  if (!Array.isArray(value)) fail('INVALID_COLLECTION', field + ' must be an array.')
  return value
}

function requireRecord(value, field) {
  if (!isRecord(value)) fail('INVALID_RECORD', field + ' must be an object.')
  return value
}

function requireText(value, field, maxLength, { trim = true } = {}) {
  if (typeof value !== 'string') fail('INVALID_TEXT', field + ' must be text.')
  const text = trim ? value.trim() : value
  if (!text) fail('INVALID_TEXT', field + ' cannot be empty.')
  if (text.length > maxLength) fail('TEXT_TOO_LONG', field + ' exceeds its maximum length.')
  return text
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return undefined
  return requireText(value, field, maxLength)
}

function timestampMs(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_TIMESTAMP', field + ' must be an ISO timestamp.')
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) fail('INVALID_TIMESTAMP', field + ' must be a valid timestamp.')
  return milliseconds
}

function requiredTimestamp(value, field) {
  timestampMs(value, field)
  return value
}

function optionalTimestamp(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  return requiredTimestamp(value, field)
}

function timestampOr(value, fallback, field) {
  return value === undefined || value === null || value === '' ? fallback : requiredTimestamp(value, field)
}

function normalizeCurrency(value, fallback, field) {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  if (typeof candidate !== 'string' || !/^[A-Za-z]{3}$/.test(candidate.trim())) {
    fail('INVALID_CURRENCY', field + ' must be a three-letter currency code.')
  }
  return candidate.trim().toUpperCase()
}

function normalizeSyncStatus(value) {
  return SYNC_STATUSES.has(value) ? value : 'local'
}

function normalizeMoney(value, fallbackCurrency, field, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail('MISSING_MONEY', field + ' is required.')
    return undefined
  }
  requireRecord(value, field)
  if (!Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0) {
    fail('INVALID_MONEY', field + '.amountMinor must be a non-negative safe integer.')
  }
  return {
    amountMinor: value.amountMinor,
    currency: normalizeCurrency(value.currency, fallbackCurrency, field + '.currency'),
  }
}

function assertNoDuplicateIds(items, field) {
  const ids = new Set()
  for (const item of items) {
    if (ids.has(item.id)) fail('DUPLICATE_ID', field + ' contains duplicate id ' + item.id + '.', { id: item.id })
    ids.add(item.id)
  }
}

function normalizePauses(rawPauses, startedAt, field) {
  const sessionStart = timestampMs(startedAt, field + '.startedAt')
  const pauses = requireCollection(rawPauses, field + '.pauses').map((rawPause, index) => {
    requireRecord(rawPause, field + '.pauses[' + index + ']')
    const pauseStart = requiredTimestamp(rawPause.startedAt, field + '.pauses[' + index + '].startedAt')
    const pauseEnd = optionalTimestamp(rawPause.endedAt, field + '.pauses[' + index + '].endedAt')
    const startMs = timestampMs(pauseStart, field + '.pauses[' + index + '].startedAt')
    const endMs = pauseEnd ? timestampMs(pauseEnd, field + '.pauses[' + index + '].endedAt') : undefined
    if (startMs < sessionStart) fail('INVALID_PAUSE', field + '.pauses[' + index + '] starts before the session.')
    if (endMs !== undefined && endMs < startMs) fail('INVALID_PAUSE', field + '.pauses[' + index + '] ends before it starts.')
    return { startedAt: pauseStart, endedAt: pauseEnd, startMs, endMs }
  })

  let previousEnd = sessionStart
  let hasOpenPause = false
  for (let index = 0; index < pauses.length; index += 1) {
    const pause = pauses[index]
    if (pause.startMs < previousEnd) fail('OVERLAPPING_PAUSES', field + '.pauses overlap or are out of order.')
    if (hasOpenPause) fail('INVALID_PAUSE', field + '.pauses cannot follow an open pause.')
    if (pause.endMs === undefined) hasOpenPause = true
    else previousEnd = pause.endMs
  }
  return pauses
}

function calculatedActiveDuration(startMs, endMs, pauses) {
  let pausedMs = 0
  for (const pause of pauses) {
    const pauseEnd = pause.endMs === undefined ? endMs : pause.endMs
    pausedMs += Math.max(0, Math.min(endMs, pauseEnd) - Math.max(startMs, pause.startMs))
  }
  return Math.max(0, endMs - startMs - pausedMs)
}

function normalizePreferences(raw) {
  const preferences = raw === undefined || raw === null ? {} : requireRecord(raw, 'preferences')
  const hidden = preferences.dashboardHiddenWidgets === undefined
    ? []
    : requireCollection(preferences.dashboardHiddenWidgets, 'preferences.dashboardHiddenWidgets')
  const order = preferences.dashboardWidgetOrder === undefined
    ? []
    : requireCollection(preferences.dashboardWidgetOrder, 'preferences.dashboardWidgetOrder')
  const sizes = preferences.dashboardWidgetSizes === undefined
    ? {}
    : requireRecord(preferences.dashboardWidgetSizes, 'preferences.dashboardWidgetSizes')

  const normalizeWidgets = (widgets, field) => {
    const seen = new Set()
    return widgets.map((widget, index) => {
      if (typeof widget !== 'string' || !DASHBOARD_WIDGETS.has(widget)) {
        fail('INVALID_WIDGET', field + '[' + index + '] is not a supported dashboard widget.')
      }
      if (seen.has(widget)) fail('DUPLICATE_WIDGET', field + ' contains duplicate widget ' + widget + '.')
      seen.add(widget)
      return widget
    })
  }

  const widgetSizes = {}
  for (const [widget, size] of Object.entries(sizes)) {
    if (!DASHBOARD_WIDGETS.has(widget) || !DASHBOARD_SIZES.has(size)) {
      fail('INVALID_WIDGET_SIZE', 'preferences.dashboardWidgetSizes contains an invalid widget size.')
    }
    widgetSizes[widget] = size
  }

  return {
    theme: ['system', 'light', 'dark'].includes(preferences.theme) ? preferences.theme : 'system',
    miniTimerMode: ['interactive', 'view_only', 'hidden'].includes(preferences.miniTimerMode) ? preferences.miniTimerMode : 'hidden',
    dashboardHiddenWidgets: normalizeWidgets(hidden, 'preferences.dashboardHiddenWidgets'),
    dashboardWidgetOrder: normalizeWidgets(order, 'preferences.dashboardWidgetOrder'),
    dashboardWidgetSizes: widgetSizes,
  }
}

function normalizeState(raw) {
  if (!isRecord(raw)) fail('INVALID_STATE', 'The persisted state must be an object.')
  if (raw.version !== undefined && raw.version !== APP_STATE_VERSION) {
    fail('UNSUPPORTED_STATE_VERSION', 'The persisted state version is not supported.', { version: raw.version })
  }

  const now = new Date().toISOString()
  const projectRows = requireCollection(raw.projects, 'projects')
  const sessionRows = requireCollection(raw.sessions, 'sessions')
  const paymentRows = requireCollection(raw.payments, 'payments')
  const goalRows = requireCollection(raw.goals, 'goals')

  let account = null
  if (raw.account !== null && raw.account !== undefined) {
    const source = requireRecord(raw.account, 'account')
    const createdAt = timestampOr(source.createdAt, now, 'account.createdAt')
    account = {
      id: requireId(source.id, 'account.id'),
      authUserId: source.authUserId === undefined || source.authUserId === null ? undefined : requireId(source.authUserId, 'account.authUserId'),
      displayName: source.displayName === undefined ? 'You' : requireText(source.displayName, 'account.displayName', 120),
      country: source.country === undefined ? 'VN' : requireText(source.country, 'account.country', 8),
      language: source.language === 'en' ? 'en' : 'vi',
      currency: normalizeCurrency(source.currency, 'VND', 'account.currency'),
      timezone: source.timezone === undefined ? 'UTC' : requireText(source.timezone, 'account.timezone', 120),
      createdAt,
    }
  }

  const fallbackCurrency = account?.currency ?? 'VND'
  const projects = projectRows.map((rawProject, index) => {
    const source = requireRecord(rawProject, 'projects[' + index + ']')
    const createdAt = timestampOr(source.createdAt, now, 'projects[' + index + '].createdAt')
    const updatedAt = timestampOr(source.updatedAt, createdAt, 'projects[' + index + '].updatedAt')
    const status = source.status === undefined ? 'active' : source.status
    if (!PROJECT_STATUSES.has(status)) fail('INVALID_PROJECT_STATUS', 'projects[' + index + '].status is invalid.')
    const completedAt = status === 'completed'
      ? timestampOr(source.completedAt, updatedAt, 'projects[' + index + '].completedAt')
      : optionalTimestamp(source.completedAt, 'projects[' + index + '].completedAt')
    return {
      id: requireId(source.id, 'projects[' + index + '].id'),
      name: requireText(source.name, 'projects[' + index + '].name', 250),
      paymentModel: PAYMENT_MODELS.has(source.paymentModel) ? source.paymentModel : 'per_session',
      expectedMoney: normalizeMoney(source.expectedMoney, fallbackCurrency, 'projects[' + index + '].expectedMoney'),
      note: optionalText(source.note, 'projects[' + index + '].note', 5000),
      color: source.color === undefined ? '#7c3aed' : requireText(source.color, 'projects[' + index + '].color', 32),
      icon: source.icon === undefined ? '✦' : requireText(source.icon, 'projects[' + index + '].icon', 16),
      status,
      completedAt,
      createdAt,
      updatedAt,
      syncStatus: normalizeSyncStatus(source.syncStatus),
    }
  })
  assertNoDuplicateIds(projects, 'projects')
  const projectIds = new Set(projects.map((project) => project.id))

  const sessions = sessionRows.map((rawSession, index) => {
    const source = requireRecord(rawSession, 'sessions[' + index + ']')
    const field = 'sessions[' + index + ']'
    const startedAt = requiredTimestamp(source.startedAt, field + '.startedAt')
    const startedMs = timestampMs(startedAt, field + '.startedAt')
    const status = source.status === undefined ? (source.endedAt ? 'completed' : 'running') : source.status
    if (!SESSION_STATUSES.has(status)) fail('INVALID_SESSION_STATUS', field + '.status is invalid.')
    const projectId = source.projectId === undefined || source.projectId === null ? undefined : requireId(source.projectId, field + '.projectId')
    if (projectId && !projectIds.has(projectId)) fail('UNKNOWN_PROJECT', field + '.projectId does not reference a local project.', { projectId })
    const pauses = normalizePauses(source.pauses === undefined ? [] : source.pauses, startedAt, field)
    const createdAt = timestampOr(source.createdAt, startedAt, field + '.createdAt')
    const updatedAt = timestampOr(source.updatedAt, source.endedAt ?? createdAt, field + '.updatedAt')
    let endedAt
    let activeDurationMs
    let earnings

    if (status === 'completed') {
      endedAt = requiredTimestamp(source.endedAt, field + '.endedAt')
      const endedMs = timestampMs(endedAt, field + '.endedAt')
      if (endedMs < startedMs) fail('INVALID_SESSION_RANGE', field + ' ends before it starts.')
      const openPauseIndex = pauses.findIndex((pause) => pause.endMs === undefined)
      if (openPauseIndex >= 0) {
        if (openPauseIndex !== pauses.length - 1) fail('INVALID_PAUSE', field + ' has an invalid open pause.')
        pauses[openPauseIndex] = { ...pauses[openPauseIndex], endedAt, endMs: endedMs }
      }
      for (const pause of pauses) {
        if (pause.endMs > endedMs) fail('INVALID_PAUSE', field + ' contains a pause after the session ended.')
      }
      const calculatedDuration = calculatedActiveDuration(startedMs, endedMs, pauses)
      if (source.activeDurationMs !== undefined && source.activeDurationMs !== null) {
        if (!Number.isSafeInteger(source.activeDurationMs) || source.activeDurationMs < 0) {
          fail('INVALID_DURATION', field + '.activeDurationMs must be a non-negative safe integer.')
        }
        if (source.activeDurationMs !== calculatedDuration) {
          fail('DURATION_MISMATCH', field + '.activeDurationMs does not match the persisted timestamps and pauses.')
        }
      }
      activeDurationMs = source.activeDurationMs ?? calculatedDuration
      earnings = normalizeMoney(source.earnings, fallbackCurrency, field + '.earnings', { required: true })
    } else {
      if (source.endedAt !== undefined && source.endedAt !== null && source.endedAt !== '') {
        fail('INVALID_ACTIVE_SESSION', field + ' cannot have an end time before completion.')
      }
      if (source.activeDurationMs !== undefined && source.activeDurationMs !== null) {
        fail('INVALID_ACTIVE_SESSION', field + ' cannot have a frozen duration before completion.')
      }
      if (source.earnings !== undefined && source.earnings !== null) {
        fail('INVALID_ACTIVE_SESSION', field + ' cannot have earnings before completion.')
      }
      const openPauseCount = pauses.filter((pause) => pause.endMs === undefined).length
      if (status === 'running' && openPauseCount !== 0) fail('INVALID_RUNNING_SESSION', field + ' has an open pause while running.')
      if (status === 'paused' && openPauseCount !== 1) fail('INVALID_PAUSED_SESSION', field + ' must have exactly one open pause.')
    }

    return {
      id: requireId(source.id, field + '.id'),
      projectId,
      startedAt,
      endedAt,
      timezone: source.timezone === undefined ? (account?.timezone ?? 'UTC') : requireText(source.timezone, field + '.timezone', 120),
      pauses: pauses.map((pause) => ({ startedAt: pause.startedAt, endedAt: pause.endedAt })),
      activeDurationMs,
      status,
      earnings,
      note: optionalText(source.note, field + '.note', 5000),
      createdAt,
      updatedAt,
      syncStatus: normalizeSyncStatus(source.syncStatus),
    }
  })
  assertNoDuplicateIds(sessions, 'sessions')

  const payments = paymentRows.map((rawPayment, index) => {
    const source = requireRecord(rawPayment, 'payments[' + index + ']')
    const field = 'payments[' + index + ']'
    const projectId = requireId(source.projectId, field + '.projectId')
    if (!projectIds.has(projectId)) fail('UNKNOWN_PROJECT', field + '.projectId does not reference a local project.', { projectId })
    const kind = source.kind === undefined ? 'progressive' : source.kind
    if (!PAYMENT_KINDS.has(kind)) fail('INVALID_PAYMENT_KIND', field + '.kind is invalid.')
    const receivedAt = timestampOr(source.receivedAt, now, field + '.receivedAt')
    return {
      id: requireId(source.id, field + '.id'),
      projectId,
      money: normalizeMoney(source.money, fallbackCurrency, field + '.money', { required: true }),
      receivedAt,
      kind,
      note: optionalText(source.note, field + '.note', 5000),
      createdAt: timestampOr(source.createdAt, receivedAt, field + '.createdAt'),
      syncStatus: normalizeSyncStatus(source.syncStatus),
    }
  })
  assertNoDuplicateIds(payments, 'payments')

  const goals = goalRows.map((rawGoal, index) => {
    const source = requireRecord(rawGoal, 'goals[' + index + ']')
    const field = 'goals[' + index + ']'
    if (!GOAL_KINDS.has(source.kind)) fail('INVALID_GOAL_KIND', field + '.kind is invalid.')
    if (!Number.isFinite(source.target) || source.target <= 0) fail('INVALID_GOAL_TARGET', field + '.target must be greater than zero.')
    return {
      id: requireId(source.id, field + '.id'),
      kind: source.kind,
      target: source.target,
      createdAt: timestampOr(source.createdAt, now, field + '.createdAt'),
      syncStatus: normalizeSyncStatus(source.syncStatus),
    }
  })
  assertNoDuplicateIds(goals, 'goals')

  const state = {
    version: APP_STATE_VERSION,
    account,
    projects,
    sessions,
    payments,
    goals,
    preferences: normalizePreferences(raw.preferences),
  }

  if (!account && (projects.length || sessions.length || payments.length || goals.length)) {
    fail('ORPHANED_STATE', 'A state without an account cannot contain business records.')
  }

  assertStateIntegrity(state)
  return state
}

function assertStateIntegrity(state) {
  const activeSessions = state.sessions.filter((session) => session.status === 'running' || session.status === 'paused')
  if (activeSessions.length > 1) {
    fail('MULTIPLE_ACTIVE_SESSIONS', 'Only one running or paused session can exist at a time.', { sessionIds: activeSessions.map((session) => session.id) })
  }
  const activeProjectIds = new Set(activeSessions.map((session) => session.projectId).filter(Boolean))
  const completedWithActiveWork = state.projects.find((project) => project.status === 'completed' && activeProjectIds.has(project.id))
  if (completedWithActiveWork) {
    fail('COMPLETED_PROJECT_HAS_ACTIVE_SESSION', 'A completed project cannot have an active session.', { projectId: completedWithActiveWork.id })
  }
}

function canonicalAccount(account) {
  return { id: account.id, authUserId: account.authUserId, displayName: account.displayName, country: account.country, language: account.language, currency: account.currency, timezone: account.timezone, createdAt: account.createdAt }
}

function canonicalProject(project) {
  return { id: project.id, name: project.name, paymentModel: project.paymentModel, expectedMoney: project.expectedMoney, note: project.note, color: project.color, icon: project.icon, status: project.status, completedAt: project.completedAt, createdAt: project.createdAt, updatedAt: project.updatedAt }
}

function canonicalSession(session) {
  return { id: session.id, projectId: session.projectId, startedAt: session.startedAt, endedAt: session.endedAt, timezone: session.timezone, pauses: session.pauses, activeDurationMs: session.activeDurationMs, status: session.status, earnings: session.earnings, note: session.note, createdAt: session.createdAt, updatedAt: session.updatedAt }
}

function canonicalPayment(payment) {
  return { id: payment.id, projectId: payment.projectId, money: payment.money, receivedAt: payment.receivedAt, kind: payment.kind, note: payment.note, createdAt: payment.createdAt }
}

function canonicalGoal(goal) {
  return { id: goal.id, kind: goal.kind, target: goal.target, createdAt: goal.createdAt }
}

function canonicalPreferences(preferences) {
  return {
    theme: preferences.theme,
    miniTimerMode: preferences.miniTimerMode,
    dashboardHiddenWidgets: preferences.dashboardHiddenWidgets,
    dashboardWidgetOrder: preferences.dashboardWidgetOrder,
    dashboardWidgetSizes: preferences.dashboardWidgetSizes,
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizePullCursor(value) {
  const numeric = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN)
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    fail('INVALID_PULL_CURSOR', 'A remote sync cursor must be a non-negative safe integer.')
  }
  return numeric
}

function normalizeRemoteChange(raw, index = 0) {
  const field = 'remoteChanges[' + index + ']'
  requireRecord(raw, field)
  const cursor = normalizePullCursor(raw.cursor)
  const entityType = raw.entityType ?? raw.entity_type
  const entityId = raw.entityId ?? raw.entity_id
  const operation = raw.operation
  const payload = raw.payload === undefined || raw.payload === null ? {} : raw.payload
  if (!SYNC_ENTITY_TYPES.has(entityType)) fail('INVALID_REMOTE_ENTITY_TYPE', field + '.entityType is not supported.')
  requireId(entityId, field + '.entityId')
  if (!SYNC_OPERATIONS.has(operation)) fail('INVALID_REMOTE_OPERATION', field + '.operation is not supported.')
  if (!isRecord(payload)) fail('INVALID_REMOTE_PAYLOAD', field + '.payload must be an object.')
  return { cursor, entityType, entityId, operation, payload }
}

// A new device cannot safely create a placeholder profile and then push it
// before it has seen the cloud account.  The authenticated bootstrap RPC
// returns a complete, canonical snapshot instead.  Keep the conversion here
// (rather than in the renderer) so every value still passes through the same
// strict local-state validation used for normal persistence and pull.
function normalizeRemoteBootstrap(rawAuthUserId, rawSnapshot) {
  const authUserId = requireId(rawAuthUserId, 'authUserId')
  const snapshot = requireRecord(rawSnapshot, 'remoteSnapshot')
  const profile = requireRecord(snapshot.profile, 'remoteSnapshot.profile')
  const cursor = normalizePullCursor(snapshot.cursor ?? 0)
  requiredTimestamp(profile.createdAt, 'remoteSnapshot.profile.createdAt')

  const state = normalizeState({
    version: APP_STATE_VERSION,
    account: {
      // The cloud profile is keyed by the authenticated subject.  Reusing the
      // same id locally makes account/preference sync identity unambiguous
      // while existing first-device databases remain supported unchanged.
      id: authUserId,
      authUserId,
      displayName: profile.displayName,
      country: profile.country,
      language: profile.language,
      currency: profile.currency,
      timezone: profile.timezone,
      createdAt: profile.createdAt,
      syncStatus: 'synced',
    },
    projects: snapshot.projects,
    sessions: snapshot.sessions,
    payments: snapshot.payments,
    goals: snapshot.goals,
    preferences: snapshot.preferences,
  })

  // Remote active timers are deliberately never imported: a timer can only be
  // owned by the device that created it and reconciled through a lease.
  if (state.sessions.some((session) => session.status !== 'completed')) {
    fail('REMOTE_ACTIVE_TIMER_IGNORED', 'A cloud bootstrap cannot import a running or paused timer.')
  }
  return { state, cursor }
}

function canonicalEntityFromState(state, entityType, entityId) {
  if (!state.account) return undefined
  if (entityType === 'account') return canonicalAccount(state.account)
  if (entityType === 'preferences') return canonicalPreferences(state.preferences)
  const collectionByType = {
    project: ['projects', canonicalProject],
    work_session: ['sessions', canonicalSession],
    payment: ['payments', canonicalPayment],
    goal: ['goals', canonicalGoal],
  }
  const target = collectionByType[entityType]
  if (!target) return undefined
  const item = state[target[0]].find((candidate) => candidate.id === entityId)
  return item ? target[1](item) : undefined
}

class LocalStateRepository {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.databasePath = databasePath
    this.db = new DatabaseSync(databasePath)
    this.closed = false
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
    this.migrate()
  }

  migrate() {
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS accounts (",
      "  id TEXT PRIMARY KEY, auth_user_id TEXT UNIQUE, display_name TEXT NOT NULL, country TEXT NOT NULL, language TEXT NOT NULL,",
      "  currency TEXT NOT NULL, timezone TEXT NOT NULL, created_at TEXT NOT NULL,",
      "  sync_status TEXT NOT NULL DEFAULT 'local', data_hash TEXT NOT NULL,",
      "  CHECK (language IN ('vi', 'en')), CHECK (length(currency) = 3)",
      ");",
      "CREATE TABLE IF NOT EXISTS projects (",
      "  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,",
      "  name TEXT NOT NULL, payment_model TEXT NOT NULL, expected_amount_minor INTEGER, expected_currency TEXT,",
      "  note TEXT, color TEXT NOT NULL, icon TEXT NOT NULL, status TEXT NOT NULL, completed_at TEXT,",
      "  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'local', data_hash TEXT NOT NULL,",
      "  CHECK (payment_model IN ('per_session', 'on_completion', 'progressive')),",
      "  CHECK (status IN ('active', 'paused', 'completed')),",
      "  CHECK (status <> 'completed' OR completed_at IS NOT NULL),",
      "  CHECK (expected_amount_minor IS NULL OR expected_amount_minor >= 0)",
      ");",
      "CREATE TABLE IF NOT EXISTS work_sessions (",
      "  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,",
      "  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, started_at TEXT NOT NULL, ended_at TEXT,",
      "  timezone TEXT NOT NULL, active_duration_ms INTEGER, status TEXT NOT NULL,",
      "  earnings_amount_minor INTEGER, earnings_currency TEXT, note TEXT,",
      "  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'local', data_hash TEXT NOT NULL,",
      "  CHECK (status IN ('running', 'paused', 'completed')),",
      "  CHECK (active_duration_ms IS NULL OR active_duration_ms >= 0),",
      "  CHECK (earnings_amount_minor IS NULL OR earnings_amount_minor >= 0),",
      "  CHECK ((status = 'completed' AND ended_at IS NOT NULL AND active_duration_ms IS NOT NULL AND earnings_amount_minor IS NOT NULL AND earnings_currency IS NOT NULL) OR",
      "         (status <> 'completed' AND ended_at IS NULL AND active_duration_ms IS NULL AND earnings_amount_minor IS NULL AND earnings_currency IS NULL))",
      ");",
      "CREATE TABLE IF NOT EXISTS session_pauses (",
      "  session_id TEXT NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE,",
      "  ordinal INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,",
      "  PRIMARY KEY (session_id, ordinal), CHECK (ordinal >= 0)",
      ");",
      "CREATE TABLE IF NOT EXISTS payments (",
      "  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,",
      "  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, amount_minor INTEGER NOT NULL,",
      "  currency TEXT NOT NULL, received_at TEXT NOT NULL, kind TEXT NOT NULL, note TEXT,",
      "  created_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'local', data_hash TEXT NOT NULL,",
      "  CHECK (amount_minor >= 0), CHECK (kind IN ('completion', 'progressive'))",
      ");",
      "CREATE TABLE IF NOT EXISTS goals (",
      "  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,",
      "  kind TEXT NOT NULL, target REAL NOT NULL, created_at TEXT NOT NULL,",
      "  sync_status TEXT NOT NULL DEFAULT 'local', data_hash TEXT NOT NULL,",
      "  CHECK (kind IN ('hours_daily', 'hours_weekly', 'earnings_daily', 'earnings_weekly', 'earnings_monthly', 'projects_completed')), CHECK (target > 0)",
      ");",
      "CREATE TABLE IF NOT EXISTS preferences (",
      "  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,",
      "  theme TEXT NOT NULL, mini_timer_mode TEXT NOT NULL, dashboard_hidden_widgets_json TEXT NOT NULL,",
      "  dashboard_widget_order_json TEXT NOT NULL DEFAULT '[]', dashboard_widget_sizes_json TEXT NOT NULL DEFAULT '{}',",
      "  data_hash TEXT NOT NULL",
      ");",
      "CREATE TABLE IF NOT EXISTS sync_outbox (",
      "  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,",
      "  operation TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL,",
       "  created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_attempt_at TEXT, status TEXT NOT NULL DEFAULT 'queued',",
       "  CHECK (operation IN ('upsert', 'delete')), CHECK (status IN ('queued', 'error', 'synced')), CHECK (attempts >= 0)",
       ");",
       "CREATE TABLE IF NOT EXISTS sync_metadata (",
       "  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,",
       "  pull_cursor INTEGER NOT NULL DEFAULT 0 CHECK (pull_cursor >= 0),",
       "  last_pulled_at TEXT, updated_at TEXT NOT NULL",
       ");",
       "CREATE TABLE IF NOT EXISTS sync_conflicts (",
       "  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,",
       "  remote_cursor INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL,",
       "  local_payload_json TEXT, remote_payload_json TEXT NOT NULL, reason TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}',",
       "  detected_at TEXT NOT NULL, resolution TEXT NOT NULL DEFAULT 'open', resolved_at TEXT,",
       "  UNIQUE(account_id, remote_cursor),",
       "  CHECK (operation IN ('upsert', 'delete')), CHECK (resolution IN ('open', 'resolved'))",
       ");",
       "CREATE INDEX IF NOT EXISTS idx_sessions_account_started ON work_sessions(account_id, started_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_projects_account ON projects(account_id);",
       "CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(status, created_at);",
       "CREATE INDEX IF NOT EXISTS idx_outbox_entity_pending ON sync_outbox(account_id, entity_type, entity_id, status);",
       "CREATE INDEX IF NOT EXISTS idx_sync_conflicts_account_open ON sync_conflicts(account_id, resolution, remote_cursor DESC);",
      "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));",
    ].join('\n'))

    this.ensureColumn('sync_outbox', 'next_attempt_at', 'TEXT')
    this.ensureColumn('accounts', 'auth_user_id', 'TEXT')
    this.ensureColumn('projects', 'completed_at', 'TEXT')
    this.ensureColumn('preferences', 'dashboard_widget_order_json', "TEXT NOT NULL DEFAULT '[]'")
    this.ensureColumn('preferences', 'dashboard_widget_sizes_json', "TEXT NOT NULL DEFAULT '{}'")
    this.createIntegrityTriggers()

    const duplicateActive = this.db.prepare("SELECT account_id FROM work_sessions WHERE status IN ('running', 'paused') GROUP BY account_id HAVING COUNT(*) > 1 LIMIT 1").get()
    if (!duplicateActive) {
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_session_per_account ON work_sessions(account_id) WHERE status IN ('running', 'paused');")
    }
    this.db.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'));")
    this.db.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'));")
  }

  ensureColumn(table, column, definition) {
    const columns = this.db.prepare('PRAGMA table_info(' + table + ')').all().map((item) => item.name)
    if (!columns.includes(column)) this.db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition + ';')
  }

  createIntegrityTriggers() {
    this.db.exec([
      "CREATE TRIGGER IF NOT EXISTS projects_guard_insert BEFORE INSERT ON projects BEGIN",
      "  SELECT CASE WHEN NEW.status NOT IN ('active', 'paused', 'completed') THEN RAISE(ABORT, 'invalid project status') END;",
      "  SELECT CASE WHEN NEW.status = 'completed' AND NEW.completed_at IS NULL THEN RAISE(ABORT, 'completed project needs completion timestamp') END;",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS projects_guard_update BEFORE UPDATE ON projects BEGIN",
      "  SELECT CASE WHEN NEW.status NOT IN ('active', 'paused', 'completed') THEN RAISE(ABORT, 'invalid project status') END;",
      "  SELECT CASE WHEN NEW.status = 'completed' AND NEW.completed_at IS NULL THEN RAISE(ABORT, 'completed project needs completion timestamp') END;",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS sessions_guard_insert BEFORE INSERT ON work_sessions BEGIN",
      "  SELECT CASE WHEN NEW.status NOT IN ('running', 'paused', 'completed') THEN RAISE(ABORT, 'invalid session status') END;",
      "  SELECT CASE WHEN NEW.ended_at IS NOT NULL AND julianday(NEW.ended_at) < julianday(NEW.started_at) THEN RAISE(ABORT, 'session ends before start') END;",
      "  SELECT CASE WHEN NEW.status = 'completed' AND (NEW.ended_at IS NULL OR NEW.active_duration_ms IS NULL OR NEW.earnings_amount_minor IS NULL OR NEW.earnings_currency IS NULL) THEN RAISE(ABORT, 'completed session is incomplete') END;",
      "  SELECT CASE WHEN NEW.status <> 'completed' AND (NEW.ended_at IS NOT NULL OR NEW.active_duration_ms IS NOT NULL OR NEW.earnings_amount_minor IS NOT NULL OR NEW.earnings_currency IS NOT NULL) THEN RAISE(ABORT, 'active session has completed fields') END;",
      "  SELECT CASE WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.account_id = NEW.account_id) THEN RAISE(ABORT, 'session project is not owned by account') END;",
      "  SELECT CASE WHEN NEW.status IN ('running', 'paused') AND EXISTS (SELECT 1 FROM work_sessions s WHERE s.account_id = NEW.account_id AND s.id <> NEW.id AND s.status IN ('running', 'paused')) THEN RAISE(ABORT, 'multiple active sessions') END;",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS sessions_guard_update BEFORE UPDATE ON work_sessions BEGIN",
      "  SELECT CASE WHEN NEW.status NOT IN ('running', 'paused', 'completed') THEN RAISE(ABORT, 'invalid session status') END;",
      "  SELECT CASE WHEN NEW.ended_at IS NOT NULL AND julianday(NEW.ended_at) < julianday(NEW.started_at) THEN RAISE(ABORT, 'session ends before start') END;",
      "  SELECT CASE WHEN NEW.status = 'completed' AND (NEW.ended_at IS NULL OR NEW.active_duration_ms IS NULL OR NEW.earnings_amount_minor IS NULL OR NEW.earnings_currency IS NULL) THEN RAISE(ABORT, 'completed session is incomplete') END;",
      "  SELECT CASE WHEN NEW.status <> 'completed' AND (NEW.ended_at IS NOT NULL OR NEW.active_duration_ms IS NOT NULL OR NEW.earnings_amount_minor IS NOT NULL OR NEW.earnings_currency IS NOT NULL) THEN RAISE(ABORT, 'active session has completed fields') END;",
      "  SELECT CASE WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.account_id = NEW.account_id) THEN RAISE(ABORT, 'session project is not owned by account') END;",
      "  SELECT CASE WHEN NEW.status IN ('running', 'paused') AND EXISTS (SELECT 1 FROM work_sessions s WHERE s.account_id = NEW.account_id AND s.id <> NEW.id AND s.status IN ('running', 'paused')) THEN RAISE(ABORT, 'multiple active sessions') END;",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS pauses_guard_insert BEFORE INSERT ON session_pauses BEGIN",
      "  SELECT CASE WHEN NEW.ended_at IS NOT NULL AND julianday(NEW.ended_at) < julianday(NEW.started_at) THEN RAISE(ABORT, 'pause ends before start') END;",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS pauses_guard_update BEFORE UPDATE ON session_pauses BEGIN",
      "  SELECT CASE WHEN NEW.ended_at IS NOT NULL AND julianday(NEW.ended_at) < julianday(NEW.started_at) THEN RAISE(ABORT, 'pause ends before start') END;",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS payments_guard_insert BEFORE INSERT ON payments BEGIN",
      "  SELECT CASE WHEN NEW.amount_minor < 0 THEN RAISE(ABORT, 'payment amount is negative') END;",
      "  SELECT CASE WHEN NEW.kind NOT IN ('completion', 'progressive') THEN RAISE(ABORT, 'invalid payment kind') END;",
      "  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.account_id = NEW.account_id) THEN RAISE(ABORT, 'payment project is not owned by account') END;",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS payments_guard_update BEFORE UPDATE ON payments BEGIN",
      "  SELECT CASE WHEN NEW.amount_minor < 0 THEN RAISE(ABORT, 'payment amount is negative') END;",
      "  SELECT CASE WHEN NEW.kind NOT IN ('completion', 'progressive') THEN RAISE(ABORT, 'invalid payment kind') END;",
      "  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.account_id = NEW.account_id) THEN RAISE(ABORT, 'payment project is not owned by account') END;",
      "END;",
    ].join('\n'))
  }

  hasAccount() {
    return Boolean(this.db.prepare('SELECT 1 AS present FROM accounts LIMIT 1').get())
  }

  importLegacyJson(legacyPath) {
    if (this.hasAccount() || !fs.existsSync(legacyPath)) return false
    try {
      const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf8'))
      this.replaceState(raw)
      return true
    } catch {
      return false
    }
  }

  queueOperation(accountId, entityType, entityId, operation, payload) {
    if (!['upsert', 'delete'].includes(operation)) fail('INVALID_OUTBOX_OPERATION', 'Unsupported outbox operation.')
    const payloadJson = stableJson(payload)
    const id = crypto.randomUUID()
    this.db.prepare("DELETE FROM sync_outbox WHERE account_id = ? AND entity_type = ? AND entity_id = ? AND status IN ('queued', 'error')")
      .run(accountId, entityType, entityId)
    this.db.prepare([
      'INSERT INTO sync_outbox (id, account_id, entity_type, entity_id, operation, idempotency_key, payload_json, created_at, status)',
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')",
    ].join(' ')).run(id, accountId, entityType, entityId, operation, id, payloadJson, new Date().toISOString())
    return id
  }

  replaceState(rawState) {
    const state = normalizeState(rawState)
    const currentAccount = this.db.prepare('SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1').get()
    if (state.account && currentAccount && currentAccount.id !== state.account.id) {
      fail('ACCOUNT_SWITCH_REQUIRES_RESET', 'Changing the local account requires an explicit local-data reset.', { currentAccountId: currentAccount.id, incomingAccountId: state.account.id })
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (!state.account) {
        this.db.exec('DELETE FROM sync_outbox; DELETE FROM accounts;')
        this.db.exec('COMMIT')
        return emptyState()
      }

      const account = state.account
      this.upsertAccount(account)
      this.syncProjects(account.id, state.projects)
      this.syncSessions(account.id, state.sessions)
      this.syncPayments(account.id, state.payments)
      this.syncGoals(account.id, state.goals)
      this.upsertPreferences(account.id, state.preferences)
      this.assertPersistedIntegrity(account.id)
      this.db.exec('COMMIT')
      return this.loadState()
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Atomically seeds an empty local database from an authenticated cloud
   * snapshot.  The regular writers are intentionally reused for their schema
   * and integrity checks, then their generated outbox rows are removed before
   * commit so a restored device can never echo or overwrite cloud history.
   */
  bootstrapRemoteSnapshot(rawAuthUserId, rawSnapshot) {
    if (this.hasAccount()) {
      fail('BOOTSTRAP_REQUIRES_EMPTY_LOCAL_STATE', 'Cloud bootstrap is only allowed before local account setup.')
    }
    const { state, cursor } = normalizeRemoteBootstrap(rawAuthUserId, rawSnapshot)
    const account = state.account
    this.db.exec('BEGIN IMMEDIATE')
    try {
      // A second process cannot normally share this database, but preserve the
      // empty-state invariant after the transaction lock is acquired as well.
      if (this.hasAccount()) {
        fail('BOOTSTRAP_REQUIRES_EMPTY_LOCAL_STATE', 'Cloud bootstrap is only allowed before local account setup.')
      }
      this.upsertAccount(account)
      this.syncProjects(account.id, state.projects)
      this.syncSessions(account.id, state.sessions)
      this.syncPayments(account.id, state.payments)
      this.syncGoals(account.id, state.goals)
      this.upsertPreferences(account.id, state.preferences)

      this.db.prepare('DELETE FROM sync_outbox WHERE account_id = ?').run(account.id)
      this.db.prepare('DELETE FROM sync_conflicts WHERE account_id = ?').run(account.id)
      this.db.prepare("UPDATE accounts SET sync_status = 'synced' WHERE id = ?").run(account.id)
      this.db.prepare("UPDATE projects SET sync_status = 'synced' WHERE account_id = ?").run(account.id)
      this.db.prepare("UPDATE work_sessions SET sync_status = 'synced' WHERE account_id = ?").run(account.id)
      this.db.prepare("UPDATE payments SET sync_status = 'synced' WHERE account_id = ?").run(account.id)
      this.db.prepare("UPDATE goals SET sync_status = 'synced' WHERE account_id = ?").run(account.id)
      this.updatePullMetadata(account.id, cursor)
      this.assertPersistedIntegrity(account.id)
      this.db.exec('COMMIT')
      return this.loadState()
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  assertPersistedIntegrity(accountId) {
    const active = this.db.prepare("SELECT id FROM work_sessions WHERE account_id = ? AND status IN ('running', 'paused') ORDER BY started_at DESC").all(accountId)
    if (active.length > 1) fail('MULTIPLE_ACTIVE_SESSIONS', 'The database contains multiple active sessions.', { sessionIds: active.map((row) => row.id) })
    const project = this.db.prepare([
      "SELECT p.id FROM projects p WHERE p.account_id = ? AND p.status = 'completed'",
      "AND EXISTS (SELECT 1 FROM work_sessions s WHERE s.project_id = p.id AND s.status IN ('running', 'paused')) LIMIT 1",
    ].join(' ')).get(accountId)
    if (project) fail('COMPLETED_PROJECT_HAS_ACTIVE_SESSION', 'A completed project cannot have an active session.', { projectId: project.id })
  }

  upsertAccount(account) {
    const payload = canonicalAccount(account)
    const dataHash = hash(payload)
    const existing = this.db.prepare('SELECT data_hash FROM accounts WHERE id = ?').get(account.id)
    if (existing?.data_hash === dataHash) return
    this.db.prepare([
      'INSERT INTO accounts (id, auth_user_id, display_name, country, language, currency, timezone, created_at, sync_status, data_hash)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      'ON CONFLICT(id) DO UPDATE SET auth_user_id=excluded.auth_user_id, display_name=excluded.display_name, country=excluded.country, language=excluded.language,',
      'currency=excluded.currency, timezone=excluded.timezone, sync_status=excluded.sync_status, data_hash=excluded.data_hash',
    ].join(' ')).run(account.id, account.authUserId ?? null, account.displayName, account.country, account.language, account.currency, account.timezone, account.createdAt, 'queued', dataHash)
    this.queueOperation(account.id, 'account', account.id, 'upsert', payload)
  }

  syncProjects(accountId, projects) {
    const existing = this.db.prepare('SELECT id, data_hash FROM projects WHERE account_id = ?').all(accountId)
    const existingById = new Map(existing.map((row) => [row.id, row]))
    const nextIds = new Set(projects.map((project) => project.id))
    for (const row of existing) {
      if (nextIds.has(row.id)) continue
      const hasHistory = this.db.prepare([
        'SELECT 1 AS present FROM work_sessions WHERE project_id = ? LIMIT 1',
      ].join(' ')).get(row.id) || this.db.prepare('SELECT 1 AS present FROM payments WHERE project_id = ? LIMIT 1').get(row.id)
      if (hasHistory) {
        fail('PROJECT_DELETE_HAS_HISTORY', 'A project with sessions or payments cannot be deleted through a state snapshot.', { projectId: row.id })
      }
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(row.id)
      this.queueOperation(accountId, 'project', row.id, 'delete', { id: row.id })
    }
    for (const project of projects) {
      const payload = canonicalProject(project)
      const dataHash = hash(payload)
      const old = existingById.get(project.id)
      if (old?.data_hash === dataHash) continue
      this.db.prepare([
        'INSERT INTO projects (id, account_id, name, payment_model, expected_amount_minor, expected_currency, note, color, icon, status, completed_at, created_at, updated_at, sync_status, data_hash)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(id) DO UPDATE SET name=excluded.name, payment_model=excluded.payment_model, expected_amount_minor=excluded.expected_amount_minor,',
        'expected_currency=excluded.expected_currency, note=excluded.note, color=excluded.color, icon=excluded.icon, status=excluded.status,',
        'completed_at=excluded.completed_at, updated_at=excluded.updated_at, sync_status=excluded.sync_status, data_hash=excluded.data_hash',
      ].join(' ')).run(project.id, accountId, project.name, project.paymentModel, project.expectedMoney?.amountMinor ?? null, project.expectedMoney?.currency ?? null, project.note ?? null, project.color, project.icon, project.status, project.completedAt ?? null, project.createdAt, project.updatedAt, 'queued', dataHash)
      this.queueOperation(accountId, 'project', project.id, 'upsert', payload)
    }
  }

  syncSessions(accountId, sessions) {
    const existing = this.db.prepare('SELECT id, data_hash, status FROM work_sessions WHERE account_id = ?').all(accountId)
    const existingById = new Map(existing.map((row) => [row.id, row]))
    const nextIds = new Set(sessions.map((session) => session.id))
    const latestCompletedId = [...sessions]
      .filter((session) => session.status === 'completed')
      .sort((left, right) => Date.parse(right.endedAt ?? right.startedAt) - Date.parse(left.endedAt ?? left.startedAt) || right.id.localeCompare(left.id))[0]?.id

    for (const row of existing) {
      if (nextIds.has(row.id)) continue
      if (row.status === 'completed') {
        fail('COMPLETED_SESSION_DELETE_FORBIDDEN', 'Completed sessions cannot be deleted through a state snapshot.', { sessionId: row.id })
      }
      this.db.prepare('DELETE FROM work_sessions WHERE id = ?').run(row.id)
    }

    const changed = sessions.filter((session) => {
      const old = existingById.get(session.id)
      return !old || old.data_hash !== hash(canonicalSession(session))
    })
    for (const session of changed) {
      const old = existingById.get(session.id)
      if (!old || old.status !== 'completed') continue
      if (session.status !== 'completed') {
        fail('COMPLETED_SESSION_REOPEN_FORBIDDEN', 'Completed sessions cannot be reopened.', { sessionId: session.id })
      }
      const currentLatest = this.db.prepare("SELECT id FROM work_sessions WHERE account_id = ? AND status = 'completed' ORDER BY ended_at DESC, started_at DESC, id DESC LIMIT 1").get(accountId)
      if (currentLatest?.id !== session.id || latestCompletedId !== session.id) {
        fail('HISTORICAL_SESSION_LOCKED', 'Only the latest completed session may be edited.', { sessionId: session.id })
      }
    }

    const closingSessions = changed.filter((session) => {
      const old = existingById.get(session.id)
      return old && old.status !== 'completed' && session.status === 'completed'
    })
    const otherSessions = changed.filter((session) => !closingSessions.includes(session))
    for (const session of closingSessions) this.upsertSession(accountId, session)
    for (const session of otherSessions) this.upsertSession(accountId, session)
  }

  upsertSession(accountId, session) {
    const payload = canonicalSession(session)
    const dataHash = hash(payload)
    const shouldQueue = session.status === 'completed'
    this.db.prepare([
      'INSERT INTO work_sessions (id, account_id, project_id, started_at, ended_at, timezone, active_duration_ms, status, earnings_amount_minor, earnings_currency, note, created_at, updated_at, sync_status, data_hash)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      'ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, started_at=excluded.started_at, ended_at=excluded.ended_at, timezone=excluded.timezone,',
      'active_duration_ms=excluded.active_duration_ms, status=excluded.status, earnings_amount_minor=excluded.earnings_amount_minor,',
      'earnings_currency=excluded.earnings_currency, note=excluded.note, updated_at=excluded.updated_at,',
      'sync_status=excluded.sync_status, data_hash=excluded.data_hash',
    ].join(' ')).run(session.id, accountId, session.projectId ?? null, session.startedAt, session.endedAt ?? null, session.timezone, session.activeDurationMs ?? null, session.status, session.earnings?.amountMinor ?? null, session.earnings?.currency ?? null, session.note ?? null, session.createdAt, session.updatedAt, shouldQueue ? 'queued' : 'local', dataHash)
    this.db.prepare('DELETE FROM session_pauses WHERE session_id = ?').run(session.id)
    const insertPause = this.db.prepare('INSERT INTO session_pauses (session_id, ordinal, started_at, ended_at) VALUES (?, ?, ?, ?)')
    session.pauses.forEach((pause, ordinal) => insertPause.run(session.id, ordinal, pause.startedAt, pause.endedAt ?? null))
    if (shouldQueue) this.queueOperation(accountId, 'work_session', session.id, 'upsert', payload)
  }

  syncPayments(accountId, payments) {
    const existing = this.db.prepare('SELECT id, data_hash FROM payments WHERE account_id = ?').all(accountId)
    const existingById = new Map(existing.map((row) => [row.id, row]))
    const nextIds = new Set(payments.map((payment) => payment.id))
    for (const row of existing) {
      if (nextIds.has(row.id)) continue
      this.db.prepare('DELETE FROM payments WHERE id = ?').run(row.id)
      this.queueOperation(accountId, 'payment', row.id, 'delete', { id: row.id })
    }
    for (const payment of payments) {
      const payload = canonicalPayment(payment)
      const dataHash = hash(payload)
      if (existingById.get(payment.id)?.data_hash === dataHash) continue
      this.db.prepare([
        'INSERT INTO payments (id, account_id, project_id, amount_minor, currency, received_at, kind, note, created_at, sync_status, data_hash)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, amount_minor=excluded.amount_minor, currency=excluded.currency,',
        'received_at=excluded.received_at, kind=excluded.kind, note=excluded.note, sync_status=excluded.sync_status, data_hash=excluded.data_hash',
      ].join(' ')).run(payment.id, accountId, payment.projectId, payment.money.amountMinor, payment.money.currency, payment.receivedAt, payment.kind, payment.note ?? null, payment.createdAt, 'queued', dataHash)
      this.queueOperation(accountId, 'payment', payment.id, 'upsert', payload)
    }
  }

  syncGoals(accountId, goals) {
    const existing = this.db.prepare('SELECT id, data_hash FROM goals WHERE account_id = ?').all(accountId)
    const existingById = new Map(existing.map((row) => [row.id, row]))
    const nextIds = new Set(goals.map((goal) => goal.id))
    for (const row of existing) {
      if (nextIds.has(row.id)) continue
      this.db.prepare('DELETE FROM goals WHERE id = ?').run(row.id)
      this.queueOperation(accountId, 'goal', row.id, 'delete', { id: row.id })
    }
    for (const goal of goals) {
      const payload = canonicalGoal(goal)
      const dataHash = hash(payload)
      if (existingById.get(goal.id)?.data_hash === dataHash) continue
      this.db.prepare([
        'INSERT INTO goals (id, account_id, kind, target, created_at, sync_status, data_hash)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, target=excluded.target, sync_status=excluded.sync_status, data_hash=excluded.data_hash',
      ].join(' ')).run(goal.id, accountId, goal.kind, goal.target, goal.createdAt, 'queued', dataHash)
      this.queueOperation(accountId, 'goal', goal.id, 'upsert', payload)
    }
  }

  upsertPreferences(accountId, preferences) {
    const payload = canonicalPreferences(preferences)
    const dataHash = hash(payload)
    const old = this.db.prepare('SELECT data_hash FROM preferences WHERE account_id = ?').get(accountId)
    if (old?.data_hash === dataHash) return
    this.db.prepare([
      'INSERT INTO preferences (account_id, theme, mini_timer_mode, dashboard_hidden_widgets_json, dashboard_widget_order_json, dashboard_widget_sizes_json, data_hash)',
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      'ON CONFLICT(account_id) DO UPDATE SET theme=excluded.theme, mini_timer_mode=excluded.mini_timer_mode,',
      'dashboard_hidden_widgets_json=excluded.dashboard_hidden_widgets_json, dashboard_widget_order_json=excluded.dashboard_widget_order_json,',
      'dashboard_widget_sizes_json=excluded.dashboard_widget_sizes_json, data_hash=excluded.data_hash',
    ].join(' ')).run(accountId, preferences.theme, preferences.miniTimerMode, stableJson(preferences.dashboardHiddenWidgets), stableJson(preferences.dashboardWidgetOrder), stableJson(preferences.dashboardWidgetSizes), dataHash)
    this.queueOperation(accountId, 'preferences', accountId, 'upsert', payload)
  }

  currentAccountId() {
    return this.db.prepare('SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1').get()?.id ?? null
  }

  getPullCursor(accountId = this.currentAccountId()) {
    if (!accountId) return 0
    const row = this.db.prepare('SELECT pull_cursor FROM sync_metadata WHERE account_id = ?').get(accountId)
    return row ? Number(row.pull_cursor) : 0
  }

  updatePullMetadata(accountId, cursor) {
    const normalizedCursor = normalizePullCursor(cursor)
    const now = new Date().toISOString()
    this.db.prepare([
      'INSERT INTO sync_metadata (account_id, pull_cursor, last_pulled_at, updated_at) VALUES (?, ?, ?, ?)',
      'ON CONFLICT(account_id) DO UPDATE SET pull_cursor = excluded.pull_cursor, last_pulled_at = excluded.last_pulled_at, updated_at = excluded.updated_at',
    ].join(' ')).run(accountId, normalizedCursor, now, now)
  }

  getSyncConflicts(options = {}) {
    const normalizedOptions = Number.isInteger(options) ? { limit: options } : options
    const accountId = normalizedOptions.accountId ?? this.currentAccountId()
    if (!accountId) return []
    const limit = Number.isInteger(normalizedOptions.limit) ? Math.max(1, Math.min(500, normalizedOptions.limit)) : 100
    const includeResolved = normalizedOptions.includeResolved === true
    const rows = this.db.prepare([
      'SELECT id, account_id, remote_cursor, entity_type, entity_id, operation, local_payload_json, remote_payload_json, reason, details_json, detected_at, resolution, resolved_at',
      'FROM sync_conflicts WHERE account_id = ?' + (includeResolved ? '' : " AND resolution = 'open'"),
      'ORDER BY remote_cursor DESC LIMIT ?',
    ].join(' ')).all(accountId, limit)
    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      cursor: Number(row.remote_cursor),
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      localPayload: row.local_payload_json === null ? undefined : parseJson(row.local_payload_json, undefined),
      remotePayload: parseJson(row.remote_payload_json, {}),
      reason: row.reason,
      details: parseJson(row.details_json, {}),
      detectedAt: row.detected_at,
      resolution: row.resolution,
      resolvedAt: row.resolved_at ?? undefined,
    }))
  }

  resolveSyncConflict(conflictId) {
    if (!validId(conflictId)) return false
    const result = this.db.prepare("UPDATE sync_conflicts SET resolution = 'resolved', resolved_at = ? WHERE id = ? AND resolution = 'open'")
      .run(new Date().toISOString(), conflictId)
    return result.changes > 0
  }

  /**
   * Explicitly chooses the remote version recorded with an open conflict.
   * The conflict record is the immutable decision input: do not repull or use
   * a potentially newer outbox payload while resolving it.  All state changes,
   * cancellation of the losing local operation, and the conflict resolution
   * happen in one transaction so a failed safety check leaves every local
   * record retryable and the conflict visibly open.
   */
  acceptRemoteSyncConflict(conflictId) {
    if (!validId(conflictId)) return { accepted: false, reason: 'invalid_conflict_id' }
    const accountId = this.currentAccountId()
    if (!accountId) return { accepted: false, reason: 'no_local_account' }

    this.db.exec('BEGIN IMMEDIATE')
    const reject = (reason) => {
      this.db.exec('ROLLBACK')
      return { accepted: false, reason }
    }

    try {
      const row = this.db.prepare([
        'SELECT id, account_id, remote_cursor, entity_type, entity_id, operation, remote_payload_json',
        "FROM sync_conflicts WHERE id = ? AND account_id = ? AND resolution = 'open' LIMIT 1",
      ].join(' ')).get(conflictId, accountId)
      if (!row) {
        this.db.exec('COMMIT')
        return { accepted: false, reason: 'conflict_not_open' }
      }

      let rawPayload
      try {
        rawPayload = JSON.parse(row.remote_payload_json)
      } catch {
        return reject('invalid_remote_payload')
      }
      if (!isRecord(rawPayload)) return reject('invalid_remote_payload')

      let change
      try {
        change = normalizeRemoteChange({
          cursor: Number(row.remote_cursor),
          entityType: row.entity_type,
          entityId: row.entity_id,
          operation: row.operation,
          payload: rawPayload,
        }, 'conflict')
      } catch (error) {
        return reject(error instanceof StateIntegrityError ? error.code.toLowerCase() : 'invalid_conflict')
      }

      const localEntityId = this.remoteLocalEntityId(accountId, change.entityType, change.entityId)
      const localPayload = this.localCanonicalEntity(accountId, change.entityType, localEntityId)
      let remotePayload
      let applied

      if (change.operation === 'delete') {
        const safety = this.remoteDeleteIsSafe(accountId, change.entityType, localEntityId, localPayload)
        if (!safety.safe) return reject(safety.reason)
        applied = Boolean(localPayload)
      } else {
        try {
          remotePayload = this.normalizeRemoteUpsert(accountId, change)
        } catch (error) {
          return reject(error instanceof StateIntegrityError ? error.code.toLowerCase() : 'remote_payload_rejected')
        }
        if (change.entityType === 'work_session' && localPayload && (localPayload.status === 'running' || localPayload.status === 'paused')) {
          return reject('remote_would_mutate_active_timer')
        }
        applied = stableJson(localPayload) !== stableJson(remotePayload)
      }

      // Do this only after the stored remote version has passed all checks.
      // A rejected resolution must leave an existing queued/error operation
      // intact so it can still be retried or resolved another way.
      const cancelledOperations = this.db.prepare([
        'DELETE FROM sync_outbox',
        "WHERE account_id = ? AND entity_type = ? AND entity_id = ? AND status IN ('queued', 'error')",
      ].join(' ')).run(accountId, change.entityType, localEntityId).changes

      try {
        if (change.operation === 'delete') this.deleteRemoteEntity(accountId, change.entityType, localEntityId)
        else this.writeRemoteUpsert(accountId, change.entityType, remotePayload)
        this.assertPersistedIntegrity(accountId)
      } catch (error) {
        if (error instanceof StateIntegrityError) return reject(error.code.toLowerCase())
        if (/constraint|foreign key|trigger|unique/i.test(error instanceof Error ? error.message : '')) {
          return reject('remote_write_rejected')
        }
        throw error
      }

      const resolved = this.db.prepare([
        "UPDATE sync_conflicts SET resolution = 'resolved', resolved_at = ?",
        "WHERE id = ? AND account_id = ? AND resolution = 'open'",
      ].join(' ')).run(new Date().toISOString(), conflictId, accountId)
      if (resolved.changes !== 1) return reject('conflict_not_open')

      this.db.exec('COMMIT')
      return {
        accepted: true,
        applied,
        entityType: change.entityType,
        entityId: change.entityId,
        operation: change.operation,
        cancelledOperations,
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  pendingOperationForEntity(accountId, entityType, entityId) {
    const row = this.db.prepare([
      'SELECT id, operation, payload_json, status FROM sync_outbox',
      "WHERE account_id = ? AND entity_type = ? AND entity_id = ? AND status IN ('queued', 'error')",
      'ORDER BY rowid DESC LIMIT 1',
    ].join(' ')).get(accountId, entityType, entityId)
    return row ? { id: row.id, operation: row.operation, payload: parseJson(row.payload_json, {}), status: row.status } : undefined
  }

  remoteLocalEntityId(accountId, entityType, remoteEntityId) {
    return entityType === 'account' || entityType === 'preferences' ? accountId : remoteEntityId
  }

  localCanonicalEntity(accountId, entityType, entityId) {
    const state = this.loadState()
    if (!state.account || state.account.id !== accountId) return undefined
    return canonicalEntityFromState(state, entityType, entityId)
  }

  recordSyncConflict(accountId, change, localPayload, reason, details = {}) {
    const now = new Date().toISOString()
    this.db.prepare([
      'INSERT INTO sync_conflicts (id, account_id, remote_cursor, entity_type, entity_id, operation, local_payload_json, remote_payload_json, reason, details_json, detected_at, resolution)',
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')",
      'ON CONFLICT(account_id, remote_cursor) DO UPDATE SET entity_type=excluded.entity_type, entity_id=excluded.entity_id, operation=excluded.operation,',
      'local_payload_json=excluded.local_payload_json, remote_payload_json=excluded.remote_payload_json, reason=excluded.reason, details_json=excluded.details_json, detected_at=excluded.detected_at, resolution=\'open\', resolved_at=NULL',
    ].join(' ')).run(
      crypto.randomUUID(), accountId, change.cursor, change.entityType, change.entityId, change.operation,
      localPayload === undefined ? null : stableJson(localPayload), stableJson(change.payload), reason, stableJson(details), now,
    )
  }

  normalizeRemoteUpsert(accountId, change) {
    const state = this.loadState()
    if (!state.account || state.account.id !== accountId) {
      fail('NO_LOCAL_ACCOUNT_FOR_PULL', 'Remote changes cannot be applied before a local account exists.')
    }
    const candidate = cloneJson(state)
    const payload = change.payload

    if (change.entityType === 'account') {
      if (payload.id !== undefined && payload.id !== change.entityId) {
        fail('REMOTE_PAYLOAD_ID_MISMATCH', 'The remote account payload does not match its change identity.')
      }
      candidate.account = {
        id: accountId,
        authUserId: state.account.authUserId,
        displayName: payload.displayName,
        country: payload.country,
        language: payload.language,
        currency: payload.currency,
        timezone: payload.timezone,
        createdAt: payload.createdAt ?? state.account.createdAt,
        syncStatus: 'synced',
      }
    } else if (change.entityType === 'preferences') {
      candidate.preferences = { ...payload }
    } else {
      if (payload.id !== change.entityId) {
        fail('REMOTE_PAYLOAD_ID_MISMATCH', 'The remote payload does not match its change identity.')
      }
      if (change.entityType === 'work_session' && payload.status !== 'completed') {
        fail('REMOTE_ACTIVE_TIMER_IGNORED', 'Remote sync never controls a running or paused timer.')
      }
      const collectionByType = {
        project: 'projects',
        work_session: 'sessions',
        payment: 'payments',
        goal: 'goals',
      }
      const collection = collectionByType[change.entityType]
      const index = candidate[collection].findIndex((item) => item.id === change.entityId)
      const entity = { ...payload, id: change.entityId, syncStatus: 'synced' }
      if (index >= 0) candidate[collection][index] = entity
      else candidate[collection].push(entity)
    }

    const normalized = normalizeState(candidate)
    const localEntityId = this.remoteLocalEntityId(accountId, change.entityType, change.entityId)
    return canonicalEntityFromState(normalized, change.entityType, localEntityId)
  }

  assertRemoteEntityOwner(table, accountId, entityId) {
    const row = this.db.prepare('SELECT account_id FROM ' + table + ' WHERE id = ?').get(entityId)
    if (row && row.account_id !== accountId) {
      fail('REMOTE_ID_OWNERSHIP_CONFLICT', 'A remote change refers to an entity owned by a different local account.', { entityId })
    }
  }

  writeRemoteUpsert(accountId, entityType, entity) {
    if (entityType === 'account') {
      const dataHash = hash(entity)
      this.db.prepare([
        'UPDATE accounts SET display_name = ?, country = ?, language = ?, currency = ?, timezone = ?, created_at = ?, sync_status = ?, data_hash = ?',
        'WHERE id = ?',
      ].join(' ')).run(entity.displayName, entity.country, entity.language, entity.currency, entity.timezone, entity.createdAt, 'synced', dataHash, accountId)
      return
    }

    if (entityType === 'project') {
      this.assertRemoteEntityOwner('projects', accountId, entity.id)
      const dataHash = hash(entity)
      this.db.prepare([
        'INSERT INTO projects (id, account_id, name, payment_model, expected_amount_minor, expected_currency, note, color, icon, status, completed_at, created_at, updated_at, sync_status, data_hash)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(id) DO UPDATE SET name=excluded.name, payment_model=excluded.payment_model, expected_amount_minor=excluded.expected_amount_minor,',
        'expected_currency=excluded.expected_currency, note=excluded.note, color=excluded.color, icon=excluded.icon, status=excluded.status,',
        'completed_at=excluded.completed_at, created_at=excluded.created_at, updated_at=excluded.updated_at, sync_status=excluded.sync_status, data_hash=excluded.data_hash',
      ].join(' ')).run(entity.id, accountId, entity.name, entity.paymentModel, entity.expectedMoney?.amountMinor ?? null, entity.expectedMoney?.currency ?? null, entity.note ?? null, entity.color, entity.icon, entity.status, entity.completedAt ?? null, entity.createdAt, entity.updatedAt, 'synced', dataHash)
      return
    }

    if (entityType === 'work_session') {
      this.assertRemoteEntityOwner('work_sessions', accountId, entity.id)
      const dataHash = hash(entity)
      this.db.prepare([
        'INSERT INTO work_sessions (id, account_id, project_id, started_at, ended_at, timezone, active_duration_ms, status, earnings_amount_minor, earnings_currency, note, created_at, updated_at, sync_status, data_hash)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, started_at=excluded.started_at, ended_at=excluded.ended_at, timezone=excluded.timezone,',
        'active_duration_ms=excluded.active_duration_ms, status=excluded.status, earnings_amount_minor=excluded.earnings_amount_minor,',
        'earnings_currency=excluded.earnings_currency, note=excluded.note, created_at=excluded.created_at, updated_at=excluded.updated_at,',
        'sync_status=excluded.sync_status, data_hash=excluded.data_hash',
      ].join(' ')).run(entity.id, accountId, entity.projectId ?? null, entity.startedAt, entity.endedAt ?? null, entity.timezone, entity.activeDurationMs ?? null, entity.status, entity.earnings?.amountMinor ?? null, entity.earnings?.currency ?? null, entity.note ?? null, entity.createdAt, entity.updatedAt, 'synced', dataHash)
      this.db.prepare('DELETE FROM session_pauses WHERE session_id = ?').run(entity.id)
      const insertPause = this.db.prepare('INSERT INTO session_pauses (session_id, ordinal, started_at, ended_at) VALUES (?, ?, ?, ?)')
      entity.pauses.forEach((pause, ordinal) => insertPause.run(entity.id, ordinal, pause.startedAt, pause.endedAt ?? null))
      return
    }

    if (entityType === 'payment') {
      this.assertRemoteEntityOwner('payments', accountId, entity.id)
      const dataHash = hash(entity)
      this.db.prepare([
        'INSERT INTO payments (id, account_id, project_id, amount_minor, currency, received_at, kind, note, created_at, sync_status, data_hash)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, amount_minor=excluded.amount_minor, currency=excluded.currency,',
        'received_at=excluded.received_at, kind=excluded.kind, note=excluded.note, created_at=excluded.created_at, sync_status=excluded.sync_status, data_hash=excluded.data_hash',
      ].join(' ')).run(entity.id, accountId, entity.projectId, entity.money.amountMinor, entity.money.currency, entity.receivedAt, entity.kind, entity.note ?? null, entity.createdAt, 'synced', dataHash)
      return
    }

    if (entityType === 'goal') {
      this.assertRemoteEntityOwner('goals', accountId, entity.id)
      const dataHash = hash(entity)
      this.db.prepare([
        'INSERT INTO goals (id, account_id, kind, target, created_at, sync_status, data_hash)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, target=excluded.target, created_at=excluded.created_at, sync_status=excluded.sync_status, data_hash=excluded.data_hash',
      ].join(' ')).run(entity.id, accountId, entity.kind, entity.target, entity.createdAt, 'synced', dataHash)
      return
    }

    if (entityType === 'preferences') {
      const dataHash = hash(entity)
      this.db.prepare([
        'INSERT INTO preferences (account_id, theme, mini_timer_mode, dashboard_hidden_widgets_json, dashboard_widget_order_json, dashboard_widget_sizes_json, data_hash)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(account_id) DO UPDATE SET theme=excluded.theme, mini_timer_mode=excluded.mini_timer_mode,',
        'dashboard_hidden_widgets_json=excluded.dashboard_hidden_widgets_json, dashboard_widget_order_json=excluded.dashboard_widget_order_json,',
        'dashboard_widget_sizes_json=excluded.dashboard_widget_sizes_json, data_hash=excluded.data_hash',
      ].join(' ')).run(accountId, entity.theme, entity.miniTimerMode, stableJson(entity.dashboardHiddenWidgets), stableJson(entity.dashboardWidgetOrder), stableJson(entity.dashboardWidgetSizes), dataHash)
      return
    }

    fail('INVALID_REMOTE_ENTITY_TYPE', 'Unsupported remote entity type.')
  }

  deleteRemoteEntity(accountId, entityType, entityId) {
    if (entityType === 'project') {
      this.db.prepare('DELETE FROM projects WHERE id = ? AND account_id = ?').run(entityId, accountId)
      return
    }
    if (entityType === 'work_session') {
      this.db.prepare('DELETE FROM work_sessions WHERE id = ? AND account_id = ?').run(entityId, accountId)
      return
    }
    if (entityType === 'payment') {
      this.db.prepare('DELETE FROM payments WHERE id = ? AND account_id = ?').run(entityId, accountId)
      return
    }
    if (entityType === 'goal') {
      this.db.prepare('DELETE FROM goals WHERE id = ? AND account_id = ?').run(entityId, accountId)
      return
    }
    fail('REMOTE_DELETE_FORBIDDEN', 'The remote change tries to delete an entity that is never deleted through sync.')
  }

  remoteDeleteIsSafe(accountId, entityType, localEntityId, localPayload) {
    if (entityType === 'account' || entityType === 'preferences') {
      return { safe: false, reason: 'remote_delete_forbidden' }
    }
    if (!localPayload) return { safe: true }
    if (entityType === 'project') {
      const linked = this.db.prepare([
        'SELECT 1 AS present FROM work_sessions WHERE account_id = ? AND project_id = ? LIMIT 1',
      ].join(' ')).get(accountId, localEntityId) || this.db.prepare([
        'SELECT 1 AS present FROM payments WHERE account_id = ? AND project_id = ? LIMIT 1',
      ].join(' ')).get(accountId, localEntityId)
      return linked ? { safe: false, reason: 'remote_project_delete_has_history' } : { safe: true }
    }
    if (entityType === 'work_session') {
      if (localPayload.status === 'running' || localPayload.status === 'paused') {
        return { safe: false, reason: 'remote_active_timer_ignored' }
      }
      return { safe: false, reason: 'remote_completed_session_delete_forbidden' }
    }
    return { safe: true }
  }

  applyRemoteChange(accountId, change) {
    const localEntityId = this.remoteLocalEntityId(accountId, change.entityType, change.entityId)
    const localPayload = this.localCanonicalEntity(accountId, change.entityType, localEntityId)
    const pending = this.pendingOperationForEntity(accountId, change.entityType, localEntityId)
    const conflict = (reason, details = {}) => {
      this.recordSyncConflict(accountId, change, localPayload, reason, details)
      return { applied: 0, conflicts: 1 }
    }

    if (change.operation === 'delete') {
      if (pending) {
        if (!localPayload && pending.operation === 'delete') return { applied: 0, conflicts: 0 }
        return conflict('local_pending_change', { pendingOperation: pending.operation, pendingStatus: pending.status })
      }
      const safety = this.remoteDeleteIsSafe(accountId, change.entityType, localEntityId, localPayload)
      if (!safety.safe) return conflict(safety.reason)
      this.deleteRemoteEntity(accountId, change.entityType, localEntityId)
      return { applied: localPayload ? 1 : 0, conflicts: 0 }
    }

    let remotePayload
    try {
      remotePayload = this.normalizeRemoteUpsert(accountId, change)
    } catch (error) {
      if (error instanceof StateIntegrityError) return conflict(error.code.toLowerCase())
      throw error
    }

    if (change.entityType === 'work_session' && localPayload && (localPayload.status === 'running' || localPayload.status === 'paused')) {
      return conflict('remote_would_mutate_active_timer')
    }
    if (pending) {
      const samePayload = localPayload !== undefined && stableJson(localPayload) === stableJson(remotePayload)
      if (samePayload) return { applied: 0, conflicts: 0 }
      return conflict('local_pending_change', { pendingOperation: pending.operation, pendingStatus: pending.status })
    }

    try {
      this.writeRemoteUpsert(accountId, change.entityType, remotePayload)
      return { applied: stableJson(localPayload) === stableJson(remotePayload) ? 0 : 1, conflicts: 0 }
    } catch (error) {
      if (error instanceof StateIntegrityError) return conflict(error.code.toLowerCase())
      if (/constraint|foreign key|trigger|unique/i.test(error instanceof Error ? error.message : '')) {
        return conflict('remote_write_rejected')
      }
      throw error
    }
  }

  applyRemoteChanges(rawChanges) {
    const rawList = requireCollection(rawChanges, 'remoteChanges')
    const changes = rawList.map((change, index) => normalizeRemoteChange(change, index))
    const accountId = this.currentAccountId()
    if (!accountId) fail('NO_LOCAL_ACCOUNT_FOR_PULL', 'Remote changes cannot be applied before a local account exists.')
    let cursor = this.getPullCursor(accountId)
    let previousIncomingCursor = cursor
    for (const change of changes) {
      if (change.cursor <= cursor) continue
      if (change.cursor <= previousIncomingCursor) {
        fail('OUT_OF_ORDER_PULL_CURSOR', 'Remote changes must be supplied in increasing cursor order.')
      }
      previousIncomingCursor = change.cursor
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      let applied = 0
      let conflicts = 0
      for (const change of changes) {
        if (change.cursor <= cursor) continue
        const result = this.applyRemoteChange(accountId, change)
        applied += result.applied
        conflicts += result.conflicts
        cursor = change.cursor
      }
      this.updatePullMetadata(accountId, cursor)
      this.assertPersistedIntegrity(accountId)
      this.db.exec('COMMIT')
      return { cursor, applied, conflicts }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  loadState() {
    const accountRow = this.db.prepare('SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1').get()
    if (!accountRow) return emptyState()
    const account = {
      id: accountRow.id, authUserId: accountRow.auth_user_id ?? undefined, displayName: accountRow.display_name, country: accountRow.country, language: accountRow.language,
      currency: accountRow.currency, timezone: accountRow.timezone, createdAt: accountRow.created_at,
    }
    const projectRows = this.db.prepare('SELECT * FROM projects WHERE account_id = ? ORDER BY created_at DESC').all(account.id)
    const projects = projectRows.map((row) => ({
      id: row.id, name: row.name, paymentModel: row.payment_model,
      expectedMoney: row.expected_amount_minor === null ? undefined : { amountMinor: row.expected_amount_minor, currency: row.expected_currency },
      note: row.note ?? undefined, color: row.color, icon: row.icon, status: row.status, completedAt: row.completed_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, syncStatus: row.sync_status,
    }))
    const sessionRows = this.db.prepare('SELECT * FROM work_sessions WHERE account_id = ? ORDER BY started_at DESC').all(account.id)
    const pausesBySession = new Map()
    const pauseRows = this.db.prepare([
      'SELECT session_id, ordinal, started_at, ended_at FROM session_pauses',
      'WHERE session_id IN (SELECT id FROM work_sessions WHERE account_id = ?) ORDER BY session_id, ordinal',
    ].join(' ')).all(account.id)
    for (const row of pauseRows) {
      const pauses = pausesBySession.get(row.session_id) ?? []
      pauses.push({ startedAt: row.started_at, endedAt: row.ended_at ?? undefined })
      pausesBySession.set(row.session_id, pauses)
    }
    const sessions = sessionRows.map((row) => ({
      id: row.id, projectId: row.project_id ?? undefined, startedAt: row.started_at, endedAt: row.ended_at ?? undefined,
      timezone: row.timezone, pauses: pausesBySession.get(row.id) ?? [], activeDurationMs: row.active_duration_ms ?? undefined,
      status: row.status, earnings: row.earnings_amount_minor === null ? undefined : { amountMinor: row.earnings_amount_minor, currency: row.earnings_currency },
      note: row.note ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, syncStatus: row.sync_status,
    }))
    const payments = this.db.prepare('SELECT * FROM payments WHERE account_id = ? ORDER BY received_at DESC').all(account.id).map((row) => ({
      id: row.id, projectId: row.project_id, money: { amountMinor: row.amount_minor, currency: row.currency }, receivedAt: row.received_at,
      kind: row.kind, note: row.note ?? undefined, createdAt: row.created_at, syncStatus: row.sync_status,
    }))
    const goals = this.db.prepare('SELECT * FROM goals WHERE account_id = ? ORDER BY created_at ASC').all(account.id).map((row) => ({
      id: row.id, kind: row.kind, target: row.target, createdAt: row.created_at, syncStatus: row.sync_status,
    }))
    const preferenceRow = this.db.prepare('SELECT * FROM preferences WHERE account_id = ?').get(account.id)
    const preferences = preferenceRow ? {
      theme: preferenceRow.theme, miniTimerMode: preferenceRow.mini_timer_mode,
      dashboardHiddenWidgets: parseJson(preferenceRow.dashboard_hidden_widgets_json, []),
      dashboardWidgetOrder: parseJson(preferenceRow.dashboard_widget_order_json, []),
      dashboardWidgetSizes: parseJson(preferenceRow.dashboard_widget_sizes_json, {}),
    } : emptyState().preferences
    return { version: APP_STATE_VERSION, account, projects, sessions, payments, goals, preferences }
  }

  getSyncSummary() {
    const queued = this.db.prepare("SELECT COUNT(*) AS total FROM sync_outbox WHERE status = 'queued'").get().total
    const failed = this.db.prepare("SELECT COUNT(*) AS total FROM sync_outbox WHERE status = 'error'").get().total
    const conflicts = this.db.prepare("SELECT COUNT(*) AS total FROM sync_conflicts WHERE resolution = 'open'").get().total
    return { queued, failed, conflicts }
  }

  getQueuedOperations(limit = 50) {
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(500, limit)) : 50
    return this.db.prepare([
      'SELECT id, account_id, entity_type, entity_id, operation, idempotency_key, payload_json, created_at, attempts, last_error, next_attempt_at, status',
      'FROM sync_outbox',
      "WHERE (status = 'queued' OR (status = 'error' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)))",
      "AND NOT EXISTS (SELECT 1 FROM sync_conflicts conflict WHERE conflict.account_id = sync_outbox.account_id AND conflict.entity_type = sync_outbox.entity_type AND conflict.entity_id = sync_outbox.entity_id AND conflict.resolution = 'open')",
      // Referentially dependent operations can share a timestamp or be
      // requeued after an account claim.  Preserve a safe cloud order rather
      // than allowing a dashboard preference or payment to reach the server
      // before the profile/project it requires.
      "ORDER BY CASE entity_type WHEN 'account' THEN 0 WHEN 'project' THEN 1 WHEN 'work_session' THEN 2 WHEN 'payment' THEN 3 WHEN 'goal' THEN 4 WHEN 'preferences' THEN 5 ELSE 6 END, created_at ASC, rowid ASC LIMIT ?",
    ].join(' ')).all(new Date().toISOString(), safeLimit).map((row) => ({
      id: row.id, accountId: row.account_id, entityType: row.entity_type, entityId: row.entity_id, operation: row.operation,
      idempotencyKey: row.idempotency_key, payload: parseJson(row.payload_json, {}), createdAt: row.created_at,
      attempts: row.attempts, lastError: row.last_error ?? undefined, nextAttemptAt: row.next_attempt_at ?? undefined, status: row.status,
    }))
  }

  markOperationSynced(operationId) {
    const operation = this.db.prepare('SELECT id, account_id, entity_type, entity_id FROM sync_outbox WHERE id = ?').get(operationId)
    if (!operation) return false
    this.db.prepare("UPDATE sync_outbox SET status = 'synced', last_error = NULL, next_attempt_at = NULL WHERE id = ?").run(operationId)
    this.markEntityStatusIfSettled(operation, 'synced')
    return true
  }

  markOperationFailed(operationId, error) {
    const operation = this.db.prepare('SELECT id, account_id, entity_type, entity_id, attempts, status FROM sync_outbox WHERE id = ?').get(operationId)
    if (!operation || operation.status === 'synced') return false
    const attempts = operation.attempts + 1
    const backoffMs = Math.min(300000, 2 ** Math.min(attempts, 8) * 1000)
    const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString()
    this.db.prepare("UPDATE sync_outbox SET status = 'error', attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?")
      .run(attempts, asString(error, 'Sync failed').slice(0, 1000), nextAttemptAt, operationId)
    const latest = this.db.prepare([
      "SELECT id FROM sync_outbox WHERE account_id = ? AND entity_type = ? AND entity_id = ? AND status IN ('queued', 'error')",
      'ORDER BY rowid DESC LIMIT 1',
    ].join(' ')).get(operation.account_id, operation.entity_type, operation.entity_id)
    if (latest?.id === operationId) this.setEntitySyncStatus(operation, 'error')
    return true
  }

  markEntityStatusIfSettled(operation, status) {
    const pending = this.db.prepare([
      "SELECT 1 AS present FROM sync_outbox WHERE account_id = ? AND entity_type = ? AND entity_id = ? AND status IN ('queued', 'error') LIMIT 1",
    ].join(' ')).get(operation.account_id, operation.entity_type, operation.entity_id)
    if (!pending) this.setEntitySyncStatus(operation, status)
  }

  setEntitySyncStatus(operation, status) {
    const tableByType = {
      account: ['accounts', 'id'],
      project: ['projects', 'id'],
      work_session: ['work_sessions', 'id'],
      payment: ['payments', 'id'],
      goal: ['goals', 'id'],
    }
    const target = tableByType[operation.entity_type]
    if (!target) return
    if (operation.entity_type === 'account') {
      this.db.prepare('UPDATE accounts SET sync_status = ? WHERE id = ?').run(status, operation.entity_id)
      return
    }
    this.db.prepare('UPDATE ' + target[0] + ' SET sync_status = ? WHERE ' + target[1] + ' = ? AND account_id = ?')
      .run(status, operation.entity_id, operation.account_id)
  }

  close() {
    if (this.closed) return
    this.db.close()
    this.closed = true
  }
}

module.exports = { LocalStateRepository, StateIntegrityError, emptyState, normalizeState, stableJson, hash }
