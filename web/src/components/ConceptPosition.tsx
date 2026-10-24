import { conceptTopics, type SubjectMapPack } from '../domain/subject-map';
import styles from './ConceptPosition.module.css';

type Props = {
  subjectMap?: SubjectMapPack;
  caseId: string;
  caseVersion: string;
  conceptId: string;
  consultationTitle: string;
  onOpenMap?: (conceptId: string, topicId: string | null) => void;
};

export function ConceptPosition({ subjectMap, caseId, caseVersion, conceptId, consultationTitle, onOpenMap }: Props) {
  const caseLink = subjectMap?.links.find(link => link.kind === 'uses-case' && link.targetId === caseId
    && link.targetVersion === caseVersion && link.sourceId === conceptId && link.role === 'primary');
  if (!subjectMap || !caseLink) return <section className={styles.map} aria-labelledby="concept-position-title">
    <h2 id="concept-position-title">学習上の見取り図</h2>
    <p>この案件と概念地図の対応は確認中です。別の版へ推測で接続しません。</p>
  </section>;
  const concept = subjectMap?.concepts.find(item => item.conceptId === conceptId);
  const topics = subjectMap ? conceptTopics(subjectMap, conceptId) : [];
  const representativeTopic = topics[0];
  const unit = subjectMap.units.find(item => item.unitId === representativeTopic?.unitId);
  const path = ['簿記論', unit?.label ?? '分類を確認中', representativeTopic?.label ?? '論点を確認中', concept?.label ?? '概念を確認中', `今回の相談：${consultationTitle}（試用例）`];
  return (
    <section className={styles.map} aria-labelledby="concept-position-title">
      <div className={styles.intro}>
        <h2 id="concept-position-title">学習上の見取り図</h2>
        <p>いま見ている相談が、学びのどこにつながるかを示します。</p>
      </div>
      <ol className={styles.path} aria-label="今回の相談の概念位置">
        {path.map((label, index) => (
          <li key={label} aria-current={index === path.length - 1 ? 'step' : undefined}>
            <span className={styles.step}>0{index + 1}</span>
            <span className={styles.label}>{label}</span>
          </li>
        ))}
      </ol>
      {topics.length > 0 && <p className={styles.related}>関連する試用論点：{topics.map(topic => topic.label).join(' ／ ')}</p>}
      {onOpenMap && <button type="button" className={styles.returnButton} onClick={() => onOpenMap(conceptId, representativeTopic?.topicId ?? null)}>この位置を地図で見る ↗</button>}
      <p className={styles.disclaimer}>
        この見取り図は架空の学習導線・専門審査前です。簿記論の公式な出題区分や全範囲を示すものではなく、表示だけで理解済みとは判定しません。
      </p>
    </section>
  );
}
