'use client';
import { useState } from 'react';
import type { SubjectMapPack } from '../domain/subject-map';
import { dueCards, localDay, MEMORIZED_STEP, REVIEW_INTERVAL_DAYS, type ReviewCheck, type TopicProgress } from '../domain/topic-progress';
import styles from './SubjectTreeView.module.css';

type Props = { pack: SubjectMapPack; progress: ReadonlyMap<string, TopicProgress>; disabled: boolean;
  onChecked: (check: ReviewCheck) => void; onOpen: (topicId: string) => void };
const shortDay = (day: string) => { const [, month, date] = day.split('-').map(Number); return `${month}月${date}日`; };

export function ReviewCards({ pack, progress, disabled, onChecked, onOpen }: Props) {
  const today = localDay(new Date());
  const due = dueCards(progress, today);
  const [flipped, setFlipped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(0);
  const topic = pack.topics.find(item => item.topicId === due[0]);
  const upcoming = [...progress.values()].filter(item => item.dueDay && item.dueDay > today && item.stage !== 'retry').map(item => item.dueDay!).sort();
  const answer = async (remembered: boolean) => {
    if (!topic) return;
    setSaving(true); setFailed(false);
    try {
      const response = await fetch('/api/practice-progress', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), subjectId: pack.subjectId, topicId: topic.topicId, remembered }) });
      if (!response.ok) throw new Error('CHECK_FAILED');
      setFlipped(false); setDone(value => value + 1);
      onChecked({ subjectId: pack.subjectId, topicId: topic.topicId, checkedAt: new Date().toISOString(), remembered });
    } catch { setFailed(true); } finally { setSaving(false); }
  };
  const step = topic ? progress.get(topic.topicId)?.step ?? 0 : 0;
  return <section className={styles.cards} aria-label="今日の復習カード">
    <div className={styles.cardsHead}><h3>今日の復習カード</h3><span>{due.length ? `残り${due.length}枚` : done ? `${done}枚チェックしました` : ''}</span></div>
    {topic ? <div className={styles.card} data-flipped={flipped}>
      <p className={styles.kicker}>{pack.units.find(unit => unit.unitId === topic.unitId)?.label} ・ 復習 {Math.min(step, MEMORIZED_STEP) + 1}回目（{REVIEW_INTERVAL_DAYS[Math.min(step, REVIEW_INTERVAL_DAYS.length - 1)]}日あけて）</p>
      <h4>{topic.label}</h4>
      {!flipped ? <><p className={styles.cardHint}>どんな論点だったか、頭の中で説明してから裏返しましょう。</p>
        <button className={styles.flip} disabled={disabled} onClick={() => setFlipped(true)}>裏返す</button></>
        : <><p className={styles.cardBack}>{topic.summary}</p>{topic.example && <p className={styles.cardExample}>例：{topic.example}</p>}
          <div className={styles.cardActions} role="group" aria-label="思い出せたか">
            <button data-answer="remembered" disabled={disabled || saving} onClick={() => answer(true)}>覚えていた</button>
            <button data-answer="forgot" disabled={disabled || saving} onClick={() => answer(false)}>忘れていた</button>
            <button className={styles.cardOpen} onClick={() => onOpen(topic.topicId)}>説明を詳しく見る</button>
          </div></>}
      {failed && <p role="alert">記録できませんでした。もう一度押してください。</p>}
    </div> : <p className={styles.cardEmpty}>{done ? '今日の分は終わりです。おつかれさまでした。' : '今日の復習カードはありません。'}
      {upcoming.length ? ` 次は${shortDay(upcoming[0])}に${upcoming.filter(day => day === upcoming[0]).length}枚です。` : ' 確認問題に正解した論点が、翌日からカードになります。'}</p>}
    <p className={styles.cardNote}>忘却曲線に合わせて、1日・3日・7日・21日とあけて出します。忘れていたら1日後に戻ります。3回続けて覚えていたら「覚えた」です。</p>
  </section>;
}
