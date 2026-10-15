'use client';

import { useState } from 'react';
import Image from 'next/image';
import styles from './CafeWorkspace.module.css';
import visual from './BookkeepingIntro.module.css';
import { BookkeepingConceptMap, type BookkeepingConceptIndex } from './BookkeepingConceptMap';
import { BookkeepingOverviewDiagram } from './BookkeepingOverviewDiagram';
import { conceptTopics, type SubjectMapPack } from '../domain/subject-map';
import { availableCasesForConcept, resolveTopicConcepts, type CaseChoice } from '../domain/bookkeeping-overview';

const concepts = [
  { id: 'cash-is-not-profit', title: 'お金と利益は別', purpose: '現金が増えた理由を区別するため。', principle: '借りたお金は、儲けではありません。現金という資産と、返す義務である負債が同時に増えます。', question: '銀行から10万円借りたら、10万円儲かったと言えるでしょうか？' },
  { id: 'double-entry', title: '取引には二つの面がある', purpose: '何が増え、何が減ったかを漏れなく記録するため。', principle: '借入は現金と負債の増加。現金で備品を買うと、現金が減って備品が増えます。複式簿記はこの対応を借方・貸方に記録します。借方・貸方は「良い・悪い」ではなく、記録する左右の位置です。', question: '備品を買うと、手元の財産は全部なくなるのでしょうか？' },
  { id: 'prepaid-expenses', title: '支払日と費用の期間は別', purpose: 'その期間にどれだけ儲かったかを確かめるため。', principle: '利益は収益から費用を引いて考えます。支払った額をすべて、その年の費用にするとは限りません。翌期に受けるサービス分は、前払費用という資産として残します。', question: '12月から1年間の保険料を払ったら、3月決算までに使ったのは何か月分でしょうか？' },
] as const;

type Props = {
  onStart?: (choice: CaseChoice) => void;
  disabled?: boolean;
  subjectMap?: SubjectMapPack;
  initialConceptId?: string;
  initialTopicId?: string | null;
  availableCases?: readonly CaseChoice[];
};

const conceptIds = [concepts[0].id, concepts[1].id, concepts[2].id] as const;
const introIndex = (conceptId: string | null | undefined) => conceptIds.findIndex(id => id === conceptId);

export function BookkeepingIntro({ onStart, disabled = false, subjectMap, initialConceptId, initialTopicId = null, availableCases = [] }: Props) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<BookkeepingConceptIndex>(() => {
    const direct = introIndex(initialConceptId);
    if (direct >= 0) return direct as BookkeepingConceptIndex;
    const related = introIndex(initialTopicId && subjectMap ? resolveTopicConcepts(subjectMap, initialTopicId, conceptIds).introConceptId : null);
    return related >= 0 ? related as BookkeepingConceptIndex : 2;
  });
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(initialTopicId);
  const [transaction, setTransaction] = useState<'before' | 'borrow' | 'equipment'>('before');
  const concept = concepts[selected];
  const mapConcept = subjectMap?.concepts.find(item => item.conceptId === concept.id);
  const conceptTitle = mapConcept?.label ?? concept.title;
  const conceptPurpose = mapConcept?.purpose ?? concept.purpose;
  const topic = subjectMap?.topics.find(item => item.topicId === selectedTopicId);
  const topicResolution = topic && subjectMap ? resolveTopicConcepts(subjectMap, topic.topicId, conceptIds) : null;
  const unconnectedTopic = Boolean(topicResolution?.unconnected);
  const introApplies = !topicResolution || topicResolution.introConceptId !== null;
  const otherConcepts = topicResolution?.otherConcepts ?? [];
  const relatedTopics = subjectMap ? conceptTopics(subjectMap, conceptIds[selected]) : [];
  const availableCase = availableCasesForConcept(subjectMap, availableCases, conceptIds[selected]).find(choice => choice.materialId === 'cafe-prepaid');
  const caseConceptIds = subjectMap ? subjectMap.concepts.filter(item => availableCasesForConcept(subjectMap, availableCases, item.conceptId).length > 0).map(item => item.conceptId) : [];
  const selectTopic = (topicId: string | null) => {
    setSelectedTopicId(topicId);
    const index = introIndex(topicId && subjectMap ? resolveTopicConcepts(subjectMap, topicId, conceptIds).introConceptId : null);
    if (index >= 0) setSelected(index as BookkeepingConceptIndex);
  };
  const cash = transaction === 'before' ? 0 : transaction === 'borrow' ? 10 : 7;
  const equipment = transaction === 'equipment' ? 3 : 0;
  const debt = transaction === 'before' ? 0 : 10;
  return <section className={visual.intro} aria-label="簿記のコア概念">
    <h2>簿記の全体像をつかむ</h2>
    {!open ? <button onClick={() => setOpen(true)}>コア概念を開く</button> : <>
      <aside className={visual.overview} aria-label="簿記はどういう仕組み？">
        <span className={visual.overviewLabel}>簿記はどういう仕組み？</span>
        <strong>商売の出来事を、二つの見方で説明する。</strong>
        <p>簿記は、商売の出来事を記録して「今どんな財産と返済義務があるか」と「一定期間にどれだけ儲かったか」を説明する仕組みです。</p>
      </aside>
      <BookkeepingOverviewDiagram />
      {onStart && <>
        <div className={visual.featuredConcept}><span>今回のコア概念</span><strong>{subjectMap?.concepts.find(item => item.conceptId === 'prepaid-expenses')?.label ?? concepts[2].title}</strong><p>支払った額 ≠ 当期の費用</p><small>費用は、お金を払った日ではなく、サービスを受ける期間から考えます。</small></div>
        <ol className={visual.missionRoute} aria-label="今日の学習ルート"><li aria-current="step"><span>1</span><strong>概念を知る</strong></li><li><span>2</span><strong>相談で試す</strong></li><li><span>3</span><strong>自分の言葉で説明する</strong></li></ol>
      </>}
      <h3 className={visual.deepenTitle}>コア概念のつながりを見る</h3>
      <BookkeepingConceptMap
        conceptIds={conceptIds}
        conceptTitles={concepts.map(item => subjectMap?.concepts.find(mapped => mapped.conceptId === item.id)?.label ?? item.title) as [string, string, string]}
        selected={selected}
        onSelect={index => { setSelected(index); setSelectedTopicId(null); }}
        subjectMap={subjectMap}
        selectedTopicId={selectedTopicId}
        onSelectTopic={selectTopic}
        availableCaseId={availableCase?.materialId}
        availableCaseTitle={availableCase?.label}
        caseConceptIds={caseConceptIds}
      />
      {topic && <p className={visual.topicContext}>選択中の論点：<strong>{topic.label}</strong>。{unconnectedTopic ? '対応する考え方と教材は確認中です。' : introApplies ? `下の説明は「${conceptTitle}」の考え方です。` : 'この論点につながる考え方の説明を下に示します。'}</p>}
      {onStart && selected === 2 && availableCase && introApplies && <>
        <section className={visual.casePreview} aria-label="次の相談ケース">
          <Image src="/images/cafe-consultation.png" alt="カフェのカウンターに置かれた帳簿と書類のイメージ" width={880} height={560} sizes="(max-width: 760px) 100vw, 640px" priority />
          <div><p>次のミッション</p><h3>{availableCase.label}</h3><button className={styles.primary} disabled={disabled} onClick={() => onStart(availableCase)}>この考え方を相談で試す →</button></div>
        </section>
      </>}
      {introApplies && <section aria-live="polite" aria-label="選んだ概念の説明">
        <h3>{conceptTitle}</h3><p>{conceptPurpose}</p>
        {subjectMap && <p className={visual.relatedSummary}>関連論点：{relatedTopics.length ? relatedTopics.map(item => item.label).join(' ／ ') : '接続未確認・準備中'}</p>}
        {selected < 2 ? <>
          <ol className={visual.journey} aria-label="この体験の現在地"><li aria-current={transaction === 'before' ? 'step' : undefined}>1 疑問を持つ</li><li aria-current={transaction === 'borrow' ? 'step' : undefined}>2 取引を動かす</li><li aria-current={transaction === 'equipment' ? 'step' : undefined}>3 変化を振り返る</li></ol>
          <p>架空のお店を動かしてみましょう。ほかの取引・利息・減価償却は省略した例です。</p>
          <div className={visual.stage}>
            <p className={visual.question}>{transaction === 'equipment' ? '現金は減った。でも、財産は？' : concept.question}</p>
            <p className={visual.subtitle}>同じ目盛りで比べる · 棒全体が10万円</p>
            <div className={visual.diagram} role="img" aria-label={`資産：現金${cash}万円と備品${equipment}万円。負債：借入金${debt}万円。利益0円。`}>
              <div className={visual.side}><strong>持っているもの（資産）</strong><div className={visual.track}><span className={visual.cash} style={{width: `${cash * 10}%`}}>{cash > 0 && `${cash}万円`}</span><span className={visual.equipment} style={{width: `${equipment * 10}%`}}>{equipment > 0 && `${equipment}万円`}</span></div><div className={visual.legend}><span><i style={{background:'#0b7e74'}} />現金</span><span><i style={{background:'#426b91'}} />備品</span></div></div>
              <div className={visual.side}><strong>返す義務（負債）</strong><div className={visual.track}><span className={visual.debt} style={{width: `${debt * 10}%`}}>{debt > 0 && `${debt}万円`}</span></div><div className={visual.legend}><span><i style={{background:'#a56227'}} />借入金</span></div></div>
            </div>
            <div className={visual.profit}><span>この取引による利益</span><b>0円</b></div>
          </div>
          <div className={styles.actions} role="group" aria-label="取引シミュレーション">
            <button aria-pressed={transaction === 'before'} onClick={() => setTransaction('before')}>取引前</button>
            <button aria-pressed={transaction === 'borrow'} onClick={() => setTransaction('borrow')}>10万円を借りる</button>
            <button aria-pressed={transaction === 'equipment'} onClick={() => setTransaction('equipment')}>借りたお金で備品を3万円購入</button>
          </div>
          <dl className={visual.numbers} aria-label="取引後の状態">
            <div><dt>現金</dt><dd>{transaction === 'before' ? 0 : transaction === 'borrow' ? 10 : 7}万円</dd></div>
            <div><dt>備品</dt><dd>{transaction === 'equipment' ? 3 : 0}万円</dd></div>
            <div><dt>借入金（返す義務）</dt><dd>{transaction === 'before' ? 0 : 10}万円</dd></div>
            <div><dt>この取引による利益</dt><dd>0円</dd></div>
          </dl>
          <p>{transaction === 'equipment' ? '現金7万円＋備品3万円＝資産10万円。形が変わっても、返す義務10万円は残っています。' : transaction === 'borrow' ? '現金は増えましたが、同じ額の返す義務も増えました。借入そのものは利益になりません。' : '取引前はすべて0。この例は出資なしで借入から始めます。'}</p>
        </> : <div className={visual.periodConcept}>
          <blockquote className={styles.quote}>{concept.question}</blockquote>
          <p>費用を考えるときは、支払った日ではなく、サービスを受ける期間を見ます。</p>
          <div className={visual.periodFlow} aria-label="支払いと費用の期間を分ける図">
            <div><span>① 支払う</span><strong>先にお金が出る</strong></div>
            <span aria-hidden="true">→</span>
            <div><span>② サービスを受ける</span><strong>使った期間だけ費用</strong></div>
            <span aria-hidden="true">→</span>
            <div><span>③ 決算で分ける</span><strong>未使用分は次へ残す</strong></div>
          </div>
          <p className={visual.periodHint}>相談では契約期間と決算日を見比べます。具体的な配分は、あなたの判断後に図で確かめられます。</p>
        </div>}
        <div className={visual.summary}><strong>{selected < 2 ? '現金が増える ≠ 儲かる' : '支払った額 ≠ 当期の費用'}</strong><p>{concept.principle}</p></div>
      </section>}
      {otherConcepts.length > 0 && <section aria-live="polite" aria-label="論点につながる考え方の説明">
        {otherConcepts.map(item => {
          const cases = availableCasesForConcept(subjectMap, availableCases, item.conceptId);
          return <article key={item.conceptId}>
            <h3>{item.label}</h3><p>{item.purpose}</p><p>{item.definition}</p>
            {!cases.length ? <p>相談教材は準備中です。考え方は自由に見られます。</p>
              : onStart ? <div className={styles.actions}>{cases.map(choice => <button key={choice.materialId} className={styles.primary} disabled={disabled} onClick={() => onStart(choice)}>「{choice.label}」を相談で試す →</button>)}</div>
              : <p>相談教材があります。学習地図から開始できます。</p>}
          </article>;
        })}
      </section>}
      <div className={styles.actions}>{onStart && availableCase && introApplies
        ? <button disabled={disabled} onClick={() => onStart(availableCase)}>もう分かるので相談へ</button>
        : <button onClick={() => setOpen(false)}>説明を閉じる</button>}</div>
      <p className={styles.note}>試用版の導入例・専門確認前。閲覧や操作だけで習得済みとは判定しません。3概念は簿記全体の網羅ではありません。</p>
    </>}
  </section>;
}
