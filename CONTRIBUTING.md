# コントリビューション

## セットアップ

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest -q
python3 scripts/coach.py lint
```

Python 3.11 以上。CLI本体は標準ライブラリだけで動きます。開発検証には `requirements-dev.txt` のpytestとYAMLパーサーを使います。

## Web の検証

```bash
cd web
npm ci
npm run build && npm run typecheck && npm test
ZEIRISHI_E2E_PRODUCTION=1 npm run test:e2e
```

Node は `.nvmrc` の版（22.23.3）に固定。CI はこのほか online・簿記論・全11科目の E2E を流す（`.github/workflows/ci.yml`）。

## 開発ルール

- ソースコードにコメントと docstring を書かない。理由は名前・テスト・エラー文・commit メッセージに書く。`npm test`（`web/scripts/source-comments.test.mjs`）と `pytest`（`tests/test_no_comments.py`）が、追跡中の全ソースを調べて落とす。消すときは `node web/scripts/source-comments.mjs --write` と `python3 scripts/source_comments.py --write` を使う。どちらも消す前後で構文木が同じことを確かめる。
- 例外は生成ファイル `web/next-env.d.ts`、先頭の shebang、CI の `uses:` の版コメントだけ。
- 使われなくなった API・画面・テストは、置き換えと同じ変更で消す。互換のための並行経路を残さない。

- 挙動を変える時は失敗する test を先に追加する。
- 論点 tree (`references/subjects/*.json`) を直したら `coach.py lint` を通す。weight の合計は 100。
- 改正が絡む税法の記述は「本番年度の法令で要確認」と明記する。条文番号を書く時は e-Gov 法令検索を根拠にする。
- 学習者の記録 (state.json / attempts.jsonl) を Issue や PR に貼らない。
- 予備校教材・過去問の本文を repo に入れない。
- main へ直接 push しない。branch を切って PR を出す。
