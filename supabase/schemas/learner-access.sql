create table public.learner_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint learner_access_status_timestamps_check check (
    isfinite(granted_at)
    and (
      (status = 'active' and revoked_at is null)
      or (
        status = 'revoked'
        and revoked_at is not null
        and isfinite(revoked_at)
        and revoked_at >= granted_at
      )
    )
  )
);

alter table public.learner_access enable row level security;
alter table public.learner_access force row level security;

revoke all privileges on table public.learner_access from public, anon, authenticated;
grant select on table public.learner_access to authenticated;

create policy learner_access_select_own_non_anonymous
  on public.learner_access
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb
  );
