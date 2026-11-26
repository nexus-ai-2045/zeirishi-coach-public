begin;

revoke create on schema public from public, anon, authenticated, zeirishi_app, zeirishi_access_guard;
revoke create on schema zeirishi_private from public, anon, authenticated, zeirishi_app, zeirishi_access_guard;
grant usage on schema public, auth, zeirishi_private to zeirishi_app;
grant execute on function auth.uid(), auth.jwt() to zeirishi_app;

grant select on table public.learner_access to zeirishi_app;
create policy learner_access_app_select_own
  on public.learner_access for select to zeirishi_app
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb
  );

create function zeirishi_private.is_active_learner()
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
  set row_security = on
  as $$
    select
      auth.uid() is not null
      and (auth.jwt() -> 'is_anonymous') = 'false'::jsonb
      and exists (
        select 1 from public.learner_access as access
        where access.user_id = auth.uid() and access.status = 'active'
      );
  $$;
revoke all privileges on function zeirishi_private.is_active_learner()
  from public, anon, authenticated, zeirishi_access_guard;
grant execute on function zeirishi_private.is_active_learner() to zeirishi_app;


alter table public.owner_access enable row level security;
alter table public.owner_access force row level security;
revoke all privileges on table public.owner_access
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, update, delete on table public.owner_access to zeirishi_app;

alter table public.study_sessions enable row level security;
alter table public.study_sessions force row level security;
revoke all privileges on table public.study_sessions
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, update, delete on table public.study_sessions to zeirishi_app;

alter table public.study_requests enable row level security;
alter table public.study_requests force row level security;
revoke all privileges on table public.study_requests
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, update, delete on table public.study_requests to zeirishi_app;

alter table public.study_attempts enable row level security;
alter table public.study_attempts force row level security;
revoke all privileges on table public.study_attempts
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, delete on table public.study_attempts to zeirishi_app;

alter table public.cafe_instances enable row level security;
alter table public.cafe_instances force row level security;
revoke all privileges on table public.cafe_instances
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, update, delete on table public.cafe_instances to zeirishi_app;

alter table public.cafe_attempts enable row level security;
alter table public.cafe_attempts force row level security;
revoke all privileges on table public.cafe_attempts
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, delete on table public.cafe_attempts to zeirishi_app;

alter table public.cafe_confidence enable row level security;
alter table public.cafe_confidence force row level security;
revoke all privileges on table public.cafe_confidence
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, delete on table public.cafe_confidence to zeirishi_app;

alter table public.cafe_progress enable row level security;
alter table public.cafe_progress force row level security;
revoke all privileges on table public.cafe_progress
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, update, delete on table public.cafe_progress to zeirishi_app;

alter table public.cafe_requests enable row level security;
alter table public.cafe_requests force row level security;
revoke all privileges on table public.cafe_requests
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, delete on table public.cafe_requests to zeirishi_app;

alter table public.confidence_profiles enable row level security;
alter table public.confidence_profiles force row level security;
revoke all privileges on table public.confidence_profiles
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, update, delete on table public.confidence_profiles to zeirishi_app;

alter table public.confidence_requests enable row level security;
alter table public.confidence_requests force row level security;
revoke all privileges on table public.confidence_requests
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, delete on table public.confidence_requests to zeirishi_app;

alter table public.weekly_plans enable row level security;
alter table public.weekly_plans force row level security;
revoke all privileges on table public.weekly_plans
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, update, delete on table public.weekly_plans to zeirishi_app;

alter table public.weekly_plan_requests enable row level security;
alter table public.weekly_plan_requests force row level security;
revoke all privileges on table public.weekly_plan_requests
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, delete on table public.weekly_plan_requests to zeirishi_app;


create policy owner_access_app_own_active
  on public.owner_access for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('zeirishi-local-owner-v1:' || (select auth.uid())::text, 'UTF8')), 'hex')
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('zeirishi-local-owner-v1:' || (select auth.uid())::text, 'UTF8')), 'hex')
  );

create policy study_sessions_app_own_active
  on public.study_sessions for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  );

create policy study_requests_app_own_active
  on public.study_requests for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.study_sessions as parent where parent.id = study_requests.session_id and parent.owner_id = (select auth.uid())::text)
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.study_sessions as parent where parent.id = study_requests.session_id and parent.owner_id = (select auth.uid())::text)
  );

create policy study_attempts_app_own_active
  on public.study_attempts for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.study_sessions as parent where parent.id = study_attempts.session_id and parent.owner_id = (select auth.uid())::text)
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.study_sessions as parent where parent.id = study_attempts.session_id and parent.owner_id = (select auth.uid())::text)
  );

create policy cafe_instances_app_own_active
  on public.cafe_instances for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  );

create policy cafe_attempts_app_own_active
  on public.cafe_attempts for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.cafe_instances as parent where parent.id = cafe_attempts.instance_id and parent.owner_id = (select auth.uid())::text)
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.cafe_instances as parent where parent.id = cafe_attempts.instance_id and parent.owner_id = (select auth.uid())::text)
  );

create policy cafe_confidence_app_own_active
  on public.cafe_confidence for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and exists (select 1 from public.cafe_attempts as attempt where attempt.id = cafe_confidence.attempt_id and attempt.owner_id = (select auth.uid())::text)
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and exists (select 1 from public.cafe_attempts as attempt where attempt.id = cafe_confidence.attempt_id and attempt.owner_id = (select auth.uid())::text)
  );

create policy cafe_progress_app_own_active
  on public.cafe_progress for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.cafe_instances as parent where parent.id = cafe_progress.instance_id and parent.owner_id = (select auth.uid())::text)
    and exists (select 1 from public.cafe_attempts as attempt where attempt.id = cafe_progress.attempt_id and attempt.instance_id = cafe_progress.instance_id and attempt.owner_id = (select auth.uid())::text)
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.cafe_instances as parent where parent.id = cafe_progress.instance_id and parent.owner_id = (select auth.uid())::text)
    and exists (select 1 from public.cafe_attempts as attempt where attempt.id = cafe_progress.attempt_id and attempt.instance_id = cafe_progress.instance_id and attempt.owner_id = (select auth.uid())::text)
  );

create policy cafe_requests_app_own_active
  on public.cafe_requests for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.cafe_instances as parent where parent.id = cafe_requests.instance_id and parent.owner_id = (select auth.uid())::text)
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
    and exists (select 1 from public.cafe_instances as parent where parent.id = cafe_requests.instance_id and parent.owner_id = (select auth.uid())::text)
  );

create policy confidence_profiles_app_own_active
  on public.confidence_profiles for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  );

create policy confidence_requests_app_own_active
  on public.confidence_requests for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  );

create policy weekly_plans_app_own_active
  on public.weekly_plans for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  );

create policy weekly_plan_requests_app_own_active
  on public.weekly_plan_requests for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  )
  with check (
    (select zeirishi_private.is_active_learner())
    and owner_id = (select auth.uid())::text
  );

alter table public.mock_exam_records enable row level security;
alter table public.mock_exam_records force row level security;
revoke all privileges on table public.mock_exam_records
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, update, delete on table public.mock_exam_records to zeirishi_app;
alter table public.mock_exam_requests enable row level security;
alter table public.mock_exam_requests force row level security;
revoke all privileges on table public.mock_exam_requests
  from public, anon, authenticated, zeirishi_access_guard, zeirishi_app;
grant select, insert, delete on table public.mock_exam_requests to zeirishi_app;

create policy mock_exam_records_app_own_active
  on public.mock_exam_records for all to zeirishi_app
  using ((select zeirishi_private.is_active_learner()) and owner_id = (select auth.uid())::text)
  with check ((select zeirishi_private.is_active_learner()) and owner_id = (select auth.uid())::text);

create policy mock_exam_requests_app_own_active
  on public.mock_exam_requests for all to zeirishi_app
  using (
    (select zeirishi_private.is_active_learner()) and owner_id = (select auth.uid())::text
    and exists (select 1 from public.mock_exam_records as parent
      where parent.id = mock_exam_requests.record_id and parent.owner_id = (select auth.uid())::text)
  )
  with check (
    (select zeirishi_private.is_active_learner()) and owner_id = (select auth.uid())::text
    and exists (select 1 from public.mock_exam_records as parent
      where parent.id = mock_exam_requests.record_id and parent.owner_id = (select auth.uid())::text)
  );

commit;
