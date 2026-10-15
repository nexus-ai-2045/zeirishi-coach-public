'use client';
import { useEffect, useState } from 'react';
import type { ConceptRef } from '../domain/onboarding';
import styles from './LearningJourney.module.css';
type Item = ConceptRef & { id: string; caseVersion: string; prompt: string; intendedUse: string; conceptLabel?: string };
const labels: Record<string, string> = { 'cash-is-not-profit':'現金と利益', 'double-entry':'複式記録', 'prepaid-expenses':'費用の期間配分', 'inventory-cost':'商品と売上原価', depreciation:'固定資産と減価償却', 'provisions-estimates':'見積りと引当' };
export function BookkeepingPractice({ onStart, disabled }: { onStart: (ref: ConceptRef, materialId: string, caseVersion: string) => void; disabled: boolean }) {
  const pool = 'practice';
  const [items, setItems] = useState<Item[]>([]);
  const [failure, setFailure] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController(); setItems([]); setLoading(true); setFailure(false);
    void fetch(`/api/practice?pool=${pool}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('UNAVAILABLE'); const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error('INVALID'); setItems(data.items);
    }).catch(() => { if (!controller.signal.aborted) setFailure(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pool]);
  return <section aria-label="簿記論の問題演習" className={styles.mission}><small>次は、別の問題でも使えるか試そう</small><h2>簿記論の問題演習</h2><p>専門審査前の原稿試用です。練習・診断・前後評価・保持確認は別の問題群に分けています。正式な習熟や合格判定には使いません。</p>
    {loading ? <p role="status">問題を読み込んでいます…</p> : failure ? <p role="alert">この問題群を取得できませんでした。</p> : <><p>{items.length}問の原稿</p>{[...new Set(items.map(item => item.conceptId))].map(id => <details key={id}><summary>{items.find(item=>item.conceptId===id)?.conceptLabel ?? labels[id] ?? id} · {items.filter(item => item.conceptId === id).length}問</summary><ol>{items.filter(item => item.conceptId === id).map(item => <li key={item.id}><button disabled={disabled} onClick={() => onStart(item, item.id, item.caseVersion)}>{item.prompt.split('（')[0]} →</button></li>)}</ol></details>)}</>}
  </section>;
}
