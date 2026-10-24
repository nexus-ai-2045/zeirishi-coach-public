import { createAuthSessionHandler } from '../../../../http/auth-session-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createAuthSessionHandler();
