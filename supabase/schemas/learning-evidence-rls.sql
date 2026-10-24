-- 正式証拠・復習・AI支援の追加権限。各サービスDDLとlearning-rls.sqlの後に適用。
-- これは未適用の宣言。専門取込用ロールや実DBへの権限付与は別途承認する。
begin;
do $$
declare target text;
begin
  foreach target in array array['exam_evidence_revisions','exam_evidence_requests','review_evidence_events','mastery_evidence_revisions','mastery_evidence_requests'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('alter table public.%I force row level security', target);
    execute format('revoke all privileges on table public.%I from public,anon,authenticated,zeirishi_access_guard,zeirishi_app', target);
    -- 本人の全データ削除は許可するが、一般学習サーバーによる専門証拠の作成・改変は拒否。
    execute format('grant select,delete on table public.%I to zeirishi_app', target);
    execute format('create policy evidence_own_active on public.%I for all to zeirishi_app using ((select zeirishi_private.is_active_learner()) and owner_id=(select auth.uid())::text) with check (false)', target);
  end loop;
end $$;

alter table public.ai_interaction_summaries enable row level security;
alter table public.ai_interaction_summaries force row level security;
revoke all privileges on table public.ai_interaction_summaries from public,anon,authenticated,zeirishi_access_guard,zeirishi_app;
grant select,insert,update,delete on table public.ai_interaction_summaries to zeirishi_app;
create policy ai_summary_own_active on public.ai_interaction_summaries for all to zeirishi_app
using ((select zeirishi_private.is_active_learner()) and owner_id=(select auth.uid())::text
  and exists (select 1 from public.cafe_attempts a where a.id=ai_interaction_summaries.attempt_id and a.instance_id=ai_interaction_summaries.instance_id and a.owner_id=(select auth.uid())::text))
with check ((select zeirishi_private.is_active_learner()) and owner_id=(select auth.uid())::text
  and exists (select 1 from public.cafe_attempts a where a.id=ai_interaction_summaries.attempt_id and a.instance_id=ai_interaction_summaries.instance_id and a.owner_id=(select auth.uid())::text));

-- アプリ全体の月額予約額。個人情報を持たず、本人データ削除でも使用済み予算は戻さない。
alter table public.ai_coach_budgets enable row level security;
alter table public.ai_coach_budgets force row level security;
revoke all privileges on table public.ai_coach_budgets from public,anon,authenticated,zeirishi_access_guard,zeirishi_app;
grant select,insert,update on table public.ai_coach_budgets to zeirishi_app;
create policy ai_budget_active on public.ai_coach_budgets for all to zeirishi_app
using ((select zeirishi_private.is_active_learner())) with check ((select zeirishi_private.is_active_learner()));

alter table public.diagnostic_sessions enable row level security;
alter table public.diagnostic_sessions force row level security;
revoke all privileges on table public.diagnostic_sessions from public,anon,authenticated,zeirishi_access_guard,zeirishi_app;
grant select,insert,update,delete on table public.diagnostic_sessions to zeirishi_app;
create policy diagnostic_session_own_active on public.diagnostic_sessions for all to zeirishi_app
using ((select zeirishi_private.is_active_learner()) and owner_id=(select auth.uid())::text)
with check ((select zeirishi_private.is_active_learner()) and owner_id=(select auth.uid())::text);
alter table public.diagnostic_requests enable row level security;
alter table public.diagnostic_requests force row level security;
revoke all privileges on table public.diagnostic_requests from public,anon,authenticated,zeirishi_access_guard,zeirishi_app;
grant select,insert,delete on table public.diagnostic_requests to zeirishi_app;
create policy diagnostic_request_own_active on public.diagnostic_requests for all to zeirishi_app
using ((select zeirishi_private.is_active_learner()) and owner_id=(select auth.uid())::text
  and exists (select 1 from public.diagnostic_sessions d where d.id=diagnostic_requests.session_id and d.owner_id=(select auth.uid())::text))
with check ((select zeirishi_private.is_active_learner()) and owner_id=(select auth.uid())::text
  and exists (select 1 from public.diagnostic_sessions d where d.id=diagnostic_requests.session_id and d.owner_id=(select auth.uid())::text));
commit;
