'use client';
import { useEffect, useState } from 'react';
import styles from './LearningCelebration.module.css';

export type LearningMoment = { id: string; kind: 'start' | 'insight' | 'complete'; correct?: boolean };
export function LearningCelebration({ moment, reduced }: { moment: LearningMoment | null; reduced: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!moment) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1100);
    return () => clearTimeout(timer);
  }, [moment]);
  if (!moment || !visible) return null;
  const title = moment.kind === 'start' ? '新しい相談、スタート！' : moment.kind === 'complete' ? '相談を最後までやり遂げました！' : moment.correct ? '資料から判断できました！' : '次の一歩が見つかりました';
  return <div className={styles.moment} data-reduced={reduced} data-kind={moment.kind} role="status" aria-live="polite">
    {!reduced && moment.kind !== 'start' && <div className={styles.particles} aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ '--x': `${(i % 8) * 13}%`, '--turn': `${i * 41}deg`, '--delay': `${(i % 3) * 50}ms` } as React.CSSProperties} />)}</div>}
    <strong>{title}</strong><span>{moment.kind === 'complete' ? 'この経験を、次の別の問題でも試そう' : moment.kind === 'start' ? '資料を読み、あなたの言葉で説明しよう' : '根拠を確かめて、理解を深めよう'}</span>
  </div>;
}
