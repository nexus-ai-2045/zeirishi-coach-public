import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inspectRuntimeConfiguration } from '../scripts/runtime-preflight';

const validConfiguration = {
  ZEIRISHI_SUPABASE_ENABLED: '1',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_only_a_test_fixture_key',
  ZEIRISHI_APP_ORIGIN: 'https://coach.example',
  ZEIRISHI_AUTH_EMAIL_ENABLED: '1',
  ZEIRISHI_DATABASE_ENABLED: '1',
  ZEIRISHI_DATABASE_HOST: 'db.abcdefghijklmnopqrst.supabase.co',
  ZEIRISHI_DATABASE_USER: 'zeirishi_runtime',
  ZEIRISHI_DATABASE_PORT: '5432',
  ZEIRISHI_DATABASE_PASSWORD: 'fixture-password-must-never-be-printed',
};

test('preflight reports missing variable names and never claims an external connection', () => {
  const result = inspectRuntimeConfiguration({});
  assert.equal(result.status, 'configuration_incomplete');
  assert.deepEqual(result.missing, [
    'ZEIRISHI_SUPABASE_ENABLED', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'ZEIRISHI_APP_ORIGIN',
    'ZEIRISHI_DATABASE_ENABLED', 'ZEIRISHI_DATABASE_HOST', 'ZEIRISHI_DATABASE_USER',
    'ZEIRISHI_DATABASE_PORT', 'ZEIRISHI_DATABASE_PASSWORD', 'ZEIRISHI_AUTH_EMAIL_ENABLED',
  ]);
  assert.equal(result.externalConnectionVerified, false);
  assert.equal(JSON.stringify(result).includes('fixture-password'), false);
});

test('preflight passes parser validation while marking the external connection unverified', () => {
  assert.deepEqual(inspectRuntimeConfiguration(validConfiguration), {
    status: 'configuration_valid_only', missing: [], externalConnectionVerified: false,
  });
});

test('preflight rejects fixture mode and malformed values without echoing them', () => {
  assert.equal(inspectRuntimeConfiguration({ ...validConfiguration, ZEIRISHI_FIXTURE_MODE: '1' }).status, 'mode_conflict');
  const result = inspectRuntimeConfiguration({ ...validConfiguration, SUPABASE_PUBLISHABLE_KEY: 'top-secret-invalid-value' });
  assert.equal(result.status, 'configuration_invalid');
  assert.equal(JSON.stringify(result).includes('top-secret'), false);
});

test('email delivery must be explicitly enabled for the online setup preflight', () => {
  const result = inspectRuntimeConfiguration({ ...validConfiguration, ZEIRISHI_AUTH_EMAIL_ENABLED: '0' });
  assert.equal(result.status, 'configuration_incomplete');
  assert.deepEqual(result.missing, ['ZEIRISHI_AUTH_EMAIL_ENABLED']);
});

test('CLI exits safely and never prints secret values', () => {
  const args = ['node_modules/tsx/dist/cli.mjs', 'scripts/runtime-preflight.ts'];
  const incomplete = spawnSync(process.execPath, args, {
    cwd: process.cwd(), encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test' },
  });
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stdout, /\"status\":\"configuration_incomplete\"/);
  assert.equal(incomplete.stdout.includes('fixture-password'), false);
  assert.equal(incomplete.stderr.includes('fixture-password'), false);

  const invalid = spawnSync(process.execPath, args, {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, ...validConfiguration, SUPABASE_PUBLISHABLE_KEY: 'top-secret-invalid-value' },
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout, /\"status\":\"configuration_invalid\"/);
  assert.equal(invalid.stdout.includes('top-secret'), false);
  assert.equal(invalid.stderr.includes('top-secret'), false);
});
