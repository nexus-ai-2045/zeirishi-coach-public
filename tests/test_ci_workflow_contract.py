"""CI の検証結果回収入口が弱体化していないことを検査する。"""

from pathlib import Path

import yaml


ROOT = Path(__file__).parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


def test_verification_job_is_always_bound_to_cli_and_web():
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    job = workflow["jobs"]["verification"]
    assert set(job["needs"]) == {"cli", "web"}
    assert job["if"] == "${{ always() }}"
    assert job.get("continue-on-error", False) is False
    steps = job["steps"]
    collector = next(step for step in steps if step.get("run") == "python3 scripts/ci_result.py")
    assert collector["env"]["CI_NEEDS_JSON"] == "${{ toJSON(needs) }}"
    assert "if" not in collector
    assert collector.get("continue-on-error", False) is False
    checkout = next(step for step in steps if step.get("uses", "").startswith("actions/checkout@"))
    assert "ref" not in checkout.get("with", {})
    for scope in (workflow, job, collector):
        assert not {"GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_REPOSITORY"}.intersection(scope.get("env", {}))
