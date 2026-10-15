import { createBookkeepingTrialReviewHandler } from '../../../server/bookkeeping-trial-review';
import { getCafeService, getDevelopmentDatabase } from '../../../server/runtime-services';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createBookkeepingTrialReviewHandler({
  getDatabase: async () => {
    await getCafeService(); // Reuse the existing cafe schema bootstrap.
    return getDevelopmentDatabase();
  },
  config: () => ({ fixtureMode: process.env.ZEIRISHI_FIXTURE_MODE,
    bookkeepingMvp: process.env.ZEIRISHI_BOOKKEEPING_MVP, supabaseEnabled: process.env.ZEIRISHI_SUPABASE_ENABLED }),
});
