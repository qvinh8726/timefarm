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
    "0006_production_hardening.sql",
    "0007_sync_contract_and_retention.sql",
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
    /'claimed', coalesce\(v_owner_workspace_id = btrim\(p_workspace_id\), false\)/,
  );
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

test("keeps change-feed reads behind the hardened RPC boundary", () => {
  const hardening = sql["0006_production_hardening.sql"];
  assert.match(
    hardening,
    /create or replace function public\.workly_pull_changes[\s\S]+security definer[\s\S]+set search_path = ''/,
  );
  assert.match(hardening, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(hardening, /if v_user_id is null then/);
  assert.match(hardening, /from public\.sync_changes as change/);
  assert.ok(
    hardening.includes(
      "revoke all on table public.sync_changes from public, anon, authenticated",
    ),
  );
  assert.match(
    hardening,
    /grant execute on function public\.workly_pull_changes\(bigint, integer\)\s+to authenticated/,
  );
});

test("prevents project deletion from erasing session or payment history", () => {
  const hardening = sql["0006_production_hardening.sql"];
  assert.ok(hardening.includes("work_sessions_project_id_idx"));
  assert.ok(hardening.includes("payments_project_id_idx"));
  assert.equal(hardening.match(/on delete restrict/g)?.length, 2);
  assert.match(
    hardening,
    /constraint work_sessions_project_id_fkey[\s\S]+references public\.projects\(id\)[\s\S]+on delete restrict/,
  );
  assert.match(
    hardening,
    /constraint payments_project_id_fkey[\s\S]+references public\.projects\(id\)[\s\S]+on delete restrict/,
  );
  assert.match(
    hardening,
    /p_entity_type = 'project' and p_operation = 'delete'[\s\S]+for update/,
  );
  assert.match(
    hardening,
    /p_entity_type in \('work_session', 'payment'\)[\s\S]+for key share/,
  );
  assert.match(
    hardening,
    /workly_apply_sync_operation_unlocked[\s\S]+from public, anon, authenticated/,
  );
});

test("retires legacy unbounded and last-write-wins RPC surfaces", () => {
  const contract = sql["0007_sync_contract_and_retention.sql"];
  assert.match(
    contract,
    /revoke all on function public\.workly_apply_sync_operation\([\s\S]+?jsonb[\s\S]+?\) from public, anon, authenticated;[\s\S]+?drop function public\.workly_apply_sync_operation\(/,
  );
  assert.match(
    contract,
    /revoke all on function public\.workly_bootstrap_snapshot\(\)[\s\S]+?drop function public\.workly_bootstrap_snapshot\(\)/,
  );
  assert.match(
    contract,
    /p_expected_revision is null[\s\S]+?expected revision must be a non-negative safe integer/,
  );
  assert.match(
    contract,
    /workly_apply_sync_operation_cas_unchecked[\s\S]+?from public, anon, authenticated, service_role/,
  );
});

test("keeps every bootstrap response bounded, including explicit NULL limits", () => {
  const contract = sql["0007_sync_contract_and_retention.sql"];
  assert.match(
    contract,
    /create function public\.workly_bootstrap_page\([\s\S]+?if p_limit is null or p_limit < 1 or p_limit > 500 then/,
  );
  assert.match(
    contract,
    /workly_bootstrap_page_unchecked[\s\S]+?from public, anon, authenticated, service_role/,
  );
  assert.match(
    contract,
    /grant execute on function public\.workly_bootstrap_page\([\s\S]+?to authenticated/,
  );
  assert.match(
    contract,
    /v_page := public\.workly_bootstrap_page_unchecked[\s\S]+?jsonb_set\([\s\S]+?v_retention_floor/,
  );
});

test("uses an explicit retention watermark instead of silently truncating offline history", () => {
  const contract = sql["0007_sync_contract_and_retention.sql"];
  assert.match(contract, /create table public\.sync_change_retention/);
  assert.match(contract, /retention cutoff must be at least 90 days old/);
  assert.match(
    contract,
    /from public\.sync_change_retention as retention[\s\S]+?for update/,
  );
  assert.match(
    contract,
    /from public\.sync_change_retention as retention[\s\S]+?for share/,
  );
  assert.match(
    contract,
    /perform retention\.user_id[\s\S]+?for update;[\s\S]+?return public\.workly_apply_sync_operation_cas_unchecked/,
  );
  assert.match(
    contract,
    /v_first_retained_cursor[\s\S]+?v_delete_through := least/,
  );
  assert.match(
    contract,
    /if p_cursor < v_retention_floor then[\s\S]+?change cursor expired; full bootstrap required/,
  );
  assert.match(
    contract,
    /workly_prune_sync_changes\([\s\S]+?from public, anon, authenticated, service_role;[\s\S]+?grant execute[\s\S]+?to service_role/,
  );
  assert.doesNotMatch(contract, /delete from public\.sync_entity_versions/);
});

test("adds high-value sync indexes and caches auth.uid() in RLS policies", () => {
  const contract = sql["0007_sync_contract_and_retention.sql"];
  for (const index of [
    "work_sessions_user_latest_completed_idx",
    "work_sessions_user_bootstrap_completed_idx",
    "sync_changes_entity_latest_idx",
  ]) {
    assert.ok(contract.includes(index));
  }
  assert.match(
    contract,
    /create policy "profiles owned by current user"[\s\S]+?to authenticated[\s\S]+?select auth\.uid\(\)/,
  );
  assert.equal(
    contract.match(/create policy "[^"]+ owned by current user"/g)?.length,
    9,
  );
});

test("aligns cloud payload bounds with safe desktop values", () => {
  const contract = sql["0007_sync_contract_and_retention.sql"];
  assert.match(
    contract,
    /create function public\.workly_validate_sync_payload/,
  );
  assert.match(
    contract,
    /create function public\.workly_trim_text[\s\S]+?pg_catalog\.chr\(160\)[\s\S]+?pg_catalog\.chr\(65279\)/,
  );
  assert.match(contract, /project name must contain 1 to 160 characters/);
  assert.match(
    contract,
    /profile display name must contain 1 to 100 characters/,
  );
  assert.match(contract, /account country must be a two- or three-letter code/);
  assert.match(contract, /project color must contain 1 to 64 characters/);
  assert.match(contract, /project icon must contain 1 to 32 characters/);
  assert.match(
    contract,
    /earnings and completed-project goals require whole-unit targets/,
  );
  assert.match(
    contract,
    /kind in \('hours_daily', 'hours_weekly'\)[\s\S]+?target = trunc\(target\)/,
  );
  assert.match(contract, /dashboard hidden widgets are invalid/);
  assert.ok(contract.includes("9007199254740991"));
  for (const constraint of [
    "projects_expected_money_shape_check",
    "work_sessions_completed_shape_check",
    "payments_safe_amount_check",
    "goals_safe_target_check",
    "sync_changes_payload_object_check",
  ]) {
    assert.ok(contract.includes(constraint));
  }
});
