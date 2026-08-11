const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DeviceIdStore,
  TimerLeaseError,
  TimerLeaseService,
  isUuid,
} = require("./timer-lease-service.cjs");

const START = "2026-08-10T00:00:00.000Z";

async function withDirectory(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "workly-timer-lease-"),
  );
  try {
    return await callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function authService({ configured = true, token = "token", rpc } = {}) {
  const headers = new Headers();
  return {
    isConfigured: () => configured,
    getAccessToken: async () => token,
    client: {
      rest: { headers },
      rpc: (...args) =>
        (rpc ?? (async () => ({ data: true, error: null })))(...args, {
          headers: { Authorization: headers.get("Authorization") },
        }),
    },
  };
}

function createService(directory, options = {}) {
  return new TimerLeaseService({
    userDataPath: directory,
    authService: options.authService ?? authService(),
    clock: () => START,
    ...options,
  });
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

function controlledTimeoutScheduler() {
  const timers = [];
  return {
    timers,
    setTimeout: (callback, milliseconds) => {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      timer.cleared = true;
    },
  };
}

async function waitForRpcSetup() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("persists one stable UUID per local installation file", () =>
  withDirectory((directory) => {
    const filePath = path.join(directory, "timer-device-id.json");
    const generated = crypto.randomUUID();
    const first = new DeviceIdStore({ filePath, idFactory: () => generated });
    assert.equal(first.getOrCreate(), generated);
    assert.equal(isUuid(first.getOrCreate()), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), {
      version: 1,
      deviceId: generated,
    });

    const second = new DeviceIdStore({
      filePath,
      idFactory: () => crypto.randomUUID(),
    });
    assert.equal(second.getOrCreate(), generated);
  }));

test("acquires and renews the lease through the RPC with one stable device UUID", async () =>
  withDirectory(async (directory) => {
    const calls = [];
    const service = createService(directory, {
      authService: authService({
        rpc: async (name, args, request) => {
          calls.push({ name, args, request });
          return { data: true, error: null };
        },
      }),
    });

    const acquired = await service.acquire();
    assert.equal(acquired.state, "acquired");
    assert.equal(acquired.renewed, false);
    assert.equal(acquired.leaseSeconds, 45);
    assert.equal(acquired.acquiredAt, START);
    assert.equal(isUuid(acquired.deviceId), true);
    assert.equal(service.getStatus().held, true);

    const renewed = await service.renew();
    assert.equal(renewed.state, "acquired");
    assert.equal(renewed.renewed, true);
    assert.equal(renewed.deviceId, acquired.deviceId);
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((call) => call.name),
      ["workly_acquire_timer_lease", "workly_acquire_timer_lease"],
    );
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        { p_device_id: acquired.deviceId, p_seconds: 45 },
        { p_device_id: acquired.deviceId, p_seconds: 45 },
      ],
    );
    assert.equal(calls[0].request.headers.Authorization, "Bearer token");
  }));

test("does not claim an offline lease when cloud config or authentication is unavailable", async () =>
  withDirectory(async (directory) => {
    let tokenCalls = 0;
    const unconfigured = createService(directory, {
      authService: {
        isConfigured: () => false,
        getAccessToken: async () => {
          tokenCalls += 1;
          return "unexpected";
        },
        client: {
          rpc: async () => {
            throw new Error("must not call");
          },
        },
      },
    });
    assert.deepEqual(await unconfigured.acquire(), { state: "not_configured" });
    assert.equal(tokenCalls, 0);
    assert.equal(unconfigured.getStatus().held, false);

    let rpcCalls = 0;
    const unauthenticated = createService(directory, {
      authService: {
        isConfigured: () => true,
        getAccessToken: async () => null,
        client: {
          rpc: async () => {
            rpcCalls += 1;
            return { data: true, error: null };
          },
        },
      },
    });
    assert.deepEqual(await unauthenticated.acquire(), {
      state: "not_authenticated",
    });
    assert.equal(rpcCalls, 0);
    assert.equal(unauthenticated.getStatus().held, false);
  }));

test("reports held_by_other when the server returns false and never sets a local claim", async () =>
  withDirectory(async (directory) => {
    const service = createService(directory, {
      authService: authService({
        rpc: async () => ({ data: false, error: null }),
      }),
    });
    const outcome = await service.acquire();
    assert.equal(outcome.state, "held_by_other");
    assert.equal(isUuid(outcome.deviceId), true);
    assert.equal(service.getStatus().held, false);
  }));

test("coalesces overlapping acquire attempts into one RPC request", async () =>
  withDirectory(async (directory) => {
    let rpcCalls = 0;
    let resolveRpc;
    const service = createService(directory, {
      authService: authService({
        rpc: async () => {
          rpcCalls += 1;
          return new Promise((resolve) => {
            resolveRpc = resolve;
          });
        },
      }),
    });
    const first = service.acquire();
    const second = service.acquire();
    await Promise.resolve();
    assert.equal(rpcCalls, 1);
    resolveRpc({ data: true, error: null });
    const [one, two] = await Promise.all([first, second]);
    assert.equal(one.state, "acquired");
    assert.equal(two.state, "acquired");
    assert.equal(one.deviceId, two.deviceId);
  }));

test("bounds an acquire RPC and ignores a late successful response after its deadline", async () =>
  withDirectory(async (directory) => {
    const timeoutScheduler = controlledTimeoutScheduler();
    const lateResponse = deferred();
    const service = createService(directory, {
      rpcTimeoutMs: 250,
      timeoutScheduler,
      authService: authService({ rpc: () => lateResponse.promise }),
    });

    const acquisition = service.acquire();
    await waitForRpcSetup();
    assert.equal(timeoutScheduler.timers.length, 1);
    assert.equal(timeoutScheduler.timers[0].milliseconds, 250);

    timeoutScheduler.timers[0].callback();
    const timedOut = await acquisition;
    assert.deepEqual(timedOut, {
      state: "failed",
      error: "Timer lease acquire request timed out after 250ms.",
      reason: "acquire_request_timed_out",
    });
    assert.equal(service.getStatus().held, false);

    lateResponse.resolve({ data: true, error: null });
    await waitForRpcSetup();
    assert.equal(service.getStatus().held, false);
    assert.deepEqual(service.getStatus().lastOutcome, timedOut);
  }));

test("bounds a renewal RPC and does not restore a timed-out lease from a late response", async () =>
  withDirectory(async (directory) => {
    const timeoutScheduler = controlledTimeoutScheduler();
    const lateResponse = deferred();
    let calls = 0;
    const service = createService(directory, {
      rpcTimeoutMs: 250,
      timeoutScheduler,
      authService: authService({
        rpc: () => {
          calls += 1;
          return calls === 1
            ? { data: true, error: null }
            : lateResponse.promise;
        },
      }),
    });

    assert.equal((await service.acquire()).state, "acquired");
    assert.equal(service.getStatus().held, true);

    const renewal = service.renew();
    await waitForRpcSetup();
    assert.equal(timeoutScheduler.timers.length, 2);
    timeoutScheduler.timers[1].callback();

    const timedOut = await renewal;
    assert.deepEqual(timedOut, {
      state: "failed",
      error: "Timer lease renew request timed out after 250ms.",
      reason: "renew_request_timed_out",
    });
    assert.equal(service.getStatus().held, false);

    lateResponse.resolve({ data: true, error: null });
    await waitForRpcSetup();
    assert.equal(service.getStatus().held, false);
    assert.deepEqual(service.getStatus().lastOutcome, timedOut);
  }));

test("clears a previously held local claim after network/RPC failure rather than treating offline as leased", async () =>
  withDirectory(async (directory) => {
    let call = 0;
    const service = createService(directory, {
      authService: authService({
        rpc: async () => {
          call += 1;
          return call === 1
            ? { data: true, error: null }
            : { data: null, error: { message: "Network unavailable" } };
        },
      }),
    });
    assert.equal((await service.acquire()).state, "acquired");
    assert.equal(service.getStatus().held, true);
    const failed = await service.renew();
    assert.deepEqual(failed, {
      state: "failed",
      error: "Network unavailable",
      reason: "renew_request_failed",
    });
    assert.equal(service.getStatus().held, false);
    assert.equal((await service.renew()).state, "failed");
  }));

test("never sends a renewal request before a confirmed acquisition", async () =>
  withDirectory(async (directory) => {
    let calls = 0;
    const service = createService(directory, {
      authService: authService({
        rpc: async () => {
          calls += 1;
          return { data: true, error: null };
        },
      }),
    });
    assert.deepEqual(await service.renew(), {
      state: "failed",
      error: "Cannot renew a timer lease that was not acquired locally.",
      reason: "no_local_lease",
    });
    assert.equal(calls, 0);
    assert.throws(
      () => service.startRenewal(),
      (error) =>
        error instanceof TimerLeaseError && error.code === "LEASE_NOT_HELD",
    );
  }));

test("supports a configured 60-second lease and stops local renewal without faking remote release", async () =>
  withDirectory(async (directory) => {
    const calls = [];
    const scheduler = {
      setInterval: (callback, milliseconds) => ({
        callback,
        milliseconds,
        unref: () => {},
      }),
      clearInterval: (timer) => {
        timer.cleared = true;
      },
    };
    const service = createService(directory, {
      leaseSeconds: 60,
      renewEveryMs: 35_000,
      scheduler,
      authService: authService({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: true, error: null };
        },
      }),
    });
    const acquired = await service.acquire();
    assert.equal(acquired.leaseSeconds, 60);
    assert.equal(calls[0].args.p_seconds, 60);
    assert.deepEqual(service.startRenewal(), { renewEveryMs: 35_000 });
    assert.equal(service.getStatus().renewing, true);
    service.stopRenewal();
    assert.equal(service.getStatus().renewing, false);
    assert.equal(service.getStatus().held, false);
    assert.equal(
      calls.length,
      1,
      "stopRenewal must not pretend to call an unsupported remote release RPC",
    );
  }));

test("routes background lease renewal through the injected serialization executor", async () =>
  withDirectory(async (directory) => {
    let scheduled = () => {};
    let rpcCalls = 0;
    let executorCalls = 0;
    const service = createService(directory, {
      scheduler: {
        setInterval: (callback) => {
          scheduled = callback;
          return { unref: () => {} };
        },
        clearInterval: () => {},
      },
      renewExecutor: async (work) => {
        executorCalls += 1;
        return work();
      },
      authService: authService({
        rpc: async () => {
          rpcCalls += 1;
          return { data: true, error: null };
        },
      }),
    });

    await service.acquire("11111111-1111-4111-8111-111111111111");
    service.startRenewal();
    scheduled();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(executorCalls, 1);
    assert.equal(rpcCalls, 2);
    assert.equal(service.getStatus().held, true);
  }));

test("rejects unsafe configuration and non-UUID device identifiers", () =>
  withDirectory((directory) => {
    assert.throws(
      () => createService(directory, { leaseSeconds: 14 }),
      (error) =>
        error instanceof TimerLeaseError &&
        error.code === "INVALID_LEASE_SECONDS",
    );
    assert.throws(
      () =>
        createService(directory, { leaseSeconds: 45, renewEveryMs: 45_000 }),
      (error) =>
        error instanceof TimerLeaseError &&
        error.code === "INVALID_RENEW_INTERVAL",
    );
    assert.throws(
      () => createService(directory, { rpcTimeoutMs: 0 }),
      (error) =>
        error instanceof TimerLeaseError &&
        error.code === "INVALID_RPC_TIMEOUT",
    );
    const store = new DeviceIdStore({
      filePath: path.join(directory, "bad-device.json"),
      idFactory: () => "not-a-uuid",
    });
    assert.throws(
      () => store.getOrCreate(),
      (error) =>
        error instanceof TimerLeaseError && error.code === "INVALID_DEVICE_ID",
    );
  }));
