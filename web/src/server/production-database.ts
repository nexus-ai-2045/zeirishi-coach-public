import { createHash } from 'node:crypto';
import { StudyError } from '../domain/types';
import { createPostgresRuntime, readDatabaseConfig } from './postgres-runtime';

/** Cache only the pool, never an auth reader, learner ID or learner-bound service. */
export function createProductionDatabaseProvider(create = createPostgresRuntime) {
  let cached: { fingerprint: string; runtime: ReturnType<typeof createPostgresRuntime> } | undefined;
  return (env: Record<string, string | undefined> = process.env) => {
    // Re-check disabled/conflicting modes even after a pool has been created.
    const config = readDatabaseConfig(env);
    const fingerprint = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    if (cached && cached.fingerprint !== fingerprint) throw new StudyError('DATABASE_RESTART_REQUIRED', 503);
    if (!cached) cached = { fingerprint, runtime: create(env) };
    return cached.runtime.database;
  };
}

const runtimeGlobal = globalThis as typeof globalThis & {
  zeirishiProductionDatabaseV1?: ReturnType<typeof createProductionDatabaseProvider>;
};

/** Imported routes stay unconnected; the first authorized request acquires the lazy pool. */
export function getProductionDatabase() {
  const get = runtimeGlobal.zeirishiProductionDatabaseV1 ??= createProductionDatabaseProvider();
  return get();
}
