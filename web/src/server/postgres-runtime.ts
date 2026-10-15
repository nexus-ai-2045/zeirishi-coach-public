import { Pool, type PoolConfig } from 'pg';
import { X509Certificate } from 'node:crypto';
import { StudyError } from '../domain/types';
import { readAuthConfig } from './supabase-auth';
import { createPostgresDatabase } from './postgres-database';

/** Explicit fields prevent connection-string sslmode/options from weakening TLS or role limits. */
export function readDatabaseConfig(env: Record<string, string | undefined> = process.env): PoolConfig {
  if (env.ZEIRISHI_DATABASE_ENABLED !== '1') throw new StudyError('DATABASE_DISABLED', 503);
  const auth = readAuthConfig(env);
  const ref = new URL(auth.url).hostname.split('.')[0];
  const host = env.ZEIRISHI_DATABASE_HOST;
  const user = env.ZEIRISHI_DATABASE_USER;
  const port = env.ZEIRISHI_DATABASE_PORT;
  const direct = host === `db.${ref}.supabase.co` && user === 'zeirishi_runtime' && port === '5432';
  const pooler = !!host && /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)
    && user === `zeirishi_runtime.${ref}` && ['5432', '6543'].includes(port ?? '');
  const password = env.ZEIRISHI_DATABASE_PASSWORD;
  const ca = env.ZEIRISHI_DATABASE_CA_PEM;
  if ((!direct && !pooler) || !password || password.length > 4096 || /[\u0000\r\n]/.test(password)) throw new StudyError('DATABASE_CONFIGURATION_REQUIRED', 503);
  if (ca !== undefined) {
    try {
      if (ca.length > 32768 || !ca.startsWith('-----BEGIN CERTIFICATE-----') || !new X509Certificate(ca).ca) throw new Error();
    } catch { throw new StudyError('DATABASE_CA_INVALID', 503); }
  }
  return {
    host, user, port: Number(port), database: 'postgres', password,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    sslnegotiation: 'postgres', enableChannelBinding: true,
    options: '-c application_name=zeirishi-coach', application_name: 'zeirishi-coach', client_encoding: 'UTF8',
    max: 4, min: 0, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, maxLifetimeSeconds: 300,
    query_timeout: 20000, statement_timeout: 15000, lock_timeout: 5000, idle_in_transaction_session_timeout: 10000,
    async onConnect(client) {
      // Do not use administrator credentials then hide their privileges with SET ROLE.
      const row = (await client.query<{ name: string; safe: boolean; app: boolean; guard: boolean; restricted: boolean }>(
        `SELECT rolname AS name, NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit) AS safe,
          (pg_has_role(session_user,'zeirishi_app','SET')
            AND NOT pg_has_role(session_user,'zeirishi_app','MEMBER WITH ADMIN OPTION')) AS app,
          pg_has_role(session_user,'zeirishi_access_guard','MEMBER') AS guard
          , NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS inherited
              WHERE inherited.rolname NOT IN (session_user,'zeirishi_app')
                AND pg_has_role(session_user,inherited.oid,'MEMBER')) AS restricted
          FROM pg_catalog.pg_roles WHERE rolname=session_user`)).rows[0];
      if (!row || row.name !== 'zeirishi_runtime' || row.safe !== true || row.app !== true || row.guard !== false || row.restricted !== true) throw new StudyError('DATABASE_ROLE_REJECTED', 503);
    },
  };
}

/** Lazy pool: construction does not connect. Explicit deployment configuration is required. */
export function createPostgresRuntime(env: Record<string, string | undefined> = process.env) {
  const pool = new Pool(readDatabaseConfig(env));
  let idleErrors = 0;
  // node-postgres otherwise throws unhandled idle errors; retain only non-sensitive counters.
  pool.on('error', () => { idleErrors++; });
  return {
    database: createPostgresDatabase(pool, { learnerRole: true }),
    health: () => ({ idleErrors, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }),
    close: () => pool.end(),
  };
}
