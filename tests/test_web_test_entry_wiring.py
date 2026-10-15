"""Web の検査が、CI から実際に呼ばれる入口へ接続されていることを検査する。"""

import fnmatch
import json
import re
import shlex
from pathlib import Path

import yaml


ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


def web_scripts():
    return json.loads((WEB / "package.json").read_text(encoding="utf-8"))["scripts"]


def web_job_commands():
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    return [step["run"] for step in workflow["jobs"]["web"]["steps"] if "run" in step]


def reachable_commands():
    scripts = web_scripts()
    reached = []
    for command in web_job_commands():
        reached.append(command)
        match = re.match(r"npm (?:run )?(?:--silent )?([\w:.-]+)", command)
        if match and match.group(1) in scripts:
            reached.append(scripts[match.group(1)])
    return reached


def ignored_by_default_playwright_config():
    text = (WEB / "playwright.config.ts").read_text(encoding="utf-8")
    ignore = re.search(r"testIgnore:\s*\[([^\]]*)\]", text)
    return re.findall(r"[\w.-]+\.spec\.ts", ignore.group(1)) if ignore else []


def test_spec_excluded_from_default_e2e_has_its_own_config_run_by_ci():
    ignored = ignored_by_default_playwright_config()
    assert "bookkeeping-mvp.spec.ts" in ignored
    commands = reachable_commands()
    for spec in ignored:
        configs = [path.name for path in WEB.glob("playwright.*.config.ts")
                   if re.search(rf"testMatch:\s*'{re.escape(spec)}'", path.read_text(encoding="utf-8"))]
        assert configs, f"{spec} は既定の画面検査から外れているのに、専用の設定が無い"
        assert any(f"--config {config}" in command for config in configs for command in commands), \
            f"{spec} を走らせる設定 {configs} が CI の web ジョブから呼ばれていない"


def test_bookkeeping_mvp_config_is_exposed_as_npm_script():
    command = web_scripts().get("test:e2e:bookkeeping", "")
    assert shlex.split(command) == ["playwright", "test", "--config", "playwright.bookkeeping.config.ts"]


def test_node_script_tests_run_from_npm_test():
    patterns = [token for token in shlex.split(web_scripts()["test"]) if "*" in token]
    for path in sorted((WEB / "scripts").glob("*.test.*")):
        relative = path.relative_to(WEB).as_posix()
        assert any(fnmatch.fnmatch(relative, pattern) for pattern in patterns), \
            f"{relative} が npm test の対象に入っていない"
    assert any("npm test" in command for command in web_job_commands())


def test_supported_node_runtime_is_shared_by_ci_and_lifecycle():
    import json
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    version = (root / ".nvmrc").read_text().strip()
    package = json.loads((root / "web/package.json").read_text())
    assert package["engines"]["node"] == version
    assert "node-version-file: '.nvmrc'" in (root / ".github/workflows/ci.yml").read_text()
    assert (root / "web/.npmrc").read_text().strip() == "engine-strict=true"
    for name in ("dev", "start", "build", "test", "typecheck"):
        assert package["scripts"]["pre" + name] == "node scripts/verify-node-runtime.mjs"


def test_web_unit_concurrency_flag_precedes_test_files():
    command = shlex.split(web_scripts()["test"])
    limit = command.index("--test-concurrency=2")
    assert all(limit < index for index, token in enumerate(command) if "*" in token)
