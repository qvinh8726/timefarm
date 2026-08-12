const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createOverlayTimerActionHandler,
} = require("./overlay-timer-actions.cjs");

function createRepository(state) {
  return {
    state,
    writes: 0,
    loadState() {
      return this.state;
    },
    replaceState(next) {
      this.writes += 1;
      this.state = next;
      return next;
    },
  };
}

function stateWithAccount() {
  return {
    account: { id: "account-1", timezone: "Asia/Ho_Chi_Minh" },
    sessions: [],
  };
}

test("overlay actions require the shared command service instead of a divergent fallback", () => {
  const repository = createRepository(stateWithAccount());
  assert.throws(
    () => createOverlayTimerActionHandler({ repository }),
    /command service is required/i,
  );
});

test("stop requests an in-app completion flow and never silently writes zero earnings", async () => {
  const state = stateWithAccount();
  state.sessions.push({
    id: "session-1",
    status: "running",
    pauses: [],
    startedAt: "2026-08-10T00:00:00.000Z",
  });
  const repository = createRepository(state);
  const requested = [];
  let opened = 0;
  const action = createOverlayTimerActionHandler({
    repository,
    commandService: {
      execute: () => {
        throw new Error("stop must not execute a command");
      },
    },
    onOpen: () => {
      opened += 1;
    },
    onStopRequested: (request) => requested.push(request),
  });

  const result = await action("stop");
  assert.equal(result.ok, true);
  assert.equal(result.requiresCompletion, true);
  assert.equal(opened, 1);
  assert.equal(repository.writes, 0);
  assert.equal(requested[0].sessionId, "session-1");
  assert.equal(requested[0].session.status, "running");
});

test("command-backed overlay actions use the same typed timer path and respect a remote lease", async () => {
  const repository = createRepository(stateWithAccount());
  const commands = [];
  let renewed = 0;
  const action = createOverlayTimerActionHandler({
    repository,
    commandService: {
      execute: (command) => {
        commands.push(command);
        return {
          command: command.type,
          state: repository.state,
          result: { sessionId: "session-1" },
        };
      },
    },
    acquireTimerLease: async () => ({ state: "acquired" }),
    startLeaseRenewal: () => {
      renewed += 1;
    },
  });

  assert.equal((await action("start")).ok, true);
  assert.deepEqual(commands, [{ type: "session.start", payload: {} }]);
  assert.equal(renewed, 1);
  assert.equal(repository.writes, 0);

  const blocked = createOverlayTimerActionHandler({
    repository,
    commandService: {
      execute: () => {
        throw new Error("must not execute");
      },
    },
    acquireTimerLease: async () => ({ state: "held_by_other" }),
  });
  const result = await blocked("start");
  assert.equal(result.ok, false);
  assert.match(result.message, /another signed-in device/i);
});

test("overlay pause and resume forward the timestamp captured at IPC receipt", async () => {
  const repository = createRepository(stateWithAccount());
  const executions = [];
  const intentTimestamp = "2026-08-10T01:23:45.000Z";
  const action = createOverlayTimerActionHandler({
    repository,
    commandService: {
      preflight: () => {},
      execute: (command, options) => {
        executions.push({ command, options });
        return { command: command.type, state: repository.state, result: {} };
      },
    },
  });

  assert.equal((await action("pause", { intentTimestamp })).ok, true);
  assert.deepEqual(executions, [
    {
      command: { type: "session.pause", payload: {} },
      options: { intentTimestamp },
    },
  ]);
});

test("command-backed overlay preflights a stale timer action before it requests a lease", async () => {
  const repository = createRepository(stateWithAccount());
  let leaseRequests = 0;
  const action = createOverlayTimerActionHandler({
    repository,
    commandService: {
      preflight: () => {
        throw new Error("Only a paused session can be resumed.");
      },
      execute: () => {
        throw new Error("must not execute");
      },
    },
    acquireTimerLease: async () => {
      leaseRequests += 1;
      return { state: "acquired" };
    },
  });

  const result = await action("resume");
  assert.equal(result.ok, false);
  assert.match(result.message, /paused session/i);
  assert.equal(leaseRequests, 0);
});
