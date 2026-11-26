import { topicConcepts, type SubjectMapPack } from './subject-map';

export type TopicStage = 'none' | 'new' | 'retry' | 'understood' | 'memorized';
export type PracticeRecord = { caseVersion: string; submittedAt: string; correct: boolean };
export type ReviewCheck = { subjectId: string; topicId: string; checkedAt: string; remembered: boolean };
export type StageCounts = Record<TopicStage, number>;
export type TopicProgress = { stage: TopicStage; step: number; dueDay: string | null };

export const STAGE_LABELS: Record<TopicStage, string> = { none: '問題なし', new: 'まだ', retry: 'もう一度', understood: '理解した', memorized: '覚えた' };
export const STAGE_ORDER = ['memorized', 'understood', 'retry', 'new'] as const;
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 21] as const;
export const MEMORIZED_STEP = 3;

const pad = (value: number) => String(value).padStart(2, '0');
export const localDay = (iso: string | Date) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
export const addDays = (day: string, days: number) => {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

export function topicQuestions(pack: SubjectMapPack, topicId: string): Set<string> {
  const concepts = topicConcepts(pack, topicId);
  return new Set(pack.links.filter(link => link.kind === 'uses-case'
    && concepts.some(concept => concept.conceptId === link.sourceId && concept.conceptVersion === link.sourceVersion)).map(link => link.targetVersion));
}

export function topicProgress(questions: ReadonlySet<string>, records: readonly PracticeRecord[], checks: readonly Omit<ReviewCheck, 'subjectId' | 'topicId'>[],
  dayOf: (iso: string) => string = localDay): TopicProgress {
  if (!questions.size) return { stage: 'none', step: 0, dueDay: null };
  const answers = records.filter(record => questions.has(record.caseVersion)).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const firstCorrect = answers.find(record => record.correct);
  if (!answers.length || !firstCorrect) return { stage: answers.length ? 'retry' : 'new', step: 0, dueDay: null };
  let step = 0, dueDay = addDays(dayOf(firstCorrect.submittedAt), REVIEW_INTERVAL_DAYS[0]);
  for (const check of [...checks].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))) {
    if (check.checkedAt < firstCorrect.submittedAt || dayOf(check.checkedAt) < dueDay) continue;
    step = check.remembered ? Math.min(step + 1, REVIEW_INTERVAL_DAYS.length - 1) : 0;
    dueDay = addDays(dayOf(check.checkedAt), REVIEW_INTERVAL_DAYS[step]);
  }
  const stage: TopicStage = !answers[answers.length - 1].correct ? 'retry' : step >= MEMORIZED_STEP ? 'memorized' : 'understood';
  return { stage, step, dueDay };
}

export function topicProgressMap(pack: SubjectMapPack, records: readonly PracticeRecord[], checks: readonly ReviewCheck[],
  dayOf: (iso: string) => string = localDay): Map<string, TopicProgress> {
  return new Map(pack.topics.map(topic => [topic.topicId, topicProgress(topicQuestions(pack, topic.topicId), records,
    checks.filter(check => check.subjectId === pack.subjectId && check.topicId === topic.topicId), dayOf)]));
}

export function dueCards(progress: ReadonlyMap<string, TopicProgress>, today: string): string[] {
  return [...progress].filter(([, item]) => item.dueDay !== null && item.stage !== 'retry' && item.dueDay <= today)
    .sort((a, b) => a[1].dueDay!.localeCompare(b[1].dueDay!)).map(([topicId]) => topicId);
}

export function countStages(stages: Iterable<TopicStage>): StageCounts {
  const counts: StageCounts = { none: 0, new: 0, retry: 0, understood: 0, memorized: 0 };
  for (const stage of stages) counts[stage] += 1;
  return counts;
}
