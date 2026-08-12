const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyCloudCacheRebuildIfCurrent,
  applyCloudBootstrapIfCurrent,
  createCloudActivityGate,
} = require("./cloud-bootstrap-lifecycle.cjs");

test("does not restore a cloud snapshot after sign-out invalidates its auth generation", async () => {
  let generation = 4;
  let applied = 0;

  generation += 1;
  const result = await applyCloudBootstrapIfCurrent({
    authUserId: "auth-user-1",
    expectedGeneration: 4,
    currentGeneration: () => generation,
    getAuthStatus: async () => ({
      configured: true,
      authenticated: false,
      user: null,
    }),
    repository: { hasAccount: () => false },
    runSerializedMutation: (work) => work(),
    applySnapshot: () => {
      applied += 1;
      return { state: "restored" };
    },
  });

  assert.deepEqual(result, { state: "cancelled" });
  assert.equal(applied, 0);
});

test("applies a cloud snapshot only for the still-authenticated initiating user", async () => {
  let applied = 0;
  const result = await applyCloudBootstrapIfCurrent({
    authUserId: "auth-user-1",
    expectedGeneration: 7,
    currentGeneration: () => 7,
    getAuthStatus: async () => ({
      configured: true,
      authenticated: true,
      offline: false,
      user: { id: "auth-user-1" },
    }),
    repository: { hasAccount: () => false },
    runSerializedMutation: (work) => work(),
    applySnapshot: () => {
      applied += 1;
      return { state: "restored" };
    },
  });

  assert.deepEqual(result, { state: "restored" });
  assert.equal(applied, 1);
});

test("rejects a bootstrap when the authenticated principal changed", async () => {
  let applied = 0;
  const result = await applyCloudBootstrapIfCurrent({
    authUserId: "auth-user-1",
    expectedGeneration: 2,
    currentGeneration: () => 2,
    getAuthStatus: async () => ({
      configured: true,
      authenticated: true,
      offline: false,
      user: { id: "auth-user-2" },
    }),
    repository: { hasAccount: () => false },
    runSerializedMutation: (work) => work(),
    applySnapshot: () => {
      applied += 1;
      return { state: "restored" };
    },
  });

  assert.deepEqual(result, { state: "cancelled" });
  assert.equal(applied, 0);
});

test("rechecks the generation inside a queued mutation before importing the snapshot", async () => {
  let generation = 9;
  let queuedMutation;
  let applied = 0;
  const pending = applyCloudBootstrapIfCurrent({
    authUserId: "auth-user-1",
    expectedGeneration: 9,
    currentGeneration: () => generation,
    getAuthStatus: async () => ({
      configured: true,
      authenticated: true,
      offline: false,
      user: { id: "auth-user-1" },
    }),
    repository: { hasAccount: () => false },
    runSerializedMutation: (work) =>
      new Promise((resolve) => {
        queuedMutation = () => resolve(work());
      }),
    applySnapshot: () => {
      applied += 1;
      return { state: "restored" };
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  generation += 1;
  queuedMutation();

  assert.deepEqual(await pending, { state: "cancelled" });
  assert.equal(applied, 0);
});

test("does not rebuild a wiped cache after the cloud request completes", async () => {
  let generation = 12;
  let account = { id: "account-1", authUserId: "auth-user-1" };
  let queuedMutation;
  let applied = 0;
  const pending = applyCloudCacheRebuildIfCurrent({
    authUserId: "auth-user-1",
    expectedGeneration: 12,
    currentGeneration: () => generation,
    getAuthStatus: async () => ({
      configured: true,
      authenticated: true,
      offline: false,
      user: { id: "auth-user-1" },
    }),
    repository: { getAccount: () => account },
    runSerializedMutation: (work) =>
      new Promise((resolve) => {
        queuedMutation = () => resolve(work());
      }),
    applySnapshot: () => {
      applied += 1;
      return { state: "restored" };
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  generation += 1;
  account = null;
  queuedMutation();

  assert.deepEqual(await pending, { state: "cancelled" });
  assert.equal(applied, 0);
});

test("rebuilds only the still-owned cache for the initiating online user", async () => {
  let applied = 0;
  const result = await applyCloudCacheRebuildIfCurrent({
    authUserId: "auth-user-1",
    expectedGeneration: 5,
    currentGeneration: () => 5,
    getAuthStatus: async () => ({
      configured: true,
      authenticated: true,
      offline: false,
      user: { id: "auth-user-1" },
    }),
    repository: {
      getAccount: () => ({ id: "account-1", authUserId: "auth-user-1" }),
    },
    runSerializedMutation: (work) => work(),
    applySnapshot: () => {
      applied += 1;
      return { state: "restored" };
    },
  });

  assert.deepEqual(result, { state: "restored" });
  assert.equal(applied, 1);
});

test("keeps cloud activity suppressed until every overlapping guard releases", () => {
  const gate = createCloudActivityGate();
  const releaseWipe = gate.suppress();
  const releaseRebuild = gate.suppress();

  assert.equal(gate.isSuppressed(), true);
  releaseRebuild();
  assert.equal(gate.isSuppressed(), true);
  releaseRebuild();
  assert.equal(gate.isSuppressed(), true);
  releaseWipe();
  assert.equal(gate.isSuppressed(), false);
});
