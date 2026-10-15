'use client';

import { useState } from 'react';
import { conceptTopics, topicConcepts, type SubjectMapPack } from '../domain/subject-map';
import styles from './BookkeepingConceptMap.module.css';

export type BookkeepingConceptIndex = 0 | 1 | 2;

type Props = {
  conceptIds: readonly [string, string, string];
  conceptTitles: readonly [string, string, string];
  selected: BookkeepingConceptIndex;
  onSelect: (index: BookkeepingConceptIndex) => void;
  subjectMap?: SubjectMapPack;
  selectedTopicId?: string | null;
  onSelectTopic?: (topicId: string | null) => void;
  availableCaseId?: string | null;
  availableCaseTitle?: string;
  caseConceptIds?: readonly string[];
};

export function BookkeepingConceptMap({ conceptIds, conceptTitles, selected, onSelect, subjectMap, selectedTopicId = null, onSelectTopic, availableCaseId = null, availableCaseTitle, caseConceptIds = [] }: Props) {
  const [view, setView] = useState<'concepts' | 'topics'>(selectedTopicId ? 'topics' : 'concepts');
  const selectedConceptId = conceptIds[selected];
  const relatedTopics = subjectMap ? conceptTopics(subjectMap, selectedConceptId) : [];
  const selectedTopic = subjectMap?.topics.find(topic => topic.topicId === selectedTopicId);
  const relatedConcepts = selectedTopic && subjectMap ? topicConcepts(subjectMap, selectedTopic.topicId) : [];
  const units = subjectMap ? [...subjectMap.units].sort((a, b) => a.order - b.order) : [];
  const hasCase = Boolean(availableCaseId && availableCaseTitle && subjectMap?.links.some(link => link.kind === 'uses-case'
    && link.sourceId === selectedConceptId && link.targetId === availableCaseId && link.role === 'primary'));
  const goToConcept = (index: BookkeepingConceptIndex) => { onSelect(index); setView('concepts'); };
  return (
    <div className={styles.map} aria-label="簿記の全体像">
      <div className={styles.viewSwitch} role="group" aria-label="地図の見方">
        <button type="button" aria-pressed={view === 'concepts'} onClick={() => setView('concepts')}>考え方で見る</button>
        <button type="button" aria-pressed={view === 'topics'} onClick={() => setView('topics')}>試験論点で見る</button>
      </div>
      <p className={styles.scopeNote}>簿記論の導入用・架空の試用地図です。公式な出題区分や網羅的な一覧ではありません。</p>
      {view === 'concepts' ? <>
      <div className={styles.origin}>
        <span className={styles.originMark} aria-hidden="true">●</span>
        <strong>商売の出来事</strong>
        <span>記録して、二つの角度から見る</span>
      </div>

      <svg className={styles.fork} viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
        <path d="M50 0v15M50 15H25v29M50 15h25v29" />
      </svg>

      <div className={styles.lenses}>
        <div className={styles.lens}>
          <span className={styles.lensIndex}>A</span>
          <div><strong>ある時点の姿</strong><span>資産・負債・純資産</span></div>
        </div>
        <div className={styles.lens}>
          <span className={styles.lensIndex}>B</span>
          <div><strong>一定期間の成果</strong><span>収益・費用・利益</span></div>
        </div>
      </div>

      <div className={styles.join} aria-hidden="true"><span /></div>
      <p className={styles.mapPrompt}>見方をつなぐ3つのコア概念</p>

      <div className={styles.concepts} role="group" aria-label="理解したいコア概念">
        {conceptTitles.map((title, index) => {
          const conceptIndex = index as BookkeepingConceptIndex;
          return (
            <button
              className={styles.concept}
              type="button"
              key={title}
              aria-label={title}
              aria-pressed={selected === conceptIndex}
              onClick={() => goToConcept(conceptIndex)}
            >
              <span className={styles.conceptNumber}>{String(index + 1).padStart(2, '0')}</span>
              <span>{title}</span>
              <span className={styles.chevron} aria-hidden="true">↗</span>
            </button>
          );
        })}
      </div>

      {hasCase && (
        <div className={styles.caseLink}>
          <span className={styles.caseLine} aria-hidden="true" />
          <span className={styles.caseLabel}>この考え方を使う試用ケース</span>
          <strong>{availableCaseTitle}</strong>
        </div>
      )}
      <div className={styles.relations} aria-live="polite">
        <strong>この考え方につながる論点</strong>
        {relatedTopics.length ? <div className={styles.relationButtons}>{relatedTopics.map(topic => <button type="button" key={topic.topicId} onClick={() => { onSelectTopic?.(topic.topicId); setView('topics'); }}>{topic.label} <span aria-hidden="true">↗</span></button>)}</div> : <p>接続する論点は未確認です。</p>}
      </div>
      </> : <section className={styles.topicView} aria-label="試験論点の地図">
        <p>論点から考え方へ戻れます。試用中の項目は専門審査前で、学習済み判定には使いません。</p>
        {units.length ? units.map(unit => {
          const topics = subjectMap!.topics.filter(topic => topic.unitId === unit.unitId).sort((a, b) => a.order - b.order);
          return <div className={styles.unit} key={unit.unitId}>
            <h3>{unit.label}<span>{unit.status === 'active' ? '利用可能' : '試用・専門審査前'}</span></h3>
            <div className={styles.topicGrid}>{topics.length ? topics.map(topic => {
              const linked = topicConcepts(subjectMap!, topic.topicId);
              return <button type="button" key={topic.topicId} className={styles.topicButton} aria-pressed={selectedTopicId === topic.topicId} onClick={() => onSelectTopic?.(topic.topicId)}>
                <strong>{topic.label}</strong><span>{topic.summary}</span><small>{linked.length ? `${topic.status === 'active' ? '利用可能' : '試用・専門審査前'} · 考え方 ${linked.length}件` : '接続未確認・教材準備中'}</small>
              </button>;
            }) : <p>この単元の論点は準備中です。</p>}</div>
          </div>;
        }) : <p className={styles.emptyState}>試験論点の地図は準備中です。</p>}
        {selectedTopic && <div className={styles.topicDetail} aria-live="polite">
          <h3>{selectedTopic.label}</h3><p>{selectedTopic.summary}</p>
          <strong>つながる考え方</strong>
          {relatedConcepts.length ? <div className={styles.relationButtons}>{relatedConcepts.map(concept => {
            const index = conceptIds.indexOf(concept.conceptId as typeof conceptIds[number]);
            return index >= 0 ? <button type="button" key={concept.conceptId} onClick={() => goToConcept(index as BookkeepingConceptIndex)}>{concept.label} <span aria-hidden="true">↗</span></button> : <span key={concept.conceptId}>{concept.label}（{caseConceptIds.includes(concept.conceptId) ? '相談教材あり' : '教材準備中'}）</span>;
          })}</div> : <p>対応する考え方は未確認です。教材を開始することはできません。</p>}
        </div>}
      </section>}
    </div>
  );
}
