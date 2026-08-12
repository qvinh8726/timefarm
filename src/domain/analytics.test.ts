import { describe, expect, it } from "vitest";
import {
  calculateGoalProgress,
  completedSessionOverlapSummary,
  dailySeries,
  effectiveHourlyMinor,
  goalCurrentValue,
  liveRangeSummary,
  projectBreakdown,
  rangeDailySeries,
  rangeSummary,
  resolveRange,
  sessionContribution,
  totalEarningsMinor,
} from "./analytics";
import type { Goal, Project, WorkSession } from "./types";

const sessions: WorkSession[] = [
  {
    id: "s1",
    projectId: "p1",
    startedAt: "2026-08-09T08:00:00.000Z",
    endedAt: "2026-08-09T10:00:00.000Z",
    timezone: "UTC",
    pauses: [],
    activeDurationMs: 7_200_000,
    status: "completed",
    earnings: { amountMinor: 7_500, currency: "USD" },
    createdAt: "2026-08-09T08:00:00.000Z",
    updatedAt: "2026-08-09T10:00:00.000Z",
    syncStatus: "local",
  },
];

describe("earnings analytics", () => {
  it("uses original matching-currency amounts and derives an hourly rate", () => {
    expect(totalEarningsMinor(sessions, "USD")).toBe(7_500);
    expect(effectiveHourlyMinor(sessions, "USD")).toBe(3_750);
    expect(totalEarningsMinor(sessions, "VND")).toBe(0);
  });

  it("clips a cross-boundary session and allocates original earnings proportionally", () => {
    const session: WorkSession = {
      ...sessions[0],
      id: "cross-boundary",
      startedAt: "2026-08-01T00:00:00.000Z",
      endedAt: "2026-08-01T04:00:00.000Z",
      activeDurationMs: 14_400_000,
      earnings: { amountMinor: 10_000, currency: "USD" },
    };
    const range = {
      startMs: new Date("2026-08-01T02:00:00.000Z").getTime(),
      endMs: new Date("2026-08-01T03:00:00.000Z").getTime(),
      timezone: "UTC",
    };
    expect(sessionContribution(session, range, "USD")).toEqual({
      activeMs: 3_600_000,
      earningActiveMs: 3_600_000,
      earningsMinor: 2_500,
    });
  });

  it("conserves minor units across daily buckets with a deterministic tie-break", () => {
    const oneCentAcrossMidnight: WorkSession = {
      ...sessions[0],
      id: "one-cent-across-midnight",
      startedAt: "2026-08-01T23:00:00.000Z",
      endedAt: "2026-08-02T01:00:00.000Z",
      activeDurationMs: 7_200_000,
      earnings: { amountMinor: 1, currency: "USD" },
    };
    const range = {
      startMs: Date.parse("2026-08-01T00:00:00.000Z"),
      endMs: Date.parse("2026-08-03T00:00:00.000Z"),
      timezone: "UTC",
    };

    const points = rangeDailySeries([oneCentAcrossMidnight], "USD", range);
    expect(points.map((point) => point.earningsMinor)).toEqual([1, 0]);
    expect(
      points.reduce((total, point) => total + point.earningsMinor, 0),
    ).toBe(rangeSummary([oneCentAcrossMidnight], "USD", range).earningsMinor);
  });

  it("preserves the range total for clipped multi-day sessions and every minor amount", () => {
    const range = {
      startMs: Date.parse("2026-08-02T06:00:00.000Z"),
      endMs: Date.parse("2026-08-05T18:00:00.000Z"),
      timezone: "UTC",
    };

    for (let amountMinor = 0; amountMinor <= 101; amountMinor += 1) {
      const session: WorkSession = {
        ...sessions[0],
        id: `conservation-${amountMinor}`,
        startedAt: "2026-08-01T12:00:00.000Z",
        endedAt: "2026-08-06T12:00:00.000Z",
        activeDurationMs: 432_000_000,
        earnings: { amountMinor, currency: "USD" },
      };
      const dailyTotal = rangeDailySeries([session], "USD", range).reduce(
        (total, point) => total + point.earningsMinor,
        0,
      );
      expect(dailyTotal, `amountMinor=${amountMinor}`).toBe(
        rangeSummary([session], "USD", range).earningsMinor,
      );
    }
  });

  it("allocates the largest supported minor-unit amount without unsafe multiplication", () => {
    const session: WorkSession = {
      ...sessions[0],
      id: "max-safe-money",
      startedAt: "2026-08-01T23:00:00.000Z",
      endedAt: "2026-08-02T01:00:00.000Z",
      activeDurationMs: 7_200_000,
      earnings: { amountMinor: Number.MAX_SAFE_INTEGER, currency: "USD" },
    };
    const range = {
      startMs: Date.parse("2026-08-01T00:00:00.000Z"),
      endMs: Date.parse("2026-08-03T00:00:00.000Z"),
      timezone: "UTC",
    };
    const total = rangeDailySeries([session], "USD", range).reduce(
      (sum, point) => sum + point.earningsMinor,
      0,
    );

    expect(total).toBe(Number.MAX_SAFE_INTEGER);
    expect(total).toBe(rangeSummary([session], "USD", range).earningsMinor);
  });

  it("creates every requested day rather than capping long ranges to 30 days", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const points = dailySeries([], 90, "USD", now, "UTC");
    expect(points).toHaveLength(90);
    expect(points[0].key).toBe("2026-05-13");
    expect(points.at(-1)?.key).toBe("2026-08-10");
    const yearRange = resolveRange("1y", "UTC", now.getTime());
    expect(rangeDailySeries([], "USD", yearRange)).toHaveLength(344);
  });

  it("formats daily chart labels with the selected application locale", () => {
    const range = {
      startMs: new Date("2026-08-10T00:00:00.000Z").getTime(),
      endMs: new Date("2026-08-11T00:00:00.000Z").getTime(),
      timezone: "UTC",
    };
    const instant = new Date("2026-08-10T00:00:00.000Z");
    const options = {
      weekday: "short" as const,
      day: "numeric" as const,
      timeZone: "UTC",
    };
    expect(rangeDailySeries([], "USD", range, "vi")[0]?.label).toBe(
      new Intl.DateTimeFormat("vi-VN", options).format(instant),
    );
    expect(rangeDailySeries([], "USD", range, "en")[0]?.label).toBe(
      new Intl.DateTimeFormat("en-US", options).format(instant),
    );
  });

  it("never lets foreign-currency work time dilute an original-currency hourly rate", () => {
    const foreign: WorkSession = {
      ...sessions[0],
      id: "foreign",
      startedAt: "2026-08-09T10:00:00.000Z",
      endedAt: "2026-08-09T12:00:00.000Z",
      earnings: { amountMinor: 20_000, currency: "USD" },
      activeDurationMs: 7_200_000,
    };
    const range = {
      startMs: new Date("2026-08-09T08:00:00.000Z").getTime(),
      endMs: new Date("2026-08-09T12:00:00.000Z").getTime(),
      timezone: "UTC",
    };
    const summary = rangeSummary(
      [
        {
          ...sessions[0],
          earnings: { amountMinor: 1_000_000, currency: "VND" },
        },
        foreign,
      ],
      "VND",
      range,
    );
    expect(summary.activeMs).toBe(14_400_000);
    expect(summary.earningActiveMs).toBe(7_200_000);
    expect(summary.effectiveHourlyMinor).toBe(500_000);
  });

  it("counts overlapping offline sessions once for time while retaining every earning and project fact", () => {
    const second: WorkSession = {
      ...sessions[0],
      id: "s2",
      projectId: "p2",
      startedAt: "2026-08-09T09:00:00.000Z",
      endedAt: "2026-08-09T11:00:00.000Z",
      pauses: [
        {
          startedAt: "2026-08-09T09:30:00.000Z",
          endedAt: "2026-08-09T10:00:00.000Z",
        },
      ],
      activeDurationMs: 5_400_000,
      earnings: { amountMinor: 5_000, currency: "USD" },
    };
    const range = {
      startMs: Date.parse("2026-08-09T00:00:00.000Z"),
      endMs: Date.parse("2026-08-10T00:00:00.000Z"),
      timezone: "UTC",
    };
    const overlapping = [sessions[0], second];

    expect(completedSessionOverlapSummary(overlapping, range)).toEqual({
      affectedSessionCount: 2,
      overlapMs: 1_800_000,
    });
    expect(rangeSummary(overlapping, "USD", range)).toMatchObject({
      activeMs: 10_800_000,
      earningActiveMs: 10_800_000,
      earningsMinor: 12_500,
      sessionCount: 2,
    });
    expect(rangeDailySeries(overlapping, "USD", range)[0]).toMatchObject({
      activeMs: 10_800_000,
      earningActiveMs: 10_800_000,
      earningsMinor: 12_500,
    });
    expect(
      projectBreakdown(
        overlapping,
        [
          {
            id: "p1",
            name: "One",
            paymentModel: "per_session",
            color: "#111111",
            icon: "1",
            status: "active",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
            syncStatus: "local",
          },
          {
            id: "p2",
            name: "Two",
            paymentModel: "per_session",
            color: "#222222",
            icon: "2",
            status: "active",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
            syncStatus: "local",
          },
        ],
        "USD",
        range,
      ).reduce((total, item) => total + item.activeMs, 0),
    ).toBe(12_600_000);
  });

  it("unions completed and active time for live KPIs and time goals", () => {
    const completed: WorkSession = {
      ...sessions[0],
      id: "completed-overlap",
      startedAt: "2026-08-09T08:00:00.000Z",
      endedAt: "2026-08-09T10:00:00.000Z",
      activeDurationMs: 7_200_000,
      earnings: { amountMinor: 2_000, currency: "USD" },
    };
    const active: WorkSession = {
      ...sessions[0],
      id: "active-overlap",
      startedAt: "2026-08-09T09:00:00.000Z",
      endedAt: undefined,
      activeDurationMs: undefined,
      status: "running",
      earnings: undefined,
    };
    const now = new Date("2026-08-09T11:00:00.000Z");
    const range = {
      startMs: Date.parse("2026-08-09T00:00:00.000Z"),
      endMs: now.getTime(),
      timezone: "UTC",
    };
    const goal: Goal = {
      id: "live-hours",
      kind: "hours_daily",
      target: 8,
      createdAt: "2026-08-09T00:00:00.000Z",
      syncStatus: "local",
    };

    expect(
      liveRangeSummary([completed, active], "USD", range, now.getTime()),
    ).toMatchObject({ activeMs: 10_800_000, earningsMinor: 2_000 });
    expect(
      rangeDailySeries(
        [completed, active],
        "USD",
        range,
        "en",
        now.getTime(),
      )[0],
    ).toMatchObject({ activeMs: 10_800_000, earningsMinor: 2_000 });
    expect(
      goalCurrentValue(goal, [completed, active], [], "USD", now, "UTC"),
    ).toBe(3);
  });

  it("uses a visible current-month cadence and pace for completed-project goals", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const goal: Goal = {
      id: "goal-projects",
      kind: "projects_completed",
      target: 4,
      createdAt: "2026-08-01T00:00:00.000Z",
      syncStatus: "local",
    };
    const projects: Project[] = [
      {
        id: "in-range",
        name: "In range",
        paymentModel: "per_session",
        color: "#7c3aed",
        icon: "*",
        status: "completed",
        completedAt: "2026-08-04T12:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-04T12:00:00.000Z",
        syncStatus: "local",
      },
      {
        id: "old",
        name: "Old",
        paymentModel: "per_session",
        color: "#7c3aed",
        icon: "*",
        status: "completed",
        completedAt: "2026-07-31T23:59:59.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-31T23:59:59.000Z",
        syncStatus: "local",
      },
      {
        id: "future",
        name: "Future",
        paymentModel: "per_session",
        color: "#7c3aed",
        icon: "*",
        status: "completed",
        completedAt: "2026-08-11T00:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-11T00:00:00.000Z",
        syncStatus: "local",
      },
    ];
    expect(goalCurrentValue(goal, [], projects, "USD", now, "UTC")).toBe(1);
    const progress = calculateGoalProgress(
      goal,
      [],
      projects,
      "USD",
      now,
      "UTC",
    );
    expect(progress.expectedCurrent).not.toBeNull();
    expect(progress.pacePerHour).not.toBeNull();
    expect(progress.status).toBe("behind");
    expect(progress.projectedCompletionAt).toBeDefined();
  });

  it("starts an empty goal on track instead of ahead", () => {
    const goal: Goal = {
      id: "goal-at-boundary",
      kind: "hours_daily",
      target: 4,
      createdAt: "2026-08-10T00:00:00.000Z",
      syncStatus: "local",
    };
    const progress = calculateGoalProgress(
      goal,
      [],
      [],
      "USD",
      new Date("2026-08-10T00:00:00.000Z"),
      "UTC",
    );

    expect(progress.status).toBe("on_track");
    expect(progress.percentage).toBe(0);
  });

  it("defensively contains an invalid target and an overflowing projection", () => {
    const invalid: Goal = {
      id: "invalid-goal",
      kind: "hours_daily",
      target: 0,
      createdAt: "2026-08-10T00:00:00.000Z",
      syncStatus: "local",
    };
    expect(
      calculateGoalProgress(
        invalid,
        [],
        [],
        "USD",
        new Date("2026-08-10T12:00:00.000Z"),
        "UTC",
      ),
    ).toMatchObject({
      target: 0,
      percentage: 0,
      remaining: 0,
      status: "behind",
      projectedCompletionAt: undefined,
    });
  });
});
