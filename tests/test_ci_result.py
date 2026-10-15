import json

import pytest

from ci_result import collect, main


CONTEXT = {"sha": "a" * 40, "run_id": "123", "attempt": "1",
           "repository": "nexus-ai-2045/zeirishi-coach"}


def needs(cli="success", web="success"):
    return {"cli": {"result": cli}, "web": {"result": web}}


def test_success_is_only_repository_ci():
    result = collect(needs(), CONTEXT)
    assert result["status"] == "pass"
    assert result["product_acceptance"] == "unverified"


@pytest.mark.parametrize("state,expected", [("failure", "fail"),
    ("skipped", "unknown"), ("cancelled", "unknown"), ("pending", "unknown"), (None, "unknown")])
def test_unsuccessful_job_cannot_pass(state, expected):
    assert collect(needs(web=state), CONTEXT)["status"] == expected


@pytest.mark.parametrize("payload", [None, [], {}, {"cli": {"result": "success"}},
                                    {"cli": "success", "web": {"result": "success"}}])
def test_missing_or_malformed_result_is_unknown(payload):
    assert collect(payload, CONTEXT)["status"] == "unknown"


@pytest.mark.parametrize("field,value", [("sha", ""), ("run_id", "0"),
    ("attempt", ""), ("repository", "different/repository")])
def test_unbound_success_is_unknown(field, value):
    assert collect(needs(), {**CONTEXT, field: value})["status"] == "unknown"


@pytest.mark.parametrize("payload,code", [(json.dumps(needs()), 0),
    (json.dumps(needs(web="failure")), 1), ("{invalid", 2)])
def test_entry_writes_receipt_and_summary(tmp_path, monkeypatch, capsys, payload, code):
    for field, env in (("sha", "GITHUB_SHA"), ("run_id", "GITHUB_RUN_ID"),
                       ("attempt", "GITHUB_RUN_ATTEMPT"), ("repository", "GITHUB_REPOSITORY")):
        monkeypatch.setenv(env, CONTEXT[field])
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("CI_NEEDS_JSON", payload)
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    assert main() == code
    result = json.loads(capsys.readouterr().out)
    assert result["context"]["sha"] == CONTEXT["sha"]
    assert "実運用" in summary.read_text()
