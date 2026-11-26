import type { SchemaDatabase } from './database';
import { StudyError } from '../domain/types';
import { assertOwnerActive, initializeOwnerAccess } from './owner-access';
import type { ReviewCheck } from '../domain/topic-progress';

const key = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
export async function createReviewCardService(db: SchemaDatabase, now: () => Date = () => new Date()) {
  await initializeOwnerAccess(db);
  await db.exec(`CREATE TABLE IF NOT EXISTS review_card_checks (
    owner_id TEXT NOT NULL, request_id TEXT NOT NULL, subject_id TEXT NOT NULL, topic_id TEXT NOT NULL,
    checked_at TEXT NOT NULL, remembered BOOLEAN NOT NULL, PRIMARY KEY(owner_id,request_id))`);
  return {
    async checks(owner: string): Promise<ReviewCheck[]> {
      if (!key(owner)) throw new StudyError('INVALID_ID');
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        return (await tx.query<ReviewCheck>(`SELECT subject_id AS "subjectId", topic_id AS "topicId", checked_at AS "checkedAt", remembered
          FROM review_card_checks WHERE owner_id=$1 ORDER BY checked_at, request_id`, [owner])).rows;
      });
    },
    async record(owner: string, input: { requestId: string; subjectId: string; topicId: string; remembered: boolean }) {
      if (![owner, input.requestId, input.subjectId, input.topicId].every(key) || typeof input.remembered !== 'boolean') throw new StudyError('INVALID_INPUT');
      const at = now();
      if (!Number.isFinite(at.getTime())) throw new StudyError('INVALID_CLOCK', 500);
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        await tx.query(`INSERT INTO review_card_checks (owner_id,request_id,subject_id,topic_id,checked_at,remembered)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (owner_id,request_id) DO NOTHING`,
          [owner, input.requestId, input.subjectId, input.topicId, at.toISOString(), input.remembered]);
        return { ok: true as const };
      });
    },
  };
}
