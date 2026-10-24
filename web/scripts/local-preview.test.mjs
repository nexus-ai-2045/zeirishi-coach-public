import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/local-preview.sh');
function stopWith(description) {
  const dir = mkdtempSync(join(tmpdir(), 'preview-ownership-'));
  const marker = join(dir, 'removed');
  writeFileSync(join(dir, 'description'), description);
  writeFileSync(join(dir, 'launchctl'), '#!/bin/sh\ncase "$1" in\nlist) cat "$PREVIEW_TEST_DIR/description";;\nremove) touch "$PREVIEW_TEST_DIR/removed";;\nesac\n', { mode: 0o700 });
  try {
    const result = spawnSync('/bin/sh', [script, 'stop'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PREVIEW_TEST_DIR: dir },
    });
    return { status: result.status, removed: existsSync(marker) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const ownArgs = ` "ProgramArguments" = (\n "/bin/sh";\n "${script}";\n "_run";\n "/usr/local/bin/node";\n );`;
test('only the exact preview invocation can be removed', () => {
  assert.deepEqual(stopWith(`{\n${ownArgs}\n};`), { status: 0, removed: true });
});
test('an unrelated job whose output path contains the script is preserved', () => {
  assert.deepEqual(stopWith(`{\n "StandardOutPath" = "${script}.other.log";\n "ProgramArguments" = (\n "/bin/sleep";\n "60";\n );\n};`), { status: 1, removed: false });
});
test('extra arguments and a script in the wrong position are preserved', () => {
  for (const args of [ownArgs.replace(' "_run";', ' "_run";\n "extra";'), ownArgs.replace(' "/bin/sh";', ' "/bin/sleep";')]) {
    assert.deepEqual(stopWith(`{\n${args}\n};`), { status: 1, removed: false });
  }
});
