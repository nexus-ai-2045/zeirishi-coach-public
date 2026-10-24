import { createAuthFlowHandler } from '../../../../http/auth-flow-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createAuthFlowHandler('logout');
