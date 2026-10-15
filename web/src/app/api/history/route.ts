import { createHistoryHandler } from '../../../http/history-handler';
import { getCafeService } from '../../../server/runtime-services';
import { createLearnerHistoryHandler } from '../../../http/learner-history-handler';
import { getProductionDatabase } from '../../../server/production-database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const development = createHistoryHandler(getCafeService, () => process.env.ZEIRISHI_FIXTURE_MODE);
const production = createLearnerHistoryHandler({ getDatabase: getProductionDatabase });
export function GET(request: Request) {
  // Auth mode wins, including invalid simultaneous fixture/auth activation.
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? production(request) : development(request);
}
