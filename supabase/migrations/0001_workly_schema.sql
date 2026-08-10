-- TimeFarm cloud schema. Legacy workly_* SQL identifiers are retained for
-- compatibility with the desktop sync client. Run with the Supabase CLI or SQL editor before enabling
-- WORKLY_SUPABASE_URL / WORKLY_SUPABASE_ANON_KEY in the desktop application.
-- The RPC below derives ownership from auth.uid(); it never trusts a user id
-- carried inside a desktop sync payload.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  country text not null check (char_length(country) between 2 and 8),
  language text not null check (language in ('vi', 'en')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timezone text not null,
  dashboard_layout jsonb not null default '{}'::jsonb,
  remote_revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  payment_model text not null check (payment_model in ('per_session', 'on_completion', 'progressive')),
  expected_amount_minor bigint check (expected_amount_minor >= 0),
  expected_currency text check (expected_currency is null or expected_currency ~ '^[A-Z]{3}$'),
  note text,
  color text not null,
  icon text not null,
  status text not null check (status in ('active', 'paused', 'completed')),
  completed_at timestamptz,
  remote_revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_updated_idx on public.projects(user_id, updated_at desc);

create table if not exists public.work_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  timezone text not null,
  active_duration_ms bigint check (active_duration_ms is null or active_duration_ms >= 0),
  status text not null check (status in ('running', 'paused', 'completed')),
  earnings_amount_minor bigint check (earnings_amount_minor is null or earnings_amount_minor >= 0),
  earnings_currency text check (earnings_currency is null or earnings_currency ~ '^[A-Z]{3}$'),
  note text,
  remote_revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status <> 'completed') or (ended_at is not null and active_duration_ms is not null and earnings_amount_minor is not null and earnings_currency is not null)),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists sessions_user_ended_idx on public.work_sessions(user_id, ended_at desc nulls last);

create table if not exists public.session_pauses (
  session_id uuid not null references public.work_sessions(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  started_at timestamptz not null,
  ended_at timestamptz,
  primary key (session_id, ordinal),
  check (ended_at is null or ended_at >= started_at)
);

create table if not exists public.payments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  received_at timestamptz not null,
  kind text not null check (kind in ('completion', 'progressive')),
  note text,
  remote_revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_user_received_idx on public.payments(user_id, received_at desc);

create table if not exists public.goals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('hours_daily', 'hours_weekly', 'earnings_daily', 'earnings_weekly', 'earnings_monthly', 'projects_completed')),
  target numeric not null check (target > 0),
  remote_revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('upsert', 'delete')),
  result jsonb not null,
  applied_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

create table if not exists public.sync_changes (
  cursor bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('upsert', 'delete')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists sync_changes_user_cursor_idx on public.sync_changes(user_id, cursor);

create table if not exists public.fx_rate_cache (
  provider text not null,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric not null check (rate > 0),
  observed_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  primary key (provider, base_currency, quote_currency)
);

create table if not exists public.timer_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_id uuid not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.work_sessions enable row level security;
alter table public.session_pauses enable row level security;
alter table public.payments enable row level security;
alter table public.goals enable row level security;
alter table public.sync_operations enable row level security;
alter table public.sync_changes enable row level security;
alter table public.timer_leases enable row level security;

create policy "profiles owned by current user" on public.profiles for select using (id = auth.uid());
create policy "projects owned by current user" on public.projects for select using (user_id = auth.uid());
create policy "sessions owned by current user" on public.work_sessions for select using (user_id = auth.uid());
create policy "pauses owned by current user" on public.session_pauses for select using (exists (select 1 from public.work_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "payments owned by current user" on public.payments for select using (user_id = auth.uid());
create policy "goals owned by current user" on public.goals for select using (user_id = auth.uid());
create policy "operations owned by current user" on public.sync_operations for select using (user_id = auth.uid());
create policy "changes owned by current user" on public.sync_changes for select using (user_id = auth.uid());
create policy "leases owned by current user" on public.timer_leases for select using (user_id = auth.uid());

create or replace function public.workly_apply_sync_operation(
  p_operation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_operation text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if coalesce(jsonb_typeof(p_payload), '') <> 'object' then
    raise exception 'Sync payload must be an object';
  end if;
  if p_operation not in ('upsert', 'delete') then
    raise exception 'Unsupported operation';
  end if;
  -- The operation id is the server-side authority for a fact.  Reject a
  -- contradictory client payload instead of allowing a change feed entry
  -- whose entity id and body point at different records.  Account/profile
  -- and preferences are intentionally excluded: their durable server key is
  -- auth.uid(), while a local device may use a different local account id.
  if p_entity_type in ('project', 'work_session', 'payment', 'goal')
    and coalesce(p_payload->>'id', '') <> p_entity_id::text then
    raise exception 'Sync payload id does not match entity id';
  end if;
  select result into v_existing from public.sync_operations where user_id = v_user_id and operation_id = p_operation_id;
  if found then return v_existing; end if;

  if p_entity_type = 'account' then
    if p_operation <> 'upsert' then raise exception 'Profiles cannot be deleted through sync'; end if;
    insert into public.profiles (id, display_name, country, language, currency, timezone)
    values (v_user_id, coalesce(p_payload->>'displayName', ''), p_payload->>'country', p_payload->>'language', p_payload->>'currency', p_payload->>'timezone')
    on conflict (id) do update set display_name = excluded.display_name, language = excluded.language, timezone = excluded.timezone,
      updated_at = now(), remote_revision = public.profiles.remote_revision + 1;

  elsif p_entity_type = 'project' then
    if exists (select 1 from public.projects where id = p_entity_id and user_id <> v_user_id) then raise exception 'Project ownership conflict'; end if;
    if p_operation = 'delete' then
      if exists (select 1 from public.work_sessions where project_id = p_entity_id and user_id = v_user_id)
        or exists (select 1 from public.payments where project_id = p_entity_id and user_id = v_user_id) then
        raise exception 'Projects with work or payment history cannot be deleted';
      end if;
      delete from public.projects where id = p_entity_id and user_id = v_user_id;
    else
      insert into public.projects (id, user_id, name, payment_model, expected_amount_minor, expected_currency, note, color, icon, status, completed_at, created_at, updated_at)
      values (p_entity_id, v_user_id, p_payload->>'name', p_payload->>'paymentModel', nullif(p_payload#>>'{expectedMoney,amountMinor}', '')::bigint,
        nullif(p_payload#>>'{expectedMoney,currency}', ''), nullif(p_payload->>'note', ''), p_payload->>'color', p_payload->>'icon', p_payload->>'status', nullif(p_payload->>'completedAt', '')::timestamptz,
        coalesce(nullif(p_payload->>'createdAt', '')::timestamptz, now()), coalesce(nullif(p_payload->>'updatedAt', '')::timestamptz, now()))
      on conflict (id) do update set name = excluded.name, payment_model = excluded.payment_model, expected_amount_minor = excluded.expected_amount_minor,
        expected_currency = excluded.expected_currency, note = excluded.note, color = excluded.color, icon = excluded.icon, status = excluded.status, completed_at = excluded.completed_at,
        updated_at = excluded.updated_at, remote_revision = public.projects.remote_revision + 1 where public.projects.user_id = v_user_id;
    end if;

  elsif p_entity_type = 'work_session' then
    if exists (select 1 from public.work_sessions where id = p_entity_id and user_id <> v_user_id) then raise exception 'Session ownership conflict'; end if;
    if p_operation = 'delete' then
      -- Completed work sessions are financial history. Local state never
      -- queues their deletion, and the cloud authority must enforce the same
      -- invariant even if a compromised client calls this RPC directly.
      raise exception 'Completed work-session history cannot be deleted';
    else
      if p_payload->>'status' <> 'completed' then raise exception 'Only completed sessions synchronize'; end if;
      -- An existing completed session may only be amended while it remains
      -- the most recently completed session for this account. This mirrors
      -- interrupted-session recovery in the offline database and stops a
      -- delayed device from silently rewriting older historical facts.
      if exists (select 1 from public.work_sessions where id = p_entity_id and user_id = v_user_id)
        and p_entity_id <> (
          select id from public.work_sessions
          where user_id = v_user_id and status = 'completed'
          order by ended_at desc, id desc
          limit 1
        ) then
        raise exception 'Only the latest completed session may be edited';
      end if;
      if (p_payload->>'projectId') is not null and not exists (select 1 from public.projects where id = (p_payload->>'projectId')::uuid and user_id = v_user_id) then
        raise exception 'Session project is not owned';
      end if;
      if (p_payload->>'projectId') is not null and not exists (select 1 from public.work_sessions where id = p_entity_id and user_id = v_user_id)
        and exists (select 1 from public.projects where id = (p_payload->>'projectId')::uuid and user_id = v_user_id and status = 'completed') then
        raise exception 'Completed projects cannot receive a new session';
      end if;
      insert into public.work_sessions (id, user_id, project_id, started_at, ended_at, timezone, active_duration_ms, status, earnings_amount_minor, earnings_currency, note, created_at, updated_at)
      values (p_entity_id, v_user_id, nullif(p_payload->>'projectId', '')::uuid, (p_payload->>'startedAt')::timestamptz, (p_payload->>'endedAt')::timestamptz,
        p_payload->>'timezone', (p_payload->>'activeDurationMs')::bigint, 'completed', (p_payload#>>'{earnings,amountMinor}')::bigint,
        p_payload#>>'{earnings,currency}', nullif(p_payload->>'note', ''), coalesce(nullif(p_payload->>'createdAt', '')::timestamptz, now()), coalesce(nullif(p_payload->>'updatedAt', '')::timestamptz, now()))
      on conflict (id) do update set project_id = excluded.project_id, started_at = excluded.started_at, ended_at = excluded.ended_at, timezone = excluded.timezone,
        active_duration_ms = excluded.active_duration_ms, earnings_amount_minor = excluded.earnings_amount_minor, earnings_currency = excluded.earnings_currency,
        note = excluded.note, updated_at = excluded.updated_at, remote_revision = public.work_sessions.remote_revision + 1 where public.work_sessions.user_id = v_user_id;
      delete from public.session_pauses where session_id = p_entity_id;
      insert into public.session_pauses (session_id, ordinal, started_at, ended_at)
      select p_entity_id, elements.ordinality - 1, (elements.item->>'startedAt')::timestamptz, nullif(elements.item->>'endedAt', '')::timestamptz
      from jsonb_array_elements(coalesce(p_payload->'pauses', '[]'::jsonb)) with ordinality as elements(item, ordinality);
    end if;

  elsif p_entity_type = 'payment' then
    if exists (select 1 from public.payments where id = p_entity_id and user_id <> v_user_id) then raise exception 'Payment ownership conflict'; end if;
    if p_operation = 'delete' then
      delete from public.payments where id = p_entity_id and user_id = v_user_id;
    else
      if not exists (select 1 from public.projects where id = (p_payload->>'projectId')::uuid and user_id = v_user_id) then raise exception 'Payment project is not owned'; end if;
      insert into public.payments (id, user_id, project_id, amount_minor, currency, received_at, kind, note, created_at)
      values (p_entity_id, v_user_id, (p_payload->>'projectId')::uuid, (p_payload#>>'{money,amountMinor}')::bigint, p_payload#>>'{money,currency}',
        (p_payload->>'receivedAt')::timestamptz, p_payload->>'kind', nullif(p_payload->>'note', ''), coalesce(nullif(p_payload->>'createdAt', '')::timestamptz, now()))
      on conflict (id) do update set project_id = excluded.project_id, amount_minor = excluded.amount_minor, currency = excluded.currency,
        received_at = excluded.received_at, kind = excluded.kind, note = excluded.note, updated_at = now(), remote_revision = public.payments.remote_revision + 1 where public.payments.user_id = v_user_id;
    end if;

  elsif p_entity_type = 'goal' then
    if exists (select 1 from public.goals where id = p_entity_id and user_id <> v_user_id) then raise exception 'Goal ownership conflict'; end if;
    if p_operation = 'delete' then
      delete from public.goals where id = p_entity_id and user_id = v_user_id;
    else
      insert into public.goals (id, user_id, kind, target, created_at)
      values (p_entity_id, v_user_id, p_payload->>'kind', (p_payload->>'target')::numeric, coalesce(nullif(p_payload->>'createdAt', '')::timestamptz, now()))
      on conflict (id) do update set kind = excluded.kind, target = excluded.target, updated_at = now(), remote_revision = public.goals.remote_revision + 1 where public.goals.user_id = v_user_id;
    end if;

  elsif p_entity_type = 'preferences' then
    if p_operation <> 'upsert' then raise exception 'Preferences cannot be deleted through sync'; end if;
    update public.profiles set dashboard_layout = jsonb_build_object(
      'hiddenWidgets', coalesce(p_payload->'dashboardHiddenWidgets', '[]'::jsonb),
      'widgetOrder', coalesce(p_payload->'dashboardWidgetOrder', '[]'::jsonb),
      'widgetSizes', coalesce(p_payload->'dashboardWidgetSizes', '{}'::jsonb),
      'miniTimerMode', coalesce(p_payload->>'miniTimerMode', 'hidden'),
      'theme', coalesce(p_payload->>'theme', 'system')
    ), updated_at = now(), remote_revision = remote_revision + 1 where id = v_user_id;
  else
    raise exception 'Unsupported entity type';
  end if;

  v_result := jsonb_build_object('operationId', p_operation_id, 'entityType', p_entity_type, 'entityId', p_entity_id, 'operation', p_operation);
  insert into public.sync_changes (user_id, entity_type, entity_id, operation, payload) values (v_user_id, p_entity_type, p_entity_id, p_operation, p_payload);
  insert into public.sync_operations (user_id, operation_id, entity_type, entity_id, operation, result) values (v_user_id, p_operation_id, p_entity_type, p_entity_id, p_operation, v_result);
  return v_result;
end;
$$;

create or replace function public.workly_pull_changes(p_cursor bigint default 0, p_limit integer default 100)
returns table(cursor bigint, entity_type text, entity_id uuid, operation text, payload jsonb, created_at timestamptz)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select c.cursor, c.entity_type, c.entity_id, c.operation, c.payload, c.created_at
  from public.sync_changes c
  where c.user_id = auth.uid() and c.cursor > p_cursor
  order by c.cursor asc
  limit greatest(1, least(p_limit, 500));
$$;

create or replace function public.workly_acquire_timer_lease(p_device_id uuid, p_seconds integer default 45)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  insert into public.timer_leases (user_id, device_id, lease_expires_at)
  values (v_user_id, p_device_id, now() + make_interval(secs => greatest(15, least(p_seconds, 120))))
  on conflict (user_id) do update set device_id = excluded.device_id, lease_expires_at = excluded.lease_expires_at, updated_at = now()
    where public.timer_leases.lease_expires_at < now() or public.timer_leases.device_id = excluded.device_id;
  return exists (select 1 from public.timer_leases where user_id = v_user_id and device_id = p_device_id and lease_expires_at > now());
end;
$$;

-- PostgreSQL grants EXECUTE on newly created functions to PUBLIC by default.
-- Keep the security-definer RPCs callable only by authenticated Supabase
-- users; anonymous callers must never be able to invoke them directly.
revoke all on function public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb) from public;
revoke all on function public.workly_pull_changes(bigint, integer) from public;
revoke all on function public.workly_acquire_timer_lease(uuid, integer) from public;
grant execute on function public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb) to authenticated;
grant execute on function public.workly_pull_changes(bigint, integer) to authenticated;
grant execute on function public.workly_acquire_timer_lease(uuid, integer) to authenticated;
