begin;

create role zeirishi_app nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
create role zeirishi_access_guard nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
revoke zeirishi_app, zeirishi_access_guard from anon, authenticated;
revoke zeirishi_access_guard from zeirishi_app;

create schema zeirishi_private;
revoke all privileges on schema zeirishi_private from public, anon, authenticated, zeirishi_app, zeirishi_access_guard;
grant usage on schema zeirishi_private to zeirishi_app, zeirishi_access_guard;
grant usage on schema public to zeirishi_access_guard;
grant usage on schema auth to zeirishi_access_guard;
grant execute on function auth.uid(), auth.jwt() to zeirishi_access_guard;

revoke all privileges on table public.learner_access from zeirishi_app, zeirishi_access_guard;
grant select on table public.learner_access to zeirishi_access_guard;
grant update(user_id) on public.learner_access to zeirishi_access_guard;

create policy learner_access_guard_select_own
  on public.learner_access for select to zeirishi_access_guard
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb
  );

create policy learner_access_guard_lock_own
  on public.learner_access for update to zeirishi_access_guard
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb
  )
  with check (false);

create function zeirishi_private.require_active_learner(expected_user uuid)
  returns void
  language plpgsql
  security definer
  set search_path = ''
  set row_security = on
  as $$
declare
  access_status text;
begin
  if expected_user is null
    or auth.uid() is distinct from expected_user
    or (auth.jwt() -> 'is_anonymous') is distinct from 'false'::jsonb
  then
    raise exception using errcode = 'ZC403', message = 'LEARNER_ACCESS_DENIED';
  end if;

  select access.status into access_status
    from public.learner_access as access
    where access.user_id = expected_user
    for share;

  if not found or access_status <> 'active' then
    raise exception using errcode = 'ZC403', message = 'LEARNER_ACCESS_DENIED';
  end if;
end;
$$;

grant create on schema zeirishi_private to zeirishi_access_guard;
alter function zeirishi_private.require_active_learner(uuid) owner to zeirishi_access_guard;
revoke create on schema zeirishi_private from zeirishi_access_guard;
revoke all privileges on function zeirishi_private.require_active_learner(uuid) from public, anon, authenticated;
grant execute on function zeirishi_private.require_active_learner(uuid) to zeirishi_app;

commit;
