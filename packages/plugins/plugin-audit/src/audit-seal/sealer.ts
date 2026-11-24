// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { DispatchLoop } from '@objectstack/core';
import { AUDIT_CHECKPOINT_SIGNER_SERVICE, AUDIT_CHECKPOINT_SINK_SERVICE } from '@objectstack/spec/contracts';
import type {
  IAuditCheckpointSigner,
  IAuditCheckpointSink,
  IClusterService,
  ICryptoProvider,
  LockHandle,
} from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import {
  AUDIT_SEAL_CANON_VERSION,
  CanonicalFormError,
  canonicalDatetime,
  chainValueOf,
  leafHash,
  leafInput,
  rowIdOf,
  sealChainFieldOf,
  sealedColumnSet,
  unsealableColumns,
  type SealedColumnSet,
  type SealedFieldTypes,
} from './canonical.js';
import { merkleRoot } from './merkle.js';
import {
  AUDIT_CHECKPOINT_OBJECT,
  checkpointSeedContext,
  columnSaltsOf,
  encodeCheckpointSeed,
  generateCheckpointSeed,
} from './seed.js';
import {
  chainKeyOf,
  checkpointBodyFromRow,
  checkpointDigest,
  checkpointPartOf,
  checkpointRow,
  signedBodyBytes,
  SignedBodyError,
  type AuditCheckpointKind,
  type CheckpointSignedBody,
} from './signed-body.js';
import { dropAuditSealSecret, writeAuditSealSecret, type SealStorageDriver, type SealStorageEngine } from './signer.js';
import {
  AUDIT_SEAL_LOCK_NAME,
  AUDIT_SEAL_LOCK_REWRITE_COMMANDS,
  trySealPassLocks,
  type AuditSealPassLocks,
} from './seal-lock.js';

/**
 * ADR-0154 D3 — the sealer: after a settle lag, one window at a time, under
 * the cluster lock `audit.sealer`, it seals each sealed object's rows into
 * signed checkpoints per chain (organization, or the deployment) per window:
 * consecutive parts of at most {@link AUDIT_SEAL_MAX_LEAVES} leaves each
 * (S7, D4 as amended 2026-11-14), cut in D1 order, the last one final.
 *
 * A pass, per sealed object:
 *
 *  1. **Late rows first.** It re-counts each window of the last
 *     {@link AUDIT_SEAL_LATE_HORIZON_MS} it has sealed: a window whose stored
 *     row count differs from what its checkpoints list is read, and each row
 *     no checkpoint lists goes into a `late` checkpoint of its chain.
 *  2. **Then windows, oldest first.** From the last window it sealed (resuming
 *     the chains a stopped pass left) or, on a first run, the window of the
 *     oldest row, it seals every window that ended at least
 *     {@link AUDIT_SEAL_SETTLE_MS} ago and holds a row. An empty window writes
 *     nothing. The hot store and the `archive` datasource are both read, so a
 *     backlog that is partly archived is sealed whole.
 *
 * Each checkpoint carries the sealed-through watermark: the end of the last
 * window the sealer had completed for every chain when it wrote it.
 *
 * S7: a pass that stops mid-window leaves the chain's last `window` part
 * non-final; the next pass resumes that window as further `window` parts,
 * counting on from that part's index, so the rest is never sealed as `late`.
 * A window is read twice: once for the ids and instants of its rows, then
 * each part's rows by id, hashed under that part's own seed (D2) — so one
 * checkpoint's work is bounded by N, whatever its window holds.
 *
 * S4 (seat ruling 6884540128 item 2): a fault is isolated to the smallest
 * thing it belongs to. A chain-local fault — a row a canonical rule refuses,
 * or a malformed checkpoint of the chain (its head among them) — skips that
 * chain for the rest of the pass; the other chains are sealed, and each chain
 * resumes from its own oldest unsealed window, since every chain carries its
 * own cursor. The watermark never advances past a window a skipped chain
 * leaves unsealed. Every other fault — the lock, the signer, the crypto
 * provider, the storage — stops the whole object's pass.
 *
 * D3 as amended (seat ruling 6885005594, E): beside `audit.sealer`, each
 * pass try-locks the audit seal lock (`seal-lock.ts`), a database session lock
 * on each sealed object's hot store, and skips the pass while another session
 * holds it — an `os migrate audit-* --apply` run holds it for its whole run.
 * A checkpoint is written only while both still stand; a lapse of either
 * fails the object's pass, as any lock lapse does (S4). A database that offers
 * no session lock adds none: there the migrations refuse to run on a sealed
 * object without the operator's `--sealer-stopped` (B).
 *
 * Nothing here writes the sealed object, and every secret row is written
 * below the hooks, so the sealer never seals its own writes.
 */

/** The window: one hour of `created_at`, UTC-aligned. No operator knob. */
export const AUDIT_SEAL_WINDOW_MS = 60 * 60 * 1000;
/** How long after a window ends it is sealed. No operator knob. */
export const AUDIT_SEAL_SETTLE_MS = 10 * 60 * 1000;
/** How far back late rows are looked for. No operator knob. */
export const AUDIT_SEAL_LATE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** The cluster lock a pass holds. */
export const AUDIT_SEALER_LOCK = 'audit.sealer';

const LOCK_TTL_MS = 60_000;
/** A fault that keeps a sealed object unsealed is reported again after this long (S4). */
const REPORT_REPEAT_MS = 60 * 60 * 1000;
const PAGE_SIZE = 500;
/** Windows sealed per object per pass; a backlog continues on the next pass, which follows at once. */
const MAX_WINDOWS_PER_PASS = 24;
/**
 * S7 (ADR-0154 D4 amended): the most leaves one checkpoint holds. A window
 * holding more seals into consecutive parts. A fixed constant, not a knob.
 */
export const AUDIT_SEAL_MAX_LEAVES = 10_000;
/**
 * review#3 S1: windows a pass may walk that seal nothing — every row of them
 * belongs to a chain sealed past them, or to a chain skipped in this pass —
 * while a chain is skipped, before it stops walking. Only a skipped chain
 * holds the floor back so that such windows recur; this bounds what each pass
 * re-reads while it stays skipped. One late horizon's worth of windows.
 *
 * With no chain skipped the walk is not cut: such windows are then only what
 * a chain skipped before (fixed since, or with nothing left to seal) left
 * behind, and walking on to the next window that seals something is what
 * moves the floor past them. Cut there, the floor would never move again.
 */
export const AUDIT_SEAL_MAX_IDLE_WINDOWS_PER_PASS = AUDIT_SEAL_LATE_HORIZON_MS / AUDIT_SEAL_WINDOW_MS;
/** Sign attempts of one checkpoint before the pass gives up (the S1 loop). */
const MAX_SIGN_ATTEMPTS = 3;
/** The key id a body is built with before the signer has named one. */
const NO_KEY_YET = 'unknown';

type Row = Record<string, unknown>;

export interface AuditSealerLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
}

/** The engine surface the sealer uses: the signer's, plus the registry and the archive datasource. */
export interface AuditSealerEngine extends SealStorageEngine {
  registry: { getAllObjects(): ReadonlyArray<{ name: string; fields?: unknown; lifecycle?: unknown }> };
  datasource?(name: string): SealStorageDriver | undefined;
}

/** The signer a pass signs with: the seam's surface, plus the default signer's key-id hint. */
type SealSigner = IAuditCheckpointSigner & { activeKeyId?(): Promise<string | null> };

/** The three host seams of one pass, each resolved once at the pass's start. */
interface PassSeams {
  signer: SealSigner | undefined;
  sink: IAuditCheckpointSink | undefined;
  cluster: IClusterService | undefined;
}

export interface AuditSealerOptions {
  engine: AuditSealerEngine;
  crypto?: ICryptoProvider;
  /**
   * Resolved per pass: a host's `audit.checkpointSigner`, or the default one.
   * Each of the three seams answers `undefined` only when nothing is
   * registered; a registered service that cannot be resolved THROWS, and the
   * pass then seals nothing (see {@link AuditSealer.resolveSeams}).
   */
  signer: () => SealSigner | undefined | Promise<SealSigner | undefined>;
  /** Resolved per pass: a host's `audit.checkpointSink`, if any. */
  sink?: () => IAuditCheckpointSink | undefined | Promise<IAuditCheckpointSink | undefined>;
  /** Resolved per pass: the `cluster` service, if any. */
  cluster?: () => IClusterService | undefined | Promise<IClusterService | undefined>;
  logger: AuditSealerLogger;
  now?: () => number;
  /**
   * Test seam, like `now`: a smaller {@link AUDIT_SEAL_MAX_LEAVES}, so a test
   * can cut a window into parts with a handful of rows. `AuditPlugin` never
   * passes it, and nothing an operator or a tenant sets reaches it.
   */
  maxLeaves?: number;
}

/** A sealed object, as a pass reads it. */
interface SealPlan {
  readonly name: string;
  readonly fields: SealedFieldTypes;
  readonly columns: SealedColumnSet;
  /** The column each row's chain is read from ({@link chainValueOf}): `lifecycle.seal.chainField`, or `tenant_id`. */
  readonly chainField: string;
  readonly archiveTo?: string;
}

interface ChainHead {
  readonly sequence: number;
  readonly digest: string;
}

/** One chain's rows of one window, as read: each row's id and canonical `created_at`, not yet hashed. */
interface ChainRows {
  readonly tenantId: string | null;
  readonly rows: Array<{ id: string; at: string }>;
}

/** A row as a leaf of one checkpoint, under that checkpoint's seed. */
interface Leaf {
  readonly id: string;
  readonly at: string;
  readonly hash: Buffer;
}

/** D1 leaf order: `(created_at, id)`. */
const leafOrder = (a: { id: string; at: string }, b: { id: string; at: string }): number =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * S4: a fault that belongs to one chain — a row of it a canonical rule
 * refuses, or a malformed checkpoint of it. It skips that chain only.
 */
class ChainFault extends Error {
  constructor(readonly chainKey: string, readonly fault: unknown) {
    super(faultOf(fault));
  }
}

/** Whether `err` is chain-local when it is thrown reading one chain's row or checkpoint (S4). */
const isChainLocal = (err: unknown): boolean => err instanceof CanonicalFormError || err instanceof SignedBodyError;

/**
 * A fault as a report line may quote it: its code and the driver's own reason,
 * never the statement. A SQL driver's message leads with the statement and its
 * bound values (`insert into … values (…) - no such table: …`), and a statement
 * of this module's can carry a sealed secret's ciphertext.
 */
function faultOf(err: unknown): string {
  const message = String((err as Error)?.message ?? err);
  const reason = /^\s*(insert|update|select|delete)\b/i.test(message) && message.includes(' - ')
    ? message.slice(message.lastIndexOf(' - ') + 3)
    : message;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number' ? `${String(code)}: ${reason}` : reason;
}
const windowOf = (ms: number): number => Math.floor(ms / AUDIT_SEAL_WINDOW_MS) * AUDIT_SEAL_WINDOW_MS;

/**
 * The locks a pass holds (D3 amended): the lease `audit.sealer`, whose fencing
 * token each checkpoint records, and the audit seal lock on each sealed
 * object's database.
 */
interface PassLock {
  readonly fencingToken: bigint;
  renew(ttlMs: number): Promise<void>;
  /** The lock guarding `object`'s checkpoints that lapsed, named for a line; `null` while each still stands. */
  lapsed(object: string): Promise<string | null>;
}

function passLockOf(lease: LockHandle, session: Extract<AuditSealPassLocks, { held: false }>['locks']): PassLock {
  return {
    fencingToken: lease.fencingToken,
    renew: (ttlMs) => lease.renew(ttlMs),
    async lapsed(object) {
      if (!lease.isHeld()) return 'the audit.sealer lock';
      for (const { objects, lock } of session) {
        if (objects.includes(object) && !(await lock.isHeld())) return `the audit seal lock on the database of '${object}'`;
      }
      return null;
    },
  };
}

/** Q2 (a): with no cluster service the lock is this process's, with its own fencing counter. */
let inProcessHeld = false;
let inProcessFencing = 0n;

function acquireInProcessLock(): LockHandle | null {
  if (inProcessHeld) return null;
  inProcessHeld = true;
  inProcessFencing += 1n;
  let held = true;
  return {
    key: AUDIT_SEALER_LOCK,
    fencingToken: inProcessFencing,
    async renew() {
      if (!held) throw new Error('the in-process audit.sealer lock was released');
    },
    async release() {
      if (held) inProcessHeld = false;
      held = false;
    },
    isHeld: () => held,
  };
}

export class AuditSealer {
  private loop: DispatchLoop | undefined;
  /** When each cause was last reported, by cause. */
  private readonly reported = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: AuditSealerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Start sealing on an interval. The first pass runs at once. */
  start(): void {
    if (this.loop) return;
    this.loop = new DispatchLoop({
      intervalMs: 1_000,
      maxIdleIntervalMs: 5 * 60 * 1000,
      nextDueAt: async () => windowOf(this.now() - AUDIT_SEAL_SETTLE_MS) + AUDIT_SEAL_WINDOW_MS + AUDIT_SEAL_SETTLE_MS,
      runTick: () => this.runPass(),
      onTickError: (err) => this.report(`pass:${faultOf(err)}`, () =>
        `AuditSealer: a sealing pass FAILED (${faultOf(err)}) — rows of the sealed objects are not being sealed ` +
        'until a pass succeeds; it is retried on the next pass. Fix the fault named here.'),
    });
    this.loop.start();
  }

  async stop(): Promise<void> {
    const loop = this.loop;
    this.loop = undefined;
    await loop?.stop();
  }

  /**
   * Report at `error`, once per cause per {@link REPORT_REPEAT_MS} while it
   * lasts. No error object rides along: its message may quote a statement.
   */
  private report(cause: string, message: () => string): void {
    const last = this.reported.get(cause);
    if (last !== undefined && this.now() - last < REPORT_REPEAT_MS) return;
    this.reported.set(cause, this.now());
    this.options.logger.error(message());
  }

  /**
   * S4: each chain a chain-local fault skipped, at `error`, once per cause per
   * {@link REPORT_REPEAT_MS} while it lasts; a chain sealed again is forgotten.
   */
  private reportSkipped(object: string, skipped: ReadonlyMap<string, { fault: string; from: number }>): void {
    for (const cause of this.reported.keys()) {
      if (!cause.startsWith(`chain:${object}:`)) continue;
      if (![...skipped.keys()].some((key) => cause.startsWith(`chain:${object}:${key}:`))) this.reported.delete(cause);
    }
    for (const [key, { fault, from }] of skipped) {
      this.report(`chain:${object}:${key}:${fault}`, () =>
        `AuditSealer: '${object}' chain '${key}' is skipped (${fault}) — its rows from the window of ${iso(from)} on are ` +
        'NOT being sealed, and no checkpoint\'s sealed_through passes that window; every other chain is sealed. ' +
        'Each pass retries the chain from that window. Fix the fault named here.');
    }
  }

  /**
   * review#3 S1: the walk stopped on its bound of windows that seal nothing.
   * While a skipped chain holds the floor back, windows past that bound wait
   * for it; this says so at `error`, once per {@link REPORT_REPEAT_MS}.
   */
  private reportIdleStop(object: string, stop: { at: number; windows: number }, skipped: ReadonlyMap<string, unknown>): void {
    const chains = [...skipped.keys()].map((key) => `'${key}'`).join(', '); // never empty: the bound counts only while one is skipped
    this.report(`idle:${object}`, () =>
      `AuditSealer: '${object}' walked ${stop.windows} windows that seal nothing in one pass and stopped there — ` +
      `its rows from the window of ${iso(stop.at)} on are NOT being sealed while the skipped chain(s) ${chains} ` +
      'hold its sealed-through watermark back. Fix the chain fault reported for it; sealing then catches up.');
  }

  /** The sealed objects the registry holds that can be sealed; each that cannot is reported. */
  private plans(): SealPlan[] {
    const plans: SealPlan[] = [];
    for (const object of this.options.engine.registry.getAllObjects()) {
      const lifecycle = object.lifecycle as { seal?: { valueFields?: string[] }; archive?: { to?: string } } | undefined;
      if (!lifecycle?.seal) continue;
      const fields = (object.fields ?? {}) as SealedFieldTypes;
      const chainField = sealChainFieldOf(lifecycle);
      let reason: string | null = null;
      let columns: SealedColumnSet | null = null;
      try {
        columns = sealedColumnSet(fields, lifecycle.seal.valueFields ?? []);
        const refused = unsealableColumns(columns, fields);
        if (refused.length > 0) {
          reason = `its column(s) ${refused.map((c) => `'${c.column}' (type '${c.type ?? 'none'}')`).join(', ')} ` +
            'have no canonical rule';
        } else if (!Object.prototype.hasOwnProperty.call(fields, chainField)) {
          // S3: a chain is the row's own chain column (D10 note: `seal.chainField`, default `tenant_id`); without
          // it every organization would share one. A chain column the object lacks, named or the default, is
          // refused at authoring; this stays for a definition that reached the registry without the parse.
          reason = `it has no '${chainField}' field, the column its rows are chained by per organization`;
        }
      } catch (err) {
        reason = (err as Error).message;
      }
      if (reason !== null || columns === null) {
        this.report(`plan:${object.name}`, () =>
          `AuditSealer: '${object.name}' declares lifecycle.seal but cannot be sealed: ${reason}. Its rows are NOT ` +
          'being sealed — no checkpoint covers them, so a change made outside the platform would not show. Fix: ' +
          "give the object its chain column ('tenant_id', or the one lifecycle.seal.chainField names) and only " +
          'columns of a type with a canonical rule (ADR-0154 D1, D5, D10), or remove lifecycle.seal.');
        continue;
      }
      plans.push({ name: object.name, fields, columns, chainField, ...(lifecycle.archive?.to ? { archiveTo: lifecycle.archive.to } : {}) });
    }
    return plans;
  }

  /**
   * #34280: resolve the three host seams once, at the start of a pass. Only an
   * ABSENT seam has a stand-in — the default local signer, no off-host export,
   * the in-process lock. A seam that IS registered but cannot be resolved (a
   * factory that throws, a KMS client that cannot start) stops the pass: no
   * checkpoint is signed, and the fault is reported at `error`, naming the
   * slot, once per {@link REPORT_REPEAT_MS} while it lasts. Falling back there
   * would sign with the local key where the host chose its own, export
   * nothing where it chose an off-host copy, or run without its cluster lock,
   * and nothing would say so. Resolves to `null` when the pass must stop.
   */
  private async resolveSeams(): Promise<PassSeams | null> {
    const slots = [
      ['signer', AUDIT_CHECKPOINT_SIGNER_SERVICE, this.options.signer, 'sign with the local key'],
      ['sink', AUDIT_CHECKPOINT_SINK_SERVICE, this.options.sink, 'seal without the off-host export'],
      ['cluster', 'cluster', this.options.cluster, 'hold the audit.sealer lock in-process only'],
    ] as const;
    const seams: Partial<Record<(typeof slots)[number][0], unknown>> = {};
    let failed = false;
    for (const [seam, slot, resolve, fallback] of slots) {
      try {
        seams[seam] = await resolve?.();
        this.reported.delete(`resolve:${slot}`);
      } catch (err) {
        failed = true;
        const fault = faultOf(err);
        this.report(`resolve:${slot}`, () =>
          `AuditSealer: the '${slot}' service is registered but could not be resolved (${fault}) — NO checkpoint is ` +
          `signed and rows of the sealed objects are NOT being sealed until it resolves; the sealer does not ${fallback} ` +
          'in place of a service the host registered. Each pass retries. Fix the registration of the service named here.');
      }
    }
    if (failed) return null;
    return seams as PassSeams;
  }

  private async acquireLock(cluster: IClusterService | undefined): Promise<LockHandle | null> {
    if (cluster?.lock) return cluster.lock.acquire(AUDIT_SEALER_LOCK, { ttlMs: LOCK_TTL_MS, waitMs: 0 });
    if (!this.reported.has('in-process-lock')) {
      this.reported.set('in-process-lock', this.now());
      this.options.logger.info(
        'AuditSealer: no cluster service is registered, so the audit.sealer lock is held in-process only — ' +
          'its cross-replica exclusion is off by the host\'s declaration. The database session lock each pass ' +
          'also takes, where the database offers one (Postgres, MySQL), still keeps two replicas\' passes apart, and ' +
          'the checkpoint table\'s unique (sealed_object, chain_key, sequence) index still refuses a second ' +
          'checkpoint at a taken sequence.',
      );
    }
    return acquireInProcessLock();
  }

  /** One pass over every sealed object. Resolves to the number of checkpoints written. */
  async runPass(): Promise<number> {
    const plans = this.plans();
    if (plans.length === 0) return 0;
    const seams = await this.resolveSeams();
    if (!seams) return 0;
    const { signer } = seams;
    if (!this.options.crypto || !signer) {
      this.report('no-crypto', () =>
        `AuditSealer: ${plans.map((p) => `'${p.name}'`).join(', ')} declare(s) lifecycle.seal, but this deployment has ` +
        `no ${this.options.crypto ? 'checkpoint signer' : 'crypto provider'} — rows of the sealed objects are NOT ` +
        'being sealed, so a change made outside the platform would not show while everything looks healthy. Fix: ' +
        'wire a crypto provider (AuditPluginOptions.cryptoProvider), or remove lifecycle.seal.');
      return 0;
    }
    const lock = await this.acquireLock(seams.cluster);
    if (!lock) return 0;
    // D3 amended (E): the audit seal lock beside audit.sealer, on each sealed object's database, or no pass.
    let session: AuditSealPassLocks;
    try {
      session = await trySealPassLocks(this.options.engine, plans.map((p) => p.name));
    } catch (err) {
      await lock.release();
      throw err;
    }
    if (session.held) {
      await lock.release();
      this.reportSealLockHeld(session.objects);
      return 0;
    }
    this.reported.delete('seal-lock-held');
    const passLock = passLockOf(lock, session.locks);
    try {
      let written = 0;
      for (const plan of plans) {
        // One object's fault never stops another's sealing; it is reported while it lasts.
        let pass: ObjectPass | undefined;
        try {
          pass = new ObjectPass(this.options, plan, passLock, signer, seams.sink, this.now());
          await pass.run();
          for (const cause of this.reported.keys()) if (cause.startsWith(`object:${plan.name}:`)) this.reported.delete(cause);
        } catch (err) {
          const fault = faultOf(err);
          this.report(`object:${plan.name}:${fault}`, () =>
            `AuditSealer: sealing '${plan.name}' FAILED (${fault}) — its rows from this point on are not being ` +
            'sealed until a pass gets past it; each pass retries. Fix the fault named here.');
        } finally {
          written += pass?.written ?? 0;
          if (pass) this.reportSkipped(plan.name, pass.skipped);
          if (pass?.idleStop) this.reportIdleStop(plan.name, pass.idleStop, pass.skipped);
        }
      }
      return written;
    } finally {
      for (const held of session.locks) await held.lock.release();
      await lock.release();
    }
  }

  /**
   * D3 amended (E): another session holds the audit seal lock, so the pass was
   * skipped. Expected while an `os migrate audit-*` run lasts (or another
   * server's pass), so at `info`, once per {@link REPORT_REPEAT_MS} while it
   * lasts; a pass that takes the lock forgets it.
   */
  private reportSealLockHeld(objects: readonly string[]): void {
    const last = this.reported.get('seal-lock-held');
    if (last !== undefined && this.now() - last < REPORT_REPEAT_MS) return;
    this.reported.set('seal-lock-held', this.now());
    this.options.logger.info(
      `AuditSealer: the audit seal lock ('${AUDIT_SEAL_LOCK_NAME}') on the database of ` +
        `${objects.map((o) => `'${o}'`).join(', ')} is held by another session — a run of ` +
        `${AUDIT_SEAL_LOCK_REWRITE_COMMANDS}, or another server's sealer pass — so this pass is skipped and seals ` +
        'nothing until it lets go; each pass tries again.',
    );
  }
}

/** One pass over one sealed object. */
class ObjectPass {
  private readonly heads = new Map<string, ChainHead | null>();
  private readonly hot: SealStorageDriver;
  private readonly archive: SealStorageDriver | undefined;
  private readonly checkpoints: SealStorageDriver;
  private watermark: number | null = null;
  /** The stored watermark when the pass began: every chain is complete before it. */
  private floor: number | null = null;
  /** S4: each chain's own cursor, the start of the window after its last `window` checkpoint. */
  private readonly cursors = new Map<string, number>();
  /** S4: the chains a chain-local fault put out for the rest of this pass, and the window each stays unsealed from. */
  readonly skipped = new Map<string, { fault: string; from: number }>();
  /** S7: the chains whose newest `window` part is not final — the window they resume, and its next part. */
  private readonly resume = new Map<string, { window: number; next: number }>();
  /** review#3 S1: where the walk stopped on its bound of windows that seal nothing, if it did. */
  idleStop: { at: number; windows: number } | null = null;
  /** Checkpoints this pass wrote, counted as each lands. */
  written = 0;
  /** The key id the last checkpoint of this pass was signed under: the next body's expectation. */
  private keyId: string | null = null;

  constructor(
    private readonly options: AuditSealerOptions,
    private readonly plan: SealPlan,
    private readonly lock: PassLock,
    private readonly signer: SealSigner,
    private readonly sink: IAuditCheckpointSink | undefined,
    private readonly now: number,
  ) {
    const { engine } = options;
    const hot = engine.getDriverForObject(plan.name);
    const checkpoints = engine.getDriverForObject(AUDIT_CHECKPOINT_OBJECT);
    if (!hot || !checkpoints) throw new Error(`no driver resolves for '${hot ? AUDIT_CHECKPOINT_OBJECT : plan.name}'`);
    this.hot = hot;
    this.checkpoints = checkpoints;
    let archive: SealStorageDriver | undefined;
    try {
      archive = plan.archiveTo ? engine.datasource?.(plan.archiveTo) : undefined;
    } catch {
      archive = undefined;
    }
    this.archive = archive && archive !== hot ? archive : undefined;
  }

  async run(): Promise<number> {
    const [top] = await this.checkpoints.find(AUDIT_CHECKPOINT_OBJECT, {
      where: { sealed_object: this.plan.name },
      orderBy: [{ field: 'sealed_through', order: 'desc' }],
      limit: 1,
    });
    this.watermark = top ? Date.parse(canonicalDatetime(top.sealed_through, 'sealed_through')) : null;
    this.floor = this.watermark;
    // S4: each chain's cursor, from its `window` checkpoints at or past the floor. A chain the floor passed with
    // none there has the floor as its cursor; the latest `window` checkpoint is never below the floor.
    let lastWindow: number | null = null;
    if (this.floor !== null) {
      const recent = await this.checkpoints.find(AUDIT_CHECKPOINT_OBJECT, {
        where: { sealed_object: this.plan.name, kind: 'window', window_start: { $gte: iso(this.floor) } },
      });
      // S7: a chain whose newest `window` part is not final resumes that window, from the next part.
      const newest = new Map<string, { start: number; part: number; final: boolean }>();
      for (const row of recent) {
        const key = String(row.chain_key);
        let start: number;
        let part: { part_index: number; final_part: boolean };
        try {
          start = Date.parse(canonicalDatetime(row.window_start, 'window_start'));
          // A checkpoint written before the amendment is one part, final.
          part = checkpointPartOf(row) ?? { part_index: 0, final_part: true };
        } catch (err) {
          this.skip(key, err, this.floor);
          continue;
        }
        const seen = newest.get(key);
        if (!seen || start > seen.start || (start === seen.start && part.part_index > seen.part)) {
          newest.set(key, { start, part: part.part_index, final: part.final_part });
        }
        lastWindow = Math.max(lastWindow ?? start, start);
      }
      for (const [key, { start, part, final }] of newest) {
        if (this.skipped.has(key)) continue;
        this.cursors.set(key, final ? start + AUDIT_SEAL_WINDOW_MS : start);
        if (!final) this.resume.set(key, { window: start, next: part + 1 });
      }
    }
    const due = windowOf(this.now - AUDIT_SEAL_SETTLE_MS);

    if (lastWindow !== null) await this.sealLate(lastWindow);

    let cursor: number | null = this.floor;
    if (cursor === null) {
      const oldest = await this.firstRowAt(null, due);
      if (oldest === null) return this.written;
      cursor = windowOf(oldest);
    }
    // Windows oldest first from the floor; each chain is sealed from its own cursor. A window that only re-reads
    // chains already sealed (or skipped) past it does not count toward the pass's windows; while a chain is
    // skipped it counts toward its own bound (review#3 S1): a chain that stays skipped holds the floor, and every
    // pass walks on from there. With none skipped it counts toward nothing, so the walk reaches the next window
    // that seals something and the floor moves on.
    for (let n = 0, idle = 0; n < MAX_WINDOWS_PER_PASS;) {
      const next = await this.firstRowAt(cursor, due);
      if (next === null) break;
      if (idle >= AUDIT_SEAL_MAX_IDLE_WINDOWS_PER_PASS) {
        this.idleStop = { at: windowOf(next), windows: idle };
        break;
      }
      const start = windowOf(next);
      const chains = await this.readWindow(start, (row) => start >= this.cursorOf(chainKeyOf(chainValueOf(row, this.plan.chainField))));
      if (chains.size > 0) n += 1;
      else if (this.skipped.size > 0) idle += 1;
      await this.writeChains(chains, start, 'window', Math.max(this.watermark ?? Number.NEGATIVE_INFINITY, Math.min(start, this.stuckFrom())));
      cursor = start + AUDIT_SEAL_WINDOW_MS;
    }
    return this.written;
  }

  /** S4: the first window of chain `key` this pass may seal as a `window`; a row of it before is `late`. */
  private cursorOf(key: string): number {
    return Math.max(this.floor ?? Number.NEGATIVE_INFINITY, this.cursors.get(key) ?? Number.NEGATIVE_INFINITY);
  }

  /** S4: the earliest window a skipped chain leaves unsealed; no watermark passes it. */
  private stuckFrom(): number {
    let from = Number.POSITIVE_INFINITY;
    for (const skip of this.skipped.values()) from = Math.min(from, skip.from);
    return from;
  }

  /**
   * S4: put chain `key` out for the rest of the pass over a chain-local fault
   * met at window `at`. It stays unsealed from its own oldest unsealed window:
   * its cursor, or `at` when the fault was met past it.
   */
  private skip(key: string, fault: unknown, at: number): void {
    if (this.skipped.has(key)) return;
    this.skipped.set(key, { fault: faultOf(fault instanceof ChainFault ? fault.fault : fault), from: Math.max(this.cursorOf(key), at) });
  }

  /**
   * Late rows (D3): each sealed window of the horizon whose stored count
   * differs from what its checkpoints list is read, and each unlisted row is
   * sealed into a `late` checkpoint of its chain. A row is late only before its
   * chain's own cursor; at or past it, the window pass seals it (S4), which is
   * how a chain a stopped pass (or a skip) left behind resumes as `window`.
   */
  private async sealLate(lastWindow: number): Promise<void> {
    const from = windowOf(this.now - AUDIT_SEAL_LATE_HORIZON_MS);
    const to = lastWindow + AUDIT_SEAL_WINDOW_MS;
    const listed = await this.checkpoints.find(AUDIT_CHECKPOINT_OBJECT, {
      where: { sealed_object: this.plan.name, window_start: { $gte: iso(Math.min(from, lastWindow)), $lt: iso(to) } },
    });
    const byWindow = new Map<number, Row[]>();
    for (const row of listed) {
      let start: number;
      try {
        start = Date.parse(canonicalDatetime(row.window_start, 'window_start'));
      } catch (err) {
        this.skip(String(row.chain_key), err, this.floor ?? from);
        continue;
      }
      byWindow.set(start, [...(byWindow.get(start) ?? []), row]);
    }
    const listedCount = (rows: readonly Row[]) => rows.reduce((sum, r) => sum + Number(r.leaf_count), 0);
    for (let start = from; start < to; start += AUDIT_SEAL_WINDOW_MS) {
      // S6: each window re-counted on its own, so a delete in one cannot hide a late row in another.
      await this.lock.renew(LOCK_TTL_MS);
      const holders = byWindow.get(start) ?? [];
      if ((await this.countRows(start, start + AUDIT_SEAL_WINDOW_MS)) === listedCount(holders)) continue;
      const ids = new Set<string>();
      for (const holder of holders) {
        try {
          for (const id of checkpointBodyFromRow(holder).row_ids) ids.add(id);
        } catch (err) {
          if (!isChainLocal(err)) throw err;
          this.skip(String(holder.chain_key), err, start); // S4: a malformed checkpoint of its chain
        }
      }
      const chains = await this.readWindow(start, (row) =>
        !ids.has(rowIdOf(row)) && start < this.cursorOf(chainKeyOf(chainValueOf(row, this.plan.chainField))));
      await this.writeChains(chains, start, 'late', this.watermark ?? start);
    }
  }

  /** The stores a pass reads: the hot store, then the archive. */
  private stores(): SealStorageDriver[] {
    return this.archive ? [this.hot, this.archive] : [this.hot];
  }

  /** A store's rows, or none when its table does not exist (an archive never written). */
  private async find(store: SealStorageDriver, query: Record<string, unknown>): Promise<Row[]> {
    try {
      return await store.find(this.plan.name, query);
    } catch (err) {
      if (store === this.archive && isMissingTableError(err, this.plan.name)) return [];
      throw err;
    }
  }

  private async countRows(from: number, to: number): Promise<number> {
    let total = 0;
    for (const store of this.stores()) {
      const query = { where: { created_at: { $gte: iso(from), $lt: iso(to) } } };
      if (typeof store.count === 'function') {
        try {
          total += await store.count(this.plan.name, query);
        } catch (err) {
          if (!(store === this.archive && isMissingTableError(err, this.plan.name))) throw err;
        }
      } else {
        total += (await this.find(store, query)).length;
      }
    }
    return total;
  }

  /** The earliest `created_at` at or after `from` and before `to`, across the stores, as epoch ms. */
  private async firstRowAt(from: number | null, to: number): Promise<number | null> {
    let first: number | null = null;
    for (const store of this.stores()) {
      const [row] = await this.find(store, {
        where: { created_at: from === null ? { $lt: iso(to) } : { $gte: iso(from), $lt: iso(to) } },
        orderBy: [{ field: 'created_at', order: 'asc' }],
        limit: 1,
      });
      if (!row) continue;
      const at = Date.parse(canonicalDatetime(row.created_at, `${rowIdOf(row)}.created_at`));
      if (first === null || at < first) first = at;
    }
    return first;
  }

  /**
   * The leaves of window `start`, by chain, of the rows `accept` keeps. A row
   * is read once though both stores hold it (between the archive's copy and
   * its hot delete), and only in the window its canonical `created_at` names.
   */
  private async readWindow(start: number, accept: (row: Row) => boolean): Promise<Map<string, ChainRows>> {
    const chains = new Map<string, ChainRows>();
    const seen = new Set<string>();
    const range = { created_at: { $gte: iso(start), $lt: iso(start + AUDIT_SEAL_WINDOW_MS) } };
    for (const store of this.stores()) {
      // S2: keyset paging on (created_at, id), each bound the driver's own spelling of the last row's
      // values: an offset would skip rows when the Archiver deletes earlier ones between pages.
      for (let after: Row | undefined; ;) {
        await this.lock.renew(LOCK_TTL_MS); // a large window outlasts one lease
        const rows = await this.find(store, {
          where: after === undefined ? range : { $and: [range, { $or: [
            { created_at: { $gt: after.created_at } },
            { $and: [{ created_at: after.created_at }, { id: { $gt: after.id } }] },
          ] }] },
          orderBy: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
          limit: PAGE_SIZE,
        });
        for (const row of rows) {
          const tenantId = chainValueOf(row, this.plan.chainField);
          const key = chainKeyOf(tenantId);
          if (this.skipped.has(key)) continue; // S4: out for the rest of the pass
          try {
            const id = rowIdOf(row);
            const at = canonicalDatetime(row.created_at, `${id}.created_at`);
            if (seen.has(id) || windowOf(Date.parse(at)) !== start || !accept(row)) continue;
            seen.add(id);
            let chain = chains.get(key);
            if (!chain) {
              chain = { tenantId, rows: [] };
              chains.set(key, chain);
            }
            // S7: ids and instants only; each part's rows are read again by id and hashed under its own seed.
            chain.rows.push({ id, at });
          } catch (err) {
            // S4: a row a canonical rule refuses skips its chain, and only its chain.
            if (!(err instanceof CanonicalFormError)) throw err;
            this.skip(key, err, start);
            chains.delete(key);
          }
        }
        if (rows.length < PAGE_SIZE) break;
        after = rows[rows.length - 1];
      }
    }
    return chains;
  }

  private async headOf(chainKey: string): Promise<ChainHead | null> {
    if (this.heads.has(chainKey)) return this.heads.get(chainKey) ?? null;
    const [row] = await this.checkpoints.find(AUDIT_CHECKPOINT_OBJECT, {
      where: { sealed_object: this.plan.name, chain_key: chainKey },
      orderBy: [{ field: 'sequence', order: 'desc' }],
      limit: 1,
    });
    let head: ChainHead | null = null;
    if (row) {
      let body: CheckpointSignedBody;
      try {
        body = checkpointBodyFromRow(row);
      } catch (err) {
        if (!isChainLocal(err)) throw err;
        throw new ChainFault(chainKey, err); // S4: a malformed chain head skips its chain
      }
      head = { sequence: body.sequence, digest: checkpointDigest(body) };
    }
    this.heads.set(chainKey, head);
    return head;
  }

  private async writeChains(chains: Map<string, ChainRows>, start: number, kind: AuditCheckpointKind, watermark: number): Promise<void> {
    // `readWindow` makes a chain only with its first row, so no checkpoint is empty (D3).
    for (const key of [...chains.keys()].sort()) {
      if (this.skipped.has(key)) continue;
      try {
        await this.writeChain(key, chains.get(key)!, start, kind, watermark);
      } catch (err) {
        // S4: only a chain-local fault of this chain skips it — a malformed checkpoint of it, or a row of it a
        // canonical rule refuses as its part is hashed; every other fault stops the object's pass.
        if (!(err instanceof CanonicalFormError) && !(err instanceof ChainFault && err.chainKey === key)) throw err;
        this.skip(key, err, start);
        continue;
      }
      if (kind === 'window') {
        this.cursors.set(key, start + AUDIT_SEAL_WINDOW_MS);
        this.resume.delete(key);
      }
    }
    if (kind === 'window') this.watermark = Math.max(this.watermark ?? watermark, watermark);
  }

  /**
   * S7: one chain's rows of window `start` as consecutive checkpoints of at
   * most N leaves, cut in D1 order, the last one final. A `window` sealing
   * that resumes a window a stopped pass left continues its part count and
   * seals only the rows no checkpoint lists yet.
   */
  private async writeChain(key: string, chain: ChainRows, start: number, kind: AuditCheckpointKind, watermark: number): Promise<void> {
    await this.headOf(key);
    const resumed = kind === 'window' ? this.resume.get(key) : undefined;
    let rows = chain.rows;
    if (kind === 'late' || resumed?.window === start) {
      // N1: the window's checkpoints, re-read once this chain's head is known: a row another sealer listed
      // since this pass read the window's lists is not sealed twice. One stored after the head was known
      // takes a sequence at or past this one, so the unique index refuses whichever insert comes second.
      // A resumed window drops the rows its earlier parts list the same way.
      const listed = await this.listedIn(start, key);
      rows = rows.filter((r) => !listed.has(r.id));
    }
    const ordered = [...rows].sort(leafOrder);
    const size = Math.max(1, Math.floor(this.options.maxLeaves ?? AUDIT_SEAL_MAX_LEAVES));
    const first = resumed?.window === start ? resumed.next : 0;
    for (let at = 0; at < ordered.length; at += size) {
      const seed = generateCheckpointSeed();
      const leaves = await this.leavesOf(key, seed, ordered.slice(at, at + size), start);
      // Every row of the part went since the window was read: nothing is written, and its index is not reused, so
      // part_index may skip one, and a window whose last part emptied has no final part. Nothing reads either.
      if (leaves.length === 0) continue;
      await this.writeCheckpoint(key, chain.tenantId, seed, leaves, start, kind, watermark, {
        part_index: first + at / size,
        final_part: at + size >= ordered.length,
      });
    }
  }

  /**
   * The leaves of one part: its rows read again by id, from the hot store and
   * then the archive, hashed under the part's seed, in D1 order. A row gone
   * since the window was read, or whose `created_at` or chain moved since, is
   * left out: it is no longer a row of this chain's window.
   */
  private async leavesOf(key: string, seed: Buffer, part: ReadonlyArray<{ id: string }>, start: number): Promise<Leaf[]> {
    const ids = part.map((r) => r.id);
    const byId = new Map<string, Row>();
    for (const store of this.stores()) {
      for (let i = 0; i < ids.length; i += PAGE_SIZE) {
        const batch = ids.slice(i, i + PAGE_SIZE).filter((id) => !byId.has(id));
        if (batch.length === 0) continue;
        await this.lock.renew(LOCK_TTL_MS);
        for (const row of await this.find(store, { where: { id: { $in: batch } } })) {
          const id = rowIdOf(row);
          if (!byId.has(id)) byId.set(id, row);
        }
      }
    }
    const saltOf = columnSaltsOf(seed, this.plan.name);
    const leaves: Leaf[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      const at = canonicalDatetime(row.created_at, `${id}.created_at`);
      if (windowOf(Date.parse(at)) !== start || chainKeyOf(chainValueOf(row, this.plan.chainField)) !== key) continue;
      leaves.push({ id, at, hash: leafHash(leafInput(row, this.plan.columns, this.plan.fields, saltOf)) });
    }
    return leaves.sort(leafOrder);
  }

  /**
   * Sign `build`'s body under the S1 loop: built with the key id the signer is
   * expected to use, signed, and when the signer answers with another key id,
   * rebuilt with that one and signed again. A signature whose key id differs
   * from the one its bytes name is never returned.
   */
  private async signBody(build: (keyId: string) => CheckpointSignedBody): Promise<{ body: CheckpointSignedBody; keyId: string; signature: string }> {
    let expected = this.keyId ?? (await this.signer.activeKeyId?.()) ?? NO_KEY_YET;
    for (let attempt = 0; attempt < MAX_SIGN_ATTEMPTS; attempt++) {
      const body = build(expected);
      const { keyId, signature } = await this.signer.sign(signedBodyBytes(body));
      if (keyId === expected) {
        this.keyId = keyId;
        return { body, keyId, signature };
      }
      expected = keyId;
    }
    throw new Error(`the checkpoint signer answered a different key id on each of ${MAX_SIGN_ATTEMPTS} attempts`);
  }

  private async writeCheckpoint(
    chainKey: string,
    tenantId: string | null,
    seed: Buffer,
    ordered: readonly Leaf[],
    start: number,
    kind: AuditCheckpointKind,
    watermark: number,
    part: { readonly part_index: number; readonly final_part: boolean },
  ): Promise<void> {
    const { engine, crypto } = this.options;
    const head = await this.headOf(chainKey);
    const sequence = head ? head.sequence + 1 : 0;
    // Q6: an over-long coordinate is refused here, before anything is encrypted or written.
    const context = checkpointSeedContext(this.plan.name, tenantId, sequence);
    await this.lock.renew(LOCK_TTL_MS);
    const handle = await crypto!.encrypt(encodeCheckpointSeed(seed), context);
    await writeAuditSealSecret(engine, handle, context);
    let signed: { body: CheckpointSignedBody; keyId: string; signature: string };
    try {
      const sealedAt = iso((this.options.now ?? Date.now)());
      signed = await this.signBody((signingKeyId) => ({
        sealed_object: this.plan.name,
        tenant_id: tenantId,
        sequence,
        kind,
        part_index: part.part_index,
        final_part: part.final_part,
        window_start: iso(start),
        window_end: iso(start + AUDIT_SEAL_WINDOW_MS),
        sealed_through: iso(watermark),
        leaf_count: ordered.length,
        row_ids: ordered.map((l) => l.id),
        root: merkleRoot(ordered.map((l) => l.hash)),
        previous_digest: head?.digest ?? null,
        columns: this.plan.columns,
        canon_version: AUDIT_SEAL_CANON_VERSION,
        seed_handle: handle.id,
        fencing_token: this.lock.fencingToken.toString(),
        sealed_at: sealedAt,
        signing_key_id: signingKeyId,
      }));
      const lapsed = await this.lock.lapsed(this.plan.name);
      if (lapsed) throw new Error(`${lapsed} lapsed before the checkpoint was written`);
      // S1: the chain's window head, re-read under the lease: a window another sealer sealed (or passed)
      // since this pass began is not sealed again. Windows of a chain are sealed oldest first, and the parts of
      // one window in order (S7), so only a later window or a part of this one at this index or past it refuses.
      // A checkpoint of this window written before the amendment is the whole window; its part index is NULL,
      // which no comparison matches on SQL (`NULL >= 0` is not true), so it is matched as NULL.
      const thisWindow = { $gte: iso(start), $lt: iso(start + AUDIT_SEAL_WINDOW_MS) };
      if (kind === 'window' && (await this.storedCheckpoint(chainKey, { kind: 'window', $or: [
        { window_start: { $gte: iso(start + AUDIT_SEAL_WINDOW_MS) } },
        { window_start: thisWindow, part_index: { $gte: part.part_index } },
        { window_start: thisWindow, part_index: { $null: true } },
      ] }))) {
        throw new Error(`chain '${chainKey}' already holds a window checkpoint at or after part ${part.part_index} of ${iso(start)}; it is not sealed twice`);
      }
    } catch (err) {
      // No insert was attempted, so nothing names the seed.
      await dropAuditSealSecret(engine, handle.id);
      this.heads.delete(chainKey);
      throw err;
    }
    const { body, keyId, signature } = signed;
    try {
      // The leaf hashes ride beside the signed root, which authenticates them (D9's per-row verdicts).
      const leafHashes = ordered.map((l) => l.hash.toString('hex'));
      await engine.insert(AUDIT_CHECKPOINT_OBJECT, checkpointRow(body, { id: randomUUID(), signature, leafHashes }), { context: { isSystem: true } });
    } catch (err) {
      // M1: an insert can reject after its row is stored (an afterInsert hook that throws, a lost
      // acknowledgement), so the seed is kept either way: a stored checkpoint whose seed was dropped could
      // never be recomputed. Unstored, the seed is an orphan for `os secret orphans`.
      const stored = await this.storedCheckpoint(chainKey, { sequence }).catch(() => undefined);
      if (stored?.seed_handle !== handle.id) {
        // N2: another checkpoint holds this sequence, so the unique index proves this seed can never be
        // stored: it is dropped. With no row read back, whether this insert stored is unknown, and it is kept.
        if (stored !== undefined) await dropAuditSealSecret(engine, handle.id);
        this.heads.delete(chainKey);
        throw err;
      }
      this.options.logger.warn(`AuditSealer: the checkpoint insert reported a failure (${faultOf(err)}) after its row was stored; it stands`, {
        sealed_object: this.plan.name, chain_key: chainKey, sequence,
      });
    }
    this.heads.set(chainKey, { sequence, digest: checkpointDigest(body) });
    this.written += 1;
    await this.deliver(body, keyId, signature);
  }

  /**
   * The row ids the stored checkpoints of window `start` list, every chain's,
   * as read now. A malformed one skips its chain (S4): this chain's, with a
   * {@link ChainFault}; another's, for the rest of the pass.
   */
  private async listedIn(start: number, chainKey: string): Promise<Set<string>> {
    const rows = await this.checkpoints.find(AUDIT_CHECKPOINT_OBJECT, {
      where: { sealed_object: this.plan.name, window_start: { $gte: iso(start), $lt: iso(start + AUDIT_SEAL_WINDOW_MS) } },
    });
    const ids = new Set<string>();
    for (const row of rows) {
      try {
        for (const id of checkpointBodyFromRow(row).row_ids) ids.add(id);
      } catch (err) {
        if (!isChainLocal(err)) throw err;
        if (String(row.chain_key) === chainKey) throw new ChainFault(chainKey, err);
        this.skip(String(row.chain_key), err, start);
      }
    }
    return ids;
  }

  /** This chain's stored checkpoint matching `where`, if any. */
  private async storedCheckpoint(chainKey: string, where: Row): Promise<Row | undefined> {
    const [row] = await this.checkpoints.find(AUDIT_CHECKPOINT_OBJECT, { where: { sealed_object: this.plan.name, chain_key: chainKey, ...where }, limit: 1 });
    return row;
  }

  private async deliver(body: CheckpointSignedBody, keyId: string, signature: string): Promise<void> {
    try {
      await this.sink?.deliver({ kind: 'checkpoint', body: body as unknown as Record<string, unknown>, keyId, signature });
    } catch (err) {
      this.options.logger.warn('AuditSealer: the checkpoint sink failed to take a checkpoint; it stays stored on the host', {
        sealed_object: body.sealed_object,
        sequence: body.sequence,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
}
