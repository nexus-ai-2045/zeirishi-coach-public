export interface QueryExecutor {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface TransactionDatabase {
  transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
}
export interface SchemaDatabase extends TransactionDatabase {
  exec(sql: string): Promise<unknown>;
}
