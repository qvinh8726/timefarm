-- New-device bootstrap and canonical cloud change payloads.
--
-- 0001 intentionally let a desktop account keep its own local id.  That is
-- useful while working offline, but it means an account change must never use
-- that local id or the client-provided account body as cloud authority.  This
-- migration makes the profile stream server-canonical and provides one
-- authenticated, self-scoped snapshot RPC for a device that has no local
-- account yet.

-- Keep the dashboard layout stored in profiles compact and tolerant of older
-- payloads, while returning only values understood by the desktop model.  It
-- is deliberately not callable by clients; it is an implementation detail of
-- the two RPCs below.
create or replace function public.workly_canonical_preferences(p_layout jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  with layout as (
    select coalesce(p_layout, '{}'::jsonb) as value
  ),
  hidden as (
    select coalesce(jsonb_agg(valid.value order by valid.ordinality), '[]'::jsonb) as value
    from (
      select item.value, min(item.ordinality) as ordinality
      from layout,
        jsonb_array_elements_text(
          case when jsonb_typeof(layout.value -> 'hiddenWidgets') = 'array'
            then layout.value -> 'hiddenWidgets'
            else '[]'::jsonb
          end
        ) with ordinality as item(value, ordinality)
      where item.value in ('timer', 'goals', 'earningsTrend', 'hoursTrend', 'projectBreakdown', 'rateTrend', 'cumulativeEarnings', 'comparison')
      group by item.value
    ) valid
  ),
  widget_order as (
    select coalesce(jsonb_agg(valid.value order by valid.ordinality), '[]'::jsonb) as value
    from (
      select item.value, min(item.ordinality) as ordinality
      from layout,
        jsonb_array_elements_text(
          case when jsonb_typeof(layout.value -> 'widgetOrder') = 'array'
            then layout.value -> 'widgetOrder'
            else '[]'::jsonb
          end
        ) with ordinality as item(value, ordinality)
      where item.value in ('timer', 'goals', 'earningsTrend', 'hoursTrend', 'projectBreakdown', 'rateTrend', 'cumulativeEarnings', 'comparison')
      group by item.value
    ) valid
  ),
  widget_sizes as (
    select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb) as value
    from layout,
      jsonb_each_text(
        case when jsonb_typeof(layout.value -> 'widgetSizes') = 'object'
          then layout.value -> 'widgetSizes'
          else '{}'::jsonb
        end
      ) as item(key, value)
    where item.key in ('timer', 'goals', 'earningsTrend', 'hoursTrend', 'projectBreakdown', 'rateTrend', 'cumulativeEarnings', 'comparison')
      and item.value in ('small', 'medium', 'large')
  )
  select jsonb_build_object(
    'theme', case when layout.value ->> 'theme' in ('system', 'light', 'dark') then layout.value ->> 'theme' else 'system' end,
    'miniTimerMode', case when layout.value ->> 'miniTimerMode' in ('interactive', 'view_only', 'hidden') then layout.value ->> 'miniTimerMode' else 'hidden' end,
    'dashboardHiddenWidgets', hidden.value,
    'dashboardWidgetOrder', widget_order.value,
    'dashboardWidgetSizes', widget_sizes.value
  )
  from layout, hidden, widget_order, widget_sizes;
$$;

-- Re-declare the sync writer so account/profile and preference change-feed
-- rows are the values actually persisted by the server, never a potentially
-- contradictory local request body.  Other entity paths retain the 0001
-- validation and history protections unchanged.
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
  v_profile public.profiles%rowtype;
  v_preferences jsonb;
  v_layout jsonb;
  v_change_entity_id uuid := p_entity_id;
  v_change_payload jsonb := p_payload;
  v_session_started_at timestamptz;
  v_session_ended_at timestamptz;
  v_active_duration_ms bigint;
  v_paused_duration_ms bigint;
  v_expected_active_duration_ms bigint;
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
  if p_entity_type in ('project', 'work_session', 'payment', 'goal')
    and coalesce(p_payload->>'id', '') <> p_entity_id::text then
    raise exception 'Sync payload id does not match entity id';
  end if;
  select result into v_existing from public.sync_operations where user_id = v_user_id and operation_id = p_operation_id;
  if found then return v_existing; end if;

  -- A profile is the cloud account's root record.  Never accept business
  -- data before it exists: otherwise an account-operation retry could leave
  -- orphaned projects/sessions that a fresh-device snapshot cannot safely
  -- identify or restore.  The client orders profile work first as a second
  -- line of defence, but direct RPC callers must receive the same invariant.
  if p_entity_type in ('project', 'work_session', 'payment', 'goal', 'preferences')
    and not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'Profile must exist before synchronized data can be updated';
  end if;

  if p_entity_type = 'account' then
    if p_operation <> 'upsert' then raise exception 'Profiles cannot be deleted through sync'; end if;
    insert into public.profiles (id, display_name, country, language, currency, timezone)
    values (v_user_id, coalesce(p_payload->>'displayName', ''), p_payload->>'country', p_payload->>'language', p_payload->>'currency', p_payload->>'timezone')
    on conflict (id) do update set display_name = excluded.display_name, language = excluded.language, timezone = excluded.timezone,
      updated_at = now(), remote_revision = public.profiles.remote_revision + 1
    returning * into v_profile;

    -- Country and currency are initialization facts in the current product.
    -- The upsert above intentionally does not overwrite them.  Publishing the
    -- row re-read by RETURNING makes that decision explicit to every device.
    v_change_entity_id := v_user_id;
    v_change_payload := jsonb_build_object(
      'id', v_profile.id,
      'authUserId', v_profile.id,
      'displayName', v_profile.display_name,
      'country', v_profile.country,
      'language', v_profile.language,
      'currency', v_profile.currency,
      'timezone', v_profile.timezone,
      'createdAt', v_profile.created_at
    );

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
      raise exception 'Completed work-session history cannot be deleted';
    else
      if p_payload->>'status' <> 'completed' then raise exception 'Only completed sessions synchronize'; end if;
      -- The local database validates the same invariants, but this RPC is the
      -- cloud authority and must not trust a directly-called client payload.
      if jsonb_typeof(coalesce(p_payload->'pauses', '[]'::jsonb)) <> 'array' then
        raise exception 'Session pauses must be an array';
      end if;
      v_session_started_at := (p_payload->>'startedAt')::timestamptz;
      v_session_ended_at := (p_payload->>'endedAt')::timestamptz;
      v_active_duration_ms := (p_payload->>'activeDurationMs')::bigint;
      if v_session_ended_at < v_session_started_at then raise exception 'Session ends before it starts'; end if;
      if v_active_duration_ms < 0 then raise exception 'Session duration cannot be negative'; end if;
      if exists (
        select 1
        from jsonb_array_elements(coalesce(p_payload->'pauses', '[]'::jsonb)) with ordinality as pause(item, ordinal)
        where jsonb_typeof(pause.item) <> 'object'
          or nullif(pause.item->>'startedAt', '') is null
          or nullif(pause.item->>'endedAt', '') is null
          or (pause.item->>'startedAt')::timestamptz < v_session_started_at
          or (pause.item->>'endedAt')::timestamptz < (pause.item->>'startedAt')::timestamptz
          or (pause.item->>'endedAt')::timestamptz > v_session_ended_at
      ) then
        raise exception 'Session pauses are outside the completed session bounds';
      end if;
      if exists (
        with pauses as (
          select pause.ordinal,
            (pause.item->>'startedAt')::timestamptz as started_at,
            (pause.item->>'endedAt')::timestamptz as ended_at
          from jsonb_array_elements(coalesce(p_payload->'pauses', '[]'::jsonb)) with ordinality as pause(item, ordinal)
        ), ordered as (
          select started_at, lag(ended_at) over (order by ordinal) as previous_ended_at
          from pauses
        )
        select 1 from ordered where previous_ended_at is not null and started_at < previous_ended_at
      ) then
        raise exception 'Session pauses overlap or are out of order';
      end if;
      select coalesce(sum(round(extract(epoch from ((pause.item->>'endedAt')::timestamptz - (pause.item->>'startedAt')::timestamptz)) * 1000)::bigint), 0)
        into v_paused_duration_ms
      from jsonb_array_elements(coalesce(p_payload->'pauses', '[]'::jsonb)) as pause(item);
      v_expected_active_duration_ms := greatest(0, round(extract(epoch from (v_session_ended_at - v_session_started_at)) * 1000)::bigint - v_paused_duration_ms);
      if v_active_duration_ms <> v_expected_active_duration_ms then
        raise exception 'Session duration does not match timestamps and pauses';
      end if;
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
    -- A preference row has no standalone cloud identity.  Requiring the
    -- profile first prevents a client from creating an orphaned layout whose
    -- ownership was never established through account initialization.
    select * into v_profile from public.profiles where id = v_user_id for update;
    if not found then raise exception 'Profile must exist before preferences can be updated'; end if;
    v_preferences := public.workly_canonical_preferences(jsonb_build_object(
      'theme', p_payload->'theme',
      'miniTimerMode', p_payload->'miniTimerMode',
      'hiddenWidgets', p_payload->'dashboardHiddenWidgets',
      'widgetOrder', p_payload->'dashboardWidgetOrder',
      'widgetSizes', p_payload->'dashboardWidgetSizes'
    ));
    v_layout := jsonb_build_object(
      'hiddenWidgets', v_preferences->'dashboardHiddenWidgets',
      'widgetOrder', v_preferences->'dashboardWidgetOrder',
      'widgetSizes', v_preferences->'dashboardWidgetSizes',
      'miniTimerMode', v_preferences->'miniTimerMode',
      'theme', v_preferences->'theme'
    );
    update public.profiles set dashboard_layout = v_layout, updated_at = now(), remote_revision = remote_revision + 1
      where id = v_user_id;
    v_change_entity_id := v_user_id;
    v_change_payload := v_preferences;
  else
    raise exception 'Unsupported entity type';
  end if;

  v_result := jsonb_build_object('operationId', p_operation_id, 'entityType', p_entity_type, 'entityId', v_change_entity_id, 'operation', p_operation);
  insert into public.sync_changes (user_id, entity_type, entity_id, operation, payload)
    values (v_user_id, p_entity_type, v_change_entity_id, p_operation, v_change_payload);
  insert into public.sync_operations (user_id, operation_id, entity_type, entity_id, operation, result)
    values (v_user_id, p_operation_id, p_entity_type, v_change_entity_id, p_operation, v_result);
  return v_result;
end;
$$;

-- The cursor is captured before any content read.  A concurrent committed
-- write can therefore appear in this snapshot and be harmlessly replayed by
-- the next pull, but no snapshot row can be skipped by advancing past it.
create or replace function public.workly_bootstrap_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_cursor bigint := 0;
  v_profile public.profiles%rowtype;
  v_preferences jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select coalesce(max(c.cursor), 0)::bigint into v_cursor
  from public.sync_changes c
  where c.user_id = v_user_id;

  select * into v_profile
  from public.profiles p
  where p.id = v_user_id;

  if not found then
    return jsonb_build_object(
      'version', 1,
      'found', false,
      'cursor', v_cursor,
      'profile', 'null'::jsonb,
      'preferences', 'null'::jsonb,
      'projects', '[]'::jsonb,
      'sessions', '[]'::jsonb,
      'payments', '[]'::jsonb,
      'goals', '[]'::jsonb
    );
  end if;

  v_preferences := public.workly_canonical_preferences(v_profile.dashboard_layout);
  return jsonb_build_object(
    'version', 1,
    'found', true,
    'cursor', v_cursor,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'authUserId', v_profile.id,
      'displayName', v_profile.display_name,
      'country', v_profile.country,
      'language', v_profile.language,
      'currency', v_profile.currency,
      'timezone', v_profile.timezone,
      'createdAt', v_profile.created_at
    ),
    'preferences', v_preferences,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'paymentModel', p.payment_model,
        'expectedMoney', case when p.expected_amount_minor is null then 'null'::jsonb else jsonb_build_object('amountMinor', p.expected_amount_minor, 'currency', p.expected_currency) end,
        'note', p.note,
        'color', p.color,
        'icon', p.icon,
        'status', p.status,
        'completedAt', p.completed_at,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at
      ) order by p.created_at asc, p.id asc)
      from public.projects p
      where p.user_id = v_user_id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'projectId', s.project_id,
        'startedAt', s.started_at,
        'endedAt', s.ended_at,
        'timezone', s.timezone,
        'pauses', coalesce((
          select jsonb_agg(jsonb_build_object('startedAt', pause.started_at, 'endedAt', pause.ended_at) order by pause.ordinal)
          from public.session_pauses pause
          where pause.session_id = s.id
        ), '[]'::jsonb),
        'activeDurationMs', s.active_duration_ms,
        'status', 'completed',
        'earnings', jsonb_build_object('amountMinor', s.earnings_amount_minor, 'currency', s.earnings_currency),
        'note', s.note,
        'createdAt', s.created_at,
        'updatedAt', s.updated_at
      ) order by s.ended_at asc, s.id asc)
      from public.work_sessions s
      where s.user_id = v_user_id and s.status = 'completed'
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'projectId', p.project_id,
        'money', jsonb_build_object('amountMinor', p.amount_minor, 'currency', p.currency),
        'receivedAt', p.received_at,
        'kind', p.kind,
        'note', p.note,
        'createdAt', p.created_at
      ) order by p.received_at desc, p.id asc)
      from public.payments p
      where p.user_id = v_user_id
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'kind', g.kind,
        'target', g.target,
        'createdAt', g.created_at
      ) order by g.created_at asc, g.id asc)
      from public.goals g
      where g.user_id = v_user_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Function privileges are explicit. PostgreSQL otherwise grants EXECUTE to
-- PUBLIC when a function is created or replaced.
-- FX cache values are shared provider data, not a renderer-facing user table.
-- Keep direct table access closed until a future server-side cache writer is
-- introduced with its own policy.
alter table public.fx_rate_cache enable row level security;
revoke all on table public.fx_rate_cache from anon, authenticated;
revoke all on function public.workly_canonical_preferences(jsonb) from public;
revoke all on function public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb) from public;
revoke all on function public.workly_bootstrap_snapshot() from public;
grant execute on function public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb) to authenticated;
grant execute on function public.workly_bootstrap_snapshot() to authenticated;
