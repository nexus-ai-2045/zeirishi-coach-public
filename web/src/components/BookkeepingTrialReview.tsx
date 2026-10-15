'use client';
import { useEffect, useState } from 'react';
import type { ConceptRef } from '../domain/onboarding';
import type { BookkeepingTrialReview, BookkeepingTrialReviewItem } from '../server/bookkeeping-trial-review';
import styles from './LearningJourney.module.css';

const day = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function BookkeepingTrialReview({ onStart, disabled }: {
  onStart: (ref: ConceptRef, materialId: string, caseVersion: string) => void; disabled: boolean;
}) {
  const [data, setData] = useState<BookkeepingTrialReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setFailure(false); setData(null);
    void fetch('/api/practice-review', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('UNAVAILABLE');
      const value = await response.json() as BookkeepingTrialReview;
      if (!Array.isArray(value.items) || value.developmentOnly !== true || value.qualification !== 'practice_only') throw new Error('INVALID');
      if (!controller.signal.aborted) setData(value);
    }).catch(() => { if (!controller.signal.aborted) setFailure(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload, disabled]);
  const due = data?.items.filter(item => item.status === 'due') ?? [];
  const planned = data?.items.filter(item => item.status === 'scheduled').sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!)) ?? [];
  const completed = data?.items.filter(item => item.status === 'completed') ?? [];
  const unknown = [...new Map(data?.items.filter(item => item.status === 'unknown').map(item => [item.conceptId, item.label])).values()];
  const start = (item: BookkeepingTrialReviewItem) => onStart({ subjectId: item.subjectId,
    conceptId: item.conceptId, conceptVersion: item.conceptVersion }, item.materialId, item.caseVersion);
  return <section aria-label="簿記論の試用復習" className={styles.mission}>
    <small>少し時間を空けて、別の問題で思い出そう</small><h2>簿記論の試用復習</h2>
    <p>保存された完了案件から7日後・21日後の確認を案内します。専門審査前の練習扱いです。正答しても正式な保持率・習熟には数えません。</p>
    {loading ? <p role="status">復習予定を読み込んでいます…</p> : failure ? <><p role="alert">復習予定を取得できませんでした。予定は未確認です。</p><button disabled={disabled} onClick={() => setReload(value => value + 1)}>再読み込み</button></> : data && <>
      <p>予定の最終確認：{day(data.asOf)}</p>
      <h3>今、復習できる問題</h3>
      {due.length ? <ul>{due.map(item => <li key={item.materialId}><button disabled={disabled} onClick={() => start(item)}>{item.label} · {item.intervalDays}日後の確認 →</button></li>)}</ul> : <p>{unknown.length ? '取得済みの完了記録では、期限に達した問題が見つかりません。完了記録がない概念の予定は不明です。' : '確認した時刻で期限に達した問題はありません。'}</p>}
      <h3>次の予定</h3>
      {planned.length ? <ul>{planned.map(item => <li key={item.materialId}>{item.label} · {item.intervalDays}日後：{day(item.scheduledFor!)}予定</li>)}</ul> : <p>時刻が決まった次の予定はありません。</p>}
      {!!completed.length && <details><summary>回答済みの試用確認 · {completed.length}件</summary><ul>{completed.map(item => <li key={item.materialId}>{item.label} · {item.intervalDays}日後：{day(item.completedAt!)}に完了</li>)}</ul><p>完了の記録です。保持できたことの認定ではありません。</p></details>}
      {!!unknown.length && <p>完了案件がまだ見つからないため、次の概念の予定は不明です：{unknown.join('、')}。</p>}
      {!!data.unresolvedCompletions && <p>現在の教材版へ対応できない完了記録があり、その記録からの予定は未確認です。</p>}
      <button disabled={disabled} onClick={() => setReload(value => value + 1)}>予定を再読み込み</button>
    </>}
  </section>;
}
