import { validateSubjectMap, type MapLink, type SubjectMapPack } from '../domain/subject-map';
import { CAFE_CASE_VERSION } from './cafe-case';

const version = CAFE_CASE_VERSION;
const sourceId = 'synthetic-local';
const status = 'draft' as const;
const base = { status, sourceId, applicableYear: null };
const explains = (sourceId: string, targetId: string): MapLink => ({
  kind: 'explains-topic', sourceId, sourceVersion: version, targetId, targetVersion: version,
  basis: '架空の導入例の編集上の接続。専門審査前。', status,
});

/** Local-only synthetic map. Existing material catalog owns case availability and approval. */
export const DEVELOPMENT_BOOKKEEPING_MAP: SubjectMapPack = validateSubjectMap({
  subjectId: 'bookkeeping', legacySubjectId: 'boki', version, status,
  units: [
    { unitId: 'bookkeeping-foundations', label: '記録の基礎', order: 0, ...base },
    { unitId: 'bookkeeping-periods', label: '期間と決算', order: 1, ...base },
  ],
  topics: [
    { topicId: 'transaction-effects', unitId: 'bookkeeping-foundations', label: '取引の記録と財産の変化', summary: '現金、負債、備品を区別して取引の二面を記録する。', order: 0, ...base },
    { topicId: 'period-expense', unitId: 'bookkeeping-periods', label: '期間に対応する費用', summary: '支払日とサービスを受ける期間を分けて考える。', order: 0, ...base },
    { topicId: 'prepaid-assets', unitId: 'bookkeeping-periods', label: '前払費用', summary: '未使用分を翌期に残す考え方。', order: 1, ...base },
    { topicId: 'unconnected-topic', unitId: 'bookkeeping-periods', label: '未接続の論点例', summary: '対応する概念と教材を確認中。', order: 2, ...base },
  ],
  concepts: [
    { conceptId: 'cash-is-not-profit', conceptVersion: version, label: 'お金と利益は別',
      definition: '現金が増えただけでは利益が増えたとは言えない。', purpose: '現金が増えた理由を見分けるため。',
      applicability: '借入など、現金と返済義務が同時に増える取引。', counterexample: '売上が実現し、対応する費用を差し引いて利益が生じる場合。',
      misconception: '借りた10万円をそのまま儲けと考える。', materialCue: '現金と借入金を別々に見る。',
      examUse: '取引の影響を資産・負債・損益に分ける。', ...base },
    { conceptId: 'double-entry', conceptVersion: version, label: '取引には二つの面がある',
      definition: '一つの取引が二つ以上の勘定の変化として記録される。', purpose: '何が増え何が減ったかを漏らさず表すため。',
      applicability: '借入や現金による備品購入などの記録。', counterexample: '単なる見積りなど、まだ記録対象の取引がない場合。',
      misconception: '借方と貸方を良い・悪いの意味だと思う。', materialCue: '帳簿の左右の記録と取引事実を見る。',
      examUse: '仕訳の借方・貸方を組み立てる。', ...base },
    { conceptId: 'prepaid-expenses', conceptVersion: version, label: '支払日と費用の期間は別',
      definition: '支払額のうち、サービスを受けた期間に対応する部分を費用にする。', purpose: 'その期間の成果を適切に見積もるため。',
      applicability: '保険料などを先払いし、便益が複数期にわたる場合。', counterexample: '支払額のすべてが当期のサービスに対応する場合。',
      misconception: '支払った額の全額をその期の費用と考える。', materialCue: '契約期間、決算日、帳簿の計上額を見る。',
      examUse: '当期費用と翌期の前払費用を配分する。', ...base },
  ],
  links: [
    explains('cash-is-not-profit', 'transaction-effects'),
    explains('cash-is-not-profit', 'period-expense'),
    explains('double-entry', 'transaction-effects'),
    explains('prepaid-expenses', 'period-expense'),
    explains('prepaid-expenses', 'prepaid-assets'),
    { kind: 'prerequisite', sourceId: 'cash-is-not-profit', sourceVersion: version,
      targetId: 'prepaid-expenses', targetVersion: version, basis: '現金と損益の区別を先に知ると理解しやすい。', status },
    { kind: 'uses-case', sourceId: 'prepaid-expenses', sourceVersion: version,
      targetId: 'cafe-prepaid', targetVersion: version, role: 'primary',
      basis: '既存の開発用カフェ保険料案件の主概念。', status },
  ],
});

export const DEVELOPMENT_SUBJECT_MAP = DEVELOPMENT_BOOKKEEPING_MAP;
