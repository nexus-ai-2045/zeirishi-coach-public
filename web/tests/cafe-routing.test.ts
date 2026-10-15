import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createCafeService } from '../src/server/cafe-service';
import { createApprovedSupply } from '../src/server/approved-catalog';
import { createLearnerCafeHandler } from '../src/http/learner-cafe-handler';
import { parseCafeAction } from '../src/http/cafe-handler';
import type { TransactionDatabase } from '../src/server/database';
import { makeMaterialRecord, attestMaterialRecord } from './helpers/material-fixture';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
test('authenticated multi-material routing binds starts, reopens stored version and denies retired/foreign cases', async () => {
  const db = new PGlite();
  try {
    await createCafeService(db);
    const first = makeMaterialRecord(), second = makeMaterialRecord();
    second.materialId = 'test-second'; second.version = 'test-second-v1';
    // Two distinct consultations share one concept and its review version.
    second.document.prompt.caseId = second.materialId; second.document.prompt.caseVersion = second.version;
    second.document.prompt.conceptId = second.concept.conceptId; second.document.prompt.title = '別の教材';
    for (const result of Object.values(second.document.results)) result.caseVersion = second.version;
    attestMaterialRecord(second);
    let supply = createApprovedSupply([first, second]);
    // Auth role and membership SQL are stubbed; storage and request replay are real isolated PGlite.
    const prepared: TransactionDatabase = { transaction: operation => db.transaction(tx => operation({ query: async <T>(sql: string, params?: unknown[]) => {
      if (sql.includes('pg_catalog.pg_roles')) return { rows: [{ name: 'zeirishi_app', superuser: false, bypass: false }] as T[] };
      if (sql.includes('set_config') || sql.includes('require_active_learner')) return { rows: [] };
      return tx.query<T>(sql, params);
    } })) };
    const handler = createLearnerCafeHandler({ getMaterial: selection => supply.getMaterial(selection), getDatabase: () => prepared,
      config: () => ({ url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'test-only', appOrigin: 'https://coach.example' }),
      context: req => ({ headers: new Headers(), reader: {
        getUser: async () => ({ error: false, user: { id: req.headers.get('X-Zeirishi-Learner')!, isAnonymous: false, emailConfirmed: true } }),
        getAccess: async id => ({ userId: id, status: 'active' }),
      } }),
    });
    const call = async (body: object | null, caseId?: string, owner = alice) => handler(new Request(`https://coach.example/api/cafe${caseId ? '?caseId=' + caseId : ''}`, {
      method: body ? 'POST' : 'GET', headers: { 'X-Zeirishi-Learner': owner, ...(body ? { origin: 'https://coach.example', 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    assert.equal((await call({ action: 'start', requestId: randomUUID() })).status, 400);
    const concept = (record: typeof first) => ({ subjectId: record.subjectId, conceptId: record.concept.conceptId, conceptVersion: record.concept.conceptVersion });
    assert.equal((await call({ action: 'start', requestId: randomUUID(), concept: { ...concept(first), subjectId: 'income-tax' } })).status, 503);
    assert.equal((await call({ action: 'start', requestId: randomUUID(), concept: concept(first) })).status, 400);
    const start = { action: 'start', requestId: randomUUID(), concept: concept(second), materialId: second.materialId, caseVersion: second.version };
    assert.equal((await call({ ...start, materialId: 'not-offered' })).status, 503);
    assert.equal((await call({ ...start, caseVersion: 'old-case-version' })).status, 409);
    const response = await call(start); assert.equal(response.status, 200);
    const item = (await response.json()).session; assert.equal(item.prompt.title, '別の教材');
    assert.equal((await (await call(start)).json()).session.id, item.id);
    const reused = await call({ ...start, concept: concept(first), materialId: first.materialId, caseVersion: first.version }); assert.equal(reused.status, 409); assert.deepEqual(await reused.json(), { error: 'REQUEST_CONFLICT' });
    assert.equal((await (await call(null, item.id)).json()).session.caseVersion, second.version);
    assert.equal((await call(null, item.id, bob)).status, 404);
    const submitted = { action: 'submit', requestId: randomUUID(), caseId: item.id, optionId: item.prompt.options[0].id };
    assert.equal((await (await call(submitted)).json()).session.result, null);
    second.status = 'retired'; supply = createApprovedSupply([first, second]);
    assert.equal((await call(null, item.id)).status, 503);
    assert.equal((await call(submitted)).status, 503);
    const saved = (await db.query<{ case_version: string }>('SELECT case_version FROM cafe_instances WHERE id=$1', [item.id])).rows[0];
    assert.equal(saved.case_version, second.version);
  } finally { await db.close(); }
});

test('start concept is strictly bounded and local implicit start retains its historic fingerprint', async () => {
  for (const concept of [null, {}, { subjectId: 'unknown', conceptId: 'x', conceptVersion: 'v1' }, { subjectId: 'bookkeeping', conceptId: 'x', conceptVersion: 'v1', owner: alice }]) {
    assert.throws(() => parseCafeAction({ action: 'start', requestId: randomUUID(), concept }));
  }
  const db = new PGlite();
  try {
    const service = await createCafeService(db), requestId = randomUUID();
    const item = await service.start(alice, requestId);
    const saved = (await db.query<{ fingerprint: string }>('SELECT fingerprint FROM cafe_requests WHERE owner_id=$1 AND request_id=$2', [alice, requestId])).rows[0];
    assert.equal(saved.fingerprint, createHash('sha256').update(JSON.stringify({ operation: 'start' })).digest('hex'));
    assert.equal((await service.start(alice, requestId)).id, item.id);
    await assert.rejects(service.start(alice, requestId, { bindMaterialVersion: true }), /REQUEST_CONFLICT/);
  } finally { await db.close(); }
});
