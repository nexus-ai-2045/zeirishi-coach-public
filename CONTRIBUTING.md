# コントリビューション

## セットアップ

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest -q
python3 scripts/coach.py lint
```

Python 3.11 以上。CLI本体は標準ライブラリだけで動きます。開発検証には `requirements-dev.txt` のpytestとYAMLパーサーを使います。

## 開発ルール

- 挙動を変える時は失敗する test を先に追加する。
- 論点 tree (`references/subjects/*.json`) を直したら `coach.py lint` を通す。weight の合計は 100。
- 改正が絡む税法の記述は「本番年度の法令で要確認」と明記する。条文番号を書く時は e-Gov 法令検索を根拠にする。
- 学習者の記録 (state.json / attempts.jsonl) を Issue や PR に貼らない。
- 予備校教材・過去問の本文を repo に入れない。
- main へ直接 push しない。branch を切って PR を出す。
