import { createAiCoachHandler, createLearnerAiCoachHandler } from '../../../http/ai-coach-handler';
import { getAiCoachService } from '../../../server/runtime-services';
import { getProductionDatabase } from '../../../server/production-database';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const development = createAiCoachHandler(getAiCoachService, () => process.env.ZEIRISHI_FIXTURE_MODE);
const production = createLearnerAiCoachHandler({ getDatabase: getProductionDatabase });
export function POST(request: Request) { return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? production(request) : development(request); }
