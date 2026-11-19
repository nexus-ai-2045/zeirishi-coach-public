import { createPracticeProgressHandler } from '../../../http/practice-progress-handler';
import { getCafeService, getReviewCardService } from '../../../server/runtime-services';
import { jsonResponse } from '../../../http/local-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const development = createPracticeProgressHandler(getCafeService, getReviewCardService, () => process.env.ZEIRISHI_FIXTURE_MODE);
// Only the local (Mac) mode keeps these records; the online mode has no progress colours or review cards yet.
function handler(request: Request) {
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? jsonResponse({ error: 'NOT_AVAILABLE' }, 404) : development(request);
}
export const GET = handler;
export const POST = handler;
