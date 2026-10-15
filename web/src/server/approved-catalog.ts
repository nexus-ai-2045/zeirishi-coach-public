import { BOOKKEEPING_MATERIAL_RECORD_DRAFTS } from './bookkeeping-review-records';
import { createHash } from 'node:crypto';
import type { ConceptRef, SubjectPack } from '../domain/onboarding';
import type { PlanCandidate } from '../domain/weekly-plan';
import type { CafeMaterial } from './cafe-case';
import { StudyError } from '../domain/types';
import { createMaterialRegistry, type MaterialRecord } from './material-registry';

/** 登録の正本。人間の専門審査・利用権・出荷承認前の原稿を有効化しない。利用可能な承認済み教材は現在0件。簿記論の原稿はdraftで保持する。 */
export const MATERIAL_RECORDS: readonly MaterialRecord[] = Object.freeze([...BOOKKEEPING_MATERIAL_RECORD_DRAFTS]);

/** Minimal safe picker projection; never includes question options, scores, or reviewer/rights data. */
export type ApprovedMaterialChoice = ConceptRef & { materialId: string; caseVersion: string; label: string };

/** One supply source for profile, planning and consultation; this is not a human approval service. */
export function createApprovedSupply(records: readonly MaterialRecord[]) {
  const entries = [...createMaterialRegistry(records)].sort((a, b) =>
    a.record.subjectId.localeCompare(b.record.subjectId, 'en')
    || a.record.concept.conceptId.localeCompare(b.record.concept.conceptId, 'en')
    || a.record.materialId.localeCompare(b.record.materialId, 'en') || a.record.version.localeCompare(b.record.version, 'en'));
  const subjects = [...new Set(entries.map(entry => entry.record.subjectId))].sort();
  const catalog: readonly SubjectPack[] = subjects.map(subjectId => {
    const group = entries.filter(entry => entry.record.subjectId === subjectId).sort((a, b) =>
      a.record.concept.conceptId.localeCompare(b.record.concept.conceptId, 'en')
      || a.record.concept.conceptVersion.localeCompare(b.record.concept.conceptVersion, 'en')
      || a.record.materialId.localeCompare(b.record.materialId, 'en') || a.record.version.localeCompare(b.record.version, 'en'));
    const version = group.length === 1 ? group[0].record.version : 'pack-' + createHash('sha256').update(JSON.stringify(group.map(entry => [
      entry.record.materialId, entry.record.version, entry.record.concept.conceptId, entry.record.concept.conceptVersion,
    ]))).digest('hex');
    const concepts = new Map<string, (typeof group)[number]['record']['concept']>();
    for (const entry of group) concepts.set(entry.record.concept.conceptId, entry.record.concept);
    return { subjectId, version, active: true, concepts: [...concepts.values()].map(concept => ({ ...concept })) };
  });
  const candidates: readonly PlanCandidate[] = entries.map(entry => ({
    ...entry.record.concept, id: entry.record.materialId, label: entry.material.prompt().consultationTitle,
    familyId: entry.material.prompt().familyId, caseVersion: entry.record.version, minutes: entry.record.concept.durationMinutes,
    bucket: 'new', qualification: 'practice', unseen: false, differentFormat: false, sourceTrust: 1,
    priority: { importance: entry.record.concept.importance, observedExamScoreRatio: null, reviewStatus: 'unknown',
      recentMisconceptions: [], lockedDirectSuccessors: 0, observedMinutes: null, designedMinutes: entry.record.concept.durationMinutes },
  }));
  const materialChoices: readonly ApprovedMaterialChoice[] = entries.map(entry => ({
    subjectId: entry.record.subjectId, conceptId: entry.record.concept.conceptId,
    conceptVersion: entry.record.concept.conceptVersion, materialId: entry.record.materialId,
    caseVersion: entry.record.version, label: entry.material.prompt().consultationTitle,
  }));
  const getMaterial = (selection: { concept?: ConceptRef; materialId?: string; caseVersion?: string } = {}): CafeMaterial => {
    const matches = entries.filter(entry => (!selection.concept || (entry.record.subjectId === selection.concept.subjectId
      && entry.record.concept.conceptId === selection.concept.conceptId
      && entry.record.concept.conceptVersion === selection.concept.conceptVersion))
      && (!selection.materialId || entry.record.materialId === selection.materialId)
      && (!selection.caseVersion || entry.record.version === selection.caseVersion));
    if (matches.length !== 1) throw new StudyError(matches.length > 1 ? 'MATERIAL_SELECTION_REQUIRED' : 'MATERIAL_NOT_AVAILABLE', matches.length > 1 ? 400 : 503);
    return matches[0].material;
  };
  return { catalog, candidates, materialChoices, materials: entries.map(entry => entry.material) as readonly CafeMaterial[], getMaterial };
}

const supply = createApprovedSupply(MATERIAL_RECORDS);
export const APPROVED_CATALOG = supply.catalog;
export const APPROVED_PLAN_CANDIDATES = supply.candidates;
export const APPROVED_MATERIAL_CHOICES = supply.materialChoices;
export const APPROVED_CAFE_MATERIALS = supply.materials;
export const getApprovedCafeMaterial = supply.getMaterial;
