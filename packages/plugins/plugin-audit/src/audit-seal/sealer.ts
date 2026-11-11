// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { DispatchLoop } from '@objectstack/core';
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
  canonicalDatetime,
  leafHash,
  leafInput,
  rowIdOf,
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
  checkpointRow,
  signedBodyBytes,
  type AuditCheckpointKind,
  type CheckpointSignedBody,
} from './signed-body.js';
import { dropAuditSealSecret, writeAuditSealSecret, type SealStorageDriver, type SealStorageEngine } from './signer.js';

/**
 * ADR-0154 D3 — the sealer: after a settle lag, one window at a time, under
 * the cluster lock `audit.sealer`, it seals each sealed object's rows into one
 * signed checkpoint per chain (organization, or the deployment) per window.
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

export interface AuditSealerOptions {
  engine: AuditSealerEngine;
  crypto?: ICryptoProvider;
  /** Resolved per pass: a host's `audit.checkpointSigner`, or the default one. */
  signer: () => (IAuditCheckpointSigner & { activeKeyId?(): Promise<string | null> }) | undefined;
  /** Resolved per pass: a host's `audit.checkpointSink`, if any. */
  sink?: () => IAuditCheckpointSink | undefined;
  /** Resolved per pass: the `cluster` service, if any. */
  cluster?: () => IClusterService | undefined;
  logger: AuditSealerLogger;
  now?: () => number;
}

/** A sealed object, as a pass reads it. */
interface SealPlan {
  readonly name: string;
  readonly fields: SealedFieldTypes;
  readonly columns: SealedColumnSet;
  readonly archiveTo?: string;
}

interface ChainHead {
  readonly sequence: number;
  readonly digest: string;
}

/** One chain's rows of one window, as leaves. */
interface ChainLeaves {
  readonly tenantId: string | null;
  readonly seed: Buffer;
  readonly leaves: Array<{ id: string; at: string; hash: Buffer }>;
}

const iso = (ms: number): string => new Date(ms).toISOString();

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
const tenantOf = (row: Row): string | null => (typeof row.tenant_id === 'string' && row.tenant_id !== '' ? row.tenant_id : null);

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

  /** The sealed objects the registry holds that can be sealed; each that cannot is reported. */
  private plans(): SealPlan[] {
    const plans: SealPlan[] = [];
    for (const object of this.options.engine.registry.getAllObjects()) {
      const lifecycle = object.lifecycle as { seal?: { valueFields?: string[] }; archive?: { to?: string } } | undefined;
      if (!lifecycle?.seal) continue;
      const fields = (object.fields ?? {}) as SealedFieldTypes;
      let reason: string | null = null;
      let columns: SealedColumnSet | null = null;
      try {
        columns = sealedColumnSet(fields, lifecycle.seal.valueFields ?? []);
        const refused = unsealableColumns(columns, fields);
        if (refused.length > 0) {
          reason = `its column(s) ${refused.map((c) => `'${c.column}' (type '${c.type ?? 'none'}')`).join(', ')} ` +
            'have no canonical rule';
        } else if (!Object.prototype.hasOwnProperty.call(fields, 'tenant_id')) {
          // S3: a chain is the row's own `tenant_id`; without the column every organization would share one.
          reason = "it declares no 'tenant_id' field, so its rows cannot be chained per organization";
        }
      } catch (err) {
        reason = (err as Error).message;
      }
      if (reason !== null || columns === null) {
        this.report(`plan:${object.name}`, () =>
          `AuditSealer: '${object.name}' declares lifecycle.seal but cannot be sealed: ${reason}. Its rows are NOT ` +
          'being sealed — no checkpoint covers them, so a change made outside the platform would not show. Fix: ' +
          "give the object a 'tenant_id' field and only columns of a type with a canonical rule (ADR-0154 D1, D5), " +
          'or remove lifecycle.seal.');
        continue;
      }
      plans.push({ name: object.name, fields, columns, ...(lifecycle.archive?.to ? { archiveTo: lifecycle.archive.to } : {}) });
    }
    return plans;
  }

  private async acquireLock(): Promise<LockHandle | null> {
    let cluster: IClusterService | undefined;
    try {
      cluster = this.options.cluster?.();
    } catch {
      cluster = undefined;
    }
    if (cluster?.lock) return cluster.lock.acquire(AUDIT_SEALER_LOCK, { ttlMs: LOCK_TTL_MS, waitMs: 0 });
    if (!this.reported.has('in-process-lock')) {
      this.reported.set('in-process-lock', this.now());
      this.options.logger.info(
        'AuditSealer: no cluster service is registered, so the audit.sealer lock is held in-process only — ' +
          'cross-replica exclusion is off by the host\'s declaration. The checkpoint table\'s unique ' +
          '(sealed_object, chain_key, sequence) index still refuses a second checkpoint at a taken sequence.',
      );
    }
    return acquireInProcessLock();
  }

  /** One pass over every sealed object. Resolves to the number of checkpoints written. */
  async runPass(): Promise<number> {
    const plans = this.plans();
    if (plans.length === 0) return 0;
    const signer = this.options.signer();
    if (!this.options.crypto || !signer) {
      this.report('no-crypto', () =>
        `AuditSealer: ${plans.map((p) => `'${p.name}'`).join(', ')} declare(s) lifecycle.seal, but this deployment has ` +
        `no ${this.options.crypto ? 'checkpoint signer' : 'crypto provider'} — rows of the sealed objects are NOT ` +
        'being sealed, so a change made outside the platform would not show while everything looks healthy. Fix: ' +
        'wire a crypto provider (AuditPluginOptions.cryptoProvider), or remove lifecycle.seal.');
      return 0;
    }
    const lock = await this.acquireLock();
    if (!lock) return 0;
    try {
      let written = 0;
      for (const plan of plans) {
        // One object's fault never stops another's sealing; it is reported while it lasts.
        let pass: ObjectPass | undefined;
        try {
          pass = new ObjectPass(this.options, plan, lock, signer, this.now());
          await pass.run();
          for (const cause of this.reported.keys()) if (cause.startsWith(`object:${plan.name}:`)) this.reported.delete(cause);
        } catch (err) {
          const fault = faultOf(err);
          this.report(`object:${plan.name}:${fault}`, () =>
            `AuditSealer: sealing '${plan.name}' FAILED (${fault}) — its rows from this point on are not being ` +
            'sealed until a pass gets past it; each pass retries. Fix the fault named here.');
        } finally {
          written += pass?.written ?? 0;
        }
      }
      return written;
    } finally {
      await lock.release();
    }
  }
}

/** One pass over one sealed object. */
class ObjectPass {
  private readonly heads = new Map<string, ChainHead | null>();
  private readonly hot: SealStorageDriver;
  private readonly archive: SealStorageDriver | undefined;
  private readonly checkpoints: SealStorageDriver;
  private watermark: number | null = null;
  /** Checkpoints this pass wrote, counted as each lands. */
  written = 0;
  /** The key id the last checkpoint of this pass was signed under: the next body's expectation. */
  private keyId: string | null = null;

  constructor(
    private readonly options: AuditSealerOptions,
    private readonly plan: SealPlan,
    private readonly lock: LockHandle,
    private readonly signer: IAuditCheckpointSigner & { activeKeyId?(): Promise<string | null> },
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
    const [last] = await this.checkpoints.find(AUDIT_CHECKPOINT_OBJECT, {
      where: { sealed_object: this.plan.name, kind: 'window' },
      orderBy: [{ field: 'window_start', order: 'desc' }],
      limit: 1,
    });
    const lastWindow = last ? Date.parse(canonicalDatetime(last.window_start, 'window_start')) : null;
    const due = windowOf(this.now - AUDIT_SEAL_SETTLE_MS);

    let resumed: Set<string> | null = null;
    if (lastWindow !== null) resumed = await this.sealLate(lastWindow);

    let cursor: number | null = lastWindow;
    if (cursor === null) {
      const oldest = await this.firstRowAt(null, due);
      if (oldest === null) return this.written;
      cursor = windowOf(oldest);
    }
    for (let n = 0; n < MAX_WINDOWS_PER_PASS; n++) {
      const next = await this.firstRowAt(cursor, due);
      if (next === null) break;
      const start = windowOf(next);
      const done = start === lastWindow ? resumed : null;
      const chains = await this.readWindow(start, (row) => !done?.has(chainKeyOf(tenantOf(row))));
      await this.writeChains(chains, start, 'window', Math.max(this.watermark ?? start, start));
      cursor = start + AUDIT_SEAL_WINDOW_MS;
    }
    return this.written;
  }

  /**
   * Late rows (D3): each sealed window of the horizon whose stored count
   * differs from what its checkpoints list is read, and each unlisted row is
   * sealed into a `late` checkpoint of its chain. In the last sealed window a
   * chain with no `window` checkpoint yet is left to the window pass, which
   * resumes it. Resolves to the chains that window already holds.
   */
  private async sealLate(lastWindow: number): Promise<Set<string>> {
    const from = windowOf(this.now - AUDIT_SEAL_LATE_HORIZON_MS);
    const to = lastWindow + AUDIT_SEAL_WINDOW_MS;
    const listed = await this.checkpoints.find(AUDIT_CHECKPOINT_OBJECT, {
      where: { sealed_object: this.plan.name, window_start: { $gte: iso(Math.min(from, lastWindow)), $lt: iso(to) } },
    });
    const byWindow = new Map<number, Row[]>();
    for (const row of listed) {
      const start = Date.parse(canonicalDatetime(row.window_start, 'window_start'));
      byWindow.set(start, [...(byWindow.get(start) ?? []), row]);
    }
    const resumed = new Set((byWindow.get(lastWindow) ?? []).filter((r) => r.kind === 'window').map((r) => String(r.chain_key)));
    const listedCount = (rows: readonly Row[]) => rows.reduce((sum, r) => sum + Number(r.leaf_count), 0);
    for (let start = from; start < to; start += AUDIT_SEAL_WINDOW_MS) {
      // S6: each window re-counted on its own, so a delete in one cannot hide a late row in another.
      await this.lock.renew(LOCK_TTL_MS);
      const holders = byWindow.get(start) ?? [];
      if ((await this.countRows(start, start + AUDIT_SEAL_WINDOW_MS)) === listedCount(holders)) continue;
      const ids = new Set(holders.flatMap((r) => checkpointBodyFromRow(r).row_ids));
      const chains = await this.readWindow(start, (row) =>
        !ids.has(rowIdOf(row)) && (start !== lastWindow || resumed.has(chainKeyOf(tenantOf(row)))));
      await this.writeChains(chains, start, 'late', this.watermark ?? start);
    }
    return resumed;
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
  private async readWindow(start: number, accept: (row: Row) => boolean): Promise<Map<string, ChainLeaves>> {
    const chains = new Map<string, ChainLeaves>();
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
          const id = rowIdOf(row);
          const at = canonicalDatetime(row.created_at, `${id}.created_at`);
          if (seen.has(id) || windowOf(Date.parse(at)) !== start || !accept(row)) continue;
          seen.add(id);
          const tenantId = tenantOf(row);
          const key = chainKeyOf(tenantId);
          let chain = chains.get(key);
          if (!chain) {
            chain = { tenantId, seed: generateCheckpointSeed(), leaves: [] };
            chains.set(key, chain);
          }
          const leaf = leafInput(row, this.plan.columns, this.plan.fields, columnSaltsOf(chain.seed, this.plan.name));
          chain.leaves.push({ id, at, hash: leafHash(leaf) });
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
    const head = row ? (() => {
      const body = checkpointBodyFromRow(row);
      return { sequence: body.sequence, digest: checkpointDigest(body) };
    })() : null;
    this.heads.set(chainKey, head);
    return head;
  }

  private async writeChains(chains: Map<string, ChainLeaves>, start: number, kind: AuditCheckpointKind, watermark: number): Promise<void> {
    // `readWindow` makes a chain only with its first leaf, so no checkpoint is empty (D3).
    for (const key of [...chains.keys()].sort()) await this.writeCheckpoint(key, chains.get(key)!, start, kind, watermark);
    if (kind === 'window') this.watermark = Math.max(this.watermark ?? watermark, watermark);
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

  private async writeCheckpoint(chainKey: string, chain: ChainLeaves, start: number, kind: AuditCheckpointKind, watermark: number): Promise<void> {
    const { engine, crypto } = this.options;
    const ordered = [...chain.leaves].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const head = await this.headOf(chainKey);
    const sequence = head ? head.sequence + 1 : 0;
    // Q6: an over-long coordinate is refused here, before anything is encrypted or written.
    const context = checkpointSeedContext(this.plan.name, chain.tenantId, sequence);
    await this.lock.renew(LOCK_TTL_MS);
    const handle = await crypto!.encrypt(encodeCheckpointSeed(chain.seed), context);
    await writeAuditSealSecret(engine, handle, context);
    let signed: { body: CheckpointSignedBody; keyId: string; signature: string };
    try {
      const sealedAt = iso((this.options.now ?? Date.now)());
      signed = await this.signBody((signingKeyId) => ({
        sealed_object: this.plan.name,
        tenant_id: chain.tenantId,
        sequence,
        kind,
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
      if (!this.lock.isHeld()) throw new Error('the audit.sealer lock lapsed before the checkpoint was written');
      // S1: the chain's window head, re-read under the lease: a window another sealer sealed (or passed)
      // since this pass began is not sealed again. Windows of a chain are sealed oldest first.
      if (kind === 'window' && (await this.storedCheckpoint(chainKey, { kind: 'window', window_start: { $gte: iso(start) } }))) {
        throw new Error(`chain '${chainKey}' already holds a window checkpoint at or after ${iso(start)}; it is not sealed twice`);
      }
    } catch (err) {
      // No insert was attempted, so nothing names the seed.
      await dropAuditSealSecret(engine, handle.id);
      this.heads.delete(chainKey);
      throw err;
    }
    const { body, keyId, signature } = signed;
    try {
      await engine.insert(AUDIT_CHECKPOINT_OBJECT, checkpointRow(body, { id: randomUUID(), signature }), { context: { isSystem: true } });
    } catch (err) {
      // M1: an insert can reject after its row is stored (an afterInsert hook that throws, a lost
      // acknowledgement), so the seed is kept either way: a stored checkpoint whose seed was dropped could
      // never be recomputed. Unstored, the seed is an orphan for `os secret orphans`.
      const stored = await this.storedCheckpoint(chainKey, { sequence }).catch(() => undefined);
      if (stored?.seed_handle !== handle.id) {
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

  /** This chain's stored checkpoint matching `where`, if any. */
  private async storedCheckpoint(chainKey: string, where: Row): Promise<Row | undefined> {
    const [row] = await this.checkpoints.find(AUDIT_CHECKPOINT_OBJECT, { where: { sealed_object: this.plan.name, chain_key: chainKey, ...where }, limit: 1 });
    return row;
  }

  private async deliver(body: CheckpointSignedBody, keyId: string, signature: string): Promise<void> {
    let sink: IAuditCheckpointSink | undefined;
    try {
      sink = this.options.sink?.();
      await sink?.deliver({ kind: 'checkpoint', body: body as unknown as Record<string, unknown>, keyId, signature });
    } catch (err) {
      this.options.logger.warn('AuditSealer: the checkpoint sink failed to take a checkpoint; it stays stored on the host', {
        sealed_object: body.sealed_object,
        sequence: body.sequence,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
}
