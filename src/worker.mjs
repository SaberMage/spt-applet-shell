// One applet run, inside its own worker thread. Talks to the service only
// through postMessage: {type: 'say', text} | {type: 'done'} | {type: 'error', message}.
import { parentPort, workerData } from 'node:worker_threads';

const { id, url, args } = workerData;
const controller = new AbortController();

parentPort.on('message', (m) => {
  if (m?.type === 'stop') controller.abort(new Error('stopped'));
});

// [impl->REQ-APPLET-CTX]
const ctx = {
  id,
  args,
  signal: controller.signal,
  sleep(ms) {
    return new Promise((resolve, reject) => {
      if (controller.signal.aborted) return reject(controller.signal.reason);
      const t = setTimeout(resolve, ms);
      controller.signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(controller.signal.reason);
      }, { once: true });
    });
  },
  async say(text) {
    parentPort.postMessage({ type: 'say', text: String(text) });
  },
};

try {
  const mod = await import(url);
  if (typeof mod.default !== 'function') throw new Error('the applet has no default export function');
  await mod.default(ctx);
  parentPort.postMessage({ type: 'done' });
} catch (e) {
  if (controller.signal.aborted) parentPort.postMessage({ type: 'done' });
  else parentPort.postMessage({ type: 'error', message: e?.stack ?? String(e) });
}
// The service terminates this worker on 'done' or 'error', so timers that the
// applet left behind do not keep it alive.
