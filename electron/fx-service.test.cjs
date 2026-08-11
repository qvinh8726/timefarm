const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { FxService } = require("./fx-service.cjs");

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workly-fx-test-"));
  try {
    callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("refreshes a verified provider payload, persists it, and converts with minor-unit precision", async () => {
  await new Promise((resolve, reject) =>
    withTempDirectory((directory) => {
      const now = Date.parse("2026-08-10T10:00:00.000Z");
      const service = new FxService({
        cacheFilePath: path.join(directory, "fx.json"),
        now: () => now,
        fetchImpl: async (url, options) => {
          assert.equal(new URL(url).searchParams.get("base"), "USD");
          assert.equal(
            new URL(url).searchParams.get("quotes"),
            "VND,EUR,JPY,GBP",
          );
          assert.ok(options.signal instanceof AbortSignal);
          return {
            ok: true,
            json: async () => ({
              base: "USD",
              date: "2026-08-08",
              rates: { EUR: 0.8, VND: 25_000, JPY: 150, GBP: 0.7 },
            }),
          };
        },
      });
      service.refresh("USD").then((status) => {
        assert.equal(status.state, "available");
        assert.equal(status.rates.EUR, 0.8);
        assert.equal(status.sourceDate, "2026-08-08");
        const converted = service.convert(
          { amountMinor: 12_500, currency: "USD" },
          "EUR",
          "USD",
        );
        assert.deepEqual(converted, {
          ok: true,
          money: { amountMinor: 10_000, currency: "EUR" },
          rate: 0.8,
          fetchedAt: "2026-08-10T10:00:00.000Z",
          provider: "Frankfurter",
        });
        assert.ok(fs.existsSync(path.join(directory, "fx.json")));
        resolve();
      }, reject);
    }),
  );
});

test("rejects incomplete or old provider data instead of caching an unverifiable matrix", async () => {
  const now = Date.parse("2026-08-10T10:00:00.000Z");
  const incomplete = new FxService({
    now: () => now,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [
        { date: "2026-08-09", base: "USD", quote: "VND", rate: 25_000 },
        { date: "2026-08-09", base: "USD", quote: "EUR", rate: 0.8 },
        { date: "2026-08-09", base: "USD", quote: "JPY", rate: 150 },
      ],
    }),
  });
  const incompleteStatus = await incomplete.refresh("USD");
  assert.equal(incompleteStatus.state, "unavailable");
  assert.match(incompleteStatus.error, /every supported currency/);

  const old = new FxService({
    now: () => now,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        base: "USD",
        date: "2026-07-01",
        rates: { VND: 25_000, EUR: 0.8, JPY: 150, GBP: 0.7 },
      }),
    }),
  });
  const oldStatus = await old.refresh("USD");
  assert.equal(oldStatus.state, "unavailable");
  assert.match(oldStatus.error, /older than 7 days/);
});

test("bounds provider latency and reports a timeout without replacing cache", async () => {
  const service = new FxService({
    requestTimeoutMs: 5,
    fetchImpl: (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });
  const status = await service.refresh("EUR");
  assert.equal(status.state, "unavailable");
  assert.match(status.error, /timed out after 5ms/);
});

test("keeps the last verified cache when the provider is unavailable and never fabricates a rate", async () => {
  await new Promise((resolve, reject) =>
    withTempDirectory((directory) => {
      const cachePath = path.join(directory, "fx.json");
      fs.writeFileSync(
        cachePath,
        JSON.stringify({
          version: 1,
          bases: {
            VND: {
              provider: "Frankfurter",
              fetchedAt: "2026-08-01T00:00:00.000Z",
              rates: { VND: 1, USD: 0.00004 },
            },
          },
        }),
      );
      const service = new FxService({
        cacheFilePath: cachePath,
        now: () => Date.parse("2026-08-10T00:00:00.000Z"),
        fetchImpl: async () => {
          throw new Error("offline");
        },
      });
      service.refresh("VND").then((status) => {
        assert.equal(status.state, "stale");
        assert.match(status.error, /offline/);
        assert.equal(
          service.convert(
            { amountMinor: 100_000, currency: "VND" },
            "USD",
            "VND",
          ).ok,
          true,
        );
        assert.equal(
          service.convert({ amountMinor: 1, currency: "EUR" }, "USD", "VND").ok,
          false,
        );
        resolve();
      }, reject);
    }),
  );
});
