import type { SchemaDatabase, TransactionDatabase } from './database';
import { assertOwnerActive, initializeOwnerAccess } from './owner-access';
import { advanceReviewSchedule, replayReviewSchedule, type ReviewScheduleEvent, type ReviewScheduleState } from '../domain/review-schedule';
import { StudyError } from '../domain/types';
import { strictCanonicalJson } from './strict-canonical-json';

export type ReviewCorrection = { correctionId: string; targetEventId: string; reason: string; occurredAt: string };
type StoredEvent = { sequence: string; event_id: string; kind: 'evidence' | 'withdrawal'; payload: ReviewScheduleEvent | ReviewCorrection };
export type ReviewQueueItem = Pick<ReviewScheduleState, 'subjectId' | 'conceptId' | 'conceptVersion' | 'rulesVersion' | 'intervalDays' | 'nextReviewAt'> & {
  scheduledFor: string; examAdjusted: boolean;
};
export type ReviewQueue = { items: ReviewQueueItem[]; evidenceCount: number; correctionCount: number };
export const REVIEW_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS review_evidence_events (
  owner_id TEXT NOT NULL, event_id TEXT NOT NULL, sequence BIGSERIAL NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('evidence','withdrawal')), payload JSONB NOT NULL,
  PRIMARY KEY(owner_id,event_id)
);`;
export async function initializeReviewSchema(db: Pick<SchemaDatabase, 'exec'>) {
  await initializeOwnerAccess(db);
  await db.exec(REVIEW_SCHEMA_SQL);
}
const canonical = (value: unknown) => strictCanonicalJson(value, () => { throw new StudyError('INVALID_REVIEW_INPUT'); });
const identifier = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
function correction(raw: ReviewCorrection): ReviewCorrection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).sort().join(',') !== 'correctionId,occurredAt,reason,targetEventId'
    || !identifier(raw.correctionId) || !identifier(raw.targetEventId)
    || typeof raw.reason !== 'string' || !raw.reason.trim() || raw.reason.length > 1000
    || typeof raw.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.occurredAt)
    || !Number.isFinite(Date.parse(raw.occurredAt)) || new Date(raw.occurredAt).toISOString() !== raw.occurredAt) {
    throw new StudyError('INVALID_REVIEW_CORRECTION');
  }
  return { correctionId: raw.correctionId, targetEventId: raw.targetEventId, reason: raw.reason, occurredAt: raw.occurredAt };
}
/** The SQL log is only appended by this service. Withdrawal never rewrites original evidence. */
export function createTrustedReviewIngestionOnPreparedDatabase(db: TransactionDatabase, now = () => new Date()) {
  async function appendRow(owner: string, eventId: string, kind: StoredEvent['kind'], payload: StoredEvent['payload']) {
    const at = now();
    if (!Number.isFinite(at.getTime())) throw new StudyError('INVALID_CLOCK', 500);
    if (Date.parse(payload.occurredAt) > at.getTime()) throw new StudyError('REVIEW_EVENT_IN_FUTURE');
    return db.transaction(async tx => {
      await assertOwnerActive(tx, owner);
      const prior = (await tx.query<StoredEvent>('SELECT * FROM review_evidence_events WHERE owner_id=$1 AND event_id=$2', [owner, eventId])).rows[0];
      if (prior) {
        if (prior.kind !== kind || canonical(prior.payload) !== canonical(payload)) throw new StudyError('REVIEW_EVENT_CONFLICT', 409);
        return { eventId, duplicate: true };
      }
      if (kind === 'withdrawal') {
        const target = (await tx.query<StoredEvent>('SELECT * FROM review_evidence_events WHERE owner_id=$1 AND event_id=$2',
          [owner, (payload as ReviewCorrection).targetEventId])).rows[0];
        if (!target || target.kind !== 'evidence') throw new StudyError('REVIEW_EVIDENCE_NOT_FOUND', 404);
        if (Date.parse(payload.occurredAt) < Date.parse(target.payload.occurredAt)) throw new StudyError('INVALID_REVIEW_CORRECTION');
      }
      await tx.query('INSERT INTO review_evidence_events(owner_id,event_id,kind,payload) VALUES ($1,$2,$3,$4::jsonb)',
        [owner, eventId, kind, JSON.stringify(payload)]);
      return { eventId, duplicate: false };
    });
  }
  // This capability is for trusted, version-bound server verification only. Never bind it to
  // learner JSON or an HTTP "administrator" flag; the learner-facing factory has no write method.
  return {
    append(owner: string, event: ReviewScheduleEvent) {
      const normalized = advanceReviewSchedule(null, JSON.parse(canonical(event))).events[0];
      return appendRow(owner, normalized.eventId, 'evidence', normalized);
    },
    withdraw(owner: string, input: ReviewCorrection) {
      const normalized = correction(JSON.parse(canonical(input)));
      return appendRow(owner, normalized.correctionId, 'withdrawal', normalized);
    },
  };
}
function examDeadline(value: string | null | undefined, now: Date): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new StudyError('INVALID_EXAM_DATE');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new StudyError('INVALID_EXAM_DATE');
  // Last millisecond before the confirmed exam day in Asia/Tokyo; expired dates do not adjust.
  const at = date.getTime() - 9 * 60 * 60 * 1000 - 1;
  return at > now.getTime() ? new Date(at).toISOString() : null;
}
export async function createReviewService(db: SchemaDatabase, now = () => new Date()) {
  await initializeReviewSchema(db);
  return createReviewServiceOnPreparedDatabase(db, now);
}
export function createReviewServiceOnPreparedDatabase(db: TransactionDatabase, now = () => new Date()) {
  return {
    async get(owner: string, options: { confirmedExamDate?: string | null } = {}): Promise<ReviewQueue> {
      const at = now();
      if (!Number.isFinite(at.getTime())) throw new StudyError('INVALID_CLOCK', 500);
      const deadline = examDeadline(options.confirmedExamDate, at);
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        const rows = (await tx.query<StoredEvent>('SELECT * FROM review_evidence_events WHERE owner_id=$1 ORDER BY sequence', [owner])).rows
          .filter(row => Date.parse(row.payload.occurredAt) <= at.getTime());
        const withdrawn = new Set(rows.filter(row => row.kind === 'withdrawal').map(row => (row.payload as ReviewCorrection).targetEventId));
        // Stable sorting preserves ingestion order on timestamp ties without limiting the history.
        const evidence = rows.filter(row => row.kind === 'evidence').sort((a, b) => Date.parse(a.payload.occurredAt) - Date.parse(b.payload.occurredAt));
        const scopes = new Map<string, ReviewScheduleEvent[]>();
        for (const row of evidence) {
          const event = row.payload as ReviewScheduleEvent;
          const key = JSON.stringify([event.subjectId, event.conceptId, event.conceptVersion]);
          const events = scopes.get(key) ?? [];
          events.push(withdrawn.has(row.event_id) ? { ...event, reviewStatus: 'withdrawn' } : event);
          scopes.set(key, events);
        }
        const items: ReviewQueueItem[] = [];
        for (const events of scopes.values()) {
          const state = replayReviewSchedule(events);
          if (!state?.nextReviewAt) continue;
          const examAdjusted = !!deadline && Date.parse(deadline) < Date.parse(state.nextReviewAt);
          items.push({ subjectId: state.subjectId, conceptId: state.conceptId, conceptVersion: state.conceptVersion,
            rulesVersion: state.rulesVersion, intervalDays: state.intervalDays, nextReviewAt: state.nextReviewAt,
            scheduledFor: examAdjusted ? deadline! : state.nextReviewAt, examAdjusted });
        }
        items.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || canonical(a).localeCompare(canonical(b)));
        return { items, evidenceCount: evidence.length, correctionCount: rows.length - evidence.length };
      });
    },
  };
}
