const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_LEASE_SECONDS = 45
// A cloud lease is useful only when it arrives quickly enough to make a
// start/resume decision. Keep this below the default lease duration so an
// unreachable network never leaves a desktop action pending indefinitely.
const DEFAULT_RPC_TIMEOUT_MS = 5_000
const MIN_LEASE_SECONDS = 15
const MAX_LEASE_SECONDS = 120
const DEVICE_FILE_NAME = 'timer-device-id.json'
const LEASE_OUTCOMES = Object.freeze(['acquired', 'not_configured', 'not_authenticated', 'held_by_other', 'failed'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class TimerLeaseError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TimerLeaseError'
    this.code = code
  }
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function normaliseLeaseSeconds(value) {
  if (!Number.isInteger(value) || value < MIN_LEASE_SECONDS || value > MAX_LEASE_SECONDS) {
    throw new TimerLeaseError('INVALID_LEASE_SECONDS', `Lease duration must be an integer between ${MIN_LEASE_SECONDS} and ${MAX_LEASE_SECONDS} seconds.`)
  }
  return value
}

function normaliseRpcTimeoutMs(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TimerLeaseError('INVALID_RPC_TIMEOUT', 'RPC timeout must be a positive integer number of milliseconds.')
  }
  return value
}

function safeErrorMessage(error) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : typeof error?.message === 'string'
        ? error.message
        : 'Timer lease request failed.'
  return message.slice(0, 500)
}

/**
 * A stable installation-specific UUID is required by the server-side lease
 * function. It is not an authentication credential, but it is still written
 * atomically with restrictive permissions where the OS supports them.
 */
class DeviceIdStore {
  constructor({ filePath, fsApi = fs, idFactory = () => crypto.randomUUID() } = {}) {
    if (!filePath || typeof filePath !== 'string') throw new TypeError('DeviceIdStore requires a filePath.')
    if (!fsApi || typeof fsApi.readFileSync !== 'function' || typeof fsApi.writeFileSync !== 'function') {
      throw new TypeError('DeviceIdStore requires a filesystem implementation.')
    }
    if (typeof idFactory !== 'function') throw new TypeError('DeviceIdStore idFactory must be a function.')
    this.filePath = filePath
    this.fs = fsApi
    this.idFactory = idFactory
    this.cachedId = null
  }

  read() {
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'))
      return isUuid(parsed?.deviceId) ? parsed.deviceId : null
    } catch {
      return null
    }
  }

  write(deviceId) {
    if (!isUuid(deviceId)) throw new TimerLeaseError('INVALID_DEVICE_ID', 'Device ID must be a UUID.')
    const directory = path.dirname(this.filePath)
    this.fs.mkdirSync(directory, { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
    const content = JSON.stringify({ version: 1, deviceId })
    try {
      this.fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 })
      // chmod is a best-effort hardening step; it is not meaningful on all
      // Windows filesystems, so failing it must not prevent lease acquisition.
      try { this.fs.chmodSync?.(temporaryPath, 0o600) } catch { /* best effort */ }
      this.fs.renameSync(temporaryPath, this.filePath)
    } catch (error) {
      try { this.fs.rmSync?.(temporaryPath, { force: true }) } catch { /* best effort */ }
      throw new TimerLeaseError('DEVICE_ID_PERSIST_FAILED', safeErrorMessage(error))
    }
  }

  getOrCreate() {
    if (this.cachedId) return this.cachedId
    const existing = this.read()
    if (existing) {
      this.cachedId = existing
      return existing
    }
    const generated = this.idFactory()
    if (!isUuid(generated)) throw new TimerLeaseError('INVALID_DEVICE_ID', 'The device ID factory did not return a UUID.')
    this.write(generated)
    this.cachedId = generated
    return generated
  }
}

/**
 * Coordinates the server-backed, per-account timer lease.  A local success is
 * only recorded after the Supabase RPC returns boolean true.  Any missing
 * configuration, missing auth, or network/RPC failure clears the local claim;
 * the app must never treat an offline request as an acquired lease.
 */
class TimerLeaseService {
  constructor({
    authService,
    userDataPath,
    deviceIdPath,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
    renewEveryMs,
    rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS,
    deviceIdStore,
    clock = () => new Date(),
    scheduler = { setInterval, clearInterval },
    timeoutScheduler = { setTimeout, clearTimeout },
  } = {}) {
    if (!authService || typeof authService.isConfigured !== 'function' || typeof authService.getAccessToken !== 'function') {
      throw new TypeError('TimerLeaseService requires authService.isConfigured() and authService.getAccessToken().')
    }
    if (typeof clock !== 'function') throw new TypeError('TimerLeaseService clock must be a function.')
    if (!scheduler || typeof scheduler.setInterval !== 'function' || typeof scheduler.clearInterval !== 'function') {
      throw new TypeError('TimerLeaseService scheduler must provide setInterval() and clearInterval().')
    }
    if (!timeoutScheduler || typeof timeoutScheduler.setTimeout !== 'function' || typeof timeoutScheduler.clearTimeout !== 'function') {
      throw new TypeError('TimerLeaseService timeoutScheduler must provide setTimeout() and clearTimeout().')
    }
    this.authService = authService
    this.leaseSeconds = normaliseLeaseSeconds(leaseSeconds)
    this.rpcTimeoutMs = normaliseRpcTimeoutMs(rpcTimeoutMs)
    this.renewEveryMs = renewEveryMs === undefined ? Math.floor(this.leaseSeconds * 1000 * 2 / 3) : renewEveryMs
    if (!Number.isInteger(this.renewEveryMs) || this.renewEveryMs < 1_000 || this.renewEveryMs >= this.leaseSeconds * 1000) {
      throw new TimerLeaseError('INVALID_RENEW_INTERVAL', 'Renew interval must be an integer of at least 1000 milliseconds and shorter than the lease duration.')
    }
    if (!deviceIdStore && (!userDataPath || typeof userDataPath !== 'string') && (!deviceIdPath || typeof deviceIdPath !== 'string')) {
      throw new TypeError('TimerLeaseService requires userDataPath, deviceIdPath, or deviceIdStore.')
    }
    this.deviceIdStore = deviceIdStore ?? new DeviceIdStore({ filePath: deviceIdPath ?? path.join(userDataPath, DEVICE_FILE_NAME) })
    this.clock = clock
    this.scheduler = scheduler
    this.timeoutScheduler = timeoutScheduler
    this.held = false
    this.lastOutcome = null
    this.lastAcquiredAt = null
    this.inFlight = null
    this.renewalTimer = null
  }

  getDeviceId() {
    return this.deviceIdStore.getOrCreate()
  }

  getStatus() {
    return {
      held: this.held,
      deviceId: this.held ? this.getDeviceId() : undefined,
      leaseSeconds: this.leaseSeconds,
      renewEveryMs: this.renewEveryMs,
      rpcTimeoutMs: this.rpcTimeoutMs,
      lastAcquiredAt: this.lastAcquiredAt ?? undefined,
      lastOutcome: this.lastOutcome,
      renewing: this.renewalTimer !== null,
    }
  }

  async acquire() {
    return this.requestLease('acquire')
  }

  async renew() {
    if (!this.held) {
      return this.failure('Cannot renew a timer lease that was not acquired locally.', 'no_local_lease')
    }
    return this.requestLease('renew')
  }

  /**
   * Schedules renewals only after a successful acquire. It does not acquire a
   * lease by itself, preventing a background task from unexpectedly taking a
   * timer lease while no timer is active.
   */
  startRenewal(onOutcome) {
    if (!this.held) {
      throw new TimerLeaseError('LEASE_NOT_HELD', 'Acquire a timer lease before scheduling renewal.')
    }
    this.stopRenewal({ forgetLease: false })
    this.renewalTimer = this.scheduler.setInterval(() => {
      void this.renew().then((outcome) => {
        if (typeof onOutcome === 'function') onOutcome(outcome)
        if (outcome.state !== 'acquired') this.stopRenewal()
      })
    }, this.renewEveryMs)
    this.renewalTimer.unref?.()
    return { renewEveryMs: this.renewEveryMs }
  }

  /**
   * There is intentionally no remote `release()` call. The deployed schema
   * only exposes acquire/renew, so pretending to release would be unsafe. On
   * session end, stop renewals and let the server lease expire naturally.
   */
  stopRenewal({ forgetLease = true } = {}) {
    this.cancelRenewalTimer()
    if (forgetLease) this.clearLocalClaim()
  }

  async requestLease(mode) {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.performLeaseRequest(mode).finally(() => { this.inFlight = null })
    return this.inFlight
  }

  async performLeaseRequest(mode) {
    let configured
    try {
      configured = this.authService.isConfigured()
    } catch (error) {
      return this.failure(safeErrorMessage(error), 'configuration_check_failed')
    }
    if (!configured) return this.notConfigured()

    let accessToken
    try {
      accessToken = await this.authService.getAccessToken()
    } catch (error) {
      return this.failure(safeErrorMessage(error), 'authentication_check_failed')
    }
    if (!accessToken) return this.notAuthenticated()

    const client = this.authService.client
    if (!client || typeof client.rpc !== 'function') {
      return this.failure('Supabase client is unavailable.', 'client_unavailable')
    }

    let deviceId
    try {
      deviceId = this.getDeviceId()
    } catch (error) {
      return this.failure(safeErrorMessage(error), 'device_id_unavailable')
    }

    try {
      const { data, error } = await this.waitForRpcResponse(client.rpc('workly_acquire_timer_lease', {
        p_device_id: deviceId,
        p_seconds: this.leaseSeconds,
      }, { headers: { Authorization: `Bearer ${accessToken}` } }), mode)
      if (error) return this.failure(safeErrorMessage(error), mode === 'renew' ? 'renew_request_failed' : 'acquire_request_failed')
      if (data === true) {
        const acquiredAt = this.now()
        this.held = true
        this.lastAcquiredAt = acquiredAt
        return this.record({ state: 'acquired', deviceId, leaseSeconds: this.leaseSeconds, acquiredAt, renewed: mode === 'renew' })
      }
      if (data === false) return this.heldByOther(deviceId)
      return this.failure('Timer lease RPC returned an invalid response.', 'invalid_rpc_response')
    } catch (error) {
      if (error instanceof TimerLeaseError && error.code === 'RPC_TIMEOUT') {
        return this.failure(error.message, mode === 'renew' ? 'renew_request_timed_out' : 'acquire_request_timed_out')
      }
      return this.failure(safeErrorMessage(error), mode === 'renew' ? 'renew_request_failed' : 'acquire_request_failed')
    }
  }

  /**
   * Supabase's RPC promise is not guaranteed to settle when the network stack
   * is offline. This wrapper settles independently at a bounded deadline.
   * Once the deadline wins, handlers attached to the original promise become
   * inert, so a late successful response cannot restore a lease already
   * declared failed locally.
   */
  waitForRpcResponse(rpcResponse, mode) {
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
          settle(reject, new TimerLeaseError('RPC_TIMEOUT', `Timer lease ${mode} request timed out after ${this.rpcTimeoutMs}ms.`))
        }, this.rpcTimeoutMs)
        // Do not keep Electron alive while it is closing solely for a lease
        // deadline. This is a no-op for browser-compatible test doubles.
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

  now() {
    const value = this.clock()
    const milliseconds = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
    if (!Number.isFinite(milliseconds)) throw new TimerLeaseError('INVALID_CLOCK', 'Timer lease clock returned an invalid timestamp.')
    return new Date(milliseconds).toISOString()
  }

  notConfigured() {
    this.clearLocalClaim()
    this.cancelRenewalTimer()
    return this.record({ state: 'not_configured' })
  }

  notAuthenticated() {
    this.clearLocalClaim()
    this.cancelRenewalTimer()
    return this.record({ state: 'not_authenticated' })
  }

  heldByOther(deviceId) {
    this.clearLocalClaim()
    this.cancelRenewalTimer()
    return this.record({ state: 'held_by_other', deviceId })
  }

  failure(error, reason) {
    this.clearLocalClaim()
    this.cancelRenewalTimer()
    return this.record({ state: 'failed', error, reason })
  }

  clearLocalClaim() {
    this.held = false
    this.lastAcquiredAt = null
  }

  cancelRenewalTimer() {
    if (this.renewalTimer !== null) this.scheduler.clearInterval(this.renewalTimer)
    this.renewalTimer = null
  }

  record(outcome) {
    this.lastOutcome = outcome
    return outcome
  }
}

module.exports = {
  DEFAULT_LEASE_SECONDS,
  DEFAULT_RPC_TIMEOUT_MS,
  DEVICE_FILE_NAME,
  DeviceIdStore,
  LEASE_OUTCOMES,
  MAX_LEASE_SECONDS,
  MIN_LEASE_SECONDS,
  TimerLeaseError,
  TimerLeaseService,
  isUuid,
  normaliseLeaseSeconds,
  normaliseRpcTimeoutMs,
}
