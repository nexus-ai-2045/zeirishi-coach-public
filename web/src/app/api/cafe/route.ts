import { createCafeHandler } from '../../../http/cafe-handler';
import { bookkeepingTrialEnabled } from '../../../server/bookkeeping-trial-supply';
import { resolveDevelopmentCafeService, getCafeService } from '../../../server/runtime-services';
import { createLearnerCafeHandler } from '../../../http/learner-cafe-handler';
import { getProductionDatabase } from '../../../server/production-database';
import { getApprovedCafeMaterial } from '../../../server/approved-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const development = createCafeHandler(getCafeService, () => process.env.ZEIRISHI_FIXTURE_MODE);
const expandedDevelopment = createCafeHandler(getCafeService, () => process.env.ZEIRISHI_FIXTURE_MODE, resolveDevelopmentCafeService);
const production = createLearnerCafeHandler({ getDatabase: getProductionDatabase, getMaterial: getApprovedCafeMaterial });
function handler(request: Request) {
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? production(request) : bookkeepingTrialEnabled() ? expandedDevelopment(request) : development(request);
}
export const GET = handler;
export const POST = handler;
