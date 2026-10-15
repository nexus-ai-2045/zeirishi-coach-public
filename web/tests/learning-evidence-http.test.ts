import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createLearningEvidenceHandler, createLearnerLearningEvidenceHandler } from '../src/http/learning-evidence-handler';
import { createExamEvidenceService } from '../src/server/exam-evidence-service';
import { initializeReviewSchema } from '../src/server/review-service';
import { initializeMasteryEvidenceSchema } from '../src/server/mastery-evidence-service';
import { examEvidencePayloadSha256, type ExamEvidenceDocument } from '../src/server/exam-evidence-registry';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const query = '?subjectId=bookkeeping&examYear=2026&criterionVersion=unconfirmed';
function request(suffix = query, cookie = owner, method = 'GET') {
  return new Request(`http://localhost:3210/api/learning-evidence${suffix}`, { method,
    headers: { host: 'localhost:3210', origin: 'http://localhost:3210', 'content-type': 'application/json', cookie: cookie ? `zc-user=${cookie}` : '' },
    ...(method === 'POST' ? { body: JSON.stringify({ administrator: true, ownerId: other }) } : {}) });
}
// Synthetic, deliberately incomplete evidence; no actual expert approval.
function fixture(): ExamEvidenceDocument {
  const document: ExamEvidenceDocument = { schemaVersion: 'exam-evidence-v1', ownerId: other,
    record: { id: 'private-other-result', recordVersion: 'fixture-v1', subjectId: 'bookkeeping', examYear: 2026,
      kind: 'external_comprehensive', provider: '架空テスト', examId: 'fixture-exam', familyId: 'fixture-family', completedAt: '2020-01-01T00:00:00Z',
      score: 70, maxScore: 100, criterion: null, comparisonReview: null, elapsedMinutes: null, timeLimitMinutes: null,
      timeAllocation: [], rank: null, unseenDeclaration: null, freshProblem: null, freshFamily: null, aiAssisted: null, hintsUsed: null,
      measurementQuality: { scoreVerified: false, timingVerified: false, coverageVerified: false }, unmeasuredRanges: [] },
    provenance: { sourceUrl: 'https://example.test/private-result', sourceReference: 'private-reference', importedBy: 'private-operator', importedAt: '2020-01-02T00:00:00Z' },
    attestation: { reviewerId: 'private-reviewer', reviewedAt: '2020-01-02T00:00:00Z', payloadSha256: '' } };
  document.attestation.payloadSha256 = examEvidencePayloadSha256(document); return document;
}

test('隔離DBのHTTP: 本人必須・不正query/POST拒否・空証拠保留・他人非露出', async () => {
  const db = new PGlite();
  try {
    const management = await createExamEvidenceService(db);
    await initializeReviewSchema(db);
    await initializeMasteryEvidenceSchema(db);
    await management.save(other, { requestId: randomUUID(), revision: 0, document: fixture() });
    let reads = 0;
    const handler = createLearningEvidenceHandler(async () => { reads++; return db; }, () => '1');
    assert.equal((await handler(request(query, ''))).status, 401);
    for (const invalid of ['', `${query}&owner=${other}`, `${query}&asOf=2030-01-01T00:00:00Z`,
      `${query}&subjectId=bookkeeping`, query.replace('bookkeeping', 'unknown'), query.replace('2026', '2026.5'), query.replace('unconfirmed', 'bad%20version')]) {
      assert.equal((await handler(request(invalid))).status, 400, invalid);
    }
    assert.equal((await handler(request(query, owner, 'POST'))).status, 405);
    assert.equal(reads, 0);
    const ownResponse = await handler(request());
    assert.equal(ownResponse.status, 200); assert.match(ownResponse.headers.get('cache-control')!, /no-store/);
    const own = await ownResponse.json();
    assert.equal(own.assessment.status, 'held'); assert.deepEqual(own.assessment.records, []);
    assert.deepEqual(own.review, { evidenceCount: 0, correctionCount: 0, items: [] });
    assert.deepEqual(own.mastery, []);
    assert.doesNotMatch(JSON.stringify(own), /private-other-result|private-reference|private-operator|private-reviewer/);
    const theirs = await (await handler(request(query, other))).json();
    assert.equal(theirs.assessment.records.length, 1);
    assert.doesNotMatch(JSON.stringify(theirs), /private-reference|private-operator|private-reviewer|payloadSha256/);
  } finally { await db.close(); }
});

test('online本人未認証・失効はDBを取得せず拒否しcookie更新を残す', async () => {
  for (const missing of [true, false]) {
    let acquisitions = 0;
    const handler = createLearnerLearningEvidenceHandler({ getDatabase: () => { acquisitions++; throw new Error('must not acquire'); },
      config: () => ({ url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'test-only', appOrigin: 'https://coach.example' }),
      context: () => ({ headers: new Headers({ 'set-cookie': 'auth=refreshed; HttpOnly; Secure' }), reader: {
        getUser: async () => ({ error: false, user: missing ? null : { id: owner, isAnonymous: false, emailConfirmed: true } }),
        getAccess: async () => ({ userId: owner, status: 'revoked' }),
      } }),
    });
    const response = await handler(new Request(`https://coach.example/api/learning-evidence${query}`, { headers: { 'X-Zeirishi-Learner': owner } }));
    assert.equal(response.status, missing ? 401 : 403); assert.equal(acquisitions, 0);
    assert.match(response.headers.get('set-cookie')!, /auth=refreshed/);
    assert.match(response.headers.get('cache-control')!, /no-store/);
  }
});
