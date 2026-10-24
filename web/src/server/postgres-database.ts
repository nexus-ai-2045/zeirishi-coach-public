import type { Pool } from 'pg';
import type { QueryExecutor, TransactionDatabase } from './database';

/** Uses one checked-out pg connection throughout each transaction, never pool.query().
 * The caller supplies an approved, least-privileged pool. This adapter alone grants no
 * user authorization and is deliberately not connected to the HTTP runtime yet.
 */
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
          // Static statements only; transaction pooling must not retain these settings.
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
        // Preserve domain errors returned as values: some services commit expiry
        // cleanup and throw the domain error outside the transaction intentionally.
        active = false;
        commitStarted = true;
        const committed = await client.query('COMMIT');
        if (committed.command !== 'COMMIT') throw new Error('TRANSACTION_NOT_COMMITTED');
        return result;
      } catch (error) {
        active = false;
        // A lost COMMIT response is ambiguous. Do not retry or reuse this connection.
        if (commitStarted) discard = true;
        try { await client.query('ROLLBACK'); }
        catch { discard = true; }
        // Never replace the original failure with rollback failure; no SQL/credentials logged.
        throw error;
      } finally {
        active = false;
        client.release(discard);
      }
    },
  };
}
