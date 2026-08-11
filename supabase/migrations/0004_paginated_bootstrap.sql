-- Bound new-device bootstrap responses so long histories cannot create one
-- unbounded JSON document. The snapshot cursor is pinned on the first page;
-- incremental pull reconciles any writes which occur while later pages load.

create index if not exists projects_user_id_id_idx
  on public.projects(user_id, id);
create index if not exists sessions_user_id_id_idx
  on public.work_sessions(user_id, id);
create index if not exists payments_user_id_id_idx
  on public.payments(user_id, id);
create index if not exists goals_user_id_id_idx
  on public.goals(user_id, id);

create or replace function public.workly_bootstrap_page(
  p_after_type text default null,
  p_after_id uuid default null,
  p_snapshot_cursor bigint default null,
  p_limit integer default 250
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_cursor bigint := 0;
  v_cursor bigint := 0;
  v_after_rank integer := 0;
  v_profile public.profiles%rowtype;
  v_preferences jsonb;
  v_items jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next_type text;
  v_next_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_limit < 1 or p_limit > 500 then
    raise exception 'Bootstrap page size must be between 1 and 500';
  end if;
  if (p_after_type is null) <> (p_after_id is null) then
    raise exception 'Bootstrap cursor type and id must be supplied together';
  end if;

  v_after_rank := case
    when p_after_type is null then 0
    when p_after_type = 'project' then 1
    when p_after_type = 'work_session' then 2
    when p_after_type = 'payment' then 3
    when p_after_type = 'goal' then 4
    else -1
  end;
  if v_after_rank < 0 then
    raise exception 'Unsupported bootstrap cursor entity type';
  end if;

  select coalesce(max(c.cursor), 0)::bigint into v_current_cursor
  from public.sync_changes c
  where c.user_id = v_user_id;
  v_cursor := least(coalesce(p_snapshot_cursor, v_current_cursor), v_current_cursor);
  if v_cursor < 0 then
    raise exception 'Bootstrap snapshot cursor cannot be negative';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = v_user_id;

  if not found then
    return jsonb_build_object(
      'version', 2,
      'found', false,
      'cursor', v_cursor,
      'profile', 'null'::jsonb,
      'preferences', 'null'::jsonb,
      'items', '[]'::jsonb,
      'hasMore', false,
      'nextAfter', 'null'::jsonb
    );
  end if;

  v_preferences := public.workly_canonical_preferences(v_profile.dashboard_layout);

  with all_items as (
    select
      1 as entity_rank,
      'project'::text as entity_type,
      p.id as entity_id,
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'paymentModel', p.payment_model,
        'expectedMoney', case
          when p.expected_amount_minor is null then 'null'::jsonb
          else jsonb_build_object(
            'amountMinor', p.expected_amount_minor,
            'currency', p.expected_currency
          )
        end,
        'note', p.note,
        'color', p.color,
        'icon', p.icon,
        'status', p.status,
        'completedAt', p.completed_at,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at
      ) as payload
    from public.projects p
    where p.user_id = v_user_id

    union all

    select
      2,
      'work_session'::text,
      s.id,
      jsonb_build_object(
        'id', s.id,
        'projectId', s.project_id,
        'startedAt', s.started_at,
        'endedAt', s.ended_at,
        'timezone', s.timezone,
        'pauses', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'startedAt', pause.started_at,
              'endedAt', pause.ended_at
            ) order by pause.ordinal
          )
          from public.session_pauses pause
          where pause.session_id = s.id
        ), '[]'::jsonb),
        'activeDurationMs', s.active_duration_ms,
        'status', 'completed',
        'earnings', jsonb_build_object(
          'amountMinor', s.earnings_amount_minor,
          'currency', s.earnings_currency
        ),
        'note', s.note,
        'createdAt', s.created_at,
        'updatedAt', s.updated_at
      )
    from public.work_sessions s
    where s.user_id = v_user_id and s.status = 'completed'

    union all

    select
      3,
      'payment'::text,
      p.id,
      jsonb_build_object(
        'id', p.id,
        'projectId', p.project_id,
        'money', jsonb_build_object(
          'amountMinor', p.amount_minor,
          'currency', p.currency
        ),
        'receivedAt', p.received_at,
        'kind', p.kind,
        'note', p.note,
        'createdAt', p.created_at
      )
    from public.payments p
    where p.user_id = v_user_id

    union all

    select
      4,
      'goal'::text,
      g.id,
      jsonb_build_object(
        'id', g.id,
        'kind', g.kind,
        'target', g.target,
        'createdAt', g.created_at
      )
    from public.goals g
    where g.user_id = v_user_id
  ), page_with_lookahead as (
    select *
    from all_items item
    where
      v_after_rank = 0
      or (item.entity_rank, item.entity_id) > (v_after_rank, p_after_id)
    order by item.entity_rank, item.entity_id
    limit p_limit + 1
  ), included as (
    select *
    from page_with_lookahead
    order by entity_rank, entity_id
    limit p_limit
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'entityType', included.entity_type,
          'entityId', included.entity_id,
          'payload', included.payload
        ) order by included.entity_rank, included.entity_id
      ),
      '[]'::jsonb
    ),
    (select count(*) > p_limit from page_with_lookahead),
    (
      select last_item.entity_type
      from included last_item
      order by last_item.entity_rank desc, last_item.entity_id desc
      limit 1
    ),
    (
      select last_item.entity_id
      from included last_item
      order by last_item.entity_rank desc, last_item.entity_id desc
      limit 1
    )
  into v_items, v_has_more, v_next_type, v_next_id
  from included;

  return jsonb_build_object(
    'version', 2,
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
    'items', v_items,
    'hasMore', v_has_more,
    'nextAfter', case
      when v_has_more then jsonb_build_object(
        'entityType', v_next_type,
        'entityId', v_next_id
      )
      else 'null'::jsonb
    end
  );
end;
$$;

revoke all on function public.workly_bootstrap_page(text, uuid, bigint, integer) from public;
grant execute on function public.workly_bootstrap_page(text, uuid, bigint, integer) to authenticated;
