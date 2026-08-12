const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LocalStateRepository, emptyState } = require("./state-repository.cjs");
const {
  createCoalescedSyncExecutor,
  SyncService,
} = require("./sync-service.cjs");

function operation(id) {
  return {
    id,
    entityType: "work_session",
    entityId: id,
    operation: "upsert",
    payload: { id },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function controlledTimeoutScheduler() {
  const timers = [];
  return {
    timers,
    setTimeout: (callback, milliseconds) => {
      const timer = { callback, cleared: false, milliseconds };
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

test("coalesces main-process sync requests onto one background promise", async () => {
  const runSync = createCoalescedSyncExecutor();
  const remote = deferred();
  let runs = 0;
  const first = runSync(() => {
    runs += 1;
    return remote.promise;
  });
  const second = runSync(() => {
    runs += 1;
    return Promise.resolve("duplicate");
  });

  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(runs, 1);
  remote.resolve("complete");
  assert.equal(await first, "complete");
  assert.equal(await second, "complete");

  const next = runSync(() => {
    runs += 1;
    return "next";
  });
  assert.equal(await next, "next");
  assert.equal(runs, 2);
});

test("coalesces SyncService calls before auth and keeps one pull-before-push run", async () => {
  const token = deferred();
  const calls = [];
  let tokenCalls = 0;
  let cursor = 0;
  const repository = {
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      cursor = changes.at(-1)?.cursor ?? cursor;
      return { cursor, applied: changes.length, conflicts: 0 };
    },
    getQueuedOperations: () => [operation("one")],
    markOperationSynced: () => {},
    markOperationFailed: () => {},
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: () => {
      tokenCalls += 1;
      return token.promise;
    },
    client: {
      rpc: async (name) => {
        calls.push(name);
        return name === "workly_pull_changes"
          ? { data: [], error: null }
          : { data: { remoteRevision: 1 }, error: null };
      },
    },
  };
  const service = new SyncService({ repository, authService });

  const first = service.syncNow("auth-user-1");
  const second = service.syncNow("auth-user-1");
  const third = service.syncNow("auth-user-1");
  assert.equal(first, second);
  assert.equal(second, third);
  await Promise.resolve();
  assert.equal(tokenCalls, 1);
  token.resolve("token");

  const expected = { state: "complete", processed: 1, failed: 0 };
  assert.deepEqual(await first, expected);
  assert.deepEqual(await second, expected);
  assert.deepEqual(await third, expected);
  assert.deepEqual(calls, [
    "workly_pull_changes",
    "workly_apply_sync_operation",
  ]);
  assert.equal(service.running, false);
});

test("cancels an in-flight pull before it can write into a wiped repository", async () => {
  const pull = deferred();
  let remoteApplies = 0;
  let queuedReads = 0;
  const repository = {
    getPullCursor: () => 0,
    applyRemoteChanges: () => {
      remoteApplies += 1;
      return { cursor: 1, applied: 1, conflicts: 0 };
    },
    getQueuedOperations: () => {
      queuedReads += 1;
      return [];
    },
    setOperationExpectedRevision: () => true,
    markOperationSynced: () => {},
  };
  const service = new SyncService({
    repository,
    authService: {
      isConfigured: () => true,
      getAccessToken: async () => "token",
      client: {
        rpc: () => pull.promise,
      },
    },
  });

  const running = service.syncNow("auth-user-1");
  await waitForRpcSetup();
  assert.deepEqual(service.cancelPendingSync(), { cancelled: true });
  pull.resolve({
    data: [
      {
        cursor: 1,
        entityType: "project",
        entityId: "project-1",
        operation: "upsert",
        payload: {},
      },
    ],
    error: null,
  });

  assert.deepEqual(await running, {
    state: "cancelled",
    processed: 0,
    failed: 0,
  });
  assert.equal(remoteApplies, 0);
  assert.equal(queuedReads, 0);
});

test("cancels an in-flight push before it can acknowledge or fail a wiped outbox", async () => {
  const push = deferred();
  let synced = 0;
  let failed = 0;
  const repository = {
    getQueuedOperations: () => [{ ...operation("one"), expectedRevision: 0 }],
    setOperationExpectedRevision: () => true,
    markOperationSynced: () => {
      synced += 1;
    },
    markOperationFailed: () => {
      failed += 1;
    },
  };
  const service = new SyncService({
    repository,
    authService: {
      isConfigured: () => true,
      getAccessToken: async () => "token",
      client: { rpc: () => push.promise },
    },
  });

  const running = service.syncNow("auth-user-1");
  await waitForRpcSetup();
  service.cancelPendingSync();
  push.resolve({ data: { conflict: false, remoteRevision: 1 }, error: null });

  assert.deepEqual(await running, {
    state: "cancelled",
    processed: 0,
    failed: 0,
  });
  assert.equal(synced, 0);
  assert.equal(failed, 0);
});

test("sync worker marks successful outbox operations exactly once per run", async () => {
  const marked = [];
  const repository = {
    getQueuedOperations: () => [operation("one"), operation("two")],
    markOperationSynced: (id) => marked.push(id),
    markOperationFailed: () => {},
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: { rpc: async () => ({ error: null }) },
  };
  const service = new SyncService({ repository, authService });
  const result = await service.syncNow();
  assert.deepEqual(result, { state: "complete", processed: 2, failed: 0 });
  assert.deepEqual(marked, ["one", "two"]);
});

test("hydrates an unknown entity revision and acknowledges the server CAS revision", async () => {
  let queued = {
    ...operation("revision-op"),
    entityType: "project",
    entityId: "project-1",
  };
  const marked = [];
  const calls = [];
  const repository = {
    getQueuedOperations: () => [queued],
    setOperationExpectedRevision: (id, revision) => {
      assert.equal(id, "revision-op");
      queued = { ...queued, expectedRevision: revision };
      return true;
    },
    markOperationSynced: (id, revision) => marked.push([id, revision]),
    markOperationFailed: () => {},
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === "workly_get_entity_revisions")
          return {
            data: [
              {
                entityType: "project",
                entityId: "project-1",
                remoteRevision: 0,
              },
            ],
            error: null,
          };
        return {
          data: { conflict: false, remoteRevision: 1 },
          error: null,
        };
      },
    },
  };
  const service = new SyncService({ repository, authService });

  assert.deepEqual(await service.syncNow(), {
    state: "complete",
    processed: 1,
    failed: 0,
  });
  assert.deepEqual(marked, [["revision-op", 1]]);
  assert.equal(calls[1][1].p_expected_revision, 0);
});

test("claims an outbox operation before awaiting its remote write", async () => {
  const remote = deferred();
  const events = [];
  const queued = { ...operation("claimed-op"), expectedRevision: 0 };
  const repository = {
    getQueuedOperations: () => [queued],
    claimOperation: (id) => {
      events.push(["claimed", id]);
      return true;
    },
    markOperationSynced: (id, revision) => {
      events.push(["acknowledged", id, revision]);
    },
    markOperationFailed: () => {},
  };
  const service = new SyncService({
    repository,
    authService: {
      isConfigured: () => true,
      getAccessToken: async () => "token",
      client: {
        rpc: () => {
          events.push(["rpc"]);
          return remote.promise;
        },
      },
    },
  });

  const running = service.syncNow();
  await waitForRpcSetup();
  assert.deepEqual(events, [["claimed", "claimed-op"], ["rpc"]]);
  remote.resolve({ data: { conflict: false, remoteRevision: 1 }, error: null });

  assert.deepEqual(await running, {
    state: "complete",
    processed: 1,
    failed: 0,
  });
  assert.deepEqual(events.at(-1), ["acknowledged", "claimed-op", 1]);
});

test("uses the durable idempotency key as the cloud operation identity", async () => {
  const calls = [];
  const queued = {
    ...operation("local-row-id"),
    idempotencyKey: "durable-cloud-key",
    expectedRevision: 0,
  };
  const service = new SyncService({
    repository: {
      getQueuedOperations: () => [queued],
      claimOperation: () => true,
      markOperationSynced: () => {},
      markOperationFailed: () => {},
      setOperationExpectedRevision: () => true,
    },
    authService: {
      isConfigured: () => true,
      getAccessToken: async () => "token",
      client: {
        rpc: async (_name, params) => {
          calls.push(params.p_operation_id);
          return {
            data: { conflict: false, remoteRevision: 1 },
            error: null,
          };
        },
      },
    },
  });

  assert.equal((await service.syncNow()).state, "complete");
  assert.deepEqual(calls, ["durable-cloud-key"]);
});

test("retries an uncertain in-flight operation before pulling newer cloud state", async () => {
  const calls = [];
  let pending = true;
  const uncertain = { ...operation("uncertain-op"), expectedRevision: 4 };
  const repository = {
    getInFlightOperations: () => (pending ? [uncertain] : []),
    hasInFlightOperations: () => pending,
    getQueuedOperations: () => [],
    markOperationSynced: (id, revision) => {
      calls.push(["ack", id, revision]);
      pending = false;
    },
    markOperationFailed: () => {},
    getPullCursor: () => 0,
    applyRemoteChanges: () => ({ cursor: 0, applied: 0, conflicts: 0 }),
  };
  const service = new SyncService({
    repository,
    authService: {
      isConfigured: () => true,
      getAccessToken: async () => "token",
      client: {
        rpc: async (name, params) => {
          calls.push([name, params.p_operation_id]);
          return name === "workly_apply_sync_operation"
            ? { data: { conflict: false, remoteRevision: 5 }, error: null }
            : { data: [], error: null };
        },
      },
    },
  });

  assert.deepEqual(await service.syncNow("auth-user-1"), {
    state: "complete",
    processed: 1,
    failed: 0,
  });
  assert.deepEqual(calls, [
    ["workly_apply_sync_operation", "uncertain-op"],
    ["ack", "uncertain-op", 5],
    ["workly_pull_changes", undefined],
  ]);
});

test("releases an in-flight operation after a confirmed CAS rejection so pull can reconcile it", async () => {
  const calls = [];
  let pending = true;
  const uncertain = { ...operation("stale-in-flight"), expectedRevision: 3 };
  const repository = {
    setOperationExpectedRevision: () => true,
    getInFlightOperations: () => (pending ? [uncertain] : []),
    hasInFlightOperations: () => pending,
    getQueuedOperations: () => [],
    markOperationSynced: () => {
      throw new Error("a rejected operation must not be acknowledged");
    },
    markOperationFailed: (id, message, options) => {
      calls.push(["failed", id, message, options]);
      if (options?.uncertain === false) pending = false;
    },
    getPullCursor: () => 0,
    applyRemoteChanges: () => ({ cursor: 0, applied: 0, conflicts: 0 }),
  };
  const service = new SyncService({
    repository,
    authService: {
      isConfigured: () => true,
      getAccessToken: async () => "token",
      client: {
        rpc: async (name) => {
          calls.push([name]);
          return name === "workly_apply_sync_operation"
            ? {
                data: {
                  conflict: true,
                  expectedRevision: 3,
                  currentRevision: 4,
                },
                error: null,
              }
            : { data: [], error: null };
        },
      },
    },
  });

  assert.deepEqual(await service.syncNow("auth-user-1"), {
    state: "partial",
    processed: 0,
    failed: 1,
  });
  assert.deepEqual(calls, [
    ["workly_apply_sync_operation"],
    [
      "failed",
      "stale-in-flight",
      "Cloud revision conflict for work_session/stale-in-flight: expected 3, current 4. Pull the cloud version before retrying.",
      { uncertain: false },
    ],
    ["workly_pull_changes"],
  ]);
});

test("releases a newly claimed operation after a coded server rejection", async () => {
  const failed = [];
  const repository = {
    getQueuedOperations: () => [
      { ...operation("invalid-op"), expectedRevision: 0 },
    ],
    claimOperation: () => true,
    setOperationExpectedRevision: () => true,
    markOperationSynced: () => {
      throw new Error("a rejected operation must not be acknowledged");
    },
    markOperationFailed: (id, message, options) =>
      failed.push([id, message, options]),
  };
  const service = new SyncService({
    repository,
    authService: {
      isConfigured: () => true,
      getAccessToken: async () => "token",
      client: {
        rpc: async () => ({
          data: null,
          error: {
            code: "22023",
            message: "Project payload was rejected",
          },
        }),
      },
    },
  });

  assert.deepEqual(await service.syncNow(), {
    state: "partial",
    processed: 0,
    failed: 1,
  });
  assert.deepEqual(failed, [
    ["invalid-op", "Project payload was rejected", { uncertain: false }],
  ]);
});

test("preserves a local edit made during a deferred push and syncs it after the echoed revision", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "timefarm-sync-race-"),
  );
  const repository = new LocalStateRepository(
    path.join(directory, "timefarm.db"),
  );
  try {
    const start = "2026-08-10T00:00:00.000Z";
    const state = emptyState();
    state.account = {
      id: "user-1",
      authUserId: "auth-user-1",
      displayName: "Minh",
      country: "VN",
      language: "vi",
      currency: "VND",
      timezone: "Asia/Saigon",
      createdAt: start,
    };
    state.projects = [
      {
        id: "project-1",
        name: "Website",
        paymentModel: "progressive",
        color: "#7c3aed",
        icon: "project",
        status: "active",
        createdAt: start,
        updatedAt: start,
        syncStatus: "local",
      },
    ];
    state.preferences.theme = "dark";
    repository.replaceState(state);
    for (const item of repository.getQueuedOperations(500))
      repository.markOperationSynced(item.id);

    const firstEdit = structuredClone(state);
    firstEdit.projects[0].name = "Website v2";
    firstEdit.projects[0].updatedAt = "2026-08-10T01:00:00.000Z";
    repository.replaceState(firstEdit);
    const first = repository
      .getQueuedOperations(500)
      .find(
        (item) =>
          item.entityType === "project" && item.entityId === "project-1",
      );
    assert.ok(first);
    assert.equal(repository.setOperationExpectedRevision(first.id, 0), true);

    const firstPush = deferred();
    let pullCalls = 0;
    let pushCalls = 0;
    const service = new SyncService({
      repository,
      authService: {
        isConfigured: () => true,
        getAccessToken: async () => "token",
        client: {
          rpc: (name, params) => {
            if (name === "workly_pull_changes") {
              pullCalls += 1;
              return Promise.resolve({
                data:
                  pullCalls === 1
                    ? []
                    : pullCalls === 2
                      ? [
                          {
                            cursor: 1,
                            entityType: "project",
                            entityId: "project-1",
                            operation: "upsert",
                            payload: {
                              ...firstEdit.projects[0],
                              remoteRevision: 1,
                            },
                          },
                        ]
                      : [],
                error: null,
              });
            }
            pushCalls += 1;
            if (pushCalls === 1) return firstPush.promise;
            assert.equal(params.p_expected_revision, 1);
            assert.equal(params.p_payload.name, "Website v3");
            return Promise.resolve({
              data: { conflict: false, remoteRevision: 2 },
              error: null,
            });
          },
        },
      },
    });

    const firstSync = service.syncNow("auth-user-1");
    await waitForRpcSetup();
    assert.equal(pushCalls, 1);
    const secondEdit = structuredClone(firstEdit);
    secondEdit.projects[0].name = "Website v3";
    secondEdit.projects[0].updatedAt = "2026-08-10T02:00:00.000Z";
    repository.replaceState(secondEdit);
    firstPush.resolve({
      data: { conflict: false, remoteRevision: 1 },
      error: null,
    });

    assert.deepEqual(await firstSync, {
      state: "complete",
      processed: 1,
      failed: 0,
    });
    await waitForRpcSetup();
    const successor = repository
      .getQueuedOperations(500)
      .find(
        (item) =>
          item.entityType === "project" && item.entityId === "project-1",
      );
    assert.ok(successor);
    assert.notEqual(successor.id, first.id);
    assert.equal(successor.expectedRevision, 1);

    let secondSync;
    do {
      await waitForRpcSetup();
      secondSync = service.syncNow("auth-user-1");
    } while (secondSync === firstSync);
    assert.deepEqual(await secondSync, {
      state: "complete",
      processed: 1,
      failed: 0,
    });
    assert.equal(repository.getSyncConflicts().length, 0);
    assert.equal(repository.loadState().projects[0].name, "Website v3");
    assert.equal(
      repository.getEntityRevision("user-1", "project", "project-1"),
      2,
    );
  } finally {
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a stale CAS write and leaves it retryable for the next pull", async () => {
  const failed = [];
  const repository = {
    getQueuedOperations: () => [
      { ...operation("stale-op"), expectedRevision: 3 },
    ],
    setOperationExpectedRevision: () => true,
    markOperationSynced: () => {
      throw new Error("a stale operation must not be acknowledged");
    },
    markOperationFailed: (id, message) => failed.push([id, message]),
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async (_name, args) => {
        assert.equal(args.p_expected_revision, 3);
        return {
          data: {
            conflict: true,
            expectedRevision: 3,
            currentRevision: 4,
          },
          error: null,
        };
      },
    },
  };
  const service = new SyncService({ repository, authService });

  assert.deepEqual(await service.syncNow(), {
    state: "partial",
    processed: 0,
    failed: 1,
  });
  assert.match(failed[0][1], /expected 3, current 4/);
});

test("sync worker preserves failed operations for retry", async () => {
  const failed = [];
  const repository = {
    getQueuedOperations: () => [operation("one")],
    markOperationSynced: () => {},
    markOperationFailed: (id, message) => failed.push([id, message]),
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async () => ({ error: { message: "Network unavailable" } }),
    },
  };
  const service = new SyncService({ repository, authService });
  const result = await service.syncNow();
  assert.deepEqual(result, { state: "partial", processed: 0, failed: 1 });
  assert.deepEqual(failed, [["one", "Network unavailable"]]);
});

test("stops dependent cloud writes when the root account operation fails", async () => {
  const failed = [];
  const calls = [];
  const account = {
    id: "account-op",
    entityType: "account",
    entityId: "account-1",
    operation: "upsert",
    payload: { id: "account-1" },
  };
  const project = {
    id: "project-op",
    entityType: "project",
    entityId: "project-1",
    operation: "upsert",
    payload: { id: "project-1" },
  };
  const repository = {
    getQueuedOperations: () => [account, project],
    markOperationSynced: () => {
      throw new Error("dependent work must not be acknowledged");
    },
    markOperationFailed: (id, message) => failed.push([id, message]),
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async (_name, args) => {
        calls.push(args.p_entity_type);
        return { error: { message: "Profile write unavailable" } };
      },
    },
  };
  const service = new SyncService({ repository, authService });
  assert.deepEqual(await service.syncNow(), {
    state: "partial",
    processed: 0,
    failed: 1,
  });
  assert.deepEqual(calls, ["account"]);
  assert.deepEqual(failed, [["account-op", "Profile write unavailable"]]);
});

test("sync worker stays offline without auth configuration or a session", async () => {
  const repository = {
    getQueuedOperations: () => {
      throw new Error("must not read queue");
    },
  };
  const notConfigured = new SyncService({
    repository,
    authService: { isConfigured: () => false },
  });
  assert.equal((await notConfigured.syncNow()).state, "not_configured");
  const signedOut = new SyncService({
    repository,
    authService: { isConfigured: () => true, getAccessToken: async () => null },
  });
  assert.equal((await signedOut.syncNow()).state, "not_authenticated");
});

test("pulls before pushing so a remote change is applied before local outbox work", async () => {
  const calls = [];
  const marked = [];
  let cursor = 7;
  const repository = {
    getQueuedOperations: () => [operation("one")],
    markOperationSynced: (id) => marked.push(id),
    markOperationFailed: () => {},
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      assert.deepEqual(changes, [
        {
          cursor: 8,
          entity_type: "goal",
          entity_id: "goal-1",
          operation: "upsert",
          payload: { id: "goal-1" },
        },
      ]);
      cursor = 8;
      return { cursor, applied: 1, conflicts: 0 };
    },
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async (name) => {
        calls.push(name);
        if (name === "workly_apply_sync_operation") return { error: null };
        return {
          data: [
            {
              cursor: 8,
              entity_type: "goal",
              entity_id: "goal-1",
              operation: "upsert",
              payload: { id: "goal-1" },
            },
          ],
          error: null,
        };
      },
    },
  };
  const service = new SyncService({ repository, authService });
  const result = await service.syncNow();
  assert.deepEqual(result, { state: "complete", processed: 1, failed: 0 });
  assert.deepEqual(marked, ["one"]);
  assert.deepEqual(calls, [
    "workly_pull_changes",
    "workly_apply_sync_operation",
  ]);
  assert.deepEqual(service.lastPull, {
    cursor: 8,
    applied: 1,
    conflicts: 0,
    pages: 1,
    hasMore: false,
  });
});

test("never pushes local operations while the bounded pull still has more pages", async () => {
  let cursor = 0;
  let pushed = 0;
  const repository = {
    getQueuedOperations: () => [operation("one")],
    markOperationSynced: () => {
      pushed += 1;
    },
    markOperationFailed: () => {},
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      cursor += changes.length;
      return { cursor, applied: changes.length, conflicts: 0 };
    },
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async (name) =>
        name === "workly_pull_changes"
          ? {
              data: Array.from({ length: 100 }, (_, index) => ({
                cursor: cursor + index + 1,
              })),
              error: null,
            }
          : { error: null },
    },
  };
  const service = new SyncService({ repository, authService });
  assert.deepEqual(await service.syncNow(), {
    state: "pull_pending",
    processed: 0,
    failed: 0,
  });
  assert.equal(service.lastPull.pages, 50);
  assert.equal(service.lastPull.hasMore, true);
  assert.equal(pushed, 0);
});

test("retries a failed pull from the unchanged cursor on the next sync run", async () => {
  let cursor = 0;
  let pullAttempts = 0;
  const repository = {
    getQueuedOperations: () => [],
    markOperationSynced: () => {},
    markOperationFailed: () => {},
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      cursor = changes.at(-1)?.cursor ?? cursor;
      return { cursor, applied: changes.length, conflicts: 0 };
    },
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async (name, args) => {
        assert.equal(name, "workly_pull_changes");
        assert.equal(args.p_cursor, cursor);
        pullAttempts += 1;
        if (pullAttempts === 1)
          return { error: { message: "Temporary network failure" } };
        return {
          data: [
            {
              cursor: 9,
              entity_type: "goal",
              entity_id: "goal-1",
              operation: "upsert",
              payload: { id: "goal-1" },
            },
          ],
          error: null,
        };
      },
    },
  };
  const service = new SyncService({ repository, authService });
  assert.deepEqual(await service.syncNow(), {
    state: "partial",
    processed: 0,
    failed: 1,
  });
  assert.equal(cursor, 0);
  assert.deepEqual(await service.syncNow(), {
    state: "complete",
    processed: 0,
    failed: 0,
  });
  assert.equal(cursor, 9);
  assert.equal(pullAttempts, 2);
});

test("does not push a local operation after the pre-pull records a remote conflict", async () => {
  let cursor = 0;
  let conflictOpen = false;
  const calls = [];
  const repository = {
    getQueuedOperations: () => (conflictOpen ? [] : [operation("one")]),
    markOperationSynced: () => {
      throw new Error("a conflicted operation must not be acknowledged");
    },
    markOperationFailed: () => {
      throw new Error("a conflicted operation is paused, not failed");
    },
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      cursor = changes.at(-1)?.cursor ?? cursor;
      conflictOpen = true;
      return { cursor, applied: 0, conflicts: 1 };
    },
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async (name) => {
        calls.push(name);
        if (name === "workly_apply_sync_operation")
          throw new Error("unexpected push");
        return {
          data: [
            {
              cursor: 1,
              entity_type: "project",
              entity_id: "project-1",
              operation: "upsert",
              payload: { id: "project-1" },
            },
          ],
          error: null,
        };
      },
    },
  };
  const service = new SyncService({ repository, authService });
  assert.deepEqual(await service.syncNow(), {
    state: "complete",
    processed: 0,
    failed: 0,
  });
  assert.deepEqual(calls, ["workly_pull_changes"]);
  assert.equal(service.lastPull.conflicts, 1);
});

test("times out a push, leaves it retryable, ignores a late success, and allows the next sync run", async () => {
  const timeoutScheduler = controlledTimeoutScheduler();
  const lateResponse = deferred();
  const failed = [];
  const marked = [];
  let rpcCalls = 0;
  const repository = {
    getQueuedOperations: () => [operation("one")],
    markOperationSynced: (id) => marked.push(id),
    markOperationFailed: (id, message) => failed.push([id, message]),
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: () => {
        rpcCalls += 1;
        return rpcCalls === 1
          ? lateResponse.promise
          : Promise.resolve({ error: null });
      },
    },
  };
  const service = new SyncService({
    repository,
    authService,
    rpcTimeoutMs: 250,
    timeoutScheduler,
  });

  const first = service.syncNow();
  await waitForRpcSetup();
  assert.equal(timeoutScheduler.timers.length, 1);
  assert.equal(timeoutScheduler.timers[0].milliseconds, 250);
  timeoutScheduler.timers[0].callback();

  assert.deepEqual(await first, { state: "partial", processed: 0, failed: 1 });
  assert.equal(service.running, false);
  assert.deepEqual(failed, [
    ["one", "Sync RPC workly_apply_sync_operation timed out after 250ms."],
  ]);
  assert.deepEqual(marked, []);

  lateResponse.resolve({ error: null });
  await waitForRpcSetup();
  assert.deepEqual(
    marked,
    [],
    "a late response from the timed-out run must be inert",
  );

  assert.deepEqual(await service.syncNow(), {
    state: "complete",
    processed: 1,
    failed: 0,
  });
  assert.deepEqual(marked, ["one"]);
  assert.equal(rpcCalls, 2);
});

test("times out a pull without advancing its cursor and ignores a late page before retrying", async () => {
  const timeoutScheduler = controlledTimeoutScheduler();
  const lateResponse = deferred();
  let cursor = 7;
  let rpcCalls = 0;
  const appliedPages = [];
  const repository = {
    getQueuedOperations: () => [],
    markOperationSynced: () => {},
    markOperationFailed: () => {},
    getPullCursor: () => cursor,
    applyRemoteChanges: (changes) => {
      appliedPages.push(changes);
      cursor = changes.at(-1)?.cursor ?? cursor;
      return { cursor, applied: changes.length, conflicts: 0 };
    },
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: () => {
        rpcCalls += 1;
        return rpcCalls === 1
          ? lateResponse.promise
          : Promise.resolve({
              data: [
                {
                  cursor: 8,
                  entity_type: "goal",
                  entity_id: "goal-1",
                  operation: "upsert",
                  payload: { id: "goal-1" },
                },
              ],
              error: null,
            });
      },
    },
  };
  const service = new SyncService({
    repository,
    authService,
    rpcTimeoutMs: 250,
    timeoutScheduler,
  });

  const first = service.syncNow();
  await waitForRpcSetup();
  assert.equal(timeoutScheduler.timers.length, 1);
  timeoutScheduler.timers[0].callback();

  assert.deepEqual(await first, { state: "partial", processed: 0, failed: 1 });
  assert.equal(service.running, false);
  assert.equal(cursor, 7);
  assert.deepEqual(appliedPages, []);

  lateResponse.resolve({
    data: [
      {
        cursor: 8,
        entity_type: "goal",
        entity_id: "goal-1",
        operation: "upsert",
        payload: { id: "goal-1" },
      },
    ],
    error: null,
  });
  await waitForRpcSetup();
  assert.equal(cursor, 7, "a late page must not mutate the local pull cursor");
  assert.deepEqual(appliedPages, []);

  assert.deepEqual(await service.syncNow(), {
    state: "complete",
    processed: 0,
    failed: 0,
  });
  assert.equal(cursor, 8);
  assert.equal(rpcCalls, 2);
});

test("bootstraps a fresh device from cloud before it reads or pushes the normal outbox", async () => {
  const snapshot = {
    version: 2,
    found: true,
    cursor: 91,
    profile: { displayName: "Cloud Minh", remoteRevision: 7 },
    preferences: { remoteRevision: 3 },
    projects: [{ id: "project-1", name: "Cloud project", remoteRevision: 11 }],
    sessions: [],
    payments: [],
    goals: [
      {
        id: "goal-1",
        kind: "hours_weekly",
        target: 20,
        remoteRevision: 4,
      },
    ],
  };
  const pages = [
    {
      version: 2,
      found: true,
      cursor: 91,
      profile: snapshot.profile,
      preferences: snapshot.preferences,
      items: [
        {
          entityType: "project",
          entityId: "project-1",
          payload: snapshot.projects[0],
        },
      ],
      hasMore: true,
      nextAfter: { entityType: "project", entityId: "project-1" },
    },
    {
      version: 2,
      found: true,
      cursor: 91,
      profile: snapshot.profile,
      preferences: snapshot.preferences,
      items: [
        {
          entityType: "goal",
          entityId: "goal-1",
          payload: snapshot.goals[0],
        },
      ],
      hasMore: false,
      nextAfter: null,
    },
  ];
  const imported = [];
  const repository = {
    bootstrapRemoteSnapshot: (authUserId, received) => {
      imported.push([authUserId, received]);
      return {
        version: 1,
        account: { id: authUserId },
        projects: [],
        sessions: [],
        payments: [],
        goals: [],
        preferences: {},
      };
    },
    getQueuedOperations: () => {
      throw new Error("bootstrap must not push an outbox operation");
    },
  };
  const calls = [];
  let authorization;
  const requestHeaders = {
    get: () => authorization,
    set: (_name, value) => {
      authorization = value;
    },
    delete: () => {
      authorization = undefined;
    },
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rest: { headers: requestHeaders },
      rpc: async (name, args, options) => {
        calls.push([name, args, options, authorization]);
        return { data: pages.shift(), error: null };
      },
    },
  };
  const service = new SyncService({ repository, authService });
  const result = await service.bootstrapAuthenticatedAccount("auth-user-1");
  assert.equal(result.state, "restored");
  assert.equal(result.saved.account.id, "auth-user-1");
  assert.deepEqual(imported, [["auth-user-1", snapshot]]);
  assert.deepEqual(calls, [
    [
      "workly_bootstrap_page_v2",
      {
        p_after_type: null,
        p_after_id: null,
        p_snapshot_cursor: null,
        p_limit: 250,
      },
      undefined,
      "Bearer token",
    ],
    [
      "workly_bootstrap_page_v2",
      {
        p_after_type: "project",
        p_after_id: "project-1",
        p_snapshot_cursor: 91,
        p_limit: 250,
      },
      undefined,
      "Bearer token",
    ],
  ]);
  assert.equal(
    authorization,
    undefined,
    "the per-call bearer must not leak into later requests",
  );
  assert.equal(service.lastPull.cursor, 91);
});

test("reports not-found cloud bootstrap without creating a local account", async () => {
  let imported = false;
  const repository = {
    bootstrapRemoteSnapshot: () => {
      imported = true;
    },
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async () => ({
        data: {
          version: 2,
          found: false,
          cursor: 0,
          profile: null,
          preferences: null,
          items: [],
          hasMore: false,
          nextAfter: null,
        },
        error: null,
      }),
    },
  };
  const service = new SyncService({ repository, authService });
  assert.deepEqual(await service.bootstrapAuthenticatedAccount("auth-user-1"), {
    state: "not_found",
  });
  assert.equal(imported, false);
});

test("fails safely before local import when revision-aware bootstrap is not deployed", async () => {
  let imported = false;
  const repository = {
    bootstrapRemoteSnapshot: () => {
      imported = true;
    },
  };
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: {
      rpc: async () => ({
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.workly_bootstrap_page_v2",
        },
      }),
    },
  };
  const service = new SyncService({ repository, authService });

  await assert.rejects(
    service.bootstrapAuthenticatedAccount("auth-user-1"),
    /Apply Supabase migration 0005_optimistic_revisions\.sql/,
  );
  assert.equal(imported, false);
});

test("claims a local workspace through the atomic cloud RPC with a subject-bound token", async () => {
  const calls = [];
  const requestedSubjects = [];
  const headers = new Headers();
  const authService = {
    isConfigured: () => true,
    getAccessToken: async (subject) => {
      requestedSubjects.push(subject);
      return "subject-token";
    },
    client: {
      rest: { headers },
      rpc: async (name, params) => {
        calls.push({
          name,
          params,
          authorization: headers.get("Authorization"),
        });
        return { data: { claimed: true, created: true }, error: null };
      },
    },
  };
  const service = new SyncService({ repository: {}, authService });
  const account = {
    id: "workspace-1",
    displayName: "Minh",
    country: "VN",
    language: "vi",
    currency: "VND",
    timezone: "Asia/Saigon",
  };

  assert.deepEqual(await service.claimCloudWorkspace(account, "auth-user-1"), {
    state: "ready",
    data: { claimed: true, created: true },
  });
  assert.deepEqual(requestedSubjects, ["auth-user-1"]);
  assert.deepEqual(calls, [
    {
      name: "workly_claim_workspace",
      params: {
        p_workspace_id: "workspace-1",
        p_profile: {
          displayName: "Minh",
          country: "VN",
          language: "vi",
          currency: "VND",
          timezone: "Asia/Saigon",
        },
      },
      authorization: "Bearer subject-token",
    },
  ]);
  assert.equal(headers.has("Authorization"), false);
});

test("reports an actionable error when the hosted claim migration is missing", async () => {
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "subject-token",
    client: {
      rpc: async () => ({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function public.workly_claim_workspace",
        },
      }),
    },
  };
  const service = new SyncService({ repository: {}, authService });

  await assert.rejects(
    service.claimCloudWorkspace(
      {
        id: "workspace-1",
        displayName: "Minh",
        country: "VN",
        language: "vi",
        currency: "VND",
        timezone: "Asia/Saigon",
      },
      "auth-user-1",
    ),
    /Apply Supabase migration 0003_atomic_workspace_claim\.sql/,
  );
});
