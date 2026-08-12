# Sync retention policy

TimeFarm treats offline correctness as more important than automatic row-count
reduction. Migration `0007_sync_contract_and_retention.sql` therefore installs
a guarded pruning mechanism, but it does not schedule deletion.

## What may be pruned

`sync_changes` is an incremental delivery log, not the canonical copy of an
entity. An operator may prune old rows with
`workly_prune_sync_changes(user_id, through_cursor, created_before)` after the
product has chosen a maximum offline window. The database enforces all of the
following:

- the age cutoff is at least 90 days old;
- rows must satisfy both the cursor and age cutoffs;
- writers, pulls, and pruning are serialized by a short per-user database lock;
- pruning stops before the first younger row, so the watermark always covers a
  contiguous prefix even for cursors created before that lock existed;
- the highest deleted cursor is stored durably;
- a device behind that watermark receives `Change cursor expired; full
bootstrap required` instead of an incomplete feed.
- a full bootstrap returns a cursor at least equal to the watermark, including
  when every old change row has already been removed.

Use the function only from a trusted server or SQL administration session. It
is granted to `service_role`, never to `anon` or `authenticated`, and a service
role key must never be bundled into the desktop application.

Example after backups and offline-window review:

```sql
select public.workly_prune_sync_changes(
  '00000000-0000-4000-8000-000000000000'::uuid,
  123456,
  now() - interval '180 days'
);
```

The 180-day example is an operational recommendation, not an automatic job.
Start with a small cohort, monitor expired-cursor errors, and verify the full
bootstrap path before expanding it.

Serializing cloud writes for one user is intentional. It adds a small amount
of same-account contention, while preserving cursor commit order across
different entities; different users remain fully concurrent.

## What must not be pruned automatically

`sync_entity_versions`, including rows marked `deleted`, is the optimistic
concurrency and anti-resurrection ledger. Removing a tombstone could let a
device that was offline before a deletion recreate the entity with revision
zero. These rows are retained indefinitely unless a future design introduces
an equally durable compacted ledger.

`sync_operations` preserves idempotent operation results. It is also retained
indefinitely. A future bounded idempotency window may be introduced only after
all clients require non-null CAS revisions and the retry behavior is specified
as a product contract.

The outbox and conflict tables are local SQLite tables; there are no server
copies for this migration to prune. Their safe policy is state-based:

- never remove `queued` or `error` outbox rows;
- never remove `open` conflicts;
- terminal `synced` outbox rows and `resolved` conflicts may be compacted in a
  future local migration after a documented recovery window and tests prove no
  retry, conflict-resolution, or support-export path depends on them.

This distinction is intentional: age alone is not evidence that an offline
operation or unresolved conflict is disposable.
