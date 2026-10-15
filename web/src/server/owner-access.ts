import { createHash } from 'node:crypto';
import type { QueryExecutor, SchemaDatabase } from './database';
import { StudyError } from '../domain/types';

export type OwnerTransaction = QueryExecutor;
export async function initializeOwnerAccess(db: Pick<SchemaDatabase, 'exec'>) {
  await db.exec(`CREATE TABLE IF NOT EXISTS owner_access (
    owner_hash TEXT PRIMARY KEY, revoked_at TEXT
  )`);
}
function ownerHash(owner: string) {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(owner)) throw new StudyError('INVALID_ID');
  return createHash('sha256').update(`zeirishi-local-owner-v1:${owner}`).digest('hex');
}
/** Call inside the same transaction as all owner reads/writes; deletion takes this same lock. */
export async function lockOwner(tx: OwnerTransaction, owner: string) {
  const hash = ownerHash(owner);
  await tx.query('INSERT INTO owner_access (owner_hash) VALUES ($1) ON CONFLICT DO NOTHING', [hash]);
  const row = (await tx.query<{ revoked_at: string | null }>(
    'SELECT revoked_at FROM owner_access WHERE owner_hash=$1 FOR UPDATE', [hash])).rows[0];
  return { hash, revokedAt: row.revoked_at };
}
export async function assertOwnerActive(tx: OwnerTransaction, owner: string) {
  if ((await lockOwner(tx, owner)).revokedAt !== null) throw new StudyError('OWNER_REVOKED', 401);
}
