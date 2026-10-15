<!-- repo-preflight:review-record -->

# 公開範囲とレビュー条件

状態: 公開済み

このリポジトリは 簿記論の概念・実務相談・問題演習・復習をつなぐ学習アプリの公開ソース。教材は専門審査前の試用。 を対象とします。

## 公開対象

- (実装後に記入)

## 公開対象外

- secret / token / 個人の絶対 path / アカウント情報
- 公開・push・merge・visibility 変更を自動実行する機能

## 判定上の停止線

`readiness_scan.py` の `status: pass` はローカルで機械検査できた範囲だけを示す。公開・push・merge・visibility 変更は人が別に判断する。

## レビュー記録 (2026-10-16)

- bootstrap_repo.py で作成。repo-preflight の検査結果は作成時の report を参照。
