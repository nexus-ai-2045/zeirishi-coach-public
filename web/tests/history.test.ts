import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createCafeService } from '../src/server/cafe-service';
import { createHistoryHandler } from '../src/http/history-handler';

function request(owner?: string, query = '') {
  return new Request(`http://127.0.0.1:3210/api/history${query}`, {
    headers: { host: '127.0.0.1:3210', ...(owner ? { cookie: `zc-user=${owner}` } : {}) },
  });
}
test('history requires local owner, rejects query overrides and hides unexpected error details', async () => {
  let calls = 0;
  const get = async (): Promise<never> => { calls++; throw new Error('/private/secret'); };
  const handler = createHistoryHandler(get, () => '1');
  assert.equal((await handler(request())).status, 401);
  assert.equal((await handler(request(randomUUID(), '?owner=other'))).status, 400);
  assert.equal((await createHistoryHandler(get, () => undefined)(request(randomUUID()))).status, 503);
  assert.equal(calls, 0);
  const error = await handler(request(randomUUID()));
  assert.equal(error.status, 500);
  assert.deepEqual(await error.json(), { error: 'INTERNAL_ERROR' });
  assert.equal(error.headers.get('cache-control'), 'no-store');
});

test('history is owner-scoped and cannot reveal correctness before confidence, even after expiry', async () => {
  const db = new PGlite();
  let now = new Date('2026-09-08T00:00:00Z');
  try {
    const service = await createCafeService(db, () => now);
    const alice = randomUUID(), bob = randomUUID();
    const opened = await service.start(alice, randomUUID());
    assert.deepEqual(await service.history(alice), []);
    const draftResponse = await createHistoryHandler(async () => service, () => '1')(request(alice));
    assert.equal((await draftResponse.json()).drafts[0].caseId, opened.id);
    await service.submit(alice, opened.id, { requestId: randomUUID(), optionId: 'h4r9' });
    let history = await service.history(alice);
    assert.equal(history.length, 1);
    assert.equal(history[0].correct, null);
    assert.equal(history[0].confidenceFixed, false);
    assert.equal(history[0].evidenceQualification, 'practice_only');
    assert.equal(JSON.stringify(history).includes('40,000'), false);
    assert.deepEqual(await service.history(bob), []);
    const fixed = await service.confidence(alice, opened.id, { requestId: randomUUID(), confidence: null });
    const taught = await service.saveProgress(alice, opened.id, { requestId: randomUUID(), revision: fixed.progressRevision, phase: 'teach_back', explanation: 'private explanation' });
    await service.saveProgress(alice, opened.id, { requestId: randomUUID(), revision: taught.progressRevision, phase: 'reflection', explanation: 'private explanation' });
    await service.complete(alice, opened.id, { requestId: randomUUID() });
    history = await service.history(alice);
    assert.equal(history[0].status, 'completed');
    assert.equal(history[0].correct, true);
    assert.equal(JSON.stringify(history).includes('private explanation'), false);
    const waiting = await service.start(alice, randomUUID());
    await service.submit(alice, waiting.id, { requestId: randomUUID(), optionId: 'c7m2' });
    now = new Date('2026-09-16T00:00:00Z');
    const expired = (await service.history(alice)).find(item => item.caseId === waiting.id)!;
    assert.equal(expired.phase, 'expired');
    assert.equal(expired.correct, null);
    const handler = createHistoryHandler(async () => service, () => '1');
    const response = await handler(request(alice));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie')!, new RegExp(`zc-user=${alice}`));
    assert.equal((await response.json()).items.length, 2);
  } finally { await db.close(); }
});
