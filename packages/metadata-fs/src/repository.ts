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
  /** Paths we wrote ourselves; suppress the resulting chokidar event. */
  private readonly selfWrites = new Set<string>();
  private watcher: FSWatcher | null = null;
  private started = false;

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
      this.selfWrites.add(file);
      try {
        await writeJsonAtomic(file, spec);
      } finally {
        // Hold the suppression until chokidar has had a chance to emit;
        // we keep it in selfWrites for one debounce tick.
        setTimeout(() => this.selfWrites.delete(file), 200);
      }
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
      this.selfWrites.add(file);
      try {
        if (existsSync(file)) await fs.unlink(file);
      } finally {
        setTimeout(() => this.selfWrites.delete(file), 200);
      }
      this.heads.delete(key);
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

  private startWatcher(): void {
    const w = chokidar.watch(this.layout.root, {
      ignored: [/(^|[\\/])\../], // skip dotfiles incl. .objectstack
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
  }

  private async handleFsChange(absPath: string, kind: 'add' | 'change' | 'unlink'): Promise<void> {
    if (this.selfWrites.has(absPath)) return; // Suppress our own writes.
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
