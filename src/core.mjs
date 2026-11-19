// The applet service logic, with no socket: frames in through onFrame(),
// frames out through send(kind, payload). service.mjs wires it to spt.
import { Worker } from 'node:worker_threads';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKER = new URL('./worker.mjs', import.meta.url);
export const STOP_GRACE_MS = 5000;

// Command args come keyed by the manifest arg names. Accept a positional
// array too, so a change of spt's shape fails soft.
function named(args, names) {
  if (Array.isArray(args)) return Object.fromEntries(names.map((n, i) => [n, args[i]]));
  return args ?? {};
}

export function createCore({ send, adapterDir }) {
  const clients = new Map();  // client_id -> shell client record
  const applets = new Map();  // `${client_id}/${applet_id}` -> applet
  const counters = new Map(); // client_id -> last applet number
  const seenOps = new Set();  // op_ids already handled (delivery is at least once)

  const say = (clientId, text) => send('ShellOut', { client_id: clientId, kind: 'say', body: { text } });
  const reply = (opId, body) => send('ShellReply', { op_id: opId, body });

  function forClient(clientId) {
    return [...applets.values()].filter((a) => a.clientId === clientId);
  }

  function finish(a, message) {
    if (!applets.delete(a.key)) return;
    clearTimeout(a.killTimer);
    a.worker.terminate();
    // [impl->REQ-APPLET-END-SILENT] a normal end sends nothing (decision D2)
    if (message) say(a.clientId, message);
  }

  // [impl->REQ-APPLET-RUN]
  function run(clientId, { script, args_json }) {
    if (!script) throw new Error('run needs a script path');
    const path = isAbsolute(script) ? script : resolve(adapterDir, script);
    const args = args_json ? JSON.parse(args_json) : {};
    const n = (counters.get(clientId) ?? 0) + 1;
    counters.set(clientId, n);
    const id = `a${n}`;
    const worker = new Worker(WORKER, { workerData: { id, url: pathToFileURL(path).href, args } });
    const a = { key: `${clientId}/${id}`, id, clientId, script: path, started: Date.now(), worker };
    applets.set(a.key, a);
    worker.on('message', (m) => {
      if (m.type === 'say') say(clientId, m.text);
      else if (m.type === 'done') finish(a);
      else if (m.type === 'error') finish(a, `applet ${id} failed: ${m.message}`);
    });
    worker.on('error', (e) => finish(a, `applet ${id} failed: ${e?.stack ?? e}`));
    worker.on('exit', () => finish(a, a.stopping ? null : `applet ${id} exited`));
    return `started ${id}`;
  }

  // [impl->REQ-APPLET-STOP]
  function stop(a) {
    a.stopping = true;
    a.worker.postMessage({ type: 'stop' });
    a.killTimer = setTimeout(() => finish(a), STOP_GRACE_MS);
  }

  function command(clientId, { op, args }) {
    switch (op) {
      case 'run':
        return run(clientId, named(args, ['script', 'args_json']));
      case 'stop': {
        const { applet_id } = named(args, ['applet_id']);
        const a = applets.get(`${clientId}/${applet_id}`);
        if (!a) return `no applet ${applet_id}`;
        stop(a);
        return `stopping ${applet_id}`;
      }
      case 'list': {
        const rows = forClient(clientId).map((a) => `${a.id} ${a.script} ${new Date(a.started).toISOString()}`);
        return rows.length ? rows.join('\n') : 'no applets';
      }
      default:
        return `unknown op ${op}`;
    }
  }

  function join(c) {
    if (c?.kind === 'shell') clients.set(c.client_id, c);
  }

  function leave(clientId) {
    clients.delete(clientId);
    for (const a of forClient(clientId)) { a.stopping = true; finish(a); }
  }

  // Stop every applet; tell each owner what it lost. Used on Quiesce and
  // stop-requested: M0 applets do not survive a service restart.
  function stopAll() {
    for (const a of [...applets.values()]) {
      a.stopping = true;
      finish(a, `applet ${a.id} stopped: the applet service stopped`);
    }
  }

  function onFrame({ kind, payload: p }) {
    switch (kind) {
      case 'ClientList':
        clients.clear();
        for (const c of p.clients ?? []) join(c);
        for (const id of new Set([...applets.values()].map((a) => a.clientId))) {
          if (!clients.has(id)) leave(id);
        }
        return;
      case 'ClientJoin':
        return join(p.client);
      case 'ClientLeave':
        return leave(p.client_id);
      case 'Request': {
        // Ack every row first: an unacked row blocks the rows after it.
        // Unknown kinds (frame, owner_state, ...) are acked and ignored.
        send('Reply', { id: p.id, ok: true });
        if (p.kind !== 'command' || !clients.has(p.client_id)) return;
        const b = p.body ?? {};
        if (seenOps.has(b.op_id)) return;
        seenOps.add(b.op_id);
        if (seenOps.size > 4096) seenOps.delete(seenOps.values().next().value);
        let out;
        try { out = command(p.client_id, b); } catch (e) { out = `error: ${e.message}`; }
        reply(b.op_id, out);
        return;
      }
      default:
        return; // Quiesce is handled by service.mjs
    }
  }

  return { onFrame, stopAll, applets, clients };
}
