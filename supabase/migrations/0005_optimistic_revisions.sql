-- End-to-end optimistic concurrency for every synchronized entity. Existing
-- five-argument clients remain callable through a compatibility wrapper, while
-- current clients send the revision they observed after pull-before-push.

alter table public.profiles
  add column if not exists preferences_revision bigint not null default 0;

update public.profiles
set preferences_revision = greatest(preferences_revision, remote_revision);

create table if not exists public.sync_entity_versions (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (
    entity_type in (
      'account',
      'project',
      'work_session',
      'payment',
      'goal',
      'preferences'
    )
  ),
  entity_id uuid not null,
  remote_revision bigint not null check (remote_revision >= 0),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);

insert into public.sync_entity_versions (
  user_id,
  entity_type,
  entity_id,
  remote_revision,
  deleted
)
select id, 'account', id, remote_revision, false from public.profiles
union all
select id, 'preferences', id, preferences_revision, false from public.profiles
union all
select user_id, 'project', id, remote_revision, false from public.projects
union all
select user_id, 'work_session', id, remote_revision, false from public.work_sessions
union all
select user_id, 'payment', id, remote_revision, false from public.payments
union all
select user_id, 'goal', id, remote_revision, false from public.goals
on conflict (user_id, entity_type, entity_id) do update
set remote_revision = greatest(
  public.sync_entity_versions.remote_revision,
  excluded.remote_revision
),
deleted = false,
updated_at = now();

alter table public.sync_entity_versions enable row level security;
revoke all on table public.sync_entity_versions from anon, authenticated;

-- Preserve the battle-tested validation/write implementation from migration
-- 0002 behind a private name. The revision-aware function locks the durable
-- version row first, then invokes this implementation in the same transaction.
alter function public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb)
  rename to workly_apply_sync_operation_legacy;
revoke all on function public.workly_apply_sync_operation_legacy(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.workly_apply_sync_operation(
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
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version_entity_id uuid;
  v_change_entity_id uuid;
  v_current_revision bigint;
  v_next_revision bigint;
  v_before_cursor bigint := 0;
  v_existing jsonb;
  v_result jsonb;
  v_current_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_entity_type not in (
    'account',
    'project',
    'work_session',
    'payment',
    'goal',
    'preferences'
  ) then
    raise exception 'Unsupported entity type';
  end if;
  if p_expected_revision is not null and p_expected_revision < 0 then
    raise exception 'Expected revision cannot be negative';
  end if;

  v_version_entity_id := case
    when p_entity_type in ('account', 'preferences') then v_user_id
    else p_entity_id
  end;
  v_change_entity_id := case
    when p_entity_type in ('account', 'preferences') then v_user_id
    else p_entity_id
  end;

  -- A completed retry wins before CAS evaluation. This keeps an operation
  -- idempotent even if its first response was lost after commit.
  select result into v_existing
  from public.sync_operations
  where user_id = v_user_id and operation_id = p_operation_id;
  if found then
    select remote_revision into v_current_revision
    from public.sync_entity_versions
    where user_id = v_user_id
      and entity_type = p_entity_type
      and entity_id = v_version_entity_id;
    return v_existing || jsonb_build_object(
      'conflict', false,
      'remoteRevision', coalesce(v_current_revision, 0)
    );
  end if;

  insert into public.sync_entity_versions (
    user_id,
    entity_type,
    entity_id,
    remote_revision,
    deleted
  ) values (
    v_user_id,
    p_entity_type,
    v_version_entity_id,
    0,
    true
  ) on conflict (user_id, entity_type, entity_id) do nothing;

  select remote_revision into v_current_revision
  from public.sync_entity_versions
  where user_id = v_user_id
    and entity_type = p_entity_type
    and entity_id = v_version_entity_id
  for update;

  -- Recheck after acquiring the per-entity lock: another request with the same
  -- idempotency key may have committed while this request waited.
  select result into v_existing
  from public.sync_operations
  where user_id = v_user_id and operation_id = p_operation_id;
  if found then
    return v_existing || jsonb_build_object(
      'conflict', false,
      'remoteRevision', v_current_revision
    );
  end if;

  if p_expected_revision is not null
    and p_expected_revision <> v_current_revision then
    select c.payload into v_current_payload
    from public.sync_changes c
    where c.user_id = v_user_id
      and c.entity_type = p_entity_type
      and (
        p_entity_type in ('account', 'preferences')
        or c.entity_id = v_version_entity_id
      )
    order by c.cursor desc
    limit 1;
    return jsonb_build_object(
      'conflict', true,
      'reason', 'revision_mismatch',
      'entityType', p_entity_type,
      'entityId', v_version_entity_id,
      'expectedRevision', p_expected_revision,
      'currentRevision', v_current_revision,
      'currentPayload', coalesce(v_current_payload, jsonb_build_object(
        'id', v_version_entity_id
      )) || jsonb_build_object('remoteRevision', v_current_revision)
    );
  end if;

  select coalesce(max(cursor), 0) into v_before_cursor
  from public.sync_changes
  where user_id = v_user_id;

  v_result := public.workly_apply_sync_operation_legacy(
    p_operation_id,
    p_entity_type,
    p_entity_id,
    p_operation,
    p_payload
  );
  v_next_revision := v_current_revision + 1;

  update public.sync_entity_versions
  set remote_revision = v_next_revision,
      deleted = p_operation = 'delete',
      updated_at = now()
  where user_id = v_user_id
    and entity_type = p_entity_type
    and entity_id = v_version_entity_id;

  if p_entity_type = 'preferences' then
    update public.profiles
    set preferences_revision = v_next_revision
    where id = v_user_id;
  end if;

  update public.sync_changes
  set payload = payload || jsonb_build_object(
    'remoteRevision', v_next_revision
  )
  where cursor = (
    select c.cursor
    from public.sync_changes c
    where c.user_id = v_user_id
      and c.entity_type = p_entity_type
      and c.entity_id = v_change_entity_id
      and c.cursor > v_before_cursor
    order by c.cursor asc
    limit 1
  );

  v_result := v_result || jsonb_build_object(
    'conflict', false,
    'remoteRevision', v_next_revision
  );
  update public.sync_operations
  set result = v_result
  where user_id = v_user_id and operation_id = p_operation_id;
  return v_result;
end;
$$;

-- Compatibility for released clients. Passing NULL deliberately preserves
-- their last-write-wins behavior, but every successful legacy request now
-- advances the same version ledger and publishes a revision-bearing change.
create or replace function public.workly_apply_sync_operation(
  p_operation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_operation text,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.workly_apply_sync_operation(
    p_operation_id,
    p_entity_type,
    p_entity_id,
    p_operation,
    p_payload,
    null::bigint
  );
$$;

create or replace function public.workly_get_entity_revisions(p_entities jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_entity_type text;
  v_entity_id uuid;
  v_version_entity_id uuid;
  v_revision bigint;
  v_result jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if jsonb_typeof(p_entities) <> 'array'
    or jsonb_array_length(p_entities) > 100 then
    raise exception 'Revision lookup requires an array of at most 100 entities';
  end if;

  for v_item in select value from jsonb_array_elements(p_entities)
  loop
    v_entity_type := v_item->>'entityType';
    if v_entity_type not in (
      'account',
      'project',
      'work_session',
      'payment',
      'goal',
      'preferences'
    ) then
      raise exception 'Unsupported revision entity type';
    end if;
    begin
      v_entity_id := (v_item->>'entityId')::uuid;
    exception when others then
      raise exception 'Revision entity id must be a UUID';
    end;
    v_version_entity_id := case
      when v_entity_type in ('account', 'preferences') then v_user_id
      else v_entity_id
    end;
    select remote_revision into v_revision
    from public.sync_entity_versions
    where user_id = v_user_id
      and entity_type = v_entity_type
      and entity_id = v_version_entity_id;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'entityType', v_entity_type,
      'entityId', v_entity_id,
      'remoteRevision', coalesce(v_revision, 0)
    ));
  end loop;
  return v_result;
end;
$$;

create or replace function public.workly_bootstrap_page_v2(
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
  v_page jsonb;
  v_items jsonb;
  v_account_revision bigint := 0;
  v_preferences_revision bigint := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  v_page := public.workly_bootstrap_page(
    p_after_type,
    p_after_id,
    p_snapshot_cursor,
    p_limit
  );
  if coalesce((v_page->>'found')::boolean, false) = false then
    return v_page;
  end if;

  select remote_revision into v_account_revision
  from public.sync_entity_versions
  where user_id = v_user_id
    and entity_type = 'account'
    and entity_id = v_user_id;
  select remote_revision into v_preferences_revision
  from public.sync_entity_versions
  where user_id = v_user_id
    and entity_type = 'preferences'
    and entity_id = v_user_id;

  select coalesce(jsonb_agg(
    item || jsonb_build_object(
      'payload', (item->'payload') || jsonb_build_object(
        'remoteRevision', coalesce(version.remote_revision, 0)
      )
    ) order by ordinal
  ), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(v_page->'items') with ordinality as entry(item, ordinal)
  left join public.sync_entity_versions version
    on version.user_id = v_user_id
    and version.entity_type = entry.item->>'entityType'
    and version.entity_id = (entry.item->>'entityId')::uuid;

  return jsonb_set(
    jsonb_set(
      jsonb_set(
        v_page,
        '{profile}',
        (v_page->'profile') || jsonb_build_object(
          'remoteRevision', coalesce(v_account_revision, 0)
        )
      ),
      '{preferences}',
      (v_page->'preferences') || jsonb_build_object(
        'remoteRevision', coalesce(v_preferences_revision, 0)
      )
    ),
    '{items}',
    v_items
  );
end;
$$;

revoke all on function public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb) from public;
revoke all on function public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb, bigint) from public;
revoke all on function public.workly_get_entity_revisions(jsonb) from public;
revoke all on function public.workly_bootstrap_page_v2(text, uuid, bigint, integer) from public;
grant execute on function public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb) to authenticated;
grant execute on function public.workly_apply_sync_operation(uuid, text, uuid, text, jsonb, bigint) to authenticated;
grant execute on function public.workly_get_entity_revisions(jsonb) to authenticated;
grant execute on function public.workly_bootstrap_page_v2(text, uuid, bigint, integer) to authenticated;
