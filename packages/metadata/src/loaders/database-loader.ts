// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Database Metadata Loader
 *
 * Loads and persists metadata via an IDataDriver instance, enabling
 * database-backed storage for platform and user scoped metadata.
 * Uses the `sys_metadata` table (configurable) following the
 * MetadataRecordSchema envelope defined in @objectstack/spec.
 */

import type {
  MetadataLoadOptions,
  MetadataLoadResult,
  MetadataStats,
  MetadataLoaderContract,
  MetadataSaveOptions,
  MetadataSaveResult,
  MetadataRecord,
  MetadataHistoryRecord,
} from '@objectstack/spec/system';
import { SysMetadataObject, SysMetadataHistoryObject, hashSpec, readLegacyOrganizationRows } from '@objectstack/metadata-core';
import { applyConversionsToStoredItem } from '@objectstack/spec';
import { lowerFilterCondition, type FilterLoweringOptions } from '@objectstack/spec/data';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { historySnapshotBody } from '../utils/history-snapshot-body.js';
import type { IDataDriver, IDataEngine, DriverQuery } from '@objectstack/spec/contracts';
import type { MetadataLoader, MetadataKeyedItem, MetadataLoaderDeleteOptions } from './loader-interface.js';
import {
  PACKAGE_SLOTTED_STORE_TYPES,
  isBundledStoreType,
  isPackageCaller,
  namedRowColumnOf,
  pluralEntryKeys,
  refuseSeveralSlots,
  refuseSlotNotHeld,
  slotPackageOf,
  STORED_MEMBER_MAX_LENGTH,
  storedItemPackageId,
  storedRowMemberOf,
  storeRemovalKeys,
  storeRowKey,
  storeRowWriteKey,
} from '../package-slotted-store.js';
import { LRUCache } from '../utils/lru-cache.js';
// [commit 6a180e42d] Both predicates moved to `@objectstack/types` — see its
// `driver-error-classification.ts` `## Home` section. The verdicts are
// byte-identical; only the import path changed.
import { isMissingTableError, isSchemaAlreadyExistsError } from '@objectstack/types';
import { migrateProjectIdToEnvironmentId } from '../migrations/migrate-project-id-to-environment-id.js';

/** [ADR-0131 D7] The tables whose physical `organization_id` can outlive their declaration. */
const LEGACY_FAMILY_TABLES: ReadonlySet<string> = new Set([
  'sys_metadata', 'sys_metadata_audit', 'sys_metadata_commit', 'sys_metadata_history',
]);

/**
 * Canonicalise a driver-materialised timestamp into the ISO-8601 string
 * `MetadataStats.mtime` is declared as.
 *
 * [#13997] `sys_metadata`'s `created_at` / `updated_at` are BUILTIN audit
 * columns, so no declared-field coercion reaches them; `SqlDriver#formatOutput`
 * repairs them through its own `AUDIT_TIMESTAMP_COLUMNS` pass, which used to
 * sit inside `if (this.isSqlite)` and so handed Postgres and MySQL rows out of
 * the record read door as a JS `Date`. #13973 ([ADR-0053 D-F1]) lifted that
 * pass out of the gate — it now runs on EVERY dialect, and the pin that once
 * recorded the asymmetry records the canonical-text contract instead
 * (`packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`
 * §B, inverted on purpose).
 *
 * `MetadataStatsSchema.mtime` is `z.string().datetime()`
 * (`packages/spec/src/system/metadata-persistence.zod.ts`), so a `Date` here
 * is a silent violation of a declared contract. This adapter stays because the
 * `Date` domain did not close: `driver-sql` still hands an INVALID `Date`
 * through unchanged ([ADR-0053 D-F3] — the one shape with no canonical text),
 * and non-SQL drivers materialise their own `Date`s. Under [ADR-0053 D-F1]'s
 * B1 ruling a producer-side arm like this became a NO-OP for the valid-`Date`
 * case, ⛔ never a conflict with it.
 *
 * ⚠️ The call in `stat()` looks redundant against `MetadataRecord`'s static
 * type. Since #16422 it very nearly IS: `rowToRecord` reaches `createdAt` /
 * `updatedAt` through this same helper, so `stat()` sees the declared
 * `string | undefined` as a measurement rather than the unchecked
 * `row.created_at as string | undefined` cast that used to stand there. It is
 * kept because `stat()` is reachable from `rowToRecord`'s output AND is the
 * boundary that publishes `mtime`, and because idempotence is what makes the
 * second application free — ⛔ do not "simplify" it away on the strength of
 * the static type alone, which is what made the old cast invisible.
 *
 * ⛔ NOT a tolerant fallback: it converts the one per-dialect materialisation
 * the driver genuinely produces into the single declared spelling, at the
 * producer — the same shape the sibling adapters in
 * `@objectstack/metadata-protocol` apply. Absent column -> `undefined`, so the
 * caller's existing `?? <default>` chain keeps its current meaning.
 *
 * ## [#14078] The `Date` arm is TOTAL — an Invalid `Date` yields `undefined`
 *
 * Ruled **B** by the maintainer (2026-09-02): every copy of this spelling
 * guards on `Number.isNaN(value.getTime())`, all five arms in ONE change,
 * because a guard on some arms and not others re-opens the drift the single
 * spelling closed.
 *
 * Reachability is MEASURED, not assumed (commit `3ecb7dc1a`): mysql2
 * 3.23.1 returns a module constant literally named `INVALID_DATE` for a zero
 * `DATETIME`, and postgres-date 1.0.7 builds `new Date(NaN)` for every year in
 * 275760..294276 — years Postgres itself stores. Unguarded,
 * `value.toISOString()` raises `RangeError: Invalid time value`, so a read
 * endpoint answers **500** on a row the operator cannot identify from the
 * error; the spelling this replaced (`String(value)`) served the visible text
 * `"Invalid Date"` instead.
 *
 * The terminal value is chosen **per call site**. `stat` ends in
 * `?? new Date().toISOString()`, the branch an absent column takes today. The
 * ruling assigns `undefined` exactly where "the field is optional and the
 * caller already carries a `?? default` chain". ⛔ NOT the visible text
 * `"Invalid Date"` — the fields fed from here are read by machines
 * (`MetadataStats.mtime` is declared `z.string().datetime().optional()` in
 * `packages/spec`), so that text would move the failure to a zod refusal at
 * the consumer instead of removing it. ⛔ And NOT a blanket `''`: a silent blank is the shape that
 * hides the producer's bug.
 *
 * ## [#16422] Four more call sites — the collapse, and what it was not
 *
 * #14037's per-site `isoFromValidDate` stood beside this helper until #16422.
 * It rewrote a single shape (valid `Date` -> ISO) and handed every other input
 * back UNTOUCHED, so the four adapter boundaries fed a `Date`, a `null`, a
 * `number` and an opaque column straight into fields declared
 * `z.string().datetime()`. Measured across seven inputs, `MetadataRecordSchema`
 * refused four and `MetadataHistoryRecordSchema` five.
 *
 * ⛔ The collapse was NOT the mechanical swap the retired docblocks implied.
 * The two helpers were never interchangeable — #14078 aligned them on the
 * Invalid-`Date` shape ALONE — so it moved every site for `null`, for a
 * `number` and for an opaque column, and each needed its own terminal value:
 * `undefined` for the two `.optional()` fields on `MetadataRecord`, the epoch
 * for the REQUIRED `MetadataHistoryRecord.recordedAt` ({@link
 * recordedAtFallback}). `listCommits` in `@objectstack/metadata-protocol`
 * keeps a copy of the retired spelling on purpose: it promises its callers the
 * RAW value back, a contract this domain rewrite would reverse.
 *
 * ⚠️ One composed behaviour moved with it, deliberately: `stat()` computes
 * `record.updatedAt ?? record.createdAt`, and an Invalid `updated_at` is now
 * `undefined` by the time that `??` runs instead of a truthy `Date`. So a row
 * with an unreadable `updated_at` and a good `created_at` publishes
 * `created_at` as its `mtime` where it used to publish `new Date()` — a stored
 * instant in place of a fabricated one, and exactly the "same chain an absent
 * column takes" that #14078's own ruling text prescribes for the shape.
 */
function canonicalIsoInstant(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  // [#14078] Total `Date` arm: an Invalid `Date` is the ONE `Date` shape
  // `toISOString()` refuses, and it is reachable from two live drivers. It
  // leaves as `undefined` so the caller's `?? <default>` chain — the same one
  // an absent column takes — keeps exactly its current meaning.
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value === 'string') return value;
  return String(value);
}

/**
 * The caller-side terminal value for `MetadataHistoryRecord.recordedAt` when
 * the stored column canonicalises to nothing.
 *
 * [#16422] `recordedAt` is a REQUIRED `z.string().datetime()`
 * (`packages/spec/src/system/metadata-persistence.zod.ts`), which is what made
 * it the one site in this family with no ruled-valid answer: the visible text
 * `"Invalid Date"` fails the refinement, `undefined` fails the required field,
 * and the pass-through this card retired fed it the `Date` object, which fails
 * both. A caller-side default is the third answer, and this is it.
 *
 * ⛔ NOT `new Date()`. A history row records WHEN a version was recorded; a
 * `now` stamp is a plausible-looking fact nobody measured, it sorts a version
 * recorded years ago to the top of a newest-first timeline, and it is
 * indistinguishable at every reader from a real recording instant. The epoch
 * is inert on both counts — it sorts to the oldest end and no reader can
 * mistake `1970-01-01T00:00:00.000Z` for a measurement.
 *
 * It is also the answer the sibling reader of this same
 * `sys_metadata_history.recorded_at` column already gives: `rowToEvent` and
 * `history()` in `@objectstack/metadata-protocol`'s `sys-metadata-repository.ts`
 * both end in `?? new Date(0).toISOString()`.
 *
 * A function rather than a module constant so the two history doors share ONE
 * spelling that a grep finds, and so no caller can mutate a shared `Date`.
 */
function recordedAtFallback(): string {
  return new Date(0).toISOString();
}

/**
 * [ADR-0053 D-D1 items 5 and 7, as amended — #20822] The declared-type reader
 * `queryHistory` lowers its driver-mode filter with: a column is `datetime`
 * exactly when the history object this loader syncs
 * ({@link DatabaseLoader.ensureHistorySchema}, `SysMetadataHistoryObject`)
 * declares it `type: 'datetime'` — the test the engine seam and `SqlDriver`
 * apply, so `recorded_at` takes the whole-day bound and every other column
 * lowers byte-identical.
 */
const HISTORY_FILTER_LOWERING: FilterLoweringOptions = {
  isDatetimeColumn: (column) => {
    const fields = SysMetadataHistoryObject.fields as Record<string, { type?: unknown } | undefined>;
    return Object.prototype.hasOwnProperty.call(fields, column) && fields[column]?.type === 'datetime';
  },
};

/**
 * Cache configuration for `DatabaseLoader`.
 *
 * The cache sits in front of `load()`, `loadMany()`, `exists()`, `stat()`,
 * and `list()` so that hot read paths (REST `/meta/*`, ObjectQL plan
 * resolution, runtime overlay merges) do not hit the database on every
 * request. All write paths (`save`, `delete`, `registerRollback`) invalidate
 * the relevant entries.
 *
 * Defaults are conservative: 500 entries, 60s TTL — chosen so that single-
 * tenant Studio usage does not burn memory and so that an external write
 * (out-of-band SQL update) becomes visible within a minute even without
 * realtime invalidation.
 */
export interface DatabaseLoaderCacheOptions {
  /** Whether the cache is active. Default: `true`. */
  enabled?: boolean;
  /** Max number of cached `(type, name)` entries. Default: `500`. */
  maxSize?: number;
  /**
   * TTL in milliseconds. Set to `0` to disable expiry. Default: `60_000`.
   *
   * Renamed from `ttl` (#14478) in lockstep with the spec key it mirrors,
   * `MetadataManagerConfig.cache.databaseLoader.ttlMs`: the unit now lives in
   * the name, not only in this comment.
   */
  ttlMs?: number;
}

/**
 * Configuration for the DatabaseLoader.
 *
 * Accepts either a raw `IDataDriver` or an `IDataEngine` (ObjectQL).
 * When `engine` is provided, all CRUD operations route through the engine
 * which handles datasource mapping automatically — no manual driver
 * resolution needed. Schema sync is also skipped (the engine handles it).
 */
/**
 * [ADR-0150 D3/D4, #32351] Which package's history a history read or a
 * rollback of a type stored per `(package, name)` addresses
 * (`PACKAGE_SLOTTED_STORE_TYPES`). Ignored for every other type.
 */
export interface MetadataHistoryAddress {
  /**
   * The package whose versions are read, or whose row a rollback writes.
   * `null` addresses the environment: the name's package-less row and the
   * versions recorded of it (never a version attributed to none, F1). `''` and the `sys_metadata` sentinel
   * name no package either, so they address the environment too (the store's
   * own rule, `isPackageCaller`). Absent: no address.
   */
  packageId?: string | null;
}

/**
 * [#32351] The package a history address names: the package, `null` for the
 * environment (`null`, `''` or the `sys_metadata` sentinel — the store's
 * `isPackageCaller` rule, the same one `storeRowKey` keys rows by), or
 * `undefined` when no address is given.
 */
function addressedPackage(address?: MetadataHistoryAddress): string | null | undefined {
  if (address?.packageId === undefined) return undefined;
  return isPackageCaller(address.packageId) ? address.packageId : null;
}

/**
 * [#32351 F1, ruling A as amended 6818953020] The history `package_id` of a
 * snapshot of the environment's (package-less) row of a by-package type: the
 * explicit `sys_metadata` sentinel. NULL in that column means "not
 * attributed" (a row written before the column, or one `SysMetadataRepository`
 * wrote), never the environment.
 */
const ENVIRONMENT_HISTORY_MARK = 'sys_metadata';

/**
 * [#32351] The `package_id` a by-package type's snapshot of `slot`'s row is
 * recorded with: the slot's package, or {@link ENVIRONMENT_HISTORY_MARK} for
 * the package-less row. `undefined` (the column left NULL) for every other
 * type, which has no slot.
 */
function historySnapshotPackage(slot: { packageId?: string } | undefined): string | undefined {
  return slot ? (slot.packageId ?? ENVIRONMENT_HISTORY_MARK) : undefined;
}

/**
 * [#32351 F1] Whose version a history row records: a package (the
 * `package_id` column, else, for a row written before it, the package its
 * stored body names — {@link storedRowPackageId}), `null` for the
 * environment (the column holds {@link ENVIRONMENT_HISTORY_MARK}), or
 * `undefined` when it is attributed to none. An addressed read never answers
 * an unattributed version, and a rollback lands one only on a name a single
 * row slot holds.
 */
function historyRowAttribution(row: Record<string, unknown>): string | null | undefined {
  if (row.package_id === ENVIRONMENT_HISTORY_MARK) return null;
  return storedRowPackageId(row);
}

/** [#32351] A version's owner in a sentence: `package "p"`, or the environment. */
function ownerPhrase(owner: string | null): string {
  return owner === null ? 'the environment' : `package "${owner}"`;
}

export interface DatabaseLoaderOptions {
  /** The IDataDriver instance to use for database operations */
  driver?: IDataDriver;

  /** The IDataEngine (ObjectQL) instance — preferred over raw driver */
  engine?: IDataEngine;

  /** The table name to store metadata records (default: 'sys_metadata') */
  tableName?: string;

  /** The table name to store history records (default: 'sys_metadata_history') */
  historyTableName?: string;

  /**
   * @deprecated since ADR-0131 D6/D7 (the `sys_metadata` family declares no
   * organization column). Every row is the environment's, so this option is
   * accepted for back-compat but ignored — writes do not set
   * `organization_id` and filters do not constrain on it.
   */
  organizationId?: string;

  /**
   * @deprecated since ADR-0008 §0 amendment (branch/project removal).
   * The metadata layer is keyed by organization only. This option is
   * accepted for back-compat but ignored — writes do not set
   * `environment_id` and filters do not constrain on it. Will be removed
   * in the next major release.
   */
  environmentId?: string;

  /** Enable history tracking (default: true) */
  trackHistory?: boolean;

  /**
   * Read-through cache configuration. Pass `{ enabled: false }` to disable
   * caching outright (useful in tests or when the caller wants the loader to
   * always read fresh from the database).
   */
  cache?: DatabaseLoaderCacheOptions;
}

/**
 * DatabaseLoader — Datasource-backed metadata persistence.
 *
 * Implements the MetadataLoader interface to provide database read/write
 * for metadata records. Uses the MetadataRecordSchema envelope to persist
 * metadata with scope, versioning, and audit fields.
 *
 * [ADR-0150 D3/D4, #32246] A type stored per `(package, name)`
 * (`PACKAGE_SLOTTED_STORE_TYPES`) keeps one row per `(package, name)`, with
 * `package_id` filled, by the in-memory store's own rules
 * (`package-slotted-store.ts`): a save fills the slot `storeRowWriteKey`
 * picks, a delete takes the slots `storeRemovalKeys` picks, and `loadSlots` /
 * `loadManySlots` answer every row with its package. A row's package is its
 * `package_id` column, else the package its stored body names (a row written
 * before this loader filled the column: its next save binds it, and so does
 * `migrateDatabaseLoaderRowPackages`). Versions of such a type are numbered
 * per name across its packages' rows, so their `sys_metadata_history` rows —
 * unique on `(type, name, version)` — never collide, and the row of a name
 * saved last is its highest version: `load`, `loadMany` and `loadManyKeyed`
 * answer that one, one item per name, as they did. Every other type keeps one
 * row per `(type, name)`, as before.
 *
 * [#31699 R3-B, epic ruling 6796068023] A bundled type (`email_template`) holds
 * several members under one `(package, name)`, a row each: `loadMany` and
 * `loadManyKeyed` keep one row per `(package, name, member)` — every member of
 * every slot, as `main` answered every row — and a rollback by name of a name
 * with one row slot restores the row of the member its body declares.
 *
 * [#32540, ADR-0150 D4/D6] `bundle_member` is a row's identity discriminator
 * beside `(type, name, package_id)`, read per type by the type's own table and
 * never guessed from a body field (`storedRowMemberOf`): `email_template`'s
 * locale (`ITEM_KEY_DISCRIMINATORS`), and an action's bound object (the
 * owner-keyed types). NULL is the type's row without one — the canonical
 * locale, the object-less action. So one package's action name bound to
 * several objects keeps a row per object: `list` serves every binding, while
 * `load` / `loadMany` / `loadManyKeyed` still answer one per name. A row written
 * before its object was named reads it off its body, and is named (its column
 * only) before any write of its slot, so the object-less binding's row never
 * collides with it on the unique key.
 */
export class DatabaseLoader implements MetadataLoader {
  readonly contract: MetadataLoaderContract = {
    name: 'database',
    protocol: 'datasource:',
    capabilities: {
      read: true,
      write: true,
      watch: false,
      list: true,
    },
  };

  private driver?: IDataDriver;
  private engine?: IDataEngine;
  private tableName: string;
  private historyTableName: string;
  private trackHistory: boolean;
  private schemaReady = false;
  private historySchemaReady = false;
  /**
   * Whether the loud "DDL failed" report has already been printed for the
   * metadata table / history table respectively. AGENTS.md → "Degradation log
   * levels": say it **once**, at the first degradation, not once per retry.
   */
  private schemaFailureReported = false;
  private historySchemaFailureReported = false;
  /**
   * Same once-only discipline for the #4825 seam: the history table is readable
   * or it is not, and repeating the report per skipped write turns a real
   * degradation into noise people learn to skim.
   */
  private historySeqFailureReported = false;

  /** (type, name) → metadata payload — primes `load()` */
  private readonly loadCache?: LRUCache<string, Record<string, unknown> | null>;
  /** type → array of payloads — primes `loadMany()` */
  private readonly loadManyCache?: LRUCache<string, unknown[]>;
  /** type → list of names — primes `list()` */
  private readonly listCache?: LRUCache<string, string[]>;
  /** (type, name) → MetadataStats — primes `stat()` */
  private readonly statCache?: LRUCache<string, MetadataStats | null>;
  /** [#31699 R7-A] Each body a plural read handed out from a legacy row, with that row's id and package ({@link bindReadRowPackage}). */
  private readonly legacyReadRows = new WeakMap<object, { id: string; packageId: string }>();

  constructor(options: DatabaseLoaderOptions) {
    if (!options.driver && !options.engine) {
      throw new Error('DatabaseLoader requires either a driver or engine');
    }
    this.driver = options.driver;
    this.engine = options.engine;
    this.tableName = options.tableName ?? 'sys_metadata';
    this.historyTableName = options.historyTableName ?? 'sys_metadata_history';
    // ADR-0131 D6/D7: `organizationId` is accepted for back-compat but ignored.
    void options.organizationId;
    // ADR-0008 §0: `environmentId` option is accepted for back-compat but ignored.
    void options.environmentId;
    this.trackHistory = options.trackHistory !== false; // Default to true

    // Wire cache. Default: enabled with 500 entries / 60s TTL.
    const cacheOpts = options.cache;
    const cacheEnabled = cacheOpts?.enabled !== false;
    if (cacheEnabled) {
      const lruOpts = {
        maxSize: cacheOpts?.maxSize ?? 500,
        ttl: cacheOpts?.ttlMs ?? 60_000,
      };
      this.loadCache = new LRUCache(lruOpts);
      this.loadManyCache = new LRUCache(lruOpts);
      this.listCache = new LRUCache(lruOpts);
      this.statCache = new LRUCache(lruOpts);
    }
  }

  // ==========================================
  // Cache helpers
  // ==========================================

  private cacheKey(type: string, name: string): string {
    return `${type}::${name}`;
  }

  /**
   * Invalidate all cached entries for a specific (type, name) pair plus
   * the type-level aggregates (`loadMany`, `list`). Called from every write
   * path (`save`, `delete`, `registerRollback`).
   */
  private invalidate(type: string, name: string): void {
    if (!this.loadCache) return;
    const key = this.cacheKey(type, name);
    this.loadCache.delete(key);
    this.statCache?.delete(key);
    this.loadManyCache?.delete(type);
    this.listCache?.delete(type);
  }

  /** Drop the entire cache — useful after bulk imports or schema changes. */
  invalidateAll(): void {
    this.loadCache?.clear();
    this.loadManyCache?.clear();
    this.listCache?.clear();
    this.statCache?.clear();
  }

  /** Diagnostic: aggregated cache statistics for `metrics` endpoints. */
  getCacheStats(): {
    enabled: boolean;
    load: ReturnType<LRUCache<string, unknown>['stats']> | null;
    loadMany: ReturnType<LRUCache<string, unknown>['stats']> | null;
    list: ReturnType<LRUCache<string, unknown>['stats']> | null;
    stat: ReturnType<LRUCache<string, unknown>['stats']> | null;
  } {
    return {
      enabled: this.loadCache !== undefined,
      load: this.loadCache?.stats() ?? null,
      loadMany: this.loadManyCache?.stats() ?? null,
      list: this.listCache?.stats() ?? null,
      stat: this.statCache?.stats() ?? null,
    };
  }

  // ==========================================
  // Internal CRUD helpers (driver vs engine)
  // ==========================================

  // NOTE (#6231, closed out by #7178): BOTH branches below now take `query`
  // unchanged and uncast. `DriverQuery` is `Omit<QueryAST, 'object'>`, so the
  // object name travels as argument one only — that was always enough for the
  // driver branch. The ENGINE branch used to carry `as any`, for one reason:
  // `EngineQueryOptionsSchema.search` admitted only the structured
  // `FullTextSearchSchema`, while `QueryAST.search` (hence `DriverQuery`) also
  // admits the bare query string that ADR-0061 D1 calls the canonical Tier-1
  // spelling and that the engine actually serves, so `DriverQuery` was not
  // assignable to `EngineQueryOptionsParsed`. #7178 aligned the two schemas;
  // the casts are now genuinely vestigial and are gone, which restores real
  // `where`/`orderBy`/`fields` checking on the metadata main read path — this
  // schema is not `.strict()`, so an unknown key here is SILENTLY DROPPED
  // (`check:query-options-erasure`'s own rationale) and the erased type was
  // the only thing standing between a typo and that silence.
  //
  // If a future edit makes one of these stop compiling, the honest fix is to
  // reconcile the two schemas again — not to reinstate the cast.

  private async _find(table: string, query: DriverQuery): Promise<Record<string, unknown>[]> {
    const rows = this.engine ? await this.engine.find(table, query) : await this.driver!.find(table, query);
    return this.withoutLegacyOrganizationRows(table, rows);
  }

  private async _findOne(table: string, query: DriverQuery): Promise<Record<string, unknown> | null> {
    const row = this.engine ? await this.engine.findOne(table, query) : await this.driver!.findOne(table, query);
    if (!row) return row ?? null;
    const legacy = await this.legacyOrganizationRows(table);
    if (!legacy.has(String(row.id))) return row;
    return (await this._find(table, query))[0] ?? null;
  }

  /**
   * [ADR-0131 D6/D7] The family's rows without a legacy organization's. The
   * family declares no organization column; on a database the
   * organization-ownership ceremony has not migrated, the physical column
   * still holds each legacy organization's rows, and a loader wired to the raw
   * driver would read them as the environment's. Told apart off that column
   * ({@link readLegacyOrganizationRows}); a read that cannot answer throws.
   */
  private async withoutLegacyOrganizationRows(
    table: string,
    rows: Record<string, unknown>[] | null | undefined,
  ): Promise<Record<string, unknown>[]> {
    if (!rows || rows.length === 0) return rows ?? [];
    const legacy = await this.legacyOrganizationRows(table);
    return legacy.size === 0 ? rows : rows.filter((row) => !legacy.has(String(row.id)));
  }

  private legacyOrganizationRows(table: string): Promise<ReadonlyMap<string, string>> {
    if (!LEGACY_FAMILY_TABLES.has(table)) return Promise.resolve(new Map());
    const driver = this.engine
      ? (this.engine as { getDriverForObject?: (objectName: string) => unknown }).getDriverForObject?.(table)
      : this.driver;
    return readLegacyOrganizationRows(driver, table);
  }

  /**
   * [ADR-0131 D6/D7, #23609] The count of {@link _find}'s rows: a legacy
   * organization's rows are not counted. Counted with them, `exists()`
   * answered true for an address only a legacy row held while `load()`
   * answered null, and the history `total` counted rows no page serves. The
   * count stays the common path; only when it is not zero and the table holds
   * legacy rows is it re-counted with them excluded in the query itself.
   */
  private async _count(table: string, query: DriverQuery): Promise<number> {
    const count = (q: DriverQuery) => (this.engine ? this.engine.count(table, q) : this.driver!.count(table, q));
    const total = await count(query);
    if (total === 0) return total;
    const legacy = await this.legacyOrganizationRows(table);
    if (legacy.size === 0) return total;
    return count({ ...query, where: { $and: [query.where ?? {}, { id: { $nin: [...legacy.keys()] } }] } });
  }

  private async _create(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.engine) {
      return this.engine.insert(table, data);
    }
    return this.driver!.create(table, data);
  }

  // `null` is the driver path's not-found answer (`IDataDriver.update()`,
  // #13878); both callers here resolve the row first and discard the result.
  private async _update(table: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (this.engine) {
      // [#11231] The resolved id AFTER the spread, so it WINS — the same
      // convention as `rest-server.ts`'s batch arm and `protocol.updateData`
      // (#6479). No `where` is passed, so the payload is the only id the
      // engine sees and its conflicting-id refusal (`UPDATE_ID_MISMATCH`) has
      // nothing to compare against: a `data.id` spread over the id parameter
      // would retarget the write to a row no caller resolved. The separate
      // `id` parameter is the row address — do not let a payload outrank it.
      // [#16231] `IDataEngine.update` now declares its dispatch union
      // (`record | affected-count | null`). This call passes NO `where`, so
      // the payload id is the only address the dispatch ladder sees and it
      // resolves `by-id` — the limb that answers a record or `null`. The
      // `number` limb is the predicate path (`driver.updateMany`'s affected
      // count, #4639), which this call cannot reach; it is narrowed away here
      // rather than cast, so a future dispatch change surfaces at THIS line
      // instead of as a wrong-shaped row at the caller.
      const updated = await this.engine.update(table, { ...data, id });
      return typeof updated === 'number' ? null : updated;
    }
    return this.driver!.update(table, id, data);
  }

  private async _delete(table: string, id: string): Promise<any> {
    if (this.engine) {
      return this.engine.delete(table, { where: { id } } as any);
    }
    return this.driver!.delete(table, id);
  }

  /**
   * Compute the next `event_seq` for `sys_metadata_history`.
   * Reads `MAX(event_seq) + 1` over the environment's history (ADR-0131 D6).
   * Legacy path — not transactional, so concurrent writes can collide.
   * The canonical (transactional) producer is `SysMetadataRepository`.
   *
   * #4825 (same shape as #4728, rule from #4632) — discriminate by error TYPE.
   * This used to `catch { return 1 }`, with a comment that named BOTH reasons a
   * read can fail and then answered both the same way. Exactly one of them is
   * benign: the history table has not been provisioned, so there is no row to
   * be inconsistent with and 1 genuinely IS the next number. Every other reason
   * — connection drop, timeout, insufficient privileges — means the rows are
   * still there and simply were not seen, and answering 1 against a table with
   * N rows **collides with existing rows**: the insert succeeds, the log stays
   * empty, and `event_seq` (the ordering key that history listing and rollback
   * targeting both stand on) is silently wrong from then on. Note this is the
   * costlier half of the #4728 family — not bytes that never landed, but bytes
   * that landed *wrong*, which no retry and no restart repairs.
   *
   * @throws The underlying driver error, unchanged, for every non-benign read
   *         failure. Deliberate: a sequence number this method cannot derive
   *         from data it actually read is not a number it may invent. The
   *         caller ({@link createHistoryRecord}) owns the consequence.
   */
  private async nextEventSeq(): Promise<number> {
    const where: Record<string, unknown> = {};
    try {
      const rows = await this._find(this.historyTableName, { where });
      let max = 0;
      for (const row of rows as Array<{ event_seq?: number | null }>) {
        const v = typeof row.event_seq === 'number' ? row.event_seq : 0;
        if (v > max) max = v;
      }
      return max + 1;
    } catch (error) {
      // Benign — and ONLY benign: there is no table, therefore no row, so
      // numbering from 1 cannot collide with anything.
      if (isMissingTableError(error, this.historyTableName)) return 1;
      throw error;
    }
  }

  /**
   * Ensure the metadata table exists.
   * Uses IDataDriver.syncSchema with the SysMetadataObject definition
   * to idempotently create/update the table.
   */
  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;

    // When using engine, schema sync is handled by ObjectQL startup
    if (this.engine) {
      this.schemaReady = true;
      // ⚠️ This loader does NOT build `idx_sys_metadata_overlay_active` (#6771).
      // It used to, with the pre-ADR-0048 key, and because every producer uses
      // `IF NOT EXISTS` the first one to run claimed the name for good. On this
      // engine path nothing has synced `sys_metadata` yet, so that producer was
      // the one most likely to win — and it installed a key the platform
      // retired. Overlay uniqueness has exactly two owners now, both correctly
      // keyed: `metadata-protocol`'s `ensureMetadataOverlayIndexes` (the
      // partial, NULL-safe form) and, for stacks without it, the declaration in
      // `metadata-core`'s `sys-metadata.object.ts` that ObjectQL's own startup
      // materializes through `syncDeclaredIndexes`.
      try {
        const engineAny = this.engine as any;
        let driver: IDataDriver | undefined =
          engineAny?.driver ?? engineAny?.getDriver?.();
        if (!driver && engineAny?.drivers instanceof Map) {
          for (const candidate of engineAny.drivers.values()) {
            const c = candidate as any;
            if (c && (typeof c.raw === 'function' || typeof c.execute === 'function')) {
              driver = candidate as IDataDriver;
              break;
            }
          }
        }
        if (driver) {
          // v5.0 forward migration: project_id → environment_id (idempotent).
          await migrateProjectIdToEnvironmentId(driver).catch(() => undefined);
        }
      } catch (error) {
        // ADR-0120 D4: never block the boot, never swallow it either (#6771 —
        // this catch was empty). Resolving a raw-SQL driver off the engine is
        // the only thing left that can throw here, and when it does the
        // `project_id` → `environment_id` forward migration did NOT run: rows
        // written before v5.0 keep the old column and read back as if the
        // field were unset.
        console.warn(
          `[Metadata] Could not resolve a raw-SQL driver from the engine for \`${this.tableName}\` — ` +
            `the project_id→environment_id forward migration was SKIPPED. Legacy rows (if any) keep the ` +
            `pre-v5.0 column and read back as unset. Metadata reads and writes are otherwise unaffected. ` +
            `Re-run it explicitly with \`migrateProjectIdToEnvironmentId(driver)\` from ` +
            `\`@objectstack/metadata/migrations\` once the datasource is reachable.`,
          error,
        );
      }
      return;
    }

    try {
      await this.driver!.syncSchema(this.tableName, {
        ...SysMetadataObject,
        name: this.tableName,
      });
    } catch (error) {
      // #4728 (rule: #4632, accident: #4420) — discriminate by error TYPE.
      // Exactly ONE failure reason is benign here: the table/columns are
      // already provisioned and a non-fully-idempotent driver reports that as
      // an error. Every other reason (insufficient privileges, datasource never
      // connected, incompatible column type) means the table or column does NOT
      // exist — and the previous code marked `schemaReady = true` for all of
      // them, making a total durability failure indistinguishable from success
      // with not one line in the log.
      if (!isSchemaAlreadyExistsError(error)) {
        if (!this.schemaFailureReported) {
          this.schemaFailureReported = true;
          console.error(
            `[Metadata] DDL for the metadata table \`${this.tableName}\` FAILED — its table/columns were NOT created or altered. ` +
              `Every metadata write from here on (Studio saves, app installs, org overlays) targets storage that may not exist: ` +
              `writes will error out, or silently drop columns on a lenient driver, while the server keeps reporting healthy. ` +
              `This is NOT the benign "already exists" case — check the datasource/driver error below (insufficient privileges, ` +
              `datasource not connected, incompatible column type), fix it and restart. Schema sync is retried on the next ` +
              `metadata operation, so a transient cause recovers on its own.`,
            error,
          );
        }
        // Deliberate, and the opposite of what this code did before: on a REAL
        // DDL failure `schemaReady` stays FALSE. Startup is still not blocked
        // (this method does not throw — callers proceed and fail loudly at the
        // driver if the table is truly missing), but the loader never claims a
        // readiness it does not have, and the next operation retries the sync
        // so a datasource that was merely still connecting heals itself. Same
        // shape as `ensureHistorySchema()` below.
        return;
      }
      // Benign — and ONLY benign: the table is already provisioned, so the DDL
      // was a no-op rather than a failure. Fall through to the ready path.
    }

    if (this.schemaFailureReported) {
      this.schemaFailureReported = false;
      console.info(
        `[Metadata] DDL for the metadata table \`${this.tableName}\` succeeded on retry — metadata writes are durable again.`,
      );
    }
    this.schemaReady = true;
    // v5.0 forward migration: project_id → environment_id (idempotent).
    try {
      await migrateProjectIdToEnvironmentId(this.driver!);
    } catch {
      // ignore — migration is best-effort on bootstrap
    }
    // ⚠️ No overlay-index DDL is issued from here (#6771). `syncSchema` above
    // already materialized the DECLARED `idx_sys_metadata_overlay_active` from
    // `sys-metadata.object.ts` with the CURRENT ADR-0048 discriminator
    // `(type, name, organization_id, package_id)`; measured on real SQLite, the
    // producer that used to sit here found the name taken and no-opped —
    // while still reporting `status: 'created'`. Its one non-no-op window was
    // the benign "already exists" path above, where `syncSchema` threw before
    // creating the declared indexes: there it installed the RETIRED key
    // `(…, environment_id, scope)`, and `syncDeclaredIndexes` skips by name, so
    // nothing ever repaired it. See the tombstone in `../migrations/index.ts`.
  }

  /**
   * Ensure the history table exists.
   * Uses IDataDriver.syncSchema with the SysMetadataHistoryObject definition.
   */
  private async ensureHistorySchema(): Promise<void> {
    if (!this.trackHistory || this.historySchemaReady) return;

    // When using engine, schema sync is handled by ObjectQL startup
    if (this.engine) {
      this.historySchemaReady = true;
      return;
    }

    try {
      await this.driver!.syncSchema(this.historyTableName, {
        ...SysMetadataHistoryObject,
        name: this.historyTableName,
      });
      if (this.historySchemaFailureReported) {
        this.historySchemaFailureReported = false;
        console.info(
          `[Metadata] DDL for the metadata history table \`${this.historyTableName}\` succeeded on retry — change history is being recorded again.`,
        );
      }
      this.historySchemaReady = true;
    } catch (error) {
      // Same discrimination as `ensureSchema()` above (#4728). A benign
      // "already exists" means the history table IS provisioned — treat it as
      // the no-op it is instead of re-reporting it (and re-running the DDL) on
      // every single write, which is the mirror-image failure: an `error` line
      // for a non-degradation trains everyone to skim `error`.
      if (isSchemaAlreadyExistsError(error)) {
        this.historySchemaReady = true;
        return;
      }
      // Real failure: loud once, `historySchemaReady` stays false so the next
      // operation retries.
      if (!this.historySchemaFailureReported) {
        this.historySchemaFailureReported = true;
        console.error(
          `[Metadata] DDL for the metadata history table \`${this.historyTableName}\` FAILED — its table/columns were NOT created. ` +
            `Metadata change history (versions, diffs, rollback) will NOT be persisted while every metadata write keeps succeeding, ` +
            `so the audit trail silently ends here. Fix the datasource/driver error below and restart; the sync is retried on the ` +
            `next metadata operation.`,
          error,
        );
      }
    }
  }

  /**
   * Build base filter conditions for queries.
   * Neither `organizationId` (ADR-0131 D6/D7: the family declares no
   * organization column) nor `environmentId` (ADR-0008 §0) constrains the
   * query — both options are accepted for back-compat only.
   */
  private baseFilter(type: string, name?: string): Record<string, unknown> {
    const filter: Record<string, unknown> = { type };
    if (name !== undefined) {
      filter.name = name;
    }
    return filter;
  }

  /**
   * Create a history record for a metadata change.
   *
   * [#21828] The caller has already decided this IS a change and hands in the
   * stamp it wrote on the parent row ({@link contentHash}), so the history row
   * carries the same value. ⛔ No "unchanged?" comparison here: the only
   * `'update'` caller, `save`, reaches this line after comparing CONTENT, and a
   * second comparison of the new stamp with the previous STORED stamp is never
   * the right arbiter. A stamp written under an older rule can equal the new
   * one while the content differs (a reorder of an object's `fields` into
   * sorted key order, against a stamp that sorted every map), which would
   * record a real change with no history row.
   *
   * @param type - Metadata type
   * @param name - Metadata name
   * @param version - Version number
   * @param metadata - The metadata payload
   * @param operationType - Type of operation
   * @param checksum - The parent row's new stamp, `contentHash` of the stored body
   * @param previousChecksum - The parent row's stamp before this write (if any)
   * @param changeNote - Optional change description
   * @param recordedBy - Optional user who made the change
   * @param packageId - [ADR-0150 D3/D4, #32351] For a by-package type, the
   *   package whose row this snapshot was taken of, or the `sys_metadata`
   *   sentinel for the package-less row ({@link historySnapshotPackage}),
   *   stored in the history row's `package_id` column; `undefined` for every
   *   other type, whose history row stays as it was.
   */
  private async createHistoryRecord(
    type: string,
    name: string,
    version: number,
    metadata: unknown,
    operationType: 'create' | 'update' | 'publish' | 'revert' | 'delete',
    checksum: string,
    previousChecksum?: string,
    changeNote?: string,
    recordedBy?: string,
    packageId?: string,
  ): Promise<void> {
    if (!this.trackHistory) return;

    await this.ensureHistorySchema();

    const now = new Date().toISOString();

    const historyId = generateId();
    // [ruling 6677709817 (c)] The snapshot withholds every position the type's
    // redactor marks not carried forward (a connector's undeclared `auth`
    // keys), so no history row keeps what the save drains from the live row.
    // Before the sequence read: a snapshot that cannot be made is skipped, the
    // write itself having succeeded — this method's posture for every failure.
    let metadataJson: string;
    try {
      metadataJson = JSON.stringify(historySnapshotBody(type, metadata));
    } catch (error) {
      console.error(`Failed to create history record for ${type}/${name}:`, error);
      return;
    }

    // Compute per-org monotonic event_seq. Legacy path: not inside a
    // transaction, so concurrent writers can collide. The SysMetadataRepository
    // path serializes this under engine.transaction(); DatabaseLoader is
    // deprecated for new writes and tolerates the race.
    //
    // #4825: the concurrency race above is a KNOWN, recorded limitation of this
    // path. A read failure is not the same thing and is not tolerated — if the
    // sequence cannot be derived from rows we actually read, we write NO history
    // row rather than one carrying a number we made up. A missing row is loud
    // here and visibly absent later; a colliding row is silent now and corrupts
    // the ordering that `queryHistory` and `rollback` both depend on, forever.
    let eventSeq: number;
    try {
      eventSeq = await this.nextEventSeq();
    } catch (error) {
      if (!this.historySeqFailureReported) {
        this.historySeqFailureReported = true;
        console.error(
          `[Metadata] Could not read \`${this.historyTableName}\` to determine the next \`event_seq\` — the history ` +
            `entry for ${type}/${name} was NOT written, and further entries are being skipped while this persists. ` +
            `The metadata write itself SUCCEEDED, so the server keeps looking healthy while its change history ` +
            `silently develops holes: version timelines and rollback targets will be incomplete. The entry is skipped ` +
            `deliberately — numbering it from 1 (what this code once did) would collide with existing rows and ` +
            `make \`event_seq\` ordering wrong rather than merely incomplete, which nothing detects and no restart ` +
            `repairs. Fix the datasource/driver error below (connection, timeout, privileges); the next metadata write ` +
            `retries and reports recovery.`,
          error,
        );
      }
      return;
    }

    if (this.historySeqFailureReported) {
      this.historySeqFailureReported = false;
      console.info(
        `[Metadata] \`${this.historyTableName}\` is readable again — \`event_seq\` numbering recovered and change ` +
          `history is being recorded again. Entries skipped during the outage are not backfilled.`,
      );
    }

    const historyRecord: Partial<MetadataHistoryRecord> = {
      id: historyId,
      name,
      type,
      version,
      operationType,
      metadata: metadataJson as any,
      checksum,
      previousChecksum,
      changeNote,
      recordedBy,
      recordedAt: now,
    };

    try {
      await this._create(this.historyTableName, {
        id: historyRecord.id,
        event_seq: eventSeq,
        name: historyRecord.name,
        type: historyRecord.type,
        version: historyRecord.version,
        operation_type: historyRecord.operationType,
        metadata: historyRecord.metadata,
        checksum: historyRecord.checksum,
        previous_checksum: historyRecord.previousChecksum,
        change_note: historyRecord.changeNote,
        recorded_by: historyRecord.recordedBy,
        recorded_at: historyRecord.recordedAt,
        source: 'database-loader',
        ...(packageId !== undefined ? { package_id: packageId } : {}),
      });
    } catch (error) {
      // Log error but don't fail the main operation
      console.error(`Failed to create history record for ${type}/${name}:`, error);
    }
  }

  /**
   * Once-per-process dedupe for stored-row conversion notices — `load` /
   * `loadMany` are hot read paths (cached, but re-hit on every TTL expiry),
   * so a legacy row must warn once, not once per cache miss.
   */
  private storedConversionWarned = new Set<string>();

  /**
   * Convert a LIVE database row to a metadata payload.
   *
   * Parses the JSON `metadata` column back into an object, then replays the
   * full ADR-0087 conversion chain over it (#3903): rows written under a past
   * protocol are served canonical, exactly like the metadata-protocol's
   * `sys_metadata` seams. History rows do NOT pass through here — history
   * readers parse inline and stay verbatim, as a record of what was written.
   *
   * `flow` is skipped for the same reason the protocol skips it: flow-node
   * conversions need the automation engine's live executor registry for their
   * open-namespace conflict guard; flows canonicalize at `registerFlow`.
   */
  private rowToData(row: Record<string, unknown>): Record<string, unknown> | null {
    if (!row || !row.metadata) return null;

    const payload = typeof row.metadata === 'string'
      ? JSON.parse(row.metadata as string)
      : row.metadata;

    const singular = PLURAL_TO_SINGULAR[row.type as string] ?? (row.type as string);
    if (singular === 'flow') return payload as Record<string, unknown>;
    return applyConversionsToStoredItem(singular, payload as Record<string, unknown>, {
      onNotice: (n) => {
        const key = `${n.conversionId}|${singular}|${String(row.name ?? '')}`;
        if (this.storedConversionWarned.has(key)) return;
        this.storedConversionWarned.add(key);
        console.warn(
          `[DatabaseLoader] stored ${singular}/${String(row.name ?? '<unnamed>')} carries a pre-protocol shape; ${n.message}`,
        );
      },
    });
  }

  /**
   * Convert a database row to a MetadataRecord-like object.
   */
  private rowToRecord(row: Record<string, unknown>): MetadataRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as string,
      namespace: (row.namespace as string) ?? 'default',
      packageId: row.package_id as string | undefined,
      managedBy: row.managed_by as MetadataRecord['managedBy'],
      scope: (row.scope as MetadataRecord['scope']) ?? 'platform',
      metadata: this.rowToData(row) ?? {},
      extends: row.extends as string | undefined,
      strategy: (row.strategy as MetadataRecord['strategy']) ?? 'merge',
      owner: row.owner as string | undefined,
      state: (row.state as MetadataRecord['state']) ?? 'active',
      organizationId: undefined /* [ADR-0131 D7] every row read here is the environment's */,
      environmentId: row.environment_id as string | undefined,
      version: (row.version as number) ?? 1,
      checksum: row.checksum as string | undefined,
      source: row.source as MetadataRecord['source'],
      tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags as string) : row.tags as string[]) : undefined,
      createdBy: row.created_by as string | undefined,
      // [#16422] The shared spelling, not the per-site `isoFromValidDate` this
      // card retired. `canonicalIsoInstant` RETURNS `string | undefined`,
      // which is exactly what `MetadataRecord.createdAt` / `.updatedAt` are
      // declared as (`z.string().datetime().optional()`), so the `as string |
      // undefined` cast that stood here — an assertion about a driver row,
      // never a measurement of one — is gone rather than restated. The
      // terminal value is `undefined`, the branch an absent column already
      // took: both fields are `.optional()`, and both readers (`load()`, which
      // reads only `checksum`, and `stat()`, whose `?? new Date().toISOString()`
      // chain is unchanged) already carry it.
      createdAt: canonicalIsoInstant(row.created_at),
      updatedBy: row.updated_by as string | undefined,
      updatedAt: canonicalIsoInstant(row.updated_at),
    };
  }

  // ==========================================
  // Read-failure classification (#5108)
  // ==========================================

  /**
   * Decide what a failed READ against {@link tableName} means, and rethrow
   * unless it is the ONE benign reason.
   *
   * #5108 (rule from #4632; same shape as #4728 and #4825) — discriminate by
   * error TYPE. Every read method below used to `catch {}` into its own empty
   * value: `load` → `null`, `loadMany` → `[]`, `exists` → `false`, `stat` →
   * `null`, `list` → `[]`. That made a database the metadata plane cannot
   * reach **indistinguishable** from an environment where nothing of that type
   * was ever declared — and it erased the failure *inside the loader*, so
   * neither `MetadataManager`'s own `try/catch` degradation branches nor
   * {@link import('../metadata-manager.js').MetadataManager.loadDiagnosed}
   * (ADR-0110 D3, whose whole purpose is to tell a miss from an outage) could
   * report anything. Nowhere on the chain was there a line saying the read
   * failed.
   *
   * Why that is worse than a noisy error: every consumer that gates on a
   * *declared set* — permissions, sharing rules, policies, endpoint
   * declarations — reads the empty answer as "the author declared none". Some
   * then fail open (grant), some fail closed (lock out); both look healthy
   * from outside. This is the AGENTS.md → "Degradation log levels" shape the
   * repo has already paid for twice, one layer up from #4825.
   *
   * Exactly one failure reason is benign: `sys_metadata` has not been
   * provisioned yet. There are then genuinely no rows, so "nothing declared"
   * IS the truth, and a first boot must not explode. Every other reason —
   * connection drop, timeout, insufficient privileges, malformed query — means
   * the rows may well be there and simply were not seen.
   *
   * Classification is conservative in the same direction as
   * {@link isMissingTableError} itself: an unrecognised error is NOT benign.
   * A false "benign" silently mis-answers a security question; a false "real"
   * costs one loud error.
   *
   * @param error The value thrown by `_find` / `_findOne` / `_count`.
   * @throws The underlying driver error, unchanged — deliberately, matching
   *         {@link nextEventSeq}. The loader does not log it: the caller owns
   *         the consequence and is the only layer that knows what an
   *         incomplete answer costs it (`MetadataManager.list()` reports it at
   *         `error`; `listForIndex()`/`matchEndpoint` let it propagate so an
   *         outage can never be served as a 404).
   * @returns normally ONLY for the benign case, licensing the caller to answer
   *          with its empty value.
   */
  private rethrowUnlessTableUnprovisioned(error: unknown): void {
    // [commit 4cda78c9b] Every caller of this helper reads `this.tableName`, so that is
    // the relation whose emptiness they are about to trust — a failure naming
    // any OTHER relation (a view over a dropped base table) is not evidence
    // about it and stays loud.
    if (isMissingTableError(error, this.tableName)) return;
    throw error;
  }

  // ==========================================
  // MetadataLoader Interface Implementation
  // ==========================================

  async load(
    type: string,
    name: string,
    _options?: MetadataLoadOptions
  ): Promise<MetadataLoadResult> {
    const startTime = Date.now();

    await this.ensureSchema();

    // Read-through cache. We cache `null` (not-found) results too so a barrage
    // of misses does not hammer the database; invalidation on `save` upgrades
    // the entry once the row exists.
    const key = this.cacheKey(type, name);
    if (this.loadCache) {
      const cached = this.loadCache.get(key);
      if (cached !== undefined) {
        return {
          data: cached,
          source: 'database',
          format: 'json',
          loadTime: Date.now() - startTime,
        };
      }
    }

    try {
      // [#32246] A by-package type has a row per package: the one saved last,
      // its highest version.
      const row = await this._findOne(this.tableName, {
        where: this.baseFilter(type, name),
        ...(PACKAGE_SLOTTED_STORE_TYPES.has(type) ? { orderBy: [{ field: 'version', order: 'desc' as const }] } : {}),
      });

      if (!row) {
        this.loadCache?.set(key, null);
        return {
          data: null,
          loadTime: Date.now() - startTime,
        };
      }

      const data = this.rowToData(row);
      const record = this.rowToRecord(row);

      this.loadCache?.set(key, data);

      return {
        data,
        source: 'database',
        format: 'json',
        etag: record.checksum,
        loadTime: Date.now() - startTime,
      };
    } catch (error) {
      this.rethrowUnlessTableUnprovisioned(error);
      // Benign only: the table is not provisioned, so there is no row. Not
      // cached — `ensureSchema()` retries, and a `null` memoized here would
      // outlive the provisioning that fixes it.
      return {
        data: null,
        loadTime: Date.now() - startTime,
      };
    }
  }

  /**
   * The one type-wide read both plural readers share: every row of `type`, each
   * body paired with the `name` COLUMN it was stored under.
   *
   * [#14205] `name` is `null` only for a row whose key column does not hold a
   * string. Such a row is still a body {@link loadMany} must return — dropping
   * it would change what consumers see today — but it has no usable identity,
   * so {@link loadManyKeyed} filters it out rather than invent one.
   *
   * One query and one cache entry serve both methods: `loadMany()` used to own
   * them, and splitting them would have made every keyed `list()` read miss the
   * cache and re-hit the database.
   */
  private async readTypeRows(type: string): Promise<StoredTypeRow[]> {
    await this.ensureSchema();

    if (this.loadManyCache) {
      const cached = this.loadManyCache.get(type);
      if (cached !== undefined) {
        return cached as StoredTypeRow[];
      }
    }

    try {
      const rows = await this._find(this.tableName, {
        where: this.baseFilter(type),
      });

      const result: StoredTypeRow[] = [];
      for (const row of rows) {
        const data = this.rowToData(row);
        if (data === null) continue;
        const name = row.name;
        const packageId = PACKAGE_SLOTTED_STORE_TYPES.has(type) ? storedRowPackageId(row) : undefined;
        const member = PACKAGE_SLOTTED_STORE_TYPES.has(type) ? storedRowMemberOf(type, data, row.bundle_member) : undefined;
        result.push({
          name: typeof name === 'string' && name !== '' ? name : null,
          data,
          ...(PACKAGE_SLOTTED_STORE_TYPES.has(type)
            ? {
                packageId,
                version: Number(row.version) || 0,
                ...(member !== undefined ? { member } : {}),
                // [#31699 R7-A] A legacy row: its package named by its stored body alone.
                ...(packageId !== undefined && packageId !== row.package_id ? { legacyRowId: String(row.id) } : {}),
              }
            : {}),
        });
      }

      this.loadManyCache?.set(type, result);
      return result;
    } catch (error) {
      this.rethrowUnlessTableUnprovisioned(error);
      // Benign only: no table, therefore no items of this type. Not cached.
      return [];
    }
  }

  async loadMany<T = any>(
    type: string,
    _options?: MetadataLoadOptions
  ): Promise<T[]> {
    return (await this.unscopedTypeRows(type)).map(entry => this.handOut(entry)) as T[];
  }

  /**
   * [#31699 R7-B] A copy of a cached body, so a caller that stamps what it is
   * handed (the boot priming pass's `applyProtection`) never edits the
   * plural-read cache. A legacy row's copy is recorded for
   * {@link bindReadRowPackage}.
   */
  private handOut(entry: StoredTypeRow): Record<string, unknown> {
    const copy = { ...entry.data };
    if (entry.legacyRowId !== undefined && entry.packageId !== undefined) this.legacyReadRows.set(copy, { id: entry.legacyRowId, packageId: entry.packageId });
    return copy;
  }

  /**
   * [#31699 R7-A; epic ruling 6809488921] Bind the empty `package_id` column of
   * the legacy row a plural read handed `item` out from to the package that
   * row's own stored body names: the column only — no body, no version, no
   * history row, no insert (#32347's column-only update). [#32540] An action
   * row's object is named in `bundle_member` in the same update, after the
   * package's rows of the name written before their object was named. ⛔ Never from
   * `item`'s stamp as it stands now, never a row the read did not hand out,
   * [#32488] never another writer's row (`source` other than `'database'`, as
   * the operator migration reads it), and never into a slot another row of the
   * name holds. `MetadataManager.register`
   * calls it in place of the write-through it skips (`skipSourceLoader`).
   */
  async bindReadRowPackage(type: string, name: string, item: object): Promise<void> {
    const read = this.legacyReadRows.get(item);
    if (!read) return;
    const rows = await this._find(this.tableName, { where: this.baseFilter(type, name) });
    const row = rows.find((candidate) => String(candidate.id) === read.id);
    if (!row || row.package_id === read.packageId || storedRowPackageId(row) !== read.packageId) return;
    // [#32488 item 3, R8-A] The loader's own rows only, as `migrateDatabaseLoaderRowPackages`
    // binds them: another writer's row whose body carries a copied stamp is bound to nothing.
    if (row.source !== 'database') return;
    // [#32540] An action's member is its bound object: one package's rows of one
    // name on two objects are two slots' rows. Read as the store's unique key
    // holds it once named (`namedRowColumnOf`): a row whose object the column
    // cannot store keeps the object-less binding's place.
    const memberOf = (of: Record<string, unknown>) => {
      const column = namedRowColumnOf(type, this.rowToData(of), of.bundle_member);
      return column !== undefined ? column : (storedRowMemberOf(type, this.rowToData(of), of.bundle_member) ?? null);
    };
    const target = memberOf(row);
    const ofPackage = rows.filter((other) => other !== row && other.package_id === read.packageId);
    if (ofPackage.some((other) => memberOf(other) === target)) return;
    // [#32540 C3] Binding the package is a write of the package's slot: its rows
    // written before their object was named are named first, and this row's
    // object is named in the same update — otherwise two of the package's
    // bindings would share the object-less place of the unique key.
    const owned = namedRowColumnOf(type, this.rowToData(row), row.bundle_member) !== undefined;
    if (owned) await this.nameUnnamedRows(type, name, unnamedRowsOf(type, ofPackage, (of) => this.rowToData(of)));
    const naming = owned && typeof target === 'string' && row.bundle_member !== target ? { bundle_member: target } : {};
    await this._update(this.tableName, read.id, { package_id: read.packageId, ...naming });
    this.invalidate(type, name);
  }

  /**
   * [#32246] {@link readTypeRows} as the unscoped reads answer it: for a
   * by-package type, one row per store slot — the one saved last of the slot
   * (its highest version), in the order slots first appear — where a name
   * no package or one package holds is one slot (as when the loader kept one
   * row per name) and the paragraphs below give the other keys. Every other
   * type: every row.
   *
   * [#31699 R3-B] A bundled by-package type keeps one row per
   * `(package, name, member)` ({@link unscopedRowKey}): one per name would
   * drop every other member of a bundle, and every other package's bundle.
   *
   * [#32521; epic #31527 red lines 2 and 3] An unbundled by-package type
   * keeps one row per `(package, name)` ({@link pluralEntryKeys}, the key the
   * metadata service's own plural reads keep one entry per), FROM one per
   * name: one per name dropped every package's row of a name two packages
   * hold but the one saved last, so the boot priming pass registered that
   * package alone and a bare read of the name answered its body instead of
   * refusing (`409 ambiguous-in-environment`). A name no package or one
   * package holds keeps one row, as before: a package-less row beside one
   * package's is that holder's customization (D4), and the row saved last of
   * the two is the one answered; one package's action bound to several
   * objects is one `(package, name)`, as before.
   */
  private async unscopedTypeRows(type: string): Promise<StoredTypeRow[]> {
    const rows = await this.readTypeRows(type);
    if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return rows;
    const bundled = isBundledStoreType(type);
    const keys = bundled ? undefined : pluralEntryKeys(type, rows);
    const latest = new Map<string, StoredTypeRow>();
    const unnamed: StoredTypeRow[] = [];
    for (const [at, row] of rows.entries()) {
      if (row.name === null) { unnamed.push(row); continue; }
      const key = keys ? keys[at]! : unscopedRowKey(row.name, row.packageId, row.member ?? null);
      const held = latest.get(key);
      if (!held || (row.version ?? 0) >= (held.version ?? 0)) latest.set(key, row);
    }
    return [...latest.values(), ...unnamed];
  }

  /**
   * [#14205] The keyed half of {@link loadMany} — see
   * {@link MetadataKeyedItem} for why the row key travels beside the body
   * instead of inside it.
   *
   * `DatabaseLoader` is where the defect was measured: an aggregated view
   * container is written by `register('view', OBJECT, container)` and stored
   * verbatim, so its `sys_metadata` row carries the identity in the `name`
   * COLUMN and the body has none. {@link rowToData} returns that body without
   * folding the column in — deliberately, and unchanged here.
   */
  async loadManyKeyed<T = any>(
    type: string,
    _options?: MetadataLoadOptions
  ): Promise<MetadataKeyedItem<T>[]> {
    const entries = await this.unscopedTypeRows(type);
    // [#31699 R3-B] A bundled type's entries carry the package each row holds,
    // so a merge above this loader keeps two packages' same member apart.
    // [#32458] Every type stored per `(package, name)` does: a row bound to its
    // package by the `package_id` column alone names none in its body, and the
    // boot priming pass registers what it is handed.
    const withPackage = PACKAGE_SLOTTED_STORE_TYPES.has(type);
    const keyed: MetadataKeyedItem<T>[] = [];
    for (const entry of entries) {
      if (entry.name === null) continue;
      const data = this.handOut(entry);
      keyed.push(withPackage ? keyedRow<T>(entry.name, { ...entry, data }) : { name: entry.name, data: data as T });
    }
    return keyed;
  }

  /**
   * [ADR-0150 D3/D4, #32246] Every row of `name`, each with the package it
   * holds the item for ({@link storedRowPackageId}) — the type-wide read
   * {@link loadManyKeyed} shares, so it costs no query of its own.
   */
  async loadSlots<T = any>(type: string, name: string): Promise<MetadataKeyedItem<T>[]> {
    return (await this.loadManySlots<T>(type)).filter((slot) => slot.name === name);
  }

  /** [ADR-0150 D4, #32246] Every named row of `type`, each with the package it holds the item for. */
  async loadManySlots<T = any>(type: string): Promise<MetadataKeyedItem<T>[]> {
    const slots: MetadataKeyedItem<T>[] = [];
    for (const entry of await this.readTypeRows(type)) {
      if (entry.name !== null) slots.push(keyedRow<T>(entry.name, entry));
    }
    return slots;
  }

  async exists(type: string, name: string): Promise<boolean> {
    await this.ensureSchema();

    // Honor cache: a cached non-null payload implies existence.
    if (this.loadCache) {
      const cached = this.loadCache.get(this.cacheKey(type, name));
      if (cached !== undefined) return cached !== null;
    }

    try {
      const count = await this._count(this.tableName, {
        where: this.baseFilter(type, name),
      });

      return count > 0;
    } catch (error) {
      this.rethrowUnlessTableUnprovisioned(error);
      // Benign only: no table, therefore the item genuinely does not exist.
      return false;
    }
  }

  async stat(type: string, name: string): Promise<MetadataStats | null> {
    await this.ensureSchema();

    const key = this.cacheKey(type, name);
    if (this.statCache) {
      const cached = this.statCache.get(key);
      if (cached !== undefined) return cached;
    }

    try {
      const row = await this._findOne(this.tableName, {
        where: this.baseFilter(type, name),
      });

      if (!row) {
        this.statCache?.set(key, null);
        return null;
      }

      const record = this.rowToRecord(row);
      const metadataStr = typeof row.metadata === 'string'
        ? row.metadata as string
        : JSON.stringify(row.metadata);

      const stats: MetadataStats = {
        size: metadataStr.length,
        mtime: canonicalIsoInstant(record.updatedAt ?? record.createdAt) ?? new Date().toISOString(),
        format: 'json',
        etag: record.checksum,
      };
      this.statCache?.set(key, stats);
      return stats;
    } catch (error) {
      this.rethrowUnlessTableUnprovisioned(error);
      // Benign only: no table, therefore nothing to stat. Not cached.
      return null;
    }
  }

  async list(type: string): Promise<string[]> {
    await this.ensureSchema();

    if (this.listCache) {
      const cached = this.listCache.get(type);
      if (cached !== undefined) return cached;
    }

    try {
      const rows = await this._find(this.tableName, {
        where: this.baseFilter(type),
        fields: ['name'],
      });

      const names = rows
        .map(row => row.name as string)
        .filter(name => typeof name === 'string');
      // [#32246] A by-package type has a row per package: one name each.
      const listed = PACKAGE_SLOTTED_STORE_TYPES.has(type) ? [...new Set(names)] : names;

      this.listCache?.set(type, listed);
      return listed;
    } catch (error) {
      this.rethrowUnlessTableUnprovisioned(error);
      // Benign only: no table, therefore no names. Not cached.
      return [];
    }
  }

  /**
   * Fetch a single history snapshot by (type, name, version).
   * Returns null when the record does not exist.
   *
   * [ADR-0150 D3/D4, #32351] For a by-package type, `options.packageId` names
   * whose version it is (`null`: the environment's, recorded under no
   * package): a version of another package answers null. With no address, a
   * name more than one row slot holds is refused before the row is read
   * ({@link historyPackageAddress}); one holder answers as before.
   */
  async getHistoryRecord(
    type: string,
    name: string,
    version: number,
    options?: MetadataHistoryAddress,
  ): Promise<MetadataHistoryRecord | null> {
    if (!this.trackHistory) return null;

    const packageId = await this.historyPackageAddress(type, name, options);

    await this.ensureHistorySchema();

    const filter: Record<string, unknown> = {
      type,
      name,
      version,
    };
    const row = await this._findOne(this.historyTableName, {
      where: filter,
    });
    if (!row) return null;
    if (packageId !== undefined && historyRowAttribution(row) !== packageId) return null;

    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as string,
      version: row.version as number,
      operationType: row.operation_type as MetadataHistoryRecord['operationType'],
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : row.metadata,
      checksum: row.checksum as string,
      previousChecksum: row.previous_checksum as string | undefined,
      changeNote: row.change_note as string | undefined,
      organizationId: undefined /* [ADR-0131 D7] every row read here is the environment's */,
      recordedBy: row.recorded_by as string | undefined,
      // [#16422] `MetadataHistoryRecord.recordedAt` is a REQUIRED
      // `z.string().datetime()`, so it is the one site in this family with no
      // ruled-valid terminal value before this card: the visible text
      // `"Invalid Date"` fails the refinement, `undefined` fails the required
      // field, and the pre-collapse pass-through fed it a `Date` object, which
      // fails both. The third answer is a CALLER-side default, and it is the
      // epoch rather than `new Date()`: `now` would stamp a plausible but
      // false recording instant on a version recorded years ago and sort it to
      // the top of a newest-first history, while the epoch sorts an unreadable
      // stamp to the oldest end and invents no fact. It is also the answer the
      // sibling reader of this very column already gives (`rowToEvent` and
      // `history()` in `sys-metadata-repository.ts`, both `?? new
      // Date(0).toISOString()`). See {@link recordedAtFallback}.
      recordedAt: canonicalIsoInstant(row.recorded_at) ?? recordedAtFallback(),
    };
  }

  /**
   * Query history records with pagination and filtering.
   * Encapsulates history table queries so MetadataManager doesn't need
   * direct driver access.
   */
  async queryHistory(
    type: string,
    name: string,
    options?: {
      operationType?: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
      includeMetadata?: boolean;
    } & MetadataHistoryAddress
  ): Promise<{ records: any[]; total: number; hasMore: boolean }> {
    if (!this.trackHistory) {
      return { records: [], total: 0, hasMore: false };
    }

    await this.ensureSchema();
    const packageId = await this.historyPackageAddress(type, name, options);
    await this.ensureHistorySchema();

    // Build history query directly against (type, name); no parent
    // lookup needed since the history table is keyed by these fields.
    const historyFilter: Record<string, unknown> = {
      type,
      name,
    };
    if (options?.operationType) historyFilter.operation_type = options.operationType;
    if (options?.since) historyFilter.recorded_at = { $gte: options.since };
    if (options?.until) {
      if (historyFilter.recorded_at) {
        (historyFilter.recorded_at as Record<string, unknown>).$lte = options.until;
      } else {
        historyFilter.recorded_at = { $lte: options.until };
      }
    }
    // [ADR-0053 D-D1 items 5 and 7, as amended — #20822] In driver mode this
    // filter goes straight to `IDataDriver.find` / `count`, and a driver is not
    // a seam: it compiles the comparison it is handed, so a bare-day `until`
    // would run as the `<=` midnight it was written as and drop every version
    // recorded later that day. So in driver mode this call IS the seam and runs
    // the shared lowering itself, typed by the history object it syncs
    // ({@link HISTORY_FILTER_LOWERING}): `until: 'YYYY-MM-DD'` becomes
    // `recorded_at < next day`, and an instant `until` is kept as written. In
    // engine mode the engine's own `where` seam lowers it, typed by the
    // registered history object, so this call does not lower a second time.
    const where = this.engine ? historyFilter : lowerFilterCondition(historyFilter, HISTORY_FILTER_LOWERING);

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const orderBy = [
      { field: 'recorded_at', order: 'desc' as const },
      { field: 'version', order: 'desc' as const },
    ];
    // [#32351] One package's versions of a by-package type: the name's rows in
    // the same order, those attributed ({@link historyRowAttribution}: the
    // `package_id` column, the sentinel for the environment's, else the
    // package a row written before the column names in its body) to the one
    // addressed, then paged — so `total` and `hasMore` count that package's
    // versions, not the name's. An unattributed version is in no address's.
    let historyRecords: Array<Record<string, unknown>>;
    let total: number;
    if (packageId !== undefined) {
      const own = (await this._find(this.historyTableName, { where, orderBy }))
        .filter((row) => historyRowAttribution(row) === packageId);
      historyRecords = own.slice(offset, offset + limit + 1);
      total = own.length;
    } else {
      historyRecords = await this._find(this.historyTableName, { where, orderBy, limit: limit + 1, offset });
      total = await this._count(this.historyTableName, { where });
    }

    const hasMore = historyRecords.length > limit;
    const records = historyRecords.slice(0, limit);

    const includeMetadata = options?.includeMetadata !== false;
    const result = records.map((row: Record<string, unknown>) => {
      const parsedMetadata =
        typeof row.metadata === 'string'
          ? JSON.parse(row.metadata as string)
          : (row.metadata as Record<string, unknown> | null | undefined);

      return {
        id: row.id as string,
        name: row.name as string,
        type: row.type as string,
        version: row.version as number,
        operationType: row.operation_type as string,
        metadata: includeMetadata ? parsedMetadata : null,
        checksum: row.checksum as string,
        previousChecksum: row.previous_checksum as string | undefined,
        changeNote: row.change_note as string | undefined,
        organizationId: undefined /* [ADR-0131 D7] every row read here is the environment's */,
        recordedBy: row.recorded_by as string | undefined,
        // [#16422] The other door onto the same column — same shared spelling,
        // same caller-side terminal value. See `getHistoryRecord` above for
        // why the epoch and not `now`, and {@link recordedAtFallback}.
        recordedAt: canonicalIsoInstant(row.recorded_at) ?? recordedAtFallback(),
      };
    });

    return { records: result, total, hasMore };
  }

  /**
   * [ADR-0150 D3, #32351] The package a history read of `(type, name)`
   * addresses: for a by-package type the address's package, or `null` for the
   * environment ({@link addressedPackage}), else `undefined` (the name's whole
   * history, as before). A by-package name read with no
   * package while more than one row slot holds it — two packages', or a
   * package's beside the package-less row — is refused naming every holder
   * (`refuseSeveralSlots`, the rollback's refusal): its versions are several
   * packages' and nothing picks one. Every other type is not read here.
   */
  private async historyPackageAddress(
    type: string,
    name: string,
    options?: MetadataHistoryAddress,
  ): Promise<string | null | undefined> {
    if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return undefined;
    const packageId = addressedPackage(options);
    if (packageId !== undefined) return packageId;
    await this.ensureSchema();
    refuseSeveralSlots(await this.rowSlots(type, name), type, name);
    return undefined;
  }

  /**
   * Perform a rollback: persist `restoredData` as the new current state and record a
   * single 'revert' history entry (instead of the usual 'update' entry that `save()`
   * would produce). This avoids the duplicate-version problem that arises when
   * `register()` → `save()` writes an 'update' entry followed by an additional
   * 'revert' entry for the same version number.
   *
   * [ADR-0150 D3/D4, #32351] For a by-package type the rollback writes one row
   * slot ({@link rollbackSlot}): the one `options.packageId` addresses (`null`:
   * the environment's package-less row), refused (`not-held-by-qualifier`)
   * when it holds no row of the name, or, addressing none, the name's one row
   * slot (several are refused naming every holder, before any write). The
   * version restored must be that slot's package's: another package's version
   * is refused, ⛔ never written into the remaining holder's row (S8a). Every
   * other type restores its name's row, as before.
   */
  async registerRollback(
    type: string,
    name: string,
    restoredData: unknown,
    targetVersion: number,
    changeNote?: string,
    recordedBy?: string,
    options?: MetadataHistoryAddress,
  ): Promise<void> {
    await this.ensureSchema();

    const now = new Date().toISOString();
    const metadataJson = JSON.stringify(restoredData);
    // [#21828] The one stamp vocabulary of `sys_metadata` — see {@link contentHash}.
    const newChecksum = contentHash(metadataJson, type);

    // [ADR-0150 D3, #32246 R1/R1b, #32351] The rows a by-package rollback may
    // write: one slot's, picked as the doc above says.
    const slot = PACKAGE_SLOTTED_STORE_TYPES.has(type)
      ? await this.rollbackSlot(type, name, targetVersion, restoredData, addressedPackage(options))
      : undefined;

    // [#31699 R3-B] A bundled type's one slot holds a row per member: the
    // rollback restores the row of the member the restored body declares,
    // never the first row the driver returns (another member's). [#32540] So
    // does an action's: its member is the object the restored body is bound
    // to, never another binding's row. [#32351] Both within the one row slot
    // picked above, never another holder's rows.
    const member = slot ? storedRowMemberOf(type, restoredData) : undefined;
    const rowsOfName = slot && member !== undefined ? slot.rows : [];
    const existing = member === undefined
      ? (slot ? slot.rows[0] ?? null : await this._findOne(this.tableName, { where: this.baseFilter(type, name) }))
      : rowsOfName.find((row) => (storedRowMemberOf(type, this.rowToData(row), row.bundle_member) ?? null) === member) ?? null;
    // [#32540 C9] The restored body may be bound to an object the slot holds no
    // row of (a row written before held one binding and was later re-bound
    // to another object): it is restored as that binding's own row, in the
    // slot's one package — ⛔ never written over another binding's row.
    const restoresBinding = !existing && member !== undefined && !isBundledStoreType(type) && rowsOfName.length > 0;

    if (!existing && !restoresBinding) {
      throw new Error(`Metadata ${type}/${name}${member === undefined ? '' : ` (member ${member ?? 'canonical'})`} not found for rollback`);
    }
    if (restoresBinding) {
      // [#32540 C8] Refused before any write: an object the column cannot
      // store, or an object-less binding whose place an unnameable row holds.
      if (typeof member === 'string') refuseUnstorableMember(type, name, member);
      this.refuseUnnameableHolder(type, name, rowsOfName, { packageColumn: rowsOfName[0]!.package_id, column: member });
    }
    // [#32540 C3] A rollback is a write of the slot too: its rows written
    // before their object was named are named first.
    if (member !== undefined && !isBundledStoreType(type)) {
      await this.nameUnnamedRows(type, name, unnamedRowsOf(type, rowsOfName, (row) => this.rowToData(row)));
    }

    const previousChecksum = existing?.checksum as string | undefined;
    // [#32246] A by-package type numbers versions per name (see the class
    // doc); the rollback writes one row slot (picked above).
    const newVersion = slot
      ? await this.nextNameVersion(type, name)
      : ((existing?.version as number) ?? 0) + 1;

    if (existing) {
      await this._update(this.tableName, existing.id as string, {
        metadata: metadataJson,
        version: newVersion,
        checksum: newChecksum,
        updated_at: now,
        state: 'active',
      });
    } else {
      const slotRow = rowsOfName[0]!;
      const packageId = storedRowPackageId(slotRow);
      await this._create(this.tableName, {
        id: generateId(),
        name,
        type,
        namespace: slotRow.namespace ?? 'default',
        scope: (restoredData as any)?.scope ?? slotRow.scope ?? 'platform',
        metadata: metadataJson,
        checksum: newChecksum,
        strategy: 'merge',
        state: 'active',
        version: newVersion,
        source: 'database',
        ...(packageId !== undefined ? { package_id: packageId } : {}),
        bundle_member: member,
        created_at: now,
        updated_at: now,
      });
    }

    this.invalidate(type, name);

    // Write exactly one 'revert' history entry (not an 'update' entry)
    await this.createHistoryRecord(
      type,
      name,
      newVersion,
      restoredData,
      'revert',
      newChecksum,
      previousChecksum,
      changeNote ?? `Rolled back to version ${targetVersion}`,
      recordedBy,
      historySnapshotPackage(slot),
    );
  }

  /**
   * [ADR-0150 D3/D4, #32351] The row slot of `name`, a by-package type, that a
   * rollback to `targetVersion` writes, and that slot's rows and package:
   *  - no row of the name at all: no slot (the caller's "not found"), whatever
   *    is addressed — the miss answers itself, as the exact-qualifier door's;
   *  - `packageId` addressed (a package, or `null` for the environment's
   *    package-less row): that slot, refused (`not-held-by-qualifier`) when it
   *    holds no row of the name;
   *  - none: the name's one slot, several refused naming every holder
   *    (`refuseSeveralSlots`);
   *  - either way, the version's owner — its history row's attribution
   *    ({@link historyRowAttribution}: a package, or the environment), else
   *    the package the restored body names — must be the slot's. Another
   *    owner's version is refused: naming that owner's row when it still
   *    holds one (the version is that owner's), and `not-held-by-qualifier`
   *    naming that owner when it holds none (one since removed, S8a). The
   *    environment's own version of a name one row slot holds lands in that
   *    row, as before (M1): a package took over the package-less row, or
   *    saved after it was removed;
   *  - a version attributed to none (F1: a row written before the column, or
   *    by `SysMetadataRepository`) lands in the slot picked only when the
   *    name has one row slot, as before; with several it is refused naming
   *    every holder (`refuseSeveralSlots`), addressed or not, since nothing
   *    says whose it is.
   */
  private async rollbackSlot(
    type: string,
    name: string,
    targetVersion: number,
    restoredData: unknown,
    packageId: string | null | undefined,
  ): Promise<{ rows: Array<Record<string, unknown>>; packageId?: string } | undefined> {
    const bySlot = await this.rowSlots(type, name);
    if (bySlot.size === 0) return { rows: [] };
    let key: string;
    if (packageId !== undefined) {
      key = storeRowKey(name, packageId);
      if (!bySlot.has(key)) refuseSlotNotHeld(bySlot, type, name, packageId);
    } else {
      refuseSeveralSlots(bySlot, type, name);
      key = bySlot.keys().next().value as string;
    }
    const slotPackage = slotPackageOf(key);
    const recorded = await this.historyVersionAttribution(type, name, targetVersion);
    const versionOwner = recorded !== undefined ? recorded : storedItemPackageId(restoredData);
    if (versionOwner === undefined || (versionOwner === null && bySlot.size === 1)) {
      // Attributed to none, or (M1) the environment's own version of a name
      // one row slot holds — a package took over the package-less row, or it
      // was removed and a package saved since: it lands in that one row, as
      // before. With several row slots it is refused naming every holder.
      refuseSeveralSlots(bySlot, type, name);
    } else if (versionOwner !== (slotPackage ?? null)) {
      if (bySlot.has(storeRowKey(name, versionOwner))) {
        throw new Error(
          `Version ${targetVersion} of ${type}/${name} is ${ownerPhrase(versionOwner)}'s, not ` +
            `${ownerPhrase(slotPackage ?? null)}'s: roll it back addressing ${ownerPhrase(versionOwner)}, whose row it restores.`,
        );
      }
      refuseSlotNotHeld(bySlot, type, name, versionOwner);
    }
    return { rows: bySlot.get(key) ?? [], packageId: slotPackage };
  }

  /**
   * [#32351] Whose version the history row of `(type, name, version)` records
   * ({@link historyRowAttribution}): a package, `null` for the environment;
   * `undefined` when history is not tracked, the row is absent or it is
   * attributed to none.
   */
  private async historyVersionAttribution(type: string, name: string, version: number): Promise<string | null | undefined> {
    if (!this.trackHistory) return undefined;
    await this.ensureHistorySchema();
    const row = await this._findOne(this.historyTableName, { where: { type, name, version } });
    return row ? historyRowAttribution(row) : undefined;
  }

  /**
   * [#32351 F1] Refuses, naming every holder (`refuseSeveralSlots`, `409`), a
   * version of a by-package name that more than one row slot holds when its
   * history row is attributed to none. An addressed read leaves such a
   * version out, so `MetadataManager.rollback` asks here before answering its
   * miss "not found": the version exists, and nothing says whose it is. A
   * name one row slot holds, an absent row and every other type pass.
   */
  async refuseUnattributedVersion(type: string, name: string, version: number): Promise<void> {
    if (!PACKAGE_SLOTTED_STORE_TYPES.has(type) || !this.trackHistory) return;
    await this.ensureHistorySchema();
    const row = await this._findOne(this.historyTableName, { where: { type, name, version } });
    if (!row || historyRowAttribution(row) !== undefined) return;
    await this.ensureSchema();
    refuseSeveralSlots(await this.rowSlots(type, name), type, name);
  }

  /**
   * [ADR-0150 D4, #32246] Where a save of a by-package type lands: the name's
   * rows read as store slots, and the slot the store's write rule picks
   * (`storeRowWriteKey`) — this package's row, or for a package-less body the
   * one holder's row (D4: its customization) or the name's package-less row.
   * A package's first item takes over the name's package-less row when no
   * other package holds the name, as the in-memory store does, so that row is
   * updated and bound rather than left beside it. `rows` are the name's rows,
   * from which {@link nextNameVersion} numbers a write.
   */
  private async slottedSaveTarget(
    type: string,
    name: string,
    data: unknown,
  ): Promise<{
    existing: Record<string, unknown> | null;
    packageId?: string;
    rows: Array<Record<string, unknown>>;
    member?: string | null;
    unnamed?: Array<{ id: string; member: string }>;
  }> {
    const rows = await this._find(this.tableName, { where: this.baseFilter(type, name) });
    const bySlot = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = storeRowKey(name, storedRowPackageId(row));
      if (!bySlot.has(key)) bySlot.set(key, row);
    }
    const { key, replaces } = storeRowWriteKey(bySlot, type, name, data);
    // [#31699 R4-A, #32422; epic ruling 6799056319] A bundled type's slot holds
    // a row per member: the write goes to the row of the member the body
    // declares (the canonical one spelled `null`, `storedBundleMemberOf`), and
    // a member with no row in the slot is inserted — ⛔ never written over
    // another member's row. The slot itself is chosen from every row of the
    // name, as for every by-package type.
    // [#32540, ADR-0150 D4/D6] So does an action's slot: a row per object the
    // package binds the name to, the object-less one spelled `null`
    // (`storedRowMemberOf`) — ⛔ never written over another binding's row.
    const member = storedRowMemberOf(type, data);
    if (member !== undefined) {
      const memberOf = (row: Record<string, unknown>) => storedRowMemberOf(type, this.rowToData(row), row.bundle_member) ?? null;
      const inSlot = (row: Record<string, unknown>, slot: string) => storeRowKey(name, storedRowPackageId(row)) === slot;
      const rowOf = (slot: string) => rows.find((row) => inSlot(row, slot) && memberOf(row) === member);
      const existing = rowOf(key) ?? replaces.map(rowOf).find(Boolean) ?? null;
      // [#32540] A row of the slot written before its member was named
      // (`bundle_member` NULL, a body bound to an object) holds the key of the
      // object-less member until it is named: the write names it first, so
      // the object-less binding's row can never collide with it.
      // A bundled type's row is left as it was (#31699 R3-B reads its member
      // off its body).
      const unnamed = isBundledStoreType(type)
        ? []
        : unnamedRowsOf(type, rows.filter((row) => [key, ...replaces].some((slot) => inSlot(row, slot))), (row) => this.rowToData(row));
      return { existing, packageId: slotPackageOf(key), rows, member: member ?? null, unnamed };
    }
    const existing = bySlot.get(key) ?? replaces.map((replaced) => bySlot.get(replaced)).find(Boolean) ?? null;
    return { existing, packageId: slotPackageOf(key), rows };
  }

  /**
   * [#32246] The rows of `name`, a by-package type, grouped by the store slot
   * each holds the item for ({@link storeRowKey}: its package, else the
   * name's package-less slot).
   */
  private async rowSlots(type: string, name: string): Promise<Map<string, Record<string, unknown>[]>> {
    const bySlot = new Map<string, Record<string, unknown>[]>();
    for (const row of await this._find(this.tableName, { where: this.baseFilter(type, name) })) {
      const key = storeRowKey(name, storedRowPackageId(row));
      bySlot.set(key, [...(bySlot.get(key) ?? []), row]);
    }
    return bySlot;
  }

  /**
   * [#32540 C3] Name the object of each row of an action slot written before
   * the loader named it (`bundle_member` NULL, its body bound to an object):
   * the column only — no body, no version, no history row. Until it is named
   * such a row sits in the object-less binding's bucket of the store's unique
   * key, so it is named before any write of the slot.
   *
   * [#32540 C8] A row bound to an object longer than the column stores cannot
   * be named and is left as it is: ⛔ never refused here, never truncated. It
   * keeps the object-less place, and only a write into that place is refused
   * ({@link refuseUnnameableHolder}); every other write of the slot goes on.
   */
  private async nameUnnamedRows(type: string, name: string, rows: ReadonlyArray<{ id: string; member: string }> | undefined): Promise<void> {
    const nameable = (rows ?? []).filter((row) => row.member.length <= STORED_MEMBER_MAX_LENGTH);
    for (const row of nameable) {
      await this._update(this.tableName, row.id, { bundle_member: row.member });
    }
    if (nameable.length > 0) this.invalidate(type, name);
  }

  /**
   * [#32540 C8] Refuse a write that puts an action row into the object-less
   * place (`bundle_member` NULL) of a package's bucket of the unique key when
   * that place is held by a row the loader cannot name — written before it
   * named objects, bound to an object longer than the column stores — naming
   * that row, its object and the limit. Any other write is not refused.
   */
  private refuseUnnameableHolder(
    type: string,
    name: string,
    rows: ReadonlyArray<Record<string, unknown>>,
    into: { packageColumn: unknown; column: string | null | undefined },
    except?: Record<string, unknown> | null,
  ): void {
    if (into.column !== null) return;
    const bucket = (column: unknown) => (typeof column === 'string' ? column : '');
    for (const row of rows) {
      if (row === except || bucket(row.package_id) !== bucket(into.packageColumn)) continue;
      if (typeof row.bundle_member === 'string' && row.bundle_member !== '') continue;
      const member = storedRowMemberOf(type, this.rowToData(row), row.bundle_member);
      if (typeof member !== 'string' || member.length <= STORED_MEMBER_MAX_LENGTH) continue;
      const where = bucket(into.packageColumn) === '' ? 'with no package' : `of package "${bucket(into.packageColumn)}"`;
      throw new Error(
        `${type} "${name}" ${where} cannot store its object-less binding: row ${String(row.id)}, written before `
          + `sys_metadata.bundle_member named a binding's object, is bound to object "${member}" (${member.length} characters), `
          + `longer than the ${STORED_MEMBER_MAX_LENGTH} the column stores, so it cannot be named and holds the object-less `
          + `binding's place in the store's unique key. Remove that binding's row first.`,
      );
    }
  }

  /**
   * [#32246] The next version of `name`, a by-package type: one past the
   * highest it has had — over every package's row of it and, while history is
   * tracked, over its `sys_metadata_history` rows, which are unique on
   * `(type, name, version)` and outlive a removed package's row. So a package
   * removed and saved again never reuses a version the history holds. An
   * unreadable history leaves the rows' number: the history insert then
   * reports its own failure, the write itself having succeeded.
   */
  private async nextNameVersion(
    type: string,
    name: string,
    rows?: ReadonlyArray<Record<string, unknown>>,
  ): Promise<number> {
    let highest = highestVersion(rows ?? (await this._find(this.tableName, { where: this.baseFilter(type, name) })));
    if (this.trackHistory) {
      try {
        await this.ensureHistorySchema();
        highest = Math.max(highest, highestVersion(await this._find(this.historyTableName, { where: { type, name } })));
      } catch (error) {
        if (!isMissingTableError(error, this.historyTableName)) {
          console.warn(`[Metadata] Could not read \`${this.historyTableName}\` for the next version of ${type}/${name}; numbering from its rows.`, error);
        }
      }
    }
    return highest + 1;
  }

  async save(
    type: string,
    name: string,
    data: any,
    _options?: MetadataSaveOptions
  ): Promise<MetadataSaveResult> {
    const startTime = Date.now();

    await this.ensureSchema();

    const now = new Date().toISOString();
    const metadataJson = JSON.stringify(data);

    try {
      // [#21828] The one stamp vocabulary of `sys_metadata` — see {@link contentHash}.
      const newChecksum = contentHash(metadataJson, type);
      // [ADR-0150 D4, #32246] A by-package type: the row of the slot this
      // write fills, the package that row is bound to, and the name's next
      // version. Every other type: the name's one row, as before.
      const slot = PACKAGE_SLOTTED_STORE_TYPES.has(type) ? await this.slottedSaveTarget(type, name, data) : undefined;
      if (typeof slot?.member === 'string') refuseUnstorableMember(type, name, slot.member);
      const existing = slot
        ? slot.existing
        : await this._findOne(this.tableName, {
            where: this.baseFilter(type, name),
          });
      const binding = slot?.packageId !== undefined && existing?.package_id !== slot.packageId
        ? { package_id: slot.packageId }
        : {};
      // [#32540 C8] Only a write that moves a row into a place an unnameable
      // row holds is refused: an insert, or a re-bind of the row's package.
      if (slot?.unnamed !== undefined && !isBundledStoreType(type) && (!existing || Object.keys(binding).length > 0)) {
        this.refuseUnnameableHolder(type, name, slot.rows, {
          packageColumn: slot.packageId ?? existing?.package_id,
          column: existing ? namedRowColumnOf(type, this.rowToData(existing), existing.bundle_member) : slot.member,
        }, existing);
      }
      await this.nameUnnamedRows(type, name, slot?.unnamed);

      if (existing) {
        // Skip the write when the stored CONTENT is identical (prevents phantom
        // version bumps). [#21828] Content, not stamps: see `storedBodyUnchanged`.
        const previousChecksum = existing.checksum as string | undefined;
        if (storedBodyUnchanged(existing, type, newChecksum) || (slot !== undefined && onlyBoundStampAdded(existing, type, data, slot.packageId))) {
          // No DB write, but make sure the cached payload reflects the latest
          // call (prior cached `null` would otherwise mask a freshly-saved
          // record). [#32246] An unchanged row written before this loader
          // bound rows is bound now — its column only, no new version.
          if (Object.keys(binding).length > 0) {
            await this._update(this.tableName, existing.id as string, binding);
            this.invalidate(type, name);
          } else if (!slot) {
            this.loadCache?.set(this.cacheKey(type, name), data as Record<string, unknown>);
          }
          return {
            success: true,
            path: `datasource://${this.tableName}/${type}/${name}`,
            size: metadataJson.length,
            saveTime: Date.now() - startTime,
          };
        }

        // Update existing record
        const version = slot ? await this.nextNameVersion(type, name, slot.rows) : ((existing.version as number) ?? 0) + 1;

        await this._update(this.tableName, existing.id as string, {
          metadata: metadataJson,
          version,
          checksum: newChecksum,
          updated_at: now,
          state: 'active',
          ...binding,
        });

        this.invalidate(type, name);

        // Create history record for update
        await this.createHistoryRecord(
          type,
          name,
          version,
          data,
          'update',
          newChecksum,
          previousChecksum,
          undefined,
          undefined,
          historySnapshotPackage(slot),
        );

        return {
          success: true,
          path: `datasource://${this.tableName}/${type}/${name}`,
          size: metadataJson.length,
          saveTime: Date.now() - startTime,
        };
      } else {
        // Create new record
        const id = generateId();
        const version = slot ? await this.nextNameVersion(type, name, slot.rows) : 1;
        await this._create(this.tableName, {
          id,
          name,
          type,
          namespace: 'default',
          scope: (data as any)?.scope ?? 'platform',
          metadata: metadataJson,
          checksum: newChecksum,
          strategy: 'merge',
          state: 'active',
          version,
          source: 'database',
          ...binding,
          // [#31699 R4-A] A bundled type's new row names its member, as the
          // store's unique key `(type, name, package_id, bundle_member)` reads it;
          // [#32540] an object-bound action's names its object.
          ...(slot?.member !== undefined ? { bundle_member: slot.member } : {}),
          created_at: now,
          updated_at: now,
        });

        this.invalidate(type, name);

        // Create history record for creation
        await this.createHistoryRecord(
          type,
          name,
          version,
          data,
          'create',
          newChecksum,
          undefined,
          undefined,
          undefined,
          historySnapshotPackage(slot),
        );

        return {
          success: true,
          path: `datasource://${this.tableName}/${type}/${name}`,
          size: metadataJson.length,
          saveTime: Date.now() - startTime,
        };
      }
    } catch (error) {
      throw new Error(
        `DatabaseLoader save failed for ${type}/${name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Delete a metadata item from the database
   *
   * [ADR-0150 D4, #32198] With `options.packageId`, one package's item of a
   * type stored per `(package, name)` is being removed while another package
   * may hold the same name, and only a row that holds THAT package's item is
   * deleted ({@link storedRowPackageId}). A row holding another package's
   * item, or one it cannot attribute to any package, is kept: ⛔ never
   * another package's stored item.
   *
   * [#32246] Such a type keeps a row per `(package, name)`, and a delete takes
   * the rows of the slots the store's removal rule picks (`storeRemovalKeys`):
   * that package's row with `options.packageId`; with none, every row of the
   * name while at most one package holds it, and refused
   * (`PackageScopedNameRefusedError`) when two or more do. [#32560] With
   * `options.packagelessOnly` (and no `packageId`), the name's package-less
   * rows only: the manager judged the removal over every store. Every other
   * type deletes its name's row, as before.
   */
  async delete(type: string, name: string, options?: MetadataLoaderDeleteOptions): Promise<void> {
    await this.ensureSchema();

    if (PACKAGE_SLOTTED_STORE_TYPES.has(type)) {
      const bySlot = await this.rowSlots(type, name);
      const keys = options?.packageId === undefined && options?.packagelessOnly === true
        ? [...bySlot.keys()].filter((key) => slotPackageOf(key) === undefined)
        : storeRemovalKeys(bySlot, type, name, options?.packageId).keys;
      for (const key of keys) {
        for (const row of bySlot.get(key) ?? []) await this._delete(this.tableName, row.id as string);
      }
      if (keys.length > 0) this.invalidate(type, name);
      return;
    }

    // Find the existing record to get its ID
    const existing = await this._findOne(this.tableName, {
      where: this.baseFilter(type, name),
    });

    if (!existing) {
      // Item doesn't exist, nothing to delete
      return;
    }

    if (options?.packageId !== undefined && storedRowPackageId(existing) !== options.packageId) {
      // Another package's item (or none this row can name): not this removal's.
      return;
    }

    // Delete from the main metadata table using the record's ID
    await this._delete(this.tableName, existing.id as string);

    this.invalidate(type, name);
  }
}

/**
 * [ADR-0150 D4, #32198] The package whose item a `sys_metadata` row holds:
 * its `package_id` column when a writer filled it, else the package its stored
 * body carries (`storedItemPackageId`: the envelope's `packageId`, else the
 * registry's `_packageId` stamp). `undefined` when neither names one — a row
 * bound to no package, or a body that does not parse, which a package-scoped
 * delete therefore never takes.
 */
function storedRowPackageId(row: Record<string, unknown>): string | undefined {
  const column = row.package_id;
  if (typeof column === 'string' && column !== '' && column !== 'sys_metadata') return column;
  const stored = row.metadata;
  if (stored === null || stored === undefined) return undefined;
  let body: unknown;
  try {
    body = typeof stored === 'string' ? JSON.parse(stored) : stored;
  } catch {
    return undefined;
  }
  return storedItemPackageId(body);
}

/**
 * [#32540 C3] Of `rows`, an action slot's, each whose `bundle_member` does not
 * yet name the object its body is bound to — a row written before the loader
 * named it — with that object. An object-less row needs no name (NULL).
 */
function unnamedRowsOf(
  type: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  bodyOf: (row: Record<string, unknown>) => unknown,
): Array<{ id: string; member: string }> {
  const unnamed: Array<{ id: string; member: string }> = [];
  for (const row of rows) {
    const member = storedRowMemberOf(type, bodyOf(row), row.bundle_member);
    if (typeof member === 'string' && row.bundle_member !== member) unnamed.push({ id: String(row.id), member });
  }
  return unnamed;
}

/**
 * [#32540 C8] Refuse an action binding whose object name `sys_metadata.bundle_member`
 * cannot hold, naming the action, the object and the limit: ⛔ never truncated
 * (two long object names could then share a row).
 */
function refuseUnstorableMember(type: string, name: string, member: string): void {
  if (member.length <= STORED_MEMBER_MAX_LENGTH) return;
  throw new Error(
    `${type} "${name}" is bound to object "${member}" (${member.length} characters), but sys_metadata.bundle_member `
      + `stores at most ${STORED_MEMBER_MAX_LENGTH}: the binding cannot be stored. Bind it to an object whose name has at most ${STORED_MEMBER_MAX_LENGTH} characters.`,
  );
}

/** [#32246] One row of {@link DatabaseLoader}'s type-wide read. */
interface StoredTypeRow {
  /** The row's `name` column; `null` when it holds no usable string. */
  name: string | null;
  data: Record<string, unknown>;
  /** For a by-package type, the package the row holds its item for. */
  packageId?: string;
  /** For a by-package type, the row's version (the highest is the row saved last). */
  version?: number;
  /**
   * [#31699 R3-B] For a bundled by-package type, the member the row holds (`null`: the canonical one);
   * [#32540] for an action, the object it is bound to (`null`: object-less). Only a bundled type's
   * unscoped read keys on it ({@link unscopedTypeRows}).
   */
  member?: string | null;
  /** [#31699 R7-A] For a by-package type's row whose `package_id` is empty and whose body names `packageId`: its id. */
  legacyRowId?: string;
}

/** [#31699 R3-B] The unscoped read's key of a bundled type's row: its package, name and member. */
function unscopedRowKey(name: string, packageId: string | undefined, member: string | null): string {
  return JSON.stringify([packageId ?? null, name, member]);
}

/** A type-wide row keyed by its name, with its package when it holds one's item. */
function keyedRow<T>(name: string, entry: StoredTypeRow): MetadataKeyedItem<T> {
  return entry.packageId === undefined
    ? { name, data: entry.data as T }
    : { name, data: entry.data as T, packageId: entry.packageId };
}

/** The highest `version` among `rows`; `0` for none. */
function highestVersion(rows: ReadonlyArray<Record<string, unknown>>): number {
  let highest = 0;
  for (const row of rows) {
    const version = Number(row.version);
    if (Number.isFinite(version) && version > highest) highest = version;
  }
  return highest;
}

/**
 * [#21828] The content hash this loader stamps on a `sys_metadata` row and on
 * its history row: `hashSpec(body, type)` from `@objectstack/metadata-core`,
 * the hash `SysMetadataRepository` stamps on the same column. One column, one
 * vocabulary (`sha256:` + 64 hex). ⛔ Not `calculateChecksum`: it sorts every
 * map, an object's `fields` included, and writes bare hex, so a field-reorder-
 * only `register` hashed equal and was never persisted.
 *
 * Hashed AS ITS TYPE (canonicalize guarantee 8): a map the spec declares
 * ordered (an `object`'s `fields`) keeps its key order, so a reorder of it is a
 * change, and every other map stays key-order independent.
 *
 * It hashes the bytes the loader stores (the parse of the JSON it writes), not
 * the in-memory value it was handed. Canonicalize guarantee 7 makes the two one
 * hash for every value JSON can carry. For a value it cannot (a function or an
 * `undefined` property, which the stored JSON drops), the stamp still names
 * the stored bytes, and `hashSpec` is never handed what it refuses.
 */
function contentHash(storedJson: string, type: string): string {
  return hashSpec(JSON.parse(storedJson), type);
}

/**
 * [#21828] Does `row` already store the body whose {@link contentHash} is
 * `hash`? `save`'s no-op question, answered about CONTENT: the stored bytes
 * are re-hashed under the current rule, the comparison
 * `SysMetadataRepository.put` makes for an ordered-map type
 * (`storedBodyUnchanged` there).
 *
 * The stored stamp cannot answer it, because a row's stamp may come from an
 * older rule. Before #21828 this loader stamped `calculateChecksum` (bare hex,
 * every map sorted), and a row `SysMetadataRepository` stamped before #21790
 * carries an order-blind `sha256:` hash. Trusting the stamp misfires both ways:
 *   - an identical body looks changed against a stamp no current hash equals,
 *     so every such row would be rewritten with a version bump and a history
 *     row recording no change, on the first `register` after an upgrade;
 *   - a reorder of an object's `fields` INTO sorted key order looks unchanged
 *     against an order-blind stamp, the drop #21828 fixes.
 * The stamp of a skipped row is left as written: it stays the row's version
 * token until its content next changes.
 *
 * Stored bytes that are absent or do not parse are not the incoming body, so
 * the answer is "changed" and the write goes ahead, which also repairs the row.
 */
function storedBodyUnchanged(row: Record<string, unknown>, type: string, hash: string): boolean {
  const stored = row.metadata;
  if (stored === null || stored === undefined) return false;
  let storedBody: unknown;
  try {
    storedBody = typeof stored === 'string' ? JSON.parse(stored) : stored;
  } catch {
    return false;
  }
  return hashSpec(storedBody, type) === hash;
}

/**
 * [#31699 R4-B] Whether `data` is `row`'s stored body plus nothing but a
 * `_packageId` stamp naming the package `row` is already bound to: the stamp
 * `MetadataManager.loadMany` puts on a body its row binds by the `package_id`
 * column alone. Such a save writes nothing new, so it is no change.
 * [#32458] For every type stored per `(package, name)`: a bundled type's
 * member row, and an unbundled type's (`api`, `agent`, `skill`, `action`,
 * `permission`) one row per slot.
 */
function onlyBoundStampAdded(row: Record<string, unknown>, type: string, data: unknown, packageId: string | undefined): boolean {
  if (packageId === undefined || storedRowPackageId(row) !== packageId) return false;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
  if ((data as Record<string, unknown>)._packageId !== packageId) return false;
  const unstamped: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  delete unstamped._packageId;
  return storedBodyUnchanged(row, type, contentHash(JSON.stringify(unstamped), type));
}

/**
 * Generate a simple unique ID for metadata records.
 * Uses crypto.randomUUID when available, falls back to timestamp-based ID.
 */
function generateId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `meta_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}
