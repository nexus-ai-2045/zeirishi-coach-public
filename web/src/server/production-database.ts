import { createHash } from 'node:crypto';
import { StudyError } from '../domain/types';
import { createPostgresRuntime, readDatabaseConfig } from './postgres-runtime';

export function createProductionDatabaseProvider(create = createPostgresRuntime) {
  let cached: { fingerprint: string; runtime: ReturnType<typeof createPostgresRuntime> } | undefined;
  return (env: Record<string, string | undefined> = process.env) => {
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

export function getProductionDatabase() {
  const get = runtimeGlobal.zeirishiProductionDatabaseV1 ??= createProductionDatabaseProvider();
  return get();
}
