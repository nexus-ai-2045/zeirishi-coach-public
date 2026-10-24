import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createStudyService, StudyError, type Answer } from '../src/server/study-service';

const right: Answer = { insurance: '30,000', equipment: '60 000', explanation: '当期に対応する費用を配分する' };
const isCode = (code: string) => (error: unknown) => error instanceof StudyError && error.code === code;

test('development engine contracts and filesystem persistence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zeirishi-engine-'));
  let db = new PGlite(directory);
  let time = new Date('2026-09-06T00:00:00Z');
  let service = await createStudyService(db, () => time);
  try {
    await t.test('start is persistent, atomic and owner-scoped; replay resolves current state', async () => {
      const [first, duplicate] = await Promise.all([
        service.start('alice', 'start-retry'), service.start('alice', 'start-retry'),
      ]);
      assert.equal(first.id, duplicate.id);
      assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM study_sessions')).rows[0].n, 1);
      const saved = await service.save('alice', first.id, { requestId: 'start-retry-save', revision: 0, answer: right });
      await db.close();
      db = new PGlite(directory);
      service = await createStudyService(db, () => time);
      assert.deepEqual(await service.start('alice', 'start-retry'), saved);
      const receipt = (await db.query<{ response: unknown }>("SELECT response FROM study_requests WHERE owner_id='alice' AND request_id='start-retry'")).rows[0];
      assert.equal(receipt.response, null);
      const other = await service.start('bob', 'start-retry');
      assert.notEqual(other.id, first.id);
      await assert.rejects(service.get('bob', first.id), isCode('NOT_FOUND'));
      await assert.rejects(service.start('alice', 'start-retry-save'), isCode('REQUEST_CONFLICT'));
      await assert.rejects(service.submit('alice', first.id, { requestId: 'start-retry', answer: right }), isCode('REQUEST_CONFLICT'));
      const completed = await service.submit('alice', first.id, { requestId: 'start-retry-submit', answer: right });
      assert.deepEqual(await service.start('alice', 'start-retry'), completed);
      await assert.rejects(service.start('alice', 'start-retry-submit'), isCode('REQUEST_CONFLICT'));
    });
    await t.test('no answer leak; save, reload and submit exact replay', async () => {
      const initial = await service.start('alice', randomUUID());
      assert.equal(initial.result, null);
      assert.equal(JSON.stringify(initial).includes('30000'), false);
      const saved = await service.save('alice', initial.id, { requestId: 'save-1', revision: 0, answer: right });
      assert.equal(saved.revision, 1);
      assert.deepEqual(await service.save('alice', initial.id, { requestId: 'save-1', revision: 0, answer: right }), saved);
      await db.close();
      db = new PGlite(directory);
      service = await createStudyService(db, () => time);
      assert.deepEqual(await service.get('alice', initial.id), saved);
      const completed = await service.submit('alice', initial.id, { requestId: 'submit-1', answer: right });
      assert.equal(completed.result?.earned, 10);
      assert.deepEqual(await service.get('alice', initial.id), completed);
      assert.deepEqual(await service.submit('alice', initial.id, { requestId: 'submit-1', answer: right }), completed);
      await assert.rejects(service.submit('alice', initial.id, { requestId: 'submit-1', answer: { ...right, insurance: '0' } }), isCode('REQUEST_CONFLICT'));
      await assert.rejects(service.submit('alice', initial.id, { requestId: 'submit-other', answer: right }), isCode('SESSION_CLOSED'));
      await assert.rejects(service.save('alice', initial.id, { requestId: 'save-late', revision: 1, answer: right }), isCode('SESSION_CLOSED'));
      assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM study_attempts WHERE session_id=$1', [initial.id])).rows[0].n, 1);
      assert.equal((await db.query<{ answer: unknown }>('SELECT answer FROM study_sessions WHERE id=$1', [initial.id])).rows[0].answer, null);
      assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM study_requests WHERE session_id=$1 AND operation='save' AND response IS NOT NULL", [initial.id])).rows[0].n, 0);
      const next = await service.start('alice', randomUUID());
      await assert.rejects(service.submit('alice', next.id, { requestId: 'save-1', answer: right }), isCode('REQUEST_CONFLICT'));
    });
    await t.test('concepts score independently; wrong answers still have review dates', async () => {
      for (const [answer, earned] of [[{ ...right, equipment: '0' }, 5], [{ ...right, insurance: '0', equipment: '0' }, 0]] as const) {
        const session = await service.start('alice', randomUUID());
        const completed = await service.submit('alice', session.id, { requestId: `grade-${earned}`, answer });
        assert.equal(completed.result?.earned, earned);
        assert.equal(completed.result?.max, 10);
        assert.equal(completed.result?.items.length, 2);
        assert.ok(completed.result?.items.every(item => item.dueAt === '2026-09-07T00:00:00.000Z'));
      }
    });
    await t.test('owner binding and input limits', async () => {
      const session = await service.start('alice', randomUUID());
      await assert.rejects(service.get('bob', session.id), isCode('NOT_FOUND'));
      await assert.rejects(service.save('bob', session.id, { requestId: 'bob-save', revision: 0, answer: right }), isCode('NOT_FOUND'));
      await assert.rejects(service.submit('bob', session.id, { requestId: 'bob-submit', answer: right }), isCode('NOT_FOUND'));
      for (const value of ['-1', '3e4', 'not-a-number', '1000000001', '1'.repeat(65), '']) {
        await assert.rejects(service.submit('alice', session.id, { requestId: 'invalid', answer: { ...right, insurance: value } }), isCode('INVALID_AMOUNT'));
      }
      await assert.rejects(service.save('alice', session.id, { requestId: 'invalid-explanation', revision: 0, answer: { ...right, explanation: 'x'.repeat(4001) } }), isCode('INVALID_EXPLANATION'));
    });
    await t.test('draft CAS, altered replay and reversed saves', async () => {
      const session = await service.start('alice', randomUUID());
      const first = await service.save('alice', session.id, { requestId: 'cas-1', revision: 0, answer: right });
      await assert.rejects(service.save('alice', session.id, { requestId: 'cas-1', revision: 0, answer: { ...right, insurance: '0' } }), isCode('REQUEST_CONFLICT'));
      const second = await service.save('alice', session.id, { requestId: 'cas-2', revision: first.revision, answer: { ...right, insurance: '0' } });
      await assert.rejects(service.save('alice', session.id, { requestId: 'old-revision', revision: 0, answer: right }), isCode('REVISION_CONFLICT'));
      assert.deepEqual(await service.get('alice', session.id), second);
    });
    await t.test('submit/save race never replaces submitted answer', async () => {
      const session = await service.start('alice', randomUUID());
      const results = await Promise.allSettled([
        service.submit('alice', session.id, { requestId: 'race-submit', answer: right }),
        service.save('alice', session.id, { requestId: 'race-save', revision: 0, answer: { ...right, equipment: '0' } }),
      ]);
      assert.equal(results[0].status, 'fulfilled');
      const current = await service.get('alice', session.id);
      assert.equal(current.status, 'completed');
      assert.deepEqual(current.answer, right);
      assert.equal(current.result?.earned, 10);
      const next = await service.start('alice', randomUUID());
      const [saved, submitted] = await Promise.all([
        service.save('alice', next.id, { requestId: 'race-save-first', revision: 0, answer: { ...right, equipment: '0' } }),
        service.submit('alice', next.id, { requestId: 'race-submit-second', answer: right }),
      ]);
      assert.equal(saved.revision, 1);
      assert.equal(submitted.result?.earned, 10);
      assert.deepEqual((await service.get('alice', next.id)).answer, right);
    });
    await t.test('expiry deletes drafts and replay copies, reads do not extend it', async () => {
      const session = await service.start('alice', randomUUID());
      await service.save('alice', session.id, { requestId: 'exp-save', revision: 0, answer: right });
      time = new Date('2026-09-12T00:00:00Z');
      assert.equal((await service.get('alice', session.id)).status, 'active');
      await service.save('alice', session.id, { requestId: 'exp-unchanged', revision: 1, answer: right });
      time = new Date('2026-09-13T00:00:00Z');
      const expired = await service.get('alice', session.id);
      assert.equal(expired.status, 'expired');
      assert.deepEqual(expired.answer, { insurance: '', equipment: '', explanation: '' });
      assert.equal(expired.result, null);
      await assert.rejects(service.submit('alice', session.id, { requestId: 'expired-submit', answer: right }), isCode('SESSION_CLOSED'));
      assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM study_requests WHERE session_id=$1 AND response IS NOT NULL', [session.id])).rows[0].n, 0);
      const original = await service.start('alice', 'expiry-start');
      time = new Date('2026-09-20T00:00:00Z');
      const replay = await service.start('alice', 'expiry-start');
      assert.equal(replay.id, original.id);
      assert.equal(replay.status, 'expired');
      assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM study_requests WHERE request_id='expiry-start'")).rows[0].n, 1);
      await service.purgeExpired();
    });
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
