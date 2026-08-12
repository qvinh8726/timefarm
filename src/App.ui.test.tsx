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
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, DashboardCustomizeDialog, Modal } from "./App";
import { RecoveryDialog } from "./components/WorkspaceDialogs";
import {
  createEmptyState,
  type AppState,
  type WorkSession,
} from "./domain/types";
import { AuthProvider } from "./lib/auth";
import { AppStoreProvider, useAppStore } from "./lib/state";

function readyState(): AppState {
  const state = createEmptyState();
  state.account = {
    id: "account-1",
    displayName: "Minh",
    country: "VN",
    language: "en",
    currency: "VND",
    timezone: "Asia/Saigon",
    createdAt: "2026-08-12T00:00:00.000Z",
  };
  return state;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function DashboardCustomizeHarness() {
  const { state } = useAppStore();
  return state ? <DashboardCustomizeDialog onClose={() => {}} /> : null;
}

function RecoveryHarness({
  session,
  onContinue,
  onComplete,
}: {
  session: WorkSession;
  onContinue: () => void;
  onComplete: (endedAt?: string) => void;
}) {
  const { state } = useAppStore();
  return state ? (
    <RecoveryDialog
      session={session}
      onContinue={onContinue}
      onComplete={onComplete}
    />
  ) : null;
}

const recoverySession: WorkSession = {
  id: "session-1",
  startedAt: "2026-08-10T08:00:00.000Z",
  timezone: "Asia/Saigon",
  pauses: [],
  status: "running",
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T08:00:00.000Z",
  syncStatus: "queued",
};

afterEach(() => {
  cleanup();
  delete window.worklyDesktop;
});

describe("Modal accessibility", () => {
  it("focuses the intended field, exposes its description, traps focus, and restores focus", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(opener);
    opener.focus();
    const close = vi.fn();
    const { unmount } = render(
      <Modal title="Create project" subtitle="Project details" onClose={close}>
        <input data-autofocus aria-label="Project name" />
        <button type="button">Save</button>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Create project" });
    const input = screen.getByRole("textbox", { name: "Project name" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(dialog).toHaveAccessibleDescription("Project details");

    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    const report = await axe.run(dialog, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(report.violations).toEqual([]);

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("closes on Escape unless the recovery flow is locked", () => {
    const close = vi.fn();
    const { rerender } = render(
      <Modal title="Regular dialog" onClose={close}>
        <button type="button">Action</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();

    close.mockClear();
    rerender(
      <Modal title="Recovery" onClose={close} locked>
        <button type="button">Recover</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });
});

describe("mutation feedback and serialization", () => {
  it("serializes dashboard preference writes and exposes a failed ActionResult", async () => {
    const state = readyState();
    const command = deferred<never>();
    const executeCommand = vi.fn(() => command.promise);
    window.worklyDesktop = {
      loadState: vi.fn().mockResolvedValue(state),
      executeCommand,
      onStateChanged: vi.fn(() => () => {}),
    } as unknown as NonNullable<Window["worklyDesktop"]>;

    render(
      <AppStoreProvider>
        <DashboardCustomizeHarness />
      </AppStoreProvider>,
    );

    const goals = await screen.findByRole("checkbox", { name: "Goals" });
    fireEvent.click(goals);
    fireEvent.click(goals);

    await waitFor(() => expect(executeCommand).toHaveBeenCalledOnce());
    expect(goals).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reset defaults" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();

    command.reject(new Error("disk busy"));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk busy");
    await waitFor(() => expect(goals).toBeEnabled());
    expect(executeCommand).toHaveBeenCalledOnce();
  });

  it("locks every recovery action while acquiring the timer lease", async () => {
    const lease = deferred<TimerLeaseStatus>();
    const acquireTimerLease = vi.fn(() => lease.promise);
    window.worklyDesktop = {
      loadState: vi.fn().mockResolvedValue(readyState()),
      getTimerLeaseStatus: vi
        .fn()
        .mockResolvedValue({ state: "not_configured" }),
      acquireTimerLease,
      onTimerLeaseChanged: vi.fn(() => () => {}),
      onStateChanged: vi.fn(() => () => {}),
    } as unknown as NonNullable<Window["worklyDesktop"]>;
    const onContinue = vi.fn();

    render(
      <AppStoreProvider>
        <RecoveryHarness
          session={recoverySession}
          onContinue={onContinue}
          onComplete={() => {}}
        />
      </AppStoreProvider>,
    );

    const continueButton = await screen.findByRole("button", {
      name: "Continue session",
    });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);

    await waitFor(() => expect(acquireTimerLease).toHaveBeenCalledOnce());
    expect(continueButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "End now" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Use this time" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard session" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Or end at (device timezone)")).toBeDisabled();

    lease.resolve({ state: "acquired" });
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
  });

  it("rejects a recovery end timestamp in the future before completing", async () => {
    window.worklyDesktop = {
      loadState: vi.fn().mockResolvedValue(readyState()),
      getTimerLeaseStatus: vi
        .fn()
        .mockResolvedValue({ state: "not_configured" }),
      onTimerLeaseChanged: vi.fn(() => () => {}),
      onStateChanged: vi.fn(() => () => {}),
    } as unknown as NonNullable<Window["worklyDesktop"]>;
    const onComplete = vi.fn();

    render(
      <AppStoreProvider>
        <RecoveryHarness
          session={recoverySession}
          onContinue={() => {}}
          onComplete={onComplete}
        />
      </AppStoreProvider>,
    );

    const endInput = await screen.findByLabelText(
      "Or end at (device timezone)",
    );
    fireEvent.change(endInput, { target: { value: "2099-01-01T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this time" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose an end time that is not in the future.",
    );
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("signed-out local-data recovery", () => {
  it("lets a signed-out user invoke the native reset for data left on the device", async () => {
    const localState = createEmptyState();
    localState.account = {
      id: "local-account",
      authUserId: "auth-user",
      displayName: "Minh",
      country: "VN",
      language: "en",
      currency: "VND",
      timezone: "Asia/Saigon",
      createdAt: "2026-08-12T00:00:00.000Z",
    };
    const resetLocalData = vi.fn().mockResolvedValue({
      cancelled: false,
      state: createEmptyState(),
    });
    window.worklyDesktop = {
      loadState: vi.fn().mockResolvedValue(localState),
      resetLocalData,
      getAuthStatus: vi.fn().mockResolvedValue({
        configured: true,
        authenticated: false,
        user: null,
      }),
      onAuthChanged: vi.fn(() => () => {}),
      onStateChanged: vi.fn(() => () => {}),
    } as unknown as NonNullable<Window["worklyDesktop"]>;

    render(
      <AuthProvider>
        <AppStoreProvider>
          <App />
        </AppStoreProvider>
      </AuthProvider>,
    );

    const clearButton = await screen.findByRole("button", {
      name: "Clear device data",
    });
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.title).toBe("TimeFarm — Focused work, clear earnings");
    fireEvent.click(clearButton);
    await waitFor(() => expect(resetLocalData).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Clear device data" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not trap an authenticated user on the local ownership screen", async () => {
    const localState = createEmptyState();
    localState.account = {
      id: "unlinked-local-account",
      displayName: "Minh",
      country: "VN",
      language: "en",
      currency: "VND",
      timezone: "Asia/Saigon",
      createdAt: "2026-08-12T00:00:00.000Z",
    };
    const resetLocalData = vi.fn().mockResolvedValue({
      cancelled: false,
      state: createEmptyState(),
    });
    const signOut = vi.fn().mockResolvedValue({
      configured: true,
      authenticated: false,
      user: null,
    });
    window.worklyDesktop = {
      loadState: vi.fn().mockResolvedValue(localState),
      resetLocalData,
      signOut,
      getAuthStatus: vi.fn().mockResolvedValue({
        configured: true,
        authenticated: true,
        offline: false,
        user: { id: "auth-user", email: "minh@example.com" },
      }),
      onAuthChanged: vi.fn(() => () => {}),
      onStateChanged: vi.fn(() => () => {}),
    } as unknown as NonNullable<Window["worklyDesktop"]>;

    render(
      <AuthProvider>
        <AppStoreProvider>
          <App />
        </AppStoreProvider>
      </AuthProvider>,
    );

    const clearButton = await screen.findByRole("button", {
      name: "Clear device data",
    });
    expect(
      screen.getByRole("button", { name: "Sign out to use another account" }),
    ).toBeEnabled();
    fireEvent.click(clearButton);
    await waitFor(() => expect(resetLocalData).toHaveBeenCalledOnce());
  });
});
