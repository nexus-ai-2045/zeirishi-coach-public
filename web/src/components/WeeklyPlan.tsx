'use client';

import { useEffect, useRef, useState } from 'react';
import { SUBJECTS, type ConceptRef } from '../domain/onboarding';
import type { WeeklyPlanResponse as ResponseView } from '../server/weekly-plan-service';
import styles from './WeeklyPlan.module.css';

type SaveBody = { requestId: string; revision: number; weeklyMinutes: number; excludedIds: string[]; adjustmentReason: string };
const subjectName = (id: string) => SUBJECTS.find(subject => subject.id === id)?.label ?? id;

export function WeeklyPlan({ disabled, profileRevision, onBusyChange, onChooseConcept, expectedLearnerId }: {
  disabled: boolean; profileRevision: number; onBusyChange: (value: boolean) => void; onChooseConcept: (ref: ConceptRef, materialId?: string, caseVersion?: string) => void; expectedLearnerId?: string;
}) {
  const [view, setView] = useState<ResponseView | null>(null);
  const [minutes, setMinutes] = useState('60');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [authNeeded, setAuthNeeded] = useState(false);
  const lock = useRef(false);
  const lastBody = useRef<SaveBody | null>(null);
  const record = view?.planRecord;
  const stale = !!record && (view?.stale || record.profileRevision !== profileRevision);
  const dirty = !!view && (minutes !== String(record?.weeklyMinutes ?? 60)
    || reason !== (record?.adjustmentReason ?? '')
    || JSON.stringify([...excluded].sort()) !== JSON.stringify([...(record?.excludedIds ?? [])].sort()));
  useEffect(() => {
    if (!dirty && !lastBody.current) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending, error]);

  async function execute(body?: SaveBody, restoreInputs = false) {
    if (lock.current || disabled) return;
    lock.current = true; setPending(true); onBusyChange(true); setError('');
    try {
      const response = await fetch('/api/plan', { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(30000),
        headers: { ...(expectedLearnerId ? { 'X-Zeirishi-Learner': expectedLearnerId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        if (expectedLearnerId && ([401, 403].includes(response.status) || failure.error === 'AUTH_IDENTITY_CHANGED')) { setAuthNeeded(true); throw new Error('auth'); }
        if (response.status === 409) { setConflict(true); throw new Error('conflict'); }
        throw new Error('request');
      }
      const next = await response.json() as ResponseView;
      setView(next); setConflict(false); setAuthNeeded(false); lastBody.current = null;
      if (restoreInputs && next.planRecord) {
        setMinutes(String(next.planRecord.weeklyMinutes)); setExcluded(next.planRecord.excludedIds); setReason(next.planRecord.adjustmentReason);
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'auth' ? '表示中の本人とログイン状態を確認できません。入力は保持しています。元の利用者でログインし直してください。' : cause instanceof Error && cause.message === 'conflict'
        ? '別の画面で計画が更新されています。自動上書きはしません。保存版を読み直してから調整してください。'
        : '計画の処理結果を確認できませんでした。入力は保持しています。接続を確認して再試行できます。');
    } finally { lock.current = false; setPending(false); onBusyChange(false); }
  }
  function save() {
    const value = Number(minutes);
    if (!minutes.trim() || !Number.isSafeInteger(value) || value < 0 || value > 10080 || (excluded.length > 0 && !reason.trim())) {
      setError('週の時間は0〜10,080の整数で入力してください。教材を除外する場合は理由も入力してください。'); return;
    }
    const body = { requestId: crypto.randomUUID(), revision: record?.revision ?? 0, weeklyMinutes: value, excludedIds: excluded, adjustmentReason: reason };
    lastBody.current = body; void execute(body);
  }
  return <details className={styles.panel} onToggle={event => { if (event.currentTarget.open && !view && !pending && !error) void execute(undefined, true); }}>
    <summary>今週の学習計画</summary>
    <p>受験予定と用意できている教材をもとに、今週の時間に収まる計画を作ります。合格判定ではありません。</p>
    {pending && <p role="status">計画を読み込み・保存中…</p>}
    {error && <div role="alert" className={styles.error}><p>{error}</p>{!conflict && <button disabled={disabled || pending} onClick={() => void execute(lastBody.current ?? undefined, !view)}>同じ計画操作を再試行</button>}
      {authNeeded && <a href="/login" target="_blank" rel="noopener noreferrer">入力を残して別タブでログイン</a>}
      <button disabled={disabled || pending} onClick={() => void execute(undefined, true)}>入力を保存版に戻して読み直す</button></div>}
    {view && <>
      {view.autoSkippedIds.length > 0 && <p>「説明できる」と回答した単元は計画から自動で省略します。確認したくなったら、上の単元一覧から直接学べます。</p>}
      {error && lastBody.current && !conflict && <p>保存結果が未確認のため、入力の変更は保留しています。同じ操作の再試行か、保存版の読込みで確認してください。</p>}
      <fieldset disabled={disabled || pending || conflict || (!!error && !!lastBody.current)} className={styles.fields}>
        <legend>今週の計画を調整</legend>
        <label>今週の学習時間（分）<input type="number" min={0} max={10080} step={1} value={minutes} onChange={event => setMinutes(event.target.value)} /></label>
        <p>0分でも保存できます。今週使える時間だけを入力してください。</p>
        {view.candidates?.length > 0 && <fieldset className={styles.exclusions}><legend>今週は外す教材（任意）</legend>{view.candidates.map(candidate => <label key={candidate.id}><input type="checkbox" checked={excluded.includes(candidate.id)} onChange={event => setExcluded(event.target.checked ? [...excluded, candidate.id] : excluded.filter(id => id !== candidate.id))} />{candidate.label}（{candidate.minutes}分）</label>)}</fieldset>}
        <label>計画を調整する理由（除外時は必須・500文字まで）<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
        <button className={styles.primary} onClick={save}>{record ? '今の条件で再計画する' : '今週の計画を作る'}</button>
      </fieldset>
      {!record && <p>今週の計画はまだ作成していません。</p>}
      {record && <section className={styles.result} aria-label="保存済みの週計画">
        <h3>{record.plan.weekStart}からの週計画</h3>
        {stale && <p className={styles.warning}>受験予定・自信・教材などの条件が変わっています。これは保存時点の計画です。「今の条件で再計画する」で更新できます。</p>}
        {record.plan.status === 'subjects-unset' && <p>受験予定が未回答です。上の「受験予定の科目」で選ぶと、その科目の計画を作れます。</p>}
        {record.plan.status === 'no-subjects' && <p>受験予定なしとして登録されています。科目の割当はありません。個別の相談は直接学べます。</p>}
        <p>予定 {record.plan.allocatedMinutes}分 / 設定 {record.plan.weeklyMinutes}分 · 未割当 {record.plan.remainingMinutes}分</p>
        <ul>{record.plan.sessions.map(item => <li key={item.id}><strong>{item.label}</strong><span>{item.minutes}分 · {item.qualification === 'practice' ? '練習枠（合格判定には使いません）' : '評価対象の教材'}</span><p>{item.reason}</p><button disabled={disabled || pending || stale} onClick={() => onChooseConcept({ subjectId: item.subjectId, conceptId: item.conceptId, conceptVersion: item.conceptVersion }, item.caseVersion ? item.id : undefined, item.caseVersion)}>この計画の相談を始める</button></li>)}</ul>
        {record.plan.unavailableSubjects.length > 0 && <p>教材未準備・除外などで候補なし：{record.plan.unavailableSubjects.map(subjectName).join('、')}</p>}
        {record.plan.deferredSubjects.length > 0 && <p>今週の時間に収まらなかった科目：{record.plan.deferredSubjects.map(subjectName).join('、')}</p>}
        {record.plan.remainingMinutes > 0 && <p>教材不足や時間の端数は、無理に問題で埋めません。</p>}
      </section>}
    </>}
  </details>;
}
