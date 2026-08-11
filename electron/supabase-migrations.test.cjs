const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationDirectory = path.join(__dirname, "..", "supabase", "migrations");
const migrationFiles = fs
  .readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const sql = Object.fromEntries(
  migrationFiles.map((name) => [
    name,
    fs.readFileSync(path.join(migrationDirectory, name), "utf8").toLowerCase(),
  ]),
);

test("keeps Supabase migrations contiguous and ordered", () => {
  assert.deepEqual(migrationFiles, [
    "0001_workly_schema.sql",
    "0002_bootstrap_snapshot.sql",
    "0003_atomic_workspace_claim.sql",
    "0004_paginated_bootstrap.sql",
    "0005_optimistic_revisions.sql",
  ]);
});

test("keeps ownership policies and privileged RPCs bound to auth.uid()", () => {
  const schema = sql["0001_workly_schema.sql"];
  for (const table of [
    "profiles",
    "projects",
    "work_sessions",
    "session_pauses",
    "payments",
    "goals",
    "sync_operations",
    "sync_changes",
    "timer_leases",
  ]) {
    assert.match(
      schema,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }
  assert.match(schema, /auth\.uid\(\)/);
  for (const signature of [
    "public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb)",
    "public.workly_pull_changes(bigint, integer)",
    "public.workly_acquire_timer_lease(uuid, integer)",
  ]) {
    assert.ok(
      schema.includes(`revoke all on function ${signature} from public`),
    );
    assert.ok(
      schema.includes(
        `grant execute on function ${signature} to authenticated`,
      ),
    );
  }
});

test("keeps workspace claiming atomic, unique, and unavailable to PUBLIC", () => {
  const claim = sql["0003_atomic_workspace_claim.sql"];
  assert.match(claim, /create unique index[^;]+profiles\(workspace_id\)/s);
  assert.match(
    claim,
    /create or replace function public\.workly_claim_workspace/,
  );
  assert.match(claim, /security definer/);
  assert.match(claim, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(claim, /on conflict do nothing/);
  assert.match(
    claim,
    /revoke all on function public\.workly_claim_workspace\(text, jsonb\) from public/,
  );
  assert.match(
    claim,
    /grant execute on function public\.workly_claim_workspace\(text, jsonb\) to authenticated/,
  );
});

test("keeps the shared five-currency contract in the claim migration", () => {
  const claim = sql["0003_atomic_workspace_claim.sql"];
  assert.ok(claim.includes("alter table public.fx_rate_cache"));
  assert.doesNotMatch(claim, /alter table public\.fx_rates\b/);
  for (const tableColumn of [
    "profiles_currency_check",
    "projects_expected_currency_check",
    "work_sessions_earnings_currency_check",
    "payments_currency_check",
    "fx_rate_cache_base_currency_check",
    "fx_rate_cache_quote_currency_check",
  ]) {
    assert.ok(claim.includes(tableColumn));
  }
  assert.ok(claim.includes("('vnd', 'usd', 'eur', 'jpy', 'gbp')"));
});

test("keeps new-device bootstrap paginated and explicitly privileged", () => {
  const bootstrap = sql["0004_paginated_bootstrap.sql"];
  for (const indexName of [
    "projects_user_id_id_idx",
    "sessions_user_id_id_idx",
    "payments_user_id_id_idx",
    "goals_user_id_id_idx",
  ]) {
    assert.ok(bootstrap.includes(indexName));
  }
  assert.match(
    bootstrap,
    /create or replace function public\.workly_bootstrap_page/,
  );
  assert.match(bootstrap, /p_snapshot_cursor bigint/);
  assert.match(bootstrap, /limit p_limit \+ 1/);
  assert.match(bootstrap, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(bootstrap, /security definer/);
  assert.match(
    bootstrap,
    /revoke all on function public\.workly_bootstrap_page\(text, uuid, bigint, integer\) from public/,
  );
  assert.match(
    bootstrap,
    /grant execute on function public\.workly_bootstrap_page\(text, uuid, bigint, integer\) to authenticated/,
  );
});

test("enforces optimistic revisions while retaining a private legacy writer", () => {
  const revision = sql["0005_optimistic_revisions.sql"];
  assert.match(
    revision,
    /create table if not exists public\.sync_entity_versions/,
  );
  assert.match(revision, /for update/);
  assert.match(revision, /p_expected_revision bigint/);
  assert.match(revision, /'reason', 'revision_mismatch'/);
  assert.match(
    revision,
    /v_change_entity_id := case\s+when p_entity_type in \('account', 'preferences'\) then v_user_id/,
  );
  assert.match(
    revision,
    /create or replace function public\.workly_get_entity_revisions/,
  );
  assert.match(
    revision,
    /create or replace function public\.workly_bootstrap_page_v2/,
  );
  assert.match(
    revision,
    /revoke all on function public\.workly_apply_sync_operation_legacy\(uuid, text, uuid, text, jsonb\) from public, anon, authenticated/,
  );
  assert.match(
    revision,
    /grant execute on function public\.workly_apply_sync_operation\(uuid, text, uuid, text, jsonb, bigint\) to authenticated/,
  );
});
