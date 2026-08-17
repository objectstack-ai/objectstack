// Investigation harness for objectstack#9339 — NOT part of the product.
//
// The anchor phase of `watch-write-registration.test.ts` hangs off ONE directory
// mtime edge and traverses ~7 steps, none of which is retried. This harness
// forces each step to fail and records the resulting OBSERVABLE, so the CI
// signature (`events === []`, seed.json registered, deadline-immune) can be
// matched against candidates instead of guessed at.
//
// Usage: node inject.mjs <mode> [--wait=ms]
//   modes: none | mtime-tie | readdir-throttle | add-throttle | pending-write
//          | awf-enoent | readdirp-miss

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileSystemRepository } from '/home/user/objectstack-9339/packages/metadata-fs/dist/index.js';
import { FSWatcher } from 'chokidar';
import { NodeFsHandler } from 'chokidar/handler.js';

const MODE = process.argv[2] ?? 'none';
const WAIT_MS = Number((process.argv.find((a) => a.startsWith('--wait=')) ?? '--wait=6000').slice(7));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Injection state, armed only for the anchor path ──────────────────────
let anchorPath = null;
let armed = false;

const origHandleFile = NodeFsHandler.prototype._handleFile;
NodeFsHandler.prototype._handleFile = function (file, stats, initialAdd) {
  if (armed && MODE === 'add-throttle' && file === anchorPath) {
    // Occupy the ('add', file) throttle slot so `_handleFile`'s own
    // `_throttle(EV.ADD, file, 0)` returns false — the file is still handed to
    // `_watchWithNodeFs` (and so lands in getWatched) but no `add` is emitted.
    this.fsw._throttle('add', file, 5000);
  }
  return origHandleFile.call(this, file, stats, initialAdd);
};

const origReaddirp = FSWatcher.prototype._readdirp;
FSWatcher.prototype._readdirp = function (root, opts) {
  const stream = origReaddirp.call(this, root, opts);
  if (armed && MODE === 'readdirp-miss' && stream) {
    armed = false; // one shot: the FIRST poll read misses the anchor
    const origOn = stream.on.bind(stream);
    stream.on = (ev, fn) => {
      if (ev === 'data') {
        return origOn(ev, (entry) => {
          if (entry && path.basename(entry.fullPath ?? entry.path ?? '') === 'anchor.json') return;
          return fn(entry);
        });
      }
      return origOn(ev, fn);
    };
  }
  return stream;
};

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'os9339i-'));
  const viewDir = path.join(root, 'view');
  await fs.mkdir(viewDir, { recursive: true });
  await fs.writeFile(path.join(viewDir, 'seed.json'), JSON.stringify({ label: 'seed' }, null, 2));

  const repo = new FileSystemRepository({ root, org: 'system' });
  await repo.start();
  const w = repo.watcher;
  const scanned = new Promise((res) => w.once('ready', res));

  const iter = repo.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
  const events = [];
  const drain = async () => {
    for (;;) {
      const n = await iter.next();
      if (n.done) return;
      events.push(n.value);
    }
  };
  void drain();

  await Promise.race([scanned, sleep(WAIT_MS)]);
  const seedOk = (w.getWatched()[viewDir] ?? []).includes('seed.json');

  anchorPath = path.join(viewDir, 'anchor.json');
  armed = true;

  if (MODE === 'readdir-throttle') {
    // Hold the per-directory readdir throttle across the one poll that could
    // have discovered the anchor. Nothing reschedules the skipped read.
    w._throttle('readdir', path.join(viewDir, ''), 5000);
  }
  if (MODE === 'pending-write') {
    // A leaked awaitWriteFinish entry for this exact path: `_emit` bumps
    // lastChange and returns, forever.
    w._pendingWrites.set(anchorPath, { lastChange: new Date(), cancelWait: () => 'add' });
  }
  if (MODE === 'awf-enoent') {
    const origAwf = FSWatcher.prototype._awaitWriteFinish;
    FSWatcher.prototype._awaitWriteFinish = function (p, threshold, event, awfEmit) {
      if (p === anchorPath) {
        // Reproduce the ENOENT early-return in chokidar's awaitWriteFinishFn:
        // the entry is created and never deleted, and no emit is scheduled.
        this._pendingWrites.set(p, { lastChange: new Date(), cancelWait: () => event });
        return;
      }
      return origAwf.call(this, p, threshold, event, awfEmit);
    };
  }

  const before = await fs.stat(viewDir);
  await fs.writeFile(anchorPath, JSON.stringify({ label: 'anchor' }, null, 2));
  if (MODE === 'mtime-tie') {
    // The directory's mtime does not STRICTLY advance past what the previous
    // poll recorded. chokidar's poll filter is
    //   curr.size !== prev.size || curr.mtimeMs > prev.mtimeMs || curr.mtimeMs === 0
    // and an ext4 directory's size does not change when an entry is added.
    await fs.utimes(viewDir, before.atime, before.mtime);
  }
  const after = await fs.stat(viewDir);

  await sleep(WAIT_MS);
  const watched = w.getWatched()[viewDir] ?? [];
  const out = {
    mode: MODE,
    seedRegisteredAtLine155: seedOk,
    eventsDelivered: events.map((e) => `${e.ref.name}:${e.op}`),
    anchorDelivered: events.some((e) => e.ref.name === 'anchor'),
    watchedView: watched,
    anchorInWatchedSet: watched.includes('anchor.json'),
    dirMtimeAdvanced: after.mtimeMs > before.mtimeMs,
    dirSizeChanged: after.size !== before.size,
    pollsWaited: Math.floor(WAIT_MS / 1000),
  };

  await iter.return?.(undefined);
  await repo.close().catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
  return out;
}

console.log(JSON.stringify(await run(), null, 2));
process.exit(0);
