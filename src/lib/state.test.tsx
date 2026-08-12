// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "../domain/types";
import {
  AppStoreProvider,
  type AppStoreActions,
  useAppStoreActions,
  useAppStoreState,
} from "./state";

function ActionsProbe({
  onRender,
}: {
  onRender: (actions: AppStoreActions) => void;
}) {
  const actions = useAppStoreActions();
  useEffect(() => {
    onRender(actions);
  });
  return null;
}

function StateProbe() {
  const { state } = useAppStoreState();
  return (
    <output>
      {state ? `${state.preferences.theme}:${state.goals.length}` : "loading"}
    </output>
  );
}

describe("split app-store contexts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.worklyDesktop = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it("does not rerender an action-only consumer when state changes", async () => {
    const observedActions: AppStoreActions[] = [];
    const observeRender = vi.fn((actions: AppStoreActions) => {
      observedActions.push(actions);
    });
    render(
      <AppStoreProvider>
        <ActionsProbe onRender={observeRender} />
        <StateProbe />
      </AppStoreProvider>,
    );

    await screen.findByText("system:0");
    const actions = observedActions.at(-1);
    expect(actions).toBeDefined();
    const rendersAfterLoad = observeRender.mock.calls.length;

    await act(async () => {
      await actions?.updatePreferences({ theme: "dark" });
    });

    await waitFor(() => expect(screen.getByText("dark:0")).toBeTruthy());
    expect(observeRender).toHaveBeenCalledTimes(rendersAfterLoad);
    expect(observedActions.at(-1)).toBe(actions);
  });

  it("rejects model-invalid goal targets before mutating browser state", async () => {
    const observedActions: AppStoreActions[] = [];
    render(
      <AppStoreProvider>
        <ActionsProbe
          onRender={(actions) => {
            observedActions.push(actions);
          }}
        />
        <StateProbe />
      </AppStoreProvider>,
    );

    await screen.findByText("system:0");
    const actions = observedActions.at(-1);
    expect(actions).toBeDefined();

    await expect(
      actions?.createGoal("earnings_daily", 1.5),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      actions?.createGoal("projects_completed", 1.5),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      actions?.createGoal("hours_weekly", Number.MAX_SAFE_INTEGER + 1),
    ).resolves.toMatchObject({ ok: false });
    expect(screen.getByText("system:0")).toBeTruthy();
  });

  it("routes a stable action facade to the latest state-aware implementation", async () => {
    window.localStorage.setItem(
      "workly-desktop-state-v1",
      JSON.stringify({
        ...createEmptyState(),
        goals: [
          {
            id: "goal-1",
            kind: "hours_daily",
            target: 1,
            createdAt: "2026-08-01T00:00:00.000Z",
            syncStatus: "queued",
          },
        ],
      }),
    );
    const observedActions: AppStoreActions[] = [];
    render(
      <AppStoreProvider>
        <ActionsProbe
          onRender={(actions) => {
            observedActions.push(actions);
          }}
        />
        <StateProbe />
      </AppStoreProvider>,
    );

    await screen.findByText("system:1");
    const actions = observedActions.at(-1);
    if (!actions) throw new Error("Actions were not provided.");

    let firstResult:
      | Awaited<ReturnType<AppStoreActions["deleteGoal"]>>
      | undefined;
    await act(async () => {
      firstResult = await actions.deleteGoal("goal-1");
    });
    expect(firstResult).toMatchObject({ ok: true });
    await screen.findByText("system:0");

    await expect(actions.deleteGoal("goal-1")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("publishes wiped desktop state while surfacing incomplete auxiliary cleanup", async () => {
    const empty = createEmptyState();
    window.worklyDesktop = {
      loadState: vi.fn().mockResolvedValue(empty),
      resetLocalData: vi.fn().mockResolvedValue({
        cancelled: false,
        state: empty,
        cleanupWarning: "Some device-only files are still present.",
      }),
    } as unknown as typeof window.worklyDesktop;
    const observedActions: AppStoreActions[] = [];
    render(
      <AppStoreProvider>
        <ActionsProbe
          onRender={(actions) => {
            observedActions.push(actions);
          }}
        />
        <StateProbe />
      </AppStoreProvider>,
    );

    await screen.findByText("system:0");
    const actions = observedActions.at(-1);
    if (!actions) throw new Error("Actions were not provided.");

    await expect(actions.resetLocalData()).resolves.toEqual({
      ok: false,
      message: "Some device-only files are still present.",
    });
    expect(screen.getByText("system:0")).toBeTruthy();
  });
});
