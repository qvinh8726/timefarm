const assert = require("node:assert/strict");
const test = require("node:test");
const { SyncService } = require("./sync-service.cjs");

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
