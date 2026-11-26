import { StudyError } from '../domain/types';
import type { QueryExecutor, TransactionDatabase } from './database';
import { requireVerifiedLearner, type VerifiedAuthReader } from './supabase-auth';

export async function createLearnerDatabase(base: TransactionDatabase, reader: Pick<VerifiedAuthReader, 'getUser'>) {
  const { userId } = await requireVerifiedLearner(reader);
  const database: TransactionDatabase = {
    async transaction<T>(operation: (tx: QueryExecutor) => Promise<T>): Promise<T> {
      const current = await requireVerifiedLearner(reader);
      if (current.userId !== userId) throw new StudyError('AUTH_IDENTITY_CHANGED', 401);
      return base.transaction(async tx => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        const role = (await tx.query<{ name: string; superuser: boolean; bypass: boolean }>(
          'SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypass FROM pg_catalog.pg_roles WHERE rolname=current_user')).rows[0];
        if (!role || role.name !== 'zeirishi_app' || role.superuser !== false || role.bypass !== false) throw new StudyError('DATABASE_ROLE_REJECTED', 503);
        await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userId, is_anonymous: false })]);
        try {
          await tx.query('SELECT zeirishi_private.require_active_learner($1::uuid)', [userId]);
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ZC403') throw new StudyError('INVITATION_REQUIRED', 403);
          throw new StudyError('AUTH_UNAVAILABLE', 503);
        }
        return operation(tx);
      });
    },
  };
  return { userId, database };
}
