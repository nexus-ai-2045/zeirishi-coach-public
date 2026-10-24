import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createWeeklyPlanHandler } from '../src/http/weekly-plan-handler';
import { createWeeklyPlanService } from '../src/server/weekly-plan-service';
import { createConfidenceService } from '../src/server/confidence-service';
import { DEVELOPMENT_CATALOG } from '../src/server/development-catalog';

const headers = { host: '127.0.0.1:3210', origin: 'http://127.0.0.1:3210', 'content-type': 'application/json' };
const body = () => ({ requestId: randomUUID(), revision: 0, weeklyMinutes: 60, excludedIds: [], adjustmentReason: '' });
const request = (input?: unknown, cookie = '', extra: Record<string, string> = {}, query = '') =>
  new Request(`http://127.0.0.1:3210/api/plan${query}`, { method: input === undefined ? 'GET' : 'POST',
    headers: { ...headers, cookie, ...extra }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
test('plan HTTP境界は匿名owner/loopback/Origin/厳密入力をDB接続前に検証する', async () => {
  let calls = 0;
  const handler = createWeeklyPlanHandler(async (): Promise<never> => { calls++; throw new Error('must not connect'); }, () => '1');
  const owner = `zc-user=${randomUUID()}`;
  const cases: [Request, number][] = [
    [request(), 401], [request(body()), 401], [request(body(), owner, { origin: 'https://evil.test' }), 403],
    [request(undefined, owner, { host: 'evil.test' }), 403], [request(body(), owner, { 'content-type': 'text/plain' }), 415],
    [request(undefined, 'zc-user=bad'), 400], [request(undefined, `${owner}; ${owner}`), 400],
    [request(undefined, owner, {}, '?owner=bob'), 400],
    [request({ ...body(), examSubjects: ['income-tax'] }, owner), 400],
    [request({ ...body(), weekStart: '2026-09-07' }, owner), 400],
    [request({ ...body(), requestId: 'not-uuid' }, owner), 400],
    [request({ ...body(), weeklyMinutes: 10081 }, owner), 400],
    [request({ ...body(), excludedIds: ['prepaid-expenses'] }, owner), 400],
    [request({ ...body(), adjustmentReason: 'x'.repeat(17000) }, owner), 413],
  ];
  for (const [input, status] of cases) {
    const response = await handler(input);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 0);
  const disabled = createWeeklyPlanHandler(async (): Promise<never> => { calls++; throw new Error('must not connect'); }, () => undefined);
  assert.equal((await disabled(request(undefined, owner))).status, 503);
  assert.equal(calls, 0);
  const failed = await handler(request(undefined, owner));
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'INTERNAL_ERROR' });
  assert.equal(failed.headers.get('set-cookie'), null);
});
test('plan HTTP保存とGETは版固定の同じ予定を返し、再送/所有者分離/手動理由を保つ', async () => {
  const db = new PGlite();
  try {
    const profile = await createConfidenceService(db, DEVELOPMENT_CATALOG);
    const service = await createWeeklyPlanService(db, DEVELOPMENT_CATALOG, () => new Date('2026-09-08T00:00:00Z'));
    const handler = createWeeklyPlanHandler(async () => service, () => '1');
    const id = randomUUID(), owner = `zc-user=${id}`;
    await profile.save(id, { requestId: 'profile', revision: 0, reports: [], examSubjects: ['bookkeeping'] });
    const input = body();
    const first = await handler(request(input, owner));
    assert.equal(first.status, 200);
    assert.match(first.headers.get('set-cookie')!, new RegExp(`^${owner};`));
    const saved = await first.json();
    assert.equal(saved.planRecord.plan.sessions.length, 1);
    assert.equal(saved.candidates.length, 1);
    assert.equal(saved.planRecord.profileRevision, 1);
    assert.deepEqual(await (await handler(request(input, owner))).json(), saved);
    assert.deepEqual(await (await handler(request(undefined, owner))).json(), saved);
    assert.equal((await handler(request({ ...body(), revision: 0 }, owner))).status, 409);
    const other = await (await handler(request(undefined, `zc-user=${randomUUID()}`))).json();
    assert.equal(other.planRecord, null);
    assert.equal((await handler(request({ ...body(), revision: 1, excludedIds: ['prepaid-expenses'], adjustmentReason: '別教材を使う' }, owner))).status, 200);
  } finally { await db.close(); }
});
