begin;

select plan(27);

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
        'sync_entity_versions'
      )
      and c.relrowsecurity
  ),
  11::bigint,
  'every renderer-relevant cloud table has RLS enabled'
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
  'search_path=public, pg_temp',
  'workspace claim pins its search_path'
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
  'search_path=public, pg_temp',
  'paginated bootstrap pins its search_path'
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

select * from finish();
rollback;
