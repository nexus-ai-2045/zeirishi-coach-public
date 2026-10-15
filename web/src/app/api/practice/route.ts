import { guardRequest } from '../../../http/guard';
import { readLocalCookie } from '../../../http/local-session';
import { getDevelopmentDatabase } from '../../../server/runtime-services';
import { assertOwnerActive } from '../../../server/owner-access';
import { BOOKKEEPING_TRIAL_QUESTION_MATERIALS } from '../../../server/bookkeeping-trial-questions';
import { BOOKKEEPING_ALL_QUESTION_DRAFTS, publicBookkeepingQuestion } from '../../../server/bookkeeping-question-drafts';
import { BOOKKEEPING_ALL_CONCEPTS } from '../../../server/bookkeeping-trial-supply';
import { StudyError } from '../../../domain/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    guardRequest(request, process.env.ZEIRISHI_FIXTURE_MODE);
    if (process.env.ZEIRISHI_SUPABASE_ENABLED === '1' || process.env.ZEIRISHI_BOOKKEEPING_MVP !== '1') throw new StudyError('MATERIAL_NOT_AVAILABLE', 503);
    const owner = readLocalCookie(request, 'zc-user');
    if (!owner) throw new StudyError('USER_REQUIRED', 401);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'pool') || params.getAll('pool').length > 1) throw new StudyError('INVALID_INPUT');
    const pool = params.get('pool') ?? 'practice';
    if (!['practice','retention'].includes(pool)) throw new StudyError('MATERIAL_NOT_AVAILABLE', 503);
    await (await getDevelopmentDatabase()).transaction(tx => assertOwnerActive(tx, owner));
    // Only the requested pool is projected; never expose scores, explanations, or other pools' questions.
    return Response.json({ items: BOOKKEEPING_ALL_QUESTION_DRAFTS.filter(item => item.intendedUse === pool).map(item => ({...publicBookkeepingQuestion(item),conceptLabel:BOOKKEEPING_ALL_CONCEPTS.find(concept=>concept.conceptId===item.question.conceptId)?.label,caseVersion:BOOKKEEPING_TRIAL_QUESTION_MATERIALS.find(material => material.prompt().caseId === item.question.id)!.caseVersion})), developmentOnly: true });
  } catch (error) { return Response.json({ error: error instanceof StudyError ? error.code : 'INTERNAL_ERROR' }, { status: error instanceof StudyError ? error.status : 500 }); }
}
