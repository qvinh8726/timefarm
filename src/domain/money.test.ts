import { describe, expect, it } from "vitest";
import {
  formatMoney,
  groupedMoney,
  moneyFromInput,
  moneyToInput,
  sumMoney,
} from "./money";

describe("money helpers", () => {
  it("rounds major-unit input using the selected currency precision", () => {
    expect(moneyFromInput("12,345", "USD")).toEqual({
      amountMinor: 1235,
      currency: "USD",
    });
    expect(moneyFromInput("1250", "VND")).toEqual({
      amountMinor: 1250,
      currency: "VND",
    });
    expect(moneyFromInput("invalid", "EUR")).toEqual({
      amountMinor: 0,
      currency: "EUR",
    });
  });

  it("converts stored amounts back to inputs and localized display text", () => {
    expect(moneyToInput()).toBe("");
    expect(moneyToInput({ amountMinor: 1235, currency: "USD" })).toBe("12.35");
    expect(formatMoney(undefined, "en")).toBe("—");
    expect(formatMoney({ amountMinor: 1250, currency: "VND" }, "vi")).toContain(
      "1.250",
    );
  });

  it("sums only the requested currency and groups mixed original currencies", () => {
    const values = [
      { amountMinor: 100, currency: "USD" as const },
      { amountMinor: 250, currency: "USD" as const },
      { amountMinor: 300, currency: "EUR" as const },
      undefined,
    ];
    expect(sumMoney(values, "USD")).toEqual({
      amountMinor: 350,
      currency: "USD",
    });
    expect(groupedMoney(values)).toEqual([
      { amountMinor: 350, currency: "USD" },
      { amountMinor: 300, currency: "EUR" },
    ]);
  });
});
