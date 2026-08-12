const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  SupabaseAuthService,
  readConfiguration,
  sanitizeUser,
  isDefinitiveCredentialError,
} = require("./auth-service.cjs");

async function withTemporaryDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workly-auth-test-"));
  try {
    return await callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function secureStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => {
      const plaintext = Buffer.from(value).toString("utf8");
      if (!plaintext.startsWith("encrypted:"))
        throw new Error("Unable to decrypt");
      return plaintext.slice("encrypted:".length);
    },
  };
}

function configuredService(directory, options = {}) {
  return new SupabaseAuthService({
    userDataPath: directory,
    safeStorage: secureStorage(),
    environment: {
      WORKLY_SUPABASE_URL: "https://project.supabase.co",
      WORKLY_SUPABASE_ANON_KEY: "anon",
    },
    ...options,
  });
}

function manualTimeoutScheduler() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimeout: (callback) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    },
    fireNext: () => {
      const entry = pending.entries().next().value;
      if (!entry) throw new Error("No timeout is pending.");
      const [id, callback] = entry;
      pending.delete(id);
      callback();
    },
    pendingCount: () => pending.size,
  };
}

async function flushMicrotasks(count = 4) {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function manualClock(initialNow = 1_000_000) {
  let current = initialNow;
  return {
    now: () => current,
    advance: (milliseconds) => {
      current += milliseconds;
    },
  };
}

function pendingPkceStorageEntries(flowId) {
  const serializedVerifier = JSON.stringify("v".repeat(64));
  return {
    [`workly-oauth-pkce-flow-${flowId}-code-verifier`]: serializedVerifier,
    "workly-oauth-pkce-flows-code-verifier": JSON.stringify([flowId]),
    "workly-oauth-pkce-code-verifier": serializedVerifier,
  };
}

function deterministicRandomBytes(value = 7) {
  return (size) => Buffer.alloc(size, value);
}

function mockGoogleAuthorization(service, { flowId }) {
  const captured = { input: null };
  service.client = {
    auth: {
      signInWithOAuth: async (input) => {
        captured.input = input;
        for (const [key, value] of Object.entries(
          pendingPkceStorageEntries(flowId),
        )) {
          await service.pendingOAuthStorage.setItem(key, value);
        }
        // auth-js returns an authorization URL containing an encoded
        // redirect_to, not its provider-owned state parameter. Mimic the real
        // PKCE flow by letting auth-js append the flow ID to that callback.
        const callback = new URL(input.options.redirectTo);
        callback.searchParams.set("sb_flow_id", flowId);
        const authorization = new URL(
          "https://project.supabase.co/auth/v1/authorize",
        );
        authorization.searchParams.set("provider", "google");
        authorization.searchParams.set("redirect_to", callback.toString());
        authorization.searchParams.set(
          "code_challenge",
          "server-generated-challenge",
        );
        authorization.searchParams.set("code_challenge_method", "s256");
        return {
          data: {
            url: authorization.toString(),
            flowId,
          },
          error: null,
        };
      },
    },
  };
  return captured;
}

const storedSession = {
  access_token: "private-access-token",
  refresh_token: "private-refresh-token",
  user: {
    id: "user-1",
    email: "minh@example.com",
    user_metadata: { display_name: "Minh" },
  },
};

test("auth configuration only accepts explicit usable URL and anon key", () => {
  assert.deepEqual(readConfiguration({}), { configured: false });
  assert.deepEqual(
    readConfiguration({
      WORKLY_SUPABASE_URL: "http://not-allowed.example",
      WORKLY_SUPABASE_ANON_KEY: "anon",
    }),
    { configured: false },
  );
  const configuration = readConfiguration({
    WORKLY_SUPABASE_URL: "https://project.supabase.co",
    WORKLY_SUPABASE_ANON_KEY: "anon",
  });
  assert.equal(configuration.configured, true);
  assert.equal(configuration.redirectUrl, "timefarm://auth/callback");
});

test("auth status never exposes token material to the renderer", () => {
  assert.deepEqual(
    sanitizeUser({
      id: "user-1",
      email: "minh@example.com",
      user_metadata: { display_name: "Minh" },
      access_token: "secret",
    }),
    { id: "user-1", email: "minh@example.com", displayName: "Minh" },
  );
});

test("keeps encrypted credentials and local identity when getUser is offline", async () =>
  withTemporaryDirectory(async (directory) => {
    const service = configuredService(directory);
    service.persistSession(storedSession);
    service.client = {
      auth: {
        setSession: async () => ({
          data: { session: { ...storedSession, user: undefined } },
          error: null,
        }),
        getUser: async () => {
          throw new TypeError("fetch failed");
        },
      },
    };

    const status = await service.getStatus();

    assert.deepEqual(status, {
      configured: true,
      authenticated: true,
      user: { id: "user-1", email: "minh@example.com", displayName: "Minh" },
      offline: true,
      error:
        "Unable to verify this session while offline. Local data remains available on this device.",
    });
    assert.equal(fs.existsSync(service.sessionPath), true);
    assert.doesNotMatch(
      JSON.stringify(status),
      /private-(?:access|refresh)-token/,
    );
  }));

test("uses stored credentials offline when session hydration cannot reach Supabase", async () =>
  withTemporaryDirectory(async (directory) => {
    const service = configuredService(directory);
    service.persistSession(storedSession);
    service.client = {
      auth: {
        setSession: async () => {
          throw new TypeError("network unavailable");
        },
      },
    };

    const status = await service.getStatus();
    const accessToken = await service.getAccessToken();

    assert.equal(status.authenticated, true);
    assert.equal(status.offline, true);
    assert.equal(status.user?.id, "user-1");
    assert.equal(accessToken, "private-access-token");
    assert.equal(fs.existsSync(service.sessionPath), true);
  }));

test("times out a hanging session hydration and immediately uses the encrypted local session", async () =>
  withTemporaryDirectory(async (directory) => {
    const timeoutScheduler = manualTimeoutScheduler();
    const service = configuredService(directory, {
      hydrationTimeoutMs: 1,
      timeoutScheduler,
    });
    service.persistSession(storedSession);
    const never = new Promise(() => {});
    service.client = { auth: { setSession: () => never } };

    const pendingStatus = service.getStatus();
    assert.equal(timeoutScheduler.pendingCount(), 1);
    timeoutScheduler.fireNext();
    const status = await pendingStatus;

    assert.equal(status.authenticated, true);
    assert.equal(status.offline, true);
    assert.equal(status.user?.id, "user-1");
    assert.equal(fs.existsSync(service.sessionPath), true);

    const pendingToken = service.getAccessToken();
    assert.equal(timeoutScheduler.pendingCount(), 1);
    timeoutScheduler.fireNext();
    assert.equal(await pendingToken, "private-access-token");
  }));

test("times out a hanging remote user verification instead of blocking status", async () =>
  withTemporaryDirectory(async (directory) => {
    const timeoutScheduler = manualTimeoutScheduler();
    const service = configuredService(directory, {
      hydrationTimeoutMs: 1,
      timeoutScheduler,
    });
    service.persistSession(storedSession);
    service.client = {
      auth: {
        setSession: async () => ({
          data: { session: storedSession },
          error: null,
        }),
        getUser: () => new Promise(() => {}),
      },
    };

    const pendingStatus = service.getStatus();
    await flushMicrotasks();
    assert.equal(timeoutScheduler.pendingCount(), 1);
    timeoutScheduler.fireNext();
    const status = await pendingStatus;

    assert.equal(status.authenticated, true);
    assert.equal(status.offline, true);
    assert.equal(fs.existsSync(service.sessionPath), true);
  }));

test("bounds password sign-up and sign-in and ignores their late responses", async () =>
  withTemporaryDirectory(async (directory) => {
    for (const operation of ["signUp", "signInWithPassword"]) {
      const timeoutScheduler = manualTimeoutScheduler();
      const service = configuredService(directory, {
        operationTimeoutMs: 1,
        timeoutScheduler,
      });
      const response = deferred();
      let persisted = 0;
      service.persistSession = () => {
        persisted += 1;
      };
      service.client = {
        auth: { [operation]: () => response.promise },
      };

      const pending =
        operation === "signUp"
          ? service.signUp({
              email: "minh@example.com",
              password: "password-1",
              displayName: "Minh",
            })
          : service.signIn({
              email: "minh@example.com",
              password: "password-1",
            });
      assert.equal(timeoutScheduler.pendingCount(), 1);
      timeoutScheduler.fireNext();
      await assert.rejects(
        pending,
        new RegExp(
          `Supabase Auth ${operation === "signUp" ? "sign up" : "sign in"} timed out after 1ms`,
        ),
      );

      response.resolve({ data: { session: storedSession }, error: null });
      await flushMicrotasks();
      assert.equal(persisted, 0);
    }
  }));

test("times out OAuth start and exchange without retaining a usable late flow", async () =>
  withTemporaryDirectory(async (directory) => {
    const timeoutScheduler = manualTimeoutScheduler();
    const startService = configuredService(directory, {
      operationTimeoutMs: 1,
      timeoutScheduler,
      randomBytes: deterministicRandomBytes(17),
    });
    const lateStart = deferred();
    startService.client = {
      auth: { signInWithOAuth: () => lateStart.promise },
    };
    const starting = startService.beginGoogleSignIn(async () => {});
    assert.equal(timeoutScheduler.pendingCount(), 1);
    timeoutScheduler.fireNext();
    await assert.rejects(starting, /Google sign-in start timed out after 1ms/);
    assert.equal(fs.existsSync(startService.pendingOAuthPath), false);

    const flowId = "flow1234";
    const readyService = configuredService(directory, {
      operationTimeoutMs: 1,
      timeoutScheduler,
      randomBytes: deterministicRandomBytes(19),
    });
    mockGoogleAuthorization(readyService, { flowId });
    await readyService.beginGoogleSignIn(async () => {});
    assert.equal(timeoutScheduler.pendingCount(), 0);
    const state = readyService.pendingOAuthState;
    const lateExchange = deferred();
    let persisted = 0;
    readyService.persistSession = () => {
      persisted += 1;
    };
    readyService.client = {
      auth: { exchangeCodeForSession: () => lateExchange.promise },
    };
    const exchanging = readyService.handleOAuthCallback(
      `timefarm://auth/callback?code=abc&timefarm_state=${state}&sb_flow_id=${flowId}`,
    );
    assert.equal(timeoutScheduler.pendingCount(), 1);
    timeoutScheduler.fireNext();
    await assert.rejects(
      exchanging,
      /Google sign-in exchange timed out after 1ms/,
    );
    assert.equal(fs.existsSync(readyService.pendingOAuthPath), false);

    lateExchange.resolve({ data: { session: storedSession }, error: null });
    await flushMicrotasks();
    assert.equal(persisted, 0);
  }));

test("removes stored credentials only after an unambiguous authentication rejection", async () =>
  withTemporaryDirectory(async (directory) => {
    const service = configuredService(directory);
    service.persistSession(storedSession);
    service.client = {
      auth: {
        setSession: async () => ({
          data: { session: null },
          error: { status: 401, message: "Invalid JWT" },
        }),
      },
    };

    const status = await service.getStatus();

    assert.deepEqual(status, {
      configured: true,
      authenticated: false,
      user: null,
    });
    assert.equal(fs.existsSync(service.sessionPath), false);
  }));

test("removes credentials when a verified session receives a definitive getUser rejection", async () =>
  withTemporaryDirectory(async (directory) => {
    const service = configuredService(directory);
    service.persistSession(storedSession);
    service.client = {
      auth: {
        setSession: async () => ({
          data: { session: storedSession },
          error: null,
        }),
        getUser: async () => ({
          data: { user: null },
          error: { status: 401, message: "Invalid JWT" },
        }),
      },
    };

    const status = await service.getStatus();

    assert.deepEqual(status, {
      configured: true,
      authenticated: false,
      user: null,
    });
    assert.equal(fs.existsSync(service.sessionPath), false);
  }));

test("only classifies explicit credential rejections as definitive", () => {
  assert.equal(
    isDefinitiveCredentialError({ status: 401, message: "Unauthorized" }),
    true,
  );
  assert.equal(
    isDefinitiveCredentialError({ code: "refresh_token_not_found" }),
    true,
  );
  assert.equal(
    isDefinitiveCredentialError(new TypeError("fetch failed")),
    false,
  );
  assert.equal(
    isDefinitiveCredentialError({ message: "Network unavailable" }),
    false,
  );
});

test("persists an encrypted OAuth PKCE continuation across restart and consumes it exactly once", async () =>
  withTemporaryDirectory(async (directory) => {
    const clock = manualClock();
    const flowId = "flow1234";
    const state = Buffer.alloc(32, 11).toString("base64url");
    const initial = configuredService(directory, {
      now: clock.now,
      randomBytes: deterministicRandomBytes(11),
    });
    const captured = mockGoogleAuthorization(initial, { flowId });

    const opened = [];
    await initial.beginGoogleSignIn(async (url) => {
      opened.push(url);
    });

    assert.equal(captured.input.provider, "google");
    const configuredCallback = new URL(captured.input.options.redirectTo);
    assert.equal(configuredCallback.searchParams.get("timefarm_state"), state);
    assert.equal(configuredCallback.searchParams.has("sb_flow_id"), false);
    const authorizationUrl = new URL(opened[0]);
    assert.equal(authorizationUrl.searchParams.has("state"), false);
    const providerCallback = new URL(
      authorizationUrl.searchParams.get("redirect_to"),
    );
    assert.equal(providerCallback.searchParams.get("timefarm_state"), state);
    assert.equal(providerCallback.searchParams.get("sb_flow_id"), flowId);
    assert.equal(fs.existsSync(initial.pendingOAuthPath), true);
    const persistedCiphertext = fs.readFileSync(
      initial.pendingOAuthPath,
      "utf8",
    );
    assert.doesNotMatch(persistedCiphertext, /vvvvvv/);

    const restarted = configuredService(directory, { now: clock.now });
    let exchangeCalls = 0;
    let exchangeOptions;
    restarted.client = {
      auth: {
        exchangeCodeForSession: async (code, options) => {
          exchangeCalls += 1;
          exchangeOptions = { code, options };
          return {
            data: {
              session: { access_token: "token", refresh_token: "refresh" },
            },
            error: null,
          };
        },
      },
    };
    restarted.persistSession = () => {};
    restarted.getStatus = async () => ({
      configured: true,
      authenticated: true,
      user: { id: "user-1", email: "minh@example.com", displayName: "Minh" },
    });

    await assert.rejects(
      () =>
        restarted.handleOAuthCallback(
          `timefarm://auth/callback?code=abc&timefarm_state=wrong-state&sb_flow_id=${flowId}`,
        ),
      /could not be verified/,
    );
    assert.equal(exchangeCalls, 0);
    assert.equal(fs.existsSync(restarted.pendingOAuthPath), true);

    const status = await restarted.handleOAuthCallback(
      `timefarm://auth/callback?code=abc&state=provider-owned-state&timefarm_state=${state}&sb_flow_id=${flowId}`,
    );
    assert.equal(status.authenticated, true);
    assert.equal(exchangeCalls, 1);
    assert.deepEqual(exchangeOptions, { code: "abc", options: { flowId } });
    assert.equal(fs.existsSync(restarted.pendingOAuthPath), false);

    await assert.rejects(
      () =>
        restarted.handleOAuthCallback(
          `timefarm://auth/callback?code=abc&timefarm_state=${state}&sb_flow_id=${flowId}`,
        ),
      /could not be verified/,
    );
    assert.equal(exchangeCalls, 1);
  }));

test("rejects expired, ambiguous, and non-exact OAuth callbacks without exchanging a code", async () =>
  withTemporaryDirectory(async (directory) => {
    const clock = manualClock();
    const flowId = "flow1234";
    const state = Buffer.alloc(32, 13).toString("base64url");
    const initial = configuredService(directory, {
      now: clock.now,
      randomBytes: deterministicRandomBytes(13),
    });
    mockGoogleAuthorization(initial, { flowId });
    await initial.beginGoogleSignIn(async () => {});

    const restarted = configuredService(directory, { now: clock.now });
    let exchangeCalls = 0;
    restarted.client = {
      auth: {
        exchangeCodeForSession: async () => {
          exchangeCalls += 1;
          return { data: { session: storedSession }, error: null };
        },
      },
    };

    assert.equal(
      await restarted.handleOAuthCallback(
        `timefarm://auth:80/callback?code=abc&timefarm_state=${state}&sb_flow_id=${flowId}`,
      ),
      null,
    );
    await assert.rejects(
      () =>
        restarted.handleOAuthCallback(
          `timefarm://auth/callback?code=abc&code=second&timefarm_state=${state}&sb_flow_id=${flowId}`,
        ),
      /could not be verified/,
    );
    assert.equal(exchangeCalls, 0);

    clock.advance(10 * 60_000 + 1);
    await assert.rejects(
      () =>
        restarted.handleOAuthCallback(
          `timefarm://auth/callback?code=abc&timefarm_state=${state}&sb_flow_id=${flowId}`,
        ),
      /could not be verified/,
    );
    assert.equal(exchangeCalls, 0);
    assert.equal(fs.existsSync(restarted.pendingOAuthPath), false);
  }));

test("ignores a late hydration result after sign out and does not resurrect the session file", async () =>
  withTemporaryDirectory(async (directory) => {
    const service = configuredService(directory);
    service.persistSession(storedSession, {
      id: "user-1",
      email: "minh@example.com",
    });
    let resolveHydration;
    const hydrationResponse = new Promise((resolve) => {
      resolveHydration = resolve;
    });
    service.client = {
      auth: {
        setSession: () => hydrationResponse,
        signOut: async () => ({ error: null }),
      },
    };

    const hydration = service.hydrateSession();
    await flushMicrotasks();
    await service.signOut();
    assert.equal(fs.existsSync(service.sessionPath), false);
    resolveHydration({ data: { session: storedSession }, error: null });
    assert.equal(await hydration, null);
    assert.equal(fs.existsSync(service.sessionPath), false);
  }));
