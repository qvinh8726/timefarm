function activeSessionFromState(state) {
  return state.sessions.find(
    (session) => session.status === "running" || session.status === "paused",
  );
}

async function executeCommandBackedOverlayAction({
  action,
  repository,
  commandService,
  acquireTimerLease,
  startLeaseRenewal,
  onOpen,
  onStopRequested,
  onStateChanged,
  syncNow,
  intentTimestamp,
}) {
  const state = repository.loadState();
  const active = activeSessionFromState(state);
  if (action === "open") {
    onOpen();
    return { ok: true };
  }
  if (action === "stop") {
    if (!active)
      return { ok: false, message: "There is no active session to finish." };
    onOpen();
    onStopRequested({ sessionId: active.id, session: active, state });
    return {
      ok: true,
      requiresCompletion: true,
      message: "Finish the session in TimeFarm to record earnings.",
    };
  }

  const commandType =
    action === "start"
      ? "session.start"
      : action === "pause"
        ? "session.pause"
        : action === "resume"
          ? "session.resume"
          : undefined;
  if (!commandType) return { ok: false, message: "Unsupported timer action." };

  const command = { type: commandType, payload: {} };
  // Validate before any asynchronous lease request, then CommandService loads
  // current state again at commit so a stale overlay button cannot overwrite a
  // renderer action that completed while the lease request was pending.
  try {
    commandService.preflight?.(command);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The timer action is no longer valid.",
    };
  }

  let leaseOutcome;
  if (action === "start" || action === "resume") {
    leaseOutcome = await acquireTimerLease();
    if (leaseOutcome?.state === "held_by_other") {
      return {
        ok: false,
        message:
          "Another signed-in device currently holds the active timer lease.",
      };
    }
  }

  try {
    const response = commandService.execute(command, { intentTimestamp });
    if (leaseOutcome?.state === "acquired") startLeaseRenewal();
    onStateChanged(response.state);
    void Promise.resolve(syncNow()).catch(() => {});
    return { ok: true, ...(response.result ?? {}) };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The timer action could not be saved.",
    };
  }
}

function createOverlayTimerActionHandler({
  repository,
  commandService,
  acquireTimerLease = async () => ({ state: "not_configured" }),
  startLeaseRenewal = () => {},
  onOpen = () => {},
  onStopRequested = () => {},
  onStateChanged = () => {},
  syncNow = () => {},
}) {
  if (!commandService || typeof commandService.execute !== "function") {
    throw new TypeError(
      "A command service is required for overlay timer actions.",
    );
  }
  return async (action, options = {}) => {
    return executeCommandBackedOverlayAction({
      action,
      repository,
      commandService,
      acquireTimerLease,
      startLeaseRenewal,
      onOpen,
      onStopRequested,
      onStateChanged,
      syncNow,
      intentTimestamp: options.intentTimestamp,
    });
  };
}

module.exports = {
  activeSessionFromState,
  createOverlayTimerActionHandler,
  executeCommandBackedOverlayAction,
};
