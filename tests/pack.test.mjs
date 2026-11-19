import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { pack } from '../scripts/pack.mjs';

// [unit->REQ-RELEASE-PACK]
test('pack: flat archive holds manifest, service code, applets; no tests', () => {
  const out = pack('dist/adapter.test.spt');
  const r = spawnSync('tar', ['-tf', 'dist/adapter.test.spt'], { cwd: dirname(dirname(out)), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const list = r.stdout.split(/\r?\n/).filter(Boolean);
  for (const f of ['manifest.toml', 'src/service.mjs', 'src/core.mjs', 'src/worker.mjs', 'src/frames.mjs', 'applets/timed-send.ts']) {
    assert.ok(list.includes(f), `${f} in ${list}`);
  }
  assert.ok(!list.some((f) => f.startsWith('tests')), 'no tests in the archive');
  assert.ok(!list.some((f) => f.startsWith('/') || f.includes('..')), 'relative entries only');
});
