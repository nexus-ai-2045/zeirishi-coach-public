import { StudyError } from '../domain/types';
import { validId } from './guard';

export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
});

/** Development pseudonym, never a substitute for production authentication. */
export function readLocalCookie(request: Request, name: string) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`));
  if (values.length > 1) throw new StudyError('INVALID_COOKIE');
  const value = values[0]?.slice(name.length + 1);
  if (value !== undefined && !validId(value)) throw new StudyError('INVALID_COOKIE');
  return value;
}
export const setLocalCookie = (response: Response, name: string, value: string) =>
  response.headers.append('Set-Cookie', `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
