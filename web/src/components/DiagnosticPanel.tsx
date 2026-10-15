'use client';
import { useEffect, useRef, useState } from 'react';
import type { Concept, SubjectId } from '../domain/onboarding';
import type { DiagnosticRecord } from '../server/diagnostic-service';
import styles from './CafeWorkspace.module.css';

export function DiagnosticPanel({ subjectId, concepts, disabled, expectedLearnerId, onBusyChange }: {
  subjectId: SubjectId; concepts: Concept[]; disabled: boolean; expectedLearnerId?: string; onBusyChange: (busy: boolean) => void;
}) {
  const [record, setRecord] = useState<DiagnosticRecord | null>(null);
  const [history, setHistory] = useState<DiagnosticRecord[]>([]);
  const [conceptId, setConceptId] = useState(concepts[0]?.conceptId ?? '');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const retry = useRef<{ url: string; body?: Record<string, unknown> } | null>(null);
  const lock = useRef(false);
  const deadlineChecked = useRef<string | null>(null);
  const view = record?.view;
  useEffect(() => {
    if (!view?.deadline || !['active', 'paused'].includes(view.status)) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [view?.deadline, view?.status]);
  async function request(url: string, body?: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(''); retry.current = { url, body };
    try {
      const response = await fetch(url, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: { ...(expectedLearnerId ? { 'X-Zeirishi-Learner': expectedLearnerId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('DIAGNOSTIC_FAILED');
      const data: { item?: DiagnosticRecord; items?: DiagnosticRecord[] } = await response.json();
      if (data.item) { setRecord(data.item); setAnswer(''); }
      if (data.items) setHistory(data.items.filter(item => item.view.status !== 'unavailable'));
      retry.current = null;
    } catch { setError('保存・読込を確認できませんでした。選択はこの画面に残っています。同じ操作を再試行するか、保存状態を確認してください。'); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  function command(action: string, extra: Record<string, unknown> = {}) {
    if (!record) return;
    void request('/api/diagnostic', { action, requestId: crypto.randomUUID(), sessionId: record.id, revision: record.revision, ...extra });
  }
  const awaitingConfidence = view?.attempts.find(item => item.acceptedAt && !item.confidenceRecorded);
  const remaining = view?.deadline ? Math.max(0, Math.ceil((Date.parse(view.deadline) - clock) / 1000)) : null;
  useEffect(() => {
    if (record && remaining === 0 && !busy && !error && ['active', 'paused'].includes(record.view.status) && deadlineChecked.current !== record.id) {
      deadlineChecked.current = record.id;
      void request(`/api/diagnostic?id=${encodeURIComponent(record.id)}`);
    }
  }, [record?.id, view?.status, remaining, busy, error]);
  const blocked = disabled || busy || !!error;
  return <details className={styles.examPlan}>
    <summary>理解度を短く確認する（任意）</summary>
    <p>知っている単元は飛ばせます。診断を受けなくても相談学習を始められます。</p>
    <fieldset className={styles.evidenceFields} disabled={blocked}><legend>確認方法を選ぶ</legend>
      <label>短く確認する単元<select value={conceptId} onChange={event => setConceptId(event.target.value)}>
        {!concepts.length && <option value="">教材準備中</option>}{concepts.map(concept => <option key={concept.conceptId} value={concept.conceptId}>{concept.label}</option>)}
      </select></label>
      <button disabled={!conceptId} onClick={() => void request('/api/diagnostic', { action: 'start', requestId: crypto.randomUUID(), mode: 'short', subjectId, conceptId })}>短く確認する（最大3問）</button>
      <button onClick={() => void request('/api/diagnostic', { action: 'start', requestId: crypto.randomUUID(), mode: 'detailed', subjectId, conceptId: null })}>詳しく確認する（出題は最大8分）</button>
      <button onClick={() => void request('/api/diagnostic')}>保存した診断を確認</button>
    </fieldset>
    {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => retry.current && void request(retry.current.url, retry.current.body)}>診断の同じ操作を再試行</button>{record && <button disabled={busy} onClick={() => void request(`/api/diagnostic?id=${encodeURIComponent(record.id)}`)}>診断の保存状態を確認</button>}</div>}
    {history.length > 0 && <ul>{history.map(item => <li key={item.id}><button disabled={blocked} onClick={() => void request(`/api/diagnostic?id=${encodeURIComponent(item.id)}`)}>{new Date(item.updatedAt).toLocaleString('ja-JP')} の確認を開く</button></li>)}</ul>}
    {view && <section aria-label="理解度確認の結果">
      <h3>{view.status === 'unavailable' ? '確認問題準備中です' : view.status === 'expired' ? '診断の制限時間に達しました' : '暫定の理解度確認'}</h3>
      {remaining !== null && ['active', 'paused'].includes(view.status) && <p>残り時間の目安：{Math.floor(remaining / 60)}分{remaining % 60}秒。中断しても時計は止まりません。受理はサーバー時刻で判定します。</p>}
      {view.currentQuestion && <fieldset className={styles.evidenceFields} disabled={blocked}>
        <legend>{view.currentQuestion.prompt}</legend>
        {view.currentQuestion.options.map(option => <label key={option.id}><span><input type="radio" name={`diagnostic-${record!.id}`} value={option.id} checked={answer === option.id} onChange={() => setAnswer(option.id)} /> {option.label}</span></label>)}
        <button disabled={!answer} onClick={() => command('submit', { instanceId: view.currentQuestion!.instanceId, answerId: answer, hintsUsed: false })}>診断の回答を確定</button>
        <button onClick={() => command('reveal', { instanceId: view.currentQuestion!.instanceId })}>この問は回答せず進む</button>
      </fieldset>}
      {awaitingConfidence && <fieldset className={styles.evidenceFields} disabled={blocked}><legend>答えを確定しました。どのくらい自信がありますか？</legend>
        {([{ value: 'low', label: '低い' }, { value: 'normal', label: '普通' }, { value: 'high', label: '高い' }, { value: null, label: '選ばず確認する' }] as const).map(item => <button key={item.label} onClick={() => command('confidence', { instanceId: awaitingConfidence.instanceId, value: item.value })}>{item.label}</button>)}
      </fieldset>}
      {view.attempts.filter(item => item.confidenceRecorded).map(item => <p key={item.instanceId}>{item.conceptId}：{item.earned} / {item.maxScore}点{item.errorReason && `。確認点：${item.errorReason}`}</p>)}
      <div className={styles.actions}>
        {view.status === 'active' && !view.currentQuestion && !awaitingConfidence && <button disabled={blocked} onClick={() => command('present')}>次の確認へ</button>}
        {view.status === 'active' && <button disabled={blocked} onClick={() => command('pause')}>保存して一旦中断</button>}
        {view.status === 'paused' && <button disabled={blocked} onClick={() => command('resume')}>診断を再開</button>}
        {['active', 'paused'].includes(view.status) && <button disabled={blocked} onClick={() => command('finish')}>ここまでで確認を終える</button>}
      </div>
      <ul>{view.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      {view.risks.length > 0 && <><h4>今回の回答から確認したいこと</h4><ul>{view.risks.map(item => <li key={item.evidenceId}>{item.reason}</li>)}</ul></>}
      <p className={styles.note}>科目の合格判定ではありません。閉じて、好きな単元の相談学習を続けられます。</p>
    </section>}
  </details>;
}
