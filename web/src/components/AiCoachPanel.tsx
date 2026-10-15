'use client';
import { useEffect, useRef, useState } from 'react';
import type { CafeView } from '../server/cafe-service';
import styles from './CafeWorkspace.module.css';
type Reply = { mode: 'fixed' | 'ai'; label: string; reply: string; follow_up: string; uncertainty: boolean; source_ids: string[] };
const purposes = [{ id: 'explain_to_owner', label: '店主に説明する' }, { id: 'rephrase', label: '別の言葉で考える' },
  { id: 'another_example', label: '別の例で考える' }, { id: 'check_my_example', label: '自分の例を確認する' }];
export function AiCoachPanel({ session, disabled, expectedLearnerId, onBusyChange }: {
  session: CafeView; disabled: boolean; expectedLearnerId?: string; onBusyChange: (busy: boolean) => void;
}) {
  const [purpose, setPurpose] = useState(purposes[0].id);
  const [reply, setReply] = useState<Reply | null>(null);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState<{ question: string; answer: Reply }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!question) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [question]);
  useEffect(() => () => controller.current?.abort(), []);
  async function ask(learnerQuestion?: string) {
    const asked = learnerQuestion?.trim();
    if (controller.current || disabled || (learnerQuestion !== undefined && !asked)) return;
    const current = new AbortController(); controller.current = current;
    setBusy(true); onBusyChange(true); if (!asked) setReply(null); setError('');
    const timer = window.setTimeout(() => current.abort('timeout'), 30000);
    try {
      const response = await fetch('/api/ai-coach', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: current.signal,
        headers: { 'Content-Type': 'application/json', ...(expectedLearnerId ? { 'X-Zeirishi-Learner': expectedLearnerId } : {}) },
        body: JSON.stringify({ caseId: session.id, requestId: crypto.randomUUID(), attemptId: session.attemptId,
          caseVersion: session.caseVersion, progressRevision: session.progressRevision, purpose, explanation: session.explanation,
          ...(asked ? { question: asked, recentTurns: conversation.filter(turn => turn.answer.mode === 'ai').slice(-2)
            .map(turn => ({ question: turn.question, reply: turn.answer.reply })) } : {}), confirmed: true }) });
      if (!response.ok) throw new Error('AI_REQUEST_FAILED');
      const value: Reply = await response.json();
      if (!current.signal.aborted) {
        if (asked) { setConversation(previous => [...previous, { question: asked, answer: value }]); setQuestion(''); }
        else setReply(value);
      }
    } catch {
      const savedState = session.phase === 'feedback' ? '回答内容は変わっていません。' : '説明は保存済みです。';
      if (current.signal.reason === 'timeout') setError(`30秒以内に返信を確認できませんでした。${savedState}解説で続けられます。自動再送はしません。`);
      else if (!current.signal.aborted) setError(`返信を確認できませんでした。${savedState}解説で続けられます。自動再送はしません。`);
    }
    finally { window.clearTimeout(timer); controller.current = null; setBusy(false); onBusyChange(false); }
  }
  return <section aria-label="説明について相談" className={styles.insight}>
    <h3>{session.phase === 'feedback' ? '間違い・疑問をチャットで確かめる' : '説明をもう一歩深める'}</h3>
    <p className={styles.note}>ローカル試用版では、CLI接続が有効なときだけ質問・直近の会話と架空教材の要点をAIへ送ります。接続できない場合は個別回答できないことを明示します。AIの返答で採点や習得判定は行いません。会話はこの画面だけに表示され、再読込後は残りません。</p>
    <form className={styles.chatForm} onSubmit={event => { event.preventDefault(); void ask(question); }}>
      <label htmlFor="coach-question">解説について聞きたいこと</label>
      <textarea id="coach-question" maxLength={600} value={question} disabled={disabled || busy} onChange={event => setQuestion(event.target.value)} placeholder="例：12万円と答えたけど、使った月だけ費用になるという理解で合ってる？" />
      <button className={styles.primary} disabled={disabled || busy || !question.trim()} type="submit">AIに質問する →</button>
    </form>
    {conversation.length > 0 && <ol className={styles.chatLog} aria-label="この画面の会話">{conversation.map((turn, index) => <li key={index}><p><strong>あなた</strong> {turn.question}</p><div><strong>{turn.answer.mode === 'ai' ? 'AIの返答' : '固定の案内'}</strong><p>{turn.answer.reply}</p><p>{turn.answer.follow_up}</p></div></li>)}</ol>}
    {session.phase === 'teach_back' && <>
    <label>確かめたいこと<select value={purpose} disabled={disabled || busy} onChange={event => { setPurpose(event.target.value); setReply(null); }}>{purposes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <div className={styles.actions}><button disabled={disabled || busy || !session.explanation.trim()} onClick={() => void ask()}>保存済み説明で理解を確認</button>
      {busy && <button onClick={() => { controller.current?.abort(); setError('中止しました。保存済みの説明は残っています。固定要点で続けられます。'); }}>返信の待機を中止</button>}</div>
    </>}
    {session.phase === 'feedback' && busy && <button onClick={() => { controller.current?.abort(); setError('中止しました。回答や保存済みの内容は変わっていません。自動再送はしません。'); }}>返信の待機を中止</button>}
    {error && <p role="status">{error}</p>}
    {reply && <div aria-live="polite"><strong>{reply.mode === 'ai' ? 'AIとの壁打ち' : '固定の理解確認'}</strong><p>{reply.reply}</p><p>{reply.follow_up}</p>{reply.uncertainty && <p>断定せず、教材の要点と照らして確かめてください。</p>}</div>}
  </section>;
}
