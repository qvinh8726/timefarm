const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  captureTimerIntentTimestamp,
  CommandError,
  CommandValidationError,
  CommandService,
  createLocalMutationExecutor,
} = require("./command-service.cjs");
const { LocalStateRepository } = require("./state-repository.cjs");
const { createCoalescedSyncExecutor } = require("./sync-service.cjs");

const START = "2026-08-10T00:00:00.000Z";
const ONE_HOUR = "2026-08-10T01:00:00.000Z";
const NINETY_MINUTES = "2026-08-10T01:30:00.000Z";
const THREE_HOURS = "2026-08-10T03:00:00.000Z";
const FOUR_HOURS = "2026-08-10T04:00:00.000Z";

function withService(callback, times = [START]) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "workly-command-service-"),
  );
  const repository = new LocalStateRepository(
    path.join(directory, "workly.db"),
  );
  let id = 0;
  let clockIndex = 0;
  const service = new CommandService({
    repository,
    clock: () => times[Math.min(clockIndex++, times.length - 1)],
    idFactory: () => `entity-${++id}`,
    timezone: () => "Asia/Saigon",
  });
  try {
    callback({ service, repository });
  } finally {
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function expectCommand(action, code) {
  assert.throws(
    action,
    (error) => error instanceof CommandError && error.code === code,
  );
}

function initialize(service) {
  return service.execute({
    type: "account.initialize",
    payload: {
      displayName: "Minh",
      country: "vn",
      language: "vi",
      currency: "VND",
    },
  });
}

function createProject(service, name = "Website") {
  return service.execute({
    type: "project.create",
    payload: { name, paymentModel: "progressive", color: "#7c3aed", icon: "W" },
  });
}

test("validates a strict account command and keeps account/user IDs main-process-owned", () =>
  withService(({ service, repository }) => {
    expectCommand(
      () =>
        service.execute({
          type: "account.initialize",
          payload: {
            displayName: "Minh",
            country: "VN",
            language: "vi",
            currency: "VND",
            accountId: "forged",
          },
        }),
      "COMMAND_VALIDATION_FAILED",
    );
    assert.equal(repository.loadState().account, null);

    const initialized = initialize(service);
    assert.equal(initialized.result.accountId, "entity-1");
    assert.equal(initialized.state.account.id, "entity-1");
    assert.equal(initialized.state.account.country, "VN");
    assert.equal(initialized.state.account.timezone, "Asia/Saigon");
    assert.equal(initialized.state.account.createdAt, START);

    expectCommand(
      () =>
        service.execute({
          type: "account.update-profile",
          payload: { country: "US" },
        }),
      "COMMAND_VALIDATION_FAILED",
    );
    assert.equal(repository.loadState().account.country, "VN");

    const linked = service.linkAuthenticatedAccount("supabase-subject-1");
    assert.equal(linked.result.changed, true);
    assert.equal(linked.state.account.authUserId, "supabase-subject-1");
    expectCommand(
      () => service.linkAuthenticatedAccount("supabase-subject-2"),
      "ACCOUNT_ALREADY_LINKED",
    );
  }));

test("runs timer start, pause, resume and completion with main-owned timestamps and exact active duration", () =>
  withService(
    ({ service, repository }) => {
      initialize(service);
      const project = createProject(service);

      expectCommand(
        () =>
          service.execute({
            type: "session.start",
            payload: {
              projectId: project.result.projectId,
              startedAt: FOUR_HOURS,
            },
          }),
        "COMMAND_VALIDATION_FAILED",
      );

      const started = service.execute({
        type: "session.start",
        payload: { projectId: project.result.projectId },
      });
      const sessionId = started.result.sessionId;
      assert.equal(started.state.sessions[0].startedAt, START);
      expectCommand(
        () =>
          service.execute({
            type: "session.complete",
            payload: {
              sessionId,
              money: { amountMinor: 0, currency: "VND" },
              endedAt: ONE_HOUR,
            },
          }),
        "COMMAND_VALIDATION_FAILED",
      );
      expectCommand(
        () =>
          service.execute({
            type: "session.recover-complete",
            payload: {
              sessionId,
              money: { amountMinor: 0, currency: "VND" },
              endedAt: "2026-08-09T23:59:59.000Z",
            },
          }),
        "SESSION_END_BEFORE_START",
      );
      expectCommand(
        () => service.execute({ type: "session.start", payload: {} }),
        "ACTIVE_SESSION_EXISTS",
      );

      const paused = service.execute({ type: "session.pause", payload: {} });
      assert.equal(paused.state.sessions[0].status, "paused");
      assert.deepEqual(paused.state.sessions[0].pauses, [
        { startedAt: ONE_HOUR, endedAt: undefined },
      ]);
      const resumed = service.execute({ type: "session.resume", payload: {} });
      assert.equal(resumed.state.sessions[0].status, "running");
      assert.deepEqual(resumed.state.sessions[0].pauses, [
        { startedAt: ONE_HOUR, endedAt: NINETY_MINUTES },
      ]);

      const completed = service.execute({
        type: "session.complete",
        payload: {
          sessionId,
          money: { amountMinor: 0, currency: "VND" },
          note: "  Zero paid, retained.  ",
        },
      });
      assert.equal(completed.result.activeDurationMs, 9_000_000);
      assert.equal(completed.state.sessions[0].status, "completed");
      assert.equal(completed.state.sessions[0].endedAt, THREE_HOURS);
      assert.equal(completed.state.sessions[0].earnings.amountMinor, 0);
      assert.equal(completed.state.sessions[0].note, "Zero paid, retained.");
      assert.equal(
        repository
          .getQueuedOperations(100)
          .some(
            (operation) =>
              operation.entityType === "work_session" &&
              operation.entityId === sessionId,
          ),
        true,
      );
    },
    [START, START, START, START, ONE_HOUR, NINETY_MINUTES, THREE_HOURS],
  ));

test("uses IPC receipt timestamps for pause, resume, and completion after later work is delayed", () =>
  withService(
    ({ service }) => {
      initialize(service);
      const project = createProject(service);
      const started = service.execute({
        type: "session.start",
        payload: { projectId: project.result.projectId },
      });

      const pauseCommand = { type: "session.pause", payload: {} };
      const pauseIntent = captureTimerIntentTimestamp(
        pauseCommand,
        () => ONE_HOUR,
      );
      const paused = service.execute(pauseCommand, {
        intentTimestamp: pauseIntent,
      });
      assert.equal(paused.state.sessions[0].pauses[0].startedAt, ONE_HOUR);

      const resumeCommand = { type: "session.resume", payload: {} };
      const resumeIntent = captureTimerIntentTimestamp(
        resumeCommand,
        () => NINETY_MINUTES,
      );
      const resumed = service.execute(resumeCommand, {
        intentTimestamp: resumeIntent,
      });
      assert.equal(resumed.state.sessions[0].pauses[0].endedAt, NINETY_MINUTES);

      const completeCommand = {
        type: "session.complete",
        payload: {
          sessionId: started.result.sessionId,
          money: { amountMinor: 0, currency: "VND" },
        },
      };
      const completeIntent = captureTimerIntentTimestamp(
        completeCommand,
        () => THREE_HOURS,
      );
      const completed = service.execute(completeCommand, {
        intentTimestamp: completeIntent,
      });
      assert.equal(completed.state.sessions[0].endedAt, THREE_HOURS);
      assert.equal(completed.result.activeDurationMs, 9_000_000);
    },
    [START, START, START, FOUR_HOURS],
  ));

test("rejects a recovery end after IPC receipt time without mutating the active session", () =>
  withService(
    ({ service, repository }) => {
      initialize(service);
      const project = createProject(service);
      const started = service.execute({
        type: "session.start",
        payload: { projectId: project.result.projectId },
      });
      const command = {
        type: "session.recover-complete",
        payload: {
          sessionId: started.result.sessionId,
          money: { amountMinor: 0, currency: "VND" },
          endedAt: FOUR_HOURS,
        },
      };
      const receivedAt = captureTimerIntentTimestamp(
        command,
        () => THREE_HOURS,
      );

      expectCommand(
        () => service.execute(command, { intentTimestamp: receivedAt }),
        "SESSION_END_IN_FUTURE",
      );
      assert.equal(repository.loadState().sessions[0].status, "running");

      command.payload.endedAt = ONE_HOUR;
      const recovered = service.execute(command, {
        intentTimestamp: receivedAt,
      });
      assert.equal(recovered.state.sessions[0].endedAt, ONE_HOUR);
    },
    [START, START, START],
  ));

test("uses the canonical ID tie-breaker when completed sessions end together", () =>
  withService(
    ({ service, repository }) => {
      initialize(service);
      const project = createProject(service);
      const state = repository.loadState();
      state.sessions = [
        {
          id: "z-session",
          projectId: project.result.projectId,
          startedAt: START,
          endedAt: FOUR_HOURS,
          timezone: "Asia/Saigon",
          pauses: [],
          activeDurationMs: 14_400_000,
          status: "completed",
          earnings: { amountMinor: 1, currency: "VND" },
          createdAt: START,
          updatedAt: FOUR_HOURS,
          syncStatus: "queued",
        },
        {
          id: "a-session",
          projectId: project.result.projectId,
          startedAt: THREE_HOURS,
          endedAt: FOUR_HOURS,
          timezone: "Asia/Saigon",
          pauses: [],
          activeDurationMs: 3_600_000,
          status: "completed",
          earnings: { amountMinor: 1, currency: "VND" },
          createdAt: THREE_HOURS,
          updatedAt: FOUR_HOURS,
          syncStatus: "queued",
        },
      ];
      repository.replaceState(state);

      const edited = service.execute({
        type: "session.edit-latest",
        payload: {
          sessionId: "z-session",
          money: { amountMinor: 2, currency: "VND" },
        },
      });
      assert.equal(
        edited.state.sessions.find((session) => session.id === "z-session")
          .earnings.amountMinor,
        2,
      );
      expectCommand(
        () =>
          service.execute({
            type: "session.edit-latest",
            payload: {
              sessionId: "a-session",
              money: { amountMinor: 3, currency: "VND" },
            },
          }),
        "SESSION_NOT_LATEST_COMPLETED",
      );
    },
    [START, START, FOUR_HOURS],
  ));

test("local mutation executor rejects async work and remains usable", async () => {
  const runLocalMutation = createLocalMutationExecutor();
  await assert.rejects(
    runLocalMutation(async () => "network-result"),
    /Local mutation callbacks must be synchronous/,
  );
  assert.equal(await runLocalMutation(() => "local-result"), "local-result");
});

test("a slow sync does not block local pause, resume, or complete mutations", async () => {
  let durable = {
    version: 1,
    account: null,
    projects: [],
    sessions: [],
    payments: [],
    goals: [],
    preferences: {},
  };
  const repository = {
    loadState: () => durable,
    replaceState: (next) => {
      durable = next;
      return durable;
    },
  };
  let id = 0;
  const service = new CommandService({
    repository,
    clock: () => START,
    idFactory: () => `concurrent-${++id}`,
    timezone: () => "Asia/Saigon",
  });
  const runLocalMutation = createLocalMutationExecutor();
  const runSync = createCoalescedSyncExecutor();
  const remote = (() => {
    let resolve;
    const promise = new Promise((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  })();

  await runLocalMutation(() => initialize(service));
  const project = await runLocalMutation(() => createProject(service));
  const started = await runLocalMutation(() =>
    service.execute({
      type: "session.start",
      payload: { projectId: project.result.projectId },
    }),
  );

  let syncSettled = false;
  const slowSync = runSync(() => remote.promise);
  void slowSync.then(() => {
    syncSettled = true;
  });
  const pauseCommand = { type: "session.pause", payload: {} };
  const pauseIntent = captureTimerIntentTimestamp(pauseCommand, () => ONE_HOUR);
  const paused = await runLocalMutation(() =>
    service.execute(pauseCommand, {
      intentTimestamp: pauseIntent,
    }),
  );
  assert.equal(paused.state.sessions[0].status, "paused");

  const resumeCommand = { type: "session.resume", payload: {} };
  const resumeIntent = captureTimerIntentTimestamp(
    resumeCommand,
    () => NINETY_MINUTES,
  );
  const resumed = await runLocalMutation(() =>
    service.execute(resumeCommand, {
      intentTimestamp: resumeIntent,
    }),
  );
  assert.equal(resumed.state.sessions[0].status, "running");

  const completeCommand = {
    type: "session.complete",
    payload: {
      sessionId: started.result.sessionId,
      money: { amountMinor: 0, currency: "VND" },
    },
  };
  const completeIntent = captureTimerIntentTimestamp(
    completeCommand,
    () => THREE_HOURS,
  );
  const completed = await runLocalMutation(() =>
    service.execute(completeCommand, {
      intentTimestamp: completeIntent,
    }),
  );
  assert.equal(completed.state.sessions[0].endedAt, THREE_HOURS);
  assert.equal(syncSettled, false);

  remote.resolve({ state: "complete" });
  await slowSync;
});

test("rejects arbitrary session completion/discard and handles an active-session discard without cloud history", () =>
  withService(({ service, repository }) => {
    initialize(service);
    const project = createProject(service);
    const started = service.execute({
      type: "session.start",
      payload: { projectId: project.result.projectId },
    });

    expectCommand(
      () =>
        service.execute({
          type: "session.complete",
          payload: {
            sessionId: "another-session",
            money: { amountMinor: 1, currency: "VND" },
          },
        }),
      "SESSION_NOT_ACTIVE",
    );
    expectCommand(
      () =>
        service.execute({
          type: "session.discard",
          payload: { sessionId: "another-session" },
        }),
      "SESSION_NOT_ACTIVE",
    );
    assert.equal(
      repository.loadState().sessions[0].id,
      started.result.sessionId,
    );

    const discarded = service.execute({
      type: "session.discard",
      payload: { sessionId: started.result.sessionId },
    });
    assert.equal(discarded.result.discarded, true);
    assert.equal(discarded.state.sessions.length, 0);
    assert.equal(
      repository
        .getQueuedOperations(100)
        .some((operation) => operation.entityType === "work_session"),
      false,
    );
  }));

test("creates a quick project and starts its timer in one durable command", () =>
  withService(({ service, repository }) => {
    initialize(service);
    const result = service.execute({
      type: "project.create-and-start-session",
      payload: {
        name: "Quick project",
        paymentModel: "per_session",
        color: "#2563eb",
        icon: "Q",
      },
    });
    const saved = repository.loadState();
    assert.equal(saved.projects.length, 1);
    assert.equal(saved.sessions.length, 1);
    assert.equal(saved.sessions[0].projectId, saved.projects[0].id);
    assert.equal(result.result.projectId, saved.projects[0].id);
    assert.equal(result.result.sessionId, saved.sessions[0].id);
    const quickOperations = repository
      .getQueuedOperations(500)
      .filter(
        (operation) =>
          operation.entityId === saved.projects[0].id ||
          operation.entityId === saved.sessions[0].id,
      );
    // Active timers remain device-local until completion by design; the new
    // project is the only cloud-eligible outbox entity at this point.
    assert.deepEqual(
      quickOperations.map((operation) => operation.entityType),
      ["project"],
    );
    expectCommand(
      () =>
        service.execute({
          type: "project.create-and-start-session",
          payload: {
            name: "Duplicate",
            paymentModel: "per_session",
            color: "#2563eb",
            icon: "D",
          },
        }),
      "ACTIVE_SESSION_EXISTS",
    );
    assert.equal(repository.loadState().projects.length, 1);
  }));

test("enforces project completion and historical locks through command transitions", () =>
  withService(
    ({ service }) => {
      initialize(service);
      const project = createProject(service);
      const started = service.execute({
        type: "session.start",
        payload: { projectId: project.result.projectId },
      });

      expectCommand(
        () =>
          service.execute({
            type: "project.set-status",
            payload: {
              projectId: project.result.projectId,
              status: "completed",
            },
          }),
        "PROJECT_HAS_ACTIVE_SESSION",
      );

      service.execute({
        type: "session.recover-complete",
        payload: {
          sessionId: started.result.sessionId,
          money: { amountMinor: 500_000, currency: "VND" },
          endedAt: ONE_HOUR,
        },
      });
      service.execute({
        type: "project.set-status",
        payload: { projectId: project.result.projectId, status: "completed" },
      });
      expectCommand(
        () =>
          service.execute({
            type: "session.start",
            payload: { projectId: project.result.projectId },
          }),
        "PROJECT_COMPLETED",
      );
      service.execute({
        type: "project.set-status",
        payload: { projectId: project.result.projectId, status: "active" },
      });

      const next = service.execute({
        type: "session.start",
        payload: { projectId: project.result.projectId },
      });
      expectCommand(
        () =>
          service.execute({
            type: "session.edit-latest",
            payload: {
              sessionId: next.result.sessionId,
              money: { amountMinor: 1, currency: "VND" },
            },
          }),
        "SESSION_NOT_LATEST_COMPLETED",
      );
    },
    [START, START, START, ONE_HOUR, THREE_HOURS, THREE_HOURS, FOUR_HOURS],
  ));

test("uses local ownership lookup and strict payload validation for projects and payments", () =>
  withService(({ service, repository }) => {
    initialize(service);
    const project = createProject(service);

    expectCommand(
      () =>
        service.execute({
          type: "project.update",
          payload: { projectId: project.result.projectId },
        }),
      "COMMAND_VALIDATION_FAILED",
    );
    expectCommand(
      () =>
        service.execute({
          type: "payment.create",
          payload: {
            projectId: "not-owned",
            money: { amountMinor: 100, currency: "VND" },
            kind: "progressive",
          },
        }),
      "PROJECT_NOT_FOUND",
    );
    expectCommand(
      () =>
        service.execute({
          type: "payment.create",
          payload: {
            projectId: project.result.projectId,
            money: { amountMinor: -1, currency: "VND" },
            kind: "progressive",
          },
        }),
      "COMMAND_VALIDATION_FAILED",
    );

    const payment = service.execute({
      type: "payment.create",
      payload: {
        projectId: project.result.projectId,
        money: { amountMinor: 250_000, currency: "VND" },
        kind: "progressive",
        note: "First delivery",
      },
    });
    service.execute({
      type: "payment.update",
      payload: {
        paymentId: payment.result.paymentId,
        money: { amountMinor: 300_000, currency: "VND" },
        note: null,
      },
    });
    assert.equal(repository.loadState().payments[0].money.amountMinor, 300_000);
    assert.equal(repository.loadState().payments[0].note, undefined);
    service.execute({
      type: "payment.delete",
      payload: { paymentId: payment.result.paymentId },
    });
    assert.equal(repository.loadState().payments.length, 0);
    assert.equal(
      repository
        .getQueuedOperations(100)
        .some(
          (operation) =>
            operation.entityType === "payment" &&
            operation.operation === "delete",
        ),
      true,
    );
  }));

test("updates and deletes only history-free local projects", () =>
  withService(({ service, repository }) => {
    initialize(service);
    const first = createProject(service, "Initial project");
    service.execute({
      type: "project.update",
      payload: {
        projectId: first.result.projectId,
        name: "Renamed project",
        expectedMoney: { amountMinor: 1_000_000, currency: "VND" },
        note: "Scope agreed",
      },
    });
    assert.equal(repository.loadState().projects[0].name, "Renamed project");
    assert.equal(
      repository.loadState().projects[0].expectedMoney.amountMinor,
      1_000_000,
    );
    service.execute({
      type: "project.delete",
      payload: { projectId: first.result.projectId },
    });
    assert.equal(repository.loadState().projects.length, 0);
    assert.equal(
      repository
        .getQueuedOperations(100)
        .some(
          (operation) =>
            operation.entityType === "project" &&
            operation.entityId === first.result.projectId &&
            operation.operation === "delete",
        ),
      true,
    );

    const second = createProject(service, "Tracked project");
    const active = service.execute({
      type: "session.start",
      payload: { projectId: second.result.projectId },
    });
    service.execute(
      {
        type: "session.recover-complete",
        payload: {
          sessionId: active.result.sessionId,
          money: { amountMinor: 0, currency: "VND" },
          endedAt: ONE_HOUR,
        },
      },
      { intentTimestamp: ONE_HOUR },
    );
    expectCommand(
      () =>
        service.execute({
          type: "project.delete",
          payload: { projectId: second.result.projectId },
        }),
      "PROJECT_DELETE_HAS_HISTORY",
    );
  }));

test("validates and persists goal and dashboard preference changes without custom fields", () =>
  withService(({ service, repository }) => {
    initialize(service);

    expectCommand(
      () =>
        service.execute({
          type: "goal.create",
          payload: { kind: "hours_daily", target: 0 },
        }),
      "COMMAND_VALIDATION_FAILED",
    );
    expectCommand(
      () =>
        service.execute({
          type: "goal.create",
          payload: { kind: "earnings_daily", target: 1.5 },
        }),
      "COMMAND_VALIDATION_FAILED",
    );
    expectCommand(
      () =>
        service.execute({
          type: "goal.create",
          payload: { kind: "projects_completed", target: 1.5 },
        }),
      "COMMAND_VALIDATION_FAILED",
    );
    const goal = service.execute({
      type: "goal.create",
      payload: { kind: "hours_daily", target: 4 },
    });
    service.execute({
      type: "goal.update",
      payload: { goalId: goal.result.goalId, target: 5 },
    });
    assert.equal(repository.loadState().goals[0].target, 5);
    service.execute({
      type: "goal.update",
      payload: {
        goalId: goal.result.goalId,
        kind: "projects_completed",
        target: 5,
      },
    });
    expectCommand(
      () =>
        service.execute({
          type: "goal.update",
          payload: { goalId: goal.result.goalId, target: 1.5 },
        }),
      "INVALID_GOAL_TARGET",
    );
    assert.equal(repository.loadState().goals[0].target, 5);
    service.execute({
      type: "goal.delete",
      payload: { goalId: goal.result.goalId },
    });
    assert.equal(repository.loadState().goals.length, 0);

    expectCommand(
      () =>
        service.execute({
          type: "preferences.update",
          payload: { dashboardHiddenWidgets: ["madeUpWidget"] },
        }),
      "COMMAND_VALIDATION_FAILED",
    );
    const preferences = service.execute({
      type: "preferences.update",
      payload: {
        theme: "dark",
        miniTimerMode: "view_only",
        dashboardHiddenWidgets: ["timer"],
        dashboardWidgetOrder: ["goals", "timer"],
        dashboardWidgetSizes: { goals: "large" },
      },
    });
    assert.equal(preferences.state.preferences.theme, "dark");
    assert.equal(
      preferences.state.preferences.dashboardWidgetSizes.goals,
      "large",
    );
  }));

test("surfaces zod validation details without mutating durable state", () =>
  withService(({ service, repository }) => {
    initialize(service);
    assert.throws(
      () =>
        service.execute({
          type: "session.pause",
          payload: { arbitrary: true },
        }),
      (error) => {
        assert.equal(error instanceof CommandValidationError, true);
        assert.equal(error.code, "COMMAND_VALIDATION_FAILED");
        assert.equal(Array.isArray(error.details), true);
        return true;
      },
    );
    assert.equal(repository.loadState().sessions.length, 0);
  }));

test("preflight schema-validates lease-aware timer commands and never writes state", () =>
  withService(({ service, repository }) => {
    initialize(service);
    const project = createProject(service);
    const originalReplaceState = repository.replaceState.bind(repository);
    const originalLoadState = repository.loadState.bind(repository);
    let writes = 0;
    repository.replaceState = (...args) => {
      writes += 1;
      return originalReplaceState(...args);
    };
    repository.loadState = () => {
      throw new Error(
        "preflight must not materialize the full application state",
      );
    };

    assert.deepEqual(
      service.preflight({
        type: "session.start",
        payload: { projectId: project.result.projectId },
      }),
      {
        command: "session.start",
        allowed: true,
      },
    );
    assert.equal(writes, 0);
    repository.loadState = originalLoadState;
    assert.equal(repository.loadState().sessions.length, 0);
    expectCommand(
      () =>
        service.preflight({
          type: "session.start",
          payload: { projectId: project.result.projectId, startedAt: START },
        }),
      "COMMAND_VALIDATION_FAILED",
    );
    assert.equal(writes, 0);

    const started = service.execute({
      type: "session.start",
      payload: { projectId: project.result.projectId },
    });
    assert.equal(writes, 1);
    expectCommand(
      () => service.preflight({ type: "session.start", payload: {} }),
      "ACTIVE_SESSION_EXISTS",
    );
    expectCommand(
      () => service.preflight({ type: "session.resume", payload: {} }),
      "SESSION_NOT_PAUSED",
    );
    assert.equal(writes, 1);
    assert.equal(
      repository.loadState().sessions[0].id,
      started.result.sessionId,
    );

    service.execute({ type: "session.pause", payload: {} });
    assert.equal(writes, 2);
    assert.deepEqual(
      service.preflight({ type: "session.resume", payload: {} }),
      {
        command: "session.resume",
        allowed: true,
      },
    );
    assert.equal(writes, 2);
    assert.equal(repository.loadState().sessions[0].status, "paused");
  }));

test("persists only the durable collections declared by each command", () =>
  withService(({ service, repository }) => {
    initialize(service);
    const originalReplaceState = repository.replaceState.bind(repository);
    const writeSets = [];
    repository.replaceState = (state, options) => {
      writeSets.push(options?.collections);
      return originalReplaceState(state, options);
    };

    service.execute({
      type: "preferences.update",
      payload: { theme: "dark" },
    });
    service.execute({
      type: "project.create-and-start-session",
      payload: {
        name: "Scoped write",
        paymentModel: "progressive",
        color: "#0f766e",
        icon: "S",
      },
    });

    assert.deepEqual(writeSets, [["preferences"], ["projects", "sessions"]]);
    assert.equal(repository.loadState().projects.length, 1);
    assert.equal(repository.loadState().sessions.length, 1);
  }));

test("preflight rejects missing accounts and completed projects before a lease request", () =>
  withService(({ service, repository }) => {
    const originalReplaceState = repository.replaceState.bind(repository);
    let writes = 0;
    repository.replaceState = (...args) => {
      writes += 1;
      return originalReplaceState(...args);
    };
    expectCommand(
      () => service.preflight({ type: "session.start", payload: {} }),
      "ACCOUNT_REQUIRED",
    );
    assert.equal(writes, 0);

    initialize(service);
    const project = createProject(service);
    service.execute({
      type: "project.set-status",
      payload: { projectId: project.result.projectId, status: "completed" },
    });
    writes = 0;
    expectCommand(
      () =>
        service.preflight({
          type: "session.start",
          payload: { projectId: project.result.projectId },
        }),
      "PROJECT_COMPLETED",
    );
    assert.equal(writes, 0);
    assert.equal(repository.loadState().sessions.length, 0);
  }));
