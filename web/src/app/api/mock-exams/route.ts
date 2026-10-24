import { createMockExamHandler } from '../../../http/mock-exam-handler';
import { createLearnerMockExamHandler } from '../../../http/learner-mock-exam-handler';
import { getMockExamService } from '../../../server/runtime-services';
import { getProductionDatabase } from '../../../server/production-database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const development = createMockExamHandler(getMockExamService, () => process.env.ZEIRISHI_FIXTURE_MODE);
const production = createLearnerMockExamHandler({ getDatabase: getProductionDatabase });
export function GET(request: Request) {
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? production(request) : development(request);
}
export const POST = GET;
