import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pack } from '../scripts/pack.mjs';

// [unit->REQ-RELEASE-PACK]
test('pack: flat archive holds manifest, service code, applets; no tests', () => {
  const out = pack('dist/adapter.test.spt');
  const r = spawnSync('tar', ['-tf', 'dist/adapter.test.spt'], { cwd: dirname(dirname(out)), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const list = r.stdout.split(/\r?\n/).filter(Boolean);
  for (const f of ['manifest.toml', 'src/service.mjs', 'src/core.mjs', 'src/worker.mjs', 'src/frames.mjs', 'applets/timed-send.ts', 'LICENSE']) {
    assert.ok(list.includes(f), `${f} in ${list}`);
  }
  assert.ok(!list.some((f) => f.startsWith('tests')), 'no tests in the archive');
  assert.ok(!list.some((f) => f.startsWith('/') || f.includes('..')), 'relative entries only');
});

// [unit->REQ-RELEASE-UPDATE]
test('manifest: gh_release update avenue from this repo', () => {
  const m = readFileSync(join(import.meta.dirname, '..', 'manifest.toml'), 'utf8');
  // The lines of the [update] table, up to the next table header.
  const lines = m.split(/\r?\n/).map((l) => l.trim());
  const start = lines.indexOf('[update]');
  assert.ok(start >= 0, 'manifest has [update]');
  const rest = lines.slice(start + 1);
  const update = rest.slice(0, rest.findIndex((l) => l.startsWith('[')));
  assert.ok(update.includes('avenue = "gh_release"'), update.join('\n'));
  assert.ok(update.includes('repo = "SaberMage/spt-applet-shell"'), update.join('\n'));
});
