import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createMockExamService, parseMockExamSave, type MockExamSave } from '../src/server/mock-exam-service';
import { createMockExamHandler } from '../src/http/mock-exam-handler';
import { createLearnerMockExamHandler } from '../src/http/learner-mock-exam-handler';

const now = () => new Date('2026-09-08T00:00:00Z');
const input = (): MockExamSave => ({ requestId: crypto.randomUUID(), id: crypto.randomUUID(), revision: 0,
  record: { subjectId: 'bookkeeping', examYear: 2026, provider: '本人記入の主催者', examId: '第1回', completedOn: '2026-09-07',
    score: 60, maxScore: 100, elapsedMinutes: 120, rank: { position: 10, population: 100 }, unseen: null } });

test('本人参考記録の厳密入力は権限・専門確認・偽の資格と不正得点日時を受け入れない', () => {
  const source = input();
  assert.equal(parseMockExamSave(source, now()).record.unseen, null);
  for (const bad of [null, { ...source, owner: 'other' }, { ...source, revision: -1 }, { ...source, id: 'not-uuid' },
    { ...source, record: { ...source.record, evidenceQualification: 'eligible' } },
    ...[{ score: -1 }, { score: 101 }, { maxScore: 0 }, { score: NaN }, { examYear: 2026.5 },
      { completedOn: '2026-02-30' }, { completedOn: '2026-09-09' }, { elapsedMinutes: -1 },
      { rank: { position: 2, population: 1 } }, { rank: { position: 1.2, population: 10 } },
      { rank: [] }, { unseen: 'yes' }, { subjectId: 'unknown' }, { provider: 'x'.repeat(201) }]
      .map(change => ({ ...source, record: { ...source.record, ...change } }))]) {
    assert.throws(() => parseMockExamSave(bad, now()), /INVALID_MOCK_EXAM/);
  }
  assert.equal(parseMockExamSave({ ...source, record: { ...source.record, completedOn: '2026-09-08' } }, new Date('2026-09-07T15:00:00Z')).record.completedOn, '2026-09-08');
});

test('owner分離、CAS、再送で後続修正を戻さず現在結果を返し、一覧20件と単一再取得を維持する', async () => {
  const db = new PGlite();
  try {
    const service = await createMockExamService(db, now);
    const first = input(), saved = await service.save('alice', first);
    assert.equal(saved.evidenceQualification, 'self_report_only');
    assert.equal(saved.revision, 1);
    assert.deepEqual(await service.list('bob'), []);
    await assert.rejects(service.get('bob', first.id), /NOT_FOUND/);
    const updated = await service.save('alice', { ...first, requestId: crypto.randomUUID(), revision: 1,
      record: { ...first.record, score: 59 } });
    assert.equal(updated.revision, 2);
    assert.deepEqual(await service.save('alice', first), updated);
    const receipt = (await db.query<{ response: unknown }>('select response from mock_exam_requests where owner_id=$1 and request_id=$2', ['alice', first.requestId])).rows[0];
    assert.deepEqual(receipt.response, saved);
    await assert.rejects(service.save('alice', { ...first, requestId: crypto.randomUUID() }), /MOCK_EXAM_REVISION_CONFLICT/);
    await assert.rejects(service.save('alice', { ...first, record: { ...first.record, score: 61 } }), /REQUEST_CONFLICT/);
    const restarted = await createMockExamService(db, now);
    assert.deepEqual(await restarted.get('alice', first.id), updated);
    for (let i = 0; i < 22; i++) await service.save('alice', input());
    const listed = await service.list('alice');
    assert.equal(listed.length, 20);
    assert.deepEqual(listed.map(item => item.id), listed.map(item => item.id).sort().reverse());
    assert.deepEqual(await service.get('alice', first.id), updated);
  } finally { await db.close(); }
});

test('local HTTPは同一origin・cookieを必要とし、不明query拒否、保存と個別取得を返す', async () => {
  const db = new PGlite();
  try {
    const service = await createMockExamService(db, now);
    const handler = createMockExamHandler(async () => service, () => '1');
    const owner = crypto.randomUUID(), save = input();
    const request = (body?: unknown, query = '', headers = {}) => new Request(`http://localhost:3210/api/mock-exams${query}`, {
      method: body ? 'POST' : 'GET', headers: { host: 'localhost:3210', origin: 'http://localhost:3210',
        'content-type': 'application/json', cookie: `zc-user=${owner}`, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await handler(request(undefined, '?owner=other'))).status, 400);
    assert.equal((await handler(request(save, '', { origin: 'https://other.example' }))).status, 403);
    assert.equal((await handler(request(undefined, '', { cookie: '' }))).status, 401);
    const response = await handler(request(save)); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.developmentOnly, true);
    const single = await handler(request(undefined, `?id=${save.id}`));
    assert.deepEqual(await single.json(), data);
    assert.equal((await handler(request(undefined, `?id=${crypto.randomUUID()}`))).status, 404);
    assert.equal((await handler(request(save, `?id=${save.id}`))).status, 400);
    assert.equal((await (await handler(request())).json()).items.length, 1);
  } finally { await db.close(); }
});

test('online未認証・失効はDB取得前に拒否しrefresh cookieを保全する', async () => {
  const owner = crypto.randomUUID();
  for (const missing of [true, false]) {
    let acquisitions = 0;
    const handler = createLearnerMockExamHandler({
      getDatabase: () => { acquisitions++; throw new Error('must not acquire'); },
      config: () => ({ url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'test-only', appOrigin: 'https://coach.example' }),
      context: () => ({ headers: new Headers({ 'set-cookie': 'auth=refreshed; HttpOnly; Secure' }), reader: {
        getUser: async () => ({ error: false, user: missing ? null : { id: owner, isAnonymous: false, emailConfirmed: true } }),
        getAccess: async () => ({ userId: owner, status: 'revoked' }),
      } }),
    });
    const response = await handler(new Request('https://coach.example/api/mock-exams', { headers: { 'X-Zeirishi-Learner': owner } }));
    assert.equal(response.status, missing ? 401 : 403);
    assert.equal(acquisitions, 0);
    assert.match(response.headers.get('set-cookie')!, /auth=refreshed/);
    assert.match(response.headers.get('cache-control')!, /no-store/);
  }
});
