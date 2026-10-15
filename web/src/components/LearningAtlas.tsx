'use client';
import { useEffect, useRef, useState } from 'react';
import { conceptTopics, topicConcepts, type MapConcept, type SubjectMapPack } from '../domain/subject-map';
import type { ConfidenceReport } from '../domain/onboarding';
import type { CafeView, CafeHistoryItem } from '../server/cafe-service';
import type { LearningEvidenceView } from './LearningEvidencePanel';
import styles from './LearningAtlas.module.css';
import { LearningTree } from './LearningTree';
import { LearningBranchLinks } from './LearningBranchLinks';

type Choice = { subjectId: string; conceptId: string; conceptVersion: string; materialId: string; caseVersion: string; label: string };
const labels = { unconfirmed: '習熟未確認', in_progress: '理解中', applicable: '適用できる', exam_confirmed: '試験形式で確認', maintained: '理解を維持', measurement_preparing: '測定準備中' };
const confidenceLabels = { explained: '説明できる', uncertain: '少し怪しい', unlearned: '未学習' };
type Props = { pack: SubjectMapPack; choices: readonly Choice[]; reports: readonly ConfidenceReport[]; session: CafeView | null;
  reducedEffects?: boolean; online: boolean; expectedLearnerId?: string; disabled: boolean; initialConceptId?: string; initialTopicId?: string | null;
  onStart: (concept: MapConcept, material: Choice) => void; onOverview: () => void };

export function LearningAtlas({ reducedEffects = false, pack, choices, reports, session, online, expectedLearnerId, disabled, initialConceptId, initialTopicId, onStart, onOverview }: Props) {
  const [layer, setLayer] = useState<'concepts' | 'topics'>('topics');
  const [expandedUnits, setExpandedUnits] = useState(() => new Set(pack.units.slice(0,6).map(unit => unit.unitId)));
  const [newlyConfirmed, setNewlyConfirmed] = useState<string[]>([]);
  const lastConfirmation = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const [selected, setSelected] = useState(initialConceptId ?? 'prepaid-expenses');
  const [topicId, setTopicId] = useState<string | null>(initialTopicId ?? null);
  const [evidence, setEvidence] = useState<LearningEvidenceView | null>(null);
  const [history, setHistory] = useState<CafeHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState(false);
  const [refresh, setRefresh] = useState(online ? 0 : 1);
  useEffect(() => {
    if (!newlyConfirmed.length) return;
    const timer = setTimeout(() => setNewlyConfirmed([]), 1100);
    return () => clearTimeout(timer);
  }, [newlyConfirmed]);
  useEffect(() => {
    if (!refresh) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('PROGRESS_TIMEOUT')), 30000);
    setLoading(true); setFailure(false); setEvidence(null); setHistory([]); setNewlyConfirmed([]);
    const headers = expectedLearnerId ? { 'X-Zeirishi-Learner': expectedLearnerId } : undefined;
    const query = new URLSearchParams({ subjectId: pack.subjectId, examYear: String(new Date().getFullYear()), criterionVersion: 'unconfirmed' });
    const read = async (url: string) => {
      const response = await fetch(url, { headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('PROGRESS_UNAVAILABLE');
      return response.json();
    };
    void Promise.all([read(`/api/learning-evidence?${query}`), read('/api/history')]).then(([next, saved]) => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(next.mastery) || !Array.isArray(saved.items)) throw new Error('PROGRESS_INVALID');
      const scope = `${pack.subjectId}:${pack.version}:${expectedLearnerId ?? 'local'}`;
      const confirmedIds = new Set(pack.concepts.filter(concept => {
        const matches = ((next as LearningEvidenceView).mastery ?? []).filter(item => item.subjectId === pack.subjectId && item.conceptId === concept.conceptId && item.conceptVersion === concept.conceptVersion);
        return matches.length === 1 && !matches[0].needsRecheck && ['applicable', 'exam_confirmed', 'maintained'].includes(matches[0].status);
      }).map(concept => concept.conceptId));
      const previous = lastConfirmation.current;
      if (previous?.scope === scope) setNewlyConfirmed([...confirmedIds].filter(id => !previous.ids.has(id)));
      lastConfirmation.current = { scope, ids: confirmedIds };
      setEvidence(next); setHistory(Array.isArray(saved.items) ? saved.items : []);
    }).catch(() => { if (!controller.signal.aborted || controller.signal.reason?.message === 'PROGRESS_TIMEOUT') setFailure(true); }).finally(() => { clearTimeout(timeout); if (!controller.signal.aborted || controller.signal.reason?.message === 'PROGRESS_TIMEOUT') setLoading(false); });
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [refresh, pack.subjectId, pack.version, expectedLearnerId]);
  const assessment = (concept: MapConcept) => {
    const matches = evidence?.mastery?.filter(item => item.subjectId === pack.subjectId && item.conceptId === concept.conceptId && item.conceptVersion === concept.conceptVersion) ?? [];
    return matches.length === 1 ? matches[0] : undefined;
  };
  const practiced = (concept: MapConcept) => {
    const links = pack.links.filter(link => link.kind === 'uses-case' && link.role === 'primary' && link.sourceId === concept.conceptId && link.sourceVersion === concept.conceptVersion);
    return links.some(link => {
      const scopes = new Set(pack.links.filter(other => other.kind === 'uses-case' && other.role === 'primary' && other.targetVersion === link.targetVersion).map(other => `${other.sourceId}:${other.sourceVersion}`));
      return scopes.size === 1 && history.some(item => item.caseVersion === link.targetVersion && item.status === 'completed');
    }) || Boolean(session?.status === 'completed' && sessionConcept?.conceptId === concept.conceptId);
  };
  const available = (concept: MapConcept) => choices.filter(choice => choice.subjectId === pack.subjectId && choice.conceptId === concept.conceptId && choice.conceptVersion === concept.conceptVersion
    && pack.links.some(link => link.kind === 'uses-case' && link.role === 'primary' && link.sourceId === concept.conceptId && link.sourceVersion === concept.conceptVersion && link.targetId === choice.materialId && link.targetVersion === choice.caseVersion));
  const sessionConcept = session && pack.concepts.find(item => item.conceptId === session.prompt.conceptId && pack.links.some(link=>link.kind==='uses-case' && link.role==='primary' && link.sourceId===item.conceptId && link.sourceVersion===item.conceptVersion && link.targetId===session.prompt.caseId && link.targetVersion===session.caseVersion));
  const current = session?.status === 'active' ? sessionConcept?.conceptId : undefined;
  const neighbors = (id:string, direction:'before'|'after') => pack.links.filter(link=>link.kind==='prerequisite' && (direction==='before' ? link.targetId===id : link.sourceId===id)).map(link=>pack.concepts.find(item=>item.conceptId===(direction==='before' ? link.sourceId : link.targetId))).filter((item):item is MapConcept=>!!item);
  const isConfirmed = (concept: MapConcept) => { const item = assessment(concept); return Boolean(item && !item.needsRecheck && ['applicable', 'exam_confirmed', 'maintained'].includes(item.status)); };
  const confirmed = pack.concepts.filter(isConfirmed).length;
  const toggleUnit = (id: string) => setExpandedUnits(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const concept = pack.concepts.find(item => item.conceptId === selected) ?? pack.concepts[0];
  const pickConcept = (id: string) => { setSelected(id); setTopicId(null); setLayer('concepts'); };
  const status = (item: MapConcept) => {
    const value = assessment(item);
    const confidence = reports.find(report => report.subjectId === pack.subjectId && report.conceptId === item.conceptId && report.conceptVersion === item.conceptVersion)?.selfConfidence;
    return <div className={styles.badges}>
      {current === item.conceptId && <span className={styles.current}>現在地</span>}
      <span className={`${isConfirmed(item) ? styles.confirmed : styles.status} ${newlyConfirmed.includes(item.conceptId) ? styles.justConfirmed : ''}`}>{failure ? '状況取得できず' : !evidence ? (loading ? '習熟を確認中' : '習熟を未読込') : labels[value?.status ?? 'unconfirmed']}</span>
      {value?.needsRecheck && <span className={styles.recheck}>再確認が必要</span>}
      {practiced(item) && <span className={styles.practice}>直近の練習あり（直近の記録）</span>}
      {confidence && <span className={styles.self}>自己申告：{confidenceLabels[confidence]}</span>}
    </div>;
  };
  return <section className={styles.atlas} data-reduced={reducedEffects} aria-label="簿記のコア概念">
    <div className={styles.title}><div><p>科目の全体と、あなたの現在地</p><h2>学びの枝を見渡す</h2></div><button disabled={disabled} onClick={onOverview}>簿記の全体像をつかむ →</button></div>
    <div className={styles.stats} aria-label="地図の範囲と学習状況"><div><strong>{pack.units.length}</strong><span>大きな枝</span></div><div><strong>{pack.topics.length}</strong><span>論点</span></div><div><strong>{pack.concepts.length}</strong><span>考え方</span></div><div><strong>{evidence ? confirmed : '—'}<small> / {pack.concepts.length}</small></strong><span>適用以上を確認</span></div></div>
    {evidence && !evidence.mastery?.length && <p className={styles.note}>正式な概念別測定の記録はまだありません。相談の練習履歴は習熟とは別に表示します。</p>}
    <div className={styles.legend}><span>● 現在地</span><span>✓ 証拠で確認</span><span>○ 習熟未確認</span><span>相談の練習・自己申告は別表示</span></div>
    <div className={styles.toolbar}><div role="group" aria-label="地図の見方"><button aria-pressed={layer === 'concepts'} onClick={() => setLayer('concepts')}>考え方で見る</button><button aria-pressed={layer === 'topics'} onClick={() => setLayer('topics')}>試験論点で見る</button></div><button disabled={loading || disabled} onClick={() => setRefresh(value => value + 1)}>{loading ? '学習状況を確認中…' : '保存済みの学習状況を確認'}</button></div>
    <p className={styles.updateNotice} role="status">{newlyConfirmed.length ? `新たに${newlyConfirmed.length}個の考え方で、適用以上を確認しました。` : ''}</p>
    {failure && <p role="alert">学習状況を取得できませんでした。習熟済みとは表示していません。もう一度確認できます。</p>}
    {!refresh && <p className={styles.note}>「保存済みの学習状況を確認」で本人の評価記録を読み込みます。</p>}
    <LearningTree><div className={styles.root} data-tree-root><span>簿記論</span><small>今回の試用範囲</small></div>
      {layer === 'concepts' ? <div className={styles.branches} role="group" aria-label="理解したいコア概念">{pack.concepts.map(item => <article key={item.conceptId} data-tree-branch className={`${styles.branch} ${newlyConfirmed.includes(item.conceptId) ? styles.justConfirmed : ''}`} data-current={current === item.conceptId} data-confirmed={isConfirmed(item)}>
        <LearningBranchLinks /><button className={styles.node} aria-label={item.label} aria-pressed={concept?.conceptId === item.conceptId} onClick={() => pickConcept(item.conceptId)}><span className={styles.marker} data-branch-marker aria-hidden="true">{current === item.conceptId ? '●' : '○'}</span><strong>{item.label}</strong></button>
        {status(item)}<ul className={styles.leaves}>{conceptTopics(pack, item.conceptId).map(topic => <li key={topic.topicId}><button data-branch-leaf onClick={() => { setTopicId(topic.topicId); setLayer('topics'); }}>{topic.label} ↗</button></li>)}</ul><p className={styles.note}>{available(item).length ? `相談 ${available(item).length}件につながります` : '相談教材は準備中'}</p>
      </article>)}</div> : <section aria-label="試験論点の地図" className={styles.units}>{[...pack.units].sort((a,b) => a.order-b.order).map(unit => {
        const topics = pack.topics.filter(topic => topic.unitId === unit.unitId).sort((a,b) => a.order-b.order);
        const concepts = pack.concepts.filter(item => topics.some(topic => topicConcepts(pack, topic.topicId).some(linked => linked.conceptId === item.conceptId)));
        const expanded = expandedUnits.has(unit.unitId);
        const unitCurrent = concepts.some(item => item.conceptId === current);
        const confirmedCount = concepts.filter(isConfirmed).length;
        const practicedCount = concepts.filter(practiced).length;
        return <article key={unit.unitId} data-tree-branch className={`${styles.branch} ${newlyConfirmed.some(id => concepts.some(item => item.conceptId === id)) ? styles.justConfirmed : ''}`} data-current={unitCurrent} data-confirmed={concepts.length > 0 && confirmedCount === concepts.length}>
          <LearningBranchLinks /><h3><button className={styles.unitNode} aria-expanded={expanded} aria-controls={`atlas-unit-${pack.subjectId}-${unit.unitId}`} onClick={() => toggleUnit(unit.unitId)}><span className={styles.marker} data-branch-marker aria-hidden="true">{unitCurrent ? '●' : '◇'}</span><strong>{unit.label}</strong><span className={styles.expand} aria-hidden="true">{expanded ? '−' : '＋'}</span></button></h3>
          <div className={styles.branchSummary}><span>{topics.length}論点・{concepts.length}考え方</span>{unitCurrent && <span className={styles.current}>現在地</span>}<span>確認 {evidence ? confirmedCount : '—'} / {concepts.length}</span><span>直近の練習 {!evidence || loading || failure ? '—' : practicedCount} / {concepts.length}</span></div>
          <ul hidden={!expanded} id={`atlas-unit-${pack.subjectId}-${unit.unitId}`} className={styles.leaves}>{topics.map(topic => {
            const linked = topicConcepts(pack, topic.topicId);
            return <li key={topic.topicId} data-current={linked.some(item => item.conceptId === current)} data-confirmed={linked.length > 0 && linked.every(isConfirmed)}><button data-branch-leaf className={styles.topic} aria-pressed={topicId === topic.topicId} onClick={() => setTopicId(topic.topicId)}><strong>{topic.label}</strong><span>{topic.summary}</span></button><div className={styles.related}>{linked.map(item => <div key={item.conceptId}><button onClick={() => pickConcept(item.conceptId)}>{item.label} ↗</button>{status(item)}</div>)}{!linked.length && <span>対応する考え方は未確認・教材準備中</span>}</div></li>;
          })}</ul>
        </article>;
      })}</section>}
    </LearningTree>
    {topicId && <section className={styles.detail} aria-live="polite"><h3>{pack.topics.find(topic => topic.topicId === topicId)?.label}</h3><p>つながる考え方</p>{topicConcepts(pack, topicId).map(item => <button key={item.conceptId} onClick={() => pickConcept(item.conceptId)}>{item.label} ↗</button>)}{!topicConcepts(pack, topicId).length && <p>対応する考え方は未確認です。教材を開始することはできません。</p>}</section>}
    {!topicId && concept && <section className={styles.detail} aria-label="選んだ概念の説明"><p>選んだ枝</p><h3>{concept.label}</h3>{status(concept)}<p>{concept.definition}</p><p>{concept.purpose}</p><dl><dt>使える条件</dt><dd>{concept.applicability}</dd><dt>当てはまらない例</dt><dd>{concept.counterexample}</dd><dt>間違えやすい点</dt><dd>{concept.misconception}</dd><dt>確かめる資料</dt><dd>{concept.materialCue}</dd><dt>試験での使い方</dt><dd>{concept.examUse}</dd></dl><div className={styles.actions}>{available(concept).map(choice => <button key={choice.materialId} disabled={disabled} onClick={() => onStart(concept, choice)}>この考え方を相談で試す →</button>)}</div>{!available(concept).length && <p>相談教材は準備中です。考え方は自由に見られます。</p>}</section>}
    {!topicId && concept && <section className={styles.detail} aria-label="概念のつながり"><h3>この考え方のつながり</h3><p>先に知ると理解しやすい考え方</p>{neighbors(concept.conceptId,'before').length ? neighbors(concept.conceptId,'before').map(item=><button key={item.conceptId} onClick={()=>pickConcept(item.conceptId)}>{item.label} →</button>) : <p>この原稿では前提を設定していません。</p>}<p>次に試す候補</p>{neighbors(concept.conceptId,'after').length ? neighbors(concept.conceptId,'after').map(item=><button key={item.conceptId} onClick={()=>pickConcept(item.conceptId)}>{item.label} →</button>) : <p>別の問題で同じ考え方を試しましょう。</p>}<p>専門審査前の関係です。順番を強制するものではありません。</p></section>}
    <p className={styles.note}>基礎と科目の主要分類をつなぐ原稿の地図です。公式の全範囲網羅や専門承認を意味しません。練習状況は直近20件の完了履歴と、この画面の保存済み案件から表示します。地図を見ることや自信の申告だけでは習熟は上がりません。</p>
  </section>;
}
