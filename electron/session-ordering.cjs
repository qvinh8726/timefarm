/**
 * Canonical newest-first ordering for completed sessions. The end timestamp is
 * the business fact; an ordinal UTF-8 ID comparison is the stable final
 * tie-breaker and matches SQLite/Postgres binary ordering for TimeFarm UUIDs.
 *
 * @param {{id: unknown, startedAt: string, endedAt?: string}} left
 * @param {{id: unknown, startedAt: string, endedAt?: string}} right
 */
function compareCompletedSessionsNewestFirst(left, right) {
  const endDifference =
    Date.parse(right.endedAt ?? right.startedAt) -
    Date.parse(left.endedAt ?? left.startedAt);
  if (endDifference !== 0) return endDifference;
  return Buffer.compare(
    Buffer.from(String(right.id), "utf8"),
    Buffer.from(String(left.id), "utf8"),
  );
}

module.exports = { compareCompletedSessionsNewestFirst };
