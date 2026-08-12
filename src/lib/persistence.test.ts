import { describe, expect, it } from "vitest";
import { createEmptyState, type GoalKind } from "../domain/types";
import {
  loadPersistedState,
  normalizePersistedState,
  parsePersistedState,
} from "./persistence";

function stateWithGoal(kind: GoalKind, target: number) {
  return {
    ...createEmptyState(),
    goals: [
      {
        id: "goal-1",
        kind,
        target,
        createdAt: "2026-08-01T00:00:00.000Z",
        syncStatus: "queued" as const,
      },
    ],
  };
}

describe("normalizePersistedState", () => {
  it("migrates an older renderer snapshot with missing dashboard preferences without losing facts", () => {
    const state = normalizePersistedState({
      version: 1,
      account: {
        id: "account-1",
        displayName: "Minh",
        country: "VN",
        language: "vi",
        currency: "VND",
        timezone: "Asia/Ho_Chi_Minh",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      projects: [
        {
          id: "project-1",
          name: "Website",
          paymentModel: "per_session",
          color: "#2563eb",
          icon: "W",
          status: "active",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          syncStatus: "local",
        },
      ],
      sessions: [
        {
          id: "session-1",
          projectId: "project-1",
          startedAt: "2026-08-01T00:00:00.000Z",
          timezone: "Asia/Ho_Chi_Minh",
          pauses: [],
          status: "running",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          syncStatus: "local",
        },
      ],
      payments: [],
      goals: [],
      preferences: {
        theme: "dark",
        miniTimerMode: "hidden",
        dashboardHiddenWidgets: ["timer"],
      },
    });

    expect(state.projects[0].id).toBe("project-1");
    expect(state.sessions[0].id).toBe("session-1");
    expect(state.preferences).toMatchObject({
      theme: "dark",
      miniTimerMode: "hidden",
      dashboardHiddenWidgets: ["timer"],
      dashboardWidgetOrder: [],
      dashboardWidgetSizes: {},
    });
  });

  it("falls back to a safe empty state for invalid stored data", () => {
    expect(normalizePersistedState({ version: 2 })).toMatchObject({
      version: 1,
      account: null,
      projects: [],
      preferences: { dashboardWidgetOrder: [] },
    });
  });

  it("rejects a malformed desktop state instead of coercing it into the UI", () => {
    expect(() =>
      parsePersistedState({
        version: 1,
        account: null,
        projects: [{ id: "incomplete-project" }],
        sessions: [],
        payments: [],
        goals: [],
        preferences: {
          theme: "system",
          miniTimerMode: "hidden",
          dashboardHiddenWidgets: [],
        },
      }),
    ).toThrow(/invalid state data/i);
  });

  it("uses Unicode code-point text bounds that match the main process and cloud", () => {
    const state = createEmptyState();
    state.account = {
      id: "account-1",
      displayName: "😀".repeat(100),
      country: "VN",
      language: "vi",
      currency: "VND",
      timezone: "Asia/Saigon",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    state.projects = [
      {
        id: "project-1",
        name: "😀".repeat(160),
        paymentModel: "per_session",
        color: "😀".repeat(64),
        icon: "😀".repeat(32),
        status: "active",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        syncStatus: "local",
      },
    ];
    expect(parsePersistedState(state).account?.displayName).toBe(
      state.account.displayName,
    );

    for (const mutate of [
      (candidate: typeof state) =>
        (candidate.account!.displayName = "😀".repeat(101)),
      (candidate: typeof state) => (candidate.account!.displayName = "\u00a0"),
      (candidate: typeof state) =>
        (candidate.projects[0].name = "😀".repeat(161)),
      (candidate: typeof state) => (candidate.projects[0].color = "\u00a0"),
      (candidate: typeof state) =>
        (candidate.projects[0].icon = "😀".repeat(33)),
    ]) {
      const invalid = structuredClone(state);
      mutate(invalid);
      expect(() => parsePersistedState(invalid)).toThrow(/invalid state data/i);
    }
  });

  it("does not fabricate an empty desktop state when the durable read fails", async () => {
    const target = globalThis as typeof globalThis & { window?: unknown };
    const original = target.window;
    target.window = {
      worklyDesktop: {
        loadState: async () => {
          throw new Error("SQLite unavailable");
        },
      },
    } as unknown as typeof window;
    await expect(loadPersistedState()).rejects.toThrow("SQLite unavailable");
    target.window = original;
  });

  it.each([
    ["hours_daily", 0.25],
    ["hours_weekly", Number.MAX_SAFE_INTEGER],
    ["earnings_daily", 1],
    ["earnings_weekly", Number.MAX_SAFE_INTEGER],
    ["earnings_monthly", 25_000],
    ["projects_completed", 1],
  ] satisfies [GoalKind, number][])(
    "accepts a valid persisted %s target",
    (kind, target) => {
      expect(
        parsePersistedState(stateWithGoal(kind, target)).goals[0],
      ).toMatchObject({ kind, target });
    },
  );

  it.each([
    ["hours_daily", 0],
    ["hours_weekly", -1],
    ["hours_daily", Number.MAX_SAFE_INTEGER + 1],
    ["earnings_daily", 1.5],
    ["earnings_weekly", 1.5],
    ["earnings_monthly", 1.5],
    ["projects_completed", 1.5],
    ["projects_completed", Number.MAX_SAFE_INTEGER + 1],
  ] satisfies [GoalKind, number][])(
    "rejects an invalid persisted %s target of %s",
    (kind, target) => {
      expect(() => parsePersistedState(stateWithGoal(kind, target))).toThrow(
        /invalid state data/i,
      );
    },
  );
});
