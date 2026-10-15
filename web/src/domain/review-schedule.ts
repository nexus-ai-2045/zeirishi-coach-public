/** PRODUCT_SPEC §22.2 / §23.2. This is a schedule, not a mastery/pass judgement.
 * All evidence labels must originate in a trusted server's version-bound verification;
 * accepting these flags from an HTTP client would bypass the evidence boundary.
 * Interpretations: intervals are elapsed 24-hour days; same-day checks use Asia/Tokyo.
 * An early successful review keeps its existing due time. An eligible failure/hint
 * resets to one day even on the same date. Practice/AI-viewed/unverified events never
 * reset or advance. Actual exam-date adjustments and evidence withdrawal/rebuild are
 * separate operations; this reducer does not shorten any retention requirement.
 */
export const REVIEW_RULES_VERSION = 'review-1-3-7-21-v1' as const;
export type ReviewIntervalDays = 1 | 3 | 7 | 21;
export type ReviewScheduleEvent = {
  eventId: string;
  subjectId: string;
  conceptId: string;
  conceptVersion: string;
  questionId: string;
  questionVersion: string;
  questionFamilyId: string;
  scoringVersion: string;
  rulesVersion: typeof REVIEW_RULES_VERSION;
  occurredAt: string;
  sourceKind: 'formal' | 'practice' | 'legacy_unverified' | 'fixture';
  reviewStatus: 'approved' | 'unreviewed' | 'withdrawn';
  scoringAuthority: 'reviewed_rules' | 'expert_review' | 'ai' | 'self_reported';
  measurementQuality: 'verified' | 'unverified';
  outcome: 'met' | 'not_met';
  hintsUsed: number;
  aiAnswerViewed: boolean;
};
export type ReviewScheduleState = {
  subjectId: string;
  conceptId: string;
  conceptVersion: string;
  rulesVersion: typeof REVIEW_RULES_VERSION;
  intervalDays: ReviewIntervalDays | null;
  nextReviewAt: string | null;
  lastAdjustedAt: string | null;
  /** Versioned event snapshots permit deterministic replay and conflicting-ID detection. */
  events: ReviewScheduleEvent[];
};
export class ReviewScheduleError extends Error {
  constructor(public readonly code: 'INVALID_REVIEW_INPUT' | 'REVIEW_SCOPE_CONFLICT' | 'REVIEW_EVENT_CONFLICT'
    | 'REVIEW_EVENT_OUT_OF_ORDER' | 'REVIEW_RULES_VERSION_CONFLICT' | 'INVALID_REVIEW_STATE') {
    super(code); this.name = 'ReviewScheduleError';
  }
}
const DAY = 86_400_000;
const eventKeys = ['eventId', 'subjectId', 'conceptId', 'conceptVersion', 'questionId', 'questionVersion',
  'questionFamilyId', 'scoringVersion', 'rulesVersion', 'occurredAt', 'sourceKind', 'reviewStatus',
  'scoringAuthority', 'measurementQuality', 'outcome', 'hintsUsed', 'aiAnswerViewed'] as const;
const stateKeys = ['subjectId', 'conceptId', 'conceptVersion', 'rulesVersion', 'intervalDays',
  'nextReviewAt', 'lastAdjustedAt', 'events'] as const;
function invalid(): never { throw new ReviewScheduleError('INVALID_REVIEW_INPUT'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) invalid();
  return input;
}
function identifier(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : invalid();
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : invalid();
}
/** Explicit timezone required; reject impossible calendar dates instead of Date's rollover. */
function iso(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid();
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const local = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction ?? ''}Z`);
  if (!Number.isFinite(local.getTime()) || local.getUTCFullYear() !== Number(year)
    || local.getUTCMonth() + 1 !== Number(month) || local.getUTCDate() !== Number(day)
    || local.getUTCHours() !== Number(hour) || local.getUTCMinutes() !== Number(minute)
    || local.getUTCSeconds() !== Number(second)) invalid();
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4, 6));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) invalid();
  }
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) invalid();
  return at.toISOString();
}
function event(value: unknown): ReviewScheduleEvent {
  const input = record(value, eventKeys);
  if (input.rulesVersion !== REVIEW_RULES_VERSION) throw new ReviewScheduleError('REVIEW_RULES_VERSION_CONFLICT');
  if (!Number.isSafeInteger(input.hintsUsed) || (input.hintsUsed as number) < 0 || typeof input.aiAnswerViewed !== 'boolean') invalid();
  return {
    eventId: identifier(input.eventId), subjectId: identifier(input.subjectId), conceptId: identifier(input.conceptId),
    conceptVersion: identifier(input.conceptVersion), questionId: identifier(input.questionId),
    questionVersion: identifier(input.questionVersion), questionFamilyId: identifier(input.questionFamilyId),
    scoringVersion: identifier(input.scoringVersion), rulesVersion: REVIEW_RULES_VERSION, occurredAt: iso(input.occurredAt),
    sourceKind: oneOf(input.sourceKind, ['formal', 'practice', 'legacy_unverified', 'fixture']),
    reviewStatus: oneOf(input.reviewStatus, ['approved', 'unreviewed', 'withdrawn']),
    scoringAuthority: oneOf(input.scoringAuthority, ['reviewed_rules', 'expert_review', 'ai', 'self_reported']),
    measurementQuality: oneOf(input.measurementQuality, ['verified', 'unverified']),
    outcome: oneOf(input.outcome, ['met', 'not_met']), hintsUsed: input.hintsUsed as number,
    aiAnswerViewed: input.aiAnswerViewed,
  };
}
const tokyoDay = (at: string) => new Date(Date.parse(at) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
/** Mutates only the private replay accumulator, never caller-owned state. */
function append(state: ReviewScheduleState | null, input: ReviewScheduleEvent,
  seen: Map<string, ReviewScheduleEvent>): ReviewScheduleState {
  if (state && (state.subjectId !== input.subjectId || state.conceptId !== input.conceptId
    || state.conceptVersion !== input.conceptVersion)) throw new ReviewScheduleError('REVIEW_SCOPE_CONFLICT');
  const prior = seen.get(input.eventId);
  if (prior) {
    if (JSON.stringify(prior) !== JSON.stringify(input)) throw new ReviewScheduleError('REVIEW_EVENT_CONFLICT');
    return state!;
  }
  const last = state?.events.at(-1);
  if (last && Date.parse(input.occurredAt) < Date.parse(last.occurredAt)) throw new ReviewScheduleError('REVIEW_EVENT_OUT_OF_ORDER');
  const next: ReviewScheduleState = state ?? {
    subjectId: input.subjectId, conceptId: input.conceptId, conceptVersion: input.conceptVersion,
    rulesVersion: REVIEW_RULES_VERSION, intervalDays: null,
    nextReviewAt: null, lastAdjustedAt: null, events: [],
  };
  next.events.push(input);
  seen.set(input.eventId, input);
  const eligible = input.sourceKind === 'formal' && input.reviewStatus === 'approved'
    && input.measurementQuality === 'verified' && !input.aiAnswerViewed
    && ['reviewed_rules', 'expert_review'].includes(input.scoringAuthority);
  if (!eligible) return next;
  const reset = input.outcome === 'not_met' || input.hintsUsed > 0;
  if (!reset && state?.lastAdjustedAt && (tokyoDay(state.lastAdjustedAt) === tokyoDay(input.occurredAt)
    || Date.parse(input.occurredAt) < Date.parse(state.nextReviewAt!))) return next;
  next.intervalDays = reset || state?.intervalDays == null ? 1
    : state.intervalDays === 1 ? 3 : state.intervalDays === 3 ? 7 : 21;
  next.lastAdjustedAt = input.occurredAt;
  next.nextReviewAt = new Date(Date.parse(input.occurredAt) + next.intervalDays * DAY).toISOString();
  return next;
}
/** Replay one concept's ordered evidence once, in linear time; no caller state is mutated. */
export function replayReviewSchedule(events: readonly ReviewScheduleEvent[]): ReviewScheduleState | null {
  if (!Array.isArray(events)) invalid();
  let state: ReviewScheduleState | null = null;
  const seen = new Map<string, ReviewScheduleEvent>();
  for (const item of events) state = append(state, event(item), seen);
  return state;
}
/** Validate the derived state by replay: malformed or manually promoted schedules fail closed. */
export function advanceReviewSchedule(state: ReviewScheduleState | null, input: ReviewScheduleEvent): ReviewScheduleState {
  const normalized = event(input);
  let verified: ReviewScheduleState | null = null;
  const seen = new Map<string, ReviewScheduleEvent>();
  if (state !== null) {
    const raw = record(state, stateKeys);
    if (!Array.isArray(raw.events) || raw.events.length === 0) throw new ReviewScheduleError('INVALID_REVIEW_STATE');
    for (const item of raw.events) verified = append(verified, event(item), seen);
    for (const key of stateKeys) {
      const expected = key === 'events' ? raw.events.map(event) : raw[key];
      if (JSON.stringify(verified![key]) !== JSON.stringify(expected)) throw new ReviewScheduleError('INVALID_REVIEW_STATE');
    }
  }
  // Replay is linear in history length; the accumulator and event snapshots are private.
  return append(verified, normalized, seen);
}
