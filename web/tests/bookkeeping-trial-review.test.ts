import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { projectBookkeepingTrialReview, createBookkeepingTrialReviewReader, createBookkeepingTrialReviewHandler } from '../src/server/bookkeeping-trial-review';
import { getBookkeepingTrialMaterial, BOOKKEEPING_TRIAL_MATERIALS } from '../src/server/bookkeeping-trial-supply';
import { createCafeService, createCafeServiceOnPreparedDatabase } from '../src/server/cafe-service';
import { lockOwner } from '../src/server/owner-access';
import type { CafeMaterial } from '../src/server/cafe-case';
import { StudyError } from '../src/domain/types';
const jan1 = '2026-01-01T00:00:00.000Z', jan8 = '2026-01-08T00:00:00.000Z', jan22 = '2026-01-22T00:00:00.000Z';
const base = getBookkeepingTrialMaterial({ materialId: 'bk-practice-cash-is-not-profit-1' });
const seven = getBookkeepingTrialMaterial({ materialId: 'bk-retention-cash-is-not-profit-5' });
const twentyOne = getBookkeepingTrialMaterial({ materialId: 'bk-retention-cash-is-not-profit-8' });
const row = (material: CafeMaterial, completedAt: string) => ({ caseVersion: material.caseVersion, scoringVersion: material.scoringVersion, completedAt });
const cashItems = (value: ReturnType<typeof projectBookkeepingTrialReview>) => value.items.filter(item => item.conceptId === 'cash-is-not-profit');
async function complete(db: PGlite, owner: string, material: CafeMaterial, at: string) {
  const service = createCafeServiceOnPreparedDatabase(db, () => new Date(at), material);
  const started = await service.start(owner, randomUUID(), { bindMaterialVersion: true });
  await service.submit(owner, started.id, { requestId: randomUUID(), optionId: started.prompt.options[0].id });
  const confirmed = await service.confidence(owner, started.id, { requestId: randomUUID(), confidence: null });
  const explanation = '試用テストの本人説明';
  const taught = await service.saveProgress(owner, started.id, { requestId: randomUUID(), revision: confirmed.progressRevision, phase: 'teach_back', explanation });
  await service.saveProgress(owner, started.id, { requestId: randomUUID(), revision: taught.progressRevision, phase: 'reflection', explanation });
  return service.complete(owner, started.id, { requestId: randomUUID() });
}
test('7/21日境界を経過時間で判定し期限前は予定、未完了概念は不明', () => {
  const rows = [row(base, jan1)];
  const before = cashItems(projectBookkeepingTrialReview(rows, new Date('2026-01-07T23:59:59.999Z')));
  assert.deepEqual(before.map(item => item.status), ['scheduled', 'scheduled']);
  assert.deepEqual(before.map(item => item.scheduledFor), [jan8, jan22]);
  assert.deepEqual(cashItems(projectBookkeepingTrialReview(rows, new Date(jan8))).map(item => item.status), ['due', 'scheduled']);
  assert.deepEqual(cashItems(projectBookkeepingTrialReview(rows, new Date(jan22))).map(item => item.status), ['due', 'due']);
  const unknown = projectBookkeepingTrialReview([], new Date(jan22));
  assert.equal(unknown.items.length, 72);
  assert.ok(unknown.items.every(item => item.status === 'unknown' && item.anchorAt === null && item.scheduledFor === null));
  assert.equal(unknown.qualification, 'practice_only');
});
test('反復練習は予定を延期せず、保持だけの完了は基点にならない', () => {
  const repeat = projectBookkeepingTrialReview([row(base, jan1), row(base, '2026-01-20T00:00:00.000Z')], new Date(jan22));
  assert.ok(cashItems(repeat).every(item => item.anchorAt === jan1 && item.status === 'due'));
  const retentionOnly = projectBookkeepingTrialReview([row(seven, jan8), row(twentyOne, jan22)], new Date(jan22));
  assert.ok(cashItems(retentionOnly).every(item => item.status === 'unknown'));
});
test('同概念版・同保持familyを期限以後に完了した記録だけを消化し、早期・未来は除く', () => {
  const early = '2026-01-07T23:59:59.999Z';
  const rows = [row(base, jan1), row(seven, early), row(seven, jan8), row(twentyOne, '2026-01-23T00:00:00.000Z')];
  const at21 = cashItems(projectBookkeepingTrialReview(rows, new Date(jan22)));
  assert.deepEqual(at21.map(item => item.status), ['completed', 'due']);
  assert.equal(at21[0].completedAt, jan8);
  assert.equal(at21[1].anchorAt, jan1);
  assert.equal(cashItems(projectBookkeepingTrialReview([row(base, jan1), row(seven, early)], new Date(jan8)))[0].status, 'due');
  const other = getBookkeepingTrialMaterial({ materialId: 'bk-retention-double-entry-5' });
  assert.equal(cashItems(projectBookkeepingTrialReview([row(base, jan1), row(other, jan8)], new Date(jan8)))[0].status, 'due');
});
test('全教材resolverで概念へ対応し、旧版・採点版不一致を予定に使わない', () => {
  const originals = BOOKKEEPING_TRIAL_MATERIALS.filter(material => !material.prompt().caseId.startsWith('bk-retention-'));
  const review = projectBookkeepingTrialReview(originals.map(material => row(material, jan1)), new Date(jan8));
  assert.equal(review.unresolvedCompletions, 0);
  assert.ok(review.items.every(item => item.anchorAt === jan1));
  const invalid = projectBookkeepingTrialReview([{ ...row(base, jan1), scoringVersion: 'retired-scoring' }, { ...row(base, jan1), caseVersion: 'retired-case' }], new Date(jan8));
  assert.equal(invalid.unresolvedCompletions, 2);
  assert.ok(invalid.items.every(item => item.status === 'unknown'));
  assert.throws(() => projectBookkeepingTrialReview([{ ...row(base, jan1), completedAt: 'not-an-instant' }], new Date(jan8)), /INVALID_REVIEW_HISTORY/);
});
test('既存完了案件を所有者付きで読み提出中・他所有者は基点にせず、台帳を増やさない', async () => {
  const db = new PGlite();
  try {
    await createCafeService(db);
    const alice = randomUUID(), bob = randomUUID();
    await complete(db, bob, base, jan1);
    const service = createCafeServiceOnPreparedDatabase(db, () => new Date(jan1), base);
    const started = await service.start(alice, randomUUID());
    await service.submit(alice, started.id, { requestId: randomUUID(), optionId: started.prompt.options[0].id });
    const read = createBookkeepingTrialReviewReader(db, () => new Date(jan8));
    assert.ok((await read(alice)).items.every(item => item.status === 'unknown'));
    await complete(db, alice, base, jan1);
    const snapshot = async () => (await db.query("SELECT jsonb_build_object('instances',(SELECT jsonb_agg(i) FROM cafe_instances i),'attempts',(SELECT jsonb_agg(a) FROM cafe_attempts a),'progress',(SELECT jsonb_agg(p) FROM cafe_progress p)) AS value")).rows;
    const before = await snapshot();
    assert.deepEqual(cashItems(await read(alice)).map(item => item.status), ['due', 'scheduled']);
    assert.deepEqual(await snapshot(), before);
    const tables = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    assert.ok(!tables.rows.some(item => item.tablename.includes('trial_review')));
    await db.transaction(async tx => { const owner = await lockOwner(tx, alice); await tx.query('UPDATE owner_access SET revoked_at=$2 WHERE owner_hash=$1', [owner.hash, jan8]); });
    await assert.rejects(read(alice), error => error instanceof StudyError && error.code === 'OWNER_REVOKED');
  } finally { await db.close(); }
});
test('20件を超える履歴でも古い基点を失わず、履歴削除後は別台帳から復活しない', async () => {
  const db = new PGlite();
  try {
    await createCafeService(db);
    const owner = randomUUID();
    await complete(db, owner, base, jan1);
    for (let index = 0; index < 21; index++) await complete(db, owner, base, '2026-01-20T00:00:00.000Z');
    const read = createBookkeepingTrialReviewReader(db, () => new Date(jan22));
    assert.ok(cashItems(await read(owner)).every(item => item.anchorAt === jan1));
    await db.exec('DELETE FROM cafe_requests; DELETE FROM cafe_confidence; DELETE FROM cafe_attempts; DELETE FROM cafe_instances;');
    assert.ok((await read(owner)).items.every(item => item.status === 'unknown'));
  } finally { await db.close(); }
});
test('GETのみ・fixture/MVP/Supabase・cookie所有者・余分な指定を検査し、入口拒否時はDBを読まない', async () => {
  const db = new PGlite();
  try {
    await createCafeService(db);
    const alice = randomUUID(), bob = randomUUID();
    await complete(db, alice, base, jan1);
    let calls = 0, config = { fixtureMode: '1', bookkeepingMvp: '1', supabaseEnabled: '0' };
    const handle = createBookkeepingTrialReviewHandler({ getDatabase: async () => { calls++; return db; }, config: () => config, now: () => new Date(jan8) });
    const request = (cookie?: string, query = '', method = 'GET', host = '127.0.0.1:3210') => new Request(`http://${host}/api/practice-review${query}`, {
      method, headers: { host, ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin: `http://${host}`, 'content-type': 'application/json' } : {}) },
    });
    assert.equal((await handle(request())).status, 401);
    assert.equal((await handle(request('zc-user=bad'))).status, 400);
    assert.equal((await handle(request(`zc-user=${alice}; zc-user=${bob}`))).status, 400);
    assert.equal((await handle(request(`zc-user=${alice}`, '?owner=' + bob))).status, 400);
    assert.equal((await handle(request(`zc-user=${alice}`, '', 'POST'))).status, 405);
    assert.equal((await handle(request(`zc-user=${alice}`, '', 'GET', 'example.com'))).status, 403);
    config = { ...config, fixtureMode: '0' }; assert.equal((await handle(request(`zc-user=${alice}`))).status, 503);
    config = { ...config, fixtureMode: '1', bookkeepingMvp: '0' }; assert.equal((await handle(request(`zc-user=${alice}`))).status, 503);
    config = { ...config, bookkeepingMvp: '1', supabaseEnabled: '1' }; assert.equal((await handle(request(`zc-user=${alice}`))).status, 503);
    assert.equal(calls, 0);
    config = { ...config, supabaseEnabled: '0' };
    const response = await handle(request(`zc-user=${alice}`));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.developmentOnly, true);
    assert.ok(!/"(?:earned|correct|errorReason|explanation|owner_id)"/.test(JSON.stringify(body)));
    assert.deepEqual(cashItems(body).map(item => item.status), ['due', 'scheduled']);
    const foreign = await (await handle(request(`zc-user=${bob}`))).json();
    assert.ok(foreign.items.every((item: { status: string }) => item.status === 'unknown'));
  } finally { await db.close(); }
});
