'use client';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { countStages, dueCards, localDay, MEMORIZED_STEP, STAGE_LABELS, STAGE_ORDER, topicProgressMap, type PracticeRecord, type ReviewCheck, type StageCounts, type TopicStage } from '../domain/topic-progress';
import { ReviewCards } from './ReviewCards';
import type { MapConcept, MapTopic, PendingReformText, SubjectMapPack } from '../domain/subject-map';
import { conceptTopics, topicConcepts } from '../domain/subject-map';
import styles from './SubjectTreeView.module.css';

type Choice = { subjectId: string; conceptId: string; conceptVersion: string; materialId: string; caseVersion: string; label: string };
type Props = { pack: SubjectMapPack; subjectLabel?: string; choices: readonly Choice[]; disabled: boolean; initialConceptId?: string; initialTopicId?: string | null;
  onStart: (concept: MapConcept, material: Choice) => void };
/** Adds a plain-word gloss in parentheses after the first use of each technical term. `seen` is shared within one panel. */
function glossText(text: string, glossary: Record<string, string> | undefined, seen: Set<string>, className: string): ReactNode {
  if (!glossary) return text;
  const terms = Object.keys(glossary).sort((a, b) => b.length - a.length);
  const parts: ReactNode[] = []; let plain = ''; let index = 0;
  while (index < text.length) {
    const term = terms.find(item => text.startsWith(item, index));
    if (term && !seen.has(term) && text[index + term.length] !== '（' && text[index - 1] !== '（') {
      if (plain) { parts.push(plain); plain = ''; }
      seen.add(term);
      parts.push(<Fragment key={`${index}-${term}`}>{term}<span className={className}>（{glossary[term]}）</span></Fragment>);
      index += term.length;
    } else if (term) { plain += term; index += term.length; } else { plain += text[index]; index += 1; }
  }
  if (plain) parts.push(plain);
  return parts;
}
const frequencyLabel = { high: '★頻出', mid: 'よく出る', low: 'ときどき' } as const;
const nextStep: Record<TopicStage, string> = {
  none: 'この論点の確認問題はまだありません。説明を読んで全体の中の位置をつかみましょう。',
  new: 'まだ解いていません。確認問題に正解すると「理解した」になります。',
  retry: '直近の解答が不正解でした。解説を読み直して、もう一度解いてみましょう。',
  understood: '正解できました。この論点は復習カードに入りました。1日・3日・7日後のカードで3回続けて「覚えていた」になると「覚えた」になります。',
  memorized: '時間をあけても3回続けて思い出せました。忘れないよう、21日ごとにカードが出ます。',
};

/** Coloured bar of topic stages (覚えた・理解した・もう一度・まだ) for a field or the whole subject. */
function StageBar({ counts, label, decorative = false }: { counts: StageCounts; label: string; decorative?: boolean }) {
  const total = STAGE_ORDER.reduce((sum, stage) => sum + counts[stage], 0);
  const text = `${label}：問題のある${total}論点のうち、覚えた${counts.memorized}・理解した${counts.understood}・もう一度${counts.retry}・まだ${counts.new}`;
  return <span className={styles.bar} {...decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': text }} title={text}>
    {total ? STAGE_ORDER.filter(stage => counts[stage]).map(stage => <span key={stage} data-stage={stage} style={{ flexGrow: counts[stage] }} />) : <span data-stage="none" style={{ flexGrow: 1 }} />}
  </span>;
}

/** Loads the practice records and review-card checks of one subject and derives each topic's stage. Shared by the home and the map. */
function useTopicProgress(pack: SubjectMapPack) {
  const [records, setRecords] = useState<PracticeRecord[] | null>(null);
  const [checks, setChecks] = useState<ReviewCheck[]>([]);
  const [progressFailed, setProgressFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/practice-progress', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('PROGRESS_UNAVAILABLE'); return response.json(); })
      .then(body => { if (!Array.isArray(body.records) || !Array.isArray(body.checks)) throw new Error('PROGRESS_INVALID'); setChecks(body.checks); setRecords(body.records); })
      .catch(() => { if (!controller.signal.aborted) setProgressFailed(true); });
    return () => controller.abort();
  }, [pack.subjectId, pack.version]);
  const progress = useMemo(() => topicProgressMap(pack, records ?? [], checks), [pack, records, checks]);
  const stageOf = (topicId: string): TopicStage => records ? progress.get(topicId)?.stage ?? 'none' : 'none';
  const subjectCounts = countStages(pack.topics.map(item => stageOf(item.topicId)));
  return { records, setChecks, progressFailed, progress, stageOf, subjectCounts };
}

/** The progress line under the bar, in the same words on the home and the map. */
function CountsText({ records, progressFailed, counts, topicCount }: { records: unknown; progressFailed: boolean; counts: StageCounts; topicCount: number }) {
  return <p className={styles.counts}>{records ? <>理解した <strong>{counts.understood + counts.memorized}</strong>（うち覚えた <strong>{counts.memorized}</strong>）／ 問題のある {topicCount - counts.none} 論点
    {counts.retry > 0 && <> ・ もう一度 {counts.retry}</>}</> : progressFailed ? '進み具合を読み込めませんでした（色は「まだ」のまま表示しています）' : '進み具合を読み込み中…'}</p>;
}

function Legend() {
  return <ul className={styles.legend} aria-label="色の意味">
    {(['new', 'retry', 'understood', 'memorized'] as const).map(stage => <li key={stage}><span className={styles.dot} data-stage={stage} />{STAGE_LABELS[stage]}</li>)}
  </ul>;
}

/**
 * The home's summary of the chosen subject: the same bar, counts and colours as the learning map, and how many
 * review cards are due today, so the home and the map never tell different stories.
 */
export function SubjectHomeSummary({ pack, subjectLabel, subjects, disabled, onChooseSubject, onOpenMap }: { pack: SubjectMapPack; subjectLabel: string;
  subjects: readonly { id: string; label: string }[]; disabled: boolean; onChooseSubject: (subjectId: string) => void; onOpenMap: () => void }) {
  const { records, progressFailed, progress, subjectCounts } = useTopicProgress(pack);
  const due = records ? dueCards(progress, localDay(new Date())).length : 0;
  return <div className={`${styles.view} ${styles.home}`}><section className={styles.homeSummary} aria-label="いまの科目の進み具合">
    <p className={styles.kicker}>今日学ぶ科目（11科目のどこからでも始められます）</p>
    <div className={styles.homeSubjects} role="group" aria-label="今日学ぶ科目を選ぶ">
      {subjects.map(subject => <button key={subject.id} aria-pressed={subject.id === pack.subjectId} disabled={disabled}
        onClick={() => { if (subject.id !== pack.subjectId) onChooseSubject(subject.id); }}>{subject.label}</button>)}
    </div>
    <h2>{subjectLabel}</h2>
    <StageBar counts={subjectCounts} label={`${subjectLabel}全体`} />
    <CountsText records={records} progressFailed={progressFailed} counts={subjectCounts} topicCount={pack.topics.length} />
    <Legend />
    <p className={styles.homeCards}>今日の復習カード：<strong>{records ? `${due}枚` : '—'}</strong>{records && !due && <span>（確認問題に正解した論点が、翌日からカードになります）</span>}</p>
    <button className={styles.homeOpen} disabled={disabled} onClick={onOpenMap}>{due ? `学習地図で今日の復習カード（${due}枚）から始める →` : `${subjectLabel}の学習地図を開く →`}</button>
  </section>
  <ol className={styles.homeSteps} aria-label="学習の順番">
    <li><span className={styles.dot} data-stage="new" aria-hidden="true" /><strong>1 論点を知る</strong><small>全体ツリーで論点の位置と説明を読む</small></li>
    <li><span className={styles.dot} data-stage="understood" aria-hidden="true" /><strong>2 確認問題で確かめる</strong><small>正解すると青の「理解した」</small></li>
    <li><span className={styles.dot} data-stage="memorized" aria-hidden="true" /><strong>3 復習カードで覚える</strong><small>1日・3日・7日後に3回続けて思い出せると緑の「覚えた」</small></li>
  </ol></div>;
}

/**
 * The learning map of one subject: a tree of fields → topics. Each topic is coloured by how far the
 * learner has got (まだ・もう一度・理解した・覚えた), and selecting one shows what it is, why it matters,
 * and which topics come before/after it.
 */
export function SubjectTreeView({ pack, subjectLabel, choices, disabled, initialConceptId, initialTopicId, onStart }: Props) {
  const units = useMemo(() => [...pack.units].sort((a, b) => a.order - b.order), [pack.units]);
  const topicsOf = (unitId: string) => pack.topics.filter(topic => topic.unitId === unitId).sort((a, b) => a.order - b.order);
  const conceptOf = (topicId: string) => topicConcepts(pack, topicId)[0];
  const initialTopic = (initialTopicId ? pack.topics.find(item => item.topicId === initialTopicId) : undefined)
    ?? (initialConceptId ? conceptTopics(pack, initialConceptId)[0] : undefined);
  const [selectedTopic, setSelectedTopic] = useState(initialTopic?.topicId ?? '');
  const [open, setOpen] = useState(() => new Set<string>(initialTopic ? [initialTopic.unitId] : units.length <= 4 ? units.map(unit => unit.unitId) : []));
  const [onlyFrequent, setOnlyFrequent] = useState(false);
  /** Which version of a topic with a pending bill to show; kept across topics so the choice sticks while browsing. */
  const [showEnacted, setShowEnacted] = useState(false);
  const { records, setChecks, progressFailed, progress, stageOf, subjectCounts } = useTopicProgress(pack);
  const topic = pack.topics.find(item => item.topicId === selectedTopic);
  const concept = topic ? conceptOf(topic.topicId) : undefined;
  const reform = topic?.pendingReform;
  const enacted = Boolean(reform && showEnacted);
  /** Text shown for the selected topic: current law, or the bill's "if enacted" version when chosen. */
  const view: PendingReformText & { summary: string } = topic ? { summary: topic.summary, ...(topic.example ? { example: topic.example } : {}), ...(enacted ? reform!.ifEnacted : {}) } : { summary: '' };
  const topicOfConcept = (conceptId: string) => pack.topics.find(item => topicConcepts(pack, item.topicId).some(linked => linked.conceptId === conceptId));
  const related = (direction: 'before' | 'after') => !concept ? [] : pack.links
    .filter(link => link.kind === 'prerequisite' && (direction === 'before' ? link.targetId : link.sourceId) === concept.conceptId)
    .map(link => topicOfConcept(direction === 'before' ? link.sourceId : link.targetId)).filter(item => item !== undefined);
  const before = related('before'), after = related('after');
  const roleOf = (topicId: string) => topicId === selectedTopic ? 'selected' : before.some(item => item.topicId === topicId) ? 'before' : after.some(item => item.topicId === topicId) ? 'after' : undefined;
  const unitRoleOf = (unitId: string) => topic?.unitId === unitId ? 'selected' : before.some(item => item.unitId === unitId) ? 'before' : after.some(item => item.unitId === unitId) ? 'after' : undefined;
  const materials = (topicId: string) => {
    const linked = topicConcepts(pack, topicId);
    return linked.flatMap(item => choices.filter(choice => choice.conceptId === item.conceptId && choice.conceptVersion === item.conceptVersion).map(choice => ({ concept: item, choice })));
  };
  /**
   * More questions on the same topic: the map's uses-case links that are not offered as the main choice (in 簿記論, the
   * draft practice questions). They used to be listed in a separate panel under the map; now they sit with their topic.
   */
  const practice = (topicId: string) => topicConcepts(pack, topicId).flatMap(item => pack.links
    .filter(link => link.kind === 'uses-case' && link.sourceId === item.conceptId && link.sourceVersion === item.conceptVersion
      && !choices.some(choice => choice.materialId === link.targetId))
    .map((link, index) => ({ concept: item, choice: { subjectId: pack.subjectId, conceptId: item.conceptId, conceptVersion: item.conceptVersion,
      materialId: link.targetId, caseVersion: link.targetVersion, label: `練習問題 ${index + 1}` } })));
  const resultOf = (caseVersion: string) => records?.filter(record => record.caseVersion === caseVersion)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0]?.correct;
  const select = (topicId: string) => {
    const unitId = pack.topics.find(item => item.topicId === topicId)?.unitId;
    if (unitId) setOpen(previous => new Set(previous).add(unitId));
    setSelectedTopic(topicId);
    if (window.matchMedia('(max-width: 860px)').matches) requestAnimationFrame(() => document.getElementById('subject-tree-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  const toggle = (unitId: string) => setOpen(previous => { const next = new Set(previous); if (next.has(unitId)) next.delete(unitId); else next.add(unitId); return next; });
  const seen = new Set<string>();
  const frequentCount = pack.topics.filter(item => item.frequency === 'high').length;
  const visible = (item: MapTopic) => !onlyFrequent || item.frequency === 'high';
  const label = subjectLabel ?? '科目';
  const stageBadge = (stage: TopicStage) => <em className={styles.stage} data-stage={stage}>{STAGE_LABELS[stage]}</em>;
  const selectedStage = topic ? stageOf(topic.topicId) : 'none';
  const selectedMaterials = topic ? materials(topic.topicId) : [];
  const selectedPractice = topic ? practice(topic.topicId) : [];

  const tree = () => <ol className={styles.outline} aria-label={`${label}の全体ツリー`}>{units.map((unit, index) => {
    const topics = topicsOf(unit.unitId).filter(visible);
    if (!topics.length) return null;
    const expanded = open.has(unit.unitId);
    const counts = countStages(topicsOf(unit.unitId).map(item => stageOf(item.topicId)));
    return <li key={unit.unitId} id={`tree-${unit.unitId}`} className={styles.unit}>
      <button className={styles.unitHead} aria-expanded={expanded} onClick={() => toggle(unit.unitId)}>
        <span className={styles.unitNo}>{index + 1}</span>
        <span className={styles.unitText}><strong>{unit.label}</strong>
          <span className={styles.unitMeta}><StageBar counts={counts} label={unit.label} decorative /><small>{topicsOf(unit.unitId).length}論点{counts.memorized + counts.understood > 0 && ` ・ 理解${counts.memorized + counts.understood}（うち覚えた${counts.memorized}）`}</small></span></span>
        {!expanded && unitRoleOf(unit.unitId) === 'before' && <em className={styles.relBefore}>← 先に</em>}{!expanded && unitRoleOf(unit.unitId) === 'after' && <em className={styles.relAfter}>次に →</em>}
        <span aria-hidden="true" className={styles.chevron}>{expanded ? '▾' : '▸'}</span></button>
      {expanded && <ul className={styles.topics}>{topics.map(item => {
        const role = roleOf(item.topicId);
        const stage = stageOf(item.topicId);
        return <li key={item.topicId}><button className={styles.topic} data-role={role} data-stage={stage} aria-current={role === 'selected' ? 'true' : undefined}
          aria-label={`${item.label}（${STAGE_LABELS[stage]}）`} onClick={() => select(item.topicId)}>
          <span className={styles.topicLine}><span className={styles.dot} data-stage={stage} aria-hidden="true" /><strong>{item.label}</strong>{item.frequency === 'high' && <em className={styles.hot}>★頻出</em>}
            {stageBadge(stage)}
            {role === 'before' && <em className={styles.relBefore}>← 先に</em>}{role === 'after' && <em className={styles.relAfter}>次に →</em>}</span>
          <span className={styles.summary}>{glossText(item.summary, pack.glossary, new Set(), styles.gloss)}</span></button></li>;
      })}</ul>}
    </li>;
  })}</ol>;

  return <section className={styles.view} aria-label="科目の全体ツリー" data-subject={pack.subjectId}>
    <div className={styles.header}>
      <div><p className={styles.kicker}>科目の全体像と、あなたの進み具合</p><h2 data-tree-root>{label}</h2>
        <p className={styles.lead}>{units.length}分野・{pack.topics.length}論点のツリーです。分野をタップすると論点が開きます。論点を選ぶと、説明と「先に知るとよい論点」「次につながる論点」が出ます。</p></div>
      <div className={styles.controls}>
        <label className={styles.filter}><input type="checkbox" checked={onlyFrequent} onChange={event => setOnlyFrequent(event.target.checked)} /> ★頻出だけ（{frequentCount}論点）</label>
      </div>
    </div>
    <div className={styles.progress} aria-label="この科目の進み具合">
      <StageBar counts={subjectCounts} label={`${label}全体`} />
      <CountsText records={records} progressFailed={progressFailed} counts={subjectCounts} topicCount={pack.topics.length} />
      <Legend />
      <p className={styles.define}>理解した＝確認問題に正解した。覚えた＝復習カード（1日・3日・7日後）で3回続けて思い出せた。</p>
    </div>
    {records && <ReviewCards pack={pack} progress={progress} disabled={disabled} onChecked={check => setChecks(previous => [...previous, check])} onOpen={select} />}
    <div className={styles.layout}>
      {tree()}
      {topic ? <aside id="subject-tree-detail" className={styles.detail} data-stage={selectedStage} aria-live="polite" aria-label="選んだ論点の説明">
        <p className={styles.kicker}>{units.find(unit => unit.unitId === topic.unitId)?.label}{topic.frequency && <> ・ {frequencyLabel[topic.frequency]}</>}</p>
        <h3>{topic.label}</h3>
        <p className={styles.status}>{stageBadge(selectedStage)}<span>{nextStep[selectedStage]}{selectedStage === 'understood' && ` いまの復習：${progress.get(topic.topicId)?.step ?? 0} / ${MEMORIZED_STEP}回。`}</span></p>
        {reform && <div className={styles.reform}>
          <p className={styles.reformTitle}>{reform.title}</p>
          <div className={styles.reformSwitch} role="group" aria-label="表示する内容">
            <button type="button" aria-pressed={!enacted} onClick={() => setShowEnacted(false)}>現行の制度</button>
            <button type="button" aria-pressed={enacted} onClick={() => setShowEnacted(true)}>成立した場合（未確定）</button>
          </div>
          <p className={styles.reformStatus}>{enacted ? '法案が成立した場合の内容です。まだ決まっていません。' : 'いまの法律の内容です。'}{reform.status}</p>
        </div>}
        <p className={styles.oneLine}>{glossText(view.summary, pack.glossary, seen, styles.gloss)}</p>
        {view.example && <div className={styles.example}><p>具体的にいうと</p><div>{glossText(view.example, pack.glossary, seen, styles.gloss)}</div></div>}
        {concept ? <dl>
          <dt>何か</dt><dd>{glossText(view.definition ?? concept.definition, pack.glossary, seen, styles.gloss)}</dd>
          <dt>なぜ大事か</dt><dd>{glossText(view.purpose ?? concept.purpose, pack.glossary, seen, styles.gloss)}</dd>
          <dt>間違えやすい点</dt><dd>{glossText(view.misconception ?? concept.misconception, pack.glossary, seen, styles.gloss)}</dd>
          <dt>試験での出方</dt><dd>{glossText(view.examUse ?? concept.examUse, pack.glossary, seen, styles.gloss)}</dd>
        </dl> : <p className={styles.none}>この論点に対応する考え方は未確認です。</p>}
        <div className={styles.links}>
          <p>先に知ると理解しやすい</p>{before.length ? before.map(item => <button key={item.topicId} className={styles.chipBefore} onClick={() => select(item.topicId)}>← {item.label}</button>) : <span className={styles.none}>この論点が出発点です</span>}
          <p>次につながる</p>{after.length ? after.map(item => <button key={item.topicId} className={styles.chipAfter} onClick={() => select(item.topicId)}>{item.label} →</button>) : <span className={styles.none}>ここから先の論点は設定していません</span>}
        </div>
        <div className={styles.actions}>{selectedMaterials.length ? selectedMaterials.map(({ concept: linked, choice }) => <button key={`${linked.conceptId}:${choice.materialId}`} disabled={disabled} onClick={() => onStart(linked, choice)}>
          {selectedMaterials.length > 1 ? `問題で確かめる：${choice.label} →` : '理解を問題で確かめる →'}</button>)
          : !selectedPractice.length && <span className={styles.none}>この論点の問題はまだありません</span>}</div>
        {selectedPractice.length > 0 && <details className={styles.practice}><summary>練習問題（{selectedPractice.length}問）</summary>
          <p>同じ論点の別の問題です。正解すると、この論点も「理解した」になります。</p>
          <ul>{selectedPractice.map(({ concept: linked, choice }) => { const result = resultOf(choice.caseVersion);
            return <li key={choice.materialId}><button disabled={disabled} onClick={() => onStart(linked, choice)}>{choice.label} →</button>
              {result !== undefined && <em data-stage={result ? 'understood' : 'retry'}>{result ? '正解' : 'もう一度'}</em>}</li>; })}</ul>
        </details>}
      </aside> : <aside className={styles.detail}><p className={styles.kicker}>使い方</p><h3>まず全体を眺めましょう</h3>
        <ol className={styles.howto}><li>気になる分野の見出しをタップ</li><li>論点を選ぶと、ここに「何か・なぜ大事か・具体例」が出ます</li><li>確認問題に正解すると青（理解した）、復習カードで3回続けて思い出せると緑（覚えた）になります</li></ol></aside>}
    </div>
    <p className={styles.note}>AI作成の原稿です（専門家の確認前）。★頻出は本試験でよく出る論点の目安で、公式の情報ではありません。色は確認問題の解答から数えた練習の記録で、合格や習熟の判定ではありません。</p>
  </section>;
}
