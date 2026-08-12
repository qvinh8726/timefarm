// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState, type AppState } from "../domain/types";
import AnalyticsPage from "./AnalyticsPage";

const testContext = vi.hoisted(() => ({
  state: null as AppState | null,
  now: Date.parse("2026-08-12T12:00:00.000Z"),
}));

vi.mock("../lib/state", () => ({
  useAppStoreState: () => ({ state: testContext.state }),
}));

vi.mock("../lib/clock", () => ({
  useCurrentTime: () => testContext.now,
}));

function populatedState(): AppState {
  const state = createEmptyState();
  state.account = {
    id: "account-1",
    displayName: "Alex",
    country: "VN",
    language: "en",
    currency: "USD",
    timezone: "UTC",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  state.projects = [
    {
      id: "project-1",
      name: "Northstar Website",
      paymentModel: "per_session",
      color: "#08776d",
      icon: "✦",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-11T11:00:00.000Z",
      syncStatus: "local",
    },
  ];
  state.sessions = [
    {
      id: "session-1",
      projectId: "project-1",
      startedAt: "2026-08-11T09:00:00.000Z",
      endedAt: "2026-08-11T11:00:00.000Z",
      timezone: "UTC",
      pauses: [],
      activeDurationMs: 7_200_000,
      status: "completed",
      earnings: { amountMinor: 25_000, currency: "USD" },
      createdAt: "2026-08-11T09:00:00.000Z",
      updatedAt: "2026-08-11T11:00:00.000Z",
      syncStatus: "local",
    },
  ];
  state.goals = [
    {
      id: "goal-1",
      kind: "hours_weekly",
      target: 20,
      createdAt: "2026-08-01T00:00:00.000Z",
      syncStatus: "local",
    },
  ];
  return state;
}

beforeEach(() => {
  testContext.state = populatedState();
});

afterEach(() => {
  cleanup();
  delete window.worklyDesktop;
});

describe("AnalyticsPage ledger hierarchy", () => {
  it("surfaces a rejected FX refresh without an unhandled promise", async () => {
    const state = populatedState();
    state.sessions[0].earnings = { amountMinor: 10_000, currency: "EUR" };
    testContext.state = state;
    window.worklyDesktop = {
      getFxStatus: vi.fn().mockResolvedValue({
        state: "fresh",
        baseCurrency: "USD",
        provider: "Frankfurter",
        fetchedAt: "2026-08-12T00:00:00.000Z",
        sourceDate: "2026-08-11",
        rates: { EUR: 0.9 },
      }),
      convertMoney: vi.fn().mockResolvedValue({
        ok: true,
        money: { amountMinor: 11_111, currency: "USD" },
      }),
      refreshFxRates: vi.fn().mockRejectedValue(new Error("network offline")),
    } as unknown as NonNullable<Window["worklyDesktop"]>;

    render(<AnalyticsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Refresh rates" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("network offline"),
    );
    expect(screen.getByRole("button", { name: "Refresh rates" })).toBeEnabled();
  });

  it("keeps one primary chart, exposes categorized detail, and updates the range accessibly", async () => {
    const { container } = render(<AnalyticsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Analytics" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Daily earnings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Range summary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Signals over time" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Project ledger" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Context and goals" }),
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll(".analytics-chart--primary"),
    ).toHaveLength(1);

    const thirtyDays = screen.getByRole("button", {
      name: "30D: last 30 days",
    });
    const sevenDays = screen.getByRole("button", {
      name: "7D: last 7 days",
    });
    expect(thirtyDays).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(sevenDays);
    expect(sevenDays).toHaveAttribute("aria-pressed", "true");
    expect(thirtyDays).toHaveAttribute("aria-pressed", "false");

    expect(screen.getAllByRole("meter").length).toBeGreaterThan(0);
    expect(screen.getByRole("progressbar")).toHaveAccessibleName(
      "Work hours per week",
    );

    const report = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(report.violations).toEqual([]);
  });
});
