import { createDiagnosticHandler, createLearnerDiagnosticHandler } from '../../../http/diagnostic-handler';
import { getDiagnosticService } from '../../../server/runtime-services';
import { getProductionDatabase } from '../../../server/production-database';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const development = createDiagnosticHandler(getDiagnosticService, () => process.env.ZEIRISHI_FIXTURE_MODE);
const production = createLearnerDiagnosticHandler({ getDatabase: getProductionDatabase });
export function GET(request: Request) {
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? production(request) : development(request);
}
export const POST = GET;
