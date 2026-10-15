# 実Auth・DB設定のローカル事前確認

この確認は、実行環境へ渡した値の形式と組合せをアプリ既存のAuth/DB設定parserで検査する。外部サービスへ接続せず、値を表示せず、設定・migration・配備も行わない。成功結果は `configuration_valid_only` であり、実Auth、メール送信、PostgreSQL、RLS、migrationの実動作確認を意味しない。

`web` ディレクトリで必要な環境変数を安全な実行環境へ設定してから、次を実行する。

```sh
npm run preflight:runtime
```

JSON結果の `missing` には不足している変数名だけが入る。異常な形式やfixtureとの競合は固定状態名だけを返し、例外本文・変数値は出力しない。終了コード0は設定parserの検証成功、終了コード1は未設定・不正・モード競合を示す。

## 変数

Authに必要な変数:

- `ZEIRISHI_SUPABASE_ENABLED=1`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`（publishable keyのみ。secret keyは不可）
- `ZEIRISHI_APP_ORIGIN`
- `ZEIRISHI_AUTH_EMAIL_ENABLED=1`（Magic Linkメールを明示的に有効化）

DB接続にも必要な変数:

- `ZEIRISHI_DATABASE_ENABLED=1`
- `ZEIRISHI_DATABASE_HOST`
- `ZEIRISHI_DATABASE_USER`
- `ZEIRISHI_DATABASE_PORT`
- `ZEIRISHI_DATABASE_PASSWORD`
- `ZEIRISHI_DATABASE_CA_PEM`（任意。指定時はCA証明書として検査）

接続先、費用、利用するSupabase project、SMTP、DBロール、migration/RLS適用、実環境への配備と招待には、別途運用者判断と対象別承認が必要である。この検査はそれらを選択・実行しない。実環境検収では、実Auth/メール、TLS pooler、migration/RLS、利用者分離、保存と失効の競合、復旧を別々に記録する。復旧条件は[DB復旧runbook](database-recovery-runbook.md)を参照する。
