"""既存CIのjob結果を回収する。製品の提供可否は判定しない。"""

import json
import os
import re
from pathlib import Path


def collect(needs, context):
    """GitHub needsの欠測・取消を含め、明示的な全成功だけを通す。"""
    jobs = {}
    for name in ("cli", "web"):
        value = needs.get(name) if isinstance(needs, dict) else None
        result = value.get("result") if isinstance(value, dict) else None
        jobs[name] = result if result in ("success", "failure", "cancelled", "skipped") else "unknown"
    valid_context = (
        re.fullmatch(r"[0-9a-f]{40}", context.get("sha", "")) is not None
        and re.fullmatch(r"[1-9][0-9]*", context.get("run_id", "")) is not None
        and re.fullmatch(r"[1-9][0-9]*", context.get("attempt", "")) is not None
        and context.get("repository") == "nexus-ai-2045/zeirishi-coach-public"
    )
    status = "unknown"
    if "failure" in jobs.values():
        status = "fail"
    elif valid_context and all(result == "success" for result in jobs.values()):
        status = "pass"
    return {"scope": "repository_ci", "status": status, "jobs": jobs,
            "context": context, "context_verified": valid_context,
            "product_acceptance": "unverified"}


def main():
    context = {key: os.environ.get(env, "") for key, env in (
        ("sha", "GITHUB_SHA"), ("run_id", "GITHUB_RUN_ID"),
        ("attempt", "GITHUB_RUN_ATTEMPT"), ("repository", "GITHUB_REPOSITORY"))}
    try:
        needs = json.loads(os.environ.get("CI_NEEDS_JSON", "null"))
    except json.JSONDecodeError:
        needs = None
    receipt = collect(needs, context)
    print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        # GitHubの固定メタデータだけを表示する。外部入力本文や秘密値は記録しない。
        lines = ["## リポジトリ検証結果", f"判定: {receipt['status']}",
                 "", "| 検証 | 結果 |", "|---|---|"]
        lines += [f"| {name} | {result} |" for name, result in receipt["jobs"].items()]
        if receipt["context_verified"]:
            lines += ["", f"検証SHA: `{context['sha']}`",
                      f"実行: https://github.com/{context['repository']}/actions/runs/{context['run_id']}/attempts/{context['attempt']}"]
        lines += ["", "実教材・実AI・実Auth/DB・実運用の提供検収は、このCIでは未確認。"]
        with Path(summary).open("a", encoding="utf-8") as stream:
            stream.write("\n".join(lines) + "\n")
    return {"pass": 0, "fail": 1, "unknown": 2}[receipt["status"]]


if __name__ == "__main__":
    raise SystemExit(main())
