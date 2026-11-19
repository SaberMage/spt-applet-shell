// Runs the real service.mjs as a child process against a fake spt: a local
// socket server that speaks the v2 frame protocol.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { encode, FrameReader } from '../src/frames.mjs';

const SERVICE = resolve(import.meta.dirname, '../src/service.mjs');
const CID = 'shell:alice/applet-1';

// [unit->REQ-SERVICE-CONNECT]
test('service: Hello first, then serves a run end to end, exits on Quiesce', async () => {
  const name = `applet-test-${process.pid}-${Date.now()}.sock`;
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : `\0${name}`;
  const frames = [];
  let conn, wake;
  const server = net.createServer((c) => {
    conn = c;
    const r = new FrameReader();
    c.on('data', (d) => { frames.push(...r.push(d)); wake?.(); });
  });
  await new Promise((ok) => server.listen(path, ok));
  const until = (pred) => new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`timeout; frames=${JSON.stringify(frames)}`)), 10000);
    const check = () => { const f = frames.find(pred); if (f) { clearTimeout(t); ok(f); } };
    wake = check; check();
  });

  const child = spawn(process.execPath, [SERVICE], {
    env: { ...process.env, SPT_SERVICE_ENDPOINT: name, SPT_SERVICE_TOKEN: 'tok', SPT_SERVICE_DIR: '' },
    stdio: 'inherit',
  });
  const exited = new Promise((ok) => child.on('exit', ok));
  try {
    const hello = await until(() => true);
    assert.deepEqual(hello, { protocol_version: 1, kind: 'Hello', payload: { token: 'tok', protocol: 1 } });

    conn.write(encode('ClientList', { clients: [{ client_id: CID, kind: 'shell', owner: 'alice', shell_id: 'applet-1' }] }));
    conn.write(encode('Request', {
      id: 'r1', client_id: CID, kind: 'command',
      body: { from: 'alice', op: 'run', op_id: 'o1', seq: 1, args: { script: 'applets/timed-send.ts', args_json: '{"delay_ms":10,"text":"ping"}' } },
    }));
    await until((f) => f.kind === 'Reply' && f.payload.id === 'r1' && f.payload.ok);
    assert.equal((await until((f) => f.kind === 'ShellReply')).payload.body, 'started a1');
    const say = await until((f) => f.kind === 'ShellOut');
    assert.deepEqual(say.payload, { client_id: CID, kind: 'say', body: { text: 'ping' } });

    conn.write(encode('Quiesce', { deadline_ms: 30000 }));
    assert.equal(await exited, 0);
  } finally {
    child.kill();
    server.close();
  }
});
