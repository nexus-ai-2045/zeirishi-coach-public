import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { createPostgresDatabase } from '../src/server/postgres-database';
import type { QueryExecutor } from '../src/server/database';

function connection(failOn?: string) {
  const calls: string[] = [];
  let released: boolean | undefined;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push(sql);
      if (sql === failOn) throw new Error(`failed:${sql}`);
      return { rows: [{ value: params?.[0] }], command: sql };
    },
    release: (discard?: boolean) => { released = discard ?? false; },
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as Pick<Pool, 'connect'>;
  return { calls, pool, get released() { return released; } };
}

test('pg adapter pins a connection, returns rows, commits and closes escaped transactions', async () => {
  const current = connection();
  let escaped: QueryExecutor | undefined;
  const result = await createPostgresDatabase(current.pool).transaction(async tx => {
    escaped = tx;
    return (await tx.query<{ value: number }>('SELECT $1', [42])).rows[0].value;
  });
  assert.equal(result, 42);
  assert.deepEqual(current.calls, ['BEGIN', 'SELECT $1', 'COMMIT']);
  assert.equal(current.released, false);
  await assert.rejects(() => escaped!.query('SELECT 1'), /TRANSACTION_CLOSED/);
});

test('thrown failure rolls back while returned domain errors still commit', async () => {
  const current = connection();
  const db = createPostgresDatabase(current.pool);
  const error = new Error('domain');
  assert.equal(await db.transaction(async () => error), error);
  await assert.rejects(db.transaction(async () => { throw error; }), cause => cause === error);
  assert.deepEqual(current.calls, ['BEGIN', 'COMMIT', 'BEGIN', 'ROLLBACK']);
  assert.equal(current.released, false);
});

test('rollback failure discards connection without replacing the primary error', async () => {
  const current = connection('ROLLBACK');
  const error = new Error('primary');
  await assert.rejects(createPostgresDatabase(current.pool).transaction(async () => { throw error; }), cause => cause === error);
  assert.equal(current.released, true);
});

test('begin and commit failures release connections, and checkout failure cannot run work', async () => {
  for (const statement of ['BEGIN', 'COMMIT']) {
    const current = connection(statement);
    await assert.rejects(createPostgresDatabase(current.pool).transaction(async () => 1), new RegExp(`failed:${statement}`));
    assert.equal(current.released, statement === 'COMMIT');
    assert.equal(current.calls.at(-1), 'ROLLBACK');
  }
  let ran = false;
  const pool = { connect: async () => { throw new Error('checkout'); } } as Pick<Pool, 'connect'>;
  await assert.rejects(createPostgresDatabase(pool).transaction(async () => { ran = true; }), /checkout/);
  assert.equal(ran, false);
});

test('overlapping operations have separate checked-out clients', async () => {
  const first = connection(); const second = connection(); let index = 0;
  const pool = { connect: () => (index++ === 0 ? first.pool : second.pool).connect() } as Pick<Pool, 'connect'>;
  const db = createPostgresDatabase(pool);
  await Promise.all([db.transaction(tx => tx.query('FIRST')), db.transaction(tx => tx.query('SECOND'))]);
  assert.deepEqual(first.calls, ['BEGIN', 'FIRST', 'COMMIT']);
  assert.deepEqual(second.calls, ['BEGIN', 'SECOND', 'COMMIT']);
});

test('implicit rollback cannot be returned as a successful commit', async () => {
  let discarded = false;
  const client = { query: async (sql: string) => ({ rows: [], command: sql === 'COMMIT' ? 'ROLLBACK' : sql }),
    release: (discard: boolean) => { discarded = discard; } } as unknown as PoolClient;
  const pool = { connect: async () => client } as Pick<Pool, 'connect'>;
  await assert.rejects(createPostgresDatabase(pool).transaction(async () => 'not saved'), /TRANSACTION_NOT_COMMITTED/);
  assert.equal(discarded, true);
});

test('learner role and timeouts are transaction-local and installed before the callback', async () => {
  const current = connection();
  await createPostgresDatabase(current.pool, { learnerRole: true }).transaction(tx => tx.query('LEARNING'));
  assert.deepEqual(current.calls, ['BEGIN', 'SET LOCAL ROLE zeirishi_app', "SET LOCAL statement_timeout = '15s'",
    "SET LOCAL lock_timeout = '5s'", "SET LOCAL idle_in_transaction_session_timeout = '10s'",
    'SET LOCAL search_path = public, pg_catalog', 'LEARNING', 'COMMIT']);
  assert.equal(current.released, false);
});
