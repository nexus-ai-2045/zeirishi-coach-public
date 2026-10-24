/** Minimal SQL contract shared by local and future remote adapters; no driver-specific results. */
export interface QueryExecutor {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface TransactionDatabase {
  /** One connection for the callback; resolve commits, throw rejects and rolls back.
   * A returned Error object is a value, not an instruction to roll back.
   */
  transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
}
/** Development bootstrap only. Prepared-database service factories never require exec. */
export interface SchemaDatabase extends TransactionDatabase {
  exec(sql: string): Promise<unknown>;
}
