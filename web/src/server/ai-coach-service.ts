import { createHash } from 'node:crypto';
import type { TransactionDatabase, QueryExecutor } from './database';
import { assertOwnerActive } from './owner-access';
import { StudyError } from '../domain/types';

export const AI_COACH_SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_coach_budgets (
 month TEXT PRIMARY KEY, reserved_milliyen INTEGER NOT NULL DEFAULT 0 CHECK(reserved_milliyen>=0)
);
CREATE TABLE IF NOT EXISTS ai_interaction_summaries (
 owner_id TEXT NOT NULL, request_id TEXT NOT NULL, instance_id TEXT NOT NULL REFERENCES cafe_instances(id),
 attempt_id TEXT NOT NULL REFERENCES cafe_attempts(id), case_version TEXT NOT NULL,
 progress_revision INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'case_progress', purpose TEXT NOT NULL,
 fingerprint TEXT NOT NULL, status TEXT NOT NULL, reserved_milliyen INTEGER NOT NULL,
 actual_milliyen INTEGER, month TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,request_id)
);`;
const STALE_RESERVATION_MARGIN_MS = 10_000;
const purposes = ['explain_to_owner', 'rephrase', 'another_example', 'check_my_example'] as const;
export type AiCoachRequest = {
 requestId: string; attemptId: string; caseVersion: string; progressRevision: number;
 purpose: typeof purposes[number]; explanation: string; confirmed: true;
 question?: string; recentTurns?: { question: string; reply: string }[];
};
export type AiCoachReply = {
 reply: string; source_ids: string[]; follow_up: string; uncertainty: boolean;
};
export type AiCoachResult = AiCoachReply & {
 mode: 'fixed' | 'ai'; label: string; reason: string; evidenceQualification: 'practice_only';
};
/** Adapter must cap output and disable its own retries. No owner or attempt identifier crosses this boundary; recent turns are untrusted learner-supplied context. */
export interface AiCoachProvider {
 billingMode?: 'metered' | 'subscription';
 maximumCostMilliYen?: number;
 generate(input: { case_version: string; purpose: AiCoachRequest['purpose']; explanation: string;
   question?: string; recent_turns?: { question: string; reply: string }[]; selected_option_id: string },
   options: { signal: AbortSignal; maxOutputCharacters: number }): Promise<AiCoachReply & { actualCostMilliYen?: number }>;
}
export function parseAiCoachRequest(value: unknown): AiCoachRequest {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudyError('INVALID_AI_REQUEST');
 const input = value as Record<string, unknown>;
 const fields = ['requestId','attemptId','caseVersion','progressRevision','purpose','explanation','confirmed','question','recentTurns'];
 const required = fields.slice(0,7);
 const turns = input.recentTurns;
 if (Object.keys(input).some(k => !fields.includes(k)) || required.some(k => !(k in input))
   || !['requestId','attemptId'].every(k => typeof input[k] === 'string' && /^[\w-]{1,128}$/.test(input[k] as string))
   || typeof input.caseVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.caseVersion)
   || !Number.isSafeInteger(input.progressRevision) || (input.progressRevision as number) < 0
   || !purposes.includes(input.purpose as AiCoachRequest['purpose']) || input.confirmed !== true
   || typeof input.explanation !== 'string' || input.explanation.length > 2000
   || (input.question === undefined ? !input.explanation.trim() : typeof input.question !== 'string' || !input.question.trim() || input.question.length > 600)
   || (turns !== undefined && (input.question === undefined || !Array.isArray(turns) || turns.length > 2
     || turns.some(turn => !turn || typeof turn !== 'object' || Array.isArray(turn)
       || Object.keys(turn).sort().join(',') !== 'question,reply'
       || typeof turn.question !== 'string' || !turn.question.trim() || turn.question.length > 600
       || typeof turn.reply !== 'string' || !turn.reply.trim() || turn.reply.length > 2000))))
   throw new StudyError('INVALID_AI_REQUEST');
 return input as AiCoachRequest;
}
const fixedChecks: Record<AiCoachRequest['purpose'], { reply: string; follow_up: string }> = {
 explain_to_owner: {
   reply: '店主に説明するなら、事実・判断・理由・次アクションに分けて自分の説明を照らし合わせてください。これは採点や習得認定ではありません。',
   follow_up: '事実・判断・理由・次アクションを一つずつ挙げられますか？',
 },
 rephrase: {
   reply: '専門語を使わず、原則と今回の条件の境界が伝わるように言い換えて、自分の説明を照らし合わせてください。これは採点や習得認定ではありません。',
   follow_up: '専門語を使わず、どこまでが原則でどこからが今回の条件か説明できますか？',
 },
 another_example: {
   reply: '条件を一つ変えた別の例を、自分で作ってみましょう。その例でも変わらない条件を確かめてください。これは採点や習得認定ではありません。',
   follow_up: '条件を一つ変えた別の例と、変わらない条件を挙げられますか？',
 },
 check_my_example: {
   reply: '自作例を、適用した原則・成立条件・反例の順に点検してください。これは採点や習得認定ではありません。',
   follow_up: '適用した原則、成立条件、反例をそれぞれ挙げられますか？',
 },
};
const fixed = (reason: string, purpose: AiCoachRequest['purpose'], question?: string): AiCoachResult => ({ mode: 'fixed', label: '固定の理解確認', reason,
 ...fixedChecks[purpose], ...(question ? { reply: reason === 'already_requested'
   ? '同じ質問は送信済みです。返信は再表示できません。必要なら新しい質問として送ってください。'
   : 'AIに接続できないため、この質問には個別に回答できません。教材の解説と期間図を見比べてください。' } : {}),
 source_ids: [], uncertainty: true, evidenceQualification: 'practice_only' });
export function createAiCoachServiceOnPreparedDatabase(db: TransactionDatabase, options: {
 provider?: AiCoachProvider; now?: () => Date; monthlyLimitMilliYen?: number; timeoutMs?: number;
} = {}) {
 const now = options.now ?? (() => new Date());
 const limit = options.monthlyLimitMilliYen ?? 1_000_000;
 const timeout = options.timeoutMs ?? 30_000;
 if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1_000_000 || !Number.isFinite(timeout) || timeout <= 0 || timeout > 30_000)
   throw new StudyError('INVALID_AI_CONFIG', 500);
 async function bound(tx: QueryExecutor, owner: string, id: string, input: AiCoachRequest) {
   await assertOwnerActive(tx, owner);
   const row = (await tx.query<{ case_version: string; status: string; expires_at: string; attempt_id: string; option_id: string;
     phase: string; revision: number; explanation: string; progress_expires_at: string; saved_at: string }>(
     `SELECT i.case_version,i.status,i.expires_at,p.attempt_id,a.option_id,p.phase,p.revision,p.explanation,
       p.expires_at AS progress_expires_at,p.saved_at FROM cafe_instances i
       JOIN cafe_progress p ON p.instance_id=i.id AND p.owner_id=i.owner_id AND p.case_version=i.case_version
       JOIN cafe_attempts a ON a.id=p.attempt_id AND a.owner_id=i.owner_id AND a.instance_id=i.id AND a.case_version=i.case_version
       JOIN cafe_confidence c ON c.attempt_id=a.id
       WHERE i.id=$1 AND i.owner_id=$2 FOR UPDATE OF i,p`, [id, owner])).rows[0];
   if (!row) throw new StudyError('NOT_FOUND', 404);
   const clock = now();
   if (!Number.isFinite(clock.getTime())) throw new StudyError('INVALID_CLOCK', 500);
   if (row.status !== 'active' || row.expires_at <= clock.toISOString() || row.progress_expires_at <= clock.toISOString()) throw new StudyError('SESSION_CLOSED', 409);
   if (row.case_version !== input.caseVersion || row.attempt_id !== input.attemptId) throw new StudyError('CASE_VERSION_CONFLICT', 409);
   if (row.revision !== input.progressRevision || row.explanation !== input.explanation || !row.saved_at) throw new StudyError('REVISION_CONFLICT', 409);
   if (row.phase !== 'teach_back' && !(row.phase === 'feedback' && input.question)) throw new StudyError('INVALID_PHASE', 409);
   return row.option_id;
 }
 return { async request(owner: string, caseId: string, value: unknown): Promise<AiCoachResult> {
   const input = parseAiCoachRequest(value);
   if (typeof caseId !== 'string' || !/^[\w-]{1,128}$/.test(caseId)) throw new StudyError('INVALID_ID');
   const fingerprint = createHash('sha256').update(JSON.stringify([caseId,input.attemptId,input.caseVersion,input.progressRevision,input.purpose,input.explanation,input.question,input.recentTurns])).digest('hex');
   const provider = options.provider;
   const subscription = provider?.billingMode === 'subscription';
   const maximum = provider?.maximumCostMilliYen;
   const reserved = await db.transaction(async tx => {
     const selectedOptionId = await bound(tx, owner, caseId, input);
     const existing = (await tx.query<{fingerprint: string;status: string}>('SELECT fingerprint,status FROM ai_interaction_summaries WHERE owner_id=$1 AND request_id=$2', [owner,input.requestId])).rows[0];
     if (existing) {
       if (existing.fingerprint !== fingerprint) throw new StudyError('REQUEST_CONFLICT',409);
       return { reason: 'already_requested', month: '', selectedOptionId };
     }
     const at = now();
     let reason = !provider ? 'disabled' : (!subscription && (!Number.isSafeInteger(maximum) || maximum! <= 0)) ? 'price_unknown' : '';
     const reservedSince = subscription ? new Date(at.getTime() - timeout - STALE_RESERVATION_MARGIN_MS).toISOString() : '';
     if (!reason && (await tx.query("SELECT request_id FROM ai_interaction_summaries WHERE owner_id=$1 AND (status='unknown' OR (status='reserved' AND created_at>$2)) LIMIT 1", [owner,reservedSince])).rows.length) reason = 'request_pending';
     const month = new Date(at.getTime() + 9 * 3600000).toISOString().slice(0,7);
     if (!reason && !subscription) {
       await tx.query('INSERT INTO ai_coach_budgets(month) VALUES ($1) ON CONFLICT DO NOTHING',[month]);
       const budget = (await tx.query<{reserved_milliyen:number}>('SELECT reserved_milliyen FROM ai_coach_budgets WHERE month=$1 FOR UPDATE',[month])).rows[0];
       if (maximum! > limit - budget.reserved_milliyen) reason = 'budget_exceeded';
       else await tx.query('UPDATE ai_coach_budgets SET reserved_milliyen=reserved_milliyen+$2 WHERE month=$1',[month,maximum]);
     }
     await tx.query(`INSERT INTO ai_interaction_summaries(owner_id,request_id,instance_id,attempt_id,case_version,progress_revision,purpose,fingerprint,status,reserved_milliyen,month,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[owner,input.requestId,caseId,input.attemptId,input.caseVersion,input.progressRevision,input.purpose,fingerprint,reason || 'reserved',reason || subscription ? 0 : maximum,month,at.toISOString()]);
     return {reason,month,selectedOptionId};
   });
   if (reserved.reason) return fixed(reserved.reason, input.purpose, input.question);
   const settleWithoutReply = () => db.transaction(async tx => {await assertOwnerActive(tx,owner); await tx.query("UPDATE ai_interaction_summaries SET status=$3 WHERE owner_id=$1 AND request_id=$2",[owner,input.requestId,subscription ? 'failed' : 'unknown']);});
   const controller = new AbortController();
   let timer: ReturnType<typeof setTimeout> | undefined;
   let output: Awaited<ReturnType<AiCoachProvider['generate']>>;
   try {
     output = await Promise.race([
       Promise.resolve().then(() => provider!.generate({case_version:input.caseVersion,purpose:input.purpose,explanation:input.explanation,
         question:input.question,recent_turns:input.recentTurns,selected_option_id:reserved.selectedOptionId},{signal:controller.signal,maxOutputCharacters:2000})),
       new Promise<never>((_,reject) => {timer=setTimeout(() => {controller.abort();reject(new Error('timeout'));},timeout);}),
     ]);
     if (!output || typeof output.reply !== 'string' || output.reply.length > 2000 || !output.reply.trim()
       || typeof output.follow_up !== 'string' || output.follow_up.length > 500 || !output.follow_up.trim()
       || typeof output.uncertainty !== 'boolean' || !Array.isArray(output.source_ids) || output.source_ids.length !== 0
       || (subscription ? output.actualCostMilliYen !== undefined : (!Number.isSafeInteger(output.actualCostMilliYen)
         || output.actualCostMilliYen! < 0 || output.actualCostMilliYen! > maximum!))) throw new Error('invalid_response');
   } catch {
     // Metered cost remains unknown; subscription failures do not reserve yen or block a fresh request.
     await settleWithoutReply();
     return fixed('provider_unavailable', input.purpose, input.question);
   } finally { if (timer) clearTimeout(timer); }
   try {
     return await db.transaction(async tx => {
       // Never expose a late reply following deletion, completion, expiry, or another saved revision.
       await bound(tx,owner,caseId,input);
       if (!subscription) await tx.query('UPDATE ai_coach_budgets SET reserved_milliyen=reserved_milliyen-$2 WHERE month=$1',[reserved.month,maximum! - output.actualCostMilliYen!]);
       await tx.query("UPDATE ai_interaction_summaries SET status='completed',actual_milliyen=$3 WHERE owner_id=$1 AND request_id=$2",[owner,input.requestId,subscription ? null : output.actualCostMilliYen]);
       return {mode:'ai',label:'AIによる理解確認',reason:'completed',reply:output.reply,follow_up:output.follow_up,
         source_ids:[],uncertainty:output.uncertainty,evidenceQualification:'practice_only'};
     });
   } catch (error) {
     if (subscription) await settleWithoutReply().catch(() => undefined);
     throw error;
   }
 }};
}
