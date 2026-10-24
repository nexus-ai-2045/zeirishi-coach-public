import { createLearningEvidenceHandler, createLearnerLearningEvidenceHandler } from '../../../http/learning-evidence-handler';
import { getLearningEvidenceDatabase } from '../../../server/runtime-services';
import { getProductionDatabase } from '../../../server/production-database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const development = createLearningEvidenceHandler(getLearningEvidenceDatabase, () => process.env.ZEIRISHI_FIXTURE_MODE);
const production = createLearnerLearningEvidenceHandler({ getDatabase: getProductionDatabase });
export function GET(request: Request) { return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? production(request) : development(request); }
