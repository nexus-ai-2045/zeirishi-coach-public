import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import type { SubjectPack } from '../src/domain/onboarding';
import { createConfidenceService } from '../src/server/confidence-service';
const ref = { subjectId: 'bookkeeping' as const, conceptId: 'prepaid', conceptVersion: 'v2' };
const catalog: SubjectPack[] = [{ subjectId: 'bookkeeping', version: 'v1', active: true, concepts: [
  { ...ref, label: '前払費用', importance: 3, durationMinutes: 5, unseenQuestionCount: 0 },
] }];
test('自信プロフィール: 未回答/所有者分離/冪等/競合/版をDBで検査する', async () => {
  const db = new PGlite();
  try {
    const service = await createConfidenceService(db, catalog);
    assert.deepEqual(await service.get('alice'), { revision: 0, updatedAt: null, reports: [], examSubjects: null });
    const input = { requestId: 'one', revision: 0, reports: [{ ...ref, selfConfidence: null }] };
    const [saved, replay] = await Promise.all([service.save('alice', input), service.save('alice', input)]);
    assert.deepEqual(saved, replay);
    assert.equal(saved.reports[0].selfConfidence, null);
    assert.equal((await service.get('bob')).revision, 0);
    await assert.rejects(service.save('alice', { ...input, requestId: 'two' }), /REVISION_CONFLICT/);
    await assert.rejects(service.save('alice', { ...input, reports: [] }), /REQUEST_CONFLICT/);
    await assert.rejects(service.save('alice', { ...input, requestId: 'old-version', reports: [{ ...ref, conceptVersion: 'old', selfConfidence: null }] }), /CONCEPT_VERSION_UNAVAILABLE/);
    await assert.rejects(service.save('alice', { ...input, reports: [...input.reports, ...input.reports] }), /DUPLICATE_CONCEPT/);
    const cleared = await service.save('alice', { requestId: 'clear', revision: 1, reports: [] });
    assert.deepEqual(cleared.reports, []);
    const tables = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    assert.deepEqual(tables.rows.map(x => x.tablename).sort(), ['confidence_profiles', 'confidence_requests', 'owner_access']);
    assert.deepEqual(await (await createConfidenceService(db, catalog)).get('alice'), cleared);
    const changedCatalog = await createConfidenceService(db, []);
    assert.deepEqual(await changedCatalog.save('alice', input), saved);
    await assert.rejects(changedCatalog.save('alice', { ...input, requestId: 'new-id', revision: 2 }), /CONCEPT_VERSION_UNAVAILABLE/);
  } finally { await db.close(); }
});

test('受験予定は未回答と明示なしを区別し、順序正規化・省略保持・同revision競合・所有者分離を守る', async () => {
  const db = new PGlite();
  try {
    const service = await createConfidenceService(db, catalog);
    const reports = [{ ...ref, selfConfidence: 'explained' }];
    const input = { requestId: 'exam-one', revision: 0, reports,
      examSubjects: ['income-tax', 'bookkeeping'] };
    const saved = await service.save('alice', input);
    assert.deepEqual(saved.examSubjects, ['bookkeeping', 'income-tax']);
    assert.deepEqual(saved.reports, reports);
    assert.equal((await service.get('bob')).examSubjects, null);
    assert.deepEqual(await service.save('alice', { ...input, examSubjects: [...input.examSubjects].reverse() }), saved);
    await assert.rejects(service.save('alice', { ...input, examSubjects: null }), /REQUEST_CONFLICT/);
    await assert.rejects(service.save('alice', { ...input, examSubjects: undefined }), /INVALID_ONBOARDING_INPUT/);
    await assert.rejects(service.save('alice', { requestId: input.requestId, revision: 0, reports }), /REQUEST_CONFLICT/);
    await assert.rejects(service.save('alice', { ...input, requestId: 'stale', examSubjects: [] }), /REVISION_CONFLICT/);
    const omitted = await service.save('alice', { requestId: 'old-client', revision: 1, reports });
    assert.deepEqual(omitted.examSubjects, saved.examSubjects);
    const none = await service.save('alice', { requestId: 'none', revision: 2, reports, examSubjects: [] });
    assert.deepEqual(none.examSubjects, []);
    assert.deepEqual(await service.save('alice', { requestId: 'none', revision: 2, reports, examSubjects: [] }), none);
    const unanswered = await service.save('alice', { requestId: 'unanswered', revision: 3, reports, examSubjects: null });
    assert.equal(unanswered.examSubjects, null);
    assert.deepEqual(unanswered.reports, reports);
    const concurrent = await Promise.allSettled([
      service.save('alice', { requestId: 'exam-race', revision: 4, reports, examSubjects: ['financial-statements'] }),
      service.save('alice', { requestId: 'confidence-race', revision: 4, reports: [] }),
    ]);
    assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(item => item.status === 'rejected').length, 1);
    assert.equal((await service.get('alice')).revision, 5);
    assert.equal((await service.get('bob')).revision, 0);
  } finally { await db.close(); }
});

test('受験予定の追加migrationは旧プロフィールと旧冪等receiptを保全し、再初期化できる', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE confidence_profiles (
      owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT, reports JSONB NOT NULL);
      CREATE TABLE confidence_requests (
      owner_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, response JSONB NOT NULL,
      PRIMARY KEY(owner_id,request_id));`);
    const reports = [{ ...ref, selfConfidence: 'uncertain' }];
    const oldResponse = { revision: 1, updatedAt: '2026-09-07T00:00:00.000Z', reports };
    const oldFingerprint = createHash('sha256').update(JSON.stringify({ revision: 0, reports })).digest('hex');
    await db.query('INSERT INTO confidence_profiles VALUES ($1,$2,$3,$4::jsonb)',
      ['alice', 1, oldResponse.updatedAt, JSON.stringify(reports)]);
    await db.query('INSERT INTO confidence_requests VALUES ($1,$2,$3,$4::jsonb)',
      ['alice', 'legacy', oldFingerprint, JSON.stringify(oldResponse)]);
    const service = await createConfidenceService(db, catalog);
    assert.deepEqual(await service.get('alice'), { ...oldResponse, examSubjects: null });
    assert.deepEqual(await service.save('alice', { requestId: 'legacy', revision: 0, reports }),
      { ...oldResponse, examSubjects: null });
    await assert.rejects(service.save('alice', { requestId: 'legacy', revision: 0, reports, examSubjects: null }), /REQUEST_CONFLICT/);
    const next = await service.save('alice', { requestId: 'new', revision: 1, reports, examSubjects: ['bookkeeping'] });
    assert.equal(next.revision, 2);
    assert.deepEqual(next.reports, reports);
    const restarted = await createConfidenceService(db, catalog);
    assert.deepEqual(await restarted.get('alice'), next);
    assert.equal((await restarted.save('alice', { requestId: 'legacy', revision: 0, reports })).examSubjects, null);
    assert.deepEqual((await restarted.get('alice')).examSubjects, ['bookkeeping']);
    const receipt = await db.query<{ fingerprint: string; response: unknown }>('SELECT fingerprint,response FROM confidence_requests WHERE request_id=$1', ['legacy']);
    assert.equal(receipt.rows[0].fingerprint, oldFingerprint);
    assert.deepEqual(receipt.rows[0].response, oldResponse);
  } finally { await db.close(); }
});
