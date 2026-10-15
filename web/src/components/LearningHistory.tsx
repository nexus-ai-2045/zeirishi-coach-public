'use client';

import { useEffect, useState } from 'react';
import type { CafeDraftItem, CafeHistoryItem } from '../server/cafe-service';
import styles from './CafeWorkspace.module.css';

export function LearningHistory({ disabled, onOpen, expectedLearnerId }: { disabled: boolean; onOpen: (id: string) => void; expectedLearnerId?: string }) {
  const [items, setItems] = useState<CafeHistoryItem[] | null>(null);
  const [drafts, setDrafts] = useState<CafeDraftItem[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch('/api/history', { cache: 'no-store', signal: controller.signal, headers: expectedLearnerId ? { 'X-Zeirishi-Learner': expectedLearnerId } : {} }).then(async response => {
      if (!response.ok) throw new Error('HISTORY_UNAVAILABLE');
      const body = await response.json();
      if (!Array.isArray(body.items) || !Array.isArray(body.drafts)) throw new Error('HISTORY_UNAVAILABLE');
      if (!controller.signal.aborted) { setItems(body.items); setDrafts(body.drafts); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry, expectedLearnerId]);
  return <section className={styles.entry} aria-label="最近の学習記録">
    {!error && drafts !== null && <section aria-label="回答前の相談">
      <h2>回答前の相談</h2>
      <p className={styles.note}>サーバーに保存された、期限内・未提出の相談を最新20件表示します。再開時に本人・教材の版・提供状況を確認します。</p>
      {drafts.length === 0 ? <p>再開できる回答前の相談はありません。</p> : <ul>{drafts.map(draft => <li key={draft.caseId}>
        <p>{draft.phase === 'decision' ? '判断の途中' : '相談を読むところ'} · {draft.savedAt ? <>最終保存 <time dateTime={draft.savedAt}>{new Date(draft.savedAt).toLocaleString('ja-JP')}</time></> : '開始状態を保存済み'}</p>
        <p className={styles.note}>再開期限 <time dateTime={draft.expiresAt}>{new Date(draft.expiresAt).toLocaleString('ja-JP')}</time></p>
        <button disabled={disabled} onClick={() => onOpen(draft.caseId)}>この相談を再開</button>
      </li>)}</ul>}
    </section>}
    <h2>最近の学習記録</h2>
    <p className={styles.note}>最新20件の提出済み練習です。同じケースのやり直しは、未見問題の成績や合格判定には数えません。</p>
    {error ? <p role="status">記録を読み込めませんでした。<button disabled={disabled} onClick={() => setRetry(value => value + 1)}>履歴を再読込</button></p>
      : !items ? <p role="status">記録を読み込んでいます…</p>
      : items.length === 0 ? <p>まだ提出済みの練習はありません。</p>
      : <ul>{items.map(item => <li key={item.caseId}>
        <time dateTime={item.submittedAt}>{new Date(item.submittedAt).toLocaleString('ja-JP')}</time>
        <p>相談ケース · {item.correct === null ? '結果未開示' : item.correct ? '今回の選択は正解' : '今回の選択は不正解'}
          {' · '}{item.status === 'completed' ? '振り返り完了' : item.status === 'expired' ? '下書き期限切れ' : '学習の途中'}</p>
        <button disabled={disabled} onClick={() => onOpen(item.caseId)}>{item.status === 'active' ? 'この記録から再開' : 'この記録を開く'}</button>
      </li>)}</ul>}
  </section>;
}
