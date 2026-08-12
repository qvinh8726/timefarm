// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState, type AppState } from "../domain/types";
import { ProfilePage, SettingsPage } from "./AccountPages";

const testContext = vi.hoisted(() => ({
  state: null as AppState | null,
  updatePreferences: vi.fn(),
  updateLanguage: vi.fn(),
  rebuildLocalCache: vi.fn(),
  resetLocalData: vi.fn(),
}));

vi.mock("../lib/state", () => ({
  useAppStoreState: () => ({ state: testContext.state }),
  useAppStore: () => ({
    state: testContext.state,
    updatePreferences: testContext.updatePreferences,
    updateLanguage: testContext.updateLanguage,
    rebuildLocalCache: testContext.rebuildLocalCache,
    resetLocalData: testContext.resetLocalData,
  }),
}));

function accountState(): AppState {
  const state = createEmptyState();
  state.account = {
    id: "account-1",
    displayName: "Review User",
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
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  testContext.state = accountState();
  testContext.updatePreferences.mockResolvedValue({ ok: true });
  testContext.updateLanguage.mockResolvedValue({ ok: true });
  testContext.rebuildLocalCache.mockResolvedValue({ ok: true });
  testContext.resetLocalData.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  delete window.worklyDesktop;
});

describe("Account pages", () => {
  it("presents profile identity and sync context with a clear heading hierarchy", async () => {
    const { container } = render(<ProfilePage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Profile" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Review User" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Account sync" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Country").tagName).toBe("DT");
    expect(screen.getByText("Asia/Saigon").tagName).toBe("DD");

    const report = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(report.violations).toEqual([]);
  });

  it("labels every setting precisely and serializes preference mutations", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: true }>();
    testContext.updatePreferences.mockReturnValueOnce(pending.promise);
    const { container } = render(<SettingsPage />);

    const theme = screen.getByRole("combobox", { name: "Theme" });
    const language = screen.getByRole("combobox", { name: "Language" });
    const miniTimer = screen.getByRole("combobox", { name: "Display mode" });
    expect(theme).toHaveAccessibleDescription("System, light, or dark");
    expect(language).toHaveAccessibleDescription(
      "You can change this at any time",
    );
    expect(miniTimer).toHaveAccessibleDescription(
      /View only is fully click-through/,
    );

    fireEvent.change(theme, { target: { value: "dark" } });
    await waitFor(() =>
      expect(testContext.updatePreferences).toHaveBeenCalledWith({
        theme: "dark",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saving setting.");
    expect(theme).toBeDisabled();
    expect(language).toBeDisabled();
    expect(miniTimer).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Rebuild cache from cloud" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Wipe this device" }),
    ).toBeDisabled();

    pending.resolve({ ok: true });
    await waitFor(() => expect(theme).toBeEnabled());

    theme.focus();
    expect(theme).toHaveFocus();
    await user.tab();
    expect(language).toHaveFocus();
    await user.tab();
    expect(miniTimer).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Rebuild cache from cloud" }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Wipe this device" }),
    ).toHaveFocus();

    const report = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(report.violations).toEqual([]);
  });

  it("describes cache rebuild constraints and exposes failures assertively", async () => {
    testContext.rebuildLocalCache.mockResolvedValueOnce({
      ok: false,
      message: "Connect the linked account first.",
    });
    render(<SettingsPage />);

    const rebuild = screen.getByRole("button", {
      name: "Rebuild cache from cloud",
    });
    expect(rebuild).toHaveAccessibleDescription(
      /the timer is stopped, and every local change is synced or resolved/,
    );
    expect(
      screen.getByRole("button", { name: "Wipe this device" }),
    ).toHaveAccessibleDescription(/Cloud data remains/);

    fireEvent.click(rebuild);
    expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent(
      "Connect the linked account first.",
    );
    expect(testContext.rebuildLocalCache).toHaveBeenCalledOnce();
  });

  it("requires a typed browser-preview confirmation before wiping local data", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: "Wipe this device" }));
    const confirmation = screen.getByRole("textbox", {
      name: "Type WIPE to confirm.",
    });
    const wipe = screen.getByRole("button", { name: "Confirm wipe" });
    expect(wipe).toBeDisabled();
    expect(testContext.resetLocalData).not.toHaveBeenCalled();

    await user.type(confirmation, "WIPE");
    expect(wipe).toBeEnabled();
    await user.click(wipe);
    await waitFor(() =>
      expect(testContext.resetLocalData).toHaveBeenCalledOnce(),
    );
  });
});
