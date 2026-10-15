'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Answer, SessionView } from '../domain/types';
import { CaseMaterials } from './CaseMaterials';

const empty: Answer = { insurance: '', equipment: '', explanation: '' };
export function StudyWorkspace() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [answer, setAnswer] = useState<Answer>(empty);
  const [message, setMessage] = useState('読み込み中…');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState<SessionView | null>(null);
  const pending = useRef<{ action: string; requestId: string; answer: Answer; sessionId?: string; revision?: number } | null>(null);
  const lock = useRef(false);
  const dirty = useRef(false);
  const current = useRef({ session, answer });
  current.current = { session, answer };

  const restore = useCallback(async () => {
    const id = current.current.session?.id ?? new URL(location.href).searchParams.get('sessionId');
    const response = await fetch(`/api/study${id ? `?sessionId=${encodeURIComponent(id)}` : ''}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? '復元できませんでした。');
    setError('');
    if (dirty.current && data.session) { setCandidate(data.session); setMessage('手元の編集を保持しています。保存済み答案と比較してください。'); return; }
    setSession(data.session);
    if (data.session) { setAnswer(data.session.answer); const url = new URL(location.href); url.searchParams.set('sessionId', data.session.id); history.replaceState(null, '', url); }
    setMessage(data.session?.savedAt ? '保存確認済みの答案を復元しました。' : 'まだ保存していません');
    dirty.current = false;
  }, []);
  useEffect(() => { restore().catch(e => setError(String(e.message))).finally(() => setReady(true)); }, [restore]);

  const act = useCallback(async (action: 'start' | 'save' | 'submit') => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const state = current.current;
    const payload = pending.current ?? { action, requestId: crypto.randomUUID(), answer: state.answer, sessionId: state.session?.id, revision: state.session?.revision };
    pending.current = payload;
    try {
      const body = payload.action === 'start' ? { action: payload.action, requestId: payload.requestId }
        : payload.action === 'submit' ? { action: payload.action, requestId: payload.requestId, answer: payload.answer, sessionId: payload.sessionId } : payload;
      const response = await fetch('/api/study', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { if (response.status < 500) pending.current = null; throw new Error(data.error ?? '処理できませんでした。'); }
      pending.current = null;
      setSession(data.session); setAnswer(data.session.answer); dirty.current = false;
      setCandidate(null);
      const url = new URL(location.href); url.searchParams.set('sessionId', data.session.id); history.replaceState(null, '', url);
      setMessage(payload.action === 'submit' ? '提出を受け付けました。' : payload.action === 'start' ? 'まだ保存していません' : 'サーバーへの保存を確認しました。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信に失敗しました。');
      setMessage(pending.current ? '結果が未確認です。再試行は同じ内容・同じIDで行います。' : '未保存の編集は画面上に残っています。必要ならコピーしてください。');
    } finally { lock.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    const interval = setInterval(() => { if (dirty.current && current.current.session?.status === 'active' && !pending.current && !candidate && !error) void act('save'); }, 10000);
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.current || pending.current) e.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { clearInterval(interval); window.removeEventListener('beforeunload', beforeUnload); };
  }, [act, candidate, error]);
  function edit(field: keyof Answer, value: string) { dirty.current = true; setAnswer(a => ({ ...a, [field]: value })); setMessage('未保存の編集があります'); }
  const disabled = busy || session?.status !== 'active' || pending.current !== null || candidate !== null;
  const step = session?.result ? 3 : answer.insurance || answer.equipment ? 2 : 1;
  return <main>
    <h1>利益と現金は、なぜ違う？</h1>
    <p className="lead">資料を読み、今期の費用を考えてみましょう。</p>
    <ol className="steps" aria-label="案件の進み方">{['資料を読む','答案をつくる','振り返る'].map((label,i) => <li key={label} aria-current={step === i+1 ? 'step' : undefined}><span>{i+1}</span>{label}</li>)}</ol>
    <div className="workspace"><CaseMaterials />
      <section className="answer" aria-labelledby="answer-heading"><h2 id="answer-heading">今期の費用はいくら？</h2>
        {!session && ready && <button className="primary start" disabled={busy || Boolean(error)} onClick={() => void act('start')}>案件を始める</button>}
        <form onSubmit={e => { e.preventDefault(); void act('submit'); }}>
          <label className="money">保険料（3か月分）<span><input aria-label="保険料（3か月分）" inputMode="numeric" maxLength={20} value={answer.insurance} onChange={e => edit('insurance',e.target.value)} disabled={disabled} />円</span></label>
          <label className="money">備品（1年分）<span><input aria-label="備品（1年分）" inputMode="numeric" maxLength={20} value={answer.equipment} onChange={e => edit('equipment',e.target.value)} disabled={disabled} />円</span></label>
          <label className="explanation">どう考えた？（任意）<textarea maxLength={2000} value={answer.explanation} onChange={e => edit('explanation',e.target.value)} disabled={disabled} /></label>
          <p className="status" role="status">{message}{session?.savedAt && <time dateTime={session.savedAt}> 最終保存 {new Date(session.savedAt).toLocaleTimeString('ja-JP')}</time>}</p>
          {error && <div className="error" role="alert">{error}<button type="button" onClick={() => pending.current ? void act('save') : void restore().catch(e => setError(e.message))}>状態を確認・再試行</button></div>}
          {candidate && <section aria-label="保存済み答案との比較"><h3>サーバーに保存済みの答案</h3><p>保険料：{candidate.answer.insurance || '未入力'} 円／備品：{candidate.answer.equipment || '未入力'} 円</p><p>{candidate.answer.explanation || '説明なし'}</p><button type="button" disabled={candidate.status !== 'active'} onClick={() => { setSession(candidate); setCandidate(null); dirty.current = true; setMessage('手元の答案を保持しました。下書きを保存してください。'); }}>手元の答案を保持する</button><button type="button" onClick={() => { setSession(candidate); setAnswer(candidate.answer); setCandidate(null); dirty.current = false; setMessage('サーバー版に置き換えました。'); }}>サーバー版に置き換える</button></section>}
          <div className="actions"><button type="button" onClick={() => void act('save')} disabled={disabled}>下書きを保存</button><button className="primary" type="submit" disabled={disabled}>提出して振り返る</button></div>
        </form>
      </section>
    </div>
    <section className="review" aria-labelledby="review-heading"><h2 id="review-heading">次の復習</h2>
      {!session?.result ? <p>提出すると、概念ごとの復習予定が表示されます。</p> : <><p className="result">今回の部分点：{session.result.earned} / {session.result.max} <small>テスト配点・合格判定ではありません</small></p><ul>{session.result.items.map(item => <li key={item.conceptId}><h3>{item.label}：{item.earned} / {item.max}</h3><p>{item.feedback}</p><p>次回：{new Date(item.dueAt).toLocaleDateString('ja-JP')}（テスト用予定）</p></li>)}</ul></>}
    </section>
  </main>;
}
