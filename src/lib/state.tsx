import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { goalTargetIssue } from "../domain/goals";
import { activeDurationMs } from "../domain/time";
import { moneyFromInput } from "../domain/money";
import {
  createEmptyState,
  type Account,
  type AppLanguage,
  type AppState,
  type CurrencyCode,
  type Goal,
  type GoalKind,
  type PaymentModel,
  type Preferences,
  type ProjectStatus,
  type ThemePreference,
  type WorkSession,
} from "../domain/types";
import {
  loadPersistedState,
  parsePersistedState,
  persistState,
} from "./persistence";

export interface NewProjectInput {
  name: string;
  paymentModel: PaymentModel;
  expectedAmount?: string;
  expectedCurrency: CurrencyCode;
  note?: string;
  color: string;
  icon: string;
}

export interface CompletedSessionInput {
  amount: string;
  currency: CurrencyCode;
  note?: string;
}

export interface NewPaymentInput {
  projectId: string;
  amount: string;
  currency: CurrencyCode;
  kind: "completion" | "progressive";
  note?: string;
  receivedAt?: string;
}

export type ActionResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

export interface AppStoreState {
  state: AppState | null;
  isLoading: boolean;
  loadError: string | null;
}

export interface AppStoreActions {
  reload: () => Promise<AppState | null>;
  initializeAccount: (
    input: Pick<
      Account,
      "displayName" | "country" | "language" | "currency"
    > & { authUserId?: string },
  ) => Promise<ActionResult<{ accountId: string }>>;
  claimLocalAccount: (
    authUserId?: string,
  ) => Promise<ActionResult<{ accountId: string }>>;
  startSession: (
    projectId?: string,
  ) => Promise<ActionResult<{ sessionId: string }>>;
  pauseSession: () => Promise<ActionResult<{ sessionId: string }>>;
  resumeSession: () => Promise<ActionResult<{ sessionId: string }>>;
  completeSession: (
    sessionId: string,
    input: CompletedSessionInput,
    endedAt?: string,
  ) => Promise<ActionResult<{ sessionId: string; activeDurationMs: number }>>;
  discardSession: (
    sessionId: string,
  ) => Promise<ActionResult<{ sessionId: string }>>;
  editLatestSession: (
    sessionId: string,
    input: CompletedSessionInput,
  ) => Promise<ActionResult<{ sessionId: string }>>;
  createProject: (
    input: NewProjectInput,
  ) => Promise<ActionResult<{ projectId: string }>>;
  createProjectAndStartSession: (
    input: NewProjectInput,
  ) => Promise<ActionResult<{ projectId: string; sessionId: string }>>;
  updateProject: (
    projectId: string,
    input: NewProjectInput,
  ) => Promise<ActionResult<{ projectId: string }>>;
  setProjectStatus: (
    projectId: string,
    status: ProjectStatus,
  ) => Promise<ActionResult<{ projectId: string; status: ProjectStatus }>>;
  recordPayment: (
    input: NewPaymentInput,
  ) => Promise<ActionResult<{ paymentId: string }>>;
  updatePayment: (
    paymentId: string,
    input: NewPaymentInput,
  ) => Promise<ActionResult<{ paymentId: string }>>;
  deletePayment: (
    paymentId: string,
  ) => Promise<ActionResult<{ paymentId: string }>>;
  createGoal: (
    kind: GoalKind,
    target: number,
  ) => Promise<ActionResult<{ goalId: string }>>;
  updateGoal: (
    goalId: string,
    kind: GoalKind,
    target: number,
  ) => Promise<ActionResult<{ goalId: string }>>;
  deleteGoal: (goalId: string) => Promise<ActionResult<{ goalId: string }>>;
  updatePreferences: (partial: Partial<Preferences>) => Promise<ActionResult>;
  updateLanguage: (
    language: AppLanguage,
  ) => Promise<ActionResult<{ accountId: string }>>;
  resetLocalData: () => Promise<ActionResult>;
  rebuildLocalCache: () => Promise<ActionResult>;
}

export type AppStore = AppStoreState & AppStoreActions;

interface DesktopCommandResponse {
  command: string;
  state: unknown;
  result: unknown;
}

const StoreStateContext = createContext<AppStoreState | null>(null);
const StoreActionsContext = createContext<AppStoreActions | null>(null);

function id(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function activeSession(sessions: WorkSession[]): WorkSession | undefined {
  return sessions.find(
    (session) => session.status === "running" || session.status === "paused",
  );
}

function failure<T extends object = object>(error: unknown): ActionResult<T> {
  return {
    ok: false,
    message:
      error instanceof Error
        ? error.message
        : "The requested change could not be saved.",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalDesktopResponse(value: unknown): DesktopCommandResponse {
  if (
    !isRecord(value) ||
    typeof value.command !== "string" ||
    !Object.hasOwn(value, "state")
  ) {
    throw new Error(
      "The desktop process returned an invalid command response.",
    );
  }
  return value as unknown as DesktopCommandResponse;
}

function resultField<T>(result: unknown, key: string): T | undefined {
  return isRecord(result) ? (result[key] as T | undefined) : undefined;
}

function invalidGoalTarget(
  kind: GoalKind,
  target: number,
): { ok: false; message: string } | null {
  const issue = goalTargetIssue(kind, target);
  if (!issue) return null;
  if (issue === "not_positive")
    return { ok: false, message: "Goal target must be greater than zero." };
  if (issue === "project_count_not_integer")
    return {
      ok: false,
      message: "Completed-project goal target must be a whole number.",
    };
  if (kind.startsWith("earnings"))
    return {
      ok: false,
      message:
        "Earnings goal target must be a whole minor-unit amount within the safe numeric range.",
    };
  return {
    ok: false,
    message: "Goal target exceeds the safe numeric range.",
  };
}

function useStableAppStoreActions(latest: AppStoreActions): AppStoreActions {
  const latestRef = useRef(latest);

  // The public action facade stays referentially stable while every call is
  // routed to the implementation from the latest committed store render.
  useLayoutEffect(() => {
    latestRef.current = latest;
  }, [latest]);

  return useMemo<AppStoreActions>(
    () => ({
      reload: () => latestRef.current.reload(),
      initializeAccount: (input) => latestRef.current.initializeAccount(input),
      claimLocalAccount: (authUserId) =>
        latestRef.current.claimLocalAccount(authUserId),
      startSession: (projectId) => latestRef.current.startSession(projectId),
      pauseSession: () => latestRef.current.pauseSession(),
      resumeSession: () => latestRef.current.resumeSession(),
      completeSession: (sessionId, input, endedAt) =>
        latestRef.current.completeSession(sessionId, input, endedAt),
      discardSession: (sessionId) =>
        latestRef.current.discardSession(sessionId),
      editLatestSession: (sessionId, input) =>
        latestRef.current.editLatestSession(sessionId, input),
      createProject: (input) => latestRef.current.createProject(input),
      createProjectAndStartSession: (input) =>
        latestRef.current.createProjectAndStartSession(input),
      updateProject: (projectId, input) =>
        latestRef.current.updateProject(projectId, input),
      setProjectStatus: (projectId, status) =>
        latestRef.current.setProjectStatus(projectId, status),
      recordPayment: (input) => latestRef.current.recordPayment(input),
      updatePayment: (paymentId, input) =>
        latestRef.current.updatePayment(paymentId, input),
      deletePayment: (paymentId) => latestRef.current.deletePayment(paymentId),
      createGoal: (kind, target) => latestRef.current.createGoal(kind, target),
      updateGoal: (goalId, kind, target) =>
        latestRef.current.updateGoal(goalId, kind, target),
      deleteGoal: (goalId) => latestRef.current.deleteGoal(goalId),
      updatePreferences: (partial) =>
        latestRef.current.updatePreferences(partial),
      updateLanguage: (language) => latestRef.current.updateLanguage(language),
      resetLocalData: () => latestRef.current.resetLocalData(),
      rebuildLocalCache: () => latestRef.current.rebuildLocalCache(),
    }),
    [],
  );
}

export function AppStoreProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<AppState | null> => {
    try {
      const saved = await loadPersistedState();
      setState(saved);
      setLoadError(null);
      return saved;
    } catch (error) {
      // Do not turn a failed desktop read into an empty writable state. The
      // user can retry after resolving a transient IPC/database problem.
      setState(null);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Unable to read local TimeFarm data.",
      );
      return null;
    }
  }, []);

  useEffect(() => {
    const bootstrap = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(bootstrap);
  }, [reload]);

  useEffect(() => {
    const desktop = window.worklyDesktop;
    if (!desktop?.onStateChanged) return undefined;
    return desktop.onStateChanged(() => {
      void reload();
    });
  }, [reload]);

  useEffect(() => {
    // SQLite persistence belongs exclusively to the Electron main process.
    // The preview remains useful by persisting only to browser localStorage.
    if (state && !window.worklyDesktop) void persistState(state);
  }, [state]);

  const update = useCallback((transform: (current: AppState) => AppState) => {
    setState((current) => (current ? transform(current) : current));
  }, []);

  const executeDesktop = useCallback(
    async <T extends object = Record<string, never>>(
      type: string,
      payload: Record<string, unknown>,
    ): Promise<ActionResult<T> | null> => {
      const desktop = window.worklyDesktop;
      if (!desktop?.executeCommand) return null;
      try {
        const response = canonicalDesktopResponse(
          await desktop.executeCommand({ type, payload }),
        );
        if (!isRecord(response.state) || response.state.version !== 1) {
          throw new Error("The desktop process returned an unsupported state.");
        }
        const saved = parsePersistedState(response.state);
        setState(saved);
        setLoadError(null);
        return {
          ok: true,
          ...((isRecord(response.result) ? response.result : {}) as T),
        };
      } catch (error) {
        return failure(error) as ActionResult<T>;
      }
    },
    [],
  );

  const initializeAccount = useCallback(
    async (
      input: Pick<
        Account,
        "displayName" | "country" | "language" | "currency"
      > & { authUserId?: string },
    ): Promise<ActionResult<{ accountId: string }>> => {
      const desktop = await executeDesktop<{ accountId: string }>(
        "account.initialize",
        {
          displayName: input.displayName.trim() || "Bạn",
          country: input.country,
          language: input.language,
          currency: input.currency,
          timezone: defaultTimezone(),
        },
      );
      if (desktop) return desktop;
      if (state?.account)
        return {
          ok: false,
          message: "Account setup has already been completed.",
        };
      const timestamp = nowIso();
      const accountId = id();
      update((current) => ({
        ...current,
        account: {
          id: accountId,
          authUserId: input.authUserId,
          displayName: input.displayName.trim() || "Bạn",
          country: input.country,
          language: input.language,
          currency: input.currency,
          timezone: defaultTimezone(),
          createdAt: timestamp,
        },
      }));
      return { ok: true, accountId };
    },
    [executeDesktop, state, update],
  );

  const claimLocalAccount = useCallback(
    async (
      authUserId?: string,
    ): Promise<ActionResult<{ accountId: string }>> => {
      const desktop = window.worklyDesktop;
      if (desktop?.claimAuthenticatedAccount) {
        try {
          const response = canonicalDesktopResponse(
            await desktop.claimAuthenticatedAccount(),
          );
          const saved = parsePersistedState(response.state);
          setState(saved);
          return {
            ok: true,
            accountId:
              resultField<string>(response.result, "accountId") ??
              saved.account?.id ??
              "",
          };
        } catch (error) {
          return failure(error);
        }
      }
      if (!state?.account || !authUserId)
        return { ok: false, message: "An authenticated account is required." };
      if (state.account.authUserId && state.account.authUserId !== authUserId)
        return {
          ok: false,
          message: "This local data belongs to another account.",
        };
      update((current) =>
        current.account
          ? { ...current, account: { ...current.account, authUserId } }
          : current,
      );
      return { ok: true, accountId: state.account.id };
    },
    [state, update],
  );

  const startSession = useCallback(
    async (
      projectId?: string,
    ): Promise<ActionResult<{ sessionId: string }>> => {
      const desktop = await executeDesktop<{ sessionId: string }>(
        "session.start",
        projectId ? { projectId } : {},
      );
      if (desktop) return desktop;
      if (!state?.account)
        return {
          ok: false,
          message: "Complete account setup before starting a session.",
        };
      if (activeSession(state.sessions))
        return {
          ok: false,
          message: "Only one work session can be active at a time.",
        };
      const project = projectId
        ? state.projects.find((item) => item.id === projectId)
        : undefined;
      if (projectId && !project)
        return { ok: false, message: "Selected project no longer exists." };
      if (project?.status === "completed")
        return {
          ok: false,
          message: "Reopen the project before starting a new session.",
        };
      const timestamp = nowIso();
      const sessionId = id();
      update((current) => ({
        ...current,
        sessions: [
          {
            id: sessionId,
            projectId,
            startedAt: timestamp,
            timezone: current.account?.timezone ?? defaultTimezone(),
            pauses: [],
            status: "running",
            createdAt: timestamp,
            updatedAt: timestamp,
            syncStatus: "local",
          },
          ...current.sessions,
        ],
      }));
      return { ok: true, sessionId };
    },
    [executeDesktop, state, update],
  );

  const pauseSession = useCallback(async (): Promise<
    ActionResult<{ sessionId: string }>
  > => {
    const desktop = await executeDesktop<{ sessionId: string }>(
      "session.pause",
      {},
    );
    if (desktop) return desktop;
    const session = state ? activeSession(state.sessions) : undefined;
    if (!session || session.status !== "running")
      return { ok: false, message: "There is no running session to pause." };
    const timestamp = nowIso();
    update((current) => ({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === session.id
          ? {
              ...item,
              status: "paused",
              pauses: [...item.pauses, { startedAt: timestamp }],
              updatedAt: timestamp,
              syncStatus: "local",
            }
          : item,
      ),
    }));
    return { ok: true, sessionId: session.id };
  }, [executeDesktop, state, update]);

  const resumeSession = useCallback(async (): Promise<
    ActionResult<{ sessionId: string }>
  > => {
    const desktop = await executeDesktop<{ sessionId: string }>(
      "session.resume",
      {},
    );
    if (desktop) return desktop;
    const session = state ? activeSession(state.sessions) : undefined;
    if (!session || session.status !== "paused")
      return { ok: false, message: "There is no paused session to resume." };
    const timestamp = nowIso();
    update((current) => ({
      ...current,
      sessions: current.sessions.map((item) => {
        if (item.id !== session.id) return item;
        const pauses = [...item.pauses];
        const last = pauses.at(-1);
        if (last && !last.endedAt)
          pauses[pauses.length - 1] = { ...last, endedAt: timestamp };
        return {
          ...item,
          status: "running",
          pauses,
          updatedAt: timestamp,
          syncStatus: "local",
        };
      }),
    }));
    return { ok: true, sessionId: session.id };
  }, [executeDesktop, state, update]);

  const completeSession = useCallback(
    async (
      sessionId: string,
      input: CompletedSessionInput,
      endedAt?: string,
    ): Promise<
      ActionResult<{ sessionId: string; activeDurationMs: number }>
    > => {
      let money;
      try {
        money = moneyFromInput(input.amount, input.currency);
      } catch (error) {
        return failure(error);
      }
      const desktop = await executeDesktop<{
        sessionId: string;
        activeDurationMs: number;
      }>(endedAt ? "session.recover-complete" : "session.complete", {
        sessionId,
        money,
        note: input.note?.trim() || null,
        ...(endedAt ? { endedAt } : {}),
      });
      if (desktop) return desktop;
      const session = state?.sessions.find((item) => item.id === sessionId);
      if (
        !session ||
        (session.status !== "running" && session.status !== "paused")
      )
        return {
          ok: false,
          message: "Only an active session can be completed.",
        };
      const timestamp =
        endedAt && Number.isFinite(Date.parse(endedAt))
          ? new Date(endedAt).toISOString()
          : nowIso();
      if (Date.parse(timestamp) < Date.parse(session.startedAt))
        return { ok: false, message: "A session cannot end before it starts." };
      const duration = activeDurationMs(session, new Date(timestamp).getTime());
      update((current) => ({
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                status: "completed",
                endedAt: timestamp,
                activeDurationMs: duration,
                earnings: money,
                note: input.note?.trim() || undefined,
                updatedAt: timestamp,
                syncStatus: "queued",
              }
            : item,
        ),
      }));
      return { ok: true, sessionId, activeDurationMs: duration };
    },
    [executeDesktop, state, update],
  );

  const discardSession = useCallback(
    async (sessionId: string): Promise<ActionResult<{ sessionId: string }>> => {
      const desktop = await executeDesktop<{ sessionId: string }>(
        "session.discard",
        { sessionId },
      );
      if (desktop) return desktop;
      const session = state?.sessions.find((item) => item.id === sessionId);
      if (
        !session ||
        (session.status !== "running" && session.status !== "paused")
      )
        return {
          ok: false,
          message: "Only an active session can be discarded.",
        };
      update((current) => ({
        ...current,
        sessions: current.sessions.filter((item) => item.id !== sessionId),
      }));
      return { ok: true, sessionId };
    },
    [executeDesktop, state, update],
  );

  const editLatestSession = useCallback(
    async (
      sessionId: string,
      input: CompletedSessionInput,
    ): Promise<ActionResult<{ sessionId: string }>> => {
      let money;
      try {
        money = moneyFromInput(input.amount, input.currency);
      } catch (error) {
        return failure(error);
      }
      const desktop = await executeDesktop<{ sessionId: string }>(
        "session.edit-latest",
        { sessionId, money, note: input.note?.trim() || null },
      );
      if (desktop) return desktop;
      if (!state) return { ok: false, message: "Data is not ready." };
      const latest = [...state.sessions]
        .filter((session) => session.status === "completed")
        .sort(
          (left, right) =>
            new Date(right.endedAt ?? right.startedAt).getTime() -
            new Date(left.endedAt ?? left.startedAt).getTime(),
        )[0];
      if (latest?.id !== sessionId)
        return {
          ok: false,
          message: "Only the latest completed session can be edited.",
        };
      const timestamp = nowIso();
      update((current) => ({
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                earnings: money,
                note: input.note?.trim() || undefined,
                updatedAt: timestamp,
                syncStatus: "queued",
              }
            : item,
        ),
      }));
      return { ok: true, sessionId };
    },
    [executeDesktop, state, update],
  );

  const projectPayload = useCallback(
    (input: NewProjectInput) => ({
      name: input.name.trim(),
      paymentModel: input.paymentModel,
      expectedMoney: input.expectedAmount
        ? moneyFromInput(input.expectedAmount, input.expectedCurrency)
        : null,
      note: input.note?.trim() || null,
      color: input.color,
      icon: input.icon,
    }),
    [],
  );

  const createProject = useCallback(
    async (
      input: NewProjectInput,
    ): Promise<ActionResult<{ projectId: string }>> => {
      if (!input.name.trim())
        return { ok: false, message: "Project name is required." };
      let payload;
      try {
        payload = projectPayload(input);
      } catch (error) {
        return failure(error);
      }
      const desktop = await executeDesktop<{ projectId: string }>(
        "project.create",
        {
          ...payload,
          ...(payload.expectedMoney ? {} : { expectedMoney: undefined }),
        },
      );
      if (desktop) return desktop;
      const timestamp = nowIso();
      const projectId = id();
      update((current) => ({
        ...current,
        projects: [
          {
            id: projectId,
            ...payload,
            expectedMoney: payload.expectedMoney ?? undefined,
            note: payload.note ?? undefined,
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
            syncStatus: "local",
          },
          ...current.projects,
        ],
      }));
      return { ok: true, projectId };
    },
    [executeDesktop, projectPayload, update],
  );

  const createProjectAndStartSession = useCallback(
    async (
      input: NewProjectInput,
    ): Promise<ActionResult<{ projectId: string; sessionId: string }>> => {
      if (!input.name.trim())
        return { ok: false, message: "Project name is required." };
      let payload;
      try {
        payload = projectPayload(input);
      } catch (error) {
        return failure(error);
      }
      const commandPayload = {
        ...payload,
        ...(payload.expectedMoney ? {} : { expectedMoney: undefined }),
      };
      const desktop = await executeDesktop<{
        projectId: string;
        sessionId: string;
      }>("project.create-and-start-session", commandPayload);
      if (desktop) return desktop;
      if (!state?.account)
        return {
          ok: false,
          message: "Complete account setup before starting a session.",
        };
      if (activeSession(state.sessions))
        return {
          ok: false,
          message: "Only one work session can be active at a time.",
        };
      const timestamp = nowIso();
      const projectId = id();
      const sessionId = id();
      update((current) => ({
        ...current,
        projects: [
          {
            id: projectId,
            ...payload,
            expectedMoney: payload.expectedMoney ?? undefined,
            note: payload.note ?? undefined,
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
            syncStatus: "local",
          },
          ...current.projects,
        ],
        sessions: [
          {
            id: sessionId,
            projectId,
            startedAt: timestamp,
            timezone: current.account?.timezone ?? defaultTimezone(),
            pauses: [],
            status: "running",
            createdAt: timestamp,
            updatedAt: timestamp,
            syncStatus: "local",
          },
          ...current.sessions,
        ],
      }));
      return { ok: true, projectId, sessionId };
    },
    [executeDesktop, projectPayload, state, update],
  );

  const updateProject = useCallback(
    async (
      projectId: string,
      input: NewProjectInput,
    ): Promise<ActionResult<{ projectId: string }>> => {
      if (!input.name.trim())
        return { ok: false, message: "Project name is required." };
      let payload;
      try {
        payload = projectPayload(input);
      } catch (error) {
        return failure(error);
      }
      const desktop = await executeDesktop<{ projectId: string }>(
        "project.update",
        { projectId, ...payload },
      );
      if (desktop) return desktop;
      if (!state?.projects.some((project) => project.id === projectId))
        return { ok: false, message: "Project not found." };
      const timestamp = nowIso();
      update((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectId
            ? {
                ...project,
                ...payload,
                expectedMoney: payload.expectedMoney ?? undefined,
                note: payload.note ?? undefined,
                updatedAt: timestamp,
                syncStatus: "queued",
              }
            : project,
        ),
      }));
      return { ok: true, projectId };
    },
    [executeDesktop, projectPayload, state, update],
  );

  const setProjectStatus = useCallback(
    async (
      projectId: string,
      status: ProjectStatus,
    ): Promise<ActionResult<{ projectId: string; status: ProjectStatus }>> => {
      const desktop = await executeDesktop<{
        projectId: string;
        status: ProjectStatus;
      }>("project.set-status", { projectId, status });
      if (desktop) return desktop;
      if (!state?.projects.some((project) => project.id === projectId))
        return { ok: false, message: "Project not found." };
      if (
        status === "completed" &&
        state.sessions.some(
          (session) =>
            session.projectId === projectId &&
            (session.status === "running" || session.status === "paused"),
        )
      ) {
        return {
          ok: false,
          message:
            "End or discard the active session before completing this project.",
        };
      }
      const timestamp = nowIso();
      update((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectId
            ? {
                ...project,
                status,
                completedAt: status === "completed" ? timestamp : undefined,
                updatedAt: timestamp,
                syncStatus: "queued",
              }
            : project,
        ),
      }));
      return { ok: true, projectId, status };
    },
    [executeDesktop, state, update],
  );

  const recordPayment = useCallback(
    async (
      input: NewPaymentInput,
    ): Promise<ActionResult<{ paymentId: string }>> => {
      let money;
      try {
        money = moneyFromInput(input.amount, input.currency);
      } catch (error) {
        return failure(error);
      }
      const desktop = await executeDesktop<{ paymentId: string }>(
        "payment.create",
        {
          projectId: input.projectId,
          money,
          kind: input.kind,
          note: input.note?.trim() || null,
          ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}),
        },
      );
      if (desktop) return desktop;
      if (
        !state?.account ||
        !state.projects.some((project) => project.id === input.projectId)
      )
        return { ok: false, message: "Project not found." };
      const timestamp = nowIso();
      const paymentId = id();
      update((current) => ({
        ...current,
        payments: [
          {
            id: paymentId,
            projectId: input.projectId,
            money,
            kind: input.kind,
            receivedAt: input.receivedAt ?? timestamp,
            note: input.note?.trim() || undefined,
            createdAt: timestamp,
            syncStatus: "queued",
          },
          ...current.payments,
        ],
      }));
      return { ok: true, paymentId };
    },
    [executeDesktop, state, update],
  );

  const updatePayment = useCallback(
    async (
      paymentId: string,
      input: NewPaymentInput,
    ): Promise<ActionResult<{ paymentId: string }>> => {
      let money;
      try {
        money = moneyFromInput(input.amount, input.currency);
      } catch (error) {
        return failure(error);
      }
      if (input.receivedAt && !Number.isFinite(Date.parse(input.receivedAt)))
        return { ok: false, message: "Payment date is invalid." };
      const receivedAt = input.receivedAt
        ? new Date(input.receivedAt).toISOString()
        : undefined;
      const desktop = await executeDesktop<{ paymentId: string }>(
        "payment.update",
        {
          paymentId,
          projectId: input.projectId,
          money,
          kind: input.kind,
          note: input.note?.trim() || null,
          ...(receivedAt ? { receivedAt } : {}),
        },
      );
      if (desktop) return desktop;
      const payment = state?.payments.find((item) => item.id === paymentId);
      if (!payment) return { ok: false, message: "Payment not found." };
      if (
        !state ||
        !state.projects.some((project) => project.id === input.projectId)
      )
        return { ok: false, message: "Project not found." };
      update((current) => ({
        ...current,
        payments: current.payments.map((item) =>
          item.id === paymentId
            ? {
                ...item,
                projectId: input.projectId,
                money,
                kind: input.kind,
                note: input.note?.trim() || undefined,
                ...(receivedAt ? { receivedAt } : {}),
                syncStatus: "queued",
              }
            : item,
        ),
      }));
      return { ok: true, paymentId };
    },
    [executeDesktop, state, update],
  );

  const deletePayment = useCallback(
    async (paymentId: string): Promise<ActionResult<{ paymentId: string }>> => {
      const desktop = await executeDesktop<{ paymentId: string }>(
        "payment.delete",
        { paymentId },
      );
      if (desktop) return desktop;
      if (!state?.payments.some((payment) => payment.id === paymentId))
        return { ok: false, message: "Payment not found." };
      update((current) => ({
        ...current,
        payments: current.payments.filter(
          (payment) => payment.id !== paymentId,
        ),
      }));
      return { ok: true, paymentId };
    },
    [executeDesktop, state, update],
  );

  const createGoal = useCallback(
    async (
      kind: GoalKind,
      target: number,
    ): Promise<ActionResult<{ goalId: string }>> => {
      const invalidTarget = invalidGoalTarget(kind, target);
      if (invalidTarget) return invalidTarget;
      const desktop = await executeDesktop<{ goalId: string }>("goal.create", {
        kind,
        target,
      });
      if (desktop) return desktop;
      const goalId = id();
      const goal: Goal = {
        id: goalId,
        kind,
        target,
        createdAt: nowIso(),
        syncStatus: "queued",
      };
      update((current) => ({ ...current, goals: [...current.goals, goal] }));
      return { ok: true, goalId };
    },
    [executeDesktop, update],
  );

  const updateGoal = useCallback(
    async (
      goalId: string,
      kind: GoalKind,
      target: number,
    ): Promise<ActionResult<{ goalId: string }>> => {
      const invalidTarget = invalidGoalTarget(kind, target);
      if (invalidTarget) return invalidTarget;
      const desktop = await executeDesktop<{ goalId: string }>("goal.update", {
        goalId,
        kind,
        target,
      });
      if (desktop) return desktop;
      if (!state?.goals.some((goal) => goal.id === goalId))
        return { ok: false, message: "Goal not found." };
      update((current) => ({
        ...current,
        goals: current.goals.map((goal) =>
          goal.id === goalId
            ? { ...goal, kind, target, syncStatus: "queued" }
            : goal,
        ),
      }));
      return { ok: true, goalId };
    },
    [executeDesktop, state, update],
  );

  const deleteGoal = useCallback(
    async (goalId: string): Promise<ActionResult<{ goalId: string }>> => {
      const desktop = await executeDesktop<{ goalId: string }>("goal.delete", {
        goalId,
      });
      if (desktop) return desktop;
      if (!state?.goals.some((goal) => goal.id === goalId))
        return { ok: false, message: "Goal not found." };
      update((current) => ({
        ...current,
        goals: current.goals.filter((goal) => goal.id !== goalId),
      }));
      return { ok: true, goalId };
    },
    [executeDesktop, state, update],
  );

  const updatePreferences = useCallback(
    async (partial: Partial<Preferences>): Promise<ActionResult> => {
      const desktop = await executeDesktop(
        "preferences.update",
        partial as Record<string, unknown>,
      );
      if (desktop) return desktop;
      update((current) => ({
        ...current,
        preferences: { ...current.preferences, ...partial },
      }));
      return { ok: true };
    },
    [executeDesktop, update],
  );

  const updateLanguage = useCallback(
    async (
      language: AppLanguage,
    ): Promise<ActionResult<{ accountId: string }>> => {
      const desktop = await executeDesktop<{ accountId: string }>(
        "account.update-profile",
        { language },
      );
      if (desktop) return desktop;
      if (!state?.account)
        return { ok: false, message: "Account data is not ready." };
      update((current) =>
        current.account
          ? { ...current, account: { ...current.account, language } }
          : current,
      );
      return { ok: true, accountId: state.account.id };
    },
    [executeDesktop, state, update],
  );

  const resetLocalData = useCallback(async (): Promise<ActionResult> => {
    const desktop = window.worklyDesktop;
    if (desktop?.resetLocalData) {
      try {
        const response = await desktop.resetLocalData();
        if (isRecord(response) && response.cancelled === true)
          return { ok: false, message: "Local data deletion was cancelled." };
        const rawState =
          isRecord(response) && Object.hasOwn(response, "state")
            ? response.state
            : response;
        const saved = parsePersistedState(rawState);
        setState(saved);
        return isRecord(response) && typeof response.cleanupWarning === "string"
          ? { ok: false, message: response.cleanupWarning }
          : { ok: true };
      } catch (error) {
        return failure(error);
      }
    }
    setState(createEmptyState());
    return { ok: true };
  }, []);

  const rebuildLocalCache = useCallback(async (): Promise<ActionResult> => {
    const desktop = window.worklyDesktop;
    if (!desktop?.rebuildLocalCache)
      return {
        ok: false,
        message: "Cloud cache rebuild is available only in the desktop app.",
      };
    try {
      const response = await desktop.rebuildLocalCache();
      if (isRecord(response) && response.cancelled === true)
        return { ok: false, message: "Local cache rebuild was cancelled." };
      const rawState =
        isRecord(response) && Object.hasOwn(response, "state")
          ? response.state
          : response;
      setState(parsePersistedState(rawState));
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }, []);

  const latestActions = useMemo<AppStoreActions>(
    () => ({
      reload,
      initializeAccount,
      claimLocalAccount,
      startSession,
      pauseSession,
      resumeSession,
      completeSession,
      discardSession,
      editLatestSession,
      createProject,
      updateProject,
      createProjectAndStartSession,
      setProjectStatus,
      recordPayment,
      updatePayment,
      deletePayment,
      createGoal,
      updateGoal,
      deleteGoal,
      updatePreferences,
      updateLanguage,
      rebuildLocalCache,
      resetLocalData,
    }),
    [
      reload,
      initializeAccount,
      claimLocalAccount,
      startSession,
      pauseSession,
      resumeSession,
      completeSession,
      discardSession,
      editLatestSession,
      createProject,
      updateProject,
      createProjectAndStartSession,
      setProjectStatus,
      recordPayment,
      updatePayment,
      deletePayment,
      createGoal,
      updateGoal,
      deleteGoal,
      updatePreferences,
      updateLanguage,
      rebuildLocalCache,
      resetLocalData,
    ],
  );

  const actions = useStableAppStoreActions(latestActions);
  const storeState = useMemo<AppStoreState>(
    () => ({
      state,
      isLoading: state === null && loadError === null,
      loadError,
    }),
    [state, loadError],
  );

  return (
    <StoreActionsContext.Provider value={actions}>
      <StoreStateContext.Provider value={storeState}>
        {children}
      </StoreStateContext.Provider>
    </StoreActionsContext.Provider>
  );
}

export function useAppStoreState(): AppStoreState {
  const context = useContext(StoreStateContext);
  if (!context)
    throw new Error("useAppStoreState must be used inside AppStoreProvider");
  return context;
}

export function useAppStoreActions(): AppStoreActions {
  const context = useContext(StoreActionsContext);
  if (!context)
    throw new Error("useAppStoreActions must be used inside AppStoreProvider");
  return context;
}

export function useAppStore(): AppStore {
  const storeState = useAppStoreState();
  const actions = useAppStoreActions();
  return useMemo(() => ({ ...storeState, ...actions }), [storeState, actions]);
}

export function getActiveSession(
  sessions: WorkSession[],
): WorkSession | undefined {
  return activeSession(sessions);
}

export function themeClass(theme: ThemePreference): string {
  if (theme === "system")
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "theme-dark"
      : "theme-light";
  return `theme-${theme}`;
}
