const assert = require("node:assert/strict");
const test = require("node:test");
const { SyncService } = require("./sync-service.cjs");

const { performMainSignOut } = require("./main-auth-lifecycle.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForRpcSetup() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("main sign-out cancels in-flight and scheduled sync before credentials are removed", async () => {
  const pull = deferred();
  let remoteApplies = 0;
  let continuationPending = true;
  let continuationRuns = 0;
  let publishedAuthStatus = null;
  let lifecycleGeneration = 0;
  const signedOutStatus = {
    configured: true,
    authenticated: false,
    user: null,
  };
  const cancellationOrder = [];
  const authService = {
    isConfigured: () => true,
    getAccessToken: async () => "token",
    client: { rpc: () => pull.promise },
    signOut: async () => {
      cancellationOrder.push("credentials");
      if (continuationPending) continuationRuns += 1;
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
      await waitForRpcSetup();
      return signedOutStatus;
    },
  };
  const syncService = new SyncService({
    repository: {
      getPullCursor: () => 0,
      applyRemoteChanges: () => {
        remoteApplies += 1;
        return { cursor: 1, applied: 1, conflicts: 0 };
      },
      getQueuedOperations: () => [],
    },
    authService,
  });
  const runningSync = syncService.syncNow("auth-user-1");
  await waitForRpcSetup();
  const cancelPendingSync = syncService.cancelPendingSync.bind(syncService);
  syncService.cancelPendingSync = () => {
    cancellationOrder.push("sync");
    return cancelPendingSync();
  };

  const status = await performMainSignOut({
    authService,
    syncService,
    cancelSyncContinuation: () => {
      cancellationOrder.push("continuation");
      continuationPending = false;
    },
    invalidateCloudLifecycle: () => {
      cancellationOrder.push("lifecycle");
      lifecycleGeneration += 1;
    },
    notifyAuthChanged: (nextStatus) => {
      publishedAuthStatus = nextStatus;
    },
  });

  assert.deepEqual(await runningSync, {
    state: "cancelled",
    processed: 0,
    failed: 0,
  });
  assert.equal(remoteApplies, 0);
  assert.equal(continuationRuns, 0);
  assert.equal(continuationPending, false);
  assert.deepEqual(cancellationOrder, [
    "sync",
    "continuation",
    "lifecycle",
    "credentials",
  ]);
  assert.equal(lifecycleGeneration, 1);
  assert.equal(status, signedOutStatus);
  assert.equal(publishedAuthStatus, signedOutStatus);
});
