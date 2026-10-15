import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createCafeService } from '../src/server/cafe-service';
import { createLearnerHistoryHandler } from '../src/http/learner-history-handler';
import type { TransactionDatabase } from '../src/server/database';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const config = { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_test_only', appOrigin: 'https://coach.example' };
const request = (query = '', method = 'GET') => new Request(`${config.appOrigin}/api/history${query}`, {
  method, headers: { 'X-Zeirishi-Learner': alice, cookie: `zc-user=${bob}`, ...(method === 'POST' ? { origin: config.appOrigin, 'content-type': 'application/json' } : {}) },
});

test('verified history retains owner isolation, hidden-result gate and 20-item bound', async () => {
  const db = new PGlite();
  try {
    const service = await createCafeService(db);
    const a = await service.start(alice, randomUUID());
    await service.submit(alice, a.id, { requestId: randomUUID(), optionId: 'h4r9' });
    const b = await service.start(bob, randomUUID());
    await service.submit(bob, b.id, { requestId: randomUUID(), optionId: 'h4r9' });
    await service.confidence(bob, b.id, { requestId: randomUUID(), confidence: null });
    // Prepared service SQL is real in isolated PGlite. Role/JWT/private guard are
    // adapter stubs, not evidence of production PostgreSQL RLS enforcement.
    const prepared: TransactionDatabase = { transaction: operation => db.transaction(tx => operation({ query: async <T>(sql: string, params?: unknown[]) => {
      if (sql.includes('pg_catalog.pg_roles')) return { rows: [{ name: 'zeirishi_app', superuser: false, bypass: false }] as T[] };
      if (sql.includes('set_config') || sql.includes('require_active_learner')) return { rows: [] };
      return tx.query<T>(sql, params);
    } })) };
    const handler = createLearnerHistoryHandler({ config: () => config, getDatabase: () => prepared,
      context: () => ({ headers: new Headers({ 'Set-Cookie': 'auth=refreshed; HttpOnly; Secure' }), reader: {
        getUser: async () => ({ error: false, user: { id: alice, isAnonymous: false, emailConfirmed: true } }),
        getAccess: async id => ({ userId: id, status: 'active' }),
      } }),
    });
    const draft = await service.start(alice, randomUUID());
    const otherDraft = await service.start(bob, randomUUID());
    const first = await handler(request()); const data = await first.json();
    assert.equal(first.status, 200); assert.equal(data.developmentOnly, false); assert.equal(data.limit, 20);
    assert.equal(data.drafts.length, 1); assert.equal(data.drafts[0].caseId, draft.id);
    assert.equal(JSON.stringify(data.drafts).includes(otherDraft.id), false);
    assert.equal(Object.hasOwn(data.drafts[0], 'optionId'), false);
    assert.equal(data.items.length, 1); assert.equal(data.items[0].caseId, a.id);
    assert.equal(data.items[0].correct, null); assert.equal(data.items[0].confidenceFixed, false);
    assert.equal(data.items[0].evidenceQualification, 'practice_only');
    assert.equal(JSON.stringify(data).includes(b.id), false);
    assert.match(first.headers.get('set-cookie')!, /auth=refreshed/); assert.doesNotMatch(first.headers.get('set-cookie')!, /zc-user/);
    await service.confidence(alice, a.id, { requestId: randomUUID(), confidence: 'high' });
    assert.equal((await (await handler(request())).json()).items[0].correct, true);
    for (let index = 0; index < 21; index++) {
      const item = await service.start(alice, randomUUID());
      await service.submit(alice, item.id, { requestId: randomUUID(), optionId: 'h4r9' });
    }
    assert.equal((await (await handler(request())).json()).items.length, 20);
    assert.equal((await handler(request('?owner=' + bob))).status, 400);
    assert.equal((await handler(request('?limit=100'))).status, 400);
    assert.equal((await handler(request('', 'POST'))).status, 405);
  } finally { await db.close(); }
});

test('missing or revoked learner does not obtain a database for history', async () => {
  for (const missing of [true, false]) {
    let acquisitions = 0;
    const handler = createLearnerHistoryHandler({ config: () => config,
      getDatabase: () => { acquisitions++; throw new Error('must not run'); },
      context: () => ({ headers: new Headers(), reader: {
        getUser: async () => ({ error: false, user: missing ? null : { id: alice, isAnonymous: false, emailConfirmed: true } }),
        getAccess: async id => ({ userId: id, status: 'revoked' }),
      } }),
    });
    assert.equal((await handler(request())).status, missing ? 401 : 403); assert.equal(acquisitions, 0);
  }
});
