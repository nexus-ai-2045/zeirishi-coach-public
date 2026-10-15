'use client';

import { useState } from 'react';
import type { SubjectId, Concept, ConceptRef } from '../domain/onboarding';
import type { ExamReadinessResult } from '../domain/exam-readiness';
import type { MasteryAssessment, MasteryStatus } from '../domain/mastery-assessment';
import styles from './CafeWorkspace.module.css';

export type LearningEvidenceView = {
  assessment: ExamReadinessResult;
  mastery?: Pick<MasteryAssessment, 'subjectId' | 'conceptId' | 'conceptVersion' | 'criterionVersion' | 'status' | 'needsRecheck' | 'reasons'>[];
  review: { items: { subjectId: string; conceptId: string; conceptVersion: string; nextReviewAt: string | null; scheduledFor: string | null; examAdjusted: boolean }[]; evidenceCount: number; correctionCount: number };
};
const masteryLabels: Record<MasteryStatus, string> = {
  unconfirmed: '未確認', in_progress: '理解中', applicable: '適用可能',
  exam_confirmed: '試験形式で確認済み', maintained: '維持済み', measurement_preparing: '測定準備中',
};
const holdLabels: Record<string, string> = {
  'evidence-withdrawn': '直近の測定が撤回されています。古い好成績で埋め合わせません。',
  'two-comprehensive-exams-required': '比較可能な総合模試が2回必要です。',
  'latest-measurement-ineligible': '直近の測定に未確認・撤回などの評価対象外の証拠があります。',
  'not-comparable': '範囲・難易度・配点・時間の比較可能性が未確認です。',
  'criterion-definition-conflict': '評価基準の定義に不一致があります。',
  'same-exam': '同じ試験の再受験は、独立した2回として扱いません。',
  'same-family': '同じ問題ファミリーは、独立した2回として扱いません。',
  'criterion-source-kind-mismatch': '評価基準の出所が一致していません。',
};

/** On-demand only: this must not delay the primary learning screen. */
export function LearningEvidencePanel({ subjectId, concepts, expectedLearnerId, disabled, canStartConcept, onChooseConcept }: {
  subjectId: SubjectId; concepts: readonly Concept[]; expectedLearnerId?: string; disabled: boolean;
  canStartConcept: (ref: ConceptRef) => boolean; onChooseConcept: (ref: ConceptRef) => void;
}) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [criterion, setCriterion] = useState('');
  const [view, setView] = useState<LearningEvidenceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    if (disabled || busy) return;
    setBusy(true); setError(''); setView(null);
    try {
      const query = new URLSearchParams({ subjectId, examYear: year, criterionVersion: criterion || 'unconfirmed' });
      const response = await fetch(`/api/learning-evidence?${query}`, { cache: 'no-store', credentials: 'same-origin',
        headers: expectedLearnerId ? { 'X-Zeirishi-Learner': expectedLearnerId } : {}, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('LOAD_FAILED');
      setView(await response.json());
    } catch { setError('評価の根拠を取得できませんでした。合格ライン到達とは判定していません。再試行できます。'); }
    finally { setBusy(false); }
  }
  return <details className={styles.examPlan}>
    <summary>合格ラインと復習の根拠</summary>
    <p>満点ではなく、比較可能な未見の総合模試で基準に届いたかを確認します。自己申告の模試や相談練習は判定に使いません。</p>
    <fieldset className={styles.evidenceFields} disabled={disabled || busy}><legend>確認する評価条件</legend>
      <label>受験年度<input type="number" min="1900" max="2200" value={year} onChange={event => { setYear(event.target.value); setView(null); }} /></label>
      <label>評価基準の版（任意）<input maxLength={128} value={criterion} placeholder="専門確認済みの基準版" onChange={event => { setCriterion(event.target.value); setView(null); }} /></label>
      <p className={styles.note}>基準版が不明なら空欄のままで確認できます。その場合は判定保留です。</p>
      <button onClick={() => void load()}>{busy ? '根拠を確認中…' : '保存済みの根拠を確認'}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {view && <section aria-live="polite">
      <h3>{view.assessment.status === 'held' ? '合格ライン評価は保留です' : view.assessment.status === 'target_met_twice' ? '直近2回で確認済みの基準に到達' : '直近2回では基準への到達が揃っていません'}</h3>
      <p className={styles.note}>合格保証・合格確率ではありません。表示は指定した科目・年度・基準版の測定に限ります。</p>
      {view.assessment.holdReasons.length > 0 && <ul>{view.assessment.holdReasons.map(reason => <li key={reason}>{holdLabels[reason] ?? `追加確認が必要です（${reason}）`}</li>)}</ul>}
      {view.assessment.records.filter(record => record.selected).map(record => <p key={record.id}>測定 {record.id}：{record.eligible ? `基準との差 ${record.targetDifference}点` : '評価条件が揃っていません'}{record.remainingMinutes !== null && ` ／ 制限時間との差 ${record.remainingMinutes}分`}</p>)}
      <h3>概念ごとの理解の根拠</h3>
      <p className={styles.note}>科目の合格判定とは別です。相談や自己申告だけでは、試験形式で確認済みにはしません。</p>
      {view.mastery?.length ? <ul>{view.mastery.map(item => <li key={`${item.subjectId}:${item.conceptId}:${item.conceptVersion}`}>
        <strong>{concepts.find(concept => concept.subjectId === item.subjectId && concept.conceptId === item.conceptId && concept.conceptVersion === item.conceptVersion)?.label ?? item.conceptId}：{masteryLabels[item.status]}</strong>
        {item.needsRecheck && <p>要再確認：新しい独力の測定が必要です。</p>}
        <p className={styles.note}>概念版 {item.conceptVersion} ／ 基準版 {item.criterionVersion ?? '未準備'}</p>
        {item.reasons.length > 0 && <ul>{item.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
      </li>)}</ul> : <p>概念別の測定は準備中です。専門確認済みの基準と独立した測定記録が必要です。好きな単元の練習は続けられます。</p>}
      <h3>証拠に基づく復習予定</h3>
      <p className={styles.note}>ここから始めるのは相談練習です。開始や相談の完了だけでは、正式な測定の証拠・理解度・復習予定を更新しません。</p>
      {view.review.items.filter(item => item.subjectId === subjectId && item.scheduledFor).length ? <ul>{view.review.items.filter(item => item.subjectId === subjectId && item.scheduledFor).map(item => {
        const concept = concepts.find(candidate => candidate.subjectId === item.subjectId && candidate.conceptId === item.conceptId && candidate.conceptVersion === item.conceptVersion);
        const available = concept && canStartConcept(concept);
        return <li key={`${item.subjectId}:${item.conceptId}:${item.conceptVersion}`}>
          <p>{concept?.label ?? item.conceptId}：{new Date(item.scheduledFor!).toLocaleDateString('ja-JP')}{item.examAdjusted && '（試験前の練習。保持確認の条件は短縮しません）'}</p>
          <p className={styles.note}>概念版 {item.conceptVersion}</p>
          {available ? <button disabled={disabled || busy} onClick={() => { if (!disabled && !busy) onChooseConcept(concept); }}>この復習の相談を始める</button>
            : <p>この版の教材は現在提供されていないため、ここから相談を開始できません。</p>}
        </li>;
      })}</ul> : <p>正式な復習予定を作る証拠がまだありません。好きな単元の練習は続けられます。</p>}
    </section>}
  </details>;
}
