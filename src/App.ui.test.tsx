// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, Modal } from "./App";
import { createEmptyState } from "./domain/types";
import { AuthProvider } from "./lib/auth";
import { AppStoreProvider } from "./lib/state";

afterEach(() => {
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
