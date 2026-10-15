export type Answer = { insurance: string; equipment: string; explanation: string };
export type SessionView = {
  id: string;
  status: 'active' | 'completed' | 'expired';
  revision: number;
  savedAt: string | null;
  answer: Answer;
  result: null | {
    earned: number;
    max: number;
    items: Array<{ conceptId: string; label: string; earned: number; max: number; feedback: string; dueAt: string }>;
  };
};

export class StudyError extends Error {
  constructor(public readonly code: string, public readonly status: number = 400) {
    super(code);
    this.name = 'StudyError';
  }
}

export const emptyAnswer = (): Answer => ({ insurance: '', equipment: '', explanation: '' });

/** Bound input before normalization; drafts can be incomplete, submissions cannot. */
export function validateAnswer(value: unknown, submission = false): Answer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudyError('INVALID_ANSWER');
  const answer = value as Record<string, unknown>;
  if (Object.keys(answer).some(key => !['insurance', 'equipment', 'explanation'].includes(key))) {
    throw new StudyError('INVALID_ANSWER');
  }
  for (const key of ['insurance', 'equipment'] as const) {
    const raw = answer[key];
    if (typeof raw !== 'string' || raw.length > 64) throw new StudyError('INVALID_AMOUNT');
    const normalized = raw.replace(/[\s,]/g, '');
    if (!normalized && !submission) continue;
    if (!/^\d+$/.test(normalized) || Number(normalized) > 1_000_000_000) throw new StudyError('INVALID_AMOUNT');
  }
  if (typeof answer.explanation !== 'string' || answer.explanation.length > 4000) throw new StudyError('INVALID_EXPLANATION');
  return { insurance: answer.insurance as string, equipment: answer.equipment as string, explanation: answer.explanation };
}
