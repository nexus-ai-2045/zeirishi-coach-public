import { getStudyService } from '../../../server/runtime-services';
import { createStudyHandler } from '../../../http/study-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = createStudyHandler(getStudyService, () => process.env.ZEIRISHI_FIXTURE_MODE);
export const GET = handler;
export const POST = handler;
