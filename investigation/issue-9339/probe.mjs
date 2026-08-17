// Investigation harness for objectstack#9339 — NOT part of the product.
//
// Replicates `packages/metadata-fs/test/watch-write-registration.test.ts` up to
// line 166 (the anchor wait) and instruments every chokidar decision point on the
// delivery path for an external `fs.writeFile` after `ready`.
//
// Usage:
//   node probe.mjs [iterations] [--wait=ms] [--load=none|loop|pool|both] [--verbose]

import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileSystemRepository } from '/home/user/objectstack-9339/packages/metadata-fs/dist/index.js';
import { FSWatcher } from 'chokidar';
import { NodeFsHandler } from 'chokidar/handler.js';

const argv = process.argv.slice(2);
const iterations = Number(argv.find((a) => /^\d+$/.test(a)) ?? 20);
const WAIT_MS = Number((argv.find((a) => a.startsWith('--wait=')) ?? '--wait=6000').slice(7));
const LOAD = (argv.find((a) => a.startsWith('--load=')) ?? '--load=none').slice(7);
const VERBOSE = argv.includes('--verbose');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Instrumentation ─────────────────────────────────────────────────────
// One trace per iteration; the hooks below push into `trace`.
let trace = [];
let t0 = 0;
const rel = () => Math.round((performance.now() - t0) * 10) / 10;
const log = (kind, detail) => {
  trace.push({ t: rel(), kind, ...detail });
};

const origHandleRead = NodeFsHandler.prototype._handleRead;
NodeFsHandler.prototype._handleRead = function (directory, initialAdd, wh, target, dir, depth, throttler) {
  const before = this.fsw._throttled.get('readdir')?.get(path.join(directory, ''));
  log('_handleRead:enter', { dir: path.basename(directory), throttledAlready: Boolean(before) });
  const r = origHandleRead.call(this, directory, initialAdd, wh, target, dir, depth, throttler);
  return r;
};

const origHandleFile = NodeFsHandler.prototype._handleFile;
NodeFsHandler.prototype._handleFile = function (file, stats, initialAdd) {
  const parent = this.fsw._getWatchedDir(path.dirname(file));
  log('_handleFile', {
    file: path.basename(file),
    initialAdd,
    parentAlreadyHas: parent.has(path.basename(file)),
  });
  return origHandleFile.call(this, file, stats, initialAdd);
};

const origEmit = FSWatcher.prototype._emit;
FSWatcher.prototype._emit = function (event, p, stats) {
  const pending = this.options.awaitWriteFinish && this._pendingWrites.get(p);
  log('_emit', {
    event,
    file: typeof p === 'string' ? path.basename(p) : String(p),
    swallowedByPendingWrite: Boolean(pending),
    readyEmitted: this._readyEmitted,
  });
  return origEmit.call(this, event, p, stats);
};

const origRemove = FSWatcher.prototype._remove;
FSWatcher.prototype._remove = function (directory, item, isDirectory) {
  const relPath = path.join(directory, item);
  log('_remove', {
    file: item,
    hadPendingWrite: Boolean(this.options.awaitWriteFinish && this._pendingWrites.has(relPath)),
  });
  return origRemove.call(this, directory, item, isDirectory);
};

const origAwf = FSWatcher.prototype._awaitWriteFinish;
FSWatcher.prototype._awaitWriteFinish = function (p, threshold, event, awfEmit) {
  log('_awaitWriteFinish:start', { file: path.basename(p), event });
  return origAwf.call(this, p, threshold, event, (err, stats) => {
    log('_awaitWriteFinish:fire', { file: path.basename(p), event, err: err ? String(err.code ?? err) : null, hasStats: Boolean(stats) });
    return awfEmit(err, stats);
  });
};

// ── Load generators ─────────────────────────────────────────────────────
let loadTimers = [];
function startLoad(kind) {
  if (kind === 'none') return;
  if (kind === 'loop' || kind === 'both') {
    // Block the event loop in bursts — the shape a saturated vitest worker has.
    const t = setInterval(() => {
      const end = Date.now() + 60 + Math.random() * 140;
      while (Date.now() < end) {
        /* spin */
      }
    }, 40);
    loadTimers.push(t);
  }
  if (kind === 'pool' || kind === 'both') {
    // Saturate the libuv threadpool (default size 4), which is what services
    // uv_fs_poll's stat() calls.
    const spam = () => {
      for (let i = 0; i < 64; i++) {
        fssync.readFile('/proc/self/stat', () => {});
        fssync.readdir(os.tmpdir(), () => {});
      }
    };
    const t = setInterval(spam, 10);
    loadTimers.push(t);
  }
}
function stopLoad() {
  loadTimers.forEach(clearInterval);
  loadTimers = [];
}

// ── One iteration ───────────────────────────────────────────────────────
async function once(i) {
  trace = [];
  t0 = performance.now();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'os9339-'));
  const viewDir = path.join(root, 'view');
  await fs.mkdir(viewDir, { recursive: true });
  await fs.writeFile(path.join(viewDir, 'seed.json'), JSON.stringify({ label: 'seed' }, null, 2));

  const repo = new FileSystemRepository({ root, org: 'system' });
  await repo.start();
  const w = repo.watcher;
  if (!w) throw new Error('watcher not armed');
  w.on('raw', (ev, p, det) => {
    if (!VERBOSE && !String(p).includes('view')) return;
    log('raw', {
      ev,
      file: path.basename(String(p)),
      currM: det?.curr?.mtimeMs,
      prevM: det?.prev?.mtimeMs,
      currSize: det?.curr?.size,
      prevSize: det?.prev?.size,
      passedFilter:
        det?.curr && det?.prev
          ? det.curr.size !== det.prev.size || det.curr.mtimeMs > det.prev.mtimeMs || det.curr.mtimeMs === 0
          : null,
    });
  });

  const scanned = new Promise((res) => w.once('ready', res));
  const iter = repo.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
  const events = [];
  let resolveNext = null;
  const nextEvent = () => new Promise((res) => { resolveNext = res; });
  const drain = async () => {
    for (;;) {
      const next = await iter.next();
      if (next.done) return;
      events.push(next.value);
      log('repoEvent', { name: next.value.ref.name, op: next.value.op });
      resolveNext?.();
    }
  };
  void drain();

  await Promise.race([scanned, sleep(WAIT_MS)]);
  log('ready', {});
  const watchedAfterReady = w.getWatched()[viewDir] ?? [];
  const seedOk = watchedAfterReady.includes('seed.json');

  const anchored = nextEvent();
  const dirStatBefore = await fs.stat(viewDir);
  await fs.writeFile(path.join(viewDir, 'anchor.json'), JSON.stringify({ label: 'anchor' }, null, 2));
  const dirStatAfter = await fs.stat(viewDir);
  log('anchorWritten', {
    dirMtimeBefore: dirStatBefore.mtimeMs,
    dirMtimeAfter: dirStatAfter.mtimeMs,
    dirSizeBefore: dirStatBefore.size,
    dirSizeAfter: dirStatAfter.size,
    mtimeAdvanced: dirStatAfter.mtimeMs > dirStatBefore.mtimeMs,
  });
  await Promise.race([anchored, sleep(WAIT_MS)]);

  const got = events.map((e) => e.ref.name).includes('anchor');
  const snapshot = {
    watchedView: w.getWatched()[viewDir] ?? [],
    pendingWrites: [...w._pendingWrites.keys()].map((k) => path.basename(k)),
    throttledReaddir: [...(w._throttled.get('readdir')?.keys() ?? [])].map((k) => path.basename(k)),
    readyEmitted: w._readyEmitted,
    watcherClosed: w.closed,
  };

  await iter.return?.(undefined);
  await repo.close().catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });

  return { i, seedOk, got, snapshot, trace: trace.slice() };
}

// ── Driver ──────────────────────────────────────────────────────────────
const failures = [];
startLoad(LOAD);
for (let i = 0; i < iterations; i++) {
  const r = await once(i);
  const tag = r.got ? 'PASS' : 'FAIL';
  console.log(`[${i}] ${tag} seedRegistered=${r.seedOk} watchedView=${JSON.stringify(r.snapshot.watchedView)}`);
  if (!r.got || process.env.DUMP_ALL) failures.push(r);
}
stopLoad();

console.log(`\n=== ${iterations - failures.length}/${iterations} delivered the anchor event (load=${LOAD}, wait=${WAIT_MS}ms) ===`);
for (const f of failures) {
  console.log(`\n--- FAILURE iteration ${f.i} ---`);
  console.log('snapshot:', JSON.stringify(f.snapshot, null, 2));
  console.log('trace:');
  for (const e of f.trace) console.log('  ', JSON.stringify(e));
}
process.exit(failures.length ? 1 : 0);
