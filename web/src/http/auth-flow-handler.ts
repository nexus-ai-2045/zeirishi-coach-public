import { StudyError } from '../domain/types';
import { authReader, createAuthContext, readAuthConfig, requireInvitedLearner, type AuthConfig, type VerifiedAuthReader } from '../server/supabase-auth';
import { readBody } from './guard';

type FlowContext = {
  headers: Headers;
  reader: VerifiedAuthReader;
  requestLink: (email: string, redirectTo: string) => Promise<void>;
  exchange: (code: string) => Promise<void>;
  logout: () => Promise<void>;
};
function flowContext(request: Request, config: AuthConfig): FlowContext {
  const { client, headers } = createAuthContext(request, config);
  return {
    headers, reader: authReader(client),
    async requestLink(email, redirectTo) {
      // A neutral response must not reveal whether this email has an account.
      // Delivery is not confirmed by this endpoint, including provider rejection.
      await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
    },
    async exchange(code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw new StudyError('AUTH_LINK_INVALID', 401);
    },
    async logout() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw new StudyError('AUTH_UNAVAILABLE', 503);
    },
  };
}

/** Real email delivery stays separately disabled until target and SMTP are approved. */
export function requireEmailDelivery(env: Record<string, string | undefined> = process.env) {
  if (env.ZEIRISHI_AUTH_EMAIL_ENABLED !== '1') throw new StudyError('AUTH_EMAIL_DISABLED', 503);
}

export function createAuthFlowHandler(action: 'request' | 'callback' | 'logout',
  config: () => AuthConfig = readAuthConfig,
  context: (request: Request, config: AuthConfig) => FlowContext = flowContext,
  delivery: () => void = requireEmailDelivery) {
  return async (request: Request): Promise<Response> => {
    let headers = new Headers({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache', Expires: '0', Vary: 'Cookie', 'Referrer-Policy': 'no-referrer' });
    let callbackOrigin: string | undefined;
    try {
      const settings = config();
      if (request.method !== (action === 'callback' ? 'GET' : 'POST')) throw new StudyError('METHOD_NOT_ALLOWED', 405);
      const url = new URL(request.url);
      if (url.origin !== settings.appOrigin) throw new StudyError('ORIGIN_REJECTED', 403);
      let email: string | undefined;
      let code: string | undefined;
      if (action === 'callback') {
        callbackOrigin = settings.appOrigin;
        // Email navigation is cross-site. PKCE binds the exchange to the requesting browser.
        code = url.searchParams.get('code') ?? undefined;
        if ([...url.searchParams].length !== 1 || !code || !/^[A-Za-z0-9_-]{16,512}$/.test(code)) throw new StudyError('AUTH_LINK_INVALID', 401);
      } else {
        if (request.headers.get('origin') !== settings.appOrigin || request.headers.get('sec-fetch-site') === 'cross-site') throw new StudyError('ORIGIN_REJECTED', 403);
        if ([...url.searchParams].length) throw new StudyError('INVALID_INPUT');
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new StudyError('JSON_REQUIRED', 415);
        if (action === 'request') delivery();
        const input = await readBody(request);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StudyError('INVALID_INPUT');
        const fields = input as Record<string, unknown>;
        if (action === 'request') {
          if (Object.keys(fields).length !== 1 || typeof fields.email !== 'string') throw new StudyError('INVALID_INPUT');
          email = fields.email.trim();
          if (email.length > 254 || !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(email)) throw new StudyError('INVALID_INPUT');
        } else if (Object.keys(fields).length) throw new StudyError('INVALID_INPUT');
      }
      const current = context(request, settings);
      headers = current.headers;
      headers.set('Referrer-Policy', 'no-referrer');
      if (action === 'request') {
        await current.requestLink(email!, `${settings.appOrigin}/api/auth/callback`);
        return Response.json({ accepted: true, deliveryConfirmed: false }, { status: 202, headers });
      }
      if (action === 'logout') {
        await current.logout();
        return Response.json({ signedOut: true, scope: 'local' }, { headers });
      }
      await current.exchange(code!);
      // Membership is fresh, not a user-controlled or stale JWT metadata claim.
      try { await requireInvitedLearner(current.reader); }
      catch (error) {
        await current.logout();
        throw error;
      }
      // No caller-supplied next URL. Readiness remains distinct from the fixture learning backend.
      headers.set('Location', `${settings.appOrigin}/login`);
      return new Response(null, { status: 303, headers });
    } catch (error) {
      if (callbackOrigin) {
        const reason = error instanceof StudyError && error.code === 'INVITATION_REQUIRED' ? 'invitation-required'
          : error instanceof StudyError && ['AUTH_LINK_INVALID', 'AUTH_REQUIRED'].includes(error.code) ? 'link-invalid' : 'unavailable';
        headers.set('Location', `${callbackOrigin}/login?auth=${reason}`);
        return new Response(null, { status: 303, headers });
      }
      return Response.json({ error: error instanceof StudyError ? error.code : 'AUTH_UNAVAILABLE' },
        { status: error instanceof StudyError ? error.status : 503, headers });
    }
  };
}
