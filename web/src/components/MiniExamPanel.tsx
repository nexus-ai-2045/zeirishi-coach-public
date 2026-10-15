'use client';
import { useEffect, useRef, useState } from 'react';
import type { DiagnosticRecord } from '../server/diagnostic-service';
import styles from './CafeWorkspace.module.css';

type Kind = 'before' | 'after';
const label = (kind: Kind) => kind === 'before' ? '開始前' : '終了時';
export function MiniExamPanel({ disabled = false, onBusyChange }: { disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [record, setRecord] = useState<DiagnosticRecord | null>(null);
  const [kind, setKind] = useState<Kind>('before');
  const [history, setHistory] = useState<{ kind: Kind; item: DiagnosticRecord }[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const lock = useRef(false);
  const retry = useRef<{ kind: Kind; suffix: string; body?: Record<string, unknown> } | null>(null);
  const deadlineChecked = useRef<string | null>(null);
  const view = record?.view;
  const open = !!view && ['active', 'paused'].includes(view.status);
  async function request(nextKind: Kind, suffix = '', body?: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusyChange?.(true); setError('');
    retry.current = { kind: nextKind, suffix, body };
    try {
      const response = await fetch(`/api/mini-exam?kind=${nextKind}${suffix}`, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('MINI_EXAM_FAILED');
      const data: { item?: DiagnosticRecord; items?: DiagnosticRecord[] } = await response.json();
      if (data.item) { setRecord(data.item); setKind(nextKind); setAnswer(''); setClock(Date.now()); }
      if (data.items) setHistory(previous => [...previous.filter(entry => entry.kind !== nextKind), ...data.items!.map(item => ({ kind: nextKind, item }))]);
      retry.current = null;
    } catch { setError('保存・読込を確認できませんでした。同じ操作を再試行するか、保存状態を確認してください。'); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  function command(action: string, extra: Record<string, unknown> = {}) {
    if (record) void request(kind, '', { action, requestId: crypto.randomUUID(), sessionId: record.id, revision: record.revision, ...extra });
  }
  function start(nextKind: Kind) {
    void request(nextKind, '', { action: 'start', requestId: crypto.randomUUID(), mode: 'detailed', subjectId: 'bookkeeping', conceptId: null });
  }
  useEffect(() => {
    if (!view?.deadline || !open) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [view?.deadline, open]);
  const remaining = view?.deadline ? Math.max(0, Math.ceil((Date.parse(view.deadline) - clock) / 1000)) : null;
  useEffect(() => {
    if (record && remaining === 0 && open && !busy && !error && deadlineChecked.current !== record.id) {
      deadlineChecked.current = record.id;
      void request(kind, `&id=${encodeURIComponent(record.id)}`);
    }
  }, [record?.id, remaining, open, busy, error, kind]);
  const blocked = disabled || busy || !!error;
  const confidence = view?.attempts.find(item => item.acceptedAt && !item.confidenceRecorded);
  const results = view && 'trialResults' in view ? view.trialResults : [];
  const resultsReady = !!view && !confidence && (['completed', 'expired'].includes(view.status) || (view.status === 'unavailable' && results.length > 0));
  return <details className={styles.examPlan}>
    <summary>開始前・終了時のミニ演習（各6問・12分）</summary>
    <p>6概念の原稿試用です。専門審査前のため、正式診断・習熟・科目合格の証拠には使えません。総合模試ではありません。開始前と終了時は別の問題を使います。</p>
    <p>ヒントなしで答えます。採点・正答・解説は終了後、提出済みの回答の自信をすべて確定してから表示します。中断しても12分の時計は止まりません。</p>
    <fieldset className={styles.evidenceFields} disabled={blocked}><legend>一周の確認</legend>
      <button disabled={open} onClick={() => start('before')}>開始前の6問を始める</button>
      <button disabled={open} onClick={() => start('after')}>終了時の6問を始める</button>
      <button onClick={() => void request('before')}>保存した開始前の演習を見る</button>
      <button onClick={() => void request('after')}>保存した終了時の演習を見る</button>
    </fieldset>
    {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => retry.current && void request(retry.current.kind, retry.current.suffix, retry.current.body)}>同じ操作を再試行</button>{record && <button disabled={busy} onClick={() => void request(kind, `&id=${encodeURIComponent(record.id)}`)}>演習の保存状態を確認</button>}</div>}
    {history.length > 0 && <ul>{history.map(entry => <li key={entry.item.id}><button disabled={blocked} onClick={() => void request(entry.kind, `&id=${encodeURIComponent(entry.item.id)}`)}>{label(entry.kind)}：{new Date(entry.item.updatedAt).toLocaleString('ja-JP')} の演習を開く</button></li>)}</ul>}
    {view && <section aria-label="ミニ演習の問題と結果">
      <h3>{label(kind)}のミニ演習{resultsReady ? 'の結果' : ''}</h3>
      <p>回答済み {view.attempts.filter(item => item.acceptedAt).length} / 6問</p>
      {open && remaining !== null && <p>残り時間の目安：{Math.floor(remaining / 60)}分{remaining % 60}秒。提出はサーバー時刻で判定します。</p>}
      {view.status === 'unavailable' && <p>未見の問題がないか、教材の版が変更されています。過去の回答記録は保存されています。</p>}
      {view.status === 'expired' && <p>12分の期限に達しました。提出済みの回答だけを採点します。</p>}
      {view.currentQuestion && <fieldset className={styles.evidenceFields} disabled={blocked}><legend>{view.currentQuestion.prompt}</legend>
        {view.currentQuestion.options.map(option => <label key={option.id}><span><input type="radio" name={`mini-${record!.id}`} checked={answer === option.id} onChange={() => setAnswer(option.id)} /> {option.label}</span></label>)}
        <button disabled={!answer} onClick={() => command('submit', { instanceId: view.currentQuestion!.instanceId, answerId: answer, hintsUsed: false })}>ミニ演習の回答を確定</button>
        <button onClick={() => command('reveal', { instanceId: view.currentQuestion!.instanceId })}>この問は回答せず進む</button>
      </fieldset>}
      {confidence && !open && <p>結果を見る前に、提出済みの回答の自信を確定してください。「自信は記録しない」も選べます。</p>}
      {confidence && <fieldset className={styles.evidenceFields} disabled={blocked}><legend>答えを確定しました。自信を記録しますか？</legend>
        {([{ value: 'low', text: '低い' }, { value: 'normal', text: '普通' }, { value: 'high', text: '高い' }, { value: null, text: '自信は記録しない' }] as const).map(item => <button key={item.text} onClick={() => command('confidence', { instanceId: confidence.instanceId, value: item.value })}>{item.text}</button>)}
      </fieldset>}
      <div className={styles.actions}>
        {view.status === 'active' && !view.currentQuestion && !confidence && <button disabled={blocked} onClick={() => command('present')}>次のミニ演習問題へ</button>}
        {view.status === 'active' && <button disabled={blocked} onClick={() => command('pause')}>ミニ演習を保存して中断</button>}
        {view.status === 'paused' && <button disabled={blocked} onClick={() => command('resume')}>ミニ演習を再開</button>}
        {open && <button disabled={blocked} onClick={() => command('finish')}>ミニ演習をここまでで終了</button>}
      </div>
      {resultsReady && <><p>独力で提出した回答：{results.reduce((total, result) => total + result.earned, 0)} / {results.reduce((total, result) => total + result.maxScore, 0)}点。未回答は未確認です。</p>
        <ol>{results.map(result => <li key={result.questionId}>{result.earned} / {result.maxScore}点。正答：{result.correctAnswers.join('、')}。{result.explanation}</li>)}</ol>
      </>}
      <ul>{view.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    </section>}
  </details>;
}
