// Integration test against a real `spt`, in a throwaway SPT_HOME.
// Not part of `node --test` (no .test. in the name). Run on purpose:
//   APPLET_INT=1 node --test tests/int/real-spt.int.mjs
// Shape: fresh home,
// node start, a live `spt ready <owner>` child (the owner must be Active for a
// shell's say to drain), register, spawn, run, read the listener, node stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn as spawnChild, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { pack } from '../../scripts/pack.mjs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const OWNER = 'apptest-owner';
const SID = 'apptest-sid-0001';

// Never leak the caller's own spt identity into the test home.
function baseEnv(home) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SPT|OWL)/i.test(k)));
  // SPT_DOCS_PORT: every home's docs server binds 5474 by default; keep off the real one.
  return { ...env, SPT_HOME: home, OWL_SESSION_ID: SID, SPT_DOCS_PORT: process.env.APPLET_INT_DOCS_PORT ?? '55474' };
}

// One <EVENT ...> line from the shell that carries the text.
function fromShell(line, shell, text) {
  const from = /<EVENT [^>]*\bfrom="([^"]*)"/.exec(line)?.[1];
  return (from === shell || from?.startsWith(`${shell}@`)) && line.includes(text);
}

// APPLET_INT_ARCHIVE=1: install from the release asset (dist/adapter.spt), not the repo.
// The archive is extracted the same way `spt adapter add --release` does it (flat, every entry).
// [int->REQ-RELEASE-PACK]
function adapterSource(home) {
  if (process.env.APPLET_INT_ARCHIVE !== '1') return ROOT;
  const dir = join(home, 'pkg');
  mkdirSync(dir, { recursive: true });
  copyFileSync(pack(), join(dir, 'adapter.spt'));
  // Relative archive name with cwd=dir: GNU tar reads "C:" in -f as a remote host.
  const r = spawnSync('tar', ['-xf', 'adapter.spt'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // Test mode for the service ('1' or 'hang'); see src/service.mjs.
  if (process.env.APPLET_TEST_IGNORE_QUIESCE) writeFileSync(join(dir, '.applet-test-quiesce'), process.env.APPLET_TEST_IGNORE_QUIESCE);
  return dir;
}

// All processes that run src/service.mjs: [{pid, cmd}]. Windows: CIM; else: ps.
function serviceProcs() {
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process | ? { $_.CommandLine -like '*service.mjs*' } | % { \"$($_.ProcessId) ppid=$($_.ParentProcessId) $($_.CommandLine)\" }"],
    { encoding: 'utf8' })
    : spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  return r.stdout.split(/\r?\n/).map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter((m) => m && m[2].includes('service.mjs'))
    .map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
}

// [int->REQ-SERVICE-CONNECT] [int->REQ-APPLET-RUN] [int->REQ-APPLET-CTX] [int->REQ-APPLET-STOP]
test('real spt: spawn access point, run timed-send, live owner gets the text, list, stop',
  { skip: process.env.APPLET_INT !== '1' && 'set APPLET_INT=1', timeout: 300_000 }, async () => {
    // APPLET_INT_HOME: the caller owns the home (and deletes it after its own process checks).
    const home = process.env.APPLET_INT_HOME ?? mkdtempSync(join(tmpdir(), 'applet-int-'));
    const env = baseEnv(home);
    // stdout + stderr, success or not: spt prints most result lines on stderr.
    const sptEnv = (e, ...args) => {
      const r = spawnSync('spt', args, { env: e, encoding: 'utf8', timeout: 60_000 });
      return `${r.stdout ?? ''}${r.stderr ?? ''}`;
    };
    const spt = (...args) => sptEnv(env, ...args);
    // Daemon start/stop: no session id (spt refuses a broker stop from a session).
    const { OWL_SESSION_ID: _sid, ...daemonEnv } = env;
    let SHELL, listener;
    try {
      // A fresh home has no daemon and no node identity; start a detached daemon for it.
      console.log(`node start: ${sptEnv(daemonEnv, 'node', 'start').trim()}`);

      // The owner: a live listener. It is Active only while its process runs.
      listener = spawnChild('spt', ['ready', OWNER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const heard = [];
      let wake;
      const onData = (d) => { heard.push(...d.toString().split(/\r?\n/).filter(Boolean)); wake?.(); };
      listener.stdout.on('data', onData);
      listener.stderr.on('data', onData);
      const hear = (pred, ms) => new Promise((ok) => {
        const t = setTimeout(() => { wake = null; ok(null); }, ms);
        const check = () => { const l = heard.find(pred); if (l) { clearTimeout(t); wake = null; ok(l); } };
        wake = check; check();
      });
      assert.ok(await hear(() => true, 15_000), 'listener banner');

      const add = spt('adapter', 'add', adapterSource(home));
      assert.match(add, /ADAPTER_ADD:applet:/, add);

      let spawn = spt('shell', 'spawn', 'applet', '--owner', OWNER);
      if (/CONSENT_PENDING/.test(spawn)) {
        // Throwaway home only: this grant never touches the operator's node state.
        spt('grant', 'add', 'spawn-shell', OWNER, '--qualifier', 'applet');
        spawn = spt('shell', 'spawn', 'applet', '--owner', OWNER);
      }
      assert.doesNotMatch(spawn, /CONSENT_PENDING|REFUSED|FAIL|NO_IDENTITY/, spawn);
      // The instance number is the smallest free n (applet-0 first); read it, do not guess.
      SHELL = /SHELL_SPAWNED:(\S+)/.exec(spawn)?.[1];
      assert.ok(SHELL, spawn);

      const text = `applet-int ${Date.now()}`;
      const run = spt('shell', 'cmd', '--owner', OWNER, SHELL, 'run', 'applets/timed-send.ts',
        JSON.stringify({ delay_ms: 500, text }));
      assert.match(run, /started a1/, run);

      // The listener prints each delivered message as one <EVENT type="msg" ...> line.
      let found = await hear((l) => fromShell(l, SHELL, text), 20_000);
      // Second check: the inbox.
      if (!found) {
        found = spt('api', '--adapter', 'spt', 'poll', OWNER).split(/\r?\n/).find((l) => fromShell(l, SHELL, text)) ?? null;
      }
      assert.ok(found, `owner got the applet text; listener heard:\n${heard.join('\n')}`);
      console.log(`owner got: ${found}`);

      // list + stop on a long applet
      spt('shell', 'cmd', '--owner', OWNER, SHELL, 'run', 'applets/timed-send.ts',
        JSON.stringify({ delay_ms: 600_000, text: 'never' }));
      assert.match(spt('shell', 'cmd', '--owner', OWNER, SHELL, 'list'), /^a2 /m);
      assert.match(spt('shell', 'cmd', '--owner', OWNER, SHELL, 'stop', 'a2'), /stopping a2/);

      // APPLET_TEST_IGNORE_QUIESCE=1 (with APPLET_INT_ARCHIVE=1): the service ignores Quiesce.
      // After teardown spt must stop it by force, and no service process may stay.
      // [int->REQ-SERVICE-NO-ORPHAN]
      if (process.env.APPLET_TEST_IGNORE_QUIESCE) {
        assert.match(spt('shell', 'teardown', SHELL, '--owner', OWNER), /TORNDOWN/);
        SHELL = null;
        // The temp home's folder name is unique; the service path holds it (archive install).
        const left = () => serviceProcs().filter((p) => p.cmd.includes(basename(home)));
        assert.ok(left().length > 0, 'service runs before the idle stop');
        const until = Date.now() + 150_000;
        while (left().length && Date.now() < until) await new Promise((r) => setTimeout(r, 2000));
        assert.deepEqual(left(), [], 'no service process stays after the forced stop (pid ppid=<parent> command line above)');
      }
    } catch (e) {
      // Show what the temp daemon said about the service and the shell.
      try {
        const log = readFileSync(join(home, 'logs', 'daemon.stderr.log'), 'utf8');
        console.log(log.split(/\r?\n/).filter((l) => /SERVICE|SHELL|applet|Error/.test(l)).slice(-30).join('\n'));
      } catch { /* no log */ }
      throw e;
    } finally {
      if (SHELL) spt('shell', 'teardown', SHELL, '--owner', OWNER);
      // Kill only our own child, by its handle.
      if (listener && listener.exitCode === null) {
        console.log(`listener pid ${listener.pid}: kill`);
        listener.kill();
        await new Promise((r) => { listener.once('exit', r); setTimeout(r, 5000); });
      }
      const stop = sptEnv(daemonEnv, 'node', 'stop');
      // IR-156: a daemon can outlive the test. Show what stop said, then clean up.
      console.log(`node stop: ${stop.trim()}`);
      if (!process.env.APPLET_INT_HOME) {
        try { rmSync(home, { recursive: true, force: true }); } catch { /* files held by a live daemon */ }
      }
    }
  });
