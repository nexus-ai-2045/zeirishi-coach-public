-- 学習者の利用許可を宣言する正本。migration は CLI の差分生成後に別途レビューする。
-- https://supabase.com/docs/guides/local-development/declarative-database-schemas
-- https://supabase.com/docs/guides/database/postgres/row-level-security
-- このファイルに招待先・利用者行・秘密情報を置かない。
-- 失効した本人の行も参照できる。実際の利用許可には status = 'active' の確認が必要。
-- Auth のユーザー削除・この行の失効だけで既発行 JWT 自体が無効になるとは扱わない。

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

-- 既定の grant に依存しない。利用者自身の許可作成・昇格・失効取消しを禁止する。
revoke all privileges on table public.learner_access from public, anon, authenticated;
grant select on table public.learner_access to authenticated;

create policy learner_access_select_own_non_anonymous
  on public.learner_access
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    -- authenticated ロールには匿名サインインも含まれるため、明示的な boolean false のみ許可。
    -- 欠落、null、文字列 "false"、ユーザー編集可能な user_metadata は許可根拠にしない。
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb
  );
