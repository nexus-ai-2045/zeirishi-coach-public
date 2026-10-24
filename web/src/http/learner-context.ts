import { StudyError } from '../domain/types';
import type { TransactionDatabase } from '../server/database';
import { createLearnerDatabase } from '../server/learner-database';
import { authReader, createAuthContext, readAuthConfig, requireInvitedLearner, type AuthConfig, type VerifiedAuthReader } from '../server/supabase-auth';

export type LearnerJson = null | boolean | number | string | readonly LearnerJson[] | { [key: string]: LearnerJson };
type AuthContext = { headers: Headers; reader: VerifiedAuthReader };
type LearnerContext = { userId: string; database: TransactionDatabase };
type Options = {
  getDatabase: () => TransactionDatabase | Promise<TransactionDatabase>;
  operation: (request: Request, learner: LearnerContext) => Promise<LearnerJson>;
  config?: () => AuthConfig;
  context?: (request: Request, config: AuthConfig) => AuthContext;
};

function defaultContext(request: Request, config: AuthConfig): AuthContext {
  const auth = createAuthContext(request, config);
  return { headers: auth.headers, reader: authReader(auth.client) };
}
function guard(request: Request, config: AuthConfig) {
  if (!['GET', 'POST'].includes(request.method)) throw new StudyError('METHOD_NOT_ALLOWED', 405);
  if (new URL(request.url).origin !== config.appOrigin || request.headers.get('sec-fetch-site') === 'cross-site') throw new StudyError('ORIGIN_REJECTED', 403);
  const origin = request.headers.get('origin');
  if ((request.method === 'POST' || origin !== null) && origin !== config.appOrigin) throw new StudyError('ORIGIN_REJECTED', 403);
  if (request.method === 'POST' && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new StudyError('JSON_REQUIRED', 415);
}
function json(data: LearnerJson, headers: Headers, status = 200) {
  // Refresh cookies may have been appended by any auth lookup, including a failing one.
  // Copy at response creation, not before asynchronous authentication.
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'private, no-store');
  responseHeaders.set('Pragma', 'no-cache');
  responseHeaders.set('Expires', '0');
  responseHeaders.set('Vary', 'Cookie');
  responseHeaders.set('Referrer-Policy', 'no-referrer');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return Response.json(data, { status, headers: responseHeaders });
}

/** Prepared-runtime adapter only. No route registration, local identity, DDL or pool construction. */
export function createLearnerContextHandler({ getDatabase, operation, config = readAuthConfig, context = defaultContext }: Options) {
  return async (request: Request): Promise<Response> => {
    let headers = new Headers();
    try {
      const settings = config();
      guard(request, settings);
      const current = context(request, settings);
      headers = current.headers;
      const invited = await requireInvitedLearner(current.reader);
      // Compare the principal shown by the UI; never use this header as ownership authority.
      // A cookie can change in another tab while an old confirmation/draft remains visible.
      if (request.headers.get('X-Zeirishi-Learner') !== invited.userId) throw new StudyError('AUTH_IDENTITY_CHANGED', 409);
      const learner = await createLearnerDatabase(await getDatabase(), current.reader);
      // The second verified lookup must not bind a different user than the invitation check.
      if (learner.userId !== invited.userId) throw new StudyError('AUTH_IDENTITY_CHANGED', 401);
      const data = await operation(request, learner);
      if (data instanceof Response || data === undefined) throw new Error('INVALID_OPERATION_RESULT');
      return json(data, headers);
    } catch (error) {
      return error instanceof StudyError
        ? json({ error: error.code }, headers, error.status)
        : json({ error: 'LEARNING_UNAVAILABLE' }, headers, 503);
    }
  };
}
