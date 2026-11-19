// Make dist/adapter.spt: the release asset for `spt adapter add --release`.
// A flat tar; spt extracts every top-level entry, and {adapter_dir} is the extract dir.
// Run: node scripts/pack.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
export const CONTENTS = ['manifest.toml', 'src', 'applets', 'README.md', 'LICENSE'];

// [impl->REQ-RELEASE-PACK]
export function pack(out = 'dist/adapter.spt') {
  const files = CONTENTS.filter((f) => existsSync(resolve(ROOT, f)));
  mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
  // Relative paths with cwd=ROOT: GNU tar reads "C:" in a path as a remote host.
  const r = spawnSync('tar', ['-cf', out, '--format', 'ustar', ...files], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar failed: ${r.error?.message ?? r.stderr}`);
  return resolve(ROOT, out);
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) console.log(pack());
