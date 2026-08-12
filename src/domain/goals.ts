import type { GoalKind } from "./types";

export type GoalTargetIssue =
  | "not_positive"
  | "not_safe_integer"
  | "project_count_not_integer";

/**
 * Goal targets are persisted and synchronized as JavaScript numbers. Earnings
 * are minor units and project counts are discrete, so both must be safe
 * integers. Hour targets may be fractional but still have to stay inside the
 * safe numeric domain used by analytics.
 */
export function goalTargetIssue(
  kind: GoalKind,
  target: number,
): GoalTargetIssue | null {
  if (!Number.isFinite(target) || target <= 0) return "not_positive";
  if (target > Number.MAX_SAFE_INTEGER) return "not_safe_integer";
  if (kind.startsWith("earnings") && !Number.isSafeInteger(target))
    return "not_safe_integer";
  if (kind === "projects_completed" && !Number.isSafeInteger(target))
    return "project_count_not_integer";
  return null;
}

export function isValidGoalTarget(kind: GoalKind, target: number): boolean {
  return goalTargetIssue(kind, target) === null;
}
