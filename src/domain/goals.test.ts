import { describe, expect, it } from "vitest";
import { goalTargetIssue, isValidGoalTarget } from "./goals";

describe("goal target validation", () => {
  it("accepts fractional hour targets and positive integer targets", () => {
    expect(isValidGoalTarget("hours_daily", 0.25)).toBe(true);
    expect(isValidGoalTarget("earnings_monthly", 12_345)).toBe(true);
    expect(isValidGoalTarget("projects_completed", 3)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects non-positive or non-finite target %s",
    (target) => {
      expect(goalTargetIssue("hours_weekly", target)).toBe("not_positive");
    },
  );

  it("requires integer minor units and project counts", () => {
    expect(goalTargetIssue("earnings_daily", 1.5)).toBe("not_safe_integer");
    expect(goalTargetIssue("projects_completed", 1.5)).toBe(
      "project_count_not_integer",
    );
  });

  it("rejects values outside the safe integer domain", () => {
    expect(goalTargetIssue("hours_weekly", Number.MAX_SAFE_INTEGER + 1)).toBe(
      "not_safe_integer",
    );
  });
});
