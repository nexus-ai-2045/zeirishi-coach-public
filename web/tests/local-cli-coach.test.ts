import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createCafeService } from '../src/server/cafe-service';
import { AI_COACH_SCHEMA, createAiCoachServiceOnPreparedDatabase } from '../src/server/ai-coach-service';
import { createLocalClaudeCoachProvider } from '../src/server/local-cli-coach';

test('local CLI sees only synthetic case facts and saved explanation; subscription does not invent yen', async () => {
  const db = new PGlite();
  try {
    const cafe = await createCafeService(db); await db.exec(AI_COACH_SCHEMA);
    const start = await cafe.start('alice', 'start');
    await cafe.submit('alice', start.id, { requestId: 'submit', optionId: 'h4r9' });
    const revealed = await cafe.confidence('alice', start.id, { requestId: 'confidence', confidence: null });
    const saved = await cafe.saveProgress('alice', start.id, { requestId: 'save', revision: revealed.progressRevision,
      phase: 'teach_back', explanation: '支払った12万円と当期4か月分は違います。' });
    let seen = '';
    const provider = createLocalClaudeCoachProvider(async prompt => {
      seen = prompt;
      return { subtype: 'success', structured_output: { reply: '期間を分けて考えられています。', follow_up: '翌期8か月分はどう扱いますか？' } };
    });
    const service = createAiCoachServiceOnPreparedDatabase(db, { provider });
    const input = { requestId: 'ai', attemptId: saved.attemptId, caseVersion: saved.caseVersion,
      progressRevision: saved.progressRevision, purpose: 'explain_to_owner' as const, explanation: saved.explanation, confirmed: true as const };
    const result = await service.request('alice', start.id, input);
    assert.equal(result.mode, 'ai'); assert.equal(result.evidenceQualification, 'practice_only');
    assert.match(seen, /saved_explanation/); assert.match(seen, /当期4か月/);
    assert.doesNotMatch(seen, /alice|attemptId|requestId|owner_id/);
    const row = (await db.query<{reserved_milliyen:number;actual_milliyen:number|null;status:string}>(
      'SELECT reserved_milliyen,actual_milliyen,status FROM ai_interaction_summaries')).rows[0];
    assert.deepEqual(row, { reserved_milliyen: 0, actual_milliyen: null, status: 'completed' });
    assert.equal((await db.query('SELECT * FROM ai_coach_budgets')).rows.length, 0);
    const failed = createAiCoachServiceOnPreparedDatabase(db, { provider: createLocalClaudeCoachProvider(async () => {
      throw new Error('private-auth-details');
    }) });
    assert.equal((await failed.request('alice', start.id, { ...input, requestId: 'failed' })).reason, 'provider_unavailable');
    assert.equal((await failed.request('alice', start.id, { ...input, requestId: 'retry' })).reason, 'provider_unavailable');
    assert.deepEqual((await db.query<{status:string}>('SELECT status FROM ai_interaction_summaries WHERE request_id IN ($1,$2) ORDER BY request_id', ['failed','retry'])).rows,
      [{ status: 'failed' }, { status: 'failed' }]);
  } finally { await db.close(); }
});

test('local CLI rejects non-allowlisted material and malformed model output', async () => {
  const provider = createLocalClaudeCoachProvider(async () => ({ subtype: 'success', structured_output: { reply: 'OK', follow_up: '' } }));
  const signal = new AbortController().signal;
  await assert.rejects(provider.generate({ case_version: 'unreviewed', purpose: 'rephrase', explanation: '説明', selected_option_id: 'h4r9' },
    { signal, maxOutputCharacters: 2000 }));
  await assert.rejects(provider.generate({ case_version: 'synthetic-cafe-prepaid-v2', purpose: 'rephrase', explanation: '説明', selected_option_id: 'h4r9' },
    { signal, maxOutputCharacters: 2000 }));
});

test('local CLI receives the selected wrong answer and bounded question as learning context', async () => {
  let seen = '';
  const provider = createLocalClaudeCoachProvider(async prompt => {
    seen = prompt;
    return { subtype: 'success', structured_output: { reply: '当期に使った4か月分だけです。', follow_up: '残りはどう扱いますか？' } };
  });
  const result = await provider.generate({ case_version: 'synthetic-cafe-prepaid-v2', purpose: 'rephrase', explanation: '',
    selected_option_id: 'c7m2', question: '12万円は全部費用？', recent_turns: [{ question: 'さっきの答えは？', reply: '月割りです。' }] },
    { signal: new AbortController().signal, maxOutputCharacters: 2000 });
  assert.match(seen, /"selected_answer":"120,000円"/);
  assert.match(seen, /"learner_question":"12万円は全部費用？"/);
  assert.match(seen, /recent_chat_untrusted/);
  assert.equal(result.reply, '当期に使った4か月分だけです。');
});
