import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { StudyError } from '../domain/types';

export type AuthConfig = { url: string; publishableKey: string; appOrigin: string };
/** Explicit activation is separate from loopback fixtures; never silently promote local cookies. */
export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  if (env.ZEIRISHI_SUPABASE_ENABLED !== '1') throw new StudyError('AUTH_DISABLED', 503);
  if (env.ZEIRISHI_FIXTURE_MODE === '1') throw new StudyError('AUTH_MODE_CONFLICT', 503);
  let url: URL, app: URL;
  try { url = new URL(env.SUPABASE_URL ?? ''); app = new URL(env.ZEIRISHI_APP_ORIGIN ?? ''); }
  catch { throw new StudyError('AUTH_CONFIGURATION_REQUIRED', 503); }
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if (url.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)
    || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
    || app.protocol !== 'https:' || app.username || app.password || app.pathname !== '/' || app.search || app.hash
    || !key || !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) throw new StudyError('AUTH_CONFIGURATION_REQUIRED', 503);
  return { url: url.origin, publishableKey: key, appOrigin: app.origin };
}

/** Every request gets its own SDK client, cookie jar and response headers. Never global-cache it. */
export function createAuthContext(request: Request, config: AuthConfig) {
  const raw = request.headers.get('cookie') ?? '';
  const names = raw.split(';').filter(part => part.includes('=')).map(part => part.slice(0, part.indexOf('=')).trim());
  // The SDK parser keeps only the first duplicate, so detect ambiguity before parsing.
  if (raw.length > 32768 || new Set(names).size !== names.length) throw new StudyError('INVALID_COOKIE');
  const cookies = parseCookieHeader(raw);
  const jar = new Map(cookies.map(cookie => [cookie.name, cookie.value ?? '']));
  const headers = new Headers({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache', Expires: '0', Vary: 'Cookie' });
  const client = createServerClient(config.url, config.publishableKey, {
    cookieOptions: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (updates, cacheHeaders) => {
        for (const { name, value, options } of updates) {
          jar.set(name, value);
          headers.append('Set-Cookie', serializeCookieHeader(name, value, { ...options, secure: true, httpOnly: true, sameSite: 'lax', path: '/' }));
        }
        for (const [name, value] of Object.entries(cacheHeaders ?? {})) headers.set(name, value);
        headers.set('Cache-Control', 'private, no-store');
      },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return { client, headers };
}

export type VerifiedAuthReader = {
  getUser: () => Promise<{ user: { id: string; isAnonymous: boolean; emailConfirmed: boolean } | null; error: boolean }>;
  getAccess: (id: string) => Promise<{ userId: string; status: string } | null>;
};
/** Verified identity only; callers must separately check current membership before learning access. */
export async function requireVerifiedLearner(reader: Pick<VerifiedAuthReader, 'getUser'>): Promise<{ userId: string }> {
  const result = await reader.getUser();
  if (result.error) throw new StudyError('AUTH_UNAVAILABLE', 503);
  const user = result.user;
  if (!user || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(user.id)
    || user.isAnonymous !== false || user.emailConfirmed !== true) throw new StudyError('AUTH_REQUIRED', 401);
  return { userId: user.id };
}

export async function requireInvitedLearner(reader: VerifiedAuthReader): Promise<{ userId: string }> {
  const verified = await requireVerifiedLearner(reader);
  const access = await reader.getAccess(verified.userId);
  if (!access || access.userId !== verified.userId || access.status !== 'active') throw new StudyError('INVITATION_REQUIRED', 403);
  return verified;
}

export function authReader(client: ReturnType<typeof createAuthContext>['client']): VerifiedAuthReader {
  return {
    async getUser() {
      const { data, error } = await client.auth.getUser();
      return { error: !!error && !isAuthSessionMissingError(error), user: data.user ? { id: data.user.id, isAnonymous: data.user.is_anonymous !== false,
        emailConfirmed: !!data.user.email_confirmed_at } : null };
    },
    async getAccess(id) {
      const { data, error } = await client.from('learner_access').select('user_id,status').eq('user_id', id).maybeSingle();
      if (error) throw new StudyError('AUTH_UNAVAILABLE', 503);
      return data ? { userId: data.user_id, status: data.status } : null;
    },
  };
}
