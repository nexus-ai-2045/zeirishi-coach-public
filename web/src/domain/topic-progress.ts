import { topicConcepts, type SubjectMapPack } from './subject-map';

/**
 * How far a learner has got with one topic. Practice records only; never a mastery or pass judgement.
 * - none: the topic has no check question yet / new: not answered correctly yet
 * - retry: the latest check-question answer was wrong
 * - understood (理解): answered the check question correctly; the topic joins the review cards
 * - memorized (暗記): remembered it on review cards at 1, 3 and 7 days in a row (forgetting curve)
 */
export type TopicStage = 'none' | 'new' | 'retry' | 'understood' | 'memorized';
export type PracticeRecord = { caseVersion: string; submittedAt: string; correct: boolean };
export type ReviewCheck = { subjectId: string; topicId: string; checkedAt: string; remembered: boolean };
export type StageCounts = Record<TopicStage, number>;
export type TopicProgress = { stage: TopicStage; /** Review steps passed in a row (0–3). */ step: number; /** Local calendar day the next card is due, or null. */ dueDay: string | null };

export const STAGE_LABELS: Record<TopicStage, string> = { none: '問題なし', new: 'まだ', retry: 'もう一度', understood: '理解した', memorized: '覚えた' };
/** Order used for bars and legends: the most advanced first. */
export const STAGE_ORDER = ['memorized', 'understood', 'retry', 'new'] as const;
/** Same 1・3・7・21-day intervals as the app's review rule (review-1-3-7-21-v1). */
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 21] as const;
/** Remembered at 1, 3 and 7 days in a row → memorized. */
export const MEMORIZED_STEP = 3;

const pad = (value: number) => String(value).padStart(2, '0');
/** Calendar day (YYYY-MM-DD) in the learner's own time zone, so "tomorrow" matches how they live it. */
export const localDay = (iso: string | Date) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
export const addDays = (day: string, days: number) => {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

/** Check-question versions attached to each topic, through the topic's concepts. */
export function topicQuestions(pack: SubjectMapPack, topicId: string): Set<string> {
  const concepts = topicConcepts(pack, topicId);
  return new Set(pack.links.filter(link => link.kind === 'uses-case'
    && concepts.some(concept => concept.conceptId === link.sourceId && concept.conceptVersion === link.sourceVersion)).map(link => link.targetVersion));
}

/**
 * Replays one topic's answers and review-card checks. A card check only counts once the topic is
 * understood and the card is due; remembering moves to the next interval, forgetting goes back to 1 day.
 */
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

/** Topics whose review card is due today or earlier, oldest due first. */
export function dueCards(progress: ReadonlyMap<string, TopicProgress>, today: string): string[] {
  return [...progress].filter(([, item]) => item.dueDay !== null && item.stage !== 'retry' && item.dueDay <= today)
    .sort((a, b) => a[1].dueDay!.localeCompare(b[1].dueDay!)).map(([topicId]) => topicId);
}

export function countStages(stages: Iterable<TopicStage>): StageCounts {
  const counts: StageCounts = { none: 0, new: 0, retry: 0, understood: 0, memorized: 0 };
  for (const stage of stages) counts[stage] += 1;
  return counts;
}
