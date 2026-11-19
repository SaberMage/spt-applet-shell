import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encode, FrameReader } from '../src/frames.mjs';
import { createCore } from '../src/core.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CID = 'shell:alice/applet-1';
const CLIENT = { client_id: CID, kind: 'shell', owner: 'alice', shell_id: 'applet-1' };

// [unit->REQ-FRAME-CODEC]
test('frame codec: round trip across split chunks', () => {
  const bytes = Buffer.concat([encode('Hello', { token: 't', protocol: 1 }), encode('Reply', { id: '1', ok: true })]);
  const r = new FrameReader();
  const out = [];
  for (let i = 0; i < bytes.length; i += 3) out.push(...r.push(bytes.subarray(i, i + 3)));
  assert.deepEqual(out, [
    { protocol_version: 1, kind: 'Hello', payload: { token: 't', protocol: 1 } },
    { protocol_version: 1, kind: 'Reply', payload: { id: '1', ok: true } },
  ]);
});

test('frame codec: refuses a frame over 16 MiB', () => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(16 * 1024 * 1024 + 1);
  assert.throws(() => new FrameReader().push(b), /too long/);
});

function harness() {
  const out = [];
  let wake;
  const send = (kind, payload) => { out.push({ kind, payload }); wake?.(); };
  const core = createCore({ send, adapterDir: ROOT });
  core.onFrame({ kind: 'ClientList', payload: { clients: [CLIENT] } });
  let n = 0;
  const cmd = (op, args, op_id = `op${n + 1}`) =>
    ++n && core.onFrame({ kind: 'Request', payload: { id: `r${n}`, client_id: CID, kind: 'command', body: { from: 'alice', op, args, op_id, seq: n } } });
  // Wait until a frame matching pred is out.
  const until = (pred, ms = 5000) => new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`timeout; out=${JSON.stringify(out)}`)), ms);
    const check = () => { const f = out.find(pred); if (f) { clearTimeout(t); wake = null; ok(f); } };
    wake = check; check();
  });
  return { core, out, cmd, until };
}
const said = (text) => (f) => f.kind === 'ShellOut' && f.payload.body.text === text;
const replied = (op_id) => (f) => f.kind === 'ShellReply' && f.payload.op_id === op_id;

// [unit->REQ-APPLET-RUN] [unit->REQ-APPLET-CTX] [unit->REQ-APPLET-END-SILENT]
test('run timed-send: ack, started reply, say to owner, silent end', async () => {
  const h = harness();
  h.cmd('run', { script: 'applets/timed-send.ts', args_json: '{"delay_ms":20,"text":"hi"}' }, 'x1');
  assert.deepEqual(h.out[0], { kind: 'Reply', payload: { id: 'r1', ok: true } });
  assert.equal((await h.until(replied('x1'))).payload.body, 'started a1');
  const s = await h.until(said('hi'));
  assert.deepEqual(s.payload, { client_id: CID, kind: 'say', body: { text: 'hi' } });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(h.core.applets.size, 0);
  assert.equal(h.out.filter((f) => f.kind === 'ShellOut').length, 1, 'no end message');
});

test('positional args array is accepted', async () => {
  const h = harness();
  h.cmd('run', ['applets/timed-send.ts', '{"delay_ms":1,"text":"pos"}']);
  await h.until(said('pos'));
});

// [unit->REQ-APPLET-STOP]
test('list and stop', async () => {
  const h = harness();
  h.cmd('run', { script: 'applets/timed-send.ts', args_json: '{"delay_ms":60000,"text":"never"}' });
  h.cmd('list', {}, 'l1');
  assert.match((await h.until(replied('l1'))).payload.body, /^a1 .*timed-send\.ts /);
  h.cmd('stop', { applet_id: 'a1' }, 's1');
  assert.equal((await h.until(replied('s1'))).payload.body, 'stopping a1');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(h.core.applets.size, 0);
  assert.ok(!h.out.some(said('never')));
  assert.ok(!h.out.some((f) => f.kind === 'ShellOut'), 'a stop sends no message');
});

test('a failing applet reports the error to the owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'applet-'));
  const script = join(dir, 'boom.mjs');
  writeFileSync(script, 'export default async () => { throw new Error("boom"); }');
  const h = harness();
  h.cmd('run', { script, args_json: '' });
  const f = await h.until((f) => f.kind === 'ShellOut' && /applet a1 failed: .*boom/s.test(f.payload.body.text));
  assert.equal(f.payload.client_id, CID);
});

test('a duplicate op_id runs once; an unknown client gets an ack only', async () => {
  const h = harness();
  h.cmd('list', {}, 'dup');
  h.cmd('list', {}, 'dup');
  assert.equal(h.out.filter(replied('dup')).length, 1);
  h.core.onFrame({ kind: 'Request', payload: { id: 'z', client_id: 'shell:bob/applet-1', kind: 'command', body: { op: 'list', op_id: 'z1' } } });
  assert.ok(h.out.some((f) => f.kind === 'Reply' && f.payload.id === 'z'));
  assert.ok(!h.out.some(replied('z1')));
});

test('ClientLeave and stopAll stop applets', async () => {
  const h = harness();
  h.cmd('run', { script: 'applets/timed-send.ts', args_json: '{"delay_ms":60000,"text":"x"}' });
  h.core.onFrame({ kind: 'ClientLeave', payload: { client_id: CID, reason: 'closed' } });
  assert.equal(h.core.applets.size, 0);
  const g = harness();
  g.cmd('run', { script: 'applets/timed-send.ts', args_json: '{"delay_ms":60000,"text":"x"}' });
  g.core.stopAll();
  assert.ok(g.out.some(said('applet a1 stopped: the applet service stopped')));
});
