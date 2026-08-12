-- Close legacy sync bypasses, bound bootstrap work, and make change-feed
-- retention explicit without silently corrupting long-offline devices.
--
-- This migration deliberately does not delete entity-version tombstones.
-- They are the durable anti-resurrection ledger for optimistic concurrency.

begin;

-- This row is also the per-user synchronization mutex. Public writers take
-- UPDATE, while pulls take SHARE, before touching the change stream. That
-- makes cursor visibility follow commit order and prevents a late-committing
-- lower identity value from falling behind a cursor a device already saved.
create table public.sync_change_retention (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pruned_through_cursor bigint not null default 0
    check (pruned_through_cursor between 0 and 9007199254740991),
  last_pruned_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.sync_change_retention enable row level security;
revoke all on table public.sync_change_retention
  from public, anon, authenticated;

-- Released desktop builds now send an expected revision. The five-argument
-- overload converted NULL into last-write-wins behavior, so it must no longer
-- exist on the Data API surface.
revoke all on function public.workly_apply_sync_operation(
  uuid,
  text,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;
drop function public.workly_apply_sync_operation(
  uuid,
  text,
  uuid,
  text,
  jsonb
);

-- A single-document snapshot can grow without bound. New and current clients
-- use the keyset-paginated v2 bootstrap instead.
revoke all on function public.workly_bootstrap_snapshot()
  from public, anon, authenticated;
drop function public.workly_bootstrap_snapshot();

-- Keep the existing revision implementation private and put a strict public
-- contract in front of it. In particular, the six-argument endpoint may no
-- longer reproduce the old bypass by explicitly passing a NULL revision.
alter function public.workly_apply_sync_operation(
  uuid,
  text,
  uuid,
  text,
  jsonb,
  bigint
) rename to workly_apply_sync_operation_cas_unchecked;
revoke all on function public.workly_apply_sync_operation_cas_unchecked(
  uuid,
  text,
  uuid,
  text,
  jsonb,
  bigint
) from public, anon, authenticated, service_role;
alter function public.workly_apply_sync_operation_cas_unchecked(
  uuid,
  text,
  uuid,
  text,
  jsonb,
  bigint
) set search_path = '';

-- These implementation functions are reached only through the CAS wrapper.
-- Empty search paths prevent a caller-controlled object from shadowing names
-- inside a SECURITY DEFINER call chain.
alter function public.workly_apply_sync_operation_legacy(
  uuid,
  text,
  uuid,
  text,
  jsonb
) set search_path = '';
alter function public.workly_apply_sync_operation_unlocked(
  uuid,
  text,
  uuid,
  text,
  jsonb
) set search_path = '';

-- PostgreSQL's one-argument btrim() removes only ASCII spaces, while the
-- desktop uses ECMAScript String.trim(). Keep every cloud text boundary on the
-- same explicit WhiteSpace + LineTerminator set so NBSP/BOM-only values cannot
-- poison a cache that the desktop would reject.
create function public.workly_trim_text(p_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(
    p_value,
    pg_catalog.chr(9) ||
    pg_catalog.chr(10) ||
    pg_catalog.chr(11) ||
    pg_catalog.chr(12) ||
    pg_catalog.chr(13) ||
    pg_catalog.chr(32) ||
    pg_catalog.chr(160) ||
    pg_catalog.chr(5760) ||
    pg_catalog.chr(8192) ||
    pg_catalog.chr(8193) ||
    pg_catalog.chr(8194) ||
    pg_catalog.chr(8195) ||
    pg_catalog.chr(8196) ||
    pg_catalog.chr(8197) ||
    pg_catalog.chr(8198) ||
    pg_catalog.chr(8199) ||
    pg_catalog.chr(8200) ||
    pg_catalog.chr(8201) ||
    pg_catalog.chr(8202) ||
    pg_catalog.chr(8232) ||
    pg_catalog.chr(8233) ||
    pg_catalog.chr(8239) ||
    pg_catalog.chr(8287) ||
    pg_catalog.chr(12288) ||
    pg_catalog.chr(65279)
  )
$$;

create function public.workly_validate_sync_payload(
  p_entity_type text,
  p_operation text,
  p_payload jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_amount numeric;
  v_target numeric;
  v_duration numeric;
begin
  if p_entity_type is null or p_entity_type not in (
    'account',
    'project',
    'work_session',
    'payment',
    'goal',
    'preferences'
  ) then
    raise exception 'Unsupported entity type' using errcode = '22023';
  end if;
  if p_operation is null or p_operation not in ('upsert', 'delete') then
    raise exception 'Unsupported operation' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_payload), '') <> 'object' then
    raise exception 'Sync payload must be an object' using errcode = '22023';
  end if;
  if p_operation = 'delete' then
    return;
  end if;

  if p_entity_type = 'account' then
    if coalesce(jsonb_typeof(p_payload->'displayName'), '') <> 'string'
      or p_payload->>'displayName' <>
        public.workly_trim_text(p_payload->>'displayName')
      or char_length(p_payload->>'displayName') not between 1 and 100 then
      raise exception 'Account display name must contain 1 to 100 characters'
        using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(p_payload->'country'), '') <> 'string'
      or p_payload->>'country' <>
        public.workly_trim_text(p_payload->>'country')
      or p_payload->>'country' !~ '^[A-Za-z]{2,3}$' then
      raise exception 'Account country must be a two- or three-letter code'
        using errcode = '22023';
    end if;
    if p_payload->>'language' not in ('vi', 'en') then
      raise exception 'Unsupported account language' using errcode = '22023';
    end if;
    if p_payload->>'currency' not in ('VND', 'USD', 'EUR', 'JPY', 'GBP') then
      raise exception 'Unsupported account currency' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(p_payload->'timezone'), '') <> 'string'
      or p_payload->>'timezone' <>
        public.workly_trim_text(p_payload->>'timezone')
      or char_length(p_payload->>'timezone') not between 1 and 120 then
      raise exception 'Account timezone must contain 1 to 120 characters'
        using errcode = '22023';
    end if;

  elsif p_entity_type = 'project' then
    if coalesce(jsonb_typeof(p_payload->'name'), '') <> 'string'
      or p_payload->>'name' <> public.workly_trim_text(p_payload->>'name')
      or char_length(p_payload->>'name') not between 1 and 160 then
      raise exception 'Project name must contain 1 to 160 characters'
        using errcode = '22023';
    end if;
    if p_payload->>'paymentModel' not in (
      'per_session',
      'on_completion',
      'progressive'
    ) then
      raise exception 'Unsupported project payment model' using errcode = '22023';
    end if;
    if p_payload->>'status' not in ('active', 'paused', 'completed') then
      raise exception 'Unsupported project status' using errcode = '22023';
    end if;
    if p_payload->>'status' = 'completed'
      and nullif(p_payload->>'completedAt', '') is null then
      raise exception 'Completed projects require a completion timestamp'
        using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(p_payload->'color'), '') <> 'string'
      or p_payload->>'color' <> public.workly_trim_text(p_payload->>'color')
      or char_length(p_payload->>'color') not between 1 and 64 then
      raise exception 'Project color must contain 1 to 64 characters'
        using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(p_payload->'icon'), '') <> 'string'
      or p_payload->>'icon' <> public.workly_trim_text(p_payload->>'icon')
      or char_length(p_payload->>'icon') not between 1 and 32 then
      raise exception 'Project icon must contain 1 to 32 characters'
        using errcode = '22023';
    end if;
    if p_payload ? 'note'
      and jsonb_typeof(p_payload->'note') not in ('string', 'null') then
      raise exception 'Project note must be text or null' using errcode = '22023';
    end if;
    if char_length(coalesce(p_payload->>'note', '')) > 5000 then
      raise exception 'Project note cannot exceed 5000 characters'
        using errcode = '22023';
    end if;
    if p_payload ? 'expectedMoney'
      and jsonb_typeof(p_payload->'expectedMoney') <> 'null' then
      if jsonb_typeof(p_payload->'expectedMoney') <> 'object'
        or coalesce(jsonb_typeof(p_payload#>'{expectedMoney,amountMinor}'), '') <> 'number'
        or p_payload#>>'{expectedMoney,currency}' not in (
          'VND', 'USD', 'EUR', 'JPY', 'GBP'
        ) then
        raise exception 'Project expected money is invalid' using errcode = '22023';
      end if;
      v_amount := (p_payload#>>'{expectedMoney,amountMinor}')::numeric;
      if v_amount < 0
        or v_amount > 9007199254740991
        or v_amount <> trunc(v_amount) then
        raise exception 'Project expected amount must be a non-negative safe integer'
          using errcode = '22023';
      end if;
    end if;

  elsif p_entity_type = 'work_session' then
    if p_payload->>'status' <> 'completed' then
      raise exception 'Only completed sessions synchronize' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(p_payload->'timezone'), '') <> 'string'
      or p_payload->>'timezone' <>
        public.workly_trim_text(p_payload->>'timezone')
      or char_length(p_payload->>'timezone') not between 1 and 120 then
      raise exception 'Session timezone must contain 1 to 120 characters'
        using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(p_payload->'activeDurationMs'), '') <> 'number' then
      raise exception 'Session duration must be numeric' using errcode = '22023';
    end if;
    v_duration := (p_payload->>'activeDurationMs')::numeric;
    if v_duration < 0
      or v_duration > 9007199254740991
      or v_duration <> trunc(v_duration) then
      raise exception 'Session duration must be a non-negative safe integer'
        using errcode = '22023';
    end if;
    if jsonb_typeof(p_payload->'earnings') <> 'object'
      or coalesce(jsonb_typeof(p_payload#>'{earnings,amountMinor}'), '') <> 'number'
      or p_payload#>>'{earnings,currency}' not in (
        'VND', 'USD', 'EUR', 'JPY', 'GBP'
      ) then
      raise exception 'Session earnings are invalid' using errcode = '22023';
    end if;
    v_amount := (p_payload#>>'{earnings,amountMinor}')::numeric;
    if v_amount < 0
      or v_amount > 9007199254740991
      or v_amount <> trunc(v_amount) then
      raise exception 'Session earnings must be a non-negative safe integer'
        using errcode = '22023';
    end if;
    if p_payload ? 'note'
      and jsonb_typeof(p_payload->'note') not in ('string', 'null') then
      raise exception 'Session note must be text or null' using errcode = '22023';
    end if;
    if char_length(coalesce(p_payload->>'note', '')) > 5000 then
      raise exception 'Session note cannot exceed 5000 characters'
        using errcode = '22023';
    end if;

  elsif p_entity_type = 'payment' then
    if jsonb_typeof(p_payload->'money') <> 'object'
      or coalesce(jsonb_typeof(p_payload#>'{money,amountMinor}'), '') <> 'number'
      or p_payload#>>'{money,currency}' not in (
        'VND', 'USD', 'EUR', 'JPY', 'GBP'
      ) then
      raise exception 'Payment money is invalid' using errcode = '22023';
    end if;
    v_amount := (p_payload#>>'{money,amountMinor}')::numeric;
    if v_amount < 0
      or v_amount > 9007199254740991
      or v_amount <> trunc(v_amount) then
      raise exception 'Payment amount must be a non-negative safe integer'
        using errcode = '22023';
    end if;
    if p_payload->>'kind' not in ('completion', 'progressive') then
      raise exception 'Unsupported payment kind' using errcode = '22023';
    end if;
    if p_payload ? 'note'
      and jsonb_typeof(p_payload->'note') not in ('string', 'null') then
      raise exception 'Payment note must be text or null' using errcode = '22023';
    end if;
    if char_length(coalesce(p_payload->>'note', '')) > 5000 then
      raise exception 'Payment note cannot exceed 5000 characters'
        using errcode = '22023';
    end if;

  elsif p_entity_type = 'goal' then
    if p_payload->>'kind' not in (
      'hours_daily',
      'hours_weekly',
      'earnings_daily',
      'earnings_weekly',
      'earnings_monthly',
      'projects_completed'
    ) then
      raise exception 'Unsupported goal kind' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(p_payload->'target'), '') <> 'number' then
      raise exception 'Goal target must be numeric' using errcode = '22023';
    end if;
    v_target := (p_payload->>'target')::numeric;
    if v_target <= 0 or v_target > 9007199254740991 then
      raise exception 'Goal target must be positive and safely representable'
        using errcode = '22023';
    end if;
    if p_payload->>'kind' in (
      'earnings_daily',
      'earnings_weekly',
      'earnings_monthly',
      'projects_completed'
    ) and v_target <> trunc(v_target) then
      raise exception 'Earnings and completed-project goals require whole-unit targets'
        using errcode = '22023';
    end if;

  elsif p_entity_type = 'preferences' then
    if p_payload ? 'theme'
      and (
        jsonb_typeof(p_payload->'theme') <> 'string'
        or p_payload->>'theme' not in ('system', 'light', 'dark')
      ) then
      raise exception 'Unsupported preference theme' using errcode = '22023';
    end if;
    if p_payload ? 'miniTimerMode'
      and (
        jsonb_typeof(p_payload->'miniTimerMode') <> 'string'
        or p_payload->>'miniTimerMode' not in (
          'interactive', 'view_only', 'hidden'
        )
      ) then
      raise exception 'Unsupported mini timer mode' using errcode = '22023';
    end if;
    if p_payload ? 'dashboardHiddenWidgets' then
      if jsonb_typeof(p_payload->'dashboardHiddenWidgets') <> 'array'
        or exists (
          select 1
          from jsonb_array_elements(
            p_payload->'dashboardHiddenWidgets'
          ) as widget(value)
          where jsonb_typeof(widget.value) <> 'string'
            or widget.value#>>'{}' not in (
              'timer',
              'goals',
              'earningsTrend',
              'hoursTrend',
              'projectBreakdown',
              'rateTrend',
              'cumulativeEarnings',
              'comparison'
            )
        )
        or (
          select count(*)
          from jsonb_array_elements_text(
            p_payload->'dashboardHiddenWidgets'
          ) as widget(value)
        ) <> (
          select count(distinct widget.value)
          from jsonb_array_elements_text(
            p_payload->'dashboardHiddenWidgets'
          ) as widget(value)
        ) then
        raise exception 'Dashboard hidden widgets are invalid'
          using errcode = '22023';
      end if;
    end if;
    if p_payload ? 'dashboardWidgetOrder' then
      if jsonb_typeof(p_payload->'dashboardWidgetOrder') <> 'array'
        or exists (
          select 1
          from jsonb_array_elements(
            p_payload->'dashboardWidgetOrder'
          ) as widget(value)
          where jsonb_typeof(widget.value) <> 'string'
            or widget.value#>>'{}' not in (
              'timer',
              'goals',
              'earningsTrend',
              'hoursTrend',
              'projectBreakdown',
              'rateTrend',
              'cumulativeEarnings',
              'comparison'
            )
        )
        or (
          select count(*)
          from jsonb_array_elements_text(
            p_payload->'dashboardWidgetOrder'
          ) as widget(value)
        ) <> (
          select count(distinct widget.value)
          from jsonb_array_elements_text(
            p_payload->'dashboardWidgetOrder'
          ) as widget(value)
        ) then
        raise exception 'Dashboard widget order is invalid'
          using errcode = '22023';
      end if;
    end if;
    if p_payload ? 'dashboardWidgetSizes' then
      if jsonb_typeof(p_payload->'dashboardWidgetSizes') <> 'object'
        or exists (
          select 1
          from jsonb_each(p_payload->'dashboardWidgetSizes') as size(key, value)
          where size.key not in (
              'timer',
              'goals',
              'earningsTrend',
              'hoursTrend',
              'projectBreakdown',
              'rateTrend',
              'cumulativeEarnings',
              'comparison'
            )
            or jsonb_typeof(size.value) <> 'string'
            or size.value#>>'{}' not in ('small', 'medium', 'large')
        ) then
        raise exception 'Dashboard widget sizes are invalid'
          using errcode = '22023';
      end if;
    end if;
  end if;
end;
$$;
revoke all on function public.workly_validate_sync_payload(text, text, jsonb)
  from public, anon, authenticated, service_role;

create function public.workly_apply_sync_operation(
  p_operation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_operation text,
  p_payload jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_operation_id is null or p_entity_id is null then
    raise exception 'Operation and entity ids are required' using errcode = '22023';
  end if;
  if p_expected_revision is null
    or p_expected_revision < 0
    or p_expected_revision > 9007199254740991 then
    raise exception 'Expected revision must be a non-negative safe integer'
      using errcode = '22023';
  end if;

  perform public.workly_validate_sync_payload(
    p_entity_type,
    p_operation,
    p_payload
  );

  insert into public.sync_change_retention(user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;
  -- Global lock order for public sync writes is user stream -> entity version
  -- -> parent project -> child row. Every writer follows this same order.
  perform retention.user_id
  from public.sync_change_retention as retention
  where retention.user_id = v_user_id
  for update;

  return public.workly_apply_sync_operation_cas_unchecked(
    p_operation_id,
    p_entity_type,
    p_entity_id,
    p_operation,
    p_payload,
    p_expected_revision
  );
end;
$$;
revoke all on function public.workly_apply_sync_operation(
  uuid,
  text,
  uuid,
  text,
  jsonb,
  bigint
) from public, anon, authenticated;
grant execute on function public.workly_apply_sync_operation(
  uuid,
  text,
  uuid,
  text,
  jsonb,
  bigint
) to authenticated;

-- Workspace claim is the other profile-ingress path. Keep its atomic insert
-- implementation, but reject (rather than truncate) invalid local display
-- names and pass canonical trimmed profile text into it.
alter function public.workly_claim_workspace(text, jsonb)
  rename to workly_claim_workspace_unchecked;
revoke all on function public.workly_claim_workspace_unchecked(text, jsonb)
  from public, anon, authenticated, service_role;
alter function public.workly_claim_workspace_unchecked(text, jsonb)
  set search_path = '';

create function public.workly_claim_workspace(
  p_workspace_id text,
  p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_country text;
  v_profile jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if coalesce(jsonb_typeof(p_profile), '') <> 'object' then
    raise exception 'Profile must be an object' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_profile->'displayName'), '') <> 'string' then
    raise exception 'Profile display name must be text' using errcode = '22023';
  end if;
  v_display_name := public.workly_trim_text(p_profile->>'displayName');
  if char_length(v_display_name) not between 1 and 100 then
    raise exception 'Profile display name must contain 1 to 100 characters'
      using errcode = '22023';
  end if;
  v_country := upper(
    public.workly_trim_text(coalesce(p_profile->>'country', ''))
  );
  if v_country !~ '^[A-Z]{2,3}$' then
    raise exception 'Profile country must be a two- or three-letter code'
      using errcode = '22023';
  end if;
  v_profile := p_profile || jsonb_build_object(
    'displayName', v_display_name,
    'country', v_country,
    'timezone', public.workly_trim_text(coalesce(p_profile->>'timezone', ''))
  );
  return public.workly_claim_workspace_unchecked(
    p_workspace_id,
    v_profile
  );
end;
$$;
revoke all on function public.workly_claim_workspace(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.workly_claim_workspace(text, jsonb)
  to authenticated;

-- Retain the proven keyset implementation privately and expose a validator
-- which rejects NULL page sizes before PostgreSQL can interpret LIMIT NULL as
-- an unbounded response.
alter function public.workly_bootstrap_page(
  text,
  uuid,
  bigint,
  integer
) rename to workly_bootstrap_page_unchecked;
revoke all on function public.workly_bootstrap_page_unchecked(
  text,
  uuid,
  bigint,
  integer
) from public, anon, authenticated, service_role;
alter function public.workly_bootstrap_page_unchecked(
  text,
  uuid,
  bigint,
  integer
) set search_path = '';

create function public.workly_bootstrap_page(
  p_after_type text default null,
  p_after_id uuid default null,
  p_snapshot_cursor bigint default null,
  p_limit integer default 250
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_page jsonb;
  v_retention_floor bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Bootstrap page size must be between 1 and 500'
      using errcode = '22023';
  end if;
  if p_snapshot_cursor is not null and (
    p_snapshot_cursor < 0
    or p_snapshot_cursor > 9007199254740991
  ) then
    raise exception 'Bootstrap snapshot cursor must be a non-negative safe integer'
      using errcode = '22023';
  end if;
  if (p_after_type is null) <> (p_after_id is null) then
    raise exception 'Bootstrap cursor type and id must be supplied together'
      using errcode = '22023';
  end if;
  if p_after_type is not null and p_after_type not in (
    'project', 'work_session', 'payment', 'goal'
  ) then
    raise exception 'Unsupported bootstrap cursor entity type'
      using errcode = '22023';
  end if;

  insert into public.sync_change_retention(user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;
  select retention.pruned_through_cursor
  into v_retention_floor
  from public.sync_change_retention as retention
  where retention.user_id = v_user_id
  for share;

  v_page := public.workly_bootstrap_page_unchecked(
    p_after_type,
    p_after_id,
    p_snapshot_cursor,
    p_limit
  );
  -- If every historical change was pruned, max(sync_changes.cursor) is zero.
  -- Pin the snapshot at least to the retained watermark so its first pull does
  -- not immediately look stale or loop through another full bootstrap.
  return jsonb_set(
    v_page,
    '{cursor}',
    to_jsonb(greatest(
      coalesce((v_page->>'cursor')::bigint, 0),
      v_retention_floor
    ))
  );
end;
$$;
revoke all on function public.workly_bootstrap_page(
  text,
  uuid,
  bigint,
  integer
) from public, anon, authenticated;
grant execute on function public.workly_bootstrap_page(
  text,
  uuid,
  bigint,
  integer
) to authenticated;

alter function public.workly_bootstrap_page_v2(
  text,
  uuid,
  bigint,
  integer
) set search_path = '';
alter function public.workly_get_entity_revisions(jsonb) set search_path = '';
revoke all on function public.workly_bootstrap_page_v2(
  text,
  uuid,
  bigint,
  integer
) from public, anon, authenticated;
grant execute on function public.workly_bootstrap_page_v2(
  text,
  uuid,
  bigint,
  integer
) to authenticated;
revoke all on function public.workly_get_entity_revisions(jsonb)
  from public, anon, authenticated;
grant execute on function public.workly_get_entity_revisions(jsonb)
  to authenticated;

-- Cloud rows are consumed by JavaScript and SQLite, so monetary and duration
-- integers must remain exactly representable. Text bounds mirror the desktop
-- normalizer and stop a directly-called RPC from creating cache-poisoning rows.
alter table public.profiles
  add constraint profiles_workspace_id_length_check
    check (
      workspace_id is null
      or char_length(public.workly_trim_text(workspace_id)) between 1 and 200
    ),
  add constraint profiles_display_name_length_check
    check (
      display_name = public.workly_trim_text(display_name)
      and char_length(display_name) between 1 and 100
    ),
  add constraint profiles_country_format_check
    check (
      country = public.workly_trim_text(country)
      and country ~ '^[A-Za-z]{2,3}$'
    ),
  add constraint profiles_timezone_length_check
    check (
      timezone = public.workly_trim_text(timezone)
      and char_length(timezone) between 1 and 120
    ),
  add constraint profiles_dashboard_layout_object_check
    check (jsonb_typeof(dashboard_layout) = 'object'),
  add constraint profiles_revision_range_check
    check (
      remote_revision between 0 and 9007199254740991
      and preferences_revision between 0 and 9007199254740991
    );

alter table public.projects
  add constraint projects_text_bounds_check
    check (
      name = public.workly_trim_text(name)
      and char_length(name) between 1 and 160
      and color = public.workly_trim_text(color)
      and char_length(color) between 1 and 64
      and icon = public.workly_trim_text(icon)
      and char_length(icon) between 1 and 32
      and (note is null or char_length(note) <= 5000)
    ),
  add constraint projects_expected_money_shape_check
    check (
      (expected_amount_minor is null and expected_currency is null)
      or (
        expected_amount_minor between 0 and 9007199254740991
        and expected_currency is not null
      )
    ),
  add constraint projects_completion_timestamp_check
    check (status <> 'completed' or completed_at is not null),
  add constraint projects_revision_range_check
    check (remote_revision between 0 and 9007199254740991);

alter table public.work_sessions
  add constraint work_sessions_text_bounds_check
    check (
      timezone = public.workly_trim_text(timezone)
      and char_length(timezone) between 1 and 120
      and (note is null or char_length(note) <= 5000)
    ),
  add constraint work_sessions_safe_integer_check
    check (
      (active_duration_ms is null or active_duration_ms <= 9007199254740991)
      and (
        earnings_amount_minor is null
        or earnings_amount_minor <= 9007199254740991
      )
      and remote_revision between 0 and 9007199254740991
    ),
  add constraint work_sessions_completed_shape_check
    check (
      (
        status = 'completed'
        and ended_at is not null
        and active_duration_ms is not null
        and earnings_amount_minor is not null
        and earnings_currency is not null
      )
      or (
        status <> 'completed'
        and ended_at is null
        and active_duration_ms is null
        and earnings_amount_minor is null
        and earnings_currency is null
      )
    );

alter table public.payments
  add constraint payments_safe_amount_check
    check (amount_minor between 0 and 9007199254740991),
  add constraint payments_note_length_check
    check (note is null or char_length(note) <= 5000),
  add constraint payments_revision_range_check
    check (remote_revision between 0 and 9007199254740991);

alter table public.goals
  add constraint goals_safe_target_check
    check (
      target <= 9007199254740991
      and (
        kind in ('hours_daily', 'hours_weekly')
        or target = trunc(target)
      )
    ),
  add constraint goals_revision_range_check
    check (remote_revision between 0 and 9007199254740991);

alter table public.sync_operations
  add constraint sync_operations_entity_type_check
    check (entity_type in (
      'account', 'project', 'work_session', 'payment', 'goal', 'preferences'
    )),
  add constraint sync_operations_result_object_check
    check (jsonb_typeof(result) = 'object');

alter table public.sync_changes
  add constraint sync_changes_entity_type_check
    check (entity_type in (
      'account', 'project', 'work_session', 'payment', 'goal', 'preferences'
    )),
  add constraint sync_changes_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  add constraint sync_changes_safe_cursor_check
    check (cursor between 0 and 9007199254740991);

alter table public.sync_entity_versions
  add constraint sync_entity_versions_safe_revision_check
    check (remote_revision <= 9007199254740991);

-- Match the actual read paths: latest completed-session validation, completed
-- session bootstrap, and conflict payload lookup.
create index if not exists work_sessions_user_latest_completed_idx
  on public.work_sessions(user_id, ended_at desc, id desc)
  where status = 'completed';
create index if not exists work_sessions_user_bootstrap_completed_idx
  on public.work_sessions(user_id, id)
  where status = 'completed';
create index if not exists sync_changes_entity_latest_idx
  on public.sync_changes(user_id, entity_type, entity_id, cursor desc);

-- Cache auth.uid() once per statement and scope every policy to the only role
-- that can legitimately reach the owner-select surface.
drop policy if exists "profiles owned by current user" on public.profiles;
create policy "profiles owned by current user"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));
drop policy if exists "projects owned by current user" on public.projects;
create policy "projects owned by current user"
  on public.projects for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "sessions owned by current user" on public.work_sessions;
create policy "sessions owned by current user"
  on public.work_sessions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "pauses owned by current user" on public.session_pauses;
create policy "pauses owned by current user"
  on public.session_pauses for select to authenticated
  using (
    exists (
      select 1
      from public.work_sessions as session
      where session.id = session_pauses.session_id
        and session.user_id = (select auth.uid())
    )
  );
drop policy if exists "payments owned by current user" on public.payments;
create policy "payments owned by current user"
  on public.payments for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "goals owned by current user" on public.goals;
create policy "goals owned by current user"
  on public.goals for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "operations owned by current user" on public.sync_operations;
create policy "operations owned by current user"
  on public.sync_operations for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "changes owned by current user" on public.sync_changes;
create policy "changes owned by current user"
  on public.sync_changes for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "leases owned by current user" on public.timer_leases;
create policy "leases owned by current user"
  on public.timer_leases for select to authenticated
  using (user_id = (select auth.uid()));

-- The watermark is a durable promise: every user change at or below it was
-- deliberately removed. A stale device must bootstrap; returning a partial
-- feed would silently corrupt its cache.
create function public.workly_prune_sync_changes(
  p_user_id uuid,
  p_through_cursor bigint,
  p_created_before timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_floor bigint;
  v_first_retained_cursor bigint;
  v_delete_through bigint;
  v_highest_deleted bigint;
  v_deleted_rows bigint;
  v_next_floor bigint;
begin
  if p_user_id is null then
    raise exception 'A retention user is required' using errcode = '22023';
  end if;
  if p_through_cursor is null
    or p_through_cursor < 0
    or p_through_cursor > 9007199254740991 then
    raise exception 'Retention cursor must be a non-negative safe integer'
      using errcode = '22023';
  end if;
  if p_created_before is null
    or p_created_before > statement_timestamp() - interval '90 days' then
    raise exception 'Retention cutoff must be at least 90 days old'
      using errcode = '22023';
  end if;

  insert into public.sync_change_retention(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select retention.pruned_through_cursor
  into v_previous_floor
  from public.sync_change_retention as retention
  where retention.user_id = p_user_id
  for update;

  -- Cursor allocation and commit order could differ for rows written before
  -- this migration introduced the per-user mutex. Never delete past a younger
  -- row: the watermark must describe a contiguous prefix of this user's log.
  select min(change.cursor)
  into v_first_retained_cursor
  from public.sync_changes as change
  where change.user_id = p_user_id
    and change.cursor <= p_through_cursor
    and change.created_at >= p_created_before;
  v_delete_through := least(
    p_through_cursor,
    coalesce(v_first_retained_cursor - 1, p_through_cursor)
  );

  with deleted as (
    delete from public.sync_changes as change
    where change.user_id = p_user_id
      and change.cursor <= v_delete_through
      and change.created_at < p_created_before
    returning change.cursor
  )
  select count(*), max(deleted.cursor)
  into v_deleted_rows, v_highest_deleted
  from deleted;

  v_next_floor := greatest(
    v_previous_floor,
    coalesce(v_highest_deleted, v_previous_floor)
  );
  update public.sync_change_retention
  set pruned_through_cursor = v_next_floor,
      last_pruned_at = case
        when v_deleted_rows > 0 then statement_timestamp()
        else last_pruned_at
      end,
      updated_at = statement_timestamp()
  where user_id = p_user_id;

  return jsonb_build_object(
    'userId', p_user_id,
    'deletedRows', v_deleted_rows,
    'eligibleThroughCursor', v_delete_through,
    'prunedThroughCursor', v_next_floor,
    'createdBefore', p_created_before
  );
end;
$$;
revoke all on function public.workly_prune_sync_changes(
  uuid,
  bigint,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.workly_prune_sync_changes(
  uuid,
  bigint,
  timestamptz
) to service_role;

create or replace function public.workly_pull_changes(
  p_cursor bigint default 0,
  p_limit integer default 100
)
returns table(
  cursor bigint,
  entity_type text,
  entity_id uuid,
  operation text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer;
  v_retention_floor bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_cursor is null
    or p_cursor < 0
    or p_cursor > 9007199254740991 then
    raise exception 'Pull cursor must be a non-negative safe integer'
      using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'Pull limit must be a positive integer'
      using errcode = '22023';
  end if;
  v_limit := least(p_limit, 500);

  insert into public.sync_change_retention(user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;
  select retention.pruned_through_cursor
  into v_retention_floor
  from public.sync_change_retention as retention
  where retention.user_id = v_user_id
  for share;

  if p_cursor < v_retention_floor then
    raise exception 'Change cursor expired; full bootstrap required'
      using
        errcode = 'P0001',
        detail = format(
          'Requested cursor %s is behind retained cursor %s.',
          p_cursor,
          v_retention_floor
        ),
        hint = 'Rebuild the local cache with workly_bootstrap_page_v2.';
  end if;

  return query
  select
    change.cursor,
    change.entity_type,
    change.entity_id,
    change.operation,
    change.payload,
    change.created_at
  from public.sync_changes as change
  where change.user_id = v_user_id
    and change.cursor > p_cursor
  order by change.cursor asc
  limit v_limit;
end;
$$;
revoke all on table public.sync_changes from public, anon, authenticated;
revoke all on function public.workly_pull_changes(bigint, integer)
  from public, anon, authenticated;
grant execute on function public.workly_pull_changes(bigint, integer)
  to authenticated;

commit;
