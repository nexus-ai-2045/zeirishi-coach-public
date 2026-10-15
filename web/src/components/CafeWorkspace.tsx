'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { Concept, ConceptRef, ConfidenceReport, InitialRecommendation, SelfConfidence, SubjectId } from '../domain/onboarding';
import type { SubjectMapPack } from '../domain/subject-map';
import { caseCountNotice, startableCaseCount } from '../domain/bookkeeping-overview';
import type { CafeDraftItem, CafeHistoryItem, CafePhase, CafeView } from '../server/cafe-service';
import styles from './CafeWorkspace.module.css';
import journey from './LearningJourney.module.css';
import navigation from './CafeNavigation.module.css';
import { DataControls } from './DataControls';
import { LearningHistory } from './LearningHistory';
import { WeeklyPlan } from './WeeklyPlan';
import { MockExamRecords } from './MockExamRecords';
import { LearningEvidencePanel } from './LearningEvidencePanel';
import { AiCoachPanel } from './AiCoachPanel';
import { DiagnosticPanel } from './DiagnosticPanel';
import { LearningCelebration, type LearningMoment } from './LearningCelebration';
import { LearningAtlas } from './LearningAtlas';
import { BookkeepingPractice } from './BookkeepingPractice';
import { MiniExamPanel } from './MiniExamPanel';
import { BookkeepingTrialReview } from './BookkeepingTrialReview';
import { BookkeepingIntro } from './BookkeepingIntro';
import { ConceptPosition } from './ConceptPosition';

type Profile = { revision: number; reports: ConfidenceReport[]; examSubjects: SubjectId[] | null };
type MaterialChoice = ConceptRef & { materialId: string; caseVersion: string; label: string };
type Catalog = { profile: Profile; subjectId: SubjectId; subjects: { id: SubjectId; label: string; available: boolean }[];
  concepts: Concept[]; recommendations: InitialRecommendation[]; materialNotice: string; materialChoices?: MaterialChoice[];
  subjectMap: SubjectMapPack | null };
type AppView = 'home' | 'overview' | 'map' | 'records' | 'case';
function readRoute(): { view: AppView; caseId: string | null } {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('case/')) {
    try { return { view: 'case', caseId: decodeURIComponent(hash.slice(5)) }; }
    catch { return { view: 'home', caseId: null }; }
  }
  if (hash === 'overview' || hash === 'map' || hash === 'records') return { view: hash, caseId: null };
  return { view: 'home', caseId: null };
}
function routeHash(view: AppView, caseId?: string | null) {
  return view === 'case' && caseId ? `#case/${encodeURIComponent(caseId)}` : `#${view}`;
}
type ResumeHint = { caseId: string; phase: CafePhase; savedAt: string | null };
/** Online home resume uses the server history projection only; the case itself opens on an explicit action. */
function pickResumeHint(items: CafeHistoryItem[], drafts: CafeDraftItem[]): ResumeHint | null {
  const submitted = items.find(item => item.status === 'active');
  const candidates: ResumeHint[] = [
    ...(submitted ? [{ caseId: submitted.caseId, phase: submitted.phase, savedAt: submitted.submittedAt }] : []),
    ...(drafts[0] ? [{ caseId: drafts[0].caseId, phase: drafts[0].phase, savedAt: drafts[0].savedAt }] : []),
  ];
  const time = (value: string | null) => (value ? Date.parse(value) : 0) || 0;
  return candidates.sort((a, b) => time(b.savedAt) - time(a.savedAt))[0] ?? null;
}
const storageKey = 'zc-cafe-case-v2';
const labels = ['相談を読む', '判断する', '理解する', '説明する', '振り返る'];
const phaseStep = (phase: CafePhase) => phase === 'consultation' ? 0 : ['decision', 'confidence'].includes(phase) ? 1 : phase === 'feedback' ? 2 : phase === 'teach_back' ? 3 : 4;
const selfLabels: { value: SelfConfidence; label: string }[] = [{ value: 'explained', label: '説明できる' }, { value: 'uncertain', label: '少し怪しい' }, { value: 'unlearned', label: '未学習' }];
const choiceReflection: Record<string, string> = {
  c7m2: '12万円を選んだ場合：支払いをそのまま費用と考えたかもしれません。契約期間を決算日で区切って、使った月だけを数え直しましょう。',
  h4r9: '4万円を選んだ場合：当期にサービスを受けた月を数えた判断です。残りの月が帳簿でどう残るかも説明してみましょう。',
  p8n3: '8万円を選んだ場合：翌期の8か月と当期の4か月を逆にしたかもしれません。12月から3月までを指で追ってみましょう。',
  s2w6: '0円を選んだ場合：翌期分だけでなく、当期に受けたサービスもあります。決算日までの月を探してみましょう。',
};

async function apiRequest<T>(url: string, body?: unknown, expectedLearnerId?: string): Promise<T> {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
    headers: { ...(expectedLearnerId ? { 'X-Zeirishi-Learner': expectedLearnerId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'REQUEST_FAILED');
  return data as T;
}
function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : 'REQUEST_FAILED';
  if (['AUTH_REQUIRED', 'AUTH_IDENTITY_CHANGED', 'INVITATION_REQUIRED'].includes(code)) return 'ログイン状態または招待の有効性を確認できません。入力はこの画面に残しています。別タブでログインを確認してから再試行してください。';
  if (code === 'MATERIAL_NOT_AVAILABLE') return 'この相談教材はまだ提供準備中です。認証の成功は教材の準備完了を意味しません。';
  if (code === 'MATERIAL_SELECTION_REQUIRED') return '学習一覧から、学びたい単元を選んでください。';
  if (code === 'CONCEPT_VERSION_UNAVAILABLE') return '教材の提供状況が変わったため、自信や受験予定を保存できませんでした。最新の教材一覧を読み直してから、改めて選んでください。旧版の自信は新版へ引き継ぎません。';
  if (code === 'CASE_VERSION_CONFLICT') return '保存した相談の教材版を現在は開けません。別の版へ置き換えたり、再採点したりはしていません。';
  if (code === 'OWNER_REVOKED') return 'この利用者の学習データは削除済みです。アカウント削除とは別です。再利用については管理者に確認してください。';
  if (code.includes('REVISION_CONFLICT')) return '別の画面で保存されています。最新の保存内容を読み直してください。';
  if (code === 'DRAFT_CHANGED') return '失敗した送信のあとに入力を変更しています。入力を残して保存状態を更新し、保存する説明を選んでください。';
  if (code.includes('NOT_FOUND') || code.includes('USER_REQUIRED')) return 'このブラウザーでは保存済みの相談を開けません。学習一覧から新しく始められます。';
  if (code.includes('FIXTURE') || code.includes('LOCAL_SERVER')) return '開発用サーバーの設定を確認して、再起動してください。';
  return '通信または保存に失敗しました。入力はこの画面に残っています。同じ操作を再試行できます。';
}

export function CafeWorkspace({ mode = 'local', expectedLearnerId }: { mode?: 'local' | 'online'; expectedLearnerId?: string }) {
  const online = mode === 'online';
  const [moment, setMoment] = useState<LearningMoment | null>(null);
  const [reducedEffects, setReducedEffects] = useState(false);
  const seenMoments = useRef(new Set<string>());
  useEffect(() => { try { setReducedEffects(localStorage.getItem('zc-reduced-effects') === '1'); } catch {} }, []);
  function celebrate(id: string, kind: LearningMoment['kind'], correct?: boolean) {
    if (seenMoments.current.has(id)) return;
    seenMoments.current.add(id); setMoment({ id, kind, correct });
  }
  async function request<T>(url: string, body?: unknown): Promise<T> {
    if (online && !expectedLearnerId) throw new Error('AUTH_REQUIRED');
    return apiRequest<T>(url, body, online ? expectedLearnerId : undefined);
  }
  const [authenticationNeeded, setAuthenticationNeeded] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [mockExamDirty, setMockExamDirty] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [choosingConcept, setChoosingConcept] = useState<ConceptRef | null>(null);
  const [expandedSubject, setExpandedSubject] = useState<SubjectId | null>(null);
  const [mapFocus, setMapFocus] = useState<{ conceptId: string; topicId: string | null } | null>(null);
  const [view, setView] = useState<AppView>('home');
  const [session, setSession] = useState<CafeView | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [answerConfidence, setAnswerConfidence] = useState<'low' | 'normal' | 'high' | ''>('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [catalogRefreshNeeded, setCatalogRefreshNeeded] = useState(false);
  const [notice, setNotice] = useState('');
  const [explanation, setExplanationValue] = useState('');
  const [showQuestion, setShowQuestion] = useState(false);
  const [conflictView, setConflictView] = useState<CafeView | null>(null);
  const [resumeHint, setResumeHint] = useState<ResumeHint | null>(null);
  const [resumeHintFailed, setResumeHintFailed] = useState(false);
  const [resumeHintChecking, setResumeHintChecking] = useState(false);
  const resumeHintRequest = useRef(0);
  const editVersion = useRef(0);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const routeRef = useRef('#home');
  const historyIndex = useRef(0);
  // Bumped on every view change; a late response may update data but must not move the learner's screen.
  const routeGeneration = useRef(0);
  const dirtyRef = useRef(false);
  const explanationDirty = !!session && explanation !== session.explanation && session.phase === 'teach_back';
  const dirty = explanationDirty || (!!session && session.phase === 'decision' && choice !== session.optionId);
  dirtyRef.current = dirty;

  function navigate(next: AppView, caseId?: string | null) {
    if (dirtyRef.current) { setNotice('未保存の入力があります。保存してから画面を移動してください。'); return; }
    routeGeneration.current += 1;
    const hash = routeHash(next, caseId ?? session?.id);
    if (routeRef.current !== hash) {
      historyIndex.current += 1;
      window.history.pushState({ zcIndex: historyIndex.current }, '', hash);
      routeRef.current = hash;
    }
    setView(next);
    window.scrollTo(0, 0);
  }

  function setExplanation(value: string) {
    editVersion.current += 1;
    setExplanationValue(value);
  }

  function accept(next: CafeView) {
    if (next.id !== session?.id) { setShowQuestion(false); setAnswerConfidence(''); }
    setSession(next); setChoice(next.optionId); setExplanation(next.explanation);
    if (!online) try { localStorage.setItem(storageKey, next.id); } catch { setNotice('このブラウザーでは再開用の記録を保存できません。'); }
  }
  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); retry.current = operation;
    try { await operation(); retry.current = null; setAuthenticationNeeded(false); setCatalogRefreshNeeded(false); } catch (cause) {
      setError(errorMessage(cause));
      const unavailable = cause instanceof Error && cause.message === 'CONCEPT_VERSION_UNAVAILABLE';
      setCatalogRefreshNeeded(unavailable);
      if (unavailable) retry.current = null;
      if (online && cause instanceof Error && ['AUTH_REQUIRED', 'AUTH_IDENTITY_CHANGED', 'INVITATION_REQUIRED'].includes(cause.message)) setAuthenticationNeeded(true);
    }
    finally { lock.current = false; setBusy(false); }
  }
  async function load(subject: SubjectId = 'bookkeeping') {
    setCatalog(await request<Catalog>(`/api/profile?subjectId=${subject}`));
    setChoosingConcept(null);
  }
  async function loadResumeHint() {
    const requestId = ++resumeHintRequest.current;
    const latest = () => requestId === resumeHintRequest.current;
    setResumeHintChecking(true);
    try {
      const { items, drafts } = await request<{ items: CafeHistoryItem[]; drafts: CafeDraftItem[] }>('/api/history');
      if (!Array.isArray(items) || !Array.isArray(drafts)) throw new Error('HISTORY_UNAVAILABLE');
      if (latest()) { setResumeHint(pickResumeHint(items, drafts)); setResumeHintFailed(false); }
    } catch { if (latest()) { setResumeHint(null); setResumeHintFailed(true); } }
    finally { if (latest()) setResumeHintChecking(false); }
  }
  function openCase(id: string) {
    void run(async () => {
      const generation = routeGeneration.current;
      accept((await request<{ session: CafeView }>(`/api/cafe?caseId=${encodeURIComponent(id)}`)).session);
      if (generation === routeGeneration.current) navigate('case', id);
    });
  }
  useEffect(() => {
    void run(async () => {
      await load();
      if (online) await loadResumeHint();
      const route = readRoute();
      historyIndex.current = typeof window.history.state?.zcIndex === 'number' ? window.history.state.zcIndex : 0;
      window.history.replaceState({ zcIndex: historyIndex.current }, '', routeHash(route.view, route.caseId));
      routeRef.current = routeHash(route.view, route.caseId);
      if (route.view === 'case' && route.caseId) {
        const generation = routeGeneration.current;
        try {
          accept((await request<{ session: CafeView }>(`/api/cafe?caseId=${encodeURIComponent(route.caseId)}`)).session);
          if (generation === routeGeneration.current) setView('case');
        } catch (cause) {
          // Authentication problems keep the case URL and show the sign-in guidance instead of a generic fallback.
          if (cause instanceof Error && ['AUTH_REQUIRED', 'AUTH_IDENTITY_CHANGED', 'INVITATION_REQUIRED'].includes(cause.message)) throw cause;
          if (generation === routeGeneration.current) {
            window.history.replaceState({ zcIndex: historyIndex.current }, '', '#home'); routeRef.current = '#home'; setView('home');
          }
          setNotice('指定された相談を開けませんでした。学習地図から選び直せます。');
        }
        return;
      }
      setView(route.view === 'case' ? 'home' : route.view);
      if (online) return; // Never read another identity's local fixture resume pointer.
      let id: string | null = null;
      try { id = localStorage.getItem(storageKey); } catch { /* Optional resume pointer only. */ }
      if (id) {
        try { accept((await request<{ session: CafeView }>(`/api/cafe?caseId=${encodeURIComponent(id)}`)).session); }
        catch { setNotice('前回の相談は再開できませんでした。新しく学習を始められます。'); }
      }
    });
  }, []);
  // Online home re-reads the history projection on every visit so a completed case is not offered again.
  useEffect(() => { if (online && view === 'home' && catalog) void loadResumeHint(); }, [view]);
  const focusPhase = session?.phase === 'consultation' ? 'decision' : session?.phase;
  useEffect(() => { if (view === 'case') heading.current?.focus(); }, [focusPhase, view]);
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const targetIndex = typeof event.state?.zcIndex === 'number' ? event.state.zcIndex : null;
      const route = readRoute();
      if (targetIndex === historyIndex.current && routeHash(route.view, route.caseId) === routeRef.current) return;
      const caseId = route.view === 'case' ? route.caseId : null;
      // Unsaved input blocks history moves; a case cannot be loaded while another request holds the lock.
      if (dirtyRef.current || (caseId && lock.current)) {
        if (targetIndex !== null && targetIndex !== historyIndex.current) window.history.go(historyIndex.current - targetIndex);
        else window.history.replaceState({ zcIndex:historyIndex.current }, '', routeRef.current);
        setNotice(dirtyRef.current ? '未保存の入力があります。保存してから画面を移動してください。' : '保存・読込中です。完了してから相談を開いてください。');
        return;
      }
      routeGeneration.current += 1;
      historyIndex.current = targetIndex ?? historyIndex.current;
      routeRef.current = routeHash(route.view, route.caseId);
      if (caseId) {
        void run(async () => {
          const generation = routeGeneration.current;
          accept((await request<{ session: CafeView }>(`/api/cafe?caseId=${encodeURIComponent(caseId)}`)).session);
          if (generation === routeGeneration.current) setView('case');
        });
      } else setView(route.view === 'case' ? 'home' : route.view);
    };
    const onHashChange = () => onPopState(new PopStateEvent('popstate', { state:window.history.state }));
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    return () => { window.removeEventListener('popstate', onPopState); window.removeEventListener('hashchange', onHashChange); };
  });
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!explanationDirty || !session || busy || error || conflictView) return;
    const timer = window.setTimeout(() => {
      mutate('progress', { revision: session.progressRevision, phase: 'teach_back', explanation });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [explanationDirty, explanation, session?.progressRevision, busy, error, conflictView]);

  function mutate(action: string, fields: Record<string, unknown> = {}) {
    const body = { action, requestId: crypto.randomUUID(), ...(action !== 'start' ? { caseId: session?.id } : {}), ...fields };
    const version = editVersion.current;
    void run(async () => {
      if (action === 'progress' && version !== editVersion.current) throw new Error('DRAFT_CHANGED');
      const generation = routeGeneration.current;
      const next = (await request<{ session: CafeView }>('/api/cafe', body)).session;
      accept(next);
      if (action === 'start' || action === 'complete') celebrate(body.requestId, action === 'start' ? 'start' : 'complete');
      if (action === 'start' && generation === routeGeneration.current) navigate('case', next.id);
      setNotice('');
    });
  }
  function progress(phase: 'feedback' | 'teach_back' | 'reflection') {
    mutate('progress', { revision: session?.progressRevision, phase, explanation });
  }
  function answerAndExplain() {
    if (!session || !choice) return;
    const submit = { action: 'submit', requestId: crypto.randomUUID(), caseId: session.id, optionId: choice };
    const confidence = { action: 'confidence', requestId: crypto.randomUUID(), caseId: session.id, confidence: answerConfidence || null };
    let submitted = false;
    void run(async () => {
      // Keep both request IDs across retries, including a lost response after commit.
      if (!submitted) { await request('/api/cafe', submit); submitted = true; }
      const updated = (await request<{ session: CafeView }>('/api/cafe', confidence)).session;
      accept(updated); celebrate(submit.requestId, 'insight', updated.result?.correct);
      setNotice('');
    });
  }
  function startConcept(ref: ConceptRef, materialId?: string, caseVersion?: string) {
    if (!canStartConcept(ref)) { setNotice('この教材は現在の画面から開始できません。教材一覧を読み直してください。'); return; }
    const choices = catalog?.materialChoices?.filter(item => item.subjectId === ref.subjectId && item.conceptId === ref.conceptId && item.conceptVersion === ref.conceptVersion) ?? [];
    if (online && !materialId && choices.length > 1) { setChoosingConcept(ref); return; }
    const selected = !materialId && choices.length === 1 ? choices[0] : undefined;
    setChoosingConcept(null);
    mutate('start', {
      concept: { subjectId: ref.subjectId, conceptId: ref.conceptId, conceptVersion: ref.conceptVersion },
      ...((materialId || selected) ? { materialId: materialId ?? selected!.materialId } : {}),
      ...((caseVersion || selected) ? { caseVersion: caseVersion ?? selected!.caseVersion } : {}),
    });
  }
  function canStartConcept(ref: ConceptRef) {
    const choices = catalog?.materialChoices?.filter(item => item.subjectId === ref.subjectId && item.conceptId === ref.conceptId
      && item.conceptVersion === ref.conceptVersion) ?? [];
    if (online) return choices.length > 0;
    return choices.some(choice => catalog?.subjectMap?.subjectId === ref.subjectId && catalog.subjectMap.concepts.some(item => item.conceptId === ref.conceptId && item.conceptVersion === ref.conceptVersion)
      && catalog.subjectMap.links.some(link => link.kind === 'uses-case' && link.role === 'primary' && link.sourceId === ref.conceptId
        && link.sourceVersion === ref.conceptVersion && link.targetId === choice.materialId && link.targetVersion === choice.caseVersion));
  }
  function confidence(concept: Concept, value: SelfConfidence) {
    if (!catalog) return;
    const reports = catalog.profile.reports.filter(item => !(item.subjectId === concept.subjectId && item.conceptId === concept.conceptId));
    reports.push({ subjectId: concept.subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion, selfConfidence: value });
    const body = { requestId: crypto.randomUUID(), revision: catalog.profile.revision, reports, examSubjects: catalog.profile.examSubjects };
    void run(async () => { await request('/api/profile', body); await load(catalog.subjectId); });
  }
  function saveExamSubjects(examSubjects: SubjectId[] | null) {
    if (!catalog) return;
    const body = { requestId: crypto.randomUUID(), revision: catalog.profile.revision, reports: catalog.profile.reports, examSubjects };
    void run(async () => { await request('/api/profile', body); await load(catalog.subjectId); });
  }
  function bulkConfidence(value: SelfConfidence) {
    if (!catalog || !catalog.concepts.length) return;
    const concepts = catalog.concepts;
    const reports = catalog.profile.reports.filter(report => !concepts.some(concept => concept.subjectId === report.subjectId && concept.conceptId === report.conceptId));
    reports.push(...concepts.map(concept => ({ subjectId: concept.subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion, selfConfidence: value })));
    const body = { requestId: crypto.randomUUID(), revision: catalog.profile.revision, reports, examSubjects: catalog.profile.examSubjects };
    void run(async () => { await request('/api/profile', body); await load(catalog.subjectId); });
  }
  const lesson = view === 'case' && session;
  const result = session?.result;
  const subjectLabel = catalog?.subjects.find(item => item.id === catalog.subjectId)?.label ?? '';
  if (deleted) return <main className={styles.main}><h1>学習データを削除しました</h1><p>アカウントとバックアップは削除していません。削除済みデータへの再保存は停止しています。</p><a href="/login">ログイン状態を確認する</a></main>;
  return <div className={styles.app}>
    <LearningCelebration moment={moment} reduced={reducedEffects} />
    <header className={styles.header}><strong>税理士コーチ</strong><span>{online ? 'オンライン・本人用' : '開発用・固定教材モード'}</span>{online && <a href="/login" target="_blank" rel="noopener noreferrer">ログイン状態を別タブで確認</a>}</header>
    <nav className={navigation.appNav} aria-label="学習ナビゲーション">
      {([{ id: 'home', label: 'ホーム' }, { id: 'map', label: '学習地図' }, { id: 'records', label: '学習記録' }] as const).map(item =>
        <button key={item.id} aria-current={view === item.id || (view === 'overview' && item.id === 'map') ? 'page' : undefined} disabled={busy || dirty}
          onClick={() => navigate(item.id)}>{item.label}</button>)}
      <label style={{ marginLeft: 'auto', fontSize: 12 }}><input type="checkbox" checked={reducedEffects} onChange={event => { setReducedEffects(event.target.checked); try { localStorage.setItem('zc-reduced-effects', event.target.checked ? '1' : '0'); } catch {} }} /> 演出を控えめに</label>
    </nav>
    <div className={view === 'map' ? styles.layout : navigation.layoutSingle}>
      {view === 'map' && <aside className={styles.sidebar}><p className={styles.caption}>今日学ぶ科目</p>
        <label className={styles.mobileSubject}>今日学ぶ科目
          <select disabled={busy || dirty} value={catalog?.subjectId ?? 'bookkeeping'} onChange={event => { void run(() => load(event.target.value as SubjectId)); }}>
            {catalog?.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.label}{subject.available ? '' : '（教材準備中）'}</option>)}
          </select>
        </label>
        <nav aria-label="科目">
        {catalog?.subjects.map(subject => <button key={subject.id} disabled={busy || dirty} aria-current={catalog.subjectId === subject.id ? 'page' : undefined}
          onClick={() => { void run(() => load(subject.id)); }}>{subject.label}<small>{subject.available ? '学習できます' : '準備中'}</small></button>)}
      </nav><p className={styles.sideNote}>順番に進める必要はありません。<br />気になる概念から始めましょう。</p></aside>}
      <main className={styles.main} aria-busy={busy}>
        {error && <div role="alert" aria-label="保存エラー" className={styles.error}>{error}<div className={styles.actions}>
          {authenticationNeeded && <a href="/login" target="_blank" rel="noopener noreferrer">入力を残して別タブでログイン</a>}
          {catalogRefreshNeeded ? <button disabled={busy} onClick={() => void run(() => load(catalog?.subjectId))}>最新の教材一覧を読み直す</button> : <>
          <button disabled={busy} onClick={() => retry.current && void run(retry.current)}>同じ操作を再試行</button>
          <button disabled={busy} onClick={() => void run(async () => { if (view !== 'case') await load(catalog?.subjectId); else if (session) {
            const latest = (await request<{ session: CafeView }>(`/api/cafe?caseId=${session.id}`)).session;
            if (session.phase === 'teach_back') { setConflictView(latest); return; }
            // Keep an unsaved choice; only an explicit save may send it with the refreshed revision.
            const localChoice = session.phase === 'decision' ? choice : null;
            accept(latest);
            if (localChoice && latest.status === 'active' && latest.phase === 'decision' && localChoice !== latest.optionId) {
              setChoice(localChoice);
              setNotice('保存状態を更新しました。手元で選んだ回答はまだ保存されていません。「選んだ回答を保存」で保存できます。');
            } else if (localChoice && latest.phase !== 'decision') setNotice('別の画面で相談が先に進んでいたため、保存済みの内容を表示しています。確定した回答は変更していません。');
          } else await load(); })}>入力を残して保存状態を更新</button>
          </>}
        </div></div>}
        {conflictView && <section className={styles.error} aria-label="保存済み説明との比較">
          <h2>どちらの説明を使いますか？</h2>
          <p>確認中は自動保存を止めています。</p>
          <strong>サーバーの保存内容</strong><p className={styles.preserved}>{conflictView.explanation || '説明なし'}</p>
          <strong>手元の入力</strong><p className={styles.preserved}>{explanation || '説明なし'}</p>
          <div className={styles.actions}>
            <button disabled={busy || conflictView.phase !== 'teach_back'} onClick={() => { setSession(conflictView); setConflictView(null); setError(''); }}>手元の説明を保存する</button>
            <button disabled={busy} onClick={() => { accept(conflictView); setConflictView(null); setError(''); }}>保存済みの内容を使う</button>
          </div>
        </section>}
        {notice && <p role="status" className={styles.note}>{notice}</p>}
        {mockExamDirty && view !== 'records' && <p role="status" className={styles.note}>学習記録の「模試の参考記録」に未保存の入力があります。入力は残しているので、学習記録から保存できます。</p>}
        {!catalog && <p role="status">学習内容を読み込んでいます…</p>}
        {catalog && view === 'home' && <section className={navigation.home} aria-label="ホーム">
          <h1>今日は、どこから始めますか？</h1>
          <p className={styles.lead}>簿記の考え方を知り、相談で試し、自分の言葉で説明します。順番を飛ばしてもかまいません。</p>
          {session?.status === 'active' ? <div className={styles.resume}><div><strong>前回の相談の続きがあります</strong><p>{session.prompt.title} · {labels[phaseStep(session.phase)]}</p></div><button className={styles.primary} disabled={busy} onClick={() => navigate('case', session.id)}>続きから再開</button></div>
            : resumeHint && resumeHint.caseId !== session?.id ? <div className={styles.resume}><div><strong>前回の相談の続きがあります</strong><p>保存中の相談ケース · {labels[phaseStep(resumeHint.phase)]}{resumeHint.savedAt && <> · 最終保存 <time dateTime={resumeHint.savedAt}>{new Date(resumeHint.savedAt).toLocaleString('ja-JP')}</time></>}</p></div><button className={styles.primary} disabled={busy || resumeHintChecking} onClick={() => openCase(resumeHint.caseId)}>続きから再開</button></div>
            : <button className={styles.primary} disabled={busy} onClick={() => navigate(online ? 'map' : 'overview')}>簿記の全体像を見る →</button>}
          {resumeHintFailed && session?.status !== 'active' && <p className={styles.note}>保存中の相談を確認できませんでした。学習記録の一覧から再開できます。</p>}
          <ol className={styles.learningRoute} aria-label="学習の順番"><li><span>1</span><strong>概念を知る</strong><small>考え方と試験論点の地図</small></li><li><span>2</span><strong>相談で試す</strong><small>資料を読み、判断する</small></li><li><span>3</span><strong>説明して振り返る</strong><small>自分の言葉と対話</small></li></ol>
          <p className={styles.note}>{online ? catalog.materialNotice : '現在の教材は架空のローカル試用版です。専門審査前で、合格判定には使用しません。'}</p>
          {(session?.status === 'active' || (resumeHint && resumeHint.caseId !== session?.id)) && <button className={styles.linkButton} disabled={busy} onClick={() => navigate('map')}>別の考え方を地図で見る</button>}
        </section>}
        {catalog && view === 'overview' && <>
          <button className={styles.back} disabled={busy || dirty} onClick={() => navigate('map')}>← 学習地図へ</button>
          <h1>簿記の全体像</h1>
          {catalog.subjectId === 'bookkeeping' && !online ? <BookkeepingIntro disabled={busy} onStart={choice => startConcept({ subjectId: catalog.subjectId, conceptId: choice.conceptId, conceptVersion: choice.conceptVersion }, choice.materialId, choice.caseVersion)}
            subjectMap={catalog.subjectMap ?? undefined} availableCases={catalog.materialChoices} /> : <p>この科目の全体像は準備中です。</p>}
          <button className={styles.primary} disabled={busy || dirty} onClick={() => navigate('map')}>学習地図へ進む →</button>
        </>}
        {catalog && (view === 'map' || view === 'records') && <>
          {view === 'map' && <><h1>学習地図</h1>
          {catalog.subjectMap && <LearningAtlas reducedEffects={reducedEffects} key={`${expectedLearnerId ?? 'local'}:${catalog.subjectId}:${catalog.subjectMap.version}`} pack={catalog.subjectMap}
            choices={catalog.materialChoices ?? []} reports={catalog.profile.reports} session={session} online={online}
            expectedLearnerId={online ? expectedLearnerId : undefined} disabled={busy || dirty}
            initialConceptId={mapFocus?.conceptId} initialTopicId={mapFocus?.topicId}
            onOverview={() => navigate('overview')} onStart={(concept, choice) => startConcept({ subjectId: catalog.subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion }, choice.materialId, choice.caseVersion)} />}
          {!online && ['synthetic-bookkeeping-pack-v1','synthetic-bookkeeping-pack-v2'].includes(catalog.subjectMap?.version ?? '') && <BookkeepingPractice disabled={busy || dirty} onStart={(ref, materialId, caseVersion) => mutate('start', {concept:{subjectId:ref.subjectId,conceptId:ref.conceptId,conceptVersion:ref.conceptVersion},materialId,caseVersion})} />}
          {!online && ['synthetic-bookkeeping-pack-v1','synthetic-bookkeeping-pack-v2'].includes(catalog.subjectMap?.version ?? '') && <><MiniExamPanel disabled={busy || dirty} onBusyChange={setBusy} /><BookkeepingTrialReview disabled={busy || dirty} onStart={(ref, materialId, caseVersion) => mutate('start', {concept:{subjectId:ref.subjectId,conceptId:ref.conceptId,conceptVersion:ref.conceptVersion},materialId,caseVersion})} /></>}
          {choosingConcept && <section className={styles.card} aria-label="相談ケースを選ぶ">
            <h2>この概念をどの相談で練習しますか？</h2>
            <div className={styles.actions}>{catalog.materialChoices?.filter(item => item.subjectId === choosingConcept.subjectId && item.conceptId === choosingConcept.conceptId && item.conceptVersion === choosingConcept.conceptVersion).map(item =>
              <button key={item.materialId} disabled={busy} onClick={() => startConcept(item, item.materialId, item.caseVersion)}>{item.label}</button>)}</div>
            <button disabled={busy} onClick={() => setChoosingConcept(null)}>選択を閉じる</button>
          </section>}
          {online && !catalog.subjects.some(subject => subject.available) && <p role="status" className={styles.note}>提供できる承認済み教材は現在0件です。受験予定や学習計画は登録できますが、相談学習・合格判定は準備中です。</p>}
          <p className={styles.lead}>知っていることは飛ばして、曖昧なところをひとつずつ。<br />{online && !catalog.concepts.length ? '教材の公開後に、自信チェックや相談学習を選べます。今は受験予定を登録できます。' : '自信のチェックは任意です。そのまま相談に進めます。'}</p>
          </>}
          {view === 'records' && <><h1>学習記録</h1><p className={styles.lead}>自分の申告・試用結果と、正式な学習証拠を分けて確認します。</p>
          <details className={styles.examPlan}>
            <summary>受験予定の科目（任意・複数選択）<span>{catalog.profile.examSubjects === null ? '未回答' : catalog.profile.examSubjects.length ? `${catalog.profile.examSubjects.length}科目を登録済み` : '受験予定なしとして登録済み'}</span></summary>
            <p className={styles.note}>受験予定を選ぶ欄です。「今日学ぶ科目」や教材への興味登録とは別に保存します。選んでいない科目も学べます。変更はその都度保存されます。</p>
            <fieldset disabled={busy} className={styles.examChoices}><legend>受験予定の科目を選択</legend>
              {catalog.subjects.map(subject => <label key={subject.id}><input type="checkbox" checked={catalog.profile.examSubjects?.includes(subject.id) ?? false}
                onChange={event => saveExamSubjects(event.target.checked ? [...(catalog.profile.examSubjects ?? []), subject.id] : (catalog.profile.examSubjects ?? []).filter(id => id !== subject.id))} />{subject.label}</label>)}
            </fieldset>
            <div className={styles.actions}><button disabled={busy} onClick={() => saveExamSubjects([])}>受験予定なしとして保存</button><button disabled={busy} onClick={() => saveExamSubjects(null)}>未回答に戻す</button></div>
          </details>
          </>}
          {view === 'map' && <>
          <section className={styles.entry}><div className={styles.sectionHeading}><h2>{subjectLabel}</h2><span>自分の感覚で選べば OK</span></div>
            {!!catalog.concepts?.length && <fieldset disabled={busy} className={styles.bulkConfidence}><legend>この科目の自信をまとめて設定（対象 {catalog.concepts.length}件）</legend><div>{selfLabels.map(item => <button key={item.value} onClick={() => bulkConfidence(item.value)}>すべて「{item.label}」</button>)}<button onClick={() => bulkConfidence(null)}>この科目の自信を解除</button></div><p className={styles.note}>表示中の科目の概念だけを変更します。各行から個別に直すこともできます。</p></fieldset>}
            {catalog.concepts?.length ? catalog.concepts.slice(0, expandedSubject === catalog.subjectId ? undefined : 6).map(concept => {
              const selected = catalog.profile.reports.find(item => item.subjectId === concept.subjectId && item.conceptId === concept.conceptId && item.conceptVersion === concept.conceptVersion)?.selfConfidence ?? null;
              const mapped = !online ? catalog.subjectMap?.concepts.find(item => item.conceptId === concept.conceptId) : undefined;
              return <div key={concept.conceptId} className={styles.concept}><div><h3>{mapped?.label ?? concept.label}</h3>{mapped && <p>{mapped.definition}</p>}<small>相談ケース · 約{concept.durationMinutes}分</small></div>
                <fieldset disabled={busy} className={styles.confidence}><legend>この概念の自信</legend>{selfLabels.map(choice => <button key={choice.value} aria-pressed={selected === choice.value} onClick={() => confidence(concept, selected === choice.value ? null : choice.value)}>{choice.label}</button>)}</fieldset>
                <button className={styles.linkButton} disabled={busy || !canStartConcept(concept)} onClick={() => startConcept(concept)}>{canStartConcept(concept) ? 'この相談で学ぶ →' : '教材準備中'}</button>
              </div>;
            }) : <div className={styles.empty}><h3>この科目の教材は準備中です</h3><p>{online ? '提供できる教材が登録されるまで、相談を開始できません。' : '今は簿記論の教材を体験できます。'}教材がない科目の理解度や合格判定は表示しません。</p>{!online && <button disabled={busy} onClick={() => void run(() => load('bookkeeping'))}>簿記論を見る</button>}</div>}
            {catalog.concepts.length > 6 && <button disabled={busy} aria-expanded={expandedSubject === catalog.subjectId} onClick={() => setExpandedSubject(expandedSubject === catalog.subjectId ? null : catalog.subjectId)}>{expandedSubject === catalog.subjectId ? '最初の6単元だけ表示' : `残り${catalog.concepts.length - 6}単元を表示`}</button>}
          </section>
          {!!catalog.concepts?.length && <div className={styles.recommendation}><h3>{catalog.recommendations.length ? 'まずは、この相談から' : '自信のある概念は、おすすめから外しました'}</h3><p>{catalog.recommendations[0]?.reason ?? '必要なら「この相談で学ぶ」から、いつでも復習できます。'}</p><p className={styles.note}>短い理解度チェックは未見問題の準備中です。自信の回答だけで習得済み・合格圏とは判定しません。</p></div>}
          <p className={styles.disclosure}>{catalog.materialNotice} {!online && caseCountNotice(subjectLabel, startableCaseCount(catalog.subjectMap, catalog.materialChoices, catalog.subjectId))}</p>
          </>}
          {view === 'records' && <>
          <DiagnosticPanel key={`diagnostic:${expectedLearnerId ?? 'local'}:${catalog.subjectId}`} subjectId={catalog.subjectId} concepts={catalog.concepts} expectedLearnerId={online ? expectedLearnerId : undefined} disabled={busy || dirty} onBusyChange={setBusy} />
          <LearningEvidencePanel key={`${expectedLearnerId ?? 'local'}:${catalog.subjectId}`} subjectId={catalog.subjectId} concepts={catalog.concepts} expectedLearnerId={online ? expectedLearnerId : undefined} disabled={busy || dirty}
            canStartConcept={canStartConcept}
            onChooseConcept={ref => {
              if (busy || dirty || !catalog.concepts.some(concept => concept.subjectId === ref.subjectId && concept.conceptId === ref.conceptId && concept.conceptVersion === ref.conceptVersion)) return;
              if (canStartConcept(ref)) startConcept(ref);
            }} />
          <LearningHistory expectedLearnerId={online ? expectedLearnerId : undefined} disabled={busy || dirty} onOpen={openCase} />
          <DataControls mode={mode} expectedLearnerId={online ? expectedLearnerId : undefined} disabled={busy || dirty || mockExamDirty} onBusyChange={setBusy} onDeleted={() => { setSession(null); setCatalog(null); setExplanation(''); setDeleted(true); }} />
          </>}
        </>}
        {catalog && <div hidden={view !== 'records'}><WeeklyPlan key={expectedLearnerId ?? 'local'} expectedLearnerId={online ? expectedLearnerId : undefined} disabled={busy || dirty} profileRevision={catalog.profile.revision} onBusyChange={setBusy} onChooseConcept={(ref, materialId, caseVersion) => {
            if (online && materialId && caseVersion) mutate('start', {
              concept: { subjectId: ref.subjectId, conceptId: ref.conceptId, conceptVersion: ref.conceptVersion }, materialId, caseVersion,
            });
            else if (canStartConcept(ref)) startConcept(ref, materialId, caseVersion);
            else setNotice('この教材は現在の画面から開始できません。対象科目を選び直してください。');
          }} /></div>}
        {/* Stay mounted while hidden so an unsaved mock-exam draft survives view changes and browser history. */}
        {catalog && <div hidden={view !== 'records'}><MockExamRecords disabled={busy || dirty} expectedLearnerId={online ? expectedLearnerId : undefined} onBusyChange={setBusy} onDirtyChange={setMockExamDirty} /></div>}
        {lesson && <>
          <button className={styles.back} disabled={busy || dirty} onClick={() => navigate('map')}>← 学習地図へ</button>
          <p className={styles.eyebrow}>簿記論 · 相談ケース</p><h1 ref={heading} tabIndex={-1}>{session.prompt.title}</h1>
          {!online && <details className={navigation.caseContext}><summary>この相談の科目内の位置</summary><ConceptPosition subjectMap={catalog?.subjectMap?.links.some(link => link.kind === 'uses-case' && link.sourceId === session.prompt.conceptId && link.targetId === session.prompt.caseId && link.targetVersion === session.caseVersion) ? catalog.subjectMap : undefined}
            caseId={session.prompt.caseId} caseVersion={session.prompt.caseVersion} conceptId={session.prompt.conceptId} consultationTitle={session.prompt.consultationTitle}
            onOpenMap={(conceptId, topicId) => { setMapFocus({ conceptId, topicId }); navigate('map'); }} /></details>}
          {!online && <details className={navigation.caseContext}><summary>この相談につながるコア概念</summary>{session.prompt.caseId === 'cafe-prepaid' ? <BookkeepingIntro subjectMap={catalog?.subjectMap ?? undefined} availableCases={catalog?.materialChoices} /> : <><h3>{catalog?.subjectMap?.concepts.find(item => item.conceptId === session.prompt.conceptId)?.label ?? '判断を支える考え方'}</h3><p>{catalog?.subjectMap?.concepts.find(item => item.conceptId === session.prompt.conceptId)?.definition}</p><p>{catalog?.subjectMap?.concepts.find(item => item.conceptId === session.prompt.conceptId)?.purpose}</p></>}</details>}
          <ol className={styles.steps} aria-label="学習の流れ">{labels.map((label, index) => {
            const state = session.phase === 'expired' ? 'upcoming' : session.phase === 'completed' || index < phaseStep(session.phase) ? 'complete' : index === phaseStep(session.phase) ? 'current' : 'upcoming';
            return <li key={label} data-state={state} aria-current={state === 'current' ? 'step' : undefined}><span>{state === 'complete' ? '✓' : index + 1}</span>{label}</li>;
          })}</ol>
          {session.phase === 'consultation' && <section className={`${styles.card} ${styles.caseHero}`}><div><p className={styles.caption}>相談者の困りごとを聞く</p><h2>{session.prompt.consultationTitle}</h2><p>{session.prompt.context}</p><div className={journey.mission}><small>今回のミッション</small><strong>{session.prompt.task}</strong><span>資料を読む → 判断する → 相手に説明する</span></div><blockquote className={styles.quote}>{session.prompt.consultation}</blockquote><details className={navigation.caseContext}><summary>相談者に追加で確認する</summary><p>判断する前に、どの条件を確かめたいですか？</p>{session.prompt.facts.map(fact => <details key={fact.label}><summary>{fact.label}を確認する</summary><p>{fact.value}</p></details>)}</details><div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => mutate('save', { revision: session.revision, optionId: null, phase: 'decision' })}>資料を見て判断する →</button></div></div>{!online && ['cafe-prepaid','bakery-equipment','shop-inventory','workshop-depreciation','repair-provision'].includes(session.prompt.caseId) && <Image src={({ 'cafe-prepaid':'/images/cafe-consultation.png','bakery-equipment':'/images/bookkeeping-equipment.png','shop-inventory':'/images/bookkeeping-inventory.png','workshop-depreciation':'/images/bookkeeping-depreciation.png','repair-provision':'/images/bookkeeping-provisions.png' } as Record<string,string>)[session.prompt.caseId]} alt="相談先のお店と資料のイメージ" width={480} height={320} sizes="(max-width: 760px) 100vw, 32vw" />}</section>}
          {session.phase === 'decision' && <section className={styles.card}>
            <h2>資料から判断してみよう</h2><p>{session.prompt.task}</p>
            <details><summary>相談内容を見返す</summary><p>{session.prompt.context}</p><blockquote className={styles.quote}>{session.prompt.consultation}</blockquote></details>
            {!online && session.prompt.caseId === 'cafe-prepaid' && <div className={styles.caseDocuments} role="region" aria-label="相談資料"><article><span>資料 1 · 保険契約</span><strong>店舗火災保険</strong><dl><div><dt>契約期間</dt><dd>12月1日〜翌年11月30日</dd></div><div><dt>保険料</dt><dd>年額120,000円</dd></div></dl></article><article><span>資料 2 · 現在の帳簿</span><strong>12月の記録</strong><table><thead><tr><th scope="col">科目</th><th scope="col">支払額</th></tr></thead><tbody><tr><td>保険料</td><td>120,000円</td></tr></tbody></table><small>全額を保険料として記録済み</small></article><article><span>資料 3 · 決算</span><strong>3月31日</strong><p>ここまでを当期として考えます。</p></article></div>}
            <dl className={styles.facts}>{session.prompt.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
            <p className={styles.note}>{session.prompt.assumption}</p>
            <fieldset disabled={busy || !!error} className={styles.options}><legend>回答を選んでください</legend>
              {session.prompt.options.map(option => <label key={option.id} className={styles.optionLabel}>
                <input type="radio" name="case-choice" value={option.id} checked={choice === option.id}
                  onChange={() => { setChoice(option.id); mutate('save', { revision: session.revision, optionId: option.id, phase: 'decision' }); }} />{option.label}
              </label>)}
            </fieldset>
            <label>回答の自信（任意） <select disabled={busy || !!error} value={answerConfidence} onChange={event => setAnswerConfidence(event.target.value as typeof answerConfidence)}><option value="">選ばずに進む</option><option value="low">自信がない</option><option value="normal">少し自信がある</option><option value="high">理由も説明できる</option></select></label>
            <div className={styles.actions}>
              {!busy && !error && choice && choice !== session.optionId && <button onClick={() => mutate('save', { revision: session.revision, optionId: choice, phase: 'decision' })}>選んだ回答を保存</button>}
              <button className={styles.primary} disabled={busy || !choice || choice !== session.optionId || !!error}
                onClick={answerAndExplain}>この回答で進む →</button>
            </div>
          </section>}
          {session.phase === 'confidence' && <section className={styles.card}><p className={styles.caption}>答えを見る前に · 任意</p><h2>今の回答、どれくらい自信がありますか？</h2><p>正解かどうかとは別に、自分の感覚を残します。</p><div className={styles.actions}>{([{ value: 'low', label: '自信がない' }, { value: 'normal', label: '少し自信がある' }, { value: 'high', label: '理由も説明できる' }] as const).map(item => <button disabled={busy} key={item.value} onClick={() => mutate('confidence', { confidence: item.value })}>{item.label}</button>)}</div><button className={styles.linkButton} disabled={busy} onClick={() => mutate('confidence', { confidence: null })}>選ばずに解説を見る →</button></section>}
          {session.phase === 'feedback' && result && <section className={styles.card}><p className={styles.result}>{result.correct ? '判断できました' : 'ここが理解のチャンスです'}</p><h2>判断の理由を理解する</h2><p className={styles.choiceReflection}>{(session.prompt.caseId === 'cafe-prepaid' ? choiceReflection[result.optionId] : undefined) ?? (result.correct ? '判断の根拠を、自分の言葉でも説明してみましょう。' : '選んだ回答と資料を見比べて、見落とした条件を確かめましょう。')}</p><p>{result.explanation}</p>
            {session.prompt.caseId === 'cafe-prepaid' && result.periods.length > 0 && <><div className={styles.periodLegend}><span>● 当期の費用（12〜3月）</span><span>● 翌期以降の前払費用（4〜11月）</span></div><div className={styles.months} aria-label="教材の期間配分">{result.periods.map((period, i) => <div key={i} aria-label={`${period.month}月：${period.allocation}、${period.amount.toLocaleString('ja-JP')}円`} className={period.allocation === '当期の費用' ? styles.currentPeriod : styles.nextPeriod}><strong>{period.month}月</strong><small>{period.allocation === '当期の費用' ? '当期' : '翌期'}</small><small>{period.amount.toLocaleString('ja-JP')}円</small></div>)}</div><div className={styles.periodTotals}><div><span>当期の費用 · 4か月</span><strong>40,000円</strong></div><div><span>翌期以降に残す · 8か月</span><strong>80,000円</strong></div></div></>}
            {session.prompt.caseId !== 'cafe-prepaid' && <div className={journey.reason} aria-label="判断の根拠の図"><article><small>① 資料の条件</small><strong>{session.prompt.facts[0]?.label}</strong><p>{session.prompt.facts[0]?.value}</p></article><article><small>② 見分けるポイント</small><strong>{result.checkpoints[0]}</strong></article><article><small>③ 判断の根拠</small><strong>{result.checkpoints[1] ?? result.checkpoints[0]}</strong><p>{result.checkpoints[2]}</p></article></div>}
            {result.misconceptionCandidate && <p className={styles.note}>{result.misconceptionCandidate} あなたの考え方を断定するものではありません。</p>}
            <div className={styles.insight}><strong>考え方のポイント</strong><ul>{result.checkpoints.map(item => <li key={item}>{item}</li>)}</ul></div>
            {result.learningNotes && <section aria-label="原則の適用範囲と試験への接続"><h3>原則の適用範囲・例外</h3>{result.learningNotes.exceptions.length ? <ul>{result.learningNotes.exceptions.map(item => <li key={item}>{item}</li>)}</ul> : <p>この教材には追加の例外説明が登録されていません。例外が存在しないという意味ではありません。</p>}<h3>試験問題ではどう問われる？</h3><p>{result.learningNotes.examTranslation}</p></section>}
            <div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => progress('teach_back')}>自分の言葉で説明してみる →</button></div></section>}
          {session.phase === 'teach_back' && result && <section className={styles.card}><p className={styles.caption}>教えることで、理解を確かめる</p><h2>あなたの言葉で伝えてみよう</h2><blockquote className={styles.quote}>{result.teachBack}</blockquote><label htmlFor="teach-back">相談者への説明（任意・2,000文字まで）</label><textarea id="teach-back" maxLength={2000} disabled={busy} value={explanation} onChange={event => setExplanation(event.target.value)} placeholder="どの事実から、どう考えたかを、自分の言葉で…" /><p className={styles.note}>{explanation.length} / 2,000文字 · {dirty ? '未保存です。下書きを保存すると再開できます。' : '保存済みの内容です。'}</p><button className={styles.linkButton} disabled={busy} onClick={() => setShowQuestion(true)}>相談者からの追加質問を見る</button>{showQuestion && <blockquote className={styles.quote}>{result.followUp}</blockquote>}<p className={styles.note}>追加質問は固定教材です。保存後の「説明をもう一歩深める」では、接続が有効な場合にAIの問い返しを利用できます。採点には使いません。</p><div className={styles.actions}><button disabled={busy} onClick={() => progress('teach_back')}>下書きを保存</button><button className={styles.primary} disabled={busy} onClick={() => progress('reflection')}>保存して振り返る →</button></div></section>}
          {session.phase === 'reflection' && result && <section className={styles.card}><h2>説明に、これらのポイントが入っていますか？</h2><ul className={styles.checkpoints}>{result.checkpoints.map(item => <li key={item}>{item}</li>)}</ul>{session.explanation && <div className={styles.insight}><strong>あなたの説明</strong><p className={styles.preserved}>{session.explanation}</p></div>}<p>相談者が「次に何をするか」を理解できる説明になっているか、読み返してみましょう。</p><p className={styles.note}>これは練習の振り返りです。合格ラインの評価には使いません。説明の下書きは完了時に削除され、回答結果だけが残ります。</p><div className={styles.actions}><button disabled={busy} onClick={() => progress('teach_back')}>説明を直す</button><button className={styles.primary} disabled={busy} onClick={() => mutate('complete')}>この相談を完了する</button></div></section>}

          {session.phase === 'completed' && <section className={`${styles.card} ${journey.achievement}`}><p className={styles.result}>相談ケース完了</p><h2>相談を最後までやり遂げました。</h2><p>資料を読む → 判断する → 説明する → 振り返る</p><p>「{session.prompt.title}」の考え方を、次の別の問題でも確かめてみましょう。</p><p className={styles.note}>合格判定は未実施です。この1ケースの正誤だけでは習得や合格圏を判定しません。</p><div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => navigate('map')}>学習地図へ戻る</button></div></section>}
          {session.phase === 'expired' && <section className={styles.card}><h2>この下書きの保存期限が切れました</h2><p>下書きは最終更新から7日間保存されます。学習地図で教材を選び、新しい相談としてやり直せます。</p><button className={styles.primary} disabled={busy} onClick={() => navigate('map')}>学習地図で教材を選ぶ</button></section>}
          <p className={styles.saveStatus} role="status">{busy ? '保存・読込中…' : dirty ? '未保存の入力があります' : session.savedAt ? `保存済み · ${new Date(session.savedAt).toLocaleString('ja-JP')}` : 'このブラウザーから再開できます'}{session.status === 'active' && ' · 下書きの保存期間は最終更新から7日間'}</p>
        </>}
        {session?.status === 'active' && result && <div hidden={view !== 'case' || !['feedback', 'teach_back'].includes(session.phase)}><AiCoachPanel key={`${expectedLearnerId ?? 'local'}:${session.id}`} session={session} disabled={busy || dirty || !!error || !!conflictView} expectedLearnerId={online ? expectedLearnerId : undefined} onBusyChange={setBusy} /></div>}
      </main>
    </div>
  </div>;
}
