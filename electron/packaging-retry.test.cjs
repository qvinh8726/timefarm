const assert = require("node:assert/strict");
const test = require("node:test");

const packagingRetry = require("../scripts/run-electron-builder-with-retry.cjs");

test("retries a transient electron-builder download failure and then succeeds", async () => {
  const { runElectronBuilderWithRetry } = packagingRetry;
  let attempts = 0;
  const delays = [];

  await runElectronBuilderWithRetry({
    run: async () => {
      attempts += 1;
      return attempts === 1
        ? {
            exitCode: 1,
            output: "HTTPError: Response code 503 (Service Unavailable)",
          }
        : { exitCode: 0, output: "packaged" };
    },
    sleep: async (milliseconds) => delays.push(milliseconds),
    logger: { log() {}, warn() {} },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(delays, [5_000]);
});

test("does not retry a deterministic electron-builder failure", async () => {
  const { runElectronBuilderWithRetry } = packagingRetry;
  let attempts = 0;

  await assert.rejects(
    runElectronBuilderWithRetry({
      run: async () => {
        attempts += 1;
        return { exitCode: 1, output: "TypeScript error TS2322" };
      },
      sleep: async () => assert.fail("deterministic failures must not wait"),
      logger: { log() {}, warn() {} },
    }),
    /failed with a non-transient error on attempt 1 of 3/,
  );

  assert.equal(attempts, 1);
});

test("stops after the third consecutive transient packaging failure", async () => {
  const { runElectronBuilderWithRetry } = packagingRetry;
  let attempts = 0;
  const delays = [];

  await assert.rejects(
    runElectronBuilderWithRetry({
      run: async () => {
        attempts += 1;
        return { exitCode: 1, output: "read ECONNRESET" };
      },
      sleep: async (milliseconds) => delays.push(milliseconds),
      logger: { log() {}, warn() {} },
    }),
    /failed after 3 transient attempts/,
  );

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5_000, 10_000]);
});

test("does not retry when a later terminal error is deterministic", async () => {
  const { runElectronBuilderWithRetry } = packagingRetry;
  let attempts = 0;

  await assert.rejects(
    runElectronBuilderWithRetry({
      run: async () => {
        attempts += 1;
        return {
          exitCode: 1,
          output: [
            "HTTPError: Response code 503 (Service Unavailable)",
            "Error: TypeScript error TS2322",
          ].join("\n"),
        };
      },
      sleep: async () => assert.fail("mixed failures must not wait"),
      logger: { log() {}, warn() {} },
    }),
    /non-transient error on attempt 1 of 3/,
  );

  assert.equal(attempts, 1);
});

test("recognizes the network errors emitted by electron-builder's HTTP stack", () => {
  const { isTransientElectronBuilderFailure } = packagingRetry;

  for (const output of [
    "getaddrinfo ENOTFOUND github.com",
    "connect ECONNREFUSED 127.0.0.1:443",
    "write EPIPE",
  ]) {
    assert.equal(isTransientElectronBuilderFailure(output), true, output);
  }
  assert.equal(
    isTransientElectronBuilderFailure(
      "Validation error: timeout must be positive",
    ),
    false,
  );
});

test("terminates a hung electron-builder attempt before retrying", async () => {
  const { runElectronBuilderWithRetry } = packagingRetry;
  let attempts = 0;
  const stoppedAttempts = [];

  await runElectronBuilderWithRetry({
    run: async (_arguments, { attempt, signal }) => {
      attempts += 1;
      if (attempt === 1) {
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        stoppedAttempts.push(attempt);
        return { exitCode: 1, output: "electron-builder attempt timed out" };
      }
      return { exitCode: 0, output: "packaged" };
    },
    sleep: async () => {},
    timeoutMs: 5,
    logger: { log() {}, warn() {} },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(stoppedAttempts, [1]);
});

test("does not overlap attempts when a timed-out process cannot be terminated", async () => {
  const { runElectronBuilderWithRetry } = packagingRetry;
  let attempts = 0;

  await assert.rejects(
    runElectronBuilderWithRetry({
      run: async (_arguments, { signal }) => {
        attempts += 1;
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        throw Object.assign(
          new Error(
            "electron-builder did not exit after forced process-tree termination.",
          ),
          { code: "TIMEFARM_ELECTRON_BUILDER_TERMINATION_FAILED" },
        );
      },
      sleep: async () => assert.fail("unsafe termination must not retry"),
      timeoutMs: 5,
      logger: { log() {}, warn() {} },
    }),
    /did not exit after forced process-tree termination/,
  );

  assert.equal(attempts, 1);
});

test("requires successful Windows tree termination even after the parent exited", () => {
  const { stopProcessTree } = packagingRetry;
  let taskkillCalls = 0;
  const child = {
    pid: 1234,
    exitCode: 1,
    kill: () => assert.fail("Windows must not fall back to root-only kill"),
  };

  const stopped = stopProcessTree(child, {
    platform: "win32",
    taskkill: () => {
      taskkillCalls += 1;
      return { status: 128 };
    },
  });

  assert.equal(stopped, false);
  assert.equal(taskkillCalls, 1);
});

test("runs the pinned electron-builder CLI directly", async () => {
  const { runElectronBuilder } = packagingRetry;
  const result = await runElectronBuilder(["--version"]);

  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /26\.15\.7/);
});
