// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0008 PR-10b — `SysMetadataRepository`.
 *
 * Wraps the existing `sys_metadata` table behind the canonical
 * `MetadataRepository` interface. Implements the *single-row update*
 * semantics that ADR-0005 already ships — append-only event-log
 * persistence is M1 work.
 *
 * What this layer DOES (M0 + M1):
 *   - get / put / delete / list against `sys_metadata`
 *   - tenancy scope = `organization_id` (per-org overlays only;
 *     project/branch concepts removed — see ADR-0008 §0 amendment)
 *   - hash stamping with `hashSpec` (PR-10a guarantees stability)
 *   - watch() implemented via an in-memory event broadcaster fed by
 *     every successful put/delete on THIS instance
 *   - whitelist enforcement: refuses to persist types whose registry
 *     entry has `allowOrgOverride: false` (Prime Directive #8)
 *   - **M1**: every successful put/delete appends a durable row to
 *     `sys_metadata_history` inside the same engine.transaction() as the
 *     parent `sys_metadata` write. No-op puts (identical hash) skip the
 *     history write. Failed optimistic-lock checks abort before any
 *     write reaches the database.
 *   - **M1**: history() yields events from the durable log, ordered by
 *     per-(org,type,name) `version` ASC.
 *
 * What this layer does NOT do (and will not, by design):
 *   - cross-replica push notifications (LISTEN/NOTIFY, pub/sub, etc.).
 *     The watch() contract is scoped to the local repository instance.
 *     Multi-replica deployments are not a supported topology for the
 *     metadata overlay — see ADR-0008 §11.
 *   - hashSpec backfill for legacy rows missing `checksum`
 *
 * Schema mapping (ADR-0008 PR-10d.2):
 *   Repository concept      sys_metadata column
 *   ─────────────────────── ───────────────────
 *   body                  → metadata           (JSON string)
 *   hash (sha256)         → checksum           (text(64))
 *   monotonic version int → version            (number)
 *   org isolation         → organization_id    (lookup)
 *   actor                 → updated_by         (lookup, optional)
 *
 * Composition: PR-10c will compose
 *   `LayeredRepository([FileSystemRepository, SysMetadataRepository])`
 * and the manager bridge will route reads through that. Until then this
 * file is intentionally NOT wired into any production path — it has its
 * own test surface so we can build confidence before flipping the
 * switch.
 */

import { hashSpec, ConflictError } from '@objectstack/metadata-core';
import { readEnvWithDeprecation } from '@objectstack/types';
import type {
  MetadataRepository,
  MetaRef,
  MetadataItem,
  MetadataItemHeader,
  MetadataEvent,
  MetadataWriteIntent,
  PutOptions,
  PutResult,
  DeleteOptions,
  DeleteResult,
  ListFilter,
  WatchFilter,
  HistoryOptions,
} from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';

/**
 * Overlay-row lifecycle state.
 *
 *  - `'active'`  → the published, live overlay. `getMetaItem` (the
 *    default read path) and runtime loaders observe this row.
 *  - `'draft'`   → an unpublished pending change. Lives alongside the
 *    active row (one of each per `(org,type,name)`). Promoted to
 *    `active` via {@link SysMetadataRepository.promoteDraft}.
 *
 * Other lifecycle values defined on `sys_metadata.state` (`'archived'`,
 * `'deprecated'`) are not yet plumbed through the overlay write path;
 * they remain reserved for future flows (item retirement, freeze).
 */
export type OverlayState = 'active' | 'draft';

/**
 * Extended history operation tag. The base `'create' | 'update' |
 * 'delete'` operations are emitted by the canonical put/delete paths.
 * `'publish'` is recorded when a draft is promoted, `'revert'` when a
 * historical version is restored. Both are surfaced as MetadataEvent
 * `.op` values via `history()`.
 */
export type ExtendedOperation = 'create' | 'update' | 'publish' | 'revert' | 'delete';

/**
 * Sub-set of the ObjectQL engine shape we depend on. Kept narrow so
 * tests can stub it with a plain mock. Mirrors the real engine's
 * `options.context` pattern so transactions can thread through.
 */
export interface SysMetadataEngine {
  find(
    table: string,
    options: { where: Record<string, unknown>; limit?: number; orderBy?: any; context?: any },
  ): Promise<any[]>;
  findOne(
    table: string,
    options: { where: Record<string, unknown>; context?: any },
  ): Promise<any | null>;
  insert(
    table: string,
    data: Record<string, unknown>,
    options?: { context?: any },
  ): Promise<{ id: string }>;
  update(
    table: string,
    data: Record<string, unknown>,
    options: { where: Record<string, unknown>; context?: any },
  ): Promise<{ id: string }>;
  delete(
    table: string,
    options: { where: Record<string, unknown>; context?: any },
  ): Promise<{ deleted: number }>;
  /**
   * Optional. Falls through to direct callback invocation if the
   * underlying driver lacks ACID support (matches the real
   * `ObjectQL.transaction` semantics). Repository code must not rely on
   * rollback for correctness against in-memory drivers.
   */
  transaction?<T>(callback: (trxCtx: any) => Promise<T>, baseContext?: any): Promise<T>;
}

export interface SysMetadataRepositoryOptions {
  engine: SysMetadataEngine;
  /**
   * Tenancy scope. `null` writes to env-wide overlay rows; a string
   * scopes to one organization (the supported shared-DB tenant model
   * — see ADR-0005 amendment).
   */
  organizationId?: string | null;
  /** Org label embedded in returned MetaRefs. Defaults to organizationId or `"system"`. */
  orgLabel?: string;
}

/** Derived from registry — single source of truth (Prime Directive #8). */
const OVERLAY_ALLOWED_TYPES: ReadonlySet<string> = new Set(
  DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => e.allowOrgOverride)
    .map((e) => e.type),
);

/**
 * Types that opt into runtime creation of brand-new items (two-tier
 * model — ADR-0005 extension). These items live only in `sys_metadata`;
 * there is no artifact backing them and `allowOrgOverride` need not be
 * granted on the type. Used by `assertAllowed()` when called with
 * `intent: 'runtime-only'` — a signal from the protocol layer that it
 * has already verified the absence of an artifact-shadowing collision.
 */
/**
 * Set of type names that have an *explicit* entry in the static registry.
 * Anything outside this set is a runtime-registered type (e.g. plugin-
 * provided `theme`, `api`, `connector`, …) — the listing endpoint
 * (`getMetaTypes()` in protocol.ts) synthesises a descriptor with
 * `allowRuntimeCreate: true` for those, so the write gate must agree.
 */
const STATIC_REGISTRY_TYPES: ReadonlySet<string> = new Set(
  DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type),
);

const RUNTIME_CREATE_ALLOWED_TYPES: ReadonlySet<string> = new Set(
  DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => e.allowRuntimeCreate)
    .map((e) => e.type),
);

/**
 * Phase 3a-env-writable: parse `OS_METADATA_WRITABLE` (comma-
 * separated singular type names). Memoised; tests can reset via
 * {@link resetEnvWritableMetadataTypes}. Mirrors the same helper in
 * ObjectStackProtocolImplementation — both gates must consult the same
 * elevated set so the env-var escape hatch is applied consistently
 * regardless of which write path a caller takes.
 */
let _envWritableMetadataTypes: Set<string> | null = null;
function envWritableMetadataTypes(): ReadonlySet<string> {
  if (_envWritableMetadataTypes !== null) return _envWritableMetadataTypes;
  const raw = readEnvWithDeprecation('OS_METADATA_WRITABLE', 'OBJECTSTACK_METADATA_WRITABLE') || '';
  const set = new Set<string>();
  for (const tok of raw.split(',')) {
    const t = tok.trim();
    if (!t) continue;
    const singular = PLURAL_TO_SINGULAR[t] ?? t;
    set.add(singular);
    const plural = SINGULAR_TO_PLURAL[singular];
    if (plural) set.add(plural);
  }
  _envWritableMetadataTypes = set;
  return set;
}

/** Test hook — clear the memoised env-writable cache. */
export function resetEnvWritableMetadataTypes(): void {
  _envWritableMetadataTypes = null;
}

export class SysMetadataRepository implements MetadataRepository {
  private readonly engine: SysMetadataEngine;
  private readonly organizationId: string | null;
  private readonly orgLabel: string;

  /**
   * Local seq counter for in-memory watch() event broadcasts. Mirrors
   * the durable `event_seq` we write into `sys_metadata_history` on
   * each successful put/delete — assigned AFTER the transaction commits
   * so we never broadcast events that got rolled back.
   */
  private seqCounter = 0;
  private readonly watchers = new Set<(evt: MetadataEvent) => void>();
  private closed = false;

  /** Table name for the durable event log. */
  private readonly historyTable = 'sys_metadata_history';

  constructor(opts: SysMetadataRepositoryOptions) {
    this.engine = opts.engine;
    this.organizationId = opts.organizationId ?? null;
    this.orgLabel = opts.orgLabel ?? (opts.organizationId ?? 'system');
  }

  /**
   * Run `cb` inside `engine.transaction(...)` if the engine supports it,
   * otherwise fall through to a direct call. Matches the real
   * `ObjectQL.transaction` semantics — in-memory drivers (and our test
   * fakes) get no rollback, which is acceptable because production
   * always runs on a SQL driver with real ACID.
   */
  private async withTxn<T>(cb: (ctx: any) => Promise<T>): Promise<T> {
    if (typeof this.engine.transaction === 'function') {
      return this.engine.transaction(cb);
    }
    return cb(undefined);
  }

  /**
   * Read the current overlay row. Returns null if no row exists —
   * callers (e.g. LayeredRepository) fall through to lower layers.
   *
   * `opts.state` selects which lifecycle row to read: defaults to the
   * live published row (`'active'`). Pass `'draft'` to read the pending
   * unpublished revision (if any).
   */
  async get(
    ref: MetaRef,
    opts?: { state?: OverlayState; packageId?: string | null },
  ): Promise<MetadataItem | null> {
    this.assertOpen();
    const state = opts?.state ?? 'active';
    // ADR-0048 — when a package scope is supplied, resolve the row owned by
    // that package (used by saveMetaItem to read the correct parent-version
    // lineage before an upsert). Omitted → legacy "any package" match.
    const row = await this.engine.findOne('sys_metadata', {
      where: this.whereFor(ref, state, opts && 'packageId' in opts ? (opts.packageId ?? null) : undefined),
    });
    if (!row) return null;
    return this.rowToItem(ref, row);
  }

  /**
   * Resolve a historical version by content hash (ADR-0009).
   *
   * Looks up `sys_metadata_history` by `(organization_id, type, name,
   * checksum)`. Returns null if no row matches. `executionPinned` types
   * are guaranteed to find their body here because history GC skips
   * them.
   */
  async getByHash(ref: MetaRef, hash: string): Promise<MetadataItem | null> {
    this.assertOpen();
    const full = this.fullRef(ref);
    const row = await this.engine.findOne(this.historyTable, {
      where: {
        organization_id: this.organizationId,
        type: full.type,
        name: full.name,
        checksum: hash,
      },
    });
    if (!row) return null;
    const rawBody = (row as any).metadata;
    if (rawBody === null || rawBody === undefined) {
      // Tombstone — body is gone, do not resurrect.
      return null;
    }
    const body =
      typeof rawBody === 'string' ? JSON.parse(rawBody) : (rawBody as Record<string, unknown>);
    return {
      ref: { ...full, version: undefined },
      body: body as Record<string, unknown>,
      hash,
      parentHash: (row as any).previous_checksum ?? null,
      authoredBy: (row as any).recorded_by ?? 'unknown',
      authoredAt: (row as any).recorded_at ?? new Date(0).toISOString(),
      message: (row as any).change_note ?? undefined,
      seq: ((row as any).event_seq as number) ?? 0,
    };
  }

  async put(
    ref: MetaRef,
    spec: unknown,
    opts: PutOptions & { state?: OverlayState; opType?: ExtendedOperation },
  ): Promise<PutResult> {
    this.assertOpen();
    this.assertAllowed(ref.type, opts.intent);

    const state: OverlayState = opts.state ?? 'active';
    const body = (spec ?? {}) as Record<string, unknown>;
    const hash = hashSpec(body);

    // Run all reads + writes inside one transaction so the optimistic
    // lock, the parent-row mutation, and the history append are atomic.
    const result = await this.withTxn(async (ctx) => {
      // ADR-0048 — scope the existing-row lookup to the requested package so a
      // save for package B does not find (and overwrite) package A's same-name
      // overlay. A package-less save (packageId null) targets the global row.
      const existing = await this.engine.findOne('sys_metadata', {
        where: this.whereFor(ref, state, opts.packageId ?? null),
        context: ctx,
      });
      const existingHash: string | null = existing?.checksum ?? null;
      if (opts.parentVersion !== existingHash) {
        throw new ConflictError(this.fullRef(ref), opts.parentVersion, existingHash);
      }

      // No-op short-circuit: identical body → no write, no history row,
      // no event. We re-yield the existing item so callers see the
      // canonical hash but the seqCounter is unchanged.
      if (existing && existingHash === hash) {
        const item = this.rowToItem(ref, existing);
        return { skipped: true as const, version: hash, seq: item.seq, item };
      }

      const now = new Date().toISOString();
      const baseOp: 'create' | 'update' = existing ? 'update' : 'create';
      const op: ExtendedOperation = opts.opType ?? baseOp;

      // Per-(org,type,name) lineage counter. Use MAX from history so
      // delete+recreate continues incrementing instead of restarting
      // at 1 (which the prior `sys_metadata.version` semantics did).
      const version = await this.nextItemVersion(ref, ctx);
      // Per-org monotonic event log cursor.
      const eventSeq = await this.nextEventSeq(ctx);

      const parentRowData: Record<string, unknown> = {
        type: ref.type,
        name: ref.name,
        organization_id: this.organizationId,
        metadata: JSON.stringify(body),
        checksum: hash,
        state,
        version,
        updated_at: now,
      };
      // Software-package binding (Studio package authoring workspace).
      // Create: stamp with the requested package (or null). Update: preserve
      // an existing non-null binding so an edit made with a different package
      // selected never silently re-binds the row; only fill a null binding.
      if (existing) {
        const existingPkg = (existing as { package_id?: string | null }).package_id ?? null;
        parentRowData.package_id = existingPkg ?? opts.packageId ?? null;
      } else {
        parentRowData.package_id = opts.packageId ?? null;
      }
      if (existing) {
        const existingId = (existing as { id?: string }).id;
        if (existingId === undefined) {
          throw new Error(
            `SysMetadataRepository.put: existing row for ${ref.type}/${ref.name} has no id column`,
          );
        }
        await this.engine.update('sys_metadata', parentRowData, {
          where: { id: existingId },
          context: ctx,
        });
      } else {
        parentRowData.created_at = now;
        await this.engine.insert('sys_metadata', parentRowData, { context: ctx });
      }

      // Durable history append — same transaction, so the parent write
      // and the audit row commit together or roll back together.
      await this.engine.insert(
        this.historyTable,
        {
          id: this.uuid(),
          event_seq: eventSeq,
          type: ref.type,
          name: ref.name,
          version,
          operation_type: op,
          metadata: JSON.stringify(body),
          checksum: hash,
          previous_checksum: existingHash,
          change_note: opts.message,
          source: opts.source ?? 'sys-metadata-repo',
          organization_id: this.organizationId,
          recorded_by: opts.actor,
          recorded_at: now,
        },
        { context: ctx },
      );

      const item: MetadataItem = {
        ref: this.fullRef(ref),
        body,
        hash,
        parentHash: existingHash,
        authoredBy: opts.actor,
        authoredAt: now,
        message: opts.message,
        seq: eventSeq,
      };

      return {
        skipped: false as const,
        version: hash,
        seq: eventSeq,
        item,
        op,
        existingHash,
        now,
        source: opts.source ?? 'sys-metadata-repo',
        message: opts.message,
        actor: opts.actor,
      };
    });

    if (result.skipped) {
      return { version: result.version, seq: result.seq, item: result.item };
    }

    // Broadcast AFTER commit. seqCounter tracks the durable event_seq
    // so watch() consumers and history() consumers see the same cursor.
    this.seqCounter = result.seq;
    // Drafts are explicitly NOT broadcast — the watch() stream models
    // the live overlay surface. A draft is a private staging buffer
    // until `promoteDraft()` records a `publish` event. Subscribers
    // (cache layers, HMR clients) should not react to drafts.
    if (state === 'active') {
      this.broadcast({
        seq: result.seq,
        op: result.op,
        ref: this.fullRef(ref),
        hash: result.version,
        parentHash: result.existingHash,
        actor: result.actor,
        message: result.message,
        ts: result.now,
        source: result.source,
      });
    }

    return { version: result.version, seq: result.seq, item: result.item };
  }

  async delete(
    ref: MetaRef,
    opts: DeleteOptions & { state?: OverlayState },
  ): Promise<DeleteResult> {
    this.assertOpen();
    this.assertAllowed(ref.type, opts.intent);

    const state: OverlayState = opts.state ?? 'active';
    const result = await this.withTxn(async (ctx) => {
      const existing = await this.engine.findOne('sys_metadata', {
        where: this.whereFor(ref, state),
        context: ctx,
      });
      if (!existing) {
        throw new ConflictError(this.fullRef(ref), opts.parentVersion, null);
      }
      const existingHash: string | null = existing.checksum ?? null;
      if (opts.parentVersion !== existingHash) {
        throw new ConflictError(this.fullRef(ref), opts.parentVersion, existingHash);
      }

      const existingId = (existing as { id?: string }).id;
      if (existingId === undefined) {
        throw new Error(
          `SysMetadataRepository.delete: existing row for ${ref.type}/${ref.name} has no id column`,
        );
      }

      const now = new Date().toISOString();
      // Draft deletions are a private buffer flush — they don't get a
      // history event (no audit value, and no parent for replay). Only
      // active-row deletes write a tombstone.
      let version = 0;
      let eventSeq = 0;
      if (state === 'active') {
        version = await this.nextItemVersion(ref, ctx);
        eventSeq = await this.nextEventSeq(ctx);
      }

      await this.engine.delete('sys_metadata', {
        where: { id: existingId },
        context: ctx,
      });

      if (state === 'active') {
        // Tombstone row — metadata/checksum are intentionally null.
        // Identity is preserved via (organization_id, type, name, version);
        // the parent row's id is not retained.
        await this.engine.insert(
          this.historyTable,
          {
            id: this.uuid(),
            event_seq: eventSeq,
            type: ref.type,
            name: ref.name,
            version,
            operation_type: 'delete',
            metadata: null,
            checksum: null,
            previous_checksum: existingHash,
            change_note: opts.message,
            source: opts.source ?? 'sys-metadata-repo',
            organization_id: this.organizationId,
            recorded_by: opts.actor,
            recorded_at: now,
          },
          { context: ctx },
        );
      }

      return {
        eventSeq,
        existingHash,
        now,
        source: opts.source ?? 'sys-metadata-repo',
        message: opts.message,
        actor: opts.actor,
      };
    });

    if (state === 'active') {
      this.seqCounter = result.eventSeq;
      this.broadcast({
        seq: result.eventSeq,
        op: 'delete',
        ref: this.fullRef(ref),
        hash: null,
        parentHash: result.existingHash,
        actor: result.actor,
        message: result.message,
        ts: result.now,
        source: result.source,
      });
    }

    return { seq: result.eventSeq };
  }

  /**
   * Promote the pending draft row for `ref` into the live (`active`)
   * overlay. Atomic: reads the draft inside the same transaction, runs
   * the canonical `put` to upsert the active row (which appends a
   * history event with `operation_type='publish'`), then deletes the
   * draft row.
   *
   * Errors if no draft exists (callers should 404). The active row's
   * `parentVersion` is computed from the current active hash so this
   * also surfaces optimistic-lock conflicts when something else has
   * published in between (e.g. another admin reverted to an older
   * version since the draft was authored).
   */
  async promoteDraft(
    ref: MetaRef,
    opts: { actor: string; source?: string; message?: string; intent?: MetadataWriteIntent },
  ): Promise<{ version: string; seq: number; item: MetadataItem }> {
    this.assertOpen();
    const draft = await this.get(ref, { state: 'draft' });
    if (!draft) {
      const err: any = new Error(
        `[no_draft] No pending draft exists for ${ref.type}/${ref.name} — nothing to publish.`,
      );
      err.code = 'no_draft';
      err.status = 404;
      throw err;
    }
    const currentActive = await this.get(ref, { state: 'active' });
    const result = await this.put(ref, draft.body, {
      parentVersion: currentActive?.hash ?? null,
      actor: opts.actor,
      source: opts.source ?? 'sys-metadata-repo.publish',
      message: opts.message ?? `publish draft (hash ${draft.hash})`,
      intent: opts.intent ?? 'override-artifact',
      state: 'active',
      opType: 'publish',
    });
    // Drop the draft row — it has been promoted. Tolerate races where
    // a second publisher already drained it.
    try {
      await this.delete(ref, {
        parentVersion: draft.hash,
        actor: opts.actor,
        source: opts.source ?? 'sys-metadata-repo.publish',
        intent: opts.intent ?? 'override-artifact',
        state: 'draft',
      });
    } catch {
      // best-effort: a concurrent publisher may have already drained
      // the draft; the active row's authoritative content is intact.
    }
    return result;
  }

  /**
   * Restore the body recorded in history at `targetVersion` (per-org
   * lineage counter) as the new active row. Writes a history event
   * with `operation_type='revert'` so the audit trail captures the
   * intent. Does NOT touch any draft row.
   *
   * Throws `[version_not_found]` (404) if the target version row is
   * missing or is a delete tombstone (no body to restore).
   */
  async restoreVersion(
    ref: MetaRef,
    targetVersion: number,
    opts: { actor: string; source?: string; message?: string; intent?: MetadataWriteIntent },
  ): Promise<{ version: string; seq: number; item: MetadataItem }> {
    this.assertOpen();
    const full = this.fullRef(ref);
    const row = await this.engine.findOne(this.historyTable, {
      where: {
        organization_id: this.organizationId,
        type: full.type,
        name: full.name,
        version: targetVersion,
      },
    });
    if (!row) {
      const err: any = new Error(
        `[version_not_found] No history row at version ${targetVersion} for ${ref.type}/${ref.name}.`,
      );
      err.code = 'version_not_found';
      err.status = 404;
      throw err;
    }
    const raw = (row as any).metadata;
    if (raw === null || raw === undefined) {
      const err: any = new Error(
        `[version_not_restorable] Version ${targetVersion} for ${ref.type}/${ref.name} is a delete tombstone — nothing to restore.`,
      );
      err.code = 'version_not_restorable';
      err.status = 409;
      throw err;
    }
    const body = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
    const currentActive = await this.get(ref, { state: 'active' });
    return this.put(ref, body, {
      parentVersion: currentActive?.hash ?? null,
      actor: opts.actor,
      source: opts.source ?? 'sys-metadata-repo.revert',
      message: opts.message ?? `revert to version ${targetVersion}`,
      intent: opts.intent ?? 'override-artifact',
      state: 'active',
      opType: 'revert',
    });
  }

  async *list(filter: ListFilter): AsyncIterable<MetadataItemHeader> {
    this.assertOpen();
    const where: Record<string, unknown> = {
      organization_id: this.organizationId,
      state: 'active',
    };
    if (filter.type) where.type = filter.type;
    const rows = await this.engine.find('sys_metadata', {
      where,
      limit: filter.limit,
    });
    for (const row of rows) {
      if (filter.nameContains && !String(row.name).includes(filter.nameContains)) continue;
      const item = this.rowToItem(
        { ...this.fullRef({ type: row.type, name: row.name } as MetaRef) },
        row,
      );
      // Strip body for the header projection.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { body, ...header } = item;
      yield header;
    }
  }

  /**
   * List pending DRAFT rows (ADR-0033) for this org, optionally narrowed by
   * `type` and/or `packageId`. Unlike {@link list} (which is hard-scoped to
   * `state='active'`), this reads `state='draft'` so the console can surface
   * what an AI authored but a human hasn't published yet. Returns a light
   * header projection (no body) suitable for a "pending changes" list.
   */
  async listDrafts(filter?: {
    type?: string;
    packageId?: string;
  }): Promise<
    Array<{
      type: string;
      name: string;
      packageId: string | null;
      updatedAt: string | null;
      updatedBy: string | null;
    }>
  > {
    this.assertOpen();
    const where: Record<string, unknown> = {
      organization_id: this.organizationId,
      state: 'draft',
    };
    if (filter?.type) where.type = filter.type;
    if (filter?.packageId) where.package_id = filter.packageId;
    const rows = await this.engine.find('sys_metadata', { where });
    return (rows as any[]).map((row) => ({
      type: row.type,
      name: row.name,
      packageId: row.package_id ?? null,
      updatedAt: row.updated_at ?? row.created_at ?? null,
      updatedBy: row.updated_by ?? row.created_by ?? null,
    }));
  }

  /**
   * Yield every history event for `(org, type?, name?)` from the
   * durable log, ordered by per-(type,name) `version` ascending. When
   * `filter.type`/`filter.name` are unset the consumer gets the full
   * org-scoped event stream — still ordered by version within each
   * (type,name) bucket, then by `recorded_at` across buckets (we sort
   * client-side because the test engine doesn't honor `orderBy`).
   */
  async *history(ref: MetaRef, opts?: HistoryOptions): AsyncIterable<MetadataEvent> {
    this.assertOpen();
    const full = this.fullRef(ref);
    const where: Record<string, unknown> = {
      organization_id: this.organizationId,
      type: full.type,
      name: full.name,
    };
    const rows = await this.engine.find(this.historyTable, { where });
    rows.sort((a: any, b: any) => {
      const va = typeof a.event_seq === 'number' ? a.event_seq : 0;
      const vb = typeof b.event_seq === 'number' ? b.event_seq : 0;
      return va - vb;
    });
    let yielded = 0;
    for (const row of rows) {
      if (opts?.sinceSeq !== undefined && (row.event_seq ?? 0) <= opts.sinceSeq) continue;
      if (opts?.limit !== undefined && yielded >= opts.limit) break;
      yielded++;
      yield {
        seq: (row.event_seq as number) ?? 0,
        op: (row.operation_type as MetadataEvent['op']) ?? 'update',
        ref: full,
        hash: (row.checksum as string | null) ?? null,
        parentHash: (row.previous_checksum as string | null) ?? null,
        version: typeof row.version === 'number' ? row.version : undefined,
        actor: (row.recorded_by as string | undefined) ?? 'unknown',
        message: (row.change_note as string | undefined) ?? undefined,
        ts: (row.recorded_at as string) ?? new Date(0).toISOString(),
        source: (row.source as string | undefined) ?? 'sys-metadata-repo',
      };
    }
  }

  /**
   * Live event stream. Fires for every successful put/delete on THIS
   * instance — cross-replica fan-out is M1. Manual AsyncIterator (not
   * an async generator) so we can deterministically tear down via
   * `iter.return()`, matching the pattern used by InMemoryRepository.
   */
  watch(filter: WatchFilter, since?: number): AsyncIterable<MetadataEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator]: () => {
        const queue: MetadataEvent[] = [];
        let pendingResolve: ((r: IteratorResult<MetadataEvent>) => void) | null = null;
        let stopped = false;

        const dispatch = (evt: MetadataEvent) => {
          if (stopped) return;
          if (!self.matchesFilter(evt, filter)) return;
          if (since !== undefined && evt.seq <= since) return;
          if (pendingResolve) {
            const r = pendingResolve;
            pendingResolve = null;
            r({ value: evt, done: false });
          } else {
            queue.push(evt);
          }
        };
        self.watchers.add(dispatch);

        return {
          next(): Promise<IteratorResult<MetadataEvent>> {
            if (stopped) return Promise.resolve({ value: undefined as any, done: true });
            const buffered = queue.shift();
            if (buffered) return Promise.resolve({ value: buffered, done: false });
            return new Promise((resolve) => {
              pendingResolve = resolve;
            });
          },
          return(): Promise<IteratorResult<MetadataEvent>> {
            stopped = true;
            self.watchers.delete(dispatch);
            if (pendingResolve) {
              const r = pendingResolve;
              pendingResolve = null;
              r({ value: undefined as any, done: true });
            }
            return Promise.resolve({ value: undefined as any, done: true });
          },
        };
      },
    };
  }

  /** Shut down all watch iterators. */
  close(): void {
    this.closed = true;
    // Drain watchers — each one's `return()` removes itself.
    const snapshot = Array.from(this.watchers);
    for (const w of snapshot) {
      try {
        w({
          seq: -1,
          op: 'delete',
          ref: { org: '', type: 'view', name: '_close' } as MetaRef,
          hash: null,
          parentHash: null,
          actor: 'system',
          ts: new Date().toISOString(),
          source: 'sys-metadata-repo-close',
        });
      } catch { /* noop */ }
    }
    this.watchers.clear();
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private assertOpen(): void {
    if (this.closed) throw new Error('SysMetadataRepository is closed');
  }

  /**
   * Defense-in-depth authorization gate.
   *
   * `intent` defaults to `'override-artifact'` (the historical strict
   * behavior). The protocol layer passes `'runtime-only'` after it has
   * verified — via the schema registry — that no artifact item exists
   * at `(type, name)`. In that case we accept types with
   * `allowRuntimeCreate: true`, even when `allowOrgOverride` is false.
   *
   * The env-var escape hatch (`OS_METADATA_WRITABLE`) still
   * applies to BOTH intents, so operators can opt into artifact
   * overrides at runtime for emergency fixes.
   */
  private assertAllowed(type: string, intent: MetadataWriteIntent = 'override-artifact'): void {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    const allowedByRegistry = OVERLAY_ALLOWED_TYPES.has(singular) || OVERLAY_ALLOWED_TYPES.has(type);
    if (allowedByRegistry) return;

    // Two-tier extension: runtime-only writes target a brand-new
    // (artifact-free) item, so they only need `allowRuntimeCreate`.
    // Two cases qualify:
    //   1. Type is statically registered with `allowRuntimeCreate: true`.
    //   2. Type has NO static registry entry — it was added at runtime
    //      by a plugin (e.g. `theme`, `api`, `connector`). The listing
    //      endpoint synthesises `allowRuntimeCreate: true` for these,
    //      so the write gate must accept them too. Otherwise the UI
    //      would advertise a writable type that 403s on save.
    if (intent === 'runtime-only') {
      if (RUNTIME_CREATE_ALLOWED_TYPES.has(singular) || RUNTIME_CREATE_ALLOWED_TYPES.has(type)) {
        return;
      }
      if (!STATIC_REGISTRY_TYPES.has(singular) && !STATIC_REGISTRY_TYPES.has(type)) {
        return;
      }
    }

    // Phase 3a-env-writable: env-var escape hatch.
    const env = envWritableMetadataTypes();
    if (env.has(singular) || env.has(type)) return;

    const allowed = [
      ...OVERLAY_ALLOWED_TYPES,
      ...envWritableMetadataTypes(),
    ];
    const code = intent === 'runtime-only' ? 'not_creatable' : 'not_overridable';
    const detail = intent === 'runtime-only'
      ? `'${type}' has neither allowOrgOverride nor allowRuntimeCreate in the registry. `
      : `'${type}' is not allowOrgOverride in the registry. `;
    const err: any = new Error(
      `[${code}] ${detail}` +
      `Overlay-allowed: ${Array.from(new Set(allowed)).join(', ') || '(none)'}. ` +
      `Set OS_METADATA_WRITABLE to enable additional types at runtime.`,
    );
    err.code = code;
    err.status = 403;
    throw err;
  }

  private whereFor(
    ref: Pick<MetaRef, 'type' | 'name'>,
    state: OverlayState = 'active',
    packageId?: string | null,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {
      type: ref.type,
      name: ref.name,
      organization_id: this.organizationId,
      state,
    };
    // ADR-0048 — when the caller scopes by package, the overlay row is keyed by
    // `(org, type, name, package_id)` so two installed packages shipping the
    // same name each get their OWN customization row (a package-less / global
    // overlay uses `package_id IS NULL`). When `packageId` is omitted (legacy
    // callers — delete/promote/restore), the package dimension is left out so
    // the query keeps its historical "match any package" behaviour.
    if (packageId !== undefined) where.package_id = packageId; // string → eq; null → IS NULL
    return where;
  }

  private fullRef(ref: Pick<MetaRef, 'type' | 'name'>): MetaRef {
    return {
      org: this.orgLabel,
      type: ref.type,
      name: ref.name,
    };
  }

  private rowToItem(ref: Pick<MetaRef, 'type' | 'name'>, row: any): MetadataItem {
    const body: Record<string, unknown> =
      typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {});
    const hash: string = row.checksum ?? hashSpec(body);
    return {
      ref: this.fullRef(ref),
      body,
      hash,
      parentHash: null,
      authoredBy: row.updated_by ?? row.created_by ?? 'unknown',
      authoredAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      message: undefined,
      seq: this.seqCounter,
    };
  }

  private broadcast(evt: MetadataEvent): void {
    for (const w of Array.from(this.watchers)) {
      try { w(evt); } catch { /* listener errors don't break the repo */ }
    }
  }

  private matchesFilter(evt: MetadataEvent, filter: WatchFilter): boolean {
    if (filter.type && evt.ref.type !== filter.type) return false;
    if (filter.name && evt.ref.name !== filter.name) return false;
    if (filter.org && evt.ref.org !== filter.org) return false;
    return true;
  }

  /**
   * Per-org monotonic event sequence. Reads `MAX(event_seq) + 1` from
   * `sys_metadata_history` scoped by `organization_id`. MUST be called
   * inside a transaction (the only caller is the put/delete txn body) —
   * concurrent writers in the same org race otherwise.
   */
  private async nextEventSeq(ctx: any): Promise<number> {
    try {
      const rows = await this.engine.find(this.historyTable, {
        where: { organization_id: this.organizationId },
        context: ctx,
      });
      let max = 0;
      for (const row of rows as Array<{ event_seq?: number | null }>) {
        const v = typeof row.event_seq === 'number' ? row.event_seq : 0;
        if (v > max) max = v;
      }
      return max + 1;
    } catch {
      // Table not provisioned yet (fresh DB) — start at 1.
      return 1;
    }
  }

  /**
   * Per-(org,type,name) lineage counter. Reads from history (not from
   * `sys_metadata.version`) so delete + recreate continues incrementing
   * instead of restarting at 1.
   */
  private async nextItemVersion(
    ref: Pick<MetaRef, 'type' | 'name'>,
    ctx: any,
  ): Promise<number> {
    try {
      const rows = await this.engine.find(this.historyTable, {
        where: {
          organization_id: this.organizationId,
          type: ref.type,
          name: ref.name,
        },
        context: ctx,
      });
      let max = 0;
      for (const row of rows as Array<{ version?: number | null }>) {
        const v = typeof row.version === 'number' ? row.version : 0;
        if (v > max) max = v;
      }
      return max + 1;
    } catch {
      return 1;
    }
  }

  /** Lightweight UUID-ish id for history rows; sufficient for an audit log. */
  private uuid(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
