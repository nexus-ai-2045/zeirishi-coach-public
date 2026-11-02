'use client';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { MapConcept, SubjectMapPack } from '../domain/subject-map';
import { topicConcepts } from '../domain/subject-map';
import styles from './SubjectTreeView.module.css';

type Choice = { subjectId: string; conceptId: string; conceptVersion: string; materialId: string; caseVersion: string; label: string };
type Props = { pack: SubjectMapPack; choices: readonly Choice[]; disabled: boolean; onStart: (concept: MapConcept, material: Choice) => void };
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

/**
 * Whole-subject outline (field → topic) with a detail pane: what it is, why it matters,
 * and which topics come before/after it. Overview first, detail on demand.
 */
export function SubjectTreeView({ pack, choices, disabled, onStart }: Props) {
  const units = useMemo(() => [...pack.units].sort((a, b) => a.order - b.order), [pack.units]);
  const topicsOf = (unitId: string) => pack.topics.filter(topic => topic.unitId === unitId).sort((a, b) => a.order - b.order);
  const conceptOf = (topicId: string) => topicConcepts(pack, topicId)[0];
  const [selectedTopic, setSelectedTopic] = useState(pack.topics[0]?.topicId ?? '');
  const [open, setOpen] = useState(() => new Set(units.map(unit => unit.unitId)));
  const [onlyFrequent, setOnlyFrequent] = useState(false);
  const topic = pack.topics.find(item => item.topicId === selectedTopic);
  const concept = topic ? conceptOf(topic.topicId) : undefined;
  const topicOfConcept = (conceptId: string) => pack.topics.find(item => conceptOf(item.topicId)?.conceptId === conceptId);
  const related = (direction: 'before' | 'after') => !concept ? [] : pack.links
    .filter(link => link.kind === 'prerequisite' && (direction === 'before' ? link.targetId : link.sourceId) === concept.conceptId)
    .map(link => topicOfConcept(direction === 'before' ? link.sourceId : link.targetId)).filter(item => item !== undefined);
  const before = related('before'), after = related('after');
  const roleOf = (topicId: string) => topicId === selectedTopic ? 'selected' : before.some(item => item.topicId === topicId) ? 'before' : after.some(item => item.topicId === topicId) ? 'after' : undefined;
  const materials = (item: MapConcept | undefined) => !item ? [] : choices.filter(choice => choice.conceptId === item.conceptId && choice.conceptVersion === item.conceptVersion);
  const select = (topicId: string) => {
    const unitId = pack.topics.find(item => item.topicId === topicId)?.unitId;
    if (unitId) setOpen(previous => new Set(previous).add(unitId));
    setSelectedTopic(topicId);
  };
  const toggle = (unitId: string) => setOpen(previous => { const next = new Set(previous); if (next.has(unitId)) next.delete(unitId); else next.add(unitId); return next; });
  const seen = new Set<string>();
  const frequentCount = pack.topics.filter(item => item.frequency === 'high').length;

  return <section className={styles.view} aria-label="科目の全体ツリー">
    <div className={styles.header}>
      <div><p className={styles.kicker}>科目の全体像</p><h2>全体ツリー</h2>
        <p className={styles.lead}>{units.length}分野・{pack.topics.length}論点。論点を選ぶと「何か・なぜ大事か」と、前後につながる論点が色で光ります。</p></div>
      <label className={styles.filter}><input type="checkbox" checked={onlyFrequent} onChange={event => setOnlyFrequent(event.target.checked)} /> ★頻出だけ表示（{frequentCount}論点）</label>
    </div>
    <nav className={styles.overview} aria-label="分野の一覧">{units.map((unit, index) => <a key={unit.unitId} href={`#tree-${unit.unitId}`}
      onClick={() => setOpen(previous => new Set(previous).add(unit.unitId))}><span>{index + 1}</span>{unit.label}<small>{topicsOf(unit.unitId).length}</small></a>)}</nav>
    <div className={styles.legend} aria-hidden="true"><span className={styles.swBefore} />先に知ると理解しやすい<span className={styles.swSelected} />選んだ論点<span className={styles.swAfter} />次につながる</div>
    <div className={styles.layout}>
      <ol className={styles.outline}>{units.map((unit, index) => {
        const topics = topicsOf(unit.unitId).filter(item => !onlyFrequent || item.frequency === 'high');
        if (!topics.length) return null;
        const expanded = open.has(unit.unitId);
        return <li key={unit.unitId} id={`tree-${unit.unitId}`} className={styles.unit}>
          <button className={styles.unitHead} aria-expanded={expanded} onClick={() => toggle(unit.unitId)}>
            <span className={styles.unitNo}>{index + 1}</span><strong>{unit.label}</strong><small>{topics.length}論点</small><span aria-hidden="true" className={styles.chevron}>{expanded ? '▾' : '▸'}</span></button>
          {expanded && <ul className={styles.topics}>{topics.map(item => {
            const role = roleOf(item.topicId);
            const hasQuestion = materials(conceptOf(item.topicId)).length > 0;
            return <li key={item.topicId}><button className={styles.topic} data-role={role} aria-current={role === 'selected' ? 'true' : undefined} onClick={() => select(item.topicId)}>
              <span className={styles.topicLine}><strong>{item.label}</strong>{item.frequency === 'high' && <em className={styles.hot}>★頻出</em>}{hasQuestion && <em className={styles.q}>問題あり</em>}
                {role === 'before' && <em className={styles.relBefore}>← 先に</em>}{role === 'after' && <em className={styles.relAfter}>次に →</em>}</span>
              <span className={styles.summary}>{glossText(item.summary, pack.glossary, new Set(), styles.gloss)}</span></button></li>;
          })}</ul>}
        </li>;
      })}</ol>
      {topic && concept && <aside className={styles.detail} aria-live="polite">
        <p className={styles.kicker}>{units.find(unit => unit.unitId === topic.unitId)?.label}{topic.frequency && <> ・ {frequencyLabel[topic.frequency]}</>}</p>
        <h3>{topic.label}</h3>
        <p className={styles.oneLine}>{glossText(topic.summary, pack.glossary, seen, styles.gloss)}</p>
        {topic.example && <div className={styles.example}><p>具体的にいうと</p><div>{glossText(topic.example, pack.glossary, seen, styles.gloss)}</div></div>}
        <dl>
          <dt>何か</dt><dd>{glossText(concept.definition, pack.glossary, seen, styles.gloss)}</dd>
          <dt>なぜ大事か</dt><dd>{glossText(concept.purpose, pack.glossary, seen, styles.gloss)}</dd>
          <dt>間違えやすい点</dt><dd>{glossText(concept.misconception, pack.glossary, seen, styles.gloss)}</dd>
          <dt>試験での出方</dt><dd>{glossText(concept.examUse, pack.glossary, seen, styles.gloss)}</dd>
        </dl>
        <div className={styles.links}>
          <p>先に知ると理解しやすい</p>{before.length ? before.map(item => <button key={item.topicId} className={styles.chipBefore} onClick={() => select(item.topicId)}>← {item.label}</button>) : <span className={styles.none}>この論点が出発点です</span>}
          <p>次につながる</p>{after.length ? after.map(item => <button key={item.topicId} className={styles.chipAfter} onClick={() => select(item.topicId)}>{item.label} →</button>) : <span className={styles.none}>ここから先の論点は設定していません</span>}
        </div>
        <div className={styles.actions}>{materials(concept).length ? materials(concept).map(choice => <button key={choice.materialId} disabled={disabled} onClick={() => onStart(concept, choice)}>理解を問題で確かめる →</button>)
          : <span className={styles.none}>この論点の問題はまだありません</span>}</div>
      </aside>}
    </div>
    <p className={styles.note}>AI作成の原稿です（専門家の確認前）。★頻出は本試験でよく出る論点の目安で、公式の情報ではありません。</p>
  </section>;
}
