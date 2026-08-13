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
// #4867 — the SAME discriminator `DatabaseLoader` uses (#4825), imported, not
// re-implemented. A second hand-rolled "which driver errors are benign?" here
// would be two vocabularies for one question, which is the dual-source debt
// #4825 deliberately retired. See `@objectstack/metadata/errors` for why that
// leaf subpath exists.
import { isMissingTableError } from '@objectstack/metadata/errors';
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
import type { IObjectQLEngine } from '@objectstack/core';
// [#7682] The read-only-package predicate, imported rather than re-spelled —
// the same function `saveMetaItem`'s ADR-0070 D1 gate and the `/packages`
// lifecycle gate read, so a third read-only signal added there reaches this
// door too (that shared-rule argument is the module's whole reason to exist).
import { isWritablePackage } from './package-writability.js';

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
 * #4981 — the machine-readable half of "the publish landed, its cleanup did
 * not". Set on {@link SysMetadataRepository.promoteDraft}'s result ONLY when
 * the post-promotion drain failed for a reason that leaves a **stale** draft
 * row behind; absent means the overlay is in its intended state.
 *
 * Absent covers both good outcomes, which is why absence is safe to read as
 * "clean":
 *   - the draft row was dropped, or
 *   - the drain lost a race it is *supposed* to lose (a concurrent publisher
 *     already drained it, or a newer draft was saved while this publish was in
 *     flight — see {@link SysMetadataRepository.draftDrainVerdict}).
 *
 * Present means: the active row is correct and durable, and a `state='draft'`
 * row for the same `(org, type, name)` is still in `sys_metadata` holding the
 * body that was just published. Nothing retries it. Callers that surface
 * "has unpublished changes" (Studio / Setup) are about to be wrong, and the
 * next publish of this artifact promotes that same body again.
 */
export interface DraftDrainFailure {
  /** The artifact whose draft row could not be dropped. */
  ref: MetaRef;
  /** Checksum of the draft body the drain targeted — the row's `checksum`. */
  draftHash: string;
  /** The original failure, unchanged, so callers can classify it themselves. */
  cause: unknown;
}

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
   *
   * Typed off the `objectql` slot contract (ADR-0119 D1) rather than restated
   * by hand, so this stub surface cannot drift from `ObjectQL.transaction`.
   */
  transaction?: IObjectQLEngine['transaction'];
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
 * [#6960] Types whose LOADER merges an overlay row on top of the artifact at
 * read time — `supportsOverlay: true`. Derived from the same registry as the
 * two sets above (Prime Directive #8), and deliberately a different question
 * from {@link OVERLAY_ALLOWED_TYPES}: `supportsOverlay` is a capability of the
 * READ path, `allowOrgOverride` a permission on the WRITE path. Read only by
 * {@link SysMetadataRepository.assertDeleteAllowed}.
 */
const OVERLAY_CAPABLE_TYPES: ReadonlySet<string> = new Set(
  DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => e.supportsOverlay)
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
  const raw = readEnvWithDeprecation('OS_METADATA_WRITABLE', []) || '';
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

  /**
   * #4867 — once-only reporting for the history-counter read seam.
   *
   * The history table is readable or it is not; repeating the same paragraph
   * once per aborted write turns a real degradation into noise people learn to
   * skim, which is what made the #4420 `warn` unreadable in the first place.
   * Reset (with an `info`) on the next successful read, so an outage and its
   * recovery each say themselves exactly once. Suppressing the *message* never
   * suppresses the *failure*: every occurrence still throws.
   */
  private historyCounterFailureReported = false;

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
   *
   * **The body is VERBATIM — no ADR-0087 conversion (#3903 boundary).** This
   * repository is the version layer, and every caller wants the bytes that
   * were written, not today's canonical rendering of them:
   *   - `saveMetaItem` / `revertCommit` / `deleteMetaItem` read only `hash`
   *     (parent-version lineage and existence probes) — converting would
   *     change the body a hash was computed over and break the pairing;
   *   - `diffMeta` compares this body against `sys_metadata_history` bodies,
   *     which are verbatim by design. Converting one side only would render
   *     the conversion itself as a user-authored change in the diff.
   * Metadata that is *served to a consumer* is converted one layer up, at the
   * `ObjectStackProtocolImplementation` read seams. The lone exception worth
   * knowing: the seed body captured for `publishPackageDrafts` flows from here
   * into `applySeedBodies`, which IS a serving path — vacuous today because no
   * conversion targets the seed/dataset surface, but the seam to wire if one
   * ever lands.
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
      // #4556 — a null `recorded_by` means the write had no actor. Rendering
      // that as the string 'unknown' invents an identity the column never
      // held, which is the same declared-≠-actual defect on the read side.
      authoredBy: ((row as any).recorded_by as string | null | undefined) ?? null,
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
    // [#7682] The base the caller NAMED is part of the authorization question,
    // not just of the row key: `assertAllowed` reports the package door when
    // that base is read-only. `opts.packageId` (not the `targetPackageId`
    // resolution below) on purpose — `undefined` means "the caller named no
    // base", which is the ordinary env-local overlay and must keep the
    // type-door codes; `?? null` there is a ROW-KEY default, a different fact.
    this.assertAllowed(ref.type, opts.intent, opts.packageId);

    const state: OverlayState = opts.state ?? 'active';
    const body = (spec ?? {}) as Record<string, unknown>;
    const hash = hashSpec(body);

    // ADR-0048 — the ONE row this write targets. A write is not a search: it
    // upserts exactly one `(org, type, name, package_id)` row, so its scope is
    // always a concrete package or the unbound row — never `get`'s "any
    // package" match. That asymmetry with the sibling read at {@link get} is
    // deliberate, and it is why this value is named here rather than inlined:
    // `put` reads it TWICE (the optimistic-lock lookup below and the
    // `package_id` stamp), and #6215 was a caller — `restoreVersion` — whose
    // silence about the binding was resolved to `null` by this expression, so
    // the lock looked up a row that does not exist for every package-bound
    // overlay. Callers state their scope; this line no longer decides it
    // anywhere but for the documented `PutOptions.packageId` default
    // (omitted/undefined = the env-local, unbound row).
    const targetPackageId: string | null = opts.packageId ?? null;

    // Run all reads + writes inside one transaction so the optimistic
    // lock, the parent-row mutation, and the history append are atomic.
    const result = await this.withTxn(async (ctx) => {
      // ADR-0048 — scope the existing-row lookup to the requested package so a
      // save for package B does not find (and overwrite) package A's same-name
      // overlay. A package-less save (packageId null) targets the global row.
      const existing = await this.engine.findOne('sys_metadata', {
        where: this.whereFor(ref, state, targetPackageId),
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
        parentRowData.package_id = existingPkg ?? targetPackageId;
      } else {
        parentRowData.package_id = targetPackageId;
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
          // #4556 — `recorded_by` is a lookup('sys_user'). A write with no
          // actor stores NULL, never a sentinel string: an id that resolves
          // to no row is a foreign key that lies.
          recorded_by: opts.actor ?? null,
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
    // [#6960] The DELETE verb's own gate — see {@link assertDeleteAllowed}.
    // `put` keeps calling `assertAllowed` directly; the ruling moved removal
    // only.
    this.assertDeleteAllowed(ref.type, opts.intent);

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
            // #4556 — NULL, not a sentinel, when the delete had no actor.
            recorded_by: opts.actor ?? null,
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
   *
   * #4981 — the promotion is a `put` (durable, transactional) followed by a
   * drain `delete` of the draft row. The drain runs AFTER the put committed,
   * so its failure is reported, never thrown: see {@link draftDrainVerdict}
   * for why, and {@link DraftDrainFailure} for the signal it returns.
   */
  async promoteDraft(
    ref: MetaRef,
    opts: { actor: string | null; source?: string; message?: string; intent?: MetadataWriteIntent },
  ): Promise<{
    version: string;
    seq: number;
    item: MetadataItem;
    packageId: string | null;
    /** #4981 — set only when the draft row survived the promotion. */
    draftDrainFailed?: DraftDrainFailure;
  }> {
    this.assertOpen();
    // Read the RAW draft row (not just the body) so the promotion can carry
    // the draft's package binding onto the active row. ADR-0048 keys overlay
    // rows by `(org, type, name, package_id)`; promoteDraft historically
    // called put() WITHOUT a packageId, so the freshly-created active row
    // landed unbound (`package_id = NULL`). That silently broke every
    // package-scoped reader — most visibly the ADR-0045 publish visibility
    // flip (`getMetaItems({ type:'app', packageId })` → unhide), which then
    // never matched the just-published app and left AI-built apps `hidden`
    // (invisible in the app switcher / home) forever.
    const draftRow = await this.engine.findOne('sys_metadata', {
      where: this.whereFor(ref, 'draft'),
    });
    if (!draftRow) {
      const err: any = new Error(
        `[no_draft] No pending draft exists for ${ref.type}/${ref.name} — nothing to publish.`,
      );
      err.code = 'NO_DRAFT';
      err.status = 404;
      throw err;
    }
    const draftPackageId = (draftRow as { package_id?: string | null }).package_id ?? null;
    const draft = this.rowToItem(ref, draftRow);
    // Read the active row through the SAME package scope we will write, so the
    // optimistic-lock `parentVersion` matches the exact row `put` upserts.
    // (Package-less drafts → packageId null → identical to the prior behaviour.)
    const currentActive = await this.get(ref, { state: 'active', packageId: draftPackageId });
    const result = await this.put(ref, draft.body, {
      parentVersion: currentActive?.hash ?? null,
      actor: opts.actor,
      source: opts.source ?? 'sys-metadata-repo.publish',
      message: opts.message ?? `publish draft (hash ${draft.hash})`,
      intent: opts.intent ?? 'override-artifact',
      state: 'active',
      opType: 'publish',
      packageId: draftPackageId,
    });
    // Drop the draft row — it has been promoted.
    let draftDrainFailed: DraftDrainFailure | undefined;
    try {
      await this.dropPromotedDraftRow(ref, draft.hash, opts);
    } catch (error) {
      draftDrainFailed = this.draftDrainVerdict(error, ref, draft.hash);
    }
    // Surface the promoted draft's package binding so publish-time
    // materializers (ADR-0086 P2 — package-door permission sets) can stamp
    // the data-plane row with the owning `package_id`.
    return {
      ...result,
      packageId: draftPackageId,
      ...(draftDrainFailed ? { draftDrainFailed } : {}),
    };
  }

  /**
   * Restore the body recorded in history at `targetVersion` (per-org
   * lineage counter) as the new active row. Writes a history event
   * with `operation_type='revert'` so the audit trail captures the
   * intent. Does NOT touch any draft row.
   *
   * The restore stays on the row it found: the active row's ADR-0048
   * `package_id` is read here and threaded into {@link put}, so a row bound to
   * a Studio package is UPDATED in place rather than missed by a lookup
   * narrowed to `package_id IS NULL` (#6215).
   *
   * Throws `[version_not_found]` (404) if the target version row is
   * missing or is a delete tombstone (no body to restore).
   */
  async restoreVersion(
    ref: MetaRef,
    targetVersion: number,
    opts: { actor: string | null; source?: string; message?: string; intent?: MetadataWriteIntent },
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
      err.code = 'VERSION_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    const raw = (row as any).metadata;
    if (raw === null || raw === undefined) {
      const err: any = new Error(
        `[version_not_restorable] Version ${targetVersion} for ${ref.type}/${ref.name} is a delete tombstone — nothing to restore.`,
      );
      err.code = 'VERSION_NOT_RESTORABLE';
      err.status = 409;
      throw err;
    }
    const body = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
    // ADR-0048 / #6215 — read the RAW active row, not just its body, and carry
    // its `package_id` into the write. `put` upserts exactly ONE row and scopes
    // its optimistic-lock lookup by package; an unstated `packageId` resolves to
    // the unbound row (`package_id IS NULL`). This restore used to state
    // nothing while reading the parent hash package-agnostically, so for a row
    // bound to a Studio package (`app.myapp`, …) the two disagreed by
    // construction: the lock read `null`, the parent hash was the real one, and
    // `put` threw ConflictError. Both user-facing callers — `rollbackMetaItem`
    // and `revertCommit` — answered 409 "advanced during rollback" for every
    // package-bound overlay while nothing had advanced. Its second face was the
    // write: had the lock ever passed, `existing` was `null` and the restore
    // INSERTED a duplicate unbound row instead of updating the bound one.
    //
    // One read supplies both facts, exactly as {@link promoteDraft} does, so
    // the row the lock is taken on is by construction the row that is written.
    // A missing active row (deleted, or never published) yields `null` — the
    // unbound row, which is the only defined answer: `sys_metadata_history`
    // carries no `package_id` column, so a vanished binding is not recoverable.
    const activeRow = await this.engine.findOne('sys_metadata', {
      where: this.whereFor(ref, 'active'),
    });
    const activePackageId =
      (activeRow as { package_id?: string | null } | null)?.package_id ?? null;
    const currentActive = activeRow ? this.rowToItem(ref, activeRow) : null;
    return this.put(ref, body, {
      parentVersion: currentActive?.hash ?? null,
      actor: opts.actor,
      source: opts.source ?? 'sys-metadata-repo.revert',
      message: opts.message ?? `revert to version ${targetVersion}`,
      intent: opts.intent ?? 'override-artifact',
      state: 'active',
      opType: 'revert',
      packageId: activePackageId,
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
      /**
       * The scope the draft actually lives in — `null` for an env-wide draft,
       * a string for a per-org overlay draft. The `$or` below surfaces BOTH to
       * a non-null-org caller, so consumers that then act on a draft (promote /
       * discard) MUST route the write to THIS scope, not the caller's active
       * org, or they 404 on the env-wide row they can never match (#3115).
       */
      organizationId: string | null;
      packageId: string | null;
      updatedAt: string | null;
      updatedBy: string | null;
    }>
  > {
    this.assertOpen();
    const where: Record<string, unknown> = { state: 'draft' };
    // Surface BOTH org-scoped drafts and env-wide (`organization_id IS NULL`)
    // drafts. Env-wide drafts are real pending changes — `getMetaItems`/preview
    // overlays them and `publish-drafts` promotes them — but a strict
    // `organization_id = this.organizationId` equality silently dropped them
    // whenever the active org was non-null. AI-authored metadata is written
    // env-wide, so its drafts vanished from the pending-changes list and the
    // Publish CTA never appeared: the change showed in preview yet could not be
    // published from the UI (the "orphaned draft" bug).
    if (this.organizationId != null) {
      where.$or = [
        { organization_id: this.organizationId },
        { organization_id: null },
      ];
    } else {
      where.organization_id = null;
    }
    if (filter?.type) where.type = filter.type;
    if (filter?.packageId) where.package_id = filter.packageId;
    const rows = await this.engine.find('sys_metadata', { where });
    return (rows as any[]).map((row) => ({
      type: row.type,
      name: row.name,
      organizationId: row.organization_id ?? null,
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
        // #4556 — surface the absence, do not paper it over with a label.
        // An audit timeline that must show "who changed this" needs to know
        // the answer is "the platform", not a user literally named 'unknown'.
        actor: (row.recorded_by as string | null | undefined) ?? null,
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
          // #4556 — a synthetic drain event has no actor at all.
          actor: null,
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
   *
   * ## [#7682] The package door — which fact the refusal reports
   *
   * `packageId` is the base the CALLER named (`?package=` → `PutOptions.packageId`),
   * and until #7682 nothing on this path read it. Every refusal came out as
   * `NOT_OVERRIDABLE` / `NOT_CREATABLE` — a verdict about the metadata TYPE's
   * registry flags — so `PUT /api/v1/meta/object/showcase_task` answered
   * identically whether `?package=` pointed at a read-only package or a
   * writable one, and the two codes the ledger registers for the
   * package-writability condition (`ITEM_LOCKED`, `WRITABLE_PACKAGE_REQUIRED`,
   * both under `@objectstack/metadata-protocol`) were never emitted here at
   * all. Declared ≠ enforced.
   *
   * What this reads, and what it deliberately does NOT:
   *
   *  - **It changes no ALLOW decision.** Every allow limb above returns before
   *    this point, so a write that succeeds today still succeeds — including
   *    the ADR-0005 case that makes the naive "refuse writes into a read-only
   *    package" gate wrong: an org overlay of a code-shipped item *always*
   *    names the read-only package it customizes, and refusing that would
   *    close the whole overlay model. The env hatch (`OS_METADATA_WRITABLE`)
   *    returns two limbs above for the same reason — #7682's hatch-vs-Studio
   *    -badge half is a separate maintainer decision (#8146) and must not move
   *    as a side effect of this one. Pinned by the hatch case in
   *    `sys-metadata-repository.package-writability.test.ts`.
   *  - **It refuses nothing new.** This is the code-selection for writes that
   *    are ALREADY refused; the difference is which true fact the refusal
   *    reports. Making the package door an allow→deny gate here would extend
   *    ADR-0070 D1 (measured on `saveMetaItem` creates) to `promoteDraft` /
   *    `restoreVersion` / `revertCommit`, which route through {@link put} and
   *    carry the row's OWN binding — i.e. it would break republishing and
   *    repair of legacy package-bound rows, surfaces nobody measured.
   *  - **Which code, by intent.** The two ledgered codes are not
   *    interchangeable, and each is the one whose prescription is TRUE for its
   *    case:
   *      • `runtime-only` — no artifact backs this name, so the caller is
   *        authoring a NEW item into a read-only base. That is exactly
   *        ADR-0070 D1's condition, and `saveMetaItem` already emits
   *        `WRITABLE_PACKAGE_REQUIRED` / 422 for it; this is the same
   *        condition stated the same way at the ONE persistence route, for the
   *        callers that do not pass through that gate. One vocabulary, two
   *        enforcement points — the shape `package-writability.ts` exists for.
   *      • `override-artifact` — an artifact backs this name and it is
   *        provided by a package the deployment ships. "Pick a writable base"
   *        is FALSE here (the artifact would still be code-shipped), so the
   *        honest code is `ITEM_LOCKED`: the write is refused because its
   *        target is read-only, which is precisely what Studio's "Read-only"
   *        badge tells the user. ADR-0010 reserves `_lockSource: 'package'`
   *        for this layer; the error carries it so a consumer can tell a
   *        package-provenance lock from an item's own `_lock` (which is
   *        enforced separately, by `assertLockAllowsWrite` in the protocol,
   *        and still sets `lock`/`lockReason` — this one does not claim a
   *        `_lock` value the item never declared).
   *  - **An unnamed base is not "read-only".** `isWritablePackage(null)` is
   *    `false` by design (the authoring path treats "no base resolved" as a
   *    refusal), but a package-LESS write is the ordinary env-local overlay,
   *    not a write into a read-only package. So the door only opens when the
   *    caller actually named one; otherwise the type-door codes stand
   *    unchanged, which is what every existing caller and test sees.
   *  - **The DELETE half is untouched.** `DeleteOptions` carries no
   *    `packageId` and {@link assertDeleteAllowed} passes none, so removal
   *    keeps today's codes verbatim — #6960's ruling moved the delete side on
   *    purpose and warns against symmetrising either way.
   */
  private assertAllowed(
    type: string,
    intent: MetadataWriteIntent = 'override-artifact',
    packageId?: string | null,
  ): void {
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

    // [#7682] The package door. Only reached once every allow limb above has
    // declined, so it re-reports an existing refusal — see the TSDoc for why
    // it is a code selection and not a gate.
    const namedBase = typeof packageId === 'string' && packageId.length > 0;
    if (namedBase && !isWritablePackage(this.engine, packageId)) {
      throw intent === 'runtime-only'
        ? SysMetadataRepository.readOnlyBaseCreateError(type, packageId as string)
        : SysMetadataRepository.readOnlyBaseOverrideError(type, packageId as string);
    }

    const allowed = [
      ...OVERLAY_ALLOWED_TYPES,
      ...envWritableMetadataTypes(),
    ];
    const code = intent === 'runtime-only' ? 'NOT_CREATABLE' : 'NOT_OVERRIDABLE';
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

  /**
   * [#7682] `runtime-only` into a read-only base — the ADR-0070 D1 condition,
   * refused at the persistence route.
   *
   * Deliberately the SAME code, status and prescription as the
   * `saveMetaItem` emitter (`protocol.ts`, "D1 (ADR-0070)"): one condition,
   * one vocabulary, stated at both enforcement points rather than re-spelled
   * differently at each. The message stays user-actionable because here the
   * prescription is true — a writable base really is what this write needs.
   */
  private static readOnlyBaseCreateError(type: string, packageId: string): Error {
    const err: any = new Error(
      `[writable_package_required] Cannot create ${type} in package '${packageId}': `
      + `that package is read-only (provided by code or an installed app), so it is not a writable base. `
      + `Switch to a writable package in the package selector, or create a new one, and retry.`,
    );
    err.code = 'WRITABLE_PACKAGE_REQUIRED';
    err.status = 422;
    err.packageId = packageId;
    err.docs = 'docs/adr/0070-package-first-authoring.md';
    return err;
  }

  /**
   * [#7682] `override-artifact` against an item a read-only package provides.
   *
   * `ITEM_LOCKED` rather than `WRITABLE_PACKAGE_REQUIRED`: switching packages
   * cannot help — the artifact is code-shipped wherever the caller points —
   * so the refusal states the lock and prescribes the two things that DO move
   * it (edit the source and redeploy, or open the documented operator hatch).
   * `lockSource: 'package'` is ADR-0010's own reserved value for a lock the
   * PACKAGE layer asserts, which is what makes this distinguishable from the
   * item-level `_lock` refusal (`assertLockAllowsWrite`) that carries a `lock`
   * value read off the item. This one claims no `_lock`, because the item
   * declares none.
   */
  private static readOnlyBaseOverrideError(type: string, packageId: string): Error {
    const err: any = new Error(
      `[item_locked] Cannot overlay '${type}' in package '${packageId}': that package is read-only `
      + `(provided by code or an installed app) and the type has no per-org overlay channel `
      + `(allowOrgOverride=false), so this item is locked against runtime edits. `
      + `Edit the source artifact and redeploy, or set OS_METADATA_WRITABLE=${PLURAL_TO_SINGULAR[type] ?? type} `
      + `to grant a runtime escape hatch. See docs/adr/0010-metadata-protection-model.md.`,
    );
    err.code = 'ITEM_LOCKED';
    err.status = 403;
    err.lockSource = 'package';
    err.packageId = packageId;
    err.docs = 'docs/adr/0010-metadata-protection-model.md';
    return err;
  }

  /**
   * [#6960] The DELETE half of {@link assertAllowed}, and the only place the
   * two verbs diverge.
   *
   * ## Why the divergence exists
   *
   * `assertAllowed` refuses an `override-artifact` write on any type without
   * `allowOrgOverride`, and it is TOPOLOGY-INDEPENDENT — a control-plane
   * kernel (`environmentId === undefined`) skips the protocol's own two-tier
   * block entirely and lands here instead. That made it the second of the two
   * refusal points #6960 measured: on an environment carrying an overlay row
   * authored BEFORE #6483 / PR #6608 rolled `allowOrgOverride` back to
   * `false`, the row kept merging overlay-wins at read time while the ordinary
   * "Reset to package default" answered 403 — the removal reachable only
   * through `OS_METADATA_WRITABLE`. Maintainer ruling, 2026-08-10: the delete
   * side moves. Removing an overlay restores the code-declared state; it is
   * the narrowing direction and cannot widen anything.
   *
   * ## The boundary, which is the whole safety argument
   *
   * Keyed on `supportsOverlay` ({@link OVERLAY_CAPABLE_TYPES}), NOT on
   * `allowOrgOverride`:
   *
   *  - `supportsOverlay: true` — the loader merges the row, so a row under
   *    this name really is a customization sitting on top of a code-declared
   *    default, and subtracting it restores that default. This is the tier
   *    #6483 rolled back (`permission` / `position` / `page` / `app` /
   *    `dataset` / `book`).
   *  - `supportsOverlay: false` — `object` above all, whose overlay registers
   *    as its own contributor LAYER (ADR-0029 D9) rather than merging, and
   *    whose reset refusal is D9.6's declared, maintainer-approved cost. It
   *    does not reach this carve-out, and `protocol-object-overlay-layer.test.ts`
   *    pins that on both topologies — including the control-plane case, which
   *    is refused HERE and nowhere else.
   *
   * ## Two things this deliberately does NOT do
   *
   *  - It does not touch `put`. Create and update on such an item stay refused
   *    exactly as today; the asymmetry is the ruling, not an oversight, and
   *    "restoring symmetry" here re-opens the write door #6483 closed.
   *  - It does not widen `runtime-only`. That intent means "no artifact under
   *    this name", which the `allowRuntimeCreate` tier already governs — so
   *    the carve-out is scoped to the `override-artifact` intent, which is
   *    precisely the artifact-backed case the ruling names.
   */
  private assertDeleteAllowed(
    type: string,
    intent: MetadataWriteIntent = 'override-artifact',
  ): void {
    if (intent !== 'runtime-only') {
      const singular = PLURAL_TO_SINGULAR[type] ?? type;
      if (OVERLAY_CAPABLE_TYPES.has(singular) || OVERLAY_CAPABLE_TYPES.has(type)) return;
    }
    this.assertAllowed(type, intent);
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
    // overlay uses `package_id IS NULL`). When `packageId` is omitted, the
    // package dimension is left out so the query keeps its historical "match
    // any package" behaviour — which is what the RESOLVING reads want
    // (delete/promote/restore each locate the one row whatever it is bound to).
    // The writes never rely on it: they resolve the binding from the row that
    // read returned and state it (#6215).
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
      // #4556 — `updated_by` / `created_by` are lookup('sys_user') too;
      // absent means absent, not a user called 'unknown'.
      authoredBy: (row.updated_by as string | null | undefined) ?? (row.created_by as string | null | undefined) ?? null,
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
   *
   * #4867 (same shape as #4825 on the legacy `DatabaseLoader` path; rule from
   * #4632) — discriminate by error TYPE. This used to `catch { return 1 }`
   * under a comment that named only the benign reason and then answered every
   * reason with it. Exactly one reason licenses `1`: the history table has not
   * been provisioned, so there is no row to collide with. Every other reason —
   * dropped connection, timeout, insufficient privileges — means the rows are
   * still there and merely were not seen, and numbering from 1 against a table
   * with N rows **collides with existing rows** while the insert SUCCEEDS and
   * the log stays empty.
   *
   * Being inside a transaction does not save this. A transaction serialises
   * *concurrent* writers; it has no opinion about a number derived from a read
   * that failed, and a successfully committed transaction commits a wrong
   * `event_seq` just as durably as a non-transactional insert does. What the
   * transaction *does* give us is the clean remedy: throw, and the whole write
   * rolls back rather than committing an invented number.
   *
   * @throws The underlying driver error, unchanged, for every non-benign read
   *         failure — aborting the enclosing put/delete. Deliberate: a sequence
   *         number this method cannot derive from data it actually read is not
   *         a number it may invent.
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
      this.noteHistoryReadable();
      return max + 1;
    } catch (error) {
      return this.historyCounterVerdict(
        error,
        'event_seq',
        'the per-org history cursor that history ordering and rollback targeting both stand on',
      );
    }
  }

  /**
   * Per-(org,type,name) lineage counter. Reads from history (not from
   * `sys_metadata.version`) so delete + recreate continues incrementing
   * instead of restarting at 1.
   *
   * #4867 — which is exactly why the old `catch { return 1 }` was the worse of
   * the two: a read failure restored, precisely, the behaviour this method
   * exists to prevent. The lineage restarts at 1, collides with the existing
   * lineage rows, and `MetadataManager.rollback(type, name, version)` /
   * `POST /api/v1/meta/:type/:name/rollback` locate their snapshot BY this
   * number — so a rollback can land on a different record's same-numbered
   * version. Same discrimination, same rethrow; see {@link nextEventSeq}.
   *
   * @throws The underlying driver error for every non-benign read failure.
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
      this.noteHistoryReadable();
      return max + 1;
    } catch (error) {
      return this.historyCounterVerdict(
        error,
        'version',
        `the ${ref.type}/${ref.name} lineage counter that rollback resolves a snapshot by`,
      );
    }
  }

  /**
   * The shared `catch` verdict for both history-derived counters (#4867).
   *
   * @returns `1` — and ONLY — when the table genuinely does not exist yet:
   *          no rows, therefore nothing to collide with, therefore 1 really is
   *          the next number.
   * @throws The original error for every other read failure, after reporting
   *         the consequence once at `error` level (AGENTS.md "Degradation log
   *         levels": this is a durability/consistency degradation, not a
   *         functional one — the system keeps looking healthy while the bytes
   *         it persists are wrong).
   */
  private historyCounterVerdict(
    error: unknown,
    counter: 'event_seq' | 'version',
    subject: string,
  ): 1 {
    // Benign — and only benign: a fresh DB has no row to be inconsistent with.
    if (isMissingTableError(error)) return 1;

    if (!this.historyCounterFailureReported) {
      this.historyCounterFailureReported = true;
      console.error(
        `[SysMetadataRepository] Could not read \`${this.historyTable}\` to determine the next ` +
          `\`${counter}\` (${subject}) — the metadata write is being ABORTED and the enclosing ` +
          `transaction rolled back, so nothing is committed and the caller sees the failure. ` +
          `Before #4867 this path answered \`${counter} = 1\` instead: against a table that ` +
          `already has rows that number COLLIDES with an existing row, while the insert SUCCEEDS ` +
          `and not one line is logged — leaving version ordering untrustworthy and rollback ` +
          `targets ambiguous (a rollback can then resolve to a different record's same-numbered ` +
          `version). No retry and no restart repairs that; a failed write is the loud, ` +
          `recoverable alternative. Fix the datasource/driver error below (connection, timeout, ` +
          `privileges) and retry the write.`,
        error,
      );
    }
    throw error;
  }

  /**
   * Recovery half of the #4867 report: the counters are readable again, so the
   * next outage gets to speak. Says so once, and only if something was said.
   */
  private noteHistoryReadable(): void {
    if (!this.historyCounterFailureReported) return;
    this.historyCounterFailureReported = false;
    console.info(
      `[SysMetadataRepository] \`${this.historyTable}\` is readable again — \`event_seq\` / ` +
        `\`version\` numbering recovered and metadata writes are being recorded again. Writes ` +
        `rejected during the outage were not applied and must be re-submitted.`,
    );
  }

  /**
   * The post-promotion draft drain (#4981) — the `sys_metadata` write whose
   * failure leaves a promoted draft row behind.
   *
   * Extracted as a *named* callee for one reason beyond readability: the write
   * itself is `this.delete(...)`, and `delete` is far too common a method name
   * to put in `DURABILITY_CRITICAL_CALLEES`. Naming the seam is what lets
   * `scripts/check-durability-degradation-log-level.mjs` see it and keep this
   * catch from ever going quiet again — the same move #5001 made when the
   * guarded write was hidden inside a closure the AST scan could not enter.
   */
  private async dropPromotedDraftRow(
    ref: MetaRef,
    draftHash: string,
    opts: { actor: string | null; source?: string; intent?: MetadataWriteIntent },
  ): Promise<void> {
    await this.delete(ref, {
      parentVersion: draftHash,
      actor: opts.actor,
      source: opts.source ?? 'sys-metadata-repo.publish',
      intent: opts.intent ?? 'override-artifact',
      state: 'draft',
    });
  }

  /**
   * The verdict for a failed draft drain (#4981) — same shape as the
   * #4728 / #4825 / #4867 family: **one benign cause may not amnesty every
   * cause**. Before this, a bare `catch {}` named the concurrent-publisher
   * race in its comment and swallowed connection drops, timeouts, privilege
   * errors and driver faults with it.
   *
   * **Benign — silent, and only these.** Both arms are a `ConflictError` from
   * {@link delete}, which does its own row lookup before touching the driver,
   * so "the row is gone" is not a driver-dependent signal but a ConflictError
   * carrying `actualHead === null`:
   *
   *   - `actualHead === null` — a concurrent publisher already drained the
   *     draft. Exactly the race the old comment described: no row is left.
   *   - `actualHead !== draftHash` — a *newer* draft was saved while this
   *     publish was in flight. The row that survives is not stale, it is
   *     genuine pending work, and dropping it would have destroyed an admin's
   *     edit. "Has unpublished changes" is then *correct*, so reporting a
   *     consequence here would be a false alarm — and AGENTS.md is explicit
   *     that escalating a non-degradation to `error` is the mirror-image
   *     failure of hiding one.
   *
   * **Everything else — reported at `error`, and never thrown.** The drain
   * runs after the `put` committed. Throwing would (a) report a durably
   * successful publish as a failure and (b) invite the caller to retry — and a
   * retried publish is precisely the harmful path, because it promotes the
   * stale draft a second time. So the failure is surfaced two ways instead:
   * loudly in the log, and machine-readably as {@link DraftDrainFailure} on
   * the result. This is a durability/consistency degradation by the AGENTS.md
   * test — the system keeps looking healthy while something it claims to have
   * cleaned up is still there — so it is `error`, not `warn` (#4632).
   *
   * Unlike #4867's once-per-outage reporting, this speaks on **every**
   * occurrence: each one names a different orphaned artifact, and the remedy
   * is per-row. Deduplicating would hide which drafts are stale, which is the
   * one fact the reader needs.
   *
   * @returns `undefined` for the benign races; a {@link DraftDrainFailure} —
   *          after reporting it — for every other failure.
   */
  private draftDrainVerdict(
    error: unknown,
    ref: MetaRef,
    draftHash: string,
  ): DraftDrainFailure | undefined {
    if (error instanceof ConflictError) return undefined;

    const full = this.fullRef(ref);
    console.error(
      `[SysMetadataRepository] Published ${full.type}/${full.name} but could NOT drop its ` +
        `promoted draft row. The publish itself COMMITTED — the active row holds the published ` +
        `body and the history event was recorded — so this is reported, not thrown, and ` +
        `promoteDraft() still returns success. Consequence: the \`state='draft'\` row for ` +
        `${full.type}/${full.name} (org ${full.org}, checksum ${draftHash}) is STILL in ` +
        `\`sys_metadata\`, and nothing retries or repairs it — Studio/Setup will keep showing ` +
        `this artifact as having unpublished changes when it has none, and the NEXT publish of ` +
        `it promotes that same already-published body again (harmless while the active row is ` +
        `unchanged, but it overwrites the active row if anything has published or reverted it ` +
        `since). Remedy: fix the datasource/driver error below (connection, timeout, ` +
        `privileges), then re-publish ${full.type}/${full.name} — the drain runs again and ` +
        `succeeds — or delete the row directly from \`sys_metadata\` ` +
        `(type=${full.type}, name=${full.name}, state='draft').`,
      error,
    );
    return { ref: full, draftHash, cause: error };
  }

  /** Lightweight UUID-ish id for history rows; sufficient for an audit log. */
  private uuid(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
