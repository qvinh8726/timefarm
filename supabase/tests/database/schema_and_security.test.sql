begin;

select plan(58);

select has_table('public', 'profiles', 'profiles table exists');
select has_column('public', 'profiles', 'workspace_id', 'profiles carry a workspace claim');
select has_index(
  'public',
  'profiles',
  'profiles_workspace_id_uidx',
  'workspace claims have a unique index'
);
select has_table('public', 'fx_rate_cache', 'the FX cache migration targets the real table');
select has_table(
  'public',
  'sync_entity_versions',
  'the cloud keeps durable entity revision tombstones'
);
select has_table(
  'public',
  'sync_change_retention',
  'change pruning records a durable resync watermark'
);
select has_column(
  'public',
  'profiles',
  'preferences_revision',
  'preferences use an independent optimistic revision'
);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'profiles',
        'projects',
        'work_sessions',
        'session_pauses',
        'payments',
        'goals',
        'sync_operations',
        'sync_changes',
        'timer_leases',
        'fx_rate_cache',
        'sync_entity_versions',
        'sync_change_retention'
      )
      and c.relrowsecurity
  ),
  12::bigint,
  'every protected cloud table has RLS enabled'
);

select policies_are(
  'public',
  'profiles',
  array['profiles owned by current user'],
  'profiles expose only the owner-select policy'
);
select policies_are(
  'public',
  'projects',
  array['projects owned by current user'],
  'projects expose only the owner-select policy'
);

select ok(
  to_regprocedure('public.workly_claim_workspace(text,jsonb)') is not null,
  'atomic workspace claim RPC exists'
);
select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'workly_claim_workspace'
  ),
  'workspace claim is SECURITY DEFINER'
);
select is(
  (
    select p.proconfig[1]
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'workly_claim_workspace'
  ),
  'search_path=""',
  'workspace claim uses an empty search_path'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.workly_claim_workspace(text,jsonb)',
    'EXECUTE'
  ),
  'anon cannot execute workspace claims'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.workly_claim_workspace(text,jsonb)',
    'EXECUTE'
  ),
  'authenticated users can execute workspace claims'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.workly_claim_workspace_unchecked(text,jsonb)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass workspace profile validation'
);

select ok(
  to_regprocedure('public.workly_bootstrap_page(text,uuid,bigint,integer)') is not null,
  'paginated bootstrap RPC exists'
);
select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'workly_bootstrap_page'
  ),
  'paginated bootstrap is SECURITY DEFINER'
);
select is(
  (
    select p.proconfig[1]
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'workly_bootstrap_page'
  ),
  'search_path=""',
  'paginated bootstrap uses an empty search_path'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.workly_bootstrap_page(text,uuid,bigint,integer)',
    'EXECUTE'
  ),
  'anon cannot execute paginated bootstrap'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.workly_bootstrap_page(text,uuid,bigint,integer)',
    'EXECUTE'
  ),
  'authenticated users can execute paginated bootstrap'
);

select ok(
  to_regprocedure('public.workly_pull_changes(bigint,integer)') is not null,
  'change-feed pull RPC exists'
);
select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'workly_pull_changes'
  ),
  'change-feed pull is SECURITY DEFINER'
);
select is(
  (
    select p.proconfig[1]
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'workly_pull_changes'
  ),
  'search_path=""',
  'change-feed pull uses an empty search_path'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.workly_pull_changes(bigint,integer)',
    'EXECUTE'
  ),
  'anon cannot execute change-feed pulls'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.workly_pull_changes(bigint,integer)',
    'EXECUTE'
  ),
  'authenticated clients can execute change-feed pulls'
);
select ok(
  not has_table_privilege('anon', 'public.sync_changes', 'SELECT'),
  'anon cannot select the change-feed table'
);
select ok(
  not has_table_privilege('authenticated', 'public.sync_changes', 'SELECT'),
  'authenticated clients cannot select the change-feed table'
);

select is(
  (
    select constraint_row.confdeltype::text
    from pg_constraint as constraint_row
    where constraint_row.conname = 'work_sessions_project_id_fkey'
      and constraint_row.conrelid = 'public.work_sessions'::regclass
  ),
  'r',
  'session history restricts project deletion'
);
select is(
  (
    select constraint_row.confdeltype::text
    from pg_constraint as constraint_row
    where constraint_row.conname = 'payments_project_id_fkey'
      and constraint_row.conrelid = 'public.payments'::regclass
  ),
  'r',
  'payment history restricts project deletion'
);
select has_index(
  'public',
  'work_sessions',
  'work_sessions_project_id_idx',
  'session project foreign keys are indexed'
);
select has_index(
  'public',
  'payments',
  'payments_project_id_idx',
  'payment project foreign keys are indexed'
);

select ok(
  to_regprocedure(
    'public.workly_apply_sync_operation(uuid,text,uuid,text,jsonb,bigint)'
  ) is not null,
  'revision-aware sync writer exists'
);
select ok(
  to_regprocedure('public.workly_get_entity_revisions(jsonb)') is not null,
  'batch revision lookup RPC exists'
);
select ok(
  to_regprocedure(
    'public.workly_bootstrap_page_v2(text,uuid,bigint,integer)'
  ) is not null,
  'revision-aware bootstrap RPC exists'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.workly_apply_sync_operation(uuid,text,uuid,text,jsonb,bigint)',
    'EXECUTE'
  ),
  'anon cannot execute revision-aware writes'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.workly_apply_sync_operation(uuid,text,uuid,text,jsonb,bigint)',
    'EXECUTE'
  ),
  'authenticated clients can execute revision-aware writes'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.workly_apply_sync_operation_legacy(uuid,text,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass CAS through the private legacy writer'
);
select ok(
  to_regprocedure(
    'public.workly_apply_sync_operation_unlocked(uuid,text,uuid,text,jsonb)'
  ) is not null,
  'the original writer remains available only behind the locking wrapper'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.workly_apply_sync_operation_unlocked(uuid,text,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass parent locking through the original writer'
);

select ok(
  to_regprocedure(
    'public.workly_apply_sync_operation(uuid,text,uuid,text,jsonb)'
  ) is null,
  'the last-write-wins five-argument endpoint is retired'
);
select ok(
  to_regprocedure('public.workly_bootstrap_snapshot()') is null,
  'the unbounded full snapshot endpoint is retired'
);
select ok(
  to_regprocedure(
    'public.workly_apply_sync_operation_cas_unchecked(uuid,text,uuid,text,jsonb,bigint)'
  ) is not null,
  'the proven CAS implementation remains available behind its validator'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.workly_apply_sync_operation_cas_unchecked(uuid,text,uuid,text,jsonb,bigint)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the strict CAS validator'
);
select is(
  (
    select p.proconfig[1]
    from pg_proc as p
    where p.oid = (
      'public.workly_apply_sync_operation(uuid,text,uuid,text,jsonb,bigint)'
    )::regprocedure
  ),
  'search_path=""',
  'the public CAS writer uses an empty search_path'
);
select ok(
  to_regprocedure(
    'public.workly_bootstrap_page_unchecked(text,uuid,bigint,integer)'
  ) is not null,
  'the keyset bootstrap implementation remains private behind its validator'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.workly_bootstrap_page_unchecked(text,uuid,bigint,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass bootstrap page bounds'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.sync_change_retention',
    'SELECT'
  ),
  'authenticated clients cannot inspect retention metadata directly'
);
select ok(
  to_regprocedure(
    'public.workly_prune_sync_changes(uuid,bigint,timestamp with time zone)'
  ) is not null,
  'the guarded change-feed pruning function exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.workly_prune_sync_changes(uuid,bigint,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated clients cannot prune the change feed'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.workly_prune_sync_changes(uuid,bigint,timestamp with time zone)',
    'EXECUTE'
  ),
  'only the trusted service role can invoke retention pruning'
);
select has_index(
  'public',
  'work_sessions',
  'work_sessions_user_latest_completed_idx',
  'latest-session validation has a matching partial index'
);
select has_index(
  'public',
  'work_sessions',
  'work_sessions_user_bootstrap_completed_idx',
  'completed-session bootstrap has a matching partial index'
);
select has_index(
  'public',
  'sync_changes',
  'sync_changes_entity_latest_idx',
  'CAS conflict payload lookup has a matching composite index'
);
select is(
  (
    select count(*)
    from pg_constraint
    where conname in (
      'projects_expected_money_shape_check',
      'work_sessions_completed_shape_check',
      'payments_safe_amount_check',
      'goals_safe_target_check',
      'sync_changes_payload_object_check'
    )
  ),
  5::bigint,
  'cloud rows enforce desktop-compatible shape and safe-number bounds'
);

select is(
  (
    select count(*)
    from pg_constraint
    where conname in (
      'profiles_currency_check',
      'projects_expected_currency_check',
      'work_sessions_earnings_currency_check',
      'payments_currency_check',
      'fx_rate_cache_base_currency_check',
      'fx_rate_cache_quote_currency_check'
    )
  ),
  6::bigint,
  'the shared five-currency contract is enforced by six constraints'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'projects',
        'work_sessions',
        'session_pauses',
        'payments',
        'goals',
        'sync_operations',
        'sync_changes',
        'timer_leases'
      )
      and qual like '%auth.uid()%'
  ),
  9::bigint,
  'all nine owner policies derive identity from auth.uid()'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'projects',
        'work_sessions',
        'session_pauses',
        'payments',
        'goals',
        'sync_operations',
        'sync_changes',
        'timer_leases'
      )
      and qual like '%SELECT auth.uid()%'
  ),
  9::bigint,
  'all owner policies cache auth.uid() through a scalar subquery'
);

select * from finish();
rollback;
