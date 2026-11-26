import type { Pool } from 'pg';
import type { QueryExecutor, TransactionDatabase } from './database';

export function createPostgresDatabase(pool: Pick<Pool, 'connect'>, options: { learnerRole?: boolean } = {}): TransactionDatabase {
  return {
    async transaction<T>(operation: (tx: QueryExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let active = false;
      let discard = false;
      let commitStarted = false;
      try {
        await client.query('BEGIN');
        if (options.learnerRole) {
          await client.query('SET LOCAL ROLE zeirishi_app');
          await client.query("SET LOCAL statement_timeout = '15s'");
          await client.query("SET LOCAL lock_timeout = '5s'");
          await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
          await client.query('SET LOCAL search_path = public, pg_catalog');
        }
        active = true;
        const tx: QueryExecutor = {
          async query<Row>(sql: string, params?: unknown[]) {
            if (!active) throw new Error('TRANSACTION_CLOSED');
            const result = await client.query(sql, params);
            return { rows: result.rows as Row[] };
          },
        };
        const result = await operation(tx);
        active = false;
        commitStarted = true;
        const committed = await client.query('COMMIT');
        if (committed.command !== 'COMMIT') throw new Error('TRANSACTION_NOT_COMMITTED');
        return result;
      } catch (error) {
        active = false;
        if (commitStarted) discard = true;
        try { await client.query('ROLLBACK'); }
        catch { discard = true; }
        throw error;
      } finally {
        active = false;
        client.release(discard);
      }
    },
  };
}
