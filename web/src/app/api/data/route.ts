import { createDataHandler } from '../../../http/data-handler';
import { getDataService } from '../../../server/runtime-services';
import { createLearnerDataHandler } from '../../../http/learner-data-handler';
import { getProductionDatabase } from '../../../server/production-database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const development = createDataHandler(getDataService, () => process.env.ZEIRISHI_FIXTURE_MODE);
const production = createLearnerDataHandler({ getDatabase: getProductionDatabase });
function handler(request: Request) {
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? production(request) : development(request);
}
export const GET = handler;
export const POST = handler;
