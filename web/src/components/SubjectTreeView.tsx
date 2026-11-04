'use client';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MapConcept, MapTopic, SubjectMapPack } from '../domain/subject-map';
import { topicConcepts } from '../domain/subject-map';
import styles from './SubjectTreeView.module.css';

type Choice = { subjectId: string; conceptId: string; conceptVersion: string; materialId: string; caseVersion: string; label: string };
type Props = { pack: SubjectMapPack; subjectLabel?: string; choices: readonly Choice[]; disabled: boolean; onStart: (concept: MapConcept, material: Choice) => void };
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
const palette = ['#147d72', '#2f6fb3', '#a15c00', '#7b4fb0', '#b23a5b', '#3f7d2c', '#9a6b12', '#356a8a'];
/** Positions on an ellipse in a 1000×700 box, starting at the top and going clockwise. */
const ring = (count: number, rx: number, ry: number, minX = 0) => Array.from({ length: count }, (_, index) => {
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(count, 1);
  return { x: Math.min(1000 - minX, Math.max(minX, 500 + rx * Math.cos(angle))), y: 350 + ry * Math.sin(angle) };
});
/** True on narrow (phone) screens, where the map is taller than wide and needs a wider, taller ring. */
function useCompact() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 600px)');
    const update = () => setCompact(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}
const curve = (from: { x: number; y: number }, to: { x: number; y: number }, bend = 0.18) => {
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
  return `M${from.x},${from.y} Q${mx - (to.y - from.y) * bend},${my + (to.x - from.x) * bend} ${to.x},${to.y}`;
};
const at = (point: { x: number; y: number }) => ({ left: `${point.x / 10}%`, top: `${point.y / 7}%` });

/**
 * Whole-subject view with two layouts: a brain map (subject → fields → topics, one field at a time)
 * and a collapsible outline. Both share one detail pane: what it is, why it matters, and which
 * topics come before/after it.
 */
export function SubjectTreeView({ pack, subjectLabel, choices, disabled, onStart }: Props) {
  const units = useMemo(() => [...pack.units].sort((a, b) => a.order - b.order), [pack.units]);
  const topicsOf = (unitId: string) => pack.topics.filter(topic => topic.unitId === unitId).sort((a, b) => a.order - b.order);
  const conceptOf = (topicId: string) => topicConcepts(pack, topicId)[0];
  const [layout, setLayout] = useState<'map' | 'list'>('map');
  const compact = useCompact();
  const shape = compact ? { rx: 390, ry: 295, minX: 150 } : { rx: 350, ry: 260, minX: 90 };
  const [selectedTopic, setSelectedTopic] = useState('');
  const [focusUnit, setFocusUnit] = useState('');
  const [open, setOpen] = useState(() => new Set<string>());
  const [onlyFrequent, setOnlyFrequent] = useState(false);
  const topic = pack.topics.find(item => item.topicId === selectedTopic);
  const concept = topic ? conceptOf(topic.topicId) : undefined;
  const topicOfConcept = (conceptId: string) => pack.topics.find(item => conceptOf(item.topicId)?.conceptId === conceptId);
  const related = (direction: 'before' | 'after') => !concept ? [] : pack.links
    .filter(link => link.kind === 'prerequisite' && (direction === 'before' ? link.targetId : link.sourceId) === concept.conceptId)
    .map(link => topicOfConcept(direction === 'before' ? link.sourceId : link.targetId)).filter(item => item !== undefined);
  const before = related('before'), after = related('after');
  const roleOf = (topicId: string) => topicId === selectedTopic ? 'selected' : before.some(item => item.topicId === topicId) ? 'before' : after.some(item => item.topicId === topicId) ? 'after' : undefined;
  const unitRoleOf = (unitId: string) => topic?.unitId === unitId ? 'selected' : before.some(item => item.unitId === unitId) ? 'before' : after.some(item => item.unitId === unitId) ? 'after' : undefined;
  const materials = (item: MapConcept | undefined) => !item ? [] : choices.filter(choice => choice.conceptId === item.conceptId && choice.conceptVersion === item.conceptVersion);
  const select = (topicId: string) => {
    const unitId = pack.topics.find(item => item.topicId === topicId)?.unitId;
    if (unitId) { setOpen(previous => new Set(previous).add(unitId)); setFocusUnit(unitId); }
    setSelectedTopic(topicId);
    if (layout === 'map') requestAnimationFrame(() => document.getElementById('subject-tree-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  const toggle = (unitId: string) => setOpen(previous => { const next = new Set(previous); if (next.has(unitId)) next.delete(unitId); else next.add(unitId); return next; });
  const seen = new Set<string>();
  const frequentCount = pack.topics.filter(item => item.frequency === 'high').length;
  const visible = (item: MapTopic) => !onlyFrequent || item.frequency === 'high';
  const colorOf = (unitId: string) => palette[Math.max(units.findIndex(unit => unit.unitId === unitId), 0) % palette.length];

  const map = () => {
    const unit = units.find(item => item.unitId === focusUnit);
    if (!unit) {
      const points = ring(units.length, shape.rx, shape.ry, shape.minX);
      return <div className={styles.map} aria-label={`${subjectLabel ?? '科目'}のブレインマップ`}>
        <svg viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
          {points.map((point, index) => <path key={units[index].unitId} d={curve({ x: 500, y: 350 }, point)} stroke={palette[index % palette.length]} />)}
        </svg>
        <div className={styles.hub} style={at({ x: 500, y: 350 })}><strong>{subjectLabel ?? '科目'}</strong><small>{units.length}分野・{pack.topics.length}論点</small></div>
        {units.map((item, index) => {
          const topics = topicsOf(item.unitId);
          return <button key={item.unitId} className={styles.unitNode} data-role={unitRoleOf(item.unitId)} style={{ ...at(points[index]), borderColor: palette[index % palette.length] }}
            onClick={() => setFocusUnit(item.unitId)} aria-label={`${item.label}（${topics.length}論点）を開く`}>
            <span className={styles.unitNo} style={{ background: palette[index % palette.length] }}>{index + 1}</span>
            <strong>{item.label}</strong><small>{topics.length}論点{topics.some(t => t.frequency === 'high') && ` ・ ★${topics.filter(t => t.frequency === 'high').length}`}</small></button>;
        })}
      </div>;
    }
    const index = units.indexOf(unit), color = palette[index % palette.length];
    const topics = topicsOf(unit.unitId).filter(visible);
    const points = ring(topics.length, shape.rx, shape.ry, shape.minX);
    const position = new Map(topics.map((item, i) => [conceptOf(item.topicId)?.conceptId, points[i]]));
    const inner = pack.links.filter(link => link.kind === 'prerequisite' && position.has(link.sourceId) && position.has(link.targetId));
    return <><button className={styles.back} onClick={() => setFocusUnit('')}>← {subjectLabel ?? '科目'}の全体へ</button><div className={styles.map} aria-label={`${unit.label}のブレインマップ`}>
      <svg viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
        {points.map((point, i) => <path key={topics[i].topicId} d={curve({ x: 500, y: 350 }, point, 0.12)} stroke={color} />)}
        {inner.map(link => {
          const source = topicOfConcept(link.sourceId)?.topicId, target = topicOfConcept(link.targetId)?.topicId;
          const lit = source === selectedTopic ? 'after' : target === selectedTopic ? 'before' : undefined;
          return <path key={`${link.sourceId}-${link.targetId}`} className={styles.prereq} data-role={lit} d={curve(position.get(link.sourceId)!, position.get(link.targetId)!, 0.3)} />;
        })}
      </svg>
      <div className={styles.hub} style={{ ...at({ x: 500, y: 350 }), borderColor: color }}><span className={styles.unitNo} style={{ background: color }}>{index + 1}</span><strong>{unit.label}</strong><small>{topics.length}論点</small></div>
      {topics.map((item, i) => {
        const role = roleOf(item.topicId);
        return <button key={item.topicId} className={styles.topicNode} data-role={role} aria-current={role === 'selected' ? 'true' : undefined} style={{ ...at(points[i]), borderColor: role ? undefined : color }}
          onClick={() => select(item.topicId)}>{item.frequency === 'high' && <em className={styles.hot}>★頻出</em>}<strong>{item.label}</strong></button>;
      })}
    </div>
    <nav className={styles.others} aria-label="ほかの分野"><span>ほかの分野へ：</span>{units.filter(item => item.unitId !== unit.unitId).map(item => <button key={item.unitId} data-role={unitRoleOf(item.unitId)}
      style={{ borderColor: colorOf(item.unitId) }} onClick={() => setFocusUnit(item.unitId)}>{item.label}</button>)}</nav></>;
  };

  const list = () => <ol className={styles.outline}>{units.map((unit, index) => {
    const topics = topicsOf(unit.unitId).filter(visible);
    if (!topics.length) return null;
    const expanded = open.has(unit.unitId);
    return <li key={unit.unitId} id={`tree-${unit.unitId}`} className={styles.unit}>
      <button className={styles.unitHead} aria-expanded={expanded} onClick={() => toggle(unit.unitId)}>
        <span className={styles.unitNo} style={{ background: palette[index % palette.length] }}>{index + 1}</span><strong>{unit.label}</strong>
        {!expanded && unitRoleOf(unit.unitId) === 'before' && <em className={styles.relBefore}>← 先に</em>}{!expanded && unitRoleOf(unit.unitId) === 'after' && <em className={styles.relAfter}>次に →</em>}
        <small>{topics.length}論点</small><span aria-hidden="true" className={styles.chevron}>{expanded ? '▾' : '▸'}</span></button>
      {expanded && <ul className={styles.topics}>{topics.map(item => {
        const role = roleOf(item.topicId);
        const hasQuestion = materials(conceptOf(item.topicId)).length > 0;
        return <li key={item.topicId}><button className={styles.topic} data-role={role} aria-current={role === 'selected' ? 'true' : undefined} onClick={() => select(item.topicId)}>
          <span className={styles.topicLine}><strong>{item.label}</strong>{item.frequency === 'high' && <em className={styles.hot}>★頻出</em>}{hasQuestion && <em className={styles.q}>問題あり</em>}
            {role === 'before' && <em className={styles.relBefore}>← 先に</em>}{role === 'after' && <em className={styles.relAfter}>次に →</em>}</span>
          <span className={styles.summary}>{glossText(item.summary, pack.glossary, new Set(), styles.gloss)}</span></button></li>;
      })}</ul>}
    </li>;
  })}</ol>;

  return <section className={styles.view} aria-label="科目の全体ツリー">
    <div className={styles.header}>
      <div><p className={styles.kicker}>科目の全体像</p><h2>全体ツリー</h2>
        <p className={styles.lead}>{units.length}分野・{pack.topics.length}論点。{layout === 'map' ? '分野をタップすると論点が広がります。論点を選ぶと、先に知るとよい論点（青）と次につながる論点（オレンジ）が光ります。' : '分野をタップすると開きます。論点を選ぶと、前後につながる論点が色で光ります。'}</p></div>
      <div className={styles.controls}>
        <div className={styles.switch} role="group" aria-label="表示のしかた">
          <button aria-pressed={layout === 'map'} onClick={() => setLayout('map')}>マップ</button>
          <button aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>リスト</button>
        </div>
        <label className={styles.filter}><input type="checkbox" checked={onlyFrequent} onChange={event => setOnlyFrequent(event.target.checked)} /> ★頻出だけ（{frequentCount}論点）</label>
      </div>
    </div>
    <div className={styles.legend} aria-hidden="true"><span className={styles.swBefore} />先に知ると理解しやすい<span className={styles.swSelected} />選んだ論点<span className={styles.swAfter} />次につながる</div>
    <div className={styles.layout} data-layout={layout}>
      {layout === 'map' ? map() : list()}
      {topic && concept ? <aside id="subject-tree-detail" className={styles.detail} aria-live="polite">
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
      </aside> : <aside className={styles.detail}><p className={styles.kicker}>使い方</p><h3>まず全体を眺めましょう</h3>
        <ol className={styles.howto}><li>{layout === 'map' ? '気になる分野の丸をタップ' : '気になる分野の見出しをタップ'}</li><li>論点を選ぶと、ここに「何か・なぜ大事か・具体例」が出ます</li><li>青は先に、オレンジは次に学ぶとよい論点です</li></ol></aside>}
    </div>
    <p className={styles.note}>AI作成の原稿です（専門家の確認前）。★頻出は本試験でよく出る論点の目安で、公式の情報ではありません。</p>
  </section>;
}
