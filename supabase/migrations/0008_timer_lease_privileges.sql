-- Repair privilege drift on hosted databases created before TimeFarm's
-- migration ledger was established. PostgreSQL grants EXECUTE on new
-- functions to PUBLIC by default, so explicitly remove both inherited and
-- direct anonymous access while preserving the desktop client's role.
revoke all on function public.workly_acquire_timer_lease(uuid, integer)
  from public, anon;

grant execute on function public.workly_acquire_timer_lease(uuid, integer)
  to authenticated;
