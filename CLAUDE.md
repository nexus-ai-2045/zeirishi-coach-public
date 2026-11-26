@CONTRIBUTING.md

## エージェント向け

- コミットの作者とコミッターは `nexus-ai-2045 <273569186+nexus-ai-2045@users.noreply.github.com>`。Co-Authored-By などのトレーラーと、claude.ai のセッション URL は付けない。公開前検査（`.github/workflows/public-privacy-preflight.yml`）が落とす。
- 「完了」と書く前に、上の Web の検証と `python3 -m pytest -q` を実際に流し、結果を PR に書く。
- 1つの PR は1つの目的に絞る。コメント削除のような機械的な変更は、道具（スクリプト）と一緒に出し、道具を再実行すれば同じ差分になるようにする。
