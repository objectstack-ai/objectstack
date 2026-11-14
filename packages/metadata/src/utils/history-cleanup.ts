// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata History Retention and Cleanup
 *
 * Manages automatic cleanup of old history records based on retention policies.
 * Supports both age-based and count-based retention strategies.
 */

import type { IDataDriver } from '@objectstack/spec/contracts';
import type { MetadataHistoryRetentionPolicy } from '@objectstack/spec/system';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import type { DatabaseLoader } from '../loaders/database-loader.js';
import { PACKAGE_SLOTTED_STORE_TYPES } from '../package-slotted-store.js';

/**
 * Types whose runtime transaction rows pin a specific historical body
 * (ADR-0009 `executionPinned`). History rows for these types are
 * **never** garbage-collected — the `getByHash()` resolution path
 * relies on them remaining queryable for the lifetime of any open
 * execution.
 */
function executionPinnedTypes(): string[] {
  return DEFAULT_METADATA_TYPE_REGISTRY
    .filter((entry) => entry.executionPinned)
    .map((entry) => entry.type);
}

/**
 * [ADR-0150 D3/D4] The retention bucket of a history row of a type stored per
 * `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`): its `package_id` column.
 * Two packages (and the environment) each keep their own row of one name, and
 * their snapshots share ONE `(type, name, version)` sequence, so a count kept
 * per `(type, name)` let one package's saves evict another package's rollback
 * targets. Each value of the column is its own bucket: a package, the
 * environment's `sys_metadata` marker, and NULL — a row attributed to nobody
 * (written before the column existed, or by `SysMetadataRepository`) — which
 * is one bucket of its own, never folded into a package's.
 */
function retentionBucketOf(row: Record<string, unknown>): string | null {
  return typeof row.package_id === 'string' ? row.package_id : null;
}

/**
 * The rows past the retention limit of one `(type, name)`, given its rows
 * newest version first. A type stored per `(package, name)` keeps the latest
 * `maxVersions` per {@link retentionBucketOf}; every other type keeps the
 * latest `maxVersions` of the name, as it always has. Both walks —
 * `runCleanup()`'s delete and `getCleanupStats()`'s preview — count through
 * here, so the preview cannot drift from what the delete removes.
 */
function rowsPastRetention(
  type: string,
  newestFirst: Array<Record<string, unknown>>,
  maxVersions: number,
): Array<Record<string, unknown>> {
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return newestFirst.slice(maxVersions);
  const buckets = new Map<string | null, Array<Record<string, unknown>>>();
  for (const row of newestFirst) {
    const bucket = retentionBucketOf(row);
    const rows = buckets.get(bucket);
    if (rows) rows.push(row);
    else buckets.set(bucket, [row]);
  }
  return [...buckets.values()].flatMap((rows) => rows.slice(maxVersions));
}

/**
 * History Cleanup Manager
 *
 * Handles automatic cleanup of metadata history records based on
 * configured retention policies.
 */
export class HistoryCleanupManager {
  private policy: MetadataHistoryRetentionPolicy;
  private dbLoader: DatabaseLoader;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(policy: MetadataHistoryRetentionPolicy, dbLoader: DatabaseLoader) {
    this.policy = policy;
    this.dbLoader = dbLoader;
  }

  /**
   * Start automatic cleanup if enabled in the policy.
   */
  start(): void {
    if (!this.policy.autoCleanup) {
      return;
    }

    const intervalMs = (this.policy.cleanupIntervalHours ?? 24) * 60 * 60 * 1000;

    // Run cleanup immediately on start. Both call sites go through
    // `runCleanupAndReport()`, never `runCleanup()` — see its docblock.
    void runCleanupAndReport(this);

    // Schedule periodic cleanup
    this.cleanupTimer = setInterval(() => {
      void runCleanupAndReport(this);
    }, intervalMs);
  }

  /**
   * Stop automatic cleanup.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Run cleanup based on the retention policy.
   * Removes history records that exceed the configured limits.
   */
  async runCleanup(): Promise<{ deleted: number; errors: number }> {
    const driver = (this.dbLoader as any).driver as IDataDriver;
    const historyTableName = (this.dbLoader as any).historyTableName as string;
    // Neither `environmentId` (ADR-0008 §0 amendment) nor `organization_id`
    // (ADR-0131 D6/D7: the family declares no organization column) scopes
    // cleanup: every history row is the environment's.

    let deleted = 0;
    let errors = 0;

    // ADR-0009: collect executionPinned types — these are GC-exempt.
    const pinnedTypes = executionPinnedTypes();
    const isPinned = (t: string | undefined): boolean =>
      !!t && pinnedTypes.includes(t);

    try {
      // Age-based cleanup
      if (this.policy.maxAgeDays) {
        const cutoffDate = new Date();
        cutoffDate.setUTCDate(cutoffDate.getUTCDate() - this.policy.maxAgeDays);
        const cutoffISO = cutoffDate.toISOString();

        const filter: Record<string, unknown> = {
          recorded_at: { $lt: cutoffISO },
        };

        if (pinnedTypes.length > 0) {
          // Exclude executionPinned rows from bulk age delete.
          filter.type = { $nin: pinnedTypes };
        }

        try {
          const result = await this.bulkDeleteByFilter(driver, historyTableName, filter);
          deleted += result.deleted;
          errors += result.errors;
        } catch {
          errors++;
        }
      }

      // Count-based cleanup per metadata item: the latest N per (type, name),
      // or per (type, name, package_id) for a by-package type
      // (`rowsPastRetention`).
      if (this.policy.maxVersions) {
        try {
          // Get all unique metadata items keyed by (type, name)
          const baseWhere: Record<string, unknown> = {};

          const metaItems = await driver.find(historyTableName, {
            where: baseWhere,
            fields: ['type', 'name'],
          });

          const uniqueKeys = new Set<string>();
          for (const record of metaItems) {
            const t = record.type as string | undefined;
            const n = record.name as string | undefined;
            if (t && n && !isPinned(t)) {
              uniqueKeys.add(`${t}\x1f${n}`);
            }
          }

          // For each metadata item, keep only the latest N versions
          for (const key of uniqueKeys) {
            const [type, name] = key.split('\x1f');
            const filter: Record<string, unknown> = { type, name, ...baseWhere };

            try {
              // Fetch only the IDs of records beyond the retention limit (oldest first)
              const historyRecords = await driver.find(historyTableName, {
                where: filter,
                orderBy: [{ field: 'version', order: 'desc' as const }],
                fields: PACKAGE_SLOTTED_STORE_TYPES.has(type) ? ['id', 'package_id'] : ['id'],
              });

              if (historyRecords.length > this.policy.maxVersions) {
                const toDelete = rowsPastRetention(type, historyRecords, this.policy.maxVersions);
                const ids = toDelete.map(r => r.id as string).filter(Boolean);
                const result = await this.bulkDeleteByIds(driver, historyTableName, ids);
                deleted += result.deleted;
                errors += result.errors;
              }
            } catch {
              errors++;
            }
          }
        } catch {
          errors++;
        }
      }
    } catch (error) {
      console.error('History cleanup failed:', error);
      errors++;
    }

    return { deleted, errors };
  }

  /**
   * Delete records matching a filter using the most efficient method available on the driver.
   */
  private async bulkDeleteByFilter(
    driver: IDataDriver,
    table: string,
    filter: Record<string, unknown>
  ): Promise<{ deleted: number; errors: number }> {
    const driverAny = driver as any;
    if (typeof driverAny.deleteMany === 'function') {
      const count = await driverAny.deleteMany(table, filter);
      return { deleted: typeof count === 'number' ? count : 0, errors: 0 };
    }

    // Fallback: fetch IDs then delete
    const records = await driver.find(table, { where: filter, fields: ['id'] });
    const ids = records.map((r: Record<string, unknown>) => r.id as string).filter(Boolean);
    return this.bulkDeleteByIds(driver, table, ids);
  }

  /**
   * Delete records by IDs using bulkDelete when available, otherwise one-by-one.
   */
  private async bulkDeleteByIds(
    driver: IDataDriver,
    table: string,
    ids: string[]
  ): Promise<{ deleted: number; errors: number }> {
    if (ids.length === 0) return { deleted: 0, errors: 0 };

    const driverAny = driver as any;
    if (typeof driverAny.bulkDelete === 'function') {
      const result = await driverAny.bulkDelete(table, ids);
      return {
        deleted: typeof result === 'number' ? result : ids.length,
        errors: 0,
      };
    }

    // Fallback: sequential deletes
    let deleted = 0;
    let errors = 0;
    for (const id of ids) {
      try {
        await driver.delete(table, id);
        deleted++;
      } catch {
        errors++;
      }
    }
    return { deleted, errors };
  }

  /**
   * Get cleanup statistics without actually deleting anything.
   * Useful for previewing what would be cleaned up.
   */
  async getCleanupStats(): Promise<{
    recordsByAge: number;
    recordsByCount: number;
    total: number;
  }> {
    const driver = (this.dbLoader as any).driver as IDataDriver;
    const historyTableName = (this.dbLoader as any).historyTableName as string;

    let recordsByAge = 0;
    let recordsByCount = 0;

    // ADR-0009: executionPinned types are excluded from GC.
    const pinnedTypes = executionPinnedTypes();
    const isPinned = (t: string | undefined): boolean =>
      !!t && pinnedTypes.includes(t);

    try {
      const baseWhere: Record<string, unknown> = {};

      // Count records that would be deleted by age
      if (this.policy.maxAgeDays) {
        const cutoffDate = new Date();
        cutoffDate.setUTCDate(cutoffDate.getUTCDate() - this.policy.maxAgeDays);
        const cutoffISO = cutoffDate.toISOString();

        const filter: Record<string, unknown> = {
          recorded_at: { $lt: cutoffISO },
          ...baseWhere,
        };
        if (pinnedTypes.length > 0) {
          filter.type = { $nin: pinnedTypes };
        }

        recordsByAge = await driver.count(historyTableName, {
          where: filter,
        });
      }

      // Count records that would be deleted by version limit
      if (this.policy.maxVersions) {
        const metaItems = await driver.find(historyTableName, {
          where: baseWhere,
          fields: ['type', 'name'],
        });

        const uniqueKeys = new Set<string>();
        for (const record of metaItems) {
          const t = record.type as string | undefined;
          const n = record.name as string | undefined;
          if (t && n && !isPinned(t)) {
            uniqueKeys.add(`${t}\x1f${n}`);
          }
        }

        for (const key of uniqueKeys) {
          const [type, name] = key.split('\x1f');
          const filter: Record<string, unknown> = { type, name, ...baseWhere };

          if (PACKAGE_SLOTTED_STORE_TYPES.has(type)) {
            // Counted per bucket, as `runCleanup()` deletes (`rowsPastRetention`).
            const rows = await driver.find(historyTableName, {
              where: filter,
              orderBy: [{ field: 'version', order: 'desc' as const }],
              fields: ['package_id'],
            });
            recordsByCount += rowsPastRetention(type, rows, this.policy.maxVersions).length;
            continue;
          }

          const count = await driver.count(historyTableName, {
            where: filter,
          });

          if (count > this.policy.maxVersions) {
            recordsByCount += count - this.policy.maxVersions;
          }
        }
      }
    } catch (error) {
      console.error('Failed to get cleanup stats:', error);
    }

    // Return separate counts. The total is an upper-bound estimate: it may overcount
    // records that qualify under both policies (age and count). Use recordsByAge and
    // recordsByCount individually for precise breakdowns.
    return {
      recordsByAge,
      recordsByCount,
      total: recordsByAge + recordsByCount,
    };
  }
}

/**
 * Run one cleanup pass for {@link HistoryCleanupManager.start} and report a
 * run that lost deletes.
 *
 * `runCleanup()` reports its failures to the CALLER, in the `errors` field of
 * the `{ deleted, errors }` envelope it returns. That is the third answer
 * AGENTS.md → "Degradation log levels" allows a durability seam, and it is why
 * that method's inner `catch` clauses are deliberately silent: the same
 * section names a log per failed write as the mirror-image failure, and asks
 * for one report, at the first degradation, naming the consequence and the
 * fix.
 *
 * A failure handed to the caller is only reported while somebody READS it, and
 * `start()` is where that chain ends — it returns `void`, and the interval tick
 * has no caller at all. Both call sites used to spell the run
 * `void this.runCleanup()`, so a driver whose deletes failed produced no output
 * and no reachable count: the history table grew past its retention policy and
 * nothing said so.
 *
 * So the envelope is read HERE, once per run. Restoring
 * `void this.runCleanup()` at EITHER call site re-opens the defect for that
 * trigger alone — a startup-only report leaves every scheduled run silent —
 * which is why the pin asserts the immediate run and an interval tick
 * separately.
 *
 * Module-level, and NOT a private method, on purpose: TypeScript emits
 * `private` members into the published `dist/*.d.ts` and they join the class's
 * nominal identity, so a private method would have made an observability
 * repair move the published declaration. As a free function it changes none of
 * it — measured, all 10 published declaration files byte-identical.
 *
 * Resolves rather than rejects on every path, so `void` at the call sites
 * cannot turn a cleanup failure into an unhandled rejection.
 */
async function runCleanupAndReport(manager: HistoryCleanupManager): Promise<void> {
  let outcome: { deleted: number; errors: number };

  try {
    outcome = await manager.runCleanup();
  } catch (error) {
    console.error(
      'History cleanup: the run did not complete, so no history row past the retention '
      + 'policy was deleted and the table keeps growing while the system reports healthy. '
      + 'Fix: the cause below comes from the configured data driver, not from the retention '
      + 'policy; call `runCleanup()` directly to reproduce it. Cause:',
      error,
    );
    return;
  }

  if (outcome.errors > 0) {
    console.error(
      `History cleanup: ${outcome.errors} delete operation(s) failed and `
      + `${outcome.deleted} row(s) were deleted. The history rows those deletes were meant `
      + 'to remove are still in the table, nothing retries them, and the table grows past '
      + 'the retention policy while the system keeps reporting healthy. Fix: check the data '
      + 'driver delete path for the metadata history table. The per-failure causes are not '
      + 'carried out of `runCleanup()`, so reproduce them against the driver directly.',
    );
  }
}
