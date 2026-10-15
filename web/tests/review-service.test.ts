import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { REVIEW_RULES_VERSION, advanceReviewSchedule, replayReviewSchedule, type ReviewScheduleEvent } from '../src/domain/review-schedule';
import { createReviewService, createReviewServiceOnPreparedDatabase, createTrustedReviewIngestionOnPreparedDatabase } from '../src/server/review-service';
import { lockOwner } from '../src/server/owner-access';

const event = (eventId: string, day: number, extra: Partial<ReviewScheduleEvent> = {}): ReviewScheduleEvent => ({
  eventId, subjectId: 'bookkeeping', conceptId: 'prepaid', conceptVersion: 'v1', questionId: eventId,
  questionVersion: 'v1', questionFamilyId: eventId, scoringVersion: 'v1', rulesVersion: REVIEW_RULES_VERSION,
  occurredAt: `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`, sourceKind: 'formal',
  reviewStatus: 'approved', scoringAuthority: 'reviewed_rules', measurementQuality: 'verified',
  outcome: 'met', hintsUsed: 0, aiAnswerViewed: false, ...extra,
});
test('復習の本人分離、遅着を含む全履歴再生、同日練習非昇格、冪等と競合', async () => {
  const db = new PGlite();
  try {
    const reader = await createReviewService(db);
    const writer = createTrustedReviewIngestionOnPreparedDatabase(db);
    assert.deepEqual(await reader.get('alice'), { items: [], evidenceCount: 0, correctionCount: 0 });
    assert.deepEqual(Object.keys(reader), ['get']);
    await writer.append('alice', event('second', 2));
    await writer.append('alice', event('first', 1));
    assert.equal((await reader.get('alice')).items[0].intervalDays, 3);
    await writer.append('alice', event('same-day', 2));
    await writer.append('alice', event('practice', 5, { sourceKind: 'practice', outcome: 'not_met' }));
    await writer.append('alice', event('ai', 5, { aiAnswerViewed: true }));
    assert.equal((await reader.get('alice')).items[0].intervalDays, 3);
    const results = await Promise.all([writer.append('alice', event('third', 5)), writer.append('alice', event('third', 5))]);
    assert.deepEqual(results.map(row => row.duplicate).sort(), [false, true]);
    assert.equal((await reader.get('alice')).items[0].intervalDays, 7);
    await assert.rejects(writer.append('alice', event('third', 6)), /REVIEW_EVENT_CONFLICT/);
    assert.equal((await reader.get('alice')).evidenceCount, 6);
    assert.equal((await reader.get('bob')).items.length, 0);
    const prepared = createReviewServiceOnPreparedDatabase({ transaction: db.transaction.bind(db) });
    assert.deepEqual(await prepared.get('alice'), await reader.get('alice'));
  } finally { await db.close(); }
});
test('教材訂正を追記して再計算し、試験日前表示でも本来の保持期間を保持する', async () => {
  const db = new PGlite();
  try {
    let at = new Date('2026-09-05T00:00:00Z');
    const reader = await createReviewService(db, () => at);
    const writer = createTrustedReviewIngestionOnPreparedDatabase(db);
    for (const [id, day] of [['first', 1], ['second', 2], ['third', 5]] as const) await writer.append('alice', event(id, day));
    const adjusted = (await reader.get('alice', { confirmedExamDate: '2026-09-08' })).items[0];
    assert.equal(adjusted.intervalDays, 7);
    assert.equal(adjusted.nextReviewAt, '2026-09-12T00:00:00.000Z');
    assert.equal(adjusted.scheduledFor, '2026-09-07T14:59:59.999Z');
    assert.equal(adjusted.examAdjusted, true);
    assert.equal((await reader.get('alice')).items[0].examAdjusted, false);
    const correction = { correctionId: 'correction', targetEventId: 'second', reason: '教材訂正', occurredAt: '2026-09-06T00:00:00.000Z' };
    at = new Date('2026-09-06T00:00:00Z');
    await writer.withdraw('alice', correction);
    assert.equal((await writer.withdraw('alice', correction)).duplicate, true);
    assert.equal((await reader.get('alice')).items[0].intervalDays, 3);
    assert.equal((await reader.get('alice')).correctionCount, 1);
    const stored = await db.query<{ payload: ReviewScheduleEvent }>("SELECT payload FROM review_evidence_events WHERE event_id='second'");
    assert.equal(stored.rows[0].payload.reviewStatus, 'approved');
    await assert.rejects(writer.withdraw('bob', correction), /REVIEW_EVIDENCE_NOT_FOUND/);
    await assert.rejects(writer.withdraw('alice', { ...correction, reason: 'different' }), /REVIEW_EVENT_CONFLICT/);
    await assert.rejects(reader.get('alice', { confirmedExamDate: '2026-02-30' }), /INVALID_EXAM_DATE/);
    await writer.append('alice', event('hint', 6, { hintsUsed: 1 }));
    assert.equal((await reader.get('alice')).items[0].intervalDays, 1);
    await db.transaction(async tx => {
      const owner = await lockOwner(tx, 'alice');
      await tx.query('UPDATE owner_access SET revoked_at=$2 WHERE owner_hash=$1', [owner.hash, '2026-09-06']);
    });
    await assert.rejects(reader.get('alice'), /OWNER_REVOKED/);
    await assert.rejects(writer.append('alice', event('later', 7)), /OWNER_REVOKED/);
    await assert.rejects(writer.withdraw('alice', correction), /OWNER_REVOKED/);
  } finally { await db.close(); }
});

test('未来の証拠・訂正を取込で拒否し、旧保存済み未来イベントも読取から除外する', async () => {
  const db = new PGlite();
  try {
    let at = new Date('2026-09-01T00:00:00Z');
    const reader = await createReviewService(db, () => at);
    const writer = createTrustedReviewIngestionOnPreparedDatabase(db, () => at);
    await writer.append('alice', event('first', 1));
    await assert.rejects(writer.append('alice', event('future', 2)), /REVIEW_EVENT_IN_FUTURE/);
    const correction = { correctionId: 'future-correction', targetEventId: 'first', reason: '訂正', occurredAt: '2026-09-03T00:00:00.000Z' };
    await assert.rejects(writer.withdraw('alice', correction), /REVIEW_EVENT_IN_FUTURE/);
    for (const [id, kind, payload] of [['future', 'evidence', event('future', 2)], ['future-correction', 'withdrawal', correction]] as const) {
      await db.query('INSERT INTO review_evidence_events(owner_id,event_id,kind,payload) VALUES ($1,$2,$3,$4::jsonb)', ['alice', id, kind, JSON.stringify(payload)]);
    }
    assert.equal((await reader.get('alice')).evidenceCount, 1);
    assert.equal((await reader.get('alice')).correctionCount, 0);
    at = new Date('2026-09-02T00:00:00Z');
    assert.equal((await reader.get('alice')).items[0].intervalDays, 3);
    at = new Date('2026-09-03T00:00:00Z');
    assert.equal((await reader.get('alice')).items[0].intervalDays, 1);
    assert.equal((await reader.get('alice')).correctionCount, 1);
    const invalidClock = createTrustedReviewIngestionOnPreparedDatabase(db, () => new Date(NaN));
    await assert.rejects(invalidClock.append('alice', event('invalid-clock', 1)), /INVALID_CLOCK/);
  } finally { await db.close(); }
});

test('一括再生は既存の逐次判定と一致し、入力を変更せず競合と順序違反を拒否する', () => {
  const events = [event('first', 1), event('second', 2), event('third', 5)];
  const original = structuredClone(events);
  let state = advanceReviewSchedule(null, events[0]);
  for (const item of events.slice(1)) state = advanceReviewSchedule(state, item);
  assert.deepEqual(replayReviewSchedule(events), state);
  assert.deepEqual(events, original);
  assert.equal(replayReviewSchedule([]), null);
  assert.throws(() => replayReviewSchedule([events[1], events[0]]), /REVIEW_EVENT_OUT_OF_ORDER/);
  assert.throws(() => replayReviewSchedule([events[0], { ...events[0], outcome: 'not_met' }]), /REVIEW_EVENT_CONFLICT/);
});
