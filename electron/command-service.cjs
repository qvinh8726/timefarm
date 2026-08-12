const crypto = require("node:crypto");
const {
  AuthUserIdSchema,
  CommandSchema,
  IdentifierSchema,
  TimeZoneSchema,
} = require("./command-contract.cjs");
const { goalTargetIssue } = require("./goal-validation.cjs");
const {
  compareCompletedSessionsNewestFirst,
} = require("./session-ordering.cjs");

class CommandError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.details = details;
  }
}

class CommandValidationError extends CommandError {
  constructor(issues) {
    super(
      "COMMAND_VALIDATION_FAILED",
      "The command payload is invalid.",
      issues,
    );
    this.name = "CommandValidationError";
  }
}

/** @returns {never} */
function fail(code, message, details) {
  throw new CommandError(code, message, details);
}

function parseCommand(value) {
  const parsed = CommandSchema.safeParse(value);
  if (!parsed.success) {
    throw new CommandValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function parseAuthUserId(value) {
  const parsed = AuthUserIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new CommandValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function dateMs(value, code = "INVALID_TIMESTAMP") {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    fail(code, "A valid ISO timestamp is required.", { value });
  return milliseconds;
}

function normaliseTimestamp(value, code) {
  const milliseconds =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  if (!Number.isFinite(milliseconds))
    fail(code, "The clock returned an invalid timestamp.");
  return new Date(milliseconds).toISOString();
}

const INTENT_TIMESTAMP_COMMANDS = new Set([
  "session.pause",
  "session.resume",
  "session.complete",
  "session.recover-complete",
]);

/**
 * Captures the main-process receipt time for timer actions whose factual time
 * must not drift while auth, lease, or other asynchronous work is pending.
 * The renderer cannot provide this value.
 */
function captureTimerIntentTimestamp(rawCommand, clock = () => new Date()) {
  if (!INTENT_TIMESTAMP_COMMANDS.has(rawCommand?.type)) return undefined;
  if (typeof clock !== "function")
    throw new TypeError("Timer intent clock must be a function.");
  return normaliseTimestamp(clock(), "INVALID_INTENT_CLOCK");
}

/**
 * Serializes synchronous local database transactions. Async callbacks are
 * rejected deliberately: no auth or network promise may hold this queue.
 */
function createLocalMutationExecutor() {
  let queue = Promise.resolve();
  return function runLocalMutation(work) {
    if (typeof work !== "function")
      return Promise.reject(
        new TypeError("A local mutation callback must be a function."),
      );
    const invoke = () => {
      const result = work();
      if (result && typeof result.then === "function") {
        throw new TypeError(
          "Local mutation callbacks must be synchronous; run auth and network work outside the SQLite queue.",
        );
      }
      return result;
    };
    const run = queue.then(invoke, invoke);
    queue = run.catch(() => {});
    return run;
  };
}

function defaultTimezone() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

function optionalText(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function activeSessions(state) {
  return state.sessions.filter(
    (session) => session.status === "running" || session.status === "paused",
  );
}

function activeSession(state) {
  const sessions = activeSessions(state);
  if (sessions.length > 1) {
    fail(
      "INTEGRITY_MULTIPLE_ACTIVE_SESSIONS",
      "The local database contains more than one active session.",
      {
        sessionIds: sessions.map((session) => session.id),
      },
    );
  }
  return sessions[0];
}

function latestCompletedSession(state) {
  return state.sessions
    .filter((session) => session.status === "completed")
    .sort(compareCompletedSessionsNewestFirst)[0];
}

function calculateActiveDuration(session, endedAt) {
  const startedAtMs = dateMs(session.startedAt, "INVALID_SESSION_START");
  const endedAtMs = dateMs(endedAt, "INVALID_SESSION_END");
  if (endedAtMs < startedAtMs) {
    fail("SESSION_END_BEFORE_START", "A session cannot end before it starts.", {
      sessionId: session.id,
    });
  }

  let pausedMs = 0;
  let previousPauseEnd = startedAtMs;
  for (let index = 0; index < session.pauses.length; index += 1) {
    const pause = session.pauses[index];
    const pauseStartMs = dateMs(pause.startedAt, "INVALID_PAUSE_START");
    const isOpen = pause.endedAt === undefined || pause.endedAt === null;
    const pauseEndMs = isOpen
      ? endedAtMs
      : dateMs(pause.endedAt, "INVALID_PAUSE_END");
    if (pauseStartMs < startedAtMs || pauseStartMs < previousPauseEnd) {
      fail(
        "INVALID_PAUSE_SEQUENCE",
        "Session pauses overlap or precede the session start.",
        { sessionId: session.id, index },
      );
    }
    if (isOpen && index !== session.pauses.length - 1) {
      fail(
        "INVALID_PAUSE_SEQUENCE",
        "Only the last session pause may be open.",
        { sessionId: session.id, index },
      );
    }
    if (pauseStartMs > endedAtMs) {
      fail(
        "SESSION_END_BEFORE_PAUSE_START",
        "A session cannot end before its current pause begins.",
        { sessionId: session.id, index },
      );
    }
    if (pauseEndMs < pauseStartMs || pauseEndMs > endedAtMs) {
      fail(
        "INVALID_PAUSE_SEQUENCE",
        "A session pause is outside the completion range.",
        { sessionId: session.id, index },
      );
    }
    pausedMs += pauseEndMs - pauseStartMs;
    previousPauseEnd = pauseEndMs;
  }
  return Math.max(0, endedAtMs - startedAtMs - pausedMs);
}

function closeTerminalPause(pauses, endedAt) {
  if (pauses.length === 0) return pauses;
  const lastIndex = pauses.length - 1;
  const last = pauses[lastIndex];
  if (last.endedAt !== undefined && last.endedAt !== null) return pauses;
  return pauses.map((pause, index) =>
    index === lastIndex ? { ...pause, endedAt } : pause,
  );
}

function projectFor(state, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project)
    fail(
      "PROJECT_NOT_FOUND",
      "The selected project does not belong to this local account.",
      { projectId },
    );
  return project;
}

function paymentFor(state, paymentId) {
  const payment = state.payments.find((item) => item.id === paymentId);
  if (!payment)
    fail(
      "PAYMENT_NOT_FOUND",
      "The selected payment does not belong to this local account.",
      { paymentId },
    );
  return payment;
}

function goalFor(state, goalId) {
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal)
    fail(
      "GOAL_NOT_FOUND",
      "The selected goal does not belong to this local account.",
      { goalId },
    );
  return goal;
}

function requireValidGoalTarget(kind, target) {
  const issue = goalTargetIssue(kind, target);
  if (issue) fail("INVALID_GOAL_TARGET", issue, { kind, target });
}

function requireAccount(state) {
  if (!state.account)
    fail(
      "ACCOUNT_REQUIRED",
      "Complete account setup before changing work data.",
    );
  return state.account;
}

const COMMAND_WRITE_SETS = Object.freeze({
  "account.initialize": ["account", "preferences"],
  "account.update-profile": ["account"],
  "account.link-authenticated-user": ["account"],
  "project.create": ["projects"],
  "project.create-and-start-session": ["projects", "sessions"],
  "project.update": ["projects"],
  "project.set-status": ["projects"],
  "project.delete": ["projects"],
  "session.start": ["sessions"],
  "session.pause": ["sessions"],
  "session.resume": ["sessions"],
  "session.complete": ["sessions"],
  "session.recover-complete": ["sessions"],
  "session.discard": ["sessions"],
  "session.edit-latest": ["sessions"],
  "payment.create": ["payments"],
  "payment.update": ["payments"],
  "payment.delete": ["payments"],
  "goal.create": ["goals"],
  "goal.update": ["goals"],
  "goal.delete": ["goals"],
  "preferences.update": ["preferences"],
});

/**
 * Applies concrete, validated commands to durable local state.  The service
 * never accepts an accountId, and resolves every project/session/payment/goal
 * from repository.loadState(), so a renderer cannot select another account by
 * forging ownership fields in an IPC payload.
 */
class CommandService {
  /** @param {{repository?: any, clock?: () => any, idFactory?: () => string, timezone?: () => string}} options */
  constructor({
    repository,
    clock = () => new Date(),
    idFactory = () => crypto.randomUUID(),
    timezone = defaultTimezone,
  } = {}) {
    if (
      !repository ||
      typeof repository.loadState !== "function" ||
      typeof repository.replaceState !== "function"
    ) {
      throw new TypeError(
        "CommandService requires a repository with loadState() and replaceState().",
      );
    }
    if (
      typeof clock !== "function" ||
      typeof idFactory !== "function" ||
      typeof timezone !== "function"
    ) {
      throw new TypeError(
        "CommandService clock, idFactory, and timezone options must be functions.",
      );
    }
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
    this.timezone = timezone;
  }

  now() {
    return normaliseTimestamp(this.clock(), "INVALID_CLOCK");
  }

  newId() {
    const parsed = IdentifierSchema.safeParse(this.idFactory());
    if (!parsed.success)
      fail(
        "INVALID_ID_FACTORY",
        "The ID factory returned an invalid identifier.",
      );
    return parsed.data;
  }

  defaultTimezone() {
    const parsed = TimeZoneSchema.safeParse(this.timezone());
    if (!parsed.success)
      fail(
        "INVALID_DEFAULT_TIMEZONE",
        "The default device timezone is invalid.",
      );
    return parsed.data;
  }

  persist(commandType, nextState, result) {
    const collections = COMMAND_WRITE_SETS[commandType];
    if (!collections)
      fail(
        "UNKNOWN_COMMAND_WRITE_SET",
        "The command does not declare which durable collections it changes.",
        { commandType },
      );
    const state = this.repository.replaceState(nextState, { collections });
    return { command: commandType, state, result };
  }

  /**
   * @param {unknown} rawCommand
   * @param {{intentTimestamp?: unknown}} [options]
   */
  execute(rawCommand, { intentTimestamp } = {}) {
    const command = parseCommand(rawCommand);
    const state = this.repository.loadState();
    const transition = this.transition(state, command, { intentTimestamp });
    return this.persist(command.type, transition.state, transition.result);
  }

  /**
   * Read-only gate for lease-aware timer actions. It validates every command
   * schema, and additionally checks the current durable state for start/resume
   * without allocating an ID, reading the clock, or calling replaceState().
   */
  preflight(rawCommand) {
    const command = parseCommand(rawCommand);
    const projectId =
      command.type === "session.start" ? command.payload.projectId : undefined;
    const state =
      typeof this.repository.loadTimerPreflightState === "function"
        ? this.repository.loadTimerPreflightState(projectId)
        : this.repository.loadState();
    if (command.type === "session.start")
      this.assertSessionStartAllowed(state, command.payload);
    if (command.type === "project.create-and-start-session")
      this.assertSessionStartAllowed(state, {});
    if (command.type === "session.resume")
      this.assertSessionResumeAllowed(state);
    return { command: command.type, allowed: true };
  }

  /**
   * This is intentionally separate from execute().  Main-process auth code
   * should call it only with the authenticated subject it obtained from the
   * provider; do not expose it as a renderer-facing IPC command.
   */
  linkAuthenticatedAccount(rawAuthUserId) {
    const authUserId = parseAuthUserId(rawAuthUserId);
    const state = this.repository.loadState();
    const account = requireAccount(state);
    if (account.authUserId && account.authUserId !== authUserId) {
      fail(
        "ACCOUNT_ALREADY_LINKED",
        "This local account is already linked to a different authenticated user.",
      );
    }
    if (account.authUserId === authUserId) {
      return {
        command: "account.link-authenticated-user",
        state,
        result: { accountId: account.id, changed: false },
      };
    }
    return this.persist(
      "account.link-authenticated-user",
      {
        ...state,
        account: { ...account, authUserId },
      },
      { accountId: account.id, changed: true },
    );
  }

  /** @param {any} state @param {any} command @param {{intentTimestamp?: unknown}} [options] */
  transition(state, command, { intentTimestamp } = {}) {
    const { payload } = command;
    switch (command.type) {
      case "account.initialize":
        return this.initializeAccount(state, payload);
      case "account.update-profile":
        return this.updateAccountProfile(state, payload);
      case "project.create":
        return this.createProject(state, payload);
      case "project.create-and-start-session":
        return this.createProjectAndStartSession(state, payload);
      case "project.update":
        return this.updateProject(state, payload);
      case "project.set-status":
        return this.setProjectStatus(state, payload);
      case "project.delete":
        return this.deleteProject(state, payload);
      case "session.start":
        return this.startSession(state, payload);
      case "session.pause":
        return this.pauseSession(state, intentTimestamp);
      case "session.resume":
        return this.resumeSession(state, intentTimestamp);
      case "session.complete":
        return this.completeSession(state, payload, intentTimestamp);
      case "session.recover-complete":
        return this.recoverCompletedSession(state, payload, intentTimestamp);
      case "session.discard":
        return this.discardSession(state, payload);
      case "session.edit-latest":
        return this.editLatestSession(state, payload);
      case "payment.create":
        return this.createPayment(state, payload);
      case "payment.update":
        return this.updatePayment(state, payload);
      case "payment.delete":
        return this.deletePayment(state, payload);
      case "goal.create":
        return this.createGoal(state, payload);
      case "goal.update":
        return this.updateGoal(state, payload);
      case "goal.delete":
        return this.deleteGoal(state, payload);
      case "preferences.update":
        return this.updatePreferences(state, payload);
      default:
        return fail("UNKNOWN_COMMAND", "The command type is not supported.");
    }
  }

  initializeAccount(state, payload) {
    if (state.account)
      fail(
        "ACCOUNT_ALREADY_EXISTS",
        "Local account setup has already been completed.",
      );
    if (
      state.projects.length ||
      state.sessions.length ||
      state.payments.length ||
      state.goals.length
    ) {
      fail(
        "ACCOUNT_STATE_INTEGRITY",
        "Cannot initialize an account over orphaned local work data.",
      );
    }
    const timestamp = this.now();
    const timezone = payload.timezone ?? this.defaultTimezone();
    const account = {
      id: this.newId(),
      displayName: payload.displayName,
      country: payload.country,
      language: payload.language,
      currency: payload.currency,
      timezone,
      createdAt: timestamp,
    };
    return { state: { ...state, account }, result: { accountId: account.id } };
  }

  updateAccountProfile(state, payload) {
    const account = requireAccount(state);
    const accountNext = {
      ...account,
      ...(payload.displayName !== undefined
        ? { displayName: payload.displayName }
        : {}),
      ...(payload.language !== undefined ? { language: payload.language } : {}),
      ...(payload.timezone !== undefined ? { timezone: payload.timezone } : {}),
    };
    return {
      state: { ...state, account: accountNext },
      result: { accountId: account.id },
    };
  }

  createProject(state, payload) {
    requireAccount(state);
    const timestamp = this.now();
    const project = {
      id: this.newId(),
      name: payload.name,
      paymentModel: payload.paymentModel,
      expectedMoney: payload.expectedMoney,
      note: optionalText(payload.note),
      color: payload.color,
      icon: payload.icon,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      syncStatus: "local",
    };
    return {
      state: { ...state, projects: [project, ...state.projects] },
      result: { projectId: project.id },
    };
  }

  createProjectAndStartSession(state, payload) {
    this.assertSessionStartAllowed(state, {});
    const projectTransition = this.createProject(state, payload);
    const projectId = projectTransition.result.projectId;
    const sessionTransition = this.startSession(projectTransition.state, {
      projectId,
    });
    return {
      state: sessionTransition.state,
      result: { projectId, sessionId: sessionTransition.result.sessionId },
    };
  }

  updateProject(state, payload) {
    requireAccount(state);
    const project = projectFor(state, payload.projectId);
    const timestamp = this.now();
    const projectNext = {
      ...project,
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.paymentModel !== undefined
        ? { paymentModel: payload.paymentModel }
        : {}),
      ...(payload.expectedMoney !== undefined
        ? { expectedMoney: payload.expectedMoney ?? undefined }
        : {}),
      ...(payload.note !== undefined
        ? { note: optionalText(payload.note) }
        : {}),
      ...(payload.color !== undefined ? { color: payload.color } : {}),
      ...(payload.icon !== undefined ? { icon: payload.icon } : {}),
      updatedAt: timestamp,
      syncStatus: "queued",
    };
    return {
      state: {
        ...state,
        projects: state.projects.map((item) =>
          item.id === project.id ? projectNext : item,
        ),
      },
      result: { projectId: project.id },
    };
  }

  setProjectStatus(state, payload) {
    requireAccount(state);
    const project = projectFor(state, payload.projectId);
    if (
      payload.status === "completed" &&
      state.sessions.some(
        (session) =>
          session.projectId === project.id &&
          (session.status === "running" || session.status === "paused"),
      )
    ) {
      fail(
        "PROJECT_HAS_ACTIVE_SESSION",
        "End or discard the active session before completing this project.",
        { projectId: project.id },
      );
    }
    const timestamp = this.now();
    const projectNext = {
      ...project,
      status: payload.status,
      completedAt: payload.status === "completed" ? timestamp : undefined,
      updatedAt: timestamp,
      syncStatus: "queued",
    };
    return {
      state: {
        ...state,
        projects: state.projects.map((item) =>
          item.id === project.id ? projectNext : item,
        ),
      },
      result: { projectId: project.id, status: payload.status },
    };
  }

  deleteProject(state, payload) {
    requireAccount(state);
    const project = projectFor(state, payload.projectId);
    const hasHistory =
      state.sessions.some((session) => session.projectId === project.id) ||
      state.payments.some((payment) => payment.projectId === project.id);
    if (hasHistory) {
      fail(
        "PROJECT_DELETE_HAS_HISTORY",
        "Projects with work-session or payment history cannot be deleted.",
        { projectId: project.id },
      );
    }
    return {
      state: {
        ...state,
        projects: state.projects.filter((item) => item.id !== project.id),
      },
      result: { projectId: project.id, deleted: true },
    };
  }

  startSession(state, payload) {
    const account = this.assertSessionStartAllowed(state, payload);
    const timestamp = this.now();
    const session = {
      id: this.newId(),
      projectId: payload.projectId,
      startedAt: timestamp,
      timezone: account.timezone,
      pauses: [],
      status: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
      syncStatus: "local",
    };
    return {
      state: { ...state, sessions: [session, ...state.sessions] },
      result: { sessionId: session.id },
    };
  }

  pauseSession(state, intentTimestamp) {
    requireAccount(state);
    const session = activeSession(state);
    if (!session)
      fail("NO_ACTIVE_SESSION", "There is no active session to pause.");
    if (session.status !== "running")
      fail("SESSION_NOT_RUNNING", "Only a running session can be paused.", {
        sessionId: session.id,
      });
    const timestamp =
      intentTimestamp === undefined
        ? this.now()
        : normaliseTimestamp(intentTimestamp, "INVALID_INTENT_TIMESTAMP");
    if (dateMs(timestamp) < dateMs(session.startedAt))
      fail(
        "CLOCK_BEFORE_SESSION",
        "The device clock is earlier than the session start.",
      );
    const sessionNext = {
      ...session,
      status: "paused",
      pauses: [...session.pauses, { startedAt: timestamp }],
      updatedAt: timestamp,
      syncStatus: "local",
    };
    return {
      state: {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === session.id ? sessionNext : item,
        ),
      },
      result: { sessionId: session.id, status: "paused" },
    };
  }

  resumeSession(state, intentTimestamp) {
    const session = this.assertSessionResumeAllowed(state);
    const lastPause = session.pauses.at(-1);
    const timestamp =
      intentTimestamp === undefined
        ? this.now()
        : normaliseTimestamp(intentTimestamp, "INVALID_INTENT_TIMESTAMP");
    if (dateMs(timestamp) < dateMs(lastPause.startedAt))
      fail(
        "CLOCK_BEFORE_PAUSE",
        "The device clock is earlier than the pause start.",
      );
    const pauses = session.pauses.map((pause, index) =>
      index === session.pauses.length - 1
        ? { ...pause, endedAt: timestamp }
        : pause,
    );
    const sessionNext = {
      ...session,
      status: "running",
      pauses,
      updatedAt: timestamp,
      syncStatus: "local",
    };
    return {
      state: {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === session.id ? sessionNext : item,
        ),
      },
      result: { sessionId: session.id, status: "running" },
    };
  }

  assertSessionStartAllowed(state, payload) {
    const account = requireAccount(state);
    if (activeSession(state))
      fail(
        "ACTIVE_SESSION_EXISTS",
        "Only one work session can be active at a time.",
      );
    if (payload.projectId !== undefined) {
      const project = projectFor(state, payload.projectId);
      if (project.status === "completed") {
        fail(
          "PROJECT_COMPLETED",
          "Reopen the project before starting a new session.",
          { projectId: project.id },
        );
      }
    }
    return account;
  }

  assertSessionResumeAllowed(state) {
    requireAccount(state);
    const session = activeSession(state);
    if (!session)
      fail("NO_ACTIVE_SESSION", "There is no paused session to resume.");
    if (session.status !== "paused")
      fail("SESSION_NOT_PAUSED", "Only a paused session can be resumed.", {
        sessionId: session.id,
      });
    const lastPause = session.pauses.at(-1);
    if (!lastPause || lastPause.endedAt !== undefined) {
      fail(
        "INVALID_PAUSE_SEQUENCE",
        "The paused session does not have an open terminal pause.",
        { sessionId: session.id },
      );
    }
    return session;
  }

  completeSession(state, payload, intentTimestamp) {
    requireAccount(state);
    const session = activeSession(state);
    if (!session || session.id !== payload.sessionId) {
      fail(
        "SESSION_NOT_ACTIVE",
        "Only the current active session can be completed.",
        { sessionId: payload.sessionId },
      );
    }
    const endedAt =
      payload.endedAt ??
      (intentTimestamp === undefined
        ? this.now()
        : normaliseTimestamp(intentTimestamp, "INVALID_INTENT_TIMESTAMP"));
    const activeDurationMs = calculateActiveDuration(session, endedAt);
    const sessionNext = {
      ...session,
      status: "completed",
      endedAt,
      pauses: closeTerminalPause(session.pauses, endedAt),
      activeDurationMs,
      earnings: payload.money,
      note: optionalText(payload.note),
      updatedAt: endedAt,
      syncStatus: "queued",
    };
    return {
      state: {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === session.id ? sessionNext : item,
        ),
      },
      result: { sessionId: session.id, activeDurationMs },
    };
  }

  recoverCompletedSession(state, payload, intentTimestamp) {
    const receivedAt =
      intentTimestamp === undefined
        ? normaliseTimestamp(this.now(), "INVALID_RECOVERY_CLOCK")
        : normaliseTimestamp(intentTimestamp, "INVALID_INTENT_TIMESTAMP");
    if (dateMs(payload.endedAt) > dateMs(receivedAt)) {
      fail(
        "SESSION_END_IN_FUTURE",
        "A recovered session cannot end in the future.",
        { endedAt: payload.endedAt, receivedAt },
      );
    }
    return this.completeSession(state, payload);
  }

  discardSession(state, payload) {
    requireAccount(state);
    const session = activeSession(state);
    if (!session || session.id !== payload.sessionId) {
      fail(
        "SESSION_NOT_ACTIVE",
        "Only the current active session can be discarded.",
        { sessionId: payload.sessionId },
      );
    }
    return {
      state: {
        ...state,
        sessions: state.sessions.filter((item) => item.id !== session.id),
      },
      result: { sessionId: session.id, discarded: true },
    };
  }

  editLatestSession(state, payload) {
    requireAccount(state);
    const latest = latestCompletedSession(state);
    if (!latest || latest.id !== payload.sessionId) {
      fail(
        "SESSION_NOT_LATEST_COMPLETED",
        "Only the latest completed session can be edited.",
        { sessionId: payload.sessionId },
      );
    }
    const timestamp = this.now();
    if (dateMs(timestamp) < dateMs(latest.endedAt ?? latest.startedAt)) {
      fail(
        "CLOCK_BEFORE_SESSION_END",
        "The device clock is earlier than the latest completed session end.",
      );
    }
    const sessionNext = {
      ...latest,
      earnings: payload.money,
      note: optionalText(payload.note),
      updatedAt: timestamp,
      syncStatus: "queued",
    };
    return {
      state: {
        ...state,
        sessions: state.sessions.map((item) =>
          item.id === latest.id ? sessionNext : item,
        ),
      },
      result: { sessionId: latest.id },
    };
  }

  createPayment(state, payload) {
    requireAccount(state);
    projectFor(state, payload.projectId);
    const timestamp = this.now();
    const payment = {
      id: this.newId(),
      projectId: payload.projectId,
      money: payload.money,
      kind: payload.kind,
      receivedAt: payload.receivedAt ?? timestamp,
      note: optionalText(payload.note),
      createdAt: timestamp,
      syncStatus: "queued",
    };
    return {
      state: { ...state, payments: [payment, ...state.payments] },
      result: { paymentId: payment.id },
    };
  }

  updatePayment(state, payload) {
    requireAccount(state);
    const payment = paymentFor(state, payload.paymentId);
    if (payload.projectId !== undefined) projectFor(state, payload.projectId);
    const paymentNext = {
      ...payment,
      ...(payload.projectId !== undefined
        ? { projectId: payload.projectId }
        : {}),
      ...(payload.money !== undefined ? { money: payload.money } : {}),
      ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
      ...(payload.receivedAt !== undefined
        ? { receivedAt: payload.receivedAt }
        : {}),
      ...(payload.note !== undefined
        ? { note: optionalText(payload.note) }
        : {}),
      syncStatus: "queued",
    };
    return {
      state: {
        ...state,
        payments: state.payments.map((item) =>
          item.id === payment.id ? paymentNext : item,
        ),
      },
      result: { paymentId: payment.id },
    };
  }

  deletePayment(state, payload) {
    requireAccount(state);
    const payment = paymentFor(state, payload.paymentId);
    return {
      state: {
        ...state,
        payments: state.payments.filter((item) => item.id !== payment.id),
      },
      result: { paymentId: payment.id, deleted: true },
    };
  }

  createGoal(state, payload) {
    requireAccount(state);
    requireValidGoalTarget(payload.kind, payload.target);
    const goal = {
      id: this.newId(),
      kind: payload.kind,
      target: payload.target,
      createdAt: this.now(),
      syncStatus: "queued",
    };
    return {
      state: { ...state, goals: [...state.goals, goal] },
      result: { goalId: goal.id },
    };
  }

  updateGoal(state, payload) {
    requireAccount(state);
    const goal = goalFor(state, payload.goalId);
    const goalNext = {
      ...goal,
      ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
      ...(payload.target !== undefined ? { target: payload.target } : {}),
      syncStatus: "queued",
    };
    requireValidGoalTarget(goalNext.kind, goalNext.target);
    return {
      state: {
        ...state,
        goals: state.goals.map((item) =>
          item.id === goal.id ? goalNext : item,
        ),
      },
      result: { goalId: goal.id },
    };
  }

  deleteGoal(state, payload) {
    requireAccount(state);
    const goal = goalFor(state, payload.goalId);
    return {
      state: {
        ...state,
        goals: state.goals.filter((item) => item.id !== goal.id),
      },
      result: { goalId: goal.id, deleted: true },
    };
  }

  updatePreferences(state, payload) {
    requireAccount(state);
    return {
      state: { ...state, preferences: { ...state.preferences, ...payload } },
      result: { updated: Object.keys(payload) },
    };
  }
}

function createCommandService(options) {
  return new CommandService(options);
}

module.exports = {
  captureTimerIntentTimestamp,
  CommandError,
  CommandService,
  CommandValidationError,
  createLocalMutationExecutor,
  createCommandService,
  parseCommand,
};
