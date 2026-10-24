import styles from './BookkeepingOverviewDiagram.module.css';

export function BookkeepingOverviewDiagram() {
  return <figure className={styles.figure} aria-label="商売の出来事から帳簿、貸借対照表と損益計算書へつながる簿記の全体像">
    <figcaption className={styles.caption}>お店の出来事が、財産と利益の見える形になる</figcaption>
    <div className={styles.flow}>
      <div className={styles.transactions}>
        <svg className={styles.shop} viewBox="0 0 160 96" aria-hidden="true" focusable="false">
          <path d="M24 41h112v47H24z" fill="#fff" stroke="currentColor" strokeWidth="3" />
          <path d="M20 39l13-27h94l13 27" fill="#f5d0ab" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          <path d="M20 39v7q10 13 20 0 10 13 20 0 10 13 20 0 10 13 20 0 10 13 20 0 10 13 20 0v-7" fill="#fff1de" stroke="currentColor" strokeWidth="3" />
          <path d="M41 59h30v18H41zM91 59h26v29H91z" fill="#d5ece5" stroke="currentColor" strokeWidth="3" />
          <path d="M13 88h134" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span className={styles.step}>① 商売の出来事</span>
        <strong>売る・買う・借りる</strong>
        <p>お店で起きた取引</p>
      </div>
      <span className={styles.arrow} aria-hidden="true">→</span>
      <div className={styles.records}>
        <svg className={styles.book} viewBox="0 0 120 96" aria-hidden="true" focusable="false">
          <path d="M14 17h35q11 0 11 8 0-8 11-8h35v64H71q-11 0-11 7-1-7-11-7H14z" fill="#fff" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          <path d="M60 25v63M25 35h23M25 47h23M25 59h23M72 35h23M72 47h23M72 59h23" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span className={styles.step}>② 帳簿に記録</span>
        <strong>何が増え、何が減った？</strong>
        <p>取引の二つの面を記録して<br />整理する</p>
      </div>
      <span className={styles.arrow} aria-hidden="true">→</span>
      <div className={styles.reports}>
        <div className={styles.reportHeading}><span className={styles.step}>③ 二つの見方で確かめる</span></div>
        <div className={styles.reportPair}>
          <section className={styles.balance} aria-label="貸借対照表はある時点の財産を見る">
            <span className={styles.viewLabel}>ある時点の財産</span>
            <h3>何を持ち、どう調達した？</h3>
            <div className={styles.balanceChart} aria-hidden="true"><span>資産</span><div><span>負債</span><span>純資産</span></div></div>
            <p>現金や備品、返す義務など</p>
            <strong className={styles.reportName}>貸借対照表 <small>BS</small></strong>
          </section>
          <section className={styles.income} aria-label="損益計算書は一定期間の儲けを見る">
            <span className={styles.viewLabel}>一定期間の儲け</span>
            <h3>どれだけ利益が出た？</h3>
            <div className={styles.incomeChart} aria-hidden="true"><span>収益</span><b>−</b><span>費用</span><b>＝</b><span>利益</span></div>
            <p>収益から費用を差し引く</p>
            <strong className={styles.reportName}>損益計算書 <small>PL</small></strong>
          </section>
        </div>
      </div>
    </div>
    <p className={styles.note}>同じ取引の記録から、「今の状態」と「期間の成果」を見ます。</p>
  </figure>;
}
