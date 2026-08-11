const fs = require("node:fs");
const path = require("node:path");

const SUPPORTED_CURRENCIES = new Set(["VND", "USD", "EUR", "JPY", "GBP"]);
const DEFAULT_ENDPOINT = "https://api.frankfurter.dev/v2/rates";
const CACHE_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const MAX_SOURCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MINOR_DIGITS = { VND: 0, USD: 2, EUR: 2, JPY: 0, GBP: 2 };

function validCurrency(value) {
  return typeof value === "string" && SUPPORTED_CURRENCIES.has(value);
}

function parseCache(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !value.bases ||
    typeof value.bases !== "object"
  )
    return { version: 1, bases: {} };
  const bases = {};
  for (const [base, quote] of Object.entries(value.bases)) {
    if (
      !validCurrency(base) ||
      !quote ||
      typeof quote !== "object" ||
      !quote.rates ||
      typeof quote.rates !== "object"
    )
      continue;
    const rates = {};
    for (const [currency, rate] of Object.entries(quote.rates)) {
      if (
        validCurrency(currency) &&
        typeof rate === "number" &&
        Number.isFinite(rate) &&
        rate > 0
      )
        rates[currency] = rate;
    }
    if (Object.keys(rates).length > 0 && typeof quote.fetchedAt === "string") {
      bases[base] = {
        provider:
          typeof quote.provider === "string" ? quote.provider : "Frankfurter",
        fetchedAt: quote.fetchedAt,
        sourceDate:
          typeof quote.sourceDate === "string" ? quote.sourceDate : undefined,
        rates,
      };
    }
  }
  return { version: 1, bases };
}

function minorToMajor(amountMinor, currency) {
  return amountMinor / 10 ** MINOR_DIGITS[currency];
}

function majorToMinor(amount, currency) {
  return Math.round(amount * 10 ** MINOR_DIGITS[currency]);
}

function sourceDateEpoch(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return Number.NaN;
  return Date.parse(`${value}T00:00:00.000Z`);
}

function hasCompleteRates(rates) {
  return [...SUPPORTED_CURRENCIES].every(
    (currency) =>
      typeof rates?.[currency] === "number" &&
      Number.isFinite(rates[currency]) &&
      rates[currency] > 0,
  );
}

function staleReasons(entry, now) {
  const reasons = [];
  const fetchedAt = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(fetchedAt)) reasons.push("invalid_cache_time");
  else if (now - fetchedAt > CACHE_FRESHNESS_MS)
    reasons.push("cache_older_than_24_hours");
  else if (fetchedAt - now > SOURCE_FUTURE_TOLERANCE_MS)
    reasons.push("cache_time_is_in_the_future");
  const sourceAt = sourceDateEpoch(entry.sourceDate);
  if (!Number.isFinite(sourceAt))
    reasons.push("missing_or_invalid_source_date");
  else if (now - sourceAt > MAX_SOURCE_AGE_MS)
    reasons.push("source_older_than_7_days");
  else if (sourceAt - now > SOURCE_FUTURE_TOLERANCE_MS)
    reasons.push("source_date_is_in_the_future");
  if (!hasCompleteRates(entry.rates))
    reasons.push("incomplete_supported_currency_set");
  return reasons;
}

function normalizedProviderPayload(body, baseCurrency) {
  if (Array.isArray(body)) {
    const rates = { [baseCurrency]: 1 };
    const dates = [];
    for (const item of body) {
      if (
        !item ||
        item.base !== baseCurrency ||
        !validCurrency(item.quote) ||
        item.quote === baseCurrency ||
        typeof item.rate !== "number" ||
        !Number.isFinite(item.rate) ||
        item.rate <= 0 ||
        !Number.isFinite(sourceDateEpoch(item.date))
      )
        throw new Error("FX provider returned an invalid v2 rate payload.");
      rates[item.quote] = item.rate;
      dates.push(item.date);
    }
    return { rates, sourceDate: dates.sort()[0] };
  }
  if (
    !body ||
    body.base !== baseCurrency ||
    !body.rates ||
    typeof body.rates !== "object" ||
    !Number.isFinite(sourceDateEpoch(body.date))
  )
    throw new Error("FX provider returned an invalid rate payload.");
  const rates = { [baseCurrency]: 1 };
  for (const [currency, rate] of Object.entries(body.rates)) {
    if (
      validCurrency(currency) &&
      typeof rate === "number" &&
      Number.isFinite(rate) &&
      rate > 0
    )
      rates[currency] = rate;
  }
  return { rates, sourceDate: body.date };
}

class FxService {
  /** @param {{cacheFilePath?: string, fetchImpl?: typeof globalThis.fetch, endpoint?: string, providerName?: string, now?: () => number, requestTimeoutMs?: number}} options */
  constructor({
    cacheFilePath,
    fetchImpl = globalThis.fetch,
    endpoint = process.env.TIMEFARM_FX_API_URL ||
      process.env.WORKLY_FX_API_URL ||
      DEFAULT_ENDPOINT,
    providerName = process.env.TIMEFARM_FX_PROVIDER_NAME ||
      process.env.WORKLY_FX_PROVIDER_NAME ||
      "Frankfurter",
    now = () => Date.now(),
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    this.cacheFilePath = cacheFilePath;
    this.fetchImpl = fetchImpl;
    this.endpoint = endpoint;
    this.providerName = providerName;
    this.now = now;
    this.requestTimeoutMs =
      Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
        ? requestTimeoutMs
        : DEFAULT_REQUEST_TIMEOUT_MS;
    this.cache = this.readCache();
    this.lastError = null;
  }

  readCache() {
    if (!this.cacheFilePath) return { version: 1, bases: {} };
    try {
      return parseCache(
        JSON.parse(fs.readFileSync(this.cacheFilePath, "utf8")),
      );
    } catch {
      return { version: 1, bases: {} };
    }
  }

  persistCache() {
    if (!this.cacheFilePath) return;
    try {
      fs.mkdirSync(path.dirname(this.cacheFilePath), { recursive: true });
      const temporary = `${this.cacheFilePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.cache), {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(temporary, this.cacheFilePath);
    } catch {
      // Currency conversion remains optional; a cache write failure must not impact work tracking.
    }
  }

  getStatus(baseCurrency) {
    if (!validCurrency(baseCurrency))
      return {
        state: "unavailable",
        baseCurrency,
        provider: this.providerName,
        fetchedAt: null,
        sourceDate: null,
        rates: {},
        error: "Unsupported currency.",
        staleReasons: [],
      };
    const entry = this.cache.bases[baseCurrency];
    if (!entry)
      return {
        state: "unavailable",
        baseCurrency,
        provider: this.providerName,
        fetchedAt: null,
        sourceDate: null,
        rates: {},
        error: this.lastError,
        staleReasons: [],
      };
    const reasons = staleReasons(entry, this.now());
    return {
      state: reasons.length > 0 ? "stale" : "available",
      baseCurrency,
      provider: entry.provider,
      fetchedAt: entry.fetchedAt,
      sourceDate: entry.sourceDate ?? null,
      rates: { ...entry.rates },
      error: this.lastError,
      staleReasons: reasons,
    };
  }

  async refresh(baseCurrency) {
    if (!validCurrency(baseCurrency)) return this.getStatus(baseCurrency);
    if (typeof this.fetchImpl !== "function") {
      this.lastError = "No network fetch implementation is available.";
      return this.getStatus(baseCurrency);
    }
    const symbols = [...SUPPORTED_CURRENCIES]
      .filter((currency) => currency !== baseCurrency)
      .join(",");
    let timeout;
    try {
      const url = new URL(this.endpoint);
      if (
        url.protocol !== "https:" &&
        url.hostname !== "localhost" &&
        url.hostname !== "127.0.0.1"
      )
        throw new Error("FX provider endpoint must use HTTPS.");
      url.searchParams.set("base", baseCurrency);
      url.searchParams.set(
        url.pathname.includes("/v2/") ? "quotes" : "symbols",
        symbols,
      );
      const abortController = new AbortController();
      timeout = setTimeout(
        () => abortController.abort(),
        this.requestTimeoutMs,
      );
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: abortController.signal,
      });
      if (!response?.ok)
        throw new Error(
          `FX provider returned HTTP ${response?.status ?? "error"}.`,
        );
      const { rates, sourceDate } = normalizedProviderPayload(
        await response.json(),
        baseCurrency,
      );
      if (!hasCompleteRates(rates))
        throw new Error(
          "FX provider did not return every supported currency rate.",
        );
      const sourceAt = sourceDateEpoch(sourceDate);
      const now = this.now();
      if (now - sourceAt > MAX_SOURCE_AGE_MS)
        throw new Error("FX provider source date is older than 7 days.");
      if (sourceAt - now > SOURCE_FUTURE_TOLERANCE_MS)
        throw new Error("FX provider source date is in the future.");
      this.cache.bases[baseCurrency] = {
        provider: this.providerName,
        fetchedAt: new Date(now).toISOString(),
        sourceDate,
        rates,
      };
      this.lastError = null;
      this.persistCache();
    } catch (error) {
      this.lastError =
        error instanceof Error && error.name === "AbortError"
          ? `FX provider request timed out after ${this.requestTimeoutMs}ms.`
          : error instanceof Error
            ? error.message
            : "FX provider request failed.";
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    return this.getStatus(baseCurrency);
  }

  convert(money, targetCurrency, baseCurrency) {
    if (
      !money ||
      !Number.isSafeInteger(money.amountMinor) ||
      money.amountMinor < 0 ||
      !validCurrency(money.currency) ||
      !validCurrency(targetCurrency) ||
      !validCurrency(baseCurrency)
    )
      return { ok: false, error: "Invalid money conversion request." };
    if (money.currency === targetCurrency)
      return {
        ok: true,
        money: { amountMinor: money.amountMinor, currency: targetCurrency },
        rate: 1,
        fetchedAt: null,
      };
    const entry = this.cache.bases[baseCurrency];
    if (!entry)
      return {
        ok: false,
        error: "No verified FX rate is cached for this account currency.",
      };
    const fromRate = entry.rates[money.currency];
    const targetRate = entry.rates[targetCurrency];
    if (!fromRate || !targetRate)
      return {
        ok: false,
        error: "No verified FX rate is cached for this currency pair.",
      };
    const baseMajor =
      minorToMajor(money.amountMinor, money.currency) / fromRate;
    const targetMajor = baseMajor * targetRate;
    const amountMinor = majorToMinor(targetMajor, targetCurrency);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
      return { ok: false, error: "Converted value is out of range." };
    return {
      ok: true,
      money: { amountMinor, currency: targetCurrency },
      rate: targetRate / fromRate,
      fetchedAt: entry.fetchedAt,
      provider: entry.provider,
    };
  }
}

module.exports = {
  CACHE_FRESHNESS_MS,
  DEFAULT_ENDPOINT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  FxService,
  MAX_SOURCE_AGE_MS,
  MINOR_DIGITS,
  SUPPORTED_CURRENCIES,
  parseCache,
};
