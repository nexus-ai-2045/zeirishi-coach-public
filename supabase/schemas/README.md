# Supabase の権限宣言

このフォルダの SQL は、まだ本番に適用していない宣言である。適用する順は下の見出しの順。各ファイルの前提と、権限の決め方の理由をここにまとめる。

## learner-access.sql

- 学習者の利用許可を宣言する正本。migration は CLI の差分生成後に別途レビューする。
- このファイルに招待先・利用者行・秘密情報を置かない。
- 失効した本人の行も参照できる。実際の利用許可には status = 'active' の確認が必要。
- Auth のユーザー削除・この行の失効だけで既発行 JWT 自体が無効になるとは扱わない。
- 既定の grant に依存しない。利用者自身の許可作成・昇格・失効取消しを禁止する。
- authenticated ロールには匿名サインインも含まれるため、明示的な boolean false のみ許可。
- 欠落、null、文字列 "false"、ユーザー編集可能な user_metadata は許可根拠にしない。

参考: <https://supabase.com/docs/guides/local-development/declarative-database-schemas>、<https://supabase.com/docs/guides/database/postgres/row-level-security>

## learner-transaction.sql

- learner-access.sql の後に適用する宣言。外部DBへの適用・role配備は別途承認と検証が必要。
- 認証済み一般利用者の権限を広げず、専用サーバーロールの同一TX内で利用許可行をロックする。
- FOR SHARE に必要な列UPDATE権限だけを制限ロールへ与え、RLS WITH CHECK(false)で実更新を拒否する。
- 非superuserの配備実行者にはguardへのSET ROLE能力が別途必要。承認前にmembershipを自動付与しない。
- 所有者変更に必要なCREATEは同一TX内だけ一時付与し、外から観測できる最終状態では撤回する。

参考: <https://www.postgresql.org/docs/current/sql-select.html>、<https://www.postgresql.org/docs/current/sql-createfunction.html>

## learning-rls.sql

- 学習データの権限宣言の正本。既存サービスの15表DDLと learner-access.sql、learner-transaction.sql の後に適用する。テーブル定義・migration はここで複製しない。
- 配備前提: 専用DBであり public の CREATE 撤回が他アプリを壊さないことを確認する。
- 共有DBへ無条件に適用しない。実Supabase適用、migration生成、複数接続競合検証は別工程。
- zeirishi_app は検証済み本人情報を設定する信頼済みサーバー専用。一般利用者へ接続資格や role membership を渡さない。RLS自体がJWTの署名を検証する仕組みではない。
- PUBLICから継承されるCREATEも撤回し、学習処理にDDL権限を与えない。
- 利用権限の読取りだけを追加する。app自身によるactive化は許可しない。
- SECURITY INVOKERを維持し、現在の利用許可をRLS下で読む。JWT内の過去の許可状態は使わない。
- 失効との直列化は、同一TX先頭のrequire_active_learnerのFOR SHAREロックが担当する。
- 未提出答案・未開示採点があるため、Data APIのauthenticatedにも直接SELECTを与えない。
- 親子の参照先も本人に限定する。FKの存在確認はRLSを迂回するためowner_idだけでは不足する。
- 親方向のみ参照し、policyの循環を作らない。USINGとWITH CHECKを同じ条件にする。
- receiptの親も同じ本人の記録に限定する。別人の親の存在を利用しない。

参考: <https://supabase.com/docs/guides/database/postgres/row-level-security>

## learning-evidence-rls.sql

- 正式証拠・復習・AI支援の追加権限。各サービスDDLとlearning-rls.sqlの後に適用。
- これは未適用の宣言。専門取込用ロールや実DBへの権限付与は別途承認する。
- 本人の全データ削除は許可するが、一般学習サーバーによる専門証拠の作成・改変は拒否。
- アプリ全体の月額予約額。個人情報を持たず、本人データ削除でも使用済み予算は戻さない。
