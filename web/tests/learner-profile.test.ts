import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createConfidenceService } from '../src/server/confidence-service';
import { createLearnerProfileHandler } from '../src/http/learner-profile-handler';
import type { TransactionDatabase } from '../src/server/database';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const settings = { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_test_only', appOrigin: 'https://coach.example' };
function req(body?: unknown, query = '', cookieOwner = bob) {
  return new Request(`${settings.appOrigin}/api/profile${query}`, { method: body ? 'POST' : 'GET',
    headers: { 'X-Zeirishi-Learner': alice, cookie: `zc-user=${cookieOwner}`, ...(body ? { origin: settings.appOrigin, 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function fixture() {
  const db = new PGlite();
  const raw = await createConfidenceService(db, []);
  let userId: string | null = alice; let invited = true; let revoked = false; let acquisitions = 0;
  const headers = new Headers({ 'Set-Cookie': 'verified=refresh; HttpOnly; Secure' });
  // SQL persistence/CAS are real isolated PGlite. Role, JWT claims and private
  // membership guard are stubs here: this is not production PostgreSQL RLS proof.
  const prepared: TransactionDatabase = { transaction: operation => db.transaction(tx => operation({ query: async <T>(sql: string, params?: unknown[]) => {
    if (sql.includes('pg_catalog.pg_roles')) return { rows: [{ name: 'zeirishi_app', superuser: false, bypass: false }] as T[] };
    if (sql.includes('set_config')) return { rows: [] };
    if (sql.includes('require_active_learner')) { if (revoked) throw { code: 'ZC403' }; return { rows: [] }; }
    return tx.query<T>(sql, params);
  } })) };
  const handler = createLearnerProfileHandler({ catalog: [], config: () => settings,
    getDatabase: () => { acquisitions++; return prepared; },
    context: () => ({ headers, reader: {
      getUser: async () => ({ error: false, user: userId ? { id: userId, isAnonymous: false, emailConfirmed: true } : null }),
      getAccess: async id => ({ userId: id, status: invited ? 'active' : 'revoked' }),
    } }),
  });
  return { db, raw, handler, acquisitions: () => acquisitions, setUser: (id: string | null) => { userId = id; },
    setInvited: (value: boolean) => { invited = value; }, revoke: () => { revoked = true; } };
}

test('empty production catalog exposes 11 unavailable subjects and verified-owner profile, not forged fixture cookie', async () => {
  const fx = await fixture();
  try {
    await fx.raw.save(bob, { requestId: randomUUID(), revision: 0, reports: [], examSubjects: ['income-tax'] });
    const response = await fx.handler(req()); const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.developmentOnly, false); assert.equal(data.profile.examSubjects, null);
    assert.equal(data.subjects.length, 11); assert.ok(data.subjects.every((subject: { available: boolean }) => !subject.available));
    assert.deepEqual(data.concepts, []); assert.deepEqual(data.recommendations, []);
    assert.match(response.headers.get('set-cookie')!, /verified=refresh/); assert.doesNotMatch(response.headers.get('set-cookie')!, /zc-user/);
    assert.match(data.materialNotice, /オンラインの本人用/);
  } finally { await fx.db.close(); }
});

test('exam subject save, replay and CAS use real prepared storage without accepting unreviewed concepts', async () => {
  const fx = await fixture();
  try {
    const body = { requestId: randomUUID(), revision: 0, reports: [], examSubjects: ['bookkeeping', 'income-tax'] };
    const first = await fx.handler(req(body)); const saved = await first.json();
    assert.equal(first.status, 200); assert.equal(saved.profile.revision, 1); assert.equal(saved.developmentOnly, false);
    assert.deepEqual(await (await fx.handler(req(body))).json(), saved);
    const conflict = await fx.handler(req({ ...body, requestId: randomUUID() }));
    assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { error: 'REVISION_CONFLICT' });
    assert.equal((await fx.raw.get(bob)).revision, 0);
    assert.deepEqual((await (await fx.handler(req())).json()).profile.examSubjects, ['bookkeeping', 'income-tax']);
    const unreviewed = await fx.handler(req({ requestId: randomUUID(), revision: 1, reports: [{ subjectId: 'bookkeeping', conceptId: 'prepaid-expenses', conceptVersion: 'synthetic-cafe-prepaid-v2', selfConfidence: 'explained' }] }));
    assert.equal(unreviewed.status, 409); assert.deepEqual(await unreviewed.json(), { error: 'CONCEPT_VERSION_UNAVAILABLE' });
    assert.equal((await fx.raw.get(alice)).revision, 1);
    const clear = await fx.handler(req({ requestId: randomUUID(), revision: 1, reports: [], examSubjects: [] }));
    assert.deepEqual((await clear.json()).profile.examSubjects, []);
  } finally { await fx.db.close(); }
});

test('strict input maps onboarding errors to 400 and rejects query/body owner overrides', async () => {
  const fx = await fixture();
  try {
    for (const query of ['?owner=other', '?subjectId=bookkeeping&subjectId=bookkeeping', '?subjectId=unknown']) assert.equal((await fx.handler(req(undefined, query))).status, 400);
    const body = { requestId: randomUUID(), revision: 0, reports: [], examSubjects: ['unknown'] };
    const invalid = await fx.handler(req(body)); assert.equal(invalid.status, 400); assert.deepEqual(await invalid.json(), { error: 'INVALID_ONBOARDING_INPUT' });
    assert.equal((await fx.handler(req({ ...body, examSubjects: [] }, '?subjectId=bookkeeping'))).status, 400);
    assert.equal((await fx.handler(req({ ...body, examSubjects: [], ownerId: bob }))).status, 400);
  } finally { await fx.db.close(); }
});

test('unauthenticated and invitation-revoked requests avoid DB acquisition; transaction revocation blocks persistence', async () => {
  const fx = await fixture();
  try {
    fx.setUser(null); assert.equal((await fx.handler(req())).status, 401); assert.equal(fx.acquisitions(), 0);
    fx.setUser(alice); fx.setInvited(false); assert.equal((await fx.handler(req())).status, 403); assert.equal(fx.acquisitions(), 0);
    fx.setInvited(true); fx.revoke();
    const response = await fx.handler(req({ requestId: randomUUID(), revision: 0, reports: [], examSubjects: [] }));
    assert.equal(response.status, 403); assert.equal((await fx.raw.get(alice)).revision, 0);
  } finally { await fx.db.close(); }
});
