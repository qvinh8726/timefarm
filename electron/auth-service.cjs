const fs = require("node:fs");
const path = require("node:path");
const { randomBytes: secureRandomBytes } = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { assertCloudConfiguration } = require("./cloud-configuration.cjs");

// Auth hydration is allowed to improve a local session, never to hold up the
// local-first timer path. Keep this comfortably below the timer-lease RPC
// deadline (5 seconds) while allowing a normal online refresh to complete.
const DEFAULT_HYDRATION_TIMEOUT_MS = 1_500;
// Interactive authentication is expected to take longer than background
// hydration, but it must still release the renderer when the network stalls.
const DEFAULT_OPERATION_TIMEOUT_MS = 15_000;
const OAUTH_PENDING_TTL_MS = 10 * 60_000;
const OAUTH_PENDING_VERSION = 1;
// Keep this storage namespace separate from the persisted Supabase session.
// It contains only the short-lived PKCE verifier slots that Supabase needs to
// exchange the callback code after a desktop restart.
const OAUTH_PKCE_STORAGE_KEY = "workly-oauth-pkce";
const PKCE_FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function oauthVerifierStorageKey(flowId) {
  return `${OAUTH_PKCE_STORAGE_KEY}-flow-${flowId}-code-verifier`;
}

function oauthVerifierIndexStorageKey() {
  return `${OAUTH_PKCE_STORAGE_KEY}-flows-code-verifier`;
}

function oauthLegacyVerifierStorageKey() {
  return `${OAUTH_PKCE_STORAGE_KEY}-code-verifier`;
}

function isValidPkceFlowId(value) {
  return typeof value === "string" && PKCE_FLOW_ID_PATTERN.test(value);
}

function isValidOAuthState(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 2_048;
}

function addTimeFarmOAuthState(redirectUrl, state) {
  const parsed = new URL(redirectUrl);
  if (
    parsed.protocol !== "timefarm:" ||
    parsed.hostname !== "auth" ||
    parsed.port ||
    parsed.pathname !== "/callback" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error("Google sign-in must use the TimeFarm callback route.");
  }
  // This nonce is TimeFarm-owned. Do not accept a caller-provided value that
  // could otherwise turn callback verification into a predictable check.
  parsed.searchParams.delete("timefarm_state");
  parsed.searchParams.set("timefarm_state", state);
  return parsed.toString();
}

function parseStoredPkceVerifier(value) {
  if (typeof value !== "string") return null;
  try {
    const verifier = JSON.parse(value);
    return typeof verifier === "string" &&
      verifier.length >= 43 &&
      verifier.length <= 128
      ? verifier
      : null;
  } catch {
    return null;
  }
}

function normalizePendingOAuth(value, now = Date.now()) {
  if (
    !value ||
    typeof value !== "object" ||
    value.version !== OAUTH_PENDING_VERSION
  )
    return null;
  if (!isValidOAuthState(value.state) || !isValidPkceFlowId(value.flowId))
    return null;
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now)
    return null;
  if (
    !value.pkce ||
    typeof value.pkce !== "object" ||
    Array.isArray(value.pkce)
  )
    return null;

  const allowedKeys = new Set([
    oauthVerifierStorageKey(value.flowId),
    oauthVerifierIndexStorageKey(),
    oauthLegacyVerifierStorageKey(),
  ]);
  const entries = Object.entries(value.pkce);
  if (
    entries.length === 0 ||
    entries.some(
      ([key, stored]) => !allowedKeys.has(key) || typeof stored !== "string",
    )
  )
    return null;

  const verifierKey = oauthVerifierStorageKey(value.flowId);
  const verifier = parseStoredPkceVerifier(value.pkce[verifierKey]);
  if (!verifier) return null;

  const legacyVerifier = value.pkce[oauthLegacyVerifierStorageKey()];
  if (
    legacyVerifier !== undefined &&
    parseStoredPkceVerifier(legacyVerifier) !== verifier
  )
    return null;

  const storedIndex = value.pkce[oauthVerifierIndexStorageKey()];
  if (storedIndex !== undefined) {
    try {
      const index = JSON.parse(storedIndex);
      if (
        !Array.isArray(index) ||
        index.length !== 1 ||
        index[0] !== value.flowId
      )
        return null;
    } catch {
      return null;
    }
  }

  return {
    state: value.state,
    flowId: value.flowId,
    expiresAt: value.expiresAt,
    pkce: Object.fromEntries(entries),
  };
}

function readBundledConfiguration() {
  const candidates = [
    path.join(__dirname, "timefarm.config.json"),
    process.resourcesPath
      ? path.join(process.resourcesPath, "timefarm.config.json")
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (value && typeof value === "object" && !Array.isArray(value))
        return value;
    } catch {
      /* optional bundled configuration */
    }
  }
  return {};
}

function readConfiguration(
  environment = process.env,
  bundledConfiguration = environment === process.env
    ? readBundledConfiguration()
    : {},
) {
  const environmentUrl =
    environment.TIMEFARM_SUPABASE_URL ||
    environment.WORKLY_SUPABASE_URL ||
    environment.VITE_SUPABASE_URL;
  const environmentAnonKey =
    environment.TIMEFARM_SUPABASE_ANON_KEY ||
    environment.WORKLY_SUPABASE_ANON_KEY ||
    environment.VITE_SUPABASE_ANON_KEY;
  const hasEnvironmentConfiguration = Boolean(
    environmentUrl || environmentAnonKey,
  );
  const bundled = bundledConfiguration ?? {};
  if (!hasEnvironmentConfiguration && bundled.mode === "offline")
    return { configured: false };
  // URL and key form one configuration boundary. Never combine an override
  // for one half with an ASAR-bundled value for the other half.
  const url = hasEnvironmentConfiguration
    ? environmentUrl || ""
    : bundled.supabaseUrl || "";
  const anonKey = hasEnvironmentConfiguration
    ? environmentAnonKey || ""
    : bundled.supabaseAnonKey || "";
  const redirectUrl =
    environment.TIMEFARM_OAUTH_REDIRECT_URL ||
    environment.WORKLY_OAUTH_REDIRECT_URL ||
    bundled.oauthRedirectUrl ||
    "timefarm://auth/callback";
  try {
    return assertCloudConfiguration({ url, anonKey, redirectUrl });
  } catch {
    return { configured: false };
  }
}

function sanitizeUser(user) {
  if (!user || typeof user.id !== "string" || !user.id) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    displayName:
      typeof user.displayName === "string"
        ? user.displayName
        : typeof user.user_metadata?.display_name === "string"
          ? user.user_metadata.display_name
          : typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : null,
  };
}

/**
 * A stored session can outlive a network connection.  Keep the last verified,
 * non-sensitive user identity beside the encrypted session so the desktop app
 * can continue to identify its local account while Supabase is unreachable.
 *
 * Version 1 also accepts the legacy format where the raw Supabase session was
 * stored directly.  Supabase sessions commonly carry `user`, so those users
 * are migrated in memory the next time a fresh session is persisted.
 */
function normalizeStoredSession(value) {
  if (!value || typeof value !== "object") return null;
  if (
    value.version === 1 &&
    value.session &&
    typeof value.session === "object"
  ) {
    return {
      session: value.session,
      user: sanitizeUser(value.user) ?? sanitizeUser(value.session.user),
    };
  }
  if (
    typeof value.access_token === "string" ||
    typeof value.refresh_token === "string"
  ) {
    return { session: value, user: sanitizeUser(value.user) };
  }
  return null;
}

function errorStatus(error) {
  const candidate = error?.status ?? error?.statusCode;
  const numeric = typeof candidate === "number" ? candidate : Number(candidate);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Network failures must never be mistaken for a revoked credential.  Only
 * auth responses that are unambiguously rejected are allowed to remove the
 * encrypted local session.
 */
function isDefinitiveCredentialError(error) {
  const status = errorStatus(error);
  if (status === 401 || status === 403) return true;

  const code = String(error?.code ?? error?.error_code ?? "").toLowerCase();
  if (
    new Set([
      "bad_jwt",
      "invalid_jwt",
      "invalid_grant",
      "invalid_token",
      "invalid_refresh_token",
      "refresh_token_not_found",
      "refresh_token_already_used",
      "session_not_found",
      "token_not_found",
    ]).has(code)
  )
    return true;

  const message = String(error?.message ?? "").toLowerCase();
  return /\b(?:invalid|malformed) (?:jwt|token)\b|\b(?:jwt|token) (?:is )?(?:invalid|malformed)\b|\brefresh token (?:is )?(?:invalid|not found|revoked)\b|\bsession (?:not found|revoked)\b/.test(
    message,
  );
}

function offlineStatus(user) {
  return {
    configured: true,
    authenticated: Boolean(user),
    user: user ?? null,
    offline: true,
    error:
      "Unable to verify this session while offline. Local data remains available on this device.",
  };
}

function normaliseTimeoutMs(value, label) {
  if (!Number.isInteger(value) || value < 1)
    throw new TypeError(
      `Auth ${label} timeout must be a positive integer number of milliseconds.`,
    );
  return value;
}

class SupabaseAuthService {
  constructor({
    userDataPath,
    safeStorage,
    fileSystem = fs,
    environment = process.env,
    hydrationTimeoutMs = DEFAULT_HYDRATION_TIMEOUT_MS,
    operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    timeoutScheduler = { setTimeout, clearTimeout },
    now = () => Date.now(),
    randomBytes = secureRandomBytes,
  }) {
    if (
      !timeoutScheduler ||
      typeof timeoutScheduler.setTimeout !== "function" ||
      typeof timeoutScheduler.clearTimeout !== "function"
    ) {
      throw new TypeError(
        "Auth timeoutScheduler must provide setTimeout() and clearTimeout().",
      );
    }
    if (typeof now !== "function")
      throw new TypeError("Auth now must be a function.");
    if (typeof randomBytes !== "function")
      throw new TypeError("Auth randomBytes must be a function.");
    if (
      !fileSystem ||
      typeof fileSystem.existsSync !== "function" ||
      typeof fileSystem.lstatSync !== "function" ||
      typeof fileSystem.readFileSync !== "function" ||
      typeof fileSystem.writeFileSync !== "function" ||
      typeof fileSystem.rmSync !== "function"
    ) {
      throw new TypeError(
        "Auth fileSystem must provide synchronous read, write, stat, existence, and removal operations.",
      );
    }
    this.safeStorage = safeStorage;
    this.fileSystem = fileSystem;
    this.configuration = readConfiguration(environment);
    this.sessionPath = path.join(userDataPath, "auth-session.bin");
    this.pendingOAuthPath = path.join(userDataPath, "auth-oauth-pending.bin");
    this.hydrationTimeoutMs = normaliseTimeoutMs(
      hydrationTimeoutMs,
      "hydration",
    );
    this.operationTimeoutMs = normaliseTimeoutMs(
      operationTimeoutMs,
      "operation",
    );
    this.timeoutScheduler = timeoutScheduler;
    this.now = now;
    this.randomBytes = randomBytes;
    this.pendingOAuthState = null;
    this.pendingOAuthFlowId = null;
    this.pendingOAuthExpiresAt = 0;
    this.pendingOAuthStorageItems = {};
    this.authGeneration = 0;
    this.loadPendingOAuth();
    this.pendingOAuthStorage = this.createPendingOAuthStorage();
    this.client = this.configuration.configured
      ? createClient(this.configuration.url, this.configuration.anonKey, {
          auth: {
            autoRefreshToken: false,
            // Supabase only honors a custom storage adapter when persistence is
            // enabled. This adapter accepts PKCE keys only and drops session
            // writes, while TimeFarm continues to own session persistence below.
            persistSession: true,
            detectSessionInUrl: false,
            flowType: "pkce",
            storageKey: OAUTH_PKCE_STORAGE_KEY,
            storage: this.pendingOAuthStorage,
            experimental: { appendPkceFlowIdToRedirects: true },
          },
        })
      : null;
  }

  isConfigured() {
    return this.configuration.configured;
  }

  createPendingOAuthStorage() {
    return {
      getItem: async (key) => this.getPendingOAuthStorageItem(key),
      setItem: async (key, value) =>
        this.setPendingOAuthStorageItem(key, value),
      removeItem: async (key) => this.removePendingOAuthStorageItem(key),
    };
  }

  isPendingOAuthPkceStorageKey(key) {
    if (
      key === oauthVerifierIndexStorageKey() ||
      key === oauthLegacyVerifierStorageKey()
    )
      return true;
    return (
      typeof key === "string" &&
      new RegExp(
        `^${OAUTH_PKCE_STORAGE_KEY}-flow-[A-Za-z0-9_-]{8,64}-code-verifier$`,
      ).test(key)
    );
  }

  getPendingOAuthStorageItem(key) {
    if (!this.isPendingOAuthPkceStorageKey(key)) return null;
    return this.pendingOAuthStorageItems[key] ?? null;
  }

  setPendingOAuthStorageItem(key, value) {
    // Supabase also uses this adapter for an ephemeral in-memory session once
    // an exchange succeeds. Deliberately ignore every non-PKCE key so session
    // material cannot land in the pending OAuth file.
    if (!this.isPendingOAuthPkceStorageKey(key) || typeof value !== "string")
      return;
    this.pendingOAuthStorageItems[key] = value;
  }

  removePendingOAuthStorageItem(key) {
    if (!this.isPendingOAuthPkceStorageKey(key)) return;
    delete this.pendingOAuthStorageItems[key];
  }

  isSecureStorageAvailable() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  createOAuthState() {
    const bytes = this.randomBytes(32);
    if (!bytes || typeof bytes.length !== "number" || bytes.length !== 32) {
      throw new Error(
        "Unable to generate a cryptographically secure Google sign-in state.",
      );
    }
    return Buffer.from(bytes).toString("base64url");
  }

  loadPendingOAuth() {
    if (
      !this.isSecureStorageAvailable() ||
      !this.fileSystem.existsSync(this.pendingOAuthPath)
    )
      return null;
    try {
      const encrypted = Buffer.from(
        this.fileSystem.readFileSync(this.pendingOAuthPath, "utf8"),
        "base64",
      );
      const pending = normalizePendingOAuth(
        JSON.parse(this.safeStorage.decryptString(encrypted)),
        this.now(),
      );
      if (!pending)
        throw new Error("Stored OAuth continuation is malformed or expired.");
      this.pendingOAuthState = pending.state;
      this.pendingOAuthFlowId = pending.flowId;
      this.pendingOAuthExpiresAt = pending.expiresAt;
      this.pendingOAuthStorageItems = { ...pending.pkce };
      return pending;
    } catch {
      this.clearPendingOAuth();
      return null;
    }
  }

  getPendingOAuth() {
    const pending = normalizePendingOAuth(
      {
        version: OAUTH_PENDING_VERSION,
        state: this.pendingOAuthState,
        flowId: this.pendingOAuthFlowId,
        expiresAt: this.pendingOAuthExpiresAt,
        pkce: this.pendingOAuthStorageItems,
      },
      this.now(),
    );
    if (pending) return pending;
    this.clearPendingOAuth();
    return null;
  }

  persistPendingOAuth(
    state,
    flowId,
    expiresAt = this.now() + OAUTH_PENDING_TTL_MS,
  ) {
    if (!this.isSecureStorageAvailable())
      throw new Error(
        "Secure credential storage is unavailable on this device.",
      );
    const pending = normalizePendingOAuth(
      {
        version: OAUTH_PENDING_VERSION,
        state,
        flowId,
        expiresAt,
        pkce: this.pendingOAuthStorageItems,
      },
      this.now(),
    );
    if (!pending)
      throw new Error(
        "Google sign-in could not establish a valid PKCE continuation.",
      );
    const encrypted = this.safeStorage
      .encryptString(
        JSON.stringify({ version: OAUTH_PENDING_VERSION, ...pending }),
      )
      .toString("base64");
    this.fileSystem.writeFileSync(this.pendingOAuthPath, encrypted, {
      encoding: "utf8",
      mode: 0o600,
    });
    this.pendingOAuthState = pending.state;
    this.pendingOAuthFlowId = pending.flowId;
    this.pendingOAuthExpiresAt = pending.expiresAt;
  }

  clearPendingOAuth() {
    this.pendingOAuthState = null;
    this.pendingOAuthFlowId = null;
    this.pendingOAuthExpiresAt = 0;
    this.pendingOAuthStorageItems = {};
    try {
      this.fileSystem.rmSync(this.pendingOAuthPath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }

  consumePendingOAuth() {
    const pending = this.getPendingOAuth();
    if (!pending) return null;
    // Delete durable state before any network call. The in-memory verifier is
    // retained only long enough for this one exchange, making restarts and
    // repeated callbacks unable to replay the code.
    this.pendingOAuthState = null;
    this.pendingOAuthFlowId = null;
    this.pendingOAuthExpiresAt = 0;
    try {
      this.fileSystem.rmSync(this.pendingOAuthPath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    return pending;
  }

  readStoredSession() {
    if (
      !this.safeStorage?.isEncryptionAvailable?.() ||
      !this.fileSystem.existsSync(this.sessionPath)
    )
      return null;
    try {
      const encrypted = Buffer.from(
        this.fileSystem.readFileSync(this.sessionPath, "utf8"),
        "base64",
      );
      const stored = normalizeStoredSession(
        JSON.parse(this.safeStorage.decryptString(encrypted)),
      );
      if (!stored)
        throw new Error("Stored authentication session is malformed.");
      return stored;
    } catch {
      this.clearStoredSession();
      return null;
    }
  }

  persistSession(session, verifiedUser = null) {
    if (!session) return this.clearStoredSession();
    if (!this.safeStorage?.isEncryptionAvailable?.())
      throw new Error(
        "Secure credential storage is unavailable on this device.",
      );
    const envelope = {
      version: 1,
      session,
      user: sanitizeUser(verifiedUser) ?? sanitizeUser(session.user),
    };
    const encrypted = this.safeStorage
      .encryptString(JSON.stringify(envelope))
      .toString("base64");
    this.fileSystem.writeFileSync(this.sessionPath, encrypted, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  clearStoredSession() {
    try {
      this.fileSystem.rmSync(this.sessionPath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }

  async hydrateSession() {
    if (!this.client) return null;
    const generation = this.authGeneration;
    const stored = this.readStoredSession();
    if (!stored?.session?.access_token || !stored.session.refresh_token)
      return null;
    try {
      const { data, error } = await this.waitForRemoteResponse(
        this.client.auth.setSession({
          access_token: stored.session.access_token,
          refresh_token: stored.session.refresh_token,
        }),
        "session hydration",
      );
      if (generation !== this.authGeneration) return null;
      if (error || !data?.session) {
        if (isDefinitiveCredentialError(error)) {
          this.clearStoredSession();
          return null;
        }
        return {
          session: stored.session,
          user: stored.user,
          offline: true,
          generation,
        };
      }
      const user = sanitizeUser(data.session.user) ?? stored.user;
      this.persistSession(data.session, user);
      return { session: data.session, user, offline: false, generation };
    } catch (error) {
      if (generation !== this.authGeneration) return null;
      if (isDefinitiveCredentialError(error)) {
        this.clearStoredSession();
        return null;
      }
      return {
        session: stored.session,
        user: stored.user,
        offline: true,
        generation,
      };
    }
  }

  async getStatus() {
    if (!this.client)
      return { configured: false, authenticated: false, user: null };
    const generation = this.authGeneration;
    const hydrated = await this.hydrateSession();
    if (
      !hydrated ||
      generation !== this.authGeneration ||
      hydrated.generation !== generation
    )
      return { configured: true, authenticated: false, user: null };
    if (hydrated.offline) return offlineStatus(hydrated.user);

    try {
      const { data, error } = await this.waitForRemoteResponse(
        this.client.auth.getUser(hydrated.session.access_token),
        "session verification",
      );
      if (generation !== this.authGeneration)
        return { configured: true, authenticated: false, user: null };
      if (error || !data?.user) {
        if (isDefinitiveCredentialError(error)) {
          this.clearStoredSession();
          return { configured: true, authenticated: false, user: null };
        }
        return offlineStatus(hydrated.user);
      }
      const user = sanitizeUser(data.user);
      this.persistSession(hydrated.session, user);
      return { configured: true, authenticated: true, user, offline: false };
    } catch (error) {
      if (generation !== this.authGeneration)
        return { configured: true, authenticated: false, user: null };
      if (isDefinitiveCredentialError(error)) {
        this.clearStoredSession();
        return { configured: true, authenticated: false, user: null };
      }
      return offlineStatus(hydrated.user);
    }
  }

  /**
   * Supabase Auth may wait indefinitely for an unreachable network. Race the
   * remote operation against a locally controlled deadline so callers can use
   * their encrypted session instead. Late responses are intentionally inert:
   * a future status check can refresh the session normally.
   */
  /**
   * @param {any} remoteResponse
   * @param {string} operation
   * @param {{timeoutMs?: number, onTimeout?: () => void}} [options]
   */
  waitForRemoteResponse(remoteResponse, operation, options = {}) {
    const { timeoutMs = this.hydrationTimeoutMs, onTimeout } = options;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutHandle;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== undefined)
          this.timeoutScheduler.clearTimeout(timeoutHandle);
        callback(value);
      };

      try {
        timeoutHandle = this.timeoutScheduler.setTimeout(() => {
          onTimeout?.();
          settle(
            reject,
            new Error(
              `Supabase Auth ${operation} timed out after ${timeoutMs}ms. Check your connection and try again.`,
            ),
          );
        }, timeoutMs);
        timeoutHandle?.unref?.();
        Promise.resolve(remoteResponse).then(
          (response) => settle(resolve, response),
          (error) => settle(reject, error),
        );
      } catch (error) {
        settle(reject, error);
      }
    });
  }

  async signUp({ email, password, displayName }) {
    this.assertConfigured();
    this.assertCredentials(email, password);
    const generation = ++this.authGeneration;
    const { data, error } = await this.waitForRemoteResponse(
      this.client.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName?.trim() || undefined } },
      }),
      "sign up",
      {
        timeoutMs: this.operationTimeoutMs,
        onTimeout: () => {
          if (generation === this.authGeneration) ++this.authGeneration;
        },
      },
    );
    if (generation !== this.authGeneration)
      throw new Error(
        "This authentication attempt was superseded by a newer action.",
      );
    if (error) throw new Error(error.message);
    if (data.session) this.persistSession(data.session);
    return {
      status: await this.getStatus(),
      requiresEmailConfirmation: !data.session,
    };
  }

  async signIn({ email, password }) {
    this.assertConfigured();
    this.assertCredentials(email, password);
    const generation = ++this.authGeneration;
    const { data, error } = await this.waitForRemoteResponse(
      this.client.auth.signInWithPassword({
        email: email.trim(),
        password,
      }),
      "sign in",
      {
        timeoutMs: this.operationTimeoutMs,
        onTimeout: () => {
          if (generation === this.authGeneration) ++this.authGeneration;
        },
      },
    );
    if (generation !== this.authGeneration)
      throw new Error(
        "This authentication attempt was superseded by a newer action.",
      );
    if (error || !data.session)
      throw new Error(error?.message || "Unable to sign in.");
    this.persistSession(data.session);
    return this.getStatus();
  }

  async beginGoogleSignIn(openExternal) {
    this.assertConfigured();
    if (!this.isSecureStorageAvailable())
      throw new Error(
        "Secure credential storage is unavailable on this device.",
      );
    // TimeFarm permits one desktop OAuth flow at a time. Dropping a stale flow
    // also prevents its verifier from being selected for a newer callback.
    const generation = ++this.authGeneration;
    this.clearPendingOAuth();
    try {
      const state = this.createOAuthState();
      const redirectTo = addTimeFarmOAuthState(
        this.configuration.redirectUrl,
        state,
      );
      const { data, error } = await this.waitForRemoteResponse(
        this.client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo, skipBrowserRedirect: true },
        }),
        "Google sign-in start",
        {
          timeoutMs: this.operationTimeoutMs,
          onTimeout: () => {
            if (generation === this.authGeneration) ++this.authGeneration;
          },
        },
      );
      if (generation !== this.authGeneration)
        throw new Error(
          "This authentication attempt was superseded by a newer action.",
        );
      if (error || !data?.url)
        throw new Error(error?.message || "Unable to start Google sign-in.");
      // Supabase's authorization URL intentionally does not expose its own
      // OAuth `state` value here. Our nonce travelled inside redirectTo, which
      // is returned by the provider with the callback code and PKCE flow id.
      if (!isValidOAuthState(state) || !isValidPkceFlowId(data.flowId))
        throw new Error(
          "Google sign-in response did not include a verifiable PKCE flow.",
        );
      this.persistPendingOAuth(state, data.flowId);
      await this.waitForRemoteResponse(
        Promise.resolve().then(() => openExternal(data.url)),
        "browser launch",
        {
          timeoutMs: this.operationTimeoutMs,
          onTimeout: () => {
            if (generation === this.authGeneration) ++this.authGeneration;
          },
        },
      );
      if (generation !== this.authGeneration)
        throw new Error(
          "This authentication attempt was superseded by a newer action.",
        );
      return { pending: true };
    } catch (error) {
      this.clearPendingOAuth();
      throw error;
    }
  }

  async handleOAuthCallback(callbackUrl) {
    if (!this.client || !callbackUrl) return null;
    let parsed;
    try {
      parsed = new URL(callbackUrl);
      if (
        parsed.protocol !== "timefarm:" ||
        parsed.hostname !== "auth" ||
        parsed.pathname !== "/callback" ||
        parsed.port ||
        parsed.username ||
        parsed.password ||
        parsed.hash
      )
        return null;
    } catch {
      return null;
    }

    const codes = parsed.searchParams.getAll("code");
    if (codes.length === 0 || !codes[0]) return null;
    const timefarmStates = parsed.searchParams.getAll("timefarm_state");
    const flowIds = parsed.searchParams.getAll("sb_flow_id");
    const pending = this.getPendingOAuth();
    if (
      codes.length !== 1 ||
      timefarmStates.length !== 1 ||
      !pending ||
      timefarmStates[0] !== pending.state ||
      flowIds.length !== 1 ||
      flowIds[0] !== pending.flowId
    ) {
      throw new Error("Google sign-in callback could not be verified.");
    }

    const consumed = this.consumePendingOAuth();
    if (!consumed)
      throw new Error("Google sign-in callback could not be verified.");
    const generation = this.authGeneration;
    try {
      const { data, error } = await this.waitForRemoteResponse(
        this.client.auth.exchangeCodeForSession(codes[0], {
          flowId: consumed.flowId,
        }),
        "Google sign-in exchange",
        {
          timeoutMs: this.operationTimeoutMs,
          onTimeout: () => {
            if (generation === this.authGeneration) ++this.authGeneration;
          },
        },
      );
      if (generation !== this.authGeneration)
        throw new Error(
          "This authentication attempt was superseded by a newer action.",
        );
      if (error || !data?.session)
        throw new Error(error?.message || "Unable to complete Google sign-in.");
      this.persistSession(data.session);
      return this.getStatus();
    } finally {
      this.pendingOAuthStorageItems = {};
    }
  }

  async getAccessToken(expectedAuthUserId) {
    const hydrated = await this.hydrateSession();
    if (expectedAuthUserId && hydrated?.user?.id !== expectedAuthUserId)
      return null;
    return hydrated?.session?.access_token ?? null;
  }

  async signOut() {
    ++this.authGeneration;
    this.clearLocalCredentialsForSignOut();
    if (this.client) {
      try {
        await this.waitForRemoteResponse(
          this.client.auth.signOut({ scope: "local" }),
          "sign out",
        );
      } catch {
        /* local credential removal still wins */
      }
    }
    this.clearLocalCredentialsForSignOut();
    return {
      configured: this.isConfigured(),
      authenticated: false,
      user: null,
    };
  }

  clearLocalCredentialsForSignOut() {
    this.clearStoredSession();
    this.clearPendingOAuth();
    const removed = [this.sessionPath, this.pendingOAuthPath].every(
      (credentialPath) => {
        try {
          this.fileSystem.lstatSync(credentialPath);
          return false;
        } catch (error) {
          return error?.code === "ENOENT";
        }
      },
    );
    if (!removed)
      throw new Error(
        "TimeFarm could not remove the encrypted local sign-in credentials from this device.",
      );
  }

  assertConfigured() {
    if (!this.client)
      throw new Error(
        "Cloud authentication has not been configured. Set TIMEFARM_SUPABASE_URL and TIMEFARM_SUPABASE_ANON_KEY.",
      );
  }

  assertCredentials(email, password) {
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim()))
      throw new Error("Enter a valid email address.");
    if (typeof password !== "string" || password.length < 8)
      throw new Error("Password must contain at least 8 characters.");
  }
}

module.exports = {
  SupabaseAuthService,
  readConfiguration,
  sanitizeUser,
  normalizeStoredSession,
  isDefinitiveCredentialError,
};
