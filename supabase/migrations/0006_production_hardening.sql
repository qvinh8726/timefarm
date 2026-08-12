-- Production permission and referential-integrity hardening.
--
-- The desktop reads the change feed only through the RPC boundary. Keeping
-- the table itself private prevents a renderer credential from expanding its
-- read surface, while SECURITY DEFINER lets the narrowly scoped function read
-- on behalf of the authenticated subject.
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
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_cursor is null or p_cursor < 0 then
    raise exception 'Pull cursor must be a non-negative integer'
      using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'Pull limit must be a positive integer'
      using errcode = '22023';
  end if;
  v_limit := least(p_limit, 500);

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

-- PostgreSQL grants EXECUTE on replacement functions to PUBLIC unless it is
-- explicitly revoked. Direct access to the underlying feed stays closed even
-- if a project still carries older Supabase default grants.
revoke all on table public.sync_changes from public, anon, authenticated;
revoke all on function public.workly_pull_changes(bigint, integer)
  from public, anon, authenticated;
grant execute on function public.workly_pull_changes(bigint, integer)
  to authenticated;

-- The revision-aware writer serializes each entity through its version row,
-- but a child entity and its project use different version rows. Wrap the
-- private validation/writer so both session and payment upserts acquire the
-- same parent KEY SHARE lock before their child write, while project deletion
-- acquires the conflicting parent UPDATE lock before checking history. The
-- lock order is therefore always entity-version -> parent-project -> child.
alter function public.workly_apply_sync_operation_legacy(
  uuid,
  text,
  uuid,
  text,
  jsonb
) rename to workly_apply_sync_operation_unlocked;
revoke all on function public.workly_apply_sync_operation_unlocked(
  uuid,
  text,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;

create function public.workly_apply_sync_operation_legacy(
  p_operation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_operation text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_entity_type = 'project' and p_operation = 'delete' then
    perform project.id
    from public.projects as project
    where project.id = p_entity_id and project.user_id = v_user_id
    for update;
  elsif p_entity_type in ('work_session', 'payment')
    and p_operation is distinct from 'delete' then
    v_project_id := nullif(p_payload->>'projectId', '')::uuid;
    if v_project_id is not null then
      perform project.id
      from public.projects as project
      where project.id = v_project_id and project.user_id = v_user_id
      for key share;
      if not found then
        if p_entity_type = 'work_session' then
          raise exception 'Session project is not owned';
        else
          raise exception 'Payment project is not owned';
        end if;
      end if;
    end if;
  end if;

  return public.workly_apply_sync_operation_unlocked(
    p_operation_id,
    p_entity_type,
    p_entity_id,
    p_operation,
    p_payload
  );
end;
$$;
revoke all on function public.workly_apply_sync_operation_legacy(
  uuid,
  text,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;

-- A project is financial/history attribution. SET NULL and CASCADE allowed a
-- concurrent project deletion to erase that attribution or its payments after
-- the RPC's pre-delete checks had already run. RESTRICT makes PostgreSQL take
-- and arbitrate the parent/child key locks in one database transaction:
--
--   history insert/update -> parent KEY SHARE -> child write
--   project delete        -> parent DELETE lock -> FK child check
--
-- Whichever transaction wins forces the other to observe a valid project or
-- fail; no caller (including one outside the sync RPC) can bypass this rule.
create index if not exists work_sessions_project_id_idx
  on public.work_sessions(project_id);
create index if not exists payments_project_id_idx
  on public.payments(project_id);

alter table public.work_sessions
  drop constraint if exists work_sessions_project_id_fkey;
alter table public.work_sessions
  add constraint work_sessions_project_id_fkey
  foreign key (project_id)
  references public.projects(id)
  on delete restrict;

alter table public.payments
  drop constraint if exists payments_project_id_fkey;
alter table public.payments
  add constraint payments_project_id_fkey
  foreign key (project_id)
  references public.projects(id)
  on delete restrict;
