-- Atomically reserves one cloud profile for one local TimeFarm workspace.
-- This closes the check-then-link race where two devices could both observe
-- an empty cloud account and enqueue unrelated local workspaces for it.

begin;

alter table public.profiles add column if not exists workspace_id text;

-- Existing hosted workspaces predate atomic claims. Mark them as owned so a
-- new local workspace can never claim the same authenticated profile.
update public.profiles
set workspace_id = 'legacy:' || id::text
where workspace_id is null or btrim(workspace_id) = '';

-- Keep the column nullable for compatibility with the v2 account-upsert RPC,
-- which predates workspace claims and deliberately cannot choose an owner.
-- Every existing row above receives a legacy marker and every new desktop
-- claim receives a concrete workspace id. A profile created by an older RPC
-- remains unclaimable instead of being silently attached to the wrong device.
create unique index if not exists profiles_workspace_id_uidx on public.profiles(workspace_id);

-- Keep the hosted schema aligned with the desktop command and formatting
-- contracts. Existing unsupported values intentionally block this migration
-- so they can be reviewed instead of reaching the renderer as corrupt data.
alter table public.profiles drop constraint if exists profiles_currency_check;
alter table public.profiles add constraint profiles_currency_check
  check (currency in ('VND', 'USD', 'EUR', 'JPY', 'GBP'));
alter table public.projects drop constraint if exists projects_expected_currency_check;
alter table public.projects add constraint projects_expected_currency_check
  check (expected_currency is null or expected_currency in ('VND', 'USD', 'EUR', 'JPY', 'GBP'));
alter table public.work_sessions drop constraint if exists work_sessions_earnings_currency_check;
alter table public.work_sessions add constraint work_sessions_earnings_currency_check
  check (earnings_currency is null or earnings_currency in ('VND', 'USD', 'EUR', 'JPY', 'GBP'));
alter table public.payments drop constraint if exists payments_currency_check;
alter table public.payments add constraint payments_currency_check
  check (currency in ('VND', 'USD', 'EUR', 'JPY', 'GBP'));
alter table public.fx_rate_cache drop constraint if exists fx_rate_cache_base_currency_check;
alter table public.fx_rate_cache add constraint fx_rate_cache_base_currency_check
  check (base_currency in ('VND', 'USD', 'EUR', 'JPY', 'GBP'));
alter table public.fx_rate_cache drop constraint if exists fx_rate_cache_quote_currency_check;
alter table public.fx_rate_cache add constraint fx_rate_cache_quote_currency_check
  check (quote_currency in ('VND', 'USD', 'EUR', 'JPY', 'GBP'));

create or replace function public.workly_claim_workspace(p_workspace_id text, p_profile jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_workspace_id text;
  v_inserted integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_workspace_id is null or char_length(btrim(p_workspace_id)) not between 1 and 200 then
    raise exception 'A valid local workspace id is required';
  end if;
  if coalesce(jsonb_typeof(p_profile), '') <> 'object' then
    raise exception 'Profile must be an object';
  end if;
  if coalesce(p_profile->>'language', '') not in ('vi', 'en') then
    raise exception 'Unsupported profile language';
  end if;
  if coalesce(p_profile->>'currency', '') not in ('VND', 'USD', 'EUR', 'JPY', 'GBP') then
    raise exception 'Unsupported profile currency';
  end if;
  if char_length(coalesce(p_profile->>'country', '')) not between 2 and 8 then
    raise exception 'Invalid profile country';
  end if;
  if char_length(btrim(coalesce(p_profile->>'timezone', ''))) not between 1 and 120 then
    raise exception 'Invalid profile timezone';
  end if;

  insert into public.profiles (id, workspace_id, display_name, country, language, currency, timezone)
  values (
    v_user_id,
    btrim(p_workspace_id),
    left(coalesce(p_profile->>'displayName', ''), 120),
    p_profile->>'country',
    p_profile->>'language',
    p_profile->>'currency',
    p_profile->>'timezone'
  )
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  select p.workspace_id into v_owner_workspace_id
  from public.profiles p
  where p.id = v_user_id;

  return jsonb_build_object(
    'claimed', coalesce(v_owner_workspace_id = btrim(p_workspace_id), false),
    'created', v_inserted = 1,
    'workspaceId', v_owner_workspace_id
  );
end;
$$;

revoke all on function public.workly_claim_workspace(text, jsonb) from public;
grant execute on function public.workly_claim_workspace(text, jsonb) to authenticated;

commit;
