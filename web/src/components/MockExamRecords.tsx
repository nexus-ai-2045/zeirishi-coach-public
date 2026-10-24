'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SUBJECTS, type SubjectId } from '../domain/onboarding';
import type { MockExamItem, MockExamSave } from '../server/mock-exam-service';
import styles from './MockExamRecords.module.css';

type Draft = { subjectId: SubjectId; examYear: string; provider: string; examId: string; completedOn: string;
  score: string; maxScore: string; elapsedMinutes: string; position: string; population: string; unseen: string };
const emptyDraft = (): Draft => ({ subjectId: 'bookkeeping', examYear: '', provider: '', examId: '', completedOn: '',
  score: '', maxScore: '100', elapsedMinutes: '', position: '', population: '', unseen: '' });
const tokyoToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const toDraft = ({ record }: MockExamItem): Draft => ({ subjectId: record.subjectId, examYear: String(record.examYear),
  provider: record.provider, examId: record.examId, completedOn: record.completedOn, score: String(record.score), maxScore: String(record.maxScore),
  elapsedMinutes: record.elapsedMinutes === null ? '' : String(record.elapsedMinutes),
  position: record.rank === null ? '' : String(record.rank.position), population: record.rank === null ? '' : String(record.rank.population),
  unseen: record.unseen === null ? '' : record.unseen ? 'yes' : 'no' });
class RequestError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }

/** Self-reported reference records only; this component cannot mark an exam reviewed. */
export function MockExamRecords({ disabled, expectedLearnerId, onBusyChange, onDirtyChange }: {
  disabled: boolean; expectedLearnerId?: string; onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [items, setItems] = useState<MockExamItem[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<MockExamItem | null>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<MockExamSave | null>(null);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange(changed || !!pending); }, [changed, pending, onDirtyChange]);
  useEffect(() => {
    if (!changed && !pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed, pending]);

  async function request<T>(url: string, body?: MockExamSave): Promise<T> {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: { ...(expectedLearnerId ? { 'X-Zeirishi-Learner': expectedLearnerId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new RequestError(response.status, data.error ?? 'REQUEST_FAILED');
    return data as T;
  }
  async function run(operation: () => Promise<void>, action: 'load' | 'save' = 'save') {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(''); setNotice('');
    try { await operation(); if (mounted.current) setLoginNeeded(false); }
    catch (cause) {
      if (!mounted.current) return;
      const code = cause instanceof RequestError ? cause.code : '';
      const auth = ['AUTH_REQUIRED', 'AUTH_IDENTITY_CHANGED', 'INVITATION_REQUIRED'].includes(code);
      setLoginNeeded(auth);
      setError(auth ? 'ログイン状態を確認できません。入力を残しています。'
        : code.includes('REVISION_CONFLICT') ? '別の画面で更新されています。入力を残しています。'
          : cause instanceof RequestError && [400, 413, 415, 422].includes(cause.status) ? '入力内容を確認してください。日付・得点・順位の範囲を確認してから保存できます。'
            : action === 'load' ? '記録を読み込めませんでした。入力を残しています。' : '保存できたか確認できません。入力を残しています。');
      if (cause instanceof RequestError && [400, 413, 415, 422].includes(cause.status)) setPending(null);
    } finally { lock.current = false; if (mounted.current) { setBusy(false); onBusyChange(false); } }
  }
  async function load() {
    const data = await request<{ items: MockExamItem[] }>('/api/mock-exams');
    if (!Array.isArray(data.items) || data.items.some(item => item.evidenceQualification !== 'self_report_only')) throw new Error('INVALID_RESPONSE');
    if (mounted.current) setItems(data.items);
  }
  function reset() { const today = tokyoToday(); setDraft({ ...emptyDraft(), examYear: today.slice(0, 4), completedOn: today }); setEditing(null); setChanged(false); setPending(null); }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(current => ({ ...current, [key]: value })); setChanged(true); setNotice(''); }
  async function persist(body: MockExamSave) {
    const { item } = await request<{ item: MockExamItem }>('/api/mock-exams', body);
    if (item?.id !== body.id || item.evidenceQualification !== 'self_report_only') throw new Error('INVALID_RESPONSE');
    if (!mounted.current) return;
    setItems(current => [item, ...(current ?? []).filter(previous => previous.id !== item.id)].slice(0, 20));
    reset(); setNotice('参考記録を保存しました');
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || disabled || pending) return;
    if (!!draft.position !== !!draft.population) { setError('順位と受験者数は、両方入力するか両方空欄にしてください。'); return; }
    const body: MockExamSave = { requestId: crypto.randomUUID(), id: editing?.id ?? crypto.randomUUID(), revision: editing?.revision ?? 0,
      record: { subjectId: draft.subjectId, examYear: Number(draft.examYear), provider: draft.provider.trim(), examId: draft.examId.trim(),
        completedOn: draft.completedOn, score: Number(draft.score), maxScore: Number(draft.maxScore),
        elapsedMinutes: draft.elapsedMinutes === '' ? null : Number(draft.elapsedMinutes),
        rank: draft.position === '' ? null : { position: Number(draft.position), population: Number(draft.population) },
        unseen: draft.unseen === '' ? null : draft.unseen === 'yes' } };
    setPending(body); void run(() => persist(body));
  }
  function restore() {
    if (!pending) return;
    const id = pending.id;
    void run(async () => {
      const { item } = await request<{ item: MockExamItem }>(`/api/mock-exams?id=${encodeURIComponent(id)}`);
      if (item?.id !== id || item.evidenceQualification !== 'self_report_only') throw new Error('INVALID_RESPONSE');
      if (mounted.current) { setEditing(item); setDraft(toDraft(item)); setChanged(false); setPending(null); setNotice('保存版を読み直しました。手元の入力を保存済みの内容へ置き換えました。'); }
    }, 'load');
  }
  const locked = disabled || busy || !!pending;
  return <details className={styles.panel} onToggle={event => {
    if (event.currentTarget.open && !opened) {
      setOpened(true); const today = tokyoToday(); setDraft(current => ({ ...current, examYear: today.slice(0, 4), completedOn: today }));
      void run(load, 'load');
    }
  }}>
    <summary onClick={event => { if (disabled && !opened) event.preventDefault(); }}>模試の参考記録</summary>
    <h2>模試の成績を記録</h2>
    <p>自己申告の参考記録です。合格ライン判定には使用しません。</p>
    <p>科目全体の判定には、出所と専門確認のある比較可能な総合模試2回が必要です。ここで保存しても、その確認は完了しません。</p>
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert"><p>{error}</p>{loginNeeded && <a href="/login" target="_blank" rel="noopener noreferrer">別タブでログインを確認</a>}
      {pending ? <div className={styles.actions}><button disabled={disabled || busy} onClick={() => void run(() => persist(pending))}>同じ内容で再試行</button><button disabled={disabled || busy} onClick={restore}>保存版を読み直す</button><p>読み直すと、このフォームを保存済みの内容で置き換えます。未保存なら再試行してください。</p></div>
        : <button disabled={disabled || busy} onClick={() => void run(load, 'load')}>参考記録を再読込</button>}</div>}
    <form onSubmit={submit}>
      <fieldset disabled={locked} className={styles.fields}><legend>{editing ? '参考記録の修正' : '新しい参考記録'}</legend>
        <label>模試の科目<select aria-label="模試の科目" value={draft.subjectId} onChange={event => change('subjectId', event.target.value as SubjectId)}>{SUBJECTS.map(subject => <option key={subject.id} value={subject.id}>{subject.label}</option>)}</select></label>
        <label>対象年度<input type="number" min="1900" max="2200" required value={draft.examYear} onChange={event => change('examYear', event.target.value)} /></label>
        <label>主催・提供元<input maxLength={200} required value={draft.provider} onChange={event => change('provider', event.target.value)} /></label>
        <label>模試の識別名<input maxLength={200} required value={draft.examId} onChange={event => change('examId', event.target.value)} placeholder="例：第1回 総合模試" /></label>
        <label>実施日<input type="date" max={opened ? tokyoToday() : undefined} required value={draft.completedOn} onChange={event => change('completedOn', event.target.value)} /></label>
        <label>得点<input type="number" step="any" min="0" max={draft.maxScore || undefined} required value={draft.score} onChange={event => change('score', event.target.value)} /></label>
        <label>満点<input type="number" step="any" min="0.01" required value={draft.maxScore} onChange={event => change('maxScore', event.target.value)} /></label>
        <label>所要時間（分・任意）<input type="number" step="any" min="0" value={draft.elapsedMinutes} onChange={event => change('elapsedMinutes', event.target.value)} /></label>
        <label>順位（任意）<input type="number" min="1" max={draft.population || undefined} value={draft.position} onChange={event => change('position', event.target.value)} /></label>
        <label>受験者数（任意）<input type="number" min="1" value={draft.population} onChange={event => change('population', event.target.value)} /></label>
        <label>初めて解いた問題でしたか<select aria-label="初めて解いた問題でしたか" value={draft.unseen} onChange={event => change('unseen', event.target.value)}><option value="">未回答</option><option value="yes">はい</option><option value="no">いいえ</option></select></label>
        <button type="submit" className={styles.primary}>参考記録を保存</button>
        {(editing || changed) && <button type="button" onClick={() => { reset(); setError(''); setNotice('入力を取り消しました。保存済みの記録は削除していません。'); }}>入力を取り消す</button>}
      </fieldset>
    </form>
    <h3>保存済みの参考記録</h3><p>更新日時の新しい20件を表示します。順位は模試ごとの参考値で、異なる母集団を平均しません。</p>
    {items === null ? <p>{busy ? '読み込んでいます…' : 'まだ読み込めていません。'}</p> : items.length === 0 ? <p>参考記録はまだありません。</p>
      : <ul>{items.map(item => <li key={item.id}><strong>{item.record.provider} · {item.record.examId}</strong><p>{SUBJECTS.find(subject => subject.id === item.record.subjectId)?.label} · {item.record.examYear}年度 · <time dateTime={item.record.completedOn}>{item.record.completedOn}</time></p>
        <p>{item.record.score} / {item.record.maxScore}点 · {item.record.elapsedMinutes === null ? '時間未回答' : `${item.record.elapsedMinutes}分`}</p>
        <p>{item.record.rank === null ? '順位未回答' : `${item.record.rank.position}位 / ${item.record.rank.population}人`}</p>
        <button disabled={locked || changed} onClick={() => { setEditing(item); setDraft(toDraft(item)); setError(''); setNotice(''); }}>記録を修正</button>
      </li>)}</ul>}
  </details>;
}
