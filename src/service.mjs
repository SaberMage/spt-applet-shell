// The applet service: the one process of the `applet` v2 shell adapter on a
// node. spt starts it; it connects back, says Hello, and serves frames.
import net from 'node:net';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode, FrameReader } from './frames.mjs';
import { createCore } from './core.mjs';

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 18)) {
  console.error(`applet service needs Node 22.18 or later (found ${process.versions.node})`);
  process.exit(2);
}

const { SPT_SERVICE_ENDPOINT: endpoint, SPT_SERVICE_TOKEN: token, SPT_SERVICE_DIR: dir } = process.env;
if (!endpoint || !token) {
  console.error('applet service: SPT_SERVICE_ENDPOINT and SPT_SERVICE_TOKEN must be set (spt starts this service)');
  process.exit(2);
}

// [impl->REQ-SERVICE-CONNECT]
const path = process.platform === 'win32' ? `\\\\.\\pipe\\${endpoint}` : `\0${endpoint}`;
const sock = net.connect(path);
const send = (kind, payload) => sock.write(encode(kind, payload));
const adapterDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = createCore({ send, adapterDir });
const reader = new FrameReader();

// Test only (tests/int, temp home), to check that spt's forced stop leaves no process:
// '1' ignores Quiesce; 'hang' blocks the event loop on Quiesce (Atomics.wait: no CPU load).
// 'hang' also blocks on the disconnect: a blocked event loop sees no close either.
// The mode is the text of <adapter_dir>/.applet-test-quiesce: only the int test writes it, in its
// extracted package (the daemon starts via WMI, so an env var does not reach this process).
// Each stop signal is logged to <adapter_dir>/applet-test.log.
const TEST_FILE = join(adapterDir, '.applet-test-quiesce');
const testQuiesce = existsSync(TEST_FILE) ? readFileSync(TEST_FILE, 'utf8').trim() : '';
function testStop(why) {
  if (!testQuiesce) return false;
  appendFileSync(join(adapterDir, 'applet-test.log'), `${new Date().toISOString()} pid ${process.pid} ${why} mode=${testQuiesce}
`);
  if (testQuiesce === 'hang') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  return true;
}

function shutdown(why = 'Quiesce') {
  if (testStop(why)) return;
  core.stopAll();
  sock.end(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

sock.on('connect', () => send('Hello', { token, protocol: 1 }));
sock.on('data', (chunk) => {
  for (const frame of reader.push(chunk)) {
    if (frame.kind === 'Quiesce') { shutdown(); continue; }
    core.onFrame(frame);
  }
});
// spt closed the connection (a replacement, a forced stop, or the daemon went away).
// [impl->REQ-SERVICE-NO-ORPHAN]
sock.on('close', () => { if (!testStop('close') || testQuiesce !== 'hang') process.exit(0); });
sock.on('error', (e) => { console.error(`applet service: ${e.message}`); if (!testStop('error') || testQuiesce !== 'hang') process.exit(1); });

if (dir) {
  setInterval(() => { if (existsSync(join(dir, 'stop-requested'))) shutdown('stop-requested'); }, 500).unref();
}
