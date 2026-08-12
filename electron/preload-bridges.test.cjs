const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

function loadPreload(name) {
  const exposed = new Map();
  const invocations = [];
  const listeners = [];
  const removedListeners = [];
  const electron = {
    contextBridge: {
      exposeInMainWorld(key, value) {
        exposed.set(key, value);
      },
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        invocations.push({ channel, args });
        return { channel, args };
      },
      on(channel, callback) {
        listeners.push({ channel, callback });
      },
      removeListener(channel, callback) {
        removedListeners.push({ channel, callback });
      },
    },
  };
  const filename = path.join(__dirname, name);
  const originalLoad = Module._load;
  delete require.cache[require.resolve(filename)];
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return electron;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(filename);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(filename)];
  }
  return { exposed, invocations, listeners, removedListeners };
}

test("desktop preload exposes only the typed IPC bridge and cleans listeners", () => {
  const harness = loadPreload("preload.cjs");
  assert.deepEqual([...harness.exposed.keys()], ["worklyDesktop"]);
  const bridge = harness.exposed.get("worklyDesktop");

  const calls = [
    ["loadState", [], "workly:load-state"],
    ["getLegacyImportStatus", [], "workly:get-legacy-import-status"],
    ["legacyImportAction", ["retry"], "workly:legacy-import-action"],
    ["executeCommand", [{ type: "timer.pause" }], "workly:execute-command"],
    ["claimAuthenticatedAccount", [], "workly:claim-authenticated-account"],
    [
      "bootstrapAuthenticatedAccount",
      [],
      "workly:bootstrap-authenticated-account",
    ],
    ["resetLocalData", [], "workly:reset-local-data"],
    ["rebuildLocalCache", [], "workly:rebuild-local-cache"],
    ["getSyncSummary", [], "workly:get-sync-summary"],
    ["getTimerLeaseStatus", [], "workly:get-timer-lease-status"],
    ["acquireTimerLease", [], "workly:acquire-timer-lease"],
    ["getSyncConflicts", [25], "workly:get-sync-conflicts"],
    ["resolveSyncConflict", ["conflict-1"], "workly:resolve-sync-conflict"],
    [
      "acceptRemoteSyncConflict",
      ["conflict-1"],
      "workly:accept-remote-sync-conflict",
    ],
    ["syncNow", [], "workly:sync-now"],
    ["getFxStatus", [], "workly:fx-status"],
    ["refreshFxRates", [], "workly:fx-refresh"],
    [
      "convertMoney",
      [{ amountMinor: 1, currency: "USD" }, "VND"],
      "workly:fx-convert",
    ],
    ["getOverlayPreferences", [], "workly:overlay:get-preferences"],
    [
      "setOverlayPreferences",
      [{ mode: "hidden" }],
      "workly:overlay:set-preferences",
    ],
    ["getAuthStatus", [], "workly:get-auth-status"],
    ["signUp", [{ email: "a@example.com" }], "workly:auth-sign-up"],
    ["signIn", [{ email: "a@example.com" }], "workly:auth-sign-in"],
    ["signInWithGoogle", [], "workly:auth-google"],
    ["signOut", [], "workly:auth-sign-out"],
  ];
  for (const [method, args, channel] of calls) {
    assert.equal(typeof bridge[method], "function", method);
    assert.equal(bridge[method](...args).channel, channel);
  }
  assert.deepEqual(
    harness.invocations.map((call) => call.channel),
    calls.map((call) => call[2]),
  );

  for (const [method, channel] of [
    ["onAuthChanged", "workly:auth-changed"],
    ["onStateChanged", "workly:state-changed"],
    ["onTimerLeaseChanged", "workly:timer-lease-changed"],
    ["onOverlayStopRequested", "workly:overlay-stop-request"],
  ]) {
    let received;
    const unsubscribe = bridge[method]((value) => {
      received = value;
    });
    const registration = harness.listeners.at(-1);
    assert.equal(registration.channel, channel);
    registration.callback({}, { ok: true });
    assert.deepEqual(received, { ok: true });
    unsubscribe();
    assert.deepEqual(harness.removedListeners.at(-1), registration);
  }
});

test("overlay preload exposes its action and disposable snapshot subscription", () => {
  const harness = loadPreload("overlay-preload.cjs");
  assert.deepEqual([...harness.exposed.keys()], ["worklyOverlay"]);
  const bridge = harness.exposed.get("worklyOverlay");
  assert.deepEqual(bridge.action("pause"), {
    channel: "workly:overlay:action",
    args: ["pause"],
  });

  let received;
  const unsubscribe = bridge.onSnapshot((value) => {
    received = value;
  });
  const registration = harness.listeners[0];
  assert.equal(registration.channel, "workly:overlay-snapshot");
  registration.callback({}, { elapsedMs: 42 });
  assert.deepEqual(received, { elapsedMs: 42 });
  unsubscribe();
  assert.deepEqual(harness.removedListeners[0], registration);
});
