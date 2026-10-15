import { createWeeklyPlanHandler } from '../../../http/weekly-plan-handler';
import { getWeeklyPlanService } from '../../../server/runtime-services';
import { createLearnerPlanHandler } from '../../../http/learner-plan-handler';
import { getProductionDatabase } from '../../../server/production-database';
import { APPROVED_CATALOG, APPROVED_PLAN_CANDIDATES } from '../../../server/approved-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const development = createWeeklyPlanHandler(getWeeklyPlanService, () => process.env.ZEIRISHI_FIXTURE_MODE);
const production = createLearnerPlanHandler({ getDatabase: getProductionDatabase, catalog: APPROVED_CATALOG, candidates: APPROVED_PLAN_CANDIDATES });
function handler(request: Request) {
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? production(request) : development(request);
}
export const GET = handler;
export const POST = handler;
