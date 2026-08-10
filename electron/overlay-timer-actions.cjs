const crypto = require('node:crypto')

function activeSessionFromState(state) {
  return state.sessions.find((session) => session.status === 'running' || session.status === 'paused')
}

async function executeCommandBackedOverlayAction({ action, repository, commandService, acquireTimerLease, startLeaseRenewal, onOpen, onStopRequested, onStateChanged, syncNow }) {
  const state = repository.loadState()
  const active = activeSessionFromState(state)
  if (action === 'open') {
    onOpen()
    return { ok: true }
  }
  if (action === 'stop') {
    if (!active) return { ok: false, message: 'There is no active session to finish.' }
    onOpen()
    onStopRequested({ sessionId: active.id, session: active, state })
    return { ok: true, requiresCompletion: true, message: 'Finish the session in TimeFarm to record earnings.' }
  }

  const commandType = action === 'start' ? 'session.start' : action === 'pause' ? 'session.pause' : action === 'resume' ? 'session.resume' : undefined
  if (!commandType) return { ok: false, message: 'Unsupported timer action.' }

  const command = { type: commandType, payload: {} }
  // Main serializes this handler with renderer commands. Validate the current
  // timer transition before any asynchronous lease request, so a stale overlay
  // button cannot reserve a lease for a command that will be rejected.
  try {
    commandService.preflight?.(command)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The timer action is no longer valid.' }
  }

  let leaseOutcome
  if (action === 'start' || action === 'resume') {
    leaseOutcome = await acquireTimerLease()
    if (leaseOutcome?.state === 'held_by_other') {
      return { ok: false, message: 'Another signed-in device currently holds the active timer lease.' }
    }
  }

  try {
    const response = commandService.execute(command)
    if (leaseOutcome?.state === 'acquired') startLeaseRenewal()
    onStateChanged(response.state)
    void Promise.resolve(syncNow()).catch(() => {})
    return { ok: true, ...(response.result ?? {}) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The timer action could not be saved.' }
  }
}

function createOverlayTimerActionHandler({ repository, commandService, acquireTimerLease = async () => ({ state: 'not_configured' }), startLeaseRenewal = () => {}, onOpen = () => {}, onStopRequested = () => {}, onStateChanged = () => {}, syncNow = () => {} }) {
  return async (action) => {
    if (commandService) {
      return executeCommandBackedOverlayAction({ action, repository, commandService, acquireTimerLease, startLeaseRenewal, onOpen, onStopRequested, onStateChanged, syncNow })
    }
    const state = repository.loadState()
    const active = activeSessionFromState(state)
    const timestamp = new Date().toISOString()

    if (action === 'open') {
      onOpen()
      return { ok: true }
    }
    if (action === 'stop') {
      if (!active) return { ok: false, message: 'There is no active session to finish.' }
      onOpen()
      onStopRequested({ sessionId: active.id, session: active, state })
      return { ok: true, requiresCompletion: true, message: 'Finish the session in TimeFarm to record earnings.' }
    }
    if (action === 'start') {
      if (!state.account) return { ok: false, message: 'Finish account setup before starting a timer.' }
      if (active) return { ok: false, message: 'An active session already exists.' }
      state.sessions.unshift({
        id: crypto.randomUUID(),
        startedAt: timestamp,
        timezone: state.account.timezone,
        pauses: [],
        status: 'running',
        createdAt: timestamp,
        updatedAt: timestamp,
        syncStatus: 'local',
      })
    } else if (action === 'pause') {
      if (!active || active.status !== 'running') return { ok: false, message: 'The timer is not running.' }
      active.status = 'paused'
      active.pauses = [...active.pauses, { startedAt: timestamp }]
      active.updatedAt = timestamp
      active.syncStatus = 'local'
    } else if (action === 'resume') {
      if (!active || active.status !== 'paused') return { ok: false, message: 'The timer is not paused.' }
      const pauses = [...active.pauses]
      const last = pauses.at(-1)
      if (!last || last.endedAt) return { ok: false, message: 'The paused timer has no open pause interval.' }
      pauses[pauses.length - 1] = { ...last, endedAt: timestamp }
      active.status = 'running'
      active.pauses = pauses
      active.updatedAt = timestamp
      active.syncStatus = 'local'
    } else {
      return { ok: false, message: 'Unsupported timer action.' }
    }

    const saved = repository.replaceState(state)
    onStateChanged(saved)
    void Promise.resolve(syncNow()).catch(() => {})
    return { ok: true }
  }
}

module.exports = { activeSessionFromState, createOverlayTimerActionHandler, executeCommandBackedOverlayAction }
