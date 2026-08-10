const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { FxService } = require('./fx-service.cjs')

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workly-fx-test-'))
  try { callback(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

test('refreshes a verified provider payload, persists it, and converts with minor-unit precision', async () => {
  await new Promise((resolve, reject) => withTempDirectory((directory) => {
    const now = Date.parse('2026-08-10T10:00:00.000Z')
    const service = new FxService({
      cacheFilePath: path.join(directory, 'fx.json'),
      now: () => now,
      fetchImpl: async (url) => {
        assert.equal(new URL(url).searchParams.get('base'), 'USD')
        return { ok: true, json: async () => ({ base: 'USD', date: '2026-08-08', rates: { EUR: 0.8, VND: 25_000, JPY: 150, GBP: 0.7 } }) }
      },
    })
    service.refresh('USD').then((status) => {
      assert.equal(status.state, 'available')
      assert.equal(status.rates.EUR, 0.8)
      assert.equal(status.sourceDate, '2026-08-08')
      const converted = service.convert({ amountMinor: 12_500, currency: 'USD' }, 'EUR', 'USD')
      assert.deepEqual(converted, { ok: true, money: { amountMinor: 10_000, currency: 'EUR' }, rate: 0.8, fetchedAt: '2026-08-10T10:00:00.000Z', provider: 'Frankfurter' })
      assert.ok(fs.existsSync(path.join(directory, 'fx.json')))
      resolve()
    }, reject)
  }))
})

test('keeps the last verified cache when the provider is unavailable and never fabricates a rate', async () => {
  await new Promise((resolve, reject) => withTempDirectory((directory) => {
    const cachePath = path.join(directory, 'fx.json')
    fs.writeFileSync(cachePath, JSON.stringify({ version: 1, bases: { VND: { provider: 'Frankfurter', fetchedAt: '2026-08-01T00:00:00.000Z', rates: { VND: 1, USD: 0.00004 } } } }))
    const service = new FxService({ cacheFilePath: cachePath, now: () => Date.parse('2026-08-10T00:00:00.000Z'), fetchImpl: async () => { throw new Error('offline') } })
    service.refresh('VND').then((status) => {
      assert.equal(status.state, 'stale')
      assert.match(status.error, /offline/)
      assert.equal(service.convert({ amountMinor: 100_000, currency: 'VND' }, 'USD', 'VND').ok, true)
      assert.equal(service.convert({ amountMinor: 1, currency: 'EUR' }, 'USD', 'VND').ok, false)
      resolve()
    }, reject)
  }))
})
