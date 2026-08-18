// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FileSystemRepository` — Node-only implementation of
 * `MetadataRepository` backed by JSON files plus a JSONL change log.
 *
 * See `README.md` for the on-disk layout and ADR-0008 §10 PR-4 for the
 * design rationale.
 *
 * Invariants
 * ──────────
 *   - All `put` / `delete` ops serialize per-key via `KeyedMutex`.
 *   - The change-log JSONL is the durable source of `seq`. On boot we
 *     scan the log to learn the next seq value.
 *   - Body files (`<type>/<name>.json`) are the source of truth; the
 *     log is a denormalised history index.
 *   - chokidar-driven external edits are translated into MetadataEvents
 *     by hashing the new content and comparing to the last-known hash.
 *   - The root directory is created **on the first write, not on attach**
 *     (#7000). Attaching and reading a repository whose root does not exist
 *     is legal and answers "empty"; see `start()` / `ensureRoot()`.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';
import {
  type MetadataRepository,
  type MetaRef,
  type MetadataItem,
  type MetadataItemHeader,
  type MetadataEvent,
  type PutOptions,
  type PutResult,
  type DeleteOptions,
  type DeleteResult,
  type ListFilter,
  type WatchFilter,
  type HistoryOptions,
  type MetadataType,
  hashSpec,
  ConflictError,
  refKey,
} from '@objectstack/metadata-core';
import {
  type FsLayout,
  itemPath,
  parseItemPath,
  typeDir,
  logFile,
} from './layout.js';
import { JsonlLog } from './jsonl-log.js';
import { KeyedMutex, createBroker, type EventBroker } from './sync.js';
import { createWatchIterable } from './watch-iterable.js';

export interface FileSystemRepositoryOptions {
  /** Absolute path to the metadata root directory. */
  root: string;
  /** Tenant/org. */
  org: string;
  /** Identity reported in events that originate from external FS edits. */
  fsActor?: string;
  /** Disable chokidar watcher (e.g. for read-only contexts). */
  disableWatch?: boolean;
  /** Optional clock injection for deterministic tests. */
  now?: () => Date;
}

const matchRefFilter = (
  ref: MetaRef,
  filter: { org?: string; type?: MetadataType; name?: string },
): boolean => {
  if (filter.org && filter.org !== ref.org) return false;
  if (filter.type && filter.type !== ref.type) return false;
  if (filter.name && filter.name !== ref.name) return false;
  return true;
};

const matchEvent = (evt: MetadataEvent, filter: WatchFilter): boolean => matchRefFilter(evt.ref, filter);

/**
 * Cadence of the content-keyed reconciliation sweep (#9339).
 *
 * Twice the watcher's own 1000ms poll interval: long enough that the watcher
 * normally delivers first and the sweep finds nothing to do, short enough that
 * a delivery the watcher lost is recovered in the same order of magnitude as a
 * poll rather than at the next process restart.
 *
 * It is deliberately NOT derived from `interval` at runtime. The two are
 * independent knobs — the poll interval sets detection latency for the fast
 * path, this sets the worst-case latency of the backstop — and coupling them
 * would make a future change to one silently retune the other.
 */
const RESYNC_INTERVAL_MS = 2_000;

/**
 * The ONE errno that is a truthful "there is nothing here" for a directory
 * read, as opposed to "the read could not run" (#8895 — discriminate or
 * propagate). A path that does not exist holds no items, so answering with an
 * empty listing states a fact. Every other code — EACCES, EIO, ENOTDIR, and
 * above all EMFILE/ENFILE under fd exhaustion — means the answer was never
 * obtained, and inventing an empty one there is the defect itself.
 */
const isEnoent = (err: unknown): boolean =>
  (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';

export class FileSystemRepository implements MetadataRepository {
  private readonly layout: FsLayout;
  private readonly org: string;
  private readonly fsActor: string;
  private readonly disableWatch: boolean;
  private readonly now: () => Date;
  private readonly log: JsonlLog;
  private readonly mutex = new KeyedMutex();
  private readonly broker: EventBroker = createBroker(matchEvent);

  /** In-memory index: refKey → current hash (HEAD). */
  private readonly heads = new Map<string, string>();
  /** Next seq counter, hydrated from the log on `start()`. */
  private nextSeq = 1;
  private watcher: FSWatcher | null = null;
  private started = false;
  /** Pending reconciliation sweep (#9339). Chained, never overlapping. */
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  /** False before the watcher is armed and from `close()` onwards. */
  private resyncEnabled = false;
  /**
   * Sweep read faults already reported, keyed `CODE @ path`, so a standing
   * fault is announced once rather than every 2s (AGENTS.md: say it once, at
   * the first degradation). An entry is cleared when that path reads again.
   */
  private readonly resyncFaults = new Set<string>();

  constructor(opts: FileSystemRepositoryOptions) {
    this.org = opts.org;
    this.fsActor = opts.fsActor ?? 'fs';
    this.disableWatch = opts.disableWatch ?? false;
    this.now = opts.now ?? (() => new Date());
    this.layout = { root: path.resolve(opts.root) };
    this.log = new JsonlLog(logFile(this.layout));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Attach the repository. **Creates nothing on disk** (#7000).
   *
   * Attaching is not a write. `start()` used to `mkdir` both the root and
   * `<root>/.objectstack/.log` unconditionally, which meant every read-only
   * boot that merely attaches a repository left a skeleton behind — most
   * visibly `os migrate plan`, a declared dry run, on a project that has
   * never been started. That is the same property #6743 ruled on for
   * `.objectstack/data/`: a dry run leaves nothing behind, and the existence
   * of `.objectstack/` has to stay a usable "this project has been started"
   * signal.
   *
   * Every read path below already treats a missing root as an empty
   * repository (`scanHeads` swallows ENOENT, `JsonlLog` guards on
   * `existsSync`, `get` guards on `existsSync`), so the root is materialized
   * by `ensureRoot()` on the first write instead.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // 1) Scan body files to build the head index. No-op on a missing root.
    await this.scanHeads();

    // 2) Hydrate nextSeq from the existing log. No-op on a missing log.
    const highest = await this.log.highestSeq();
    this.nextSeq = highest + 1;

    // 3) Start the watcher (unless disabled). chokidar cannot watch a path
    //    that does not exist yet: measured on chokidar 5 with `usePolling`,
    //    a root created AFTER `watch()` produces no events at all, ever. So
    //    when the root is absent the watcher is armed later, by the
    //    `ensureRoot()` call that brings the root into existence — otherwise
    //    dropping the `mkdir` above would silently kill external-edit
    //    detection for the whole life of the process.
    if (!this.disableWatch && existsSync(this.layout.root)) this.startWatcher();
  }

  /**
   * Bring the repository root into existence. Called by every write path
   * immediately before it touches the disk — `start()` deliberately does not
   * create it (#7000), so this is the single seam where the root appears.
   *
   * It is also where a watcher that `start()` could not arm (missing root)
   * gets armed, so "external edits are detected" survives the change.
   */
  private async ensureRoot(): Promise<void> {
    await fs.mkdir(this.layout.root, { recursive: true });
    if (this.started && !this.disableWatch && !this.watcher) this.startWatcher();
  }

  async close(): Promise<void> {
    // Retire the sweep BEFORE awaiting the watcher, so a sweep that lands
    // during `watcher.close()` cannot reschedule itself behind our back.
    this.stopResync();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.started = false;
  }

  // ── Read API ────────────────────────────────────────────────────────

  async get(ref: MetaRef): Promise<MetadataItem | null> {
    this.assertScope(ref);
    const file = itemPath(this.layout, ref.type, ref.name);
    if (!existsSync(file)) return null;
    const body = await readJson(file);
    if (!body) return null;
    const hash = hashSpec(body);
    if (ref.version && ref.version !== hash) return null;
    // Walk back through the log to populate parent/authoredBy/seq.
    const meta = await this.findMetaForHash(ref, hash);
    return {
      ref: { ...ref, version: undefined },
      body: body as Record<string, unknown>,
      hash,
      parentHash: meta?.parentHash ?? null,
      authoredBy: meta?.actor ?? this.fsActor,
      authoredAt: meta?.ts ?? new Date(0).toISOString(),
      message: meta?.message,
      seq: meta?.seq ?? 0,
    };
  }

  async getByHash(ref: MetaRef, hash: string): Promise<MetadataItem | null> {
    // FS repo stores only HEAD bodies on disk; the JSONL log records
    // events (hashes) but not historical bodies. Resolve only if the
    // requested hash matches HEAD.
    const head = await this.get(ref);
    if (!head || head.hash !== hash) return null;
    return head;
  }

  async *list(filter: ListFilter): AsyncIterable<MetadataItemHeader> {
    const limit = filter.limit ?? Infinity;
    let yielded = 0;
    for (const [key, hash] of this.heads) {
      const ref = parseRefKey(key);
      if (!ref) continue;
      if (!matchRefFilter(ref, filter)) continue;
      if (filter.nameContains && !ref.name.includes(filter.nameContains)) continue;
      const meta = await this.findMetaForHash(ref, hash);
      const header: MetadataItemHeader = {
        ref: { ...ref, version: undefined },
        hash,
        parentHash: meta?.parentHash ?? null,
        authoredBy: meta?.actor ?? this.fsActor,
        authoredAt: meta?.ts ?? new Date(0).toISOString(),
        message: meta?.message,
        seq: meta?.seq ?? 0,
      };
      yield header;
      if (++yielded >= limit) return;
    }
  }

  async *history(ref: MetaRef, opts: HistoryOptions = {}): AsyncIterable<MetadataEvent> {
    this.assertScope(ref);
    const since = opts.sinceSeq ?? -1;
    const limit = opts.limit ?? Infinity;
    let yielded = 0;
    for await (const evt of this.log.readAll()) {
      if (evt.seq <= since) continue;
      if (evt.ref.type !== ref.type || evt.ref.name !== ref.name) continue;
      if (evt.ref.org !== ref.org) continue;
      yield evt;
      if (++yielded >= limit) return;
    }
  }

  watch(filter: WatchFilter, since?: number): AsyncIterable<MetadataEvent> {
    // Eagerly snapshot the existing log for replay; new events route via broker.
    const replay: MetadataEvent[] = [];
    const promise = (async () => {
      for await (const evt of this.log.readAll()) {
        if (matchEvent(evt, filter)) replay.push(evt);
      }
    })();
    // We must await replay before returning, but the public API is
    // sync-returning AsyncIterable. Wrap in a deferred iterable.
    return deferredIterable(promise.then(() =>
      createWatchIterable({
        filter,
        since,
        replay,
        broker: this.broker,
        matches: matchEvent,
        branchKeyOf: (e) => e.ref.org,
      }),
    ));
  }

  // ── Write API ───────────────────────────────────────────────────────

  put(ref: MetaRef, spec: unknown, opts: PutOptions): Promise<PutResult> {
    this.assertScope(ref);
    return this.mutex.run(refKey(ref), async () => {
      const key = refKey(ref);
      const currentHead = this.heads.get(key) ?? null;
      if ((opts.parentVersion ?? null) !== currentHead) {
        throw new ConflictError(ref, opts.parentVersion ?? null, currentHead);
      }
      const hash = hashSpec(spec);
      if (currentHead === hash) {
        // No-op write — same content.
        const meta = await this.findMetaForHash(ref, hash);
        return {
          version: hash,
          seq: meta?.seq ?? 0,
          item: {
            ref: { ...ref, version: undefined },
            body: spec as Record<string, unknown>,
            hash,
            parentHash: meta?.parentHash ?? null,
            authoredBy: meta?.actor ?? this.fsActor,
            authoredAt: meta?.ts ?? this.now().toISOString(),
            message: meta?.message,
            seq: meta?.seq ?? 0,
          },
        };
      }

      const seq = this.nextSeq++;
      const ts = this.now().toISOString();
      const file = itemPath(this.layout, ref.type, ref.name);
      // First write of the process materializes the root (#7000).
      await this.ensureRoot();
      await fs.mkdir(typeDir(this.layout, ref.type), { recursive: true });
      await writeJsonAtomic(file, spec);
      // The watcher must not depend on its own directory scan to notice a
      // path we created ourselves (#7282). See `trackWrittenPath`.
      this.trackWrittenPath(file);
      // Publishing the new head here is what suppresses the watcher event this
      // write is about to produce — see `handleFsChange` (#7335). It runs in
      // the same continuation as the `rename` above, and `awaitWriteFinish`
      // holds any event for a further `stabilityThreshold`, so the index is
      // always current by the time an event for this path can be delivered.
      this.heads.set(key, hash);

      const evt: MetadataEvent = {
        seq,
        op: currentHead ? 'update' : 'create',
        ref: { ...ref, version: undefined },
        hash,
        parentHash: currentHead,
        actor: opts.actor,
        message: opts.message,
        ts,
        source: opts.source ?? 'fs',
      };
      await this.log.append(evt);
      this.broker.publish(evt);

      return {
        version: hash,
        seq,
        item: {
          ref: { ...ref, version: undefined },
          body: spec as Record<string, unknown>,
          hash,
          parentHash: currentHead,
          authoredBy: opts.actor,
          authoredAt: ts,
          message: opts.message,
          seq,
        },
      };
    });
  }

  delete(ref: MetaRef, opts: DeleteOptions): Promise<DeleteResult> {
    this.assertScope(ref);
    return this.mutex.run(refKey(ref), async () => {
      const key = refKey(ref);
      const currentHead = this.heads.get(key) ?? null;
      if (currentHead !== opts.parentVersion) {
        throw new ConflictError(ref, opts.parentVersion, currentHead);
      }
      const file = itemPath(this.layout, ref.type, ref.name);
      // A delete appends a tombstone to the change log, so it is a write too.
      await this.ensureRoot();
      // Retire the head BEFORE touching the disk, not after (#7335).
      //
      // `awaitWriteFinish` only debounces `add`/`change`; chokidar emits
      // `unlink` with no stability delay at all, so — unlike `put()` — this
      // face has no cushion between the disk mutation and the event it
      // produces. Clearing the index first makes `handleFsChange`'s
      // `if (!currentHead) return` a total suppression for our own removal
      // rather than a race against the poll callback.
      this.heads.delete(key);
      try {
        if (existsSync(file)) await fs.unlink(file);
      } catch (err) {
        // The disk still holds the item, so the index must too — otherwise a
        // failed delete would leave the repository claiming a file it can
        // still read. Restores exactly the pre-call state before rethrowing.
        if (currentHead !== null) this.heads.set(key, currentHead);
        throw err;
      }
      const seq = this.nextSeq++;
      const ts = this.now().toISOString();
      const evt: MetadataEvent = {
        seq,
        op: 'delete',
        ref: { ...ref, version: undefined },
        hash: null,
        parentHash: currentHead,
        actor: opts.actor,
        message: opts.message,
        ts,
        source: opts.source ?? 'fs',
      };
      await this.log.append(evt);
      this.broker.publish(evt);
      return { seq };
    });
  }

  // ── Internals ───────────────────────────────────────────────────────

  private assertScope(ref: MetaRef): void {
    if (ref.org !== this.org) {
      throw new Error(
        `FileSystemRepository scope mismatch: expected org=${this.org}, got org=${ref.org}`,
      );
    }
  }

  private async scanHeads(): Promise<void> {
    this.heads.clear();
    // Walk one level deep: <root>/<type>/<name>.json
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(this.layout.root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      const type = entry.name;
      const dir = path.join(this.layout.root, type);
      let files: string[] = [];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const name = file.slice(0, -'.json'.length);
        const ref: MetaRef = {
          org: this.org,
          type: type as MetadataType,
          name,
        };
        const body = await readJson(path.join(dir, file));
        if (!body) continue;
        this.heads.set(refKey(ref), hashSpec(body));
      }
    }
  }

  private async findMetaForHash(
    ref: MetaRef,
    hash: string,
  ): Promise<MetadataEvent | null> {
    let last: MetadataEvent | null = null;
    for await (const evt of this.log.readAll()) {
      if (evt.ref.type !== ref.type || evt.ref.name !== ref.name) continue;
      if (evt.ref.org !== ref.org) continue;
      if (evt.hash === hash) last = evt;
    }
    return last;
  }

  /**
   * Register a path this repository just wrote with the watcher (#7282).
   *
   * chokidar's initial scan is asynchronous, and every write path here can be
   * running **while it is still walking the tree** — `start()` arms the watcher
   * and the caller may `put()` on the next tick, and `ensureRoot()` arms it in
   * the middle of the very first write. With `usePolling` that combination has
   * a permanently-blinding interleaving, measured on chokidar 5 with this
   * repository's own options:
   *
   *   1. chokidar reads `<root>/<type>/` and finds it EMPTY — the atomic
   *      `rename` in `writeJsonAtomic` has not landed yet.
   *   2. the rename lands; the directory's mtime changes.
   *   3. chokidar calls `watchFile()` on that directory, and libuv takes its
   *      polling baseline stat — which already reflects step 2.
   *
   * From then on the directory's stat never changes again, so no poll ever
   * fires for it, `_handleRead` never re-runs, the item file is never added to
   * the watched set, and no per-file watcher is ever created. chokidar emits
   * neither `add` nor `change` for that path **for the life of the process** —
   * `getWatched()` reports the type directory as `[]` forever while the file
   * sits in it. That is the whole of #7282: the four merge-queue ejections all
   * waited out their deadlines (20s, then 25541ms against 25s) on an event that
   * was never going to be delivered, which is why widening the deadline and
   * widening the pre-edit sleep both changed nothing, and why lowering
   * `interval` would change nothing either — a shorter poll re-compares against
   * the same unchanged directory stat.
   *
   * The window is exactly "files that exist at baseline time but were absent
   * from the snapshot read a moment earlier", and the only writer that can be
   * inside it is us. So we close it at the source: tell the watcher explicitly
   * about every path we create, instead of hoping its scan happened to see it.
   *
   * `add()` is idempotent here — `_handleFile` returns early when the parent
   * directory already tracks the basename — and it emits nothing, because
   * chokidar treats an explicit `add()` as an initial add and `ignoreInitial`
   * is set. Its effect is the one we need: `_watchWithNodeFs` registers the
   * basename with the parent directory (without which chokidar drops `change`
   * events for the file) and starts the per-file poll.
   */
  private trackWrittenPath(file: string): void {
    const w = this.watcher;
    // `add()` clears `closed`, so never hand a closing watcher a new path.
    if (!w || w.closed) return;
    w.add(file);
  }

  private startWatcher(): void {
    const root = this.layout.root;
    const w = chokidar.watch(root, {
      // Skip dotfiles under the root — including the repository's own
      // `.objectstack/` bookkeeping subtree — matched on the path RELATIVE
      // to the watch root (#7150). See `isIgnoredWatchPath`.
      ignored: (p: string) => isIgnoredWatchPath(root, p),
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
      // Use polling to avoid `fs.watch` EMFILE on macOS / busy dev hosts.
      // The depth-2 recursion would otherwise wire native watches across
      // the entire customization tree.
      usePolling: true,
      interval: 1000,
      binaryInterval: 2000,
    });
    w.on('add', (p) => void this.handleFsChange(p, 'add'));
    w.on('change', (p) => void this.handleFsChange(p, 'change'));
    w.on('unlink', (p) => void this.handleFsChange(p, 'unlink'));
    this.watcher = w;
    // The watcher is the fast path, not the guarantee (#9339). See `resync`.
    this.startResync();
  }

  /**
   * Publish the `delete` face of an externally-observed removal.
   *
   * Extracted from `handleFsChange` unchanged so the reconciliation sweep
   * (#9339) can reuse it **verbatim** rather than growing a second copy of the
   * event shape. The one-line invariant: the caller already holds the per-key
   * mutex, and `!currentHead` is the content-keyed suppression that makes our
   * own `delete()` a no-op here.
   */
  private async publishExternalDelete(ref: MetaRef, key: string): Promise<void> {
    const currentHead = this.heads.get(key) ?? null;
    if (!currentHead) return;
    this.heads.delete(key);
    const seq = this.nextSeq++;
    const evt: MetadataEvent = {
      seq,
      op: 'delete',
      ref: { ...ref, version: undefined },
      hash: null,
      parentHash: currentHead,
      actor: this.fsActor,
      ts: this.now().toISOString(),
      source: 'fs',
    };
    await this.log.append(evt);
    this.broker.publish(evt);
  }

  private startResync(): void {
    this.resyncEnabled = true;
    this.scheduleResync();
  }

  private stopResync(): void {
    this.resyncEnabled = false;
    if (this.resyncTimer) {
      clearTimeout(this.resyncTimer);
      this.resyncTimer = null;
    }
  }

  /**
   * Schedule the next sweep — chained, never `setInterval` (#9339).
   *
   * A chained timeout cannot stack: the next sweep is armed only once the
   * previous one has finished, so a saturated runner degrades to *fewer*
   * sweeps instead of a growing backlog of overlapping tree walks. The timer
   * is `unref`ed because a backstop must never be the reason a process stays
   * alive.
   */
  private scheduleResync(): void {
    if (!this.resyncEnabled || this.resyncTimer) return;
    const timer = setTimeout(() => {
      this.resyncTimer = null;
      void this.resync().finally(() => this.scheduleResync());
    }, RESYNC_INTERVAL_MS);
    timer.unref?.();
    this.resyncTimer = timer;
  }

  /**
   * Announce a sweep read that could not run — the non-silence half of #8895's
   * "discriminate or propagate".
   *
   * ## Why `error` and not `warn`
   *
   * AGENTS.md decides the level with one question: *after the degradation, does
   * the system still look "normal" from the outside while something it claims
   * is persisted has not actually landed?* Here it does. Nothing throws, the
   * watcher stays armed, `getWatched()` stays populated, `start()` succeeded —
   * and the repository's index quietly stops tracking what is on disk. That is
   * the rule's second limb verbatim ("persisted state and runtime state
   * disagree"), not the functional-degradation limb: no capability is visibly
   * smaller, so nobody finds out by using the missing thing.
   *
   * The counter-argument — *this is only a backstop, the watcher is still the
   * fast path* — is why the level is arguable, and it does not survive the
   * failing errno. The sharp case is fd exhaustion: EMFILE/ENFILE break this
   * `readdir` and chokidar's `fs.watchFile` polling **at the same time and for
   * the same reason**, so the fast path is not an independent fallback under
   * precisely the load that produces this fault. A backstop that is silently
   * absent whenever it is most needed is a durability-shaped degradation.
   *
   * ⚠️ AGENTS.md also warns against over-applying `error`, and the discipline
   * that answers it is the ledger, not a quieter level: an `error` owes the
   * consequence and the fix, said **once** at the first degradation rather than
   * once per failed read. A sweep runs every 2s forever, so an unlatched
   * `console.error` here would be the mirror-image failure the same rule names.
   *
   * ⛔ It deliberately does NOT throw. This runs on a background timer; taking
   * a process down on a transient EACCES would be worse than the bug. The bar
   * met here is non-silence, not propagation.
   *
   * The channel is `console.error` because this class has no logger: nothing is
   * injected through `FileSystemRepositoryOptions`, and widening that public
   * surface to carry one is out of scope for this fix.
   */
  private reportResyncFault(target: string, err: unknown): void {
    const code = (err as NodeJS.ErrnoException | null)?.code ?? 'UNKNOWN';
    const key = `${code} @ ${target}`;
    if (this.resyncFaults.has(key)) return;
    this.resyncFaults.add(key);
    console.error(
      `[FileSystemRepository] metadata reconciliation sweep could not read ${target} (${code}). ` +
        `CONSEQUENCE: external edits under this path are no longer reconciled, so this ` +
        `repository's index and its watch() subscribers can drift from what is on disk while ` +
        `everything keeps reporting healthy. The chokidar watcher is not an independent ` +
        `fallback here — fd exhaustion degrades both. ` +
        `FIX: restore read access to the path; the sweep recovers by itself on the first ` +
        `successful read. Reported once per path and error code.`,
    );
  }

  /** Re-arm reporting for a path that reads again, so a recurrence is heard. */
  private clearResyncFault(target: string): void {
    if (this.resyncFaults.size === 0) return;
    const suffix = ` @ ${target}`;
    for (const key of this.resyncFaults) {
      if (key.endsWith(suffix)) this.resyncFaults.delete(key);
    }
  }

  /**
   * Content-keyed reconciliation sweep — the backstop that makes external-edit
   * detection a guarantee rather than a single chance (#9339, #7282).
   *
   * ## Why the watcher alone cannot be the guarantee
   *
   * An external write to `<root>/<type>/<name>.json` reaches a subscriber only
   * if chokidar notices it, and under `usePolling` it gets **exactly one**
   * opportunity to do so: the write advances the type directory's mtime once,
   * and chokidar re-reads a directory only when its stat *strictly advances*,
   * so every later poll compares an unchanged stat and can never rediscover
   * the file. Measured on #9339 with a fault-injection harness: with the one
   * read suppressed, fifteen further poll ticks never find the new file, and a
   * 20s deadline and a 200s deadline buy the same single attempt. That is the
   * structural reason behind #7282's empirical finding that the event is
   * "never delivered, not slow", and why widening the deadline (#7208) and
   * lowering `interval` were both spent before they were tried.
   *
   * At least six independent one-shot gates sit on that single attempt,
   * spanning three layers — the kernel timestamp (the directory mtime does not
   * strictly advance), chokidar's readdir throttle and readdir snapshot, and
   * chokidar's emit gates (`_throttle('add')`, a stale `_pendingWrites` entry,
   * the `awaitWriteFinish` ENOENT early return). Each one produces a
   * byte-identical observable: no event, ever, for that path.
   *
   * ## Why this shape, and not a narrower one
   *
   * ⚠️ The six are indistinguishable at the point of failure, so **any fix
   * that has to name which gate fired is a fix for one member of a family** —
   * which is exactly how #7282 was closed and exactly why it reopened. This
   * sweep never asks. It compares what is on disk against `heads`, the index
   * that already defines what this repository believes it holds, and publishes
   * the divergence through the same `handleFsChange` the watcher feeds. It is
   * therefore robust across all six *by construction*, and equally across a
   * seventh nobody has found: the only property it relies on is that the bytes
   * on disk stopped matching the index.
   *
   * `put()` is unaffected and keeps its direct registration (`trackWrittenPath`
   * calls `watcher.add` and bypasses the whole chain, which is why the `put()`
   * half of this family was already closed by #7336 and the external-write half
   * was not).
   *
   * ## Cost, and why it is bounded
   *
   * One pass over `<root>/<type>/*.json` per sweep — the same walk `start()`
   * already performs once — with no retry loop inside it and no work at all
   * when nothing diverged. Sweeps are chained, so they cannot overlap; the
   * timer is `unref`ed and dies with `close()`; and it is armed only alongside
   * the watcher, so a `disableWatch` repository pays nothing.
   *
   * Discovery is by content, never by stat: a stat pre-filter would reintroduce
   * a time key of exactly the kind this replaces.
   */
  private async resync(): Promise<void> {
    const root = this.layout.root;
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
      this.clearResyncFault(root);
    } catch (err) {
      // ENOENT is truthful: a root that does not exist holds nothing to
      // reconcile, and the next sweep sees whatever replaces it. Any other
      // errno means the read could not RUN, and staying silent about that
      // would make this backstop absent for the life of the process exactly
      // when the load-dependent loss it exists to catch is most likely —
      // EMFILE/ENFILE degrade this read and chokidar's own polling together.
      if (!isEnoent(err)) this.reportResyncFault(root, err);
      return;
    }
    const onDisk = new Set<string>();
    /**
     * Type directories whose listing could not be obtained. Their keys are
     * missing from `onDisk` for a reason that is NOT "the files are gone", so
     * the delete pass below must not read that absence as a removal.
     */
    const unreadableTypes = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Same dot-entry rule as `scanHeads` and `isIgnoredWatchPath`, so the
      // boot scan, the watcher and this sweep agree on what the repository
      // contains (#7150).
      if (entry.name.startsWith('.')) continue;
      const dir = path.join(root, entry.name);
      let files: string[] = [];
      try {
        files = await fs.readdir(dir);
        this.clearResyncFault(dir);
      } catch (err) {
        // The same discrimination at type granularity. An unreadable type
        // directory silently stops reconciling EVERY item of that type, which
        // is exactly the invented-emptiness shape #8895 rules on.
        if (!isEnoent(err)) {
          this.reportResyncFault(dir, err);
          unreadableTypes.add(entry.name);
        }
        continue;
      }
      for (const file of files) {
        if (!file.endsWith('.json') || file.startsWith('.')) continue;
        const abs = path.join(dir, file);
        const parsed = parseItemPath(this.layout, abs);
        if (!parsed) continue;
        const ref: MetaRef = {
          org: this.org,
          type: parsed.type as MetadataType,
          name: parsed.name,
        };
        const key = refKey(ref);
        onDisk.add(key);
        const before = this.heads.get(key);
        await this.handleFsChange(abs, 'add');
        if (this.heads.get(key) !== before) {
          // We just published a change the watcher never delivered, so the
          // watcher may not know this path at all (the loss can be upstream of
          // chokidar's `_handleFile`). Re-arm it through the same seam `put()`
          // uses, so the fast path is restored instead of leaving every future
          // edit to this file dependent on the sweep.
          this.trackWrittenPath(abs);
        }
      }
    }
    for (const key of [...this.heads.keys()]) {
      if (onDisk.has(key)) continue;
      const ref = parseRefKey(key);
      if (!ref) continue;
      // Absent from `onDisk` because we could not look, not because it is gone.
      if (unreadableTypes.has(ref.type)) continue;
      const file = itemPath(this.layout, ref.type, ref.name);
      await this.mutex.run(key, async () => {
        // Re-checked UNDER the lock. The enumeration above ran outside it, so
        // a `put()` that created this file in between would otherwise be
        // reported as an external delete.
        if (existsSync(file)) return;
        await this.publishExternalDelete(ref, key);
      });
    }
  }

  /**
   * Translate a watcher event into a `MetadataEvent`, or drop it.
   *
   * ## Self-writes are suppressed by content identity, never by a clock (#7335)
   *
   * This used to open with `if (this.selfWrites.has(absPath)) return;` — a
   * `Set` that `put()`/`delete()` added the path to and a `setTimeout(…, 200)`
   * cleared. That check discarded **every** event for a recently-written path
   * without ever looking at what the watcher had actually observed, which is
   * the whole defect: with `usePolling`, chokidar compares state once per
   * `interval`, so our write and an external edit landing between two ticks
   * are delivered as **one** event carrying the *external* content. Dropping
   * it on a wall clock destroyed the only notification that edit would ever
   * produce.
   *
   * Measured on `origin/main` @ `69fde55`, 40 iterations, poll phase
   * randomised so the delivery lag samples `[0, interval)` uniformly:
   *
   *   delivery lag < 200ms  →  7 runs  →  external edit SWALLOWED, every time
   *   delivery lag > 200ms  →  33 runs →  external edit delivered, every time
   *
   * A perfect split on the wall-clock boundary, and the reason earlier
   * instrumentation saw 0/360: a *fixed* pre-edit sleep phase-locks the poll,
   * pinning the lag (measured: 519–585ms across 25 runs) safely outside the
   * window. Nothing about the window was rare — it was unsampled.
   *
   * What remains is the check that was already doing the real work one step
   * down, and it needs no timer because it compares the content the watcher
   * **read** against the index:
   *
   *   - `add`/`change` — `currentHead === hash` drops the event when the bytes
   *     on disk are the bytes we last published. `put()` sets that head in the
   *     same continuation as its `rename`, and `awaitWriteFinish` holds the
   *     event for a further `stabilityThreshold`, so it is never late.
   *   - `unlink` — `!currentHead` drops the event when the index already
   *     agrees the item is gone. `delete()` retires the head *before* it
   *     unlinks, precisely because this face gets no `awaitWriteFinish` delay.
   *
   * Both faces are pinned together in `test/self-write-suppression.test.ts`.
   *
   * Note the deliberate limit: identity is judged on what round-trips through
   * the file, so a spec whose in-memory form does not (a `Date`, which
   * canonicalises to `{}` in memory but to an ISO string once written and
   * re-read) is republished as an external `update`. That predates this change
   * and is independent of it — such a spec already fails `put().version ===
   * get().hash`, and the 200ms window never covered it either, expiring some
   * 360ms before the event it would have had to catch.
   */
  private async handleFsChange(absPath: string, kind: 'add' | 'change' | 'unlink'): Promise<void> {
    const parsed = parseItemPath(this.layout, absPath);
    if (!parsed) return;
    const ref: MetaRef = {
      org: this.org,
      type: parsed.type as MetadataType,
      name: parsed.name,
    };
    const key = refKey(ref);
    await this.mutex.run(key, async () => {
      if (kind === 'unlink') {
        await this.publishExternalDelete(ref, key);
        return;
      }
      const body = await readJson(absPath);
      if (!body) return;
      const hash = hashSpec(body);
      const currentHead = this.heads.get(key) ?? null;
      if (currentHead === hash) return; // No content change.
      this.heads.set(key, hash);
      const seq = this.nextSeq++;
      const evt: MetadataEvent = {
        seq,
        op: currentHead ? 'update' : 'create',
        ref: { ...ref, version: undefined },
        hash,
        parentHash: currentHead,
        actor: this.fsActor,
        ts: this.now().toISOString(),
        source: 'fs',
      };
      await this.log.append(evt);
      this.broker.publish(evt);
    });
  }
}

// ── Utilities ─────────────────────────────────────────────────────────

/**
 * Watcher ignore matcher — "everything under the root, except the
 * repository's own bookkeeping" (#7150).
 *
 * chokidar hands its matcher **absolute** paths, and applies it to the
 * watched root itself as well as to entries discovered underneath it. The
 * previous matcher was a bare dotfile regex (`/(^|[\\/])\../`), which
 * therefore matched the `.objectstack` segment of the root path the plugin
 * actually uses (`<project>/.objectstack/metadata`, `REPO_SUBDIR` in
 * `packages/metadata/src/plugin.ts`) and ignored the whole watch. Measured on
 * chokidar 5 with this repository's own options, two identical trees
 * differing only in whether the root sits under a dot-directory:
 *
 *   plain root      getWatched: ['<root>', 'view']   events: add+change
 *   dot-rooted      getWatched: []                   events: none
 *
 * So the intent is kept and only the *frame of reference* is fixed: judge the
 * path relative to the root, so dot segments belonging to the root itself are
 * never considered.
 *
 * Why not drop the matcher entirely and lean on `parseItemPath`, which already
 * rejects `.objectstack`? Measured: `parseItemPath` rejects that ONE name, so
 * a dot-directory at the type level leaks — `<root>/.cache/x.json` parses as
 * type `.cache`, and `<root>/view/.scratch.json` as an item named `.scratch`.
 * Both would be published as `MetadataEvent`s while `scanHeads` skips every
 * dot entry on boot, leaving the boot scan and the watcher disagreeing about
 * what the repository contains. Dropping it also puts `.objectstack/.log/` in
 * the poll set, so every one of the repository's own log appends wakes
 * `handleFsChange` only to be discarded.
 */
function isIgnoredWatchPath(root: string, absPath: string): boolean {
  const rel = path.relative(root, absPath);
  // The watched root itself, and anything outside it, are not ours to judge.
  if (rel === '' || rel.startsWith('..')) return false;
  return rel.split(/[\\/]/).some((segment) => segment.startsWith('.'));
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, body: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(body, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

function parseRefKey(key: string): MetaRef | null {
  const parts = key.split('/');
  if (parts.length !== 3) return null;
  return {
    org: parts[0]!,
    type: parts[1]! as MetadataType,
    name: parts[2]!,
  };
}

/**
 * Wrap a Promise<AsyncIterable<T>> as a sync-returning AsyncIterable<T>.
 * The first `.next()` awaits the promise.
 */
function deferredIterable<T>(promise: Promise<AsyncIterable<T>>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let inner: AsyncIterator<T> | null = null;
      return {
        async next() {
          if (!inner) {
            const iterable = await promise;
            inner = iterable[Symbol.asyncIterator]();
          }
          return inner.next();
        },
        async return(value?: unknown) {
          if (!inner) {
            const iterable = await promise;
            inner = iterable[Symbol.asyncIterator]();
          }
          if (inner.return) return inner.return(value);
          return { value: undefined, done: true };
        },
      } as AsyncIterator<T>;
    },
  };
}
