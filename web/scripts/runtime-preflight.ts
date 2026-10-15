import { pathToFileURL } from 'node:url';
import { StudyError } from '../src/domain/types';
import { readAuthConfig } from '../src/server/supabase-auth';
import { readDatabaseConfig } from '../src/server/postgres-runtime';

export type RuntimePreflightResult = {
  status: 'configuration_valid_only' | 'configuration_incomplete' | 'configuration_invalid' | 'mode_conflict';
  missing: string[];
  externalConnectionVerified: false;
};

const AUTH_REQUIRED = [
  'ZEIRISHI_SUPABASE_ENABLED', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'ZEIRISHI_APP_ORIGIN',
] as const;
const DATABASE_REQUIRED = [
  'ZEIRISHI_DATABASE_ENABLED', 'ZEIRISHI_DATABASE_HOST', 'ZEIRISHI_DATABASE_USER',
  'ZEIRISHI_DATABASE_PORT', 'ZEIRISHI_DATABASE_PASSWORD',
] as const;
const EMAIL_REQUIRED = ['ZEIRISHI_AUTH_EMAIL_ENABLED'] as const;

function missingNames(env: Record<string, string | undefined>, names: readonly string[]) {
  return names.filter(name => !env[name]?.trim());
}

/** Validate explicit hosted Auth, mail and PostgreSQL configuration without connecting or printing values. */
export function inspectRuntimeConfiguration(env: Record<string, string | undefined>): RuntimePreflightResult {
  if (env.ZEIRISHI_FIXTURE_MODE === '1') {
    return { status: 'mode_conflict', missing: [], externalConnectionVerified: false };
  }

  const missing = [
    ...missingNames(env, AUTH_REQUIRED),
    ...missingNames(env, DATABASE_REQUIRED),
    ...missingNames(env, EMAIL_REQUIRED),
  ];
  if (missing.length) return { status: 'configuration_incomplete', missing, externalConnectionVerified: false };

  try {
    readAuthConfig(env);
    readDatabaseConfig(env);
    if (env.ZEIRISHI_AUTH_EMAIL_ENABLED !== '1') {
      return { status: 'configuration_incomplete', missing: [...EMAIL_REQUIRED], externalConnectionVerified: false };
    }
    return { status: 'configuration_valid_only', missing: [], externalConnectionVerified: false };
  } catch (error) {
    // Only retain a fixed status. Parser details can contain configuration values later.
    const status = error instanceof StudyError
      && ['AUTH_MODE_CONFLICT', 'DATABASE_MODE_CONFLICT'].includes(error.code)
      ? 'mode_conflict'
      : 'configuration_invalid';
    return { status, missing: [], externalConnectionVerified: false };
  }
}

export function runRuntimePreflight(env: Record<string, string | undefined> = process.env) {
  const result = inspectRuntimeConfiguration(env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'configuration_valid_only') process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runRuntimePreflight();
