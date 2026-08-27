// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ── Leg D of #11633: the `getMetaItems` overlay read cache (#11967) ─────────
 *
 * `getMetaItems` re-reads `sys_metadata` on every authenticated request. On the
 * hot path — `enforceApiAccess` → `loadObjectItems` → `getMetaItems({ type:
 * 'object' })`, once per REST request — that read costs **two** sequentially
 * awaited engine queries whenever the environment holds no overlay rows for the
 * type, because the empty first result triggers the alt-type retry. An app
 * whose objects are all code-authored pays both on every request forever. That
 * is the shape #11633 §1 calls out: *"most of leg D's win is negative caching"*.
 *
 * This module caches the OUTCOME OF THAT READ — the raw `sys_metadata` rows —
 * per `(engine, type, packageId, organizationId)`, and retires the entry the
 * moment the engine's write epoch moves.
 *
 * ## ⭐ Where this cache sits, and why that IS the resolution of the
 * ##    SchemaRegistry-hydration trap (#11633 §4 leg D)
 *
 * The design names a trap that a naive leg D walks into: `getMetaItems` is not
 * a pure read. Its overlay branch **registers overlay rows back into the
 * SchemaRegistry** (`hydrateOverlayIntoRegistry`, gated to unscoped kernels).
 * A cache that skips the read also skips that registration, and the symptom is
 * not a stale answer — it is a registry that quietly stops being populated.
 *
 * The design offers two ways out: cache the merged post-hydration result, or
 * keep hydration outside the cached path and prove it idempotent. This module
 * takes a third position that makes the trap **unreachable rather than
 * avoided**: the cached value sits **UPSTREAM of the hydration branch**, not
 * downstream of it.
 *
 * What is cached is the row set — the value the `queryByOrg` calls produce.
 * Everything the row set feeds still runs on every single call, hit or miss:
 * the overlay parse, the package-aware merge, `hydrateOverlayIntoRegistry`, the
 * MetadataService merge, the disabled-package filter, the nav contributions and
 * the decorations. A cache hit changes exactly one thing — where the rows came
 * from — and changes nothing about what is done with them. So hydration cannot
 * be skipped by a hit, and its idempotence never has to be proven, because it
 * is not being replayed: it runs once per call, exactly as it does today.
 *
 * ⛔ Do NOT "optimise" this by moving the cache below the merge. That is the
 * naive shape the trap describes, and it also silently breaks the three
 * mutable, non-`sys_metadata` sources the merged answer depends on — see next.
 *
 * ## ⭐ Why only the row set is cached, and never the merged answer
 *
 * Measured on the shipped ref: `getMetaItems`' answer is a function of FOUR
 * mutable sources, and the write epoch observes only ONE of them.
 *
 *   | source                                            | epoch sees it? |
 *   |---------------------------------------------------|----------------|
 *   | `sys_metadata` rows (`engine.find`)               | YES — every write goes through `SysMetadataRepository` → `engine.insert/update/delete` → the middleware seam |
 *   | SchemaRegistry (`listItems`, `isPackageDisabled`, `applyNavContributions`) | NO — in-memory registration, no engine operation |
 *   | MetadataService (`metadataService.list`)          | NO — loader-driven |
 *   | artifact protection (`lookupArtifactItem`)        | NO — in-memory |
 *
 * An epoch-keyed cache of the MERGED answer would therefore be serving three
 * sources whose changes nothing in its key can observe. Caching the row set
 * keeps the cache's reach exactly co-extensive with what its key can validate:
 * the one source the epoch does see. That containment is the whole argument for
 * this shape, and it is the property to protect when editing this file.
 *
 * ## Invalidation
 *
 *  1. **Primary — the engine write epoch** (#11968's substrate,
 *     `objectql/src/write-epoch.ts`). Read STRUCTURALLY, never by import:
 *     `@objectstack/metadata-protocol` does not depend on
 *     `@objectstack/objectql`, and the substrate declared `WriteEpochLike`
 *     separately for exactly this kind of consumer. Any `insert`/`update`/
 *     `delete` on ANY object advances it, so a `sys_metadata` publish retires
 *     this cache synchronously, in-process, before the next read.
 *  2. **TTL** — `OS_METADATA_OVERLAY_CACHE_TTL_MS`, default 30s, `0` = off.
 *     The residual bound, covering only what the epoch cannot see: a PEER
 *     node's write on a deployment with no `authz.invalidated` bridge attached.
 *     With that bridge, a peer's hint bumps the LOCAL epoch
 *     (`authz-invalidation-bridge.ts` calls `epoch.bump('remote')`), so
 *     cross-node convergence narrows for free.
 *
 * ⚠️ **`metadata.changed` is NOT a trigger here, and #11633 §4's expectation
 * that it would be does not survive measurement.** That channel is published by
 * `MetadataManager.notifyWatchers`, driven by loader/repository events. The
 * writer whose rows THIS cache holds is `SysMetadataRepository`, and
 * `metadata-protocol/src/protocol.ts` contains no `notifyWatchers`, `subscribe`
 * or `watchService` call at all — a `sys_metadata` overlay write emits no
 * `metadata.changed` event. Subscribing to it would have bought this cache
 * nothing and would have read, to the next maintainer, as a live invalidation
 * path that never fires. The cross-node story for leg D is the
 * `authz.invalidated` channel plus the TTL, which is the substrate's own
 * contract.
 *
 * ## ⭐ A success is cached ONLY when the engine exposes the write epoch
 *
 * The rule leg C (#11966) landed, and it transfers unchanged. A `ql` with no
 * seam is a `ql` whose writes this cache cannot see, so instead of degrading to
 * a TTL-only shape — publish-visibility as a timer, which #11633 §4 rules out
 * for this leg specifically — the cache declines. The whole surface is checked,
 * not just `current`: a bare `{ current: number }` on some unrelated double
 * would otherwise read as a live seam and licence caching against a counter
 * nothing ever bumps.
 *
 * Every existing test double takes the declining path and keeps its exact query
 * multiset; only a real engine caches.
 *
 * ## ⛔ Rows are cloned in BOTH directions, and that is correctness, not hygiene
 *
 * The overlay parse downstream reads `record.metadata` and, when it is already
 * an object rather than a JSON string, hands that very object on to a merge
 * chain that MUTATES it (`Object.assign(data, patch)`, `data._packageId = …`,
 * `data._draft = true`). So:
 *
 *   - **clone on store**, or this call's own merge corrupts the snapshot it
 *     just took;
 *   - **clone on serve**, or the first hit's merge corrupts the snapshot for
 *     every later hit.
 *
 * A fresh engine read hands back fresh rows, so cloning is what keeps a hit
 * byte-equivalent to a miss. A row set that cannot be cloned is not cached —
 * declining again rather than serving something aliased.
 */

/** The identity of one cached overlay read. */
export interface MetaOverlayCacheKey {
  /** Canonical metadata type — already folded by `canonicalizeMetaRequestType`. */
  type: string;
  packageId?: string;
  organizationId?: string;
}

/** One cached row set, with everything needed to decide it is still the answer. */
interface MetaOverlayCacheEntry {
  /** A private, already-cloned snapshot. Never handed out un-cloned. */
  records: unknown[];
  /** The engine write epoch this row set was read at. Compared, never interpreted. */
  epoch: number;
  /** Wall-clock expiry of the residual TTL bound. */
  expiresAt: number;
}

/**
 * One bucket per engine. Keyed on the ENGINE rather than on the protocol
 * instance because the engine is what owns BOTH halves of an entry's validity:
 * the `sys_metadata` table the rows came from, and the write epoch that says
 * when they stop being the answer. Two protocol instances over one engine read
 * one table and share one epoch, so sharing a bucket is correct; two engines
 * never share, which is what keeps two environments in one process from seeing
 * each other's rows.
 */
interface MetaOverlayCacheBucket {
  /**
   * The epoch every entry in {@link entries} was read at. The epoch is
   * process-wide and object-agnostic (any write to any object advances it), so
   * when it moves EVERY entry here is stale at once — Fork 1 → A's coarse
   * invalidation, applied to storage and not only to validity.
   *
   * ⚠️ The per-entry `epoch` comparison in {@link readMetaOverlayCache} remains
   * the VALIDITY rule and is not redundant with this. Entries are dropped in
   * {@link writeMetaOverlayCache}, which only runs on a miss, so between a write
   * and the next miss a stale entry is still present and it is the read-side
   * comparison — nothing else — that refuses to serve it.
   */
  epoch: number;
  entries: Map<string, MetaOverlayCacheEntry>;
}

const metaOverlayCache = new WeakMap<object, MetaOverlayCacheBucket>();

export const META_OVERLAY_CACHE_TTL_ENV = 'OS_METADATA_OVERLAY_CACHE_TTL_MS';
export const META_OVERLAY_CACHE_DEFAULT_TTL_MS = 30_000;

/**
 * Staleness bound for the overlay cache, in ms. `0` disables it — a real path
 * that restores the pre-#11967 query multiset exactly, not a degenerate TTL.
 *
 * Deployment config, never a settings row (#11633 §5).
 *
 * ⚠️ A malformed value resolves to `0` (off), the same arm leg C
 * (`localizationSuccessCacheTtlMs`) chose and for the same reason: the default
 * here is ON, so the two candidate readings of a typo are "off" and "30s", and
 * folding `3OOO` (letter O) into the default would hand the operator a LONGER
 * staleness window than the one they were trying to set. Off is the only arm
 * whose failure mode is a missed optimisation rather than an unasked-for
 * window.
 */
export function metaOverlayCacheTtlMs(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): number {
  const raw = env[META_OVERLAY_CACHE_TTL_ENV];
  if (raw === undefined || raw.trim() === '') return META_OVERLAY_CACHE_DEFAULT_TTL_MS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

/**
 * The engine's current write epoch, or `undefined` when this engine carries no
 * such seam. Mirrors `isWriteEpochLike` from `@objectstack/objectql` rather
 * than importing it — see the header for why that import is unavailable in this
 * direction.
 */
export function readWriteEpoch(engine: unknown): number | undefined {
  if (!engine || typeof engine !== 'object') return undefined;
  const epoch = (engine as { writeEpoch?: unknown }).writeEpoch;
  if (!epoch || typeof epoch !== 'object') return undefined;
  const seam = epoch as { current?: unknown; bump?: unknown; subscribe?: unknown };
  if (
    typeof seam.current !== 'number' ||
    typeof seam.bump !== 'function' ||
    typeof seam.subscribe !== 'function'
  ) {
    return undefined;
  }
  return seam.current;
}

/**
 * The cache key. `JSON.stringify` over the tuple rather than a delimiter join:
 * a package id or organization id containing the delimiter would otherwise let
 * two different reads collide on one key.
 */
function cacheKeyOf(key: MetaOverlayCacheKey): string {
  return JSON.stringify([key.type, key.packageId ?? null, key.organizationId ?? null]);
}

/**
 * Deep-clone a row set, or `undefined` when it cannot be cloned. See the
 * header: an un-cloned row set is an aliased one, and the merge chain
 * downstream mutates what it is handed.
 */
function cloneRecords(records: unknown[]): unknown[] | undefined {
  try {
    return structuredClone(records);
  } catch {
    return undefined;
  }
}

/**
 * A live cached row set for `key`, or `undefined` for a miss.
 *
 * `epoch` is the caller's PRE-READ epoch reading — see the call site for why it
 * must be taken before the read and not after.
 */
export function readMetaOverlayCache(
  engine: unknown,
  key: MetaOverlayCacheKey,
  epoch: number | undefined,
  ttlMs: number,
  now: number,
): unknown[] | undefined {
  if (epoch === undefined || ttlMs <= 0) return undefined;
  if (!engine || typeof engine !== 'object') return undefined;
  const entry = metaOverlayCache.get(engine as object)?.entries.get(cacheKeyOf(key));
  if (!entry) return undefined;
  if (entry.epoch !== epoch) return undefined;
  if (entry.expiresAt <= now) return undefined;
  return cloneRecords(entry.records);
}

/**
 * How many entries this engine's bucket currently holds. Diagnostics and pins
 * only — the eviction in {@link writeMetaOverlayCache} has no behavioural
 * signature (a stale entry is refused by the read-side epoch rule whether or
 * not it was evicted), so without an observation channel it would be an
 * unpinned optimisation, which is the kind that silently regresses.
 *
 * ⛔ Package-internal: this module is deliberately NOT re-exported from
 * `src/index.ts`, so nothing here is public surface.
 */
export function metaOverlayCacheEntryCount(engine: unknown): number {
  if (!engine || typeof engine !== 'object') return 0;
  return metaOverlayCache.get(engine as object)?.entries.size ?? 0;
}

/**
 * Remember `records` for `key`. A no-op when this engine exposes no write
 * epoch, when the TTL is off, or when the rows do not clone.
 *
 * ⭐ An EMPTY row set is cached, deliberately and as the main point: the empty
 * result is what triggers `getMetaItems`' alt-type retry, so "no overlay rows
 * for this type" is the answer whose caching removes both reads. #11633 §4
 * names this the bulk of leg D's saving, and the epoch — never the TTL — is
 * what keeps a newly published overlay promptly visible.
 */
export function writeMetaOverlayCache(
  engine: unknown,
  key: MetaOverlayCacheKey,
  epoch: number | undefined,
  records: unknown[],
  ttlMs: number,
  now: number,
): void {
  if (epoch === undefined || ttlMs <= 0) return;
  if (!engine || typeof engine !== 'object') return;
  const snapshot = cloneRecords(records);
  if (snapshot === undefined) return;
  let bucket = metaOverlayCache.get(engine as object);
  if (bucket === undefined) {
    bucket = { epoch, entries: new Map<string, MetaOverlayCacheEntry>() };
    metaOverlayCache.set(engine as object, bucket);
  } else if (bucket.epoch !== epoch) {
    // ⭐ Every entry read at an older epoch is already dead by the read-side
    // rule, so keeping it costs memory and buys nothing. Without this a
    // long-lived process accumulates one never-evicted entry per distinct
    // `(type, packageId, organizationId)` ever requested — bounded in principle
    // by the tenant count, which is not a bound worth shipping.
    bucket.entries.clear();
    bucket.epoch = epoch;
  }
  bucket.entries.set(cacheKeyOf(key), { records: snapshot, epoch, expiresAt: now + ttlMs });
}
