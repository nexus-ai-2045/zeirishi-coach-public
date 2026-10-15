export function CaseMaterials() {
  return <section aria-labelledby="case-heading" className="materials">
    <h2 id="case-heading">相談メモ</h2>
    <blockquote>「支払いは済んだのに、全部が今期の費用ではないの？」</blockquote>
    <h3>資料</h3>
    <table><thead><tr><th>項目</th><th>金額</th><th>内容</th></tr></thead><tbody>
      <tr><td>保険料</td><td>120,000円</td><td>12か月分を前払い</td></tr>
      <tr><td>備品</td><td>240,000円</td><td>4年で均等配分</td></tr>
    </tbody></table>
    <p className="conditions">テスト条件：どちらも期首開始。残存価額は0円。</p>
  </section>;
}
