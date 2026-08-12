// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalDataResetConfirmation } from "./LocalDataResetConfirmation";

afterEach(cleanup);

it("submits one confirmation when clicked twice before the first submission settles", () => {
  const confirmation = new Promise<void>(() => {});
  const onConfirm = vi.fn(() => confirmation);

  render(
    <LocalDataResetConfirmation
      language="en"
      onCancel={() => {}}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.change(
    screen.getByRole("textbox", { name: "Type WIPE to confirm." }),
    { target: { value: "WIPE" } },
  );
  const confirmButton = screen.getByRole("button", { name: "Confirm wipe" });
  fireEvent.click(confirmButton);
  fireEvent.click(confirmButton);

  expect(onConfirm).toHaveBeenCalledOnce();
});

it("keeps each confirmation input associated with its own label", () => {
  render(
    <>
      <LocalDataResetConfirmation
        language="en"
        onCancel={() => {}}
        onConfirm={() => {}}
      />
      <LocalDataResetConfirmation
        language="vi"
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    </>,
  );

  expect(
    screen.getByRole("textbox", { name: "Type WIPE to confirm." }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: "Nhập XÓA để xác nhận." }),
  ).toBeInTheDocument();
});
