import { StudyError } from '../domain/types';
import { authReader, createAuthContext, readAuthConfig, requireInvitedLearner, type AuthConfig, type VerifiedAuthReader } from '../server/supabase-auth';

type SessionContext = { reader: VerifiedAuthReader; headers: Headers };
function sessionContext(request: Request, config: AuthConfig): SessionContext {
  const current = createAuthContext(request, config);
  return { reader: authReader(current.client), headers: current.headers };
}

/** Identity readiness only; this endpoint does not verify DB deployment or approved material availability. */
export function createAuthSessionHandler(config: () => AuthConfig = readAuthConfig,
  context: (request: Request, config: AuthConfig) => SessionContext = sessionContext) {
  return async (request: Request): Promise<Response> => {
    let headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie', Pragma: 'no-cache', Expires: '0' });
    try {
      const settings = config();
      if (request.method !== 'GET') throw new StudyError('METHOD_NOT_ALLOWED', 405);
      const url = new URL(request.url);
      if (url.origin !== settings.appOrigin || request.headers.get('sec-fetch-site') === 'cross-site') throw new StudyError('ORIGIN_REJECTED', 403);
      if ([...url.searchParams].length) throw new StudyError('INVALID_INPUT');
      const current = context(request, settings);
      headers = current.headers;
      const learner = await requireInvitedLearner(current.reader);
      return Response.json({ authenticated: true, userId: learner.userId, learningBackendReady: false }, { headers });
    } catch (error) {
      return Response.json({ error: error instanceof StudyError ? error.code : 'AUTH_UNAVAILABLE' },
        { status: error instanceof StudyError ? error.status : 503, headers });
    }
  };
}
