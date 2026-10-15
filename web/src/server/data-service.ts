import type { SchemaDatabase, TransactionDatabase } from './database';
import { StudyError } from '../domain/types';
import type { Answer, SessionView } from '../domain/types';
import type { ConfidenceProfile } from './confidence-service';
import type { CafeView } from './cafe-service';
import { purgeExpiredCafe } from './cafe-service';
import { purgeExpiredStudy } from './study-service';
import { assertOwnerActive, initializeOwnerAccess, lockOwner } from './owner-access';
import { initializeWeeklyPlanSchema, readWeeklyPlanRecord } from './weekly-plan-service';
import { initializeMockExamSchema, readMockExamRecords } from './mock-exam-service';
import { initializeExamEvidenceSchema, readExamEvidenceHistory } from './exam-evidence-service';
import { initializeReviewSchema, type ReviewCorrection } from './review-service';
import { initializeMasteryEvidenceSchema, readMasteryEvidenceHistory } from './mastery-evidence-service';
import type { ReviewScheduleEvent } from '../domain/review-schedule';
import { AI_COACH_SCHEMA } from './ai-coach-service';
import { initializeDiagnosticSchema, readDiagnosticRecords } from './diagnostic-service';

const localNotice = 'このブラウザーの匿名識別子に紐づくローカル開発データだけが対象です。本番・クラウド・バックアップからの削除は未検証です。削除後の再保存を防ぐため識別子のハッシュと失効日時を保持します。';
const onlineNotice = 'ログイン中の本人に紐づく、このアプリの学習データだけが対象です。認証アカウント・ログイン状態・招待情報・バックアップ・ダウンロード済みファイルは対象外です。削除後の再保存を防ぐため識別子のハッシュと失効日時を保持し、この本人IDでの学習再開を拒否します。';
type ExportStudy = { id: string; status: SessionView['status']; revision: number; savedAt: string | null;
  expiresAt: string; answer: Answer | null; result: SessionView['result']; submittedAt: string | null;
  fixtureVersion: string; scoringVersion: string };
type ExportCafe = { id: string; caseVersion: string; status: CafeView['status']; phase: CafeView['phase'];
  revision: number; progressRevision: number; savedAt: string | null; expiresAt: string; completedAt: string | null;
  optionId: string | null; explanation: string; attemptId: string | null; submittedAt: string | null;
  confidence: CafeView['confidence']; confidenceFixed: boolean; result: CafeView['result'] };

/** Existing adapters must initialize their schemas on this same database before construction. */
export async function createDataService(db: SchemaDatabase, now: () => Date = () => new Date()) {
  await initializeOwnerAccess(db);
  await initializeWeeklyPlanSchema(db);
  await initializeMockExamSchema(db);
  await initializeExamEvidenceSchema(db);
  await initializeReviewSchema(db);
  await initializeMasteryEvidenceSchema(db);
  await db.exec(AI_COACH_SCHEMA);
  await initializeDiagnosticSchema(db);
  return createDataServiceOnPreparedDatabase(db, now);
}

/** All study/cafe/profile/plan/owner tables must exist; no DDL or external connection is performed. */
export function createDataServiceOnPreparedDatabase(db: TransactionDatabase, now: () => Date = () => new Date(), scope: 'local' | 'online' = 'local') {
  if (scope !== 'local' && scope !== 'online') throw new StudyError('INVALID_DATA_SCOPE', 500);
  const developmentOnly = scope === 'local';
  const notice = developmentOnly ? localNotice : onlineNotice;
  function clock() {
    const at = now();
    if (!Number.isFinite(at.getTime())) throw new StudyError('INVALID_CLOCK', 500);
    return at;
  }
  return {
    async export(owner: string) {
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        const at = clock();
        await purgeExpiredStudy(tx, at);
        await purgeExpiredCafe(tx, at);
        const profile = (await tx.query<ConfidenceProfile>(`SELECT revision,updated_at AS "updatedAt",reports,
          exam_subjects AS "examSubjects" FROM confidence_profiles WHERE owner_id=$1`, [owner])).rows[0]
          ?? { revision: 0, updatedAt: null, reports: [], examSubjects: null };
        const studySessions = (await tx.query<ExportStudy>(`SELECT s.id,s.status,s.revision,s.saved_at AS "savedAt",
          s.expires_at AS "expiresAt",COALESCE(s.answer,a.answer) AS answer,s.result,
          a.submitted_at AS "submittedAt",s.fixture_version AS "fixtureVersion",s.scoring_version AS "scoringVersion"
          FROM study_sessions s LEFT JOIN study_attempts a ON a.session_id=s.id AND a.owner_id=s.owner_id
          WHERE s.owner_id=$1 ORDER BY s.id`, [owner])).rows;
        // Project only already-disclosed grading. Never export raw receipts or the hidden attempt result.
        const cafeCases = (await tx.query<ExportCafe>(`SELECT i.id,i.case_version AS "caseVersion",i.status,
          CASE WHEN i.status<>'active' THEN i.status ELSE COALESCE(p.phase,i.draft_phase,'consultation') END AS phase,
          i.revision,COALESCE(p.revision,0) AS "progressRevision",COALESCE(p.saved_at,i.saved_at) AS "savedAt",
          i.expires_at AS "expiresAt",i.completed_at AS "completedAt",COALESCE(a.option_id,i.option_id) AS "optionId",
          COALESCE(p.explanation,'') AS explanation,a.id AS "attemptId",a.submitted_at AS "submittedAt",
          c.confidence,(c.attempt_id IS NOT NULL) AS "confidenceFixed",
          CASE WHEN c.attempt_id IS NOT NULL THEN a.result ELSE NULL END AS result
          FROM cafe_instances i
          LEFT JOIN cafe_attempts a ON a.instance_id=i.id AND a.owner_id=i.owner_id
          LEFT JOIN cafe_confidence c ON c.attempt_id=a.id
          LEFT JOIN cafe_progress p ON p.instance_id=i.id AND p.owner_id=i.owner_id
          WHERE i.owner_id=$1 ORDER BY i.id`, [owner])).rows;
        return { formatVersion: developmentOnly ? 'zeirishi-local-data-v1' as const : 'zeirishi-learning-data-v1' as const, exportedAt: at.toISOString(),
          developmentOnly, notice, profile, studySessions, cafeCases,
          weeklyPlan: await readWeeklyPlanRecord(tx, owner), mockExamRecords: await readMockExamRecords(tx, owner, true),
          examEvidence: await readExamEvidenceHistory(tx, owner),
          masteryEvidence: await readMasteryEvidenceHistory(tx, owner),
          diagnostics: await readDiagnosticRecords(tx, owner, undefined, at.toISOString()),
          reviewEvidence: (await tx.query<{ event_id: string; kind: string; payload: ReviewScheduleEvent | ReviewCorrection }>('SELECT event_id,kind,payload FROM review_evidence_events WHERE owner_id=$1 ORDER BY sequence', [owner])).rows,
          aiInteractions: (await tx.query<{ request_id: string; instance_id: string; attempt_id: string; case_version: string; progress_revision: number; kind: string; purpose: string; status: string; created_at: string }>('SELECT request_id,instance_id,attempt_id,case_version,progress_revision,kind,purpose,status,created_at FROM ai_interaction_summaries WHERE owner_id=$1 ORDER BY created_at,request_id', [owner])).rows };
      });
    },
    async delete(owner: string) {
      return db.transaction(async tx => {
        const identity = await lockOwner(tx, owner);
        if (identity.revokedAt === null) {
          const at = clock();
          await tx.query(`DELETE FROM cafe_confidence WHERE attempt_id IN
            (SELECT id FROM cafe_attempts WHERE owner_id=$1)`, [owner]);
          // Static table names only, ordered by existing foreign keys. All changes commit together.
          for (const table of ['mastery_evidence_requests', 'mastery_evidence_revisions', 'diagnostic_requests', 'diagnostic_sessions', 'ai_interaction_summaries', 'exam_evidence_requests', 'exam_evidence_revisions', 'review_evidence_events', 'mock_exam_requests', 'mock_exam_records', 'weekly_plan_requests', 'weekly_plans', 'cafe_requests', 'cafe_progress', 'cafe_attempts', 'cafe_instances',
            'study_requests', 'study_attempts', 'study_sessions', 'confidence_requests', 'confidence_profiles']) {
            await tx.query(`DELETE FROM ${table} WHERE owner_id=$1`, [owner]);
          }
          await tx.query('UPDATE owner_access SET revoked_at=$2 WHERE owner_hash=$1', [identity.hash, at.toISOString()]);
        }
        return { deleted: true as const, developmentOnly, notice,
          ...(scope === 'online' ? { accountDeleted: false as const, backupsDeleted: false as const } : {}) };
      });
    },
  };
}
