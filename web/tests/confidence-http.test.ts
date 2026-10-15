import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createConfidenceHandler, profilePayload } from '../src/http/confidence-handler';
import { createConfidenceService } from '../src/server/confidence-service';
import type { SubjectPack } from '../src/domain/onboarding';

const ref = { subjectId: 'bookkeeping' as const, conceptId: 'prepaid', conceptVersion: 'v2' };
const catalog: SubjectPack[] = [{ subjectId: 'bookkeeping', version: 'v2', active: true,
  concepts: [{ ...ref, label: '前払費用', importance: 4, durationMinutes: 2, unseenQuestionCount: 0 }] },
{ subjectId: 'income-tax', version: 'v1', active: false, concepts: [] }];
const headers = { host: 'localhost:3210', origin: 'http://localhost:3210', 'content-type': 'application/json' };
const get = (cookie = '', query = '') => new Request(`http://localhost:3210/api/profile${query}`, { headers: { ...headers, cookie } });
const post = (body: unknown, cookie = '', extra: Record<string, string> = {}) => new Request('http://localhost:3210/api/profile', {
  method: 'POST', headers: { ...headers, cookie, ...extra }, body: JSON.stringify(body),
});
const save = () => ({ requestId: randomUUID(), revision: 0, reports: [{ ...ref, selfConfidence: 'uncertain' }] });

test('retired confidence versions do not block saving exam subjects and active reports in another subject survive', async () => {
  const db = new PGlite();
  try {
    const other = { ...catalog[0], subjectId: 'financial-statements' as const,
      concepts: [{ ...catalog[0].concepts[0], subjectId: 'financial-statements' as const }] };
    const original = [...catalog, other];
    const owner = randomUUID();
    const service = await createConfidenceService(db, original);
    const reports = [ref, other.concepts[0]].map(concept => ({ subjectId: concept.subjectId, conceptId: concept.conceptId,
      conceptVersion: concept.conceptVersion, selfConfidence: 'uncertain' as const }));
    await service.save(owner, { ...save(), reports });
    const updated = [other, { ...catalog[0], concepts: [{ ...catalog[0].concepts[0], conceptVersion: 'v3' }] }];
    const current = await createConfidenceService(db, updated);
    const payload = profilePayload(await current.get(owner), 'bookkeeping', updated, false);
    assert.deepEqual(payload.profile.reports, [reports[1]]);
    assert.equal(payload.profile.revision, 1);
    // A GET must not mutate persisted history; the next explicit save removes retired reports.
    assert.deepEqual((await current.get(owner)).reports, reports);
    const saved = await current.save(owner, { requestId: randomUUID(), revision: payload.profile.revision,
      reports: payload.profile.reports, examSubjects: ['income-tax'] });
    assert.deepEqual(saved.reports, [reports[1]]);
    assert.deepEqual(saved.examSubjects, ['income-tax']);
    assert.deepEqual(profilePayload(saved, 'income-tax', [], false).profile.reports, []);
  } finally { await db.close(); }
});

test('profile guard, owner requirement and bounded strict input reject before service initialization', async () => {
  let calls = 0;
  const factory = async (): Promise<never> => { calls++; throw new Error('must not connect'); };
  const handler = createConfidenceHandler(factory, () => '1', catalog);
  const owner = `zc-user=${randomUUID()}`;
  const cases: [Request, number][] = [
    [post(save()), 401], [post(save(), owner, { origin: 'https://evil.test' }), 403],
    [post(save(), owner, { 'sec-fetch-site': 'cross-site' }), 403],
    [post(save(), owner, { host: 'evil.test' }), 403],
    [post(save(), owner, { 'content-type': 'text/plain' }), 415],
    [post({ ...save(), ownerId: randomUUID() }, owner), 400],
    [post({ ...save(), reports: [{ ...ref, selfConfidence: 'mastered' }] }, owner), 400],
    [post({ ...save(), requestId: 'bad' }, owner), 400],
    [post({ ...save(), revision: -1 }, owner), 400],
    ...[false, 'bookkeeping', {}, ['invalid'], ['bookkeeping', 'bookkeeping'], Array(12).fill('bookkeeping'), [null]].map(
      examSubjects => [post({ ...save(), examSubjects }, owner), 400] as [Request, number]),
    [post({ ...save(), reports: 'x'.repeat(17000) }, owner, { 'content-length': '1' }), 413],
    [get('zc-user=bad'), 400], [get(`${owner}; ${owner}`), 400],
    [get('', '?subjectId=bookkeeping&subjectId=income-tax'), 400], [get('', '?subjectId=not-a-subject'), 400],
  ];
  for (const [request, status] of cases) {
    const response = await handler(request);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await createConfidenceHandler(factory, () => undefined, catalog)(get())).status, 503);
  assert.equal(calls, 0);
});

test('initial GET creates only owner cookie; registry shows unavailable subjects honestly', async () => {
  const handler = createConfidenceHandler(async () => { throw new Error('not needed'); }, () => '1', catalog);
  const response = await handler(get());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.profile, { revision: 0, updatedAt: null, reports: [], examSubjects: null });
  assert.equal(body.subjects.length, 11);
  assert.equal(body.developmentOnly, true);
  assert.match(body.materialNotice, /出荷承認済みの教材ではありません/);
  assert.deepEqual(body.subjects.filter((s: { available: boolean }) => s.available).map((s: { id: string }) => s.id), ['bookkeeping']);
  assert.equal(body.recommendations[0].basis, 'unselected');
  assert.equal(body.concepts[0].conceptId, ref.conceptId);
  assert.match(response.headers.get('set-cookie')!, /^zc-user=[^;]+; HttpOnly; SameSite=Strict;/);
  assert.equal(response.headers.get('set-cookie')!.includes('zc-session='), false);
  const unavailable = await (await handler(get('', '?subjectId=income-tax'))).json();
  assert.deepEqual(unavailable.recommendations, []);
  assert.deepEqual(unavailable.concepts, []);
});

test('profile HTTP persistence is exact-owner scoped, version checked and idempotent', async () => {
  const db = new PGlite();
  try {
    const service = await createConfidenceService(db, catalog);
    const handler = createConfidenceHandler(async () => service, () => '1', catalog);
    const alice = `zc-user=${randomUUID()}`, bob = `zc-user=${randomUUID()}`;
    const input = save();
    const first = await handler(post(input, alice));
    assert.equal(first.status, 200);
    assert.match(first.headers.get('set-cookie')!, new RegExp(`^${alice};`));
    const saved = await first.json();
    assert.equal(saved.profile.revision, 1);
    assert.deepEqual(await (await handler(post(input, alice))).json(), saved);
    assert.equal((await handler(post({ ...input, reports: [] }, alice))).status, 409);
    assert.equal((await handler(post({ ...save(), reports: [{ ...ref, conceptVersion: 'old', selfConfidence: null }] }, bob))).status, 409);
    const restored = await (await handler(get(alice))).json();
    assert.deepEqual(restored.profile, saved.profile);
    assert.equal(restored.recommendations[0].basis, 'self-report');
    assert.equal((await (await handler(get(bob))).json()).profile.revision, 0);
    assert.equal((await handler(post(input, bob))).status, 200);
    const tables = (await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(row => row.table_name).sort();
    assert.deepEqual(tables, ['confidence_profiles', 'confidence_requests', 'owner_access']);
  } finally { await db.close(); }
});

test('unexpected service failures return opaque no-store error without identifiers or cookies', async () => {
  const handler = createConfidenceHandler(async () => { throw new Error('postgres secret /private/user'); }, () => '1', catalog);
  const response = await handler(get(`zc-user=${randomUUID()}`));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'INTERNAL_ERROR' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
});

test('受験予定科目は教材提供状況や今日の科目とは独立し、null・空配列・省略をHTTPで保持する', async () => {
  const db = new PGlite();
  try {
    const service = await createConfidenceService(db, catalog);
    const handler = createConfidenceHandler(async () => service, () => '1', catalog);
    const owner = `zc-user=${randomUUID()}`;
    const input = { ...save(), examSubjects: ['income-tax', 'bookkeeping'] };
    const response = await handler(post(input, owner));
    assert.equal(response.status, 200);
    const saved = (await response.json()).profile;
    assert.deepEqual(saved.examSubjects, ['bookkeeping', 'income-tax']);
    const today = await (await handler(get(owner, '?subjectId=financial-statements'))).json();
    assert.equal(today.subjectId, 'financial-statements');
    assert.deepEqual(today.profile, saved);
    assert.deepEqual(today.concepts, []);
    const oldClient = await handler(post({ ...save(), revision: 1 }, owner));
    assert.equal(oldClient.status, 200);
    assert.deepEqual((await oldClient.json()).profile.examSubjects, saved.examSubjects);
    for (const [revision, examSubjects] of [[2, []], [3, null]] as const) {
      const changed = await handler(post({ ...save(), revision, examSubjects }, owner));
      assert.equal(changed.status, 200);
      const profile = (await changed.json()).profile;
      assert.deepEqual(profile.examSubjects, examSubjects);
      assert.deepEqual(profile.reports, saved.reports);
    }
    assert.equal((await (await handler(get(owner))).json()).profile.examSubjects, null);
  } finally { await db.close(); }
});
