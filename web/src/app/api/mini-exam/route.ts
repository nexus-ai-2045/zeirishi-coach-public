import { createDiagnosticHandler } from '../../../http/diagnostic-handler';
import { jsonResponse } from '../../../http/local-session';
import { createBookkeepingMiniExamServiceOnPreparedDatabase } from '../../../server/diagnostic-service';
import { bookkeepingTrialEnabled } from '../../../server/bookkeeping-trial-supply';
import { getLearningEvidenceDatabase } from '../../../server/runtime-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!bookkeepingTrialEnabled()) return jsonResponse({ error: 'FIXTURE_DISABLED' }, 503);
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  if (url.searchParams.getAll('kind').length !== 1 || (kind !== 'before' && kind !== 'after')) {
    return jsonResponse({ error: 'INVALID_DIAGNOSTIC' }, 400);
  }
  url.searchParams.delete('kind');
  // Only the fixed before/after selector is public. Timing, limits and purpose are server-owned.
  const internal = new Request(url, request);
  return createDiagnosticHandler(async () => createBookkeepingMiniExamServiceOnPreparedDatabase(await getLearningEvidenceDatabase(), kind),
    () => process.env.ZEIRISHI_FIXTURE_MODE)(internal);
}
export const POST = GET;
