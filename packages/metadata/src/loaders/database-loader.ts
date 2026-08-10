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
import { SysMetadataObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { applyConversionsToStoredItem } from '@objectstack/spec';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import type { IDataDriver, IDataEngine, DriverQuery } from '@objectstack/spec/contracts';
import type { MetadataLoader } from './loader-interface.js';
import { calculateChecksum } from '../utils/metadata-history-utils.js';
import { LRUCache } from '../utils/lru-cache.js';
import { isMissingTableError, isSchemaAlreadyExistsError } from '../utils/schema-sync-errors.js';
import { migrateProjectIdToEnvironmentId } from '../migrations/migrate-project-id-to-environment-id.js';

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
  /** TTL in milliseconds. Set to `0` to disable expiry. Default: `60_000`. */
  ttl?: number;
}

/**
 * Configuration for the DatabaseLoader.
 *
 * Accepts either a raw `IDataDriver` or an `IDataEngine` (ObjectQL).
 * When `engine` is provided, all CRUD operations route through the engine
 * which handles datasource mapping automatically — no manual driver
 * resolution needed. Schema sync is also skipped (the engine handles it).
 */
export interface DatabaseLoaderOptions {
  /** The IDataDriver instance to use for database operations */
  driver?: IDataDriver;

  /** The IDataEngine (ObjectQL) instance — preferred over raw driver */
  engine?: IDataEngine;

  /** The table name to store metadata records (default: 'sys_metadata') */
  tableName?: string;

  /** The table name to store history records (default: 'sys_metadata_history') */
  historyTableName?: string;

  /** Organization ID for multi-tenant isolation */
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
  private organizationId?: string;
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

  constructor(options: DatabaseLoaderOptions) {
    if (!options.driver && !options.engine) {
      throw new Error('DatabaseLoader requires either a driver or engine');
    }
    this.driver = options.driver;
    this.engine = options.engine;
    this.tableName = options.tableName ?? 'sys_metadata';
    this.historyTableName = options.historyTableName ?? 'sys_metadata_history';
    this.organizationId = options.organizationId;
    // ADR-0008 §0: `environmentId` option is accepted for back-compat but ignored.
    void options.environmentId;
    this.trackHistory = options.trackHistory !== false; // Default to true

    // Wire cache. Default: enabled with 500 entries / 60s TTL.
    const cacheOpts = options.cache;
    const cacheEnabled = cacheOpts?.enabled !== false;
    if (cacheEnabled) {
      const lruOpts = {
        maxSize: cacheOpts?.maxSize ?? 500,
        ttl: cacheOpts?.ttl ?? 60_000,
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

  // NOTE (#6231): the DRIVER branch below takes `query` unchanged and uncast —
  // `DriverQuery` is `Omit<QueryAST, 'object'>`, so the object name travels as
  // argument one only. The ENGINE branch still carries `as any`, and that cast
  // is NOT vestigial: `EngineQueryOptionsSchema.search` admits only the
  // structured `FullTextSearchSchema`, while `QueryAST.search` (hence
  // `DriverQuery`) also admits the bare query string that ADR-0061 D1 calls the
  // canonical Tier-1 spelling and that the engine actually serves. Until those
  // two schemas agree, `DriverQuery` is not assignable to
  // `EngineQueryOptionsParsed`. Tracked as #7178; do not "fix" it here by
  // narrowing the cast.

  private async _find(table: string, query: DriverQuery): Promise<Record<string, unknown>[]> {
    if (this.engine) {
      return this.engine.find(table, query as any);
    }
    return this.driver!.find(table, query);
  }

  private async _findOne(table: string, query: DriverQuery): Promise<Record<string, unknown> | null> {
    if (this.engine) {
      return this.engine.findOne(table, query as any);
    }
    return this.driver!.findOne(table, query);
  }

  private async _count(table: string, query: DriverQuery): Promise<number> {
    if (this.engine) {
      return this.engine.count(table, query as any);
    }
    return this.driver!.count(table, query);
  }

  private async _create(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.engine) {
      return this.engine.insert(table, data);
    }
    return this.driver!.create(table, data);
  }

  private async _update(table: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.engine) {
      return this.engine.update(table, { id, ...data });
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
   * Compute the next per-org `event_seq` for `sys_metadata_history`.
   * Reads `MAX(event_seq) + 1` for the configured `organization_id`.
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
    const where: Record<string, unknown> = this.organizationId
      ? { organization_id: this.organizationId }
      : {};
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
      if (isMissingTableError(error)) return 1;
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
   * Filters by organizationId when configured. `environmentId` is accepted
   * for back-compat but no longer constrains the query — see
   * ADR-0008 §0 (branch/project removal).
   */
  private baseFilter(type: string, name?: string): Record<string, unknown> {
    const filter: Record<string, unknown> = { type };
    if (name !== undefined) {
      filter.name = name;
    }
    if (this.organizationId) {
      filter.organization_id = this.organizationId;
    }
    return filter;
  }

  /**
   * Create a history record for a metadata change.
   *
   * @param type - Metadata type
   * @param name - Metadata name
   * @param version - Version number
   * @param metadata - The metadata payload
   * @param operationType - Type of operation
   * @param previousChecksum - Checksum of previous version (if any)
   * @param changeNote - Optional change description
   * @param recordedBy - Optional user who made the change
   */
  private async createHistoryRecord(
    type: string,
    name: string,
    version: number,
    metadata: unknown,
    operationType: 'create' | 'update' | 'publish' | 'revert' | 'delete',
    previousChecksum?: string,
    changeNote?: string,
    recordedBy?: string
  ): Promise<void> {
    if (!this.trackHistory) return;

    await this.ensureHistorySchema();

    const now = new Date().toISOString();
    const checksum = await calculateChecksum(metadata);

    // Skip if checksum matches previous version (no actual change)
    if (previousChecksum && checksum === previousChecksum && operationType === 'update') {
      return;
    }

    const historyId = generateId();
    const metadataJson = JSON.stringify(metadata);

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
            `deliberately — numbering it from 1 (what this code did before #4825) would collide with existing rows and ` +
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
      ...(this.organizationId ? { organizationId: this.organizationId } : {}),
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
        ...(this.organizationId ? { organization_id: this.organizationId } : {}),
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
      organizationId: row.organization_id as string | undefined,
      environmentId: row.environment_id as string | undefined,
      version: (row.version as number) ?? 1,
      checksum: row.checksum as string | undefined,
      source: row.source as MetadataRecord['source'],
      tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags as string) : row.tags as string[]) : undefined,
      createdBy: row.created_by as string | undefined,
      createdAt: row.created_at as string | undefined,
      updatedBy: row.updated_by as string | undefined,
      updatedAt: row.updated_at as string | undefined,
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
    if (isMissingTableError(error)) return;
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
      const row = await this._findOne(this.tableName, {
        where: this.baseFilter(type, name),
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

  async loadMany<T = any>(
    type: string,
    _options?: MetadataLoadOptions
  ): Promise<T[]> {
    await this.ensureSchema();

    if (this.loadManyCache) {
      const cached = this.loadManyCache.get(type);
      if (cached !== undefined) return cached as T[];
    }

    try {
      const rows = await this._find(this.tableName, {
        where: this.baseFilter(type),
      });

      const result = rows
        .map(row => this.rowToData(row))
        .filter((data): data is Record<string, unknown> => data !== null) as T[];

      this.loadManyCache?.set(type, result);
      return result;
    } catch (error) {
      this.rethrowUnlessTableUnprovisioned(error);
      // Benign only: no table, therefore no items of this type. Not cached.
      return [];
    }
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
        mtime: record.updatedAt ?? record.createdAt ?? new Date().toISOString(),
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

      this.listCache?.set(type, names);
      return names;
    } catch (error) {
      this.rethrowUnlessTableUnprovisioned(error);
      // Benign only: no table, therefore no names. Not cached.
      return [];
    }
  }

  /**
   * Fetch a single history snapshot by (type, name, version).
   * Returns null when the record does not exist.
   */
  async getHistoryRecord(
    type: string,
    name: string,
    version: number
  ): Promise<MetadataHistoryRecord | null> {
    if (!this.trackHistory) return null;

    await this.ensureHistorySchema();

    const filter: Record<string, unknown> = {
      type,
      name,
      version,
    };
    if (this.organizationId) {
      filter.organization_id = this.organizationId;
    }

    const row = await this._findOne(this.historyTableName, {
      where: filter,
    });
    if (!row) return null;

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
      organizationId: row.organization_id as string | undefined,
      recordedBy: row.recorded_by as string | undefined,
      recordedAt: row.recorded_at as string,
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
    }
  ): Promise<{ records: any[]; total: number; hasMore: boolean }> {
    if (!this.trackHistory) {
      return { records: [], total: 0, hasMore: false };
    }

    await this.ensureSchema();
    await this.ensureHistorySchema();

    // Build history query directly against (type, name); no parent
    // lookup needed since the history table is keyed by these fields.
    const historyFilter: Record<string, unknown> = {
      type,
      name,
    };
    if (this.organizationId) historyFilter.organization_id = this.organizationId;
    if (options?.operationType) historyFilter.operation_type = options.operationType;
    if (options?.since) historyFilter.recorded_at = { $gte: options.since };
    if (options?.until) {
      if (historyFilter.recorded_at) {
        (historyFilter.recorded_at as Record<string, unknown>).$lte = options.until;
      } else {
        historyFilter.recorded_at = { $lte: options.until };
      }
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const historyRecords = await this._find(this.historyTableName, {
      where: historyFilter,
      orderBy: [
        { field: 'recorded_at', order: 'desc' as const },
        { field: 'version', order: 'desc' as const },
      ],
      limit: limit + 1,
      offset,
    });

    const hasMore = historyRecords.length > limit;
    const records = historyRecords.slice(0, limit);
    const total = await this._count(this.historyTableName, { where: historyFilter });

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
        organizationId: row.organization_id as string | undefined,
        recordedBy: row.recorded_by as string | undefined,
        recordedAt: row.recorded_at as string,
      };
    });

    return { records: result, total, hasMore };
  }

  /**
   * Perform a rollback: persist `restoredData` as the new current state and record a
   * single 'revert' history entry (instead of the usual 'update' entry that `save()`
   * would produce). This avoids the duplicate-version problem that arises when
   * `register()` → `save()` writes an 'update' entry followed by an additional
   * 'revert' entry for the same version number.
   */
  async registerRollback(
    type: string,
    name: string,
    restoredData: unknown,
    targetVersion: number,
    changeNote?: string,
    recordedBy?: string
  ): Promise<void> {
    await this.ensureSchema();

    const now = new Date().toISOString();
    const metadataJson = JSON.stringify(restoredData);
    const newChecksum = await calculateChecksum(restoredData);

    const existing = await this._findOne(this.tableName, {
      where: this.baseFilter(type, name),
    });

    if (!existing) {
      throw new Error(`Metadata ${type}/${name} not found for rollback`);
    }

    const previousChecksum = existing.checksum as string | undefined;
    const newVersion = ((existing.version as number) ?? 0) + 1;

    await this._update(this.tableName, existing.id as string, {
      metadata: metadataJson,
      version: newVersion,
      checksum: newChecksum,
      updated_at: now,
      state: 'active',
    });

    this.invalidate(type, name);

    // Write exactly one 'revert' history entry (not an 'update' entry)
    await this.createHistoryRecord(
      type,
      name,
      newVersion,
      restoredData,
      'revert',
      previousChecksum,
      changeNote ?? `Rolled back to version ${targetVersion}`,
      recordedBy
    );
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
    const newChecksum = await calculateChecksum(data);

    try {
      const existing = await this._findOne(this.tableName, {
        where: this.baseFilter(type, name),
      });

      if (existing) {
        // Skip update if the content is identical (prevents phantom version bumps)
        const previousChecksum = existing.checksum as string | undefined;
        if (newChecksum === previousChecksum) {
          // No DB write, but make sure the cached payload reflects the latest
          // call (prior cached `null` would otherwise mask a freshly-saved
          // record).
          this.loadCache?.set(this.cacheKey(type, name), data as Record<string, unknown>);
          return {
            success: true,
            path: `datasource://${this.tableName}/${type}/${name}`,
            size: metadataJson.length,
            saveTime: Date.now() - startTime,
          };
        }

        // Update existing record
        const version = ((existing.version as number) ?? 0) + 1;

        await this._update(this.tableName, existing.id as string, {
          metadata: metadataJson,
          version,
          checksum: newChecksum,
          updated_at: now,
          state: 'active',
        });

        this.invalidate(type, name);

        // Create history record for update
        await this.createHistoryRecord(
          type,
          name,
          version,
          data,
          'update',
          previousChecksum
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
          version: 1,
          source: 'database',
          ...(this.organizationId ? { organization_id: this.organizationId } : {}),
          created_at: now,
          updated_at: now,
        });

        this.invalidate(type, name);

        // Create history record for creation
        await this.createHistoryRecord(
          type,
          name,
          1,
          data,
          'create'
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
   */
  async delete(type: string, name: string): Promise<void> {
    await this.ensureSchema();

    // Find the existing record to get its ID
    const existing = await this._findOne(this.tableName, {
      where: this.baseFilter(type, name),
    });

    if (!existing) {
      // Item doesn't exist, nothing to delete
      return;
    }

    // Delete from the main metadata table using the record's ID
    await this._delete(this.tableName, existing.id as string);

    this.invalidate(type, name);
  }
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
