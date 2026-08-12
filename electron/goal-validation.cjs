const EARNINGS_GOAL_KINDS = new Set([
  "earnings_daily",
  "earnings_weekly",
  "earnings_monthly",
]);

function goalTargetIssue(kind, target) {
  if (!Number.isFinite(target) || target <= 0)
    return "Goal target must be greater than zero.";
  if (target > Number.MAX_SAFE_INTEGER)
    return "Goal target must stay within JavaScript's safe integer range.";
  if (EARNINGS_GOAL_KINDS.has(kind) && !Number.isSafeInteger(target))
    return "Earnings goal targets must use whole minor currency units.";
  if (kind === "projects_completed" && !Number.isSafeInteger(target))
    return "Completed-project goal targets must be whole project counts.";
  return null;
}

function isValidGoalTarget(kind, target) {
  return goalTargetIssue(kind, target) === null;
}

module.exports = { goalTargetIssue, isValidGoalTarget };
