const fs = require('node:fs')
const path = require('node:path')

const SUPPORTED_CURRENCIES = new Set(['VND', 'USD', 'EUR', 'JPY', 'GBP'])
const DEFAULT_ENDPOINT = 'https://api.frankfurter.dev/v1/latest'
const MINOR_DIGITS = { VND: 0, USD: 2, EUR: 2, JPY: 0, GBP: 2 }

function validCurrency(value) {
  return typeof value === 'string' && SUPPORTED_CURRENCIES.has(value)
}

function parseCache(value) {
  if (!value || typeof value !== 'object' || !value.bases || typeof value.bases !== 'object') return { version: 1, bases: {} }
  const bases = {}
  for (const [base, quote] of Object.entries(value.bases)) {
    if (!validCurrency(base) || !quote || typeof quote !== 'object' || !quote.rates || typeof quote.rates !== 'object') continue
    const rates = {}
    for (const [currency, rate] of Object.entries(quote.rates)) {
      if (validCurrency(currency) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) rates[currency] = rate
    }
    if (Object.keys(rates).length > 0 && typeof quote.fetchedAt === 'string') {
      bases[base] = { provider: typeof quote.provider === 'string' ? quote.provider : 'Frankfurter', fetchedAt: quote.fetchedAt, sourceDate: typeof quote.sourceDate === 'string' ? quote.sourceDate : undefined, rates }
    }
  }
  return { version: 1, bases }
}

function minorToMajor(amountMinor, currency) {
  return amountMinor / (10 ** MINOR_DIGITS[currency])
}

function majorToMinor(amount, currency) {
  return Math.round(amount * (10 ** MINOR_DIGITS[currency]))
}

class FxService {
  constructor({ cacheFilePath, fetchImpl = globalThis.fetch, endpoint = process.env.TIMEFARM_FX_API_URL || process.env.WORKLY_FX_API_URL || DEFAULT_ENDPOINT, providerName = process.env.TIMEFARM_FX_PROVIDER_NAME || process.env.WORKLY_FX_PROVIDER_NAME || 'Frankfurter', now = () => Date.now() } = {}) {
    this.cacheFilePath = cacheFilePath
    this.fetchImpl = fetchImpl
    this.endpoint = endpoint
    this.providerName = providerName
    this.now = now
    this.cache = this.readCache()
    this.lastError = null
  }

  readCache() {
    if (!this.cacheFilePath) return { version: 1, bases: {} }
    try {
      return parseCache(JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8')))
    } catch {
      return { version: 1, bases: {} }
    }
  }

  persistCache() {
    if (!this.cacheFilePath) return
    try {
      fs.mkdirSync(path.dirname(this.cacheFilePath), { recursive: true })
      const temporary = `${this.cacheFilePath}.tmp`
      fs.writeFileSync(temporary, JSON.stringify(this.cache), { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(temporary, this.cacheFilePath)
    } catch {
      // Currency conversion remains optional; a cache write failure must not impact work tracking.
    }
  }

  getStatus(baseCurrency) {
    if (!validCurrency(baseCurrency)) return { state: 'unavailable', baseCurrency, provider: this.providerName, fetchedAt: null, sourceDate: null, rates: {}, error: 'Unsupported currency.' }
    const entry = this.cache.bases[baseCurrency]
    if (!entry) return { state: 'unavailable', baseCurrency, provider: this.providerName, fetchedAt: null, sourceDate: null, rates: {}, error: this.lastError }
    const ageMs = Math.max(0, this.now() - Date.parse(entry.fetchedAt))
    return {
      state: ageMs > 24 * 60 * 60 * 1000 ? 'stale' : 'available',
      baseCurrency,
      provider: entry.provider,
      fetchedAt: entry.fetchedAt,
      sourceDate: entry.sourceDate ?? null,
      rates: { ...entry.rates },
      error: this.lastError,
    }
  }

  async refresh(baseCurrency) {
    if (!validCurrency(baseCurrency)) return this.getStatus(baseCurrency)
    if (typeof this.fetchImpl !== 'function') {
      this.lastError = 'No network fetch implementation is available.'
      return this.getStatus(baseCurrency)
    }
    const symbols = [...SUPPORTED_CURRENCIES].filter((currency) => currency !== baseCurrency).join(',')
    const url = new URL(this.endpoint)
    url.searchParams.set('base', baseCurrency)
    url.searchParams.set('symbols', symbols)
    try {
      const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } })
      if (!response?.ok) throw new Error(`FX provider returned HTTP ${response?.status ?? 'error'}.`)
      const body = await response.json()
      if (body?.base !== baseCurrency || !body?.rates || typeof body.rates !== 'object') throw new Error('FX provider returned an invalid rate payload.')
      const rates = { [baseCurrency]: 1 }
      for (const [currency, rate] of Object.entries(body.rates)) {
        if (validCurrency(currency) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) rates[currency] = rate
      }
      if (Object.keys(rates).length < 2) throw new Error('FX provider returned no usable rates.')
      this.cache.bases[baseCurrency] = { provider: this.providerName, fetchedAt: new Date(this.now()).toISOString(), sourceDate: typeof body.date === 'string' ? body.date : undefined, rates }
      this.lastError = null
      this.persistCache()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'FX provider request failed.'
    }
    return this.getStatus(baseCurrency)
  }

  convert(money, targetCurrency, baseCurrency) {
    if (!money || !Number.isSafeInteger(money.amountMinor) || money.amountMinor < 0 || !validCurrency(money.currency) || !validCurrency(targetCurrency) || !validCurrency(baseCurrency)) return { ok: false, error: 'Invalid money conversion request.' }
    if (money.currency === targetCurrency) return { ok: true, money: { amountMinor: money.amountMinor, currency: targetCurrency }, rate: 1, fetchedAt: null }
    const entry = this.cache.bases[baseCurrency]
    if (!entry) return { ok: false, error: 'No verified FX rate is cached for this account currency.' }
    const fromRate = entry.rates[money.currency]
    const targetRate = entry.rates[targetCurrency]
    if (!fromRate || !targetRate) return { ok: false, error: 'No verified FX rate is cached for this currency pair.' }
    const baseMajor = minorToMajor(money.amountMinor, money.currency) / fromRate
    const targetMajor = baseMajor * targetRate
    const amountMinor = majorToMinor(targetMajor, targetCurrency)
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return { ok: false, error: 'Converted value is out of range.' }
    return { ok: true, money: { amountMinor, currency: targetCurrency }, rate: targetRate / fromRate, fetchedAt: entry.fetchedAt, provider: entry.provider }
  }
}

module.exports = { DEFAULT_ENDPOINT, FxService, MINOR_DIGITS, SUPPORTED_CURRENCIES, parseCache }
