// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata History Retention and Cleanup
 *
 * Manages automatic cleanup of old history records based on retention policies.
 * Supports both age-based and count-based retention strategies.
 */

import type { IDataDriver } from '@objectstack/spec/contracts';
import type { MetadataHistoryRetentionPolicy } from '@objectstack/spec/system';
import type { DatabaseLoader } from '../loaders/database-loader.js';

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

    // Run cleanup immediately on start
    void this.runCleanup();

    // Schedule periodic cleanup
    this.cleanupTimer = setInterval(() => {
      void this.runCleanup();
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
    const organizationId = (this.dbLoader as any).organizationId as string | undefined;
    // `projectId` was removed from the metadata layer (ADR-0008 §0
    // amendment). Cleanup is now scoped by `organization_id` only.

    let deleted = 0;
    let errors = 0;

    try {
      // Age-based cleanup
      if (this.policy.maxAgeDays) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.policy.maxAgeDays);
        const cutoffISO = cutoffDate.toISOString();

        const filter: Record<string, unknown> = {
          recorded_at: { $lt: cutoffISO },
        };

        if (organizationId) {
          filter.organization_id = organizationId;
        }

        try {
          const result = await this.bulkDeleteByFilter(driver, historyTableName, filter);
          deleted += result.deleted;
          errors += result.errors;
        } catch {
          errors++;
        }
      }

      // Count-based cleanup per metadata item
      if (this.policy.maxVersions) {
        try {
          // Get all unique metadata items keyed by (type, name)
          const baseWhere: Record<string, unknown> = {};
          if (organizationId) baseWhere.organization_id = organizationId;

          const metaItems = await driver.find(historyTableName, {
            object: historyTableName,
            where: baseWhere,
            fields: ['type', 'name'],
          });

          const uniqueKeys = new Set<string>();
          for (const record of metaItems) {
            const t = record.type as string | undefined;
            const n = record.name as string | undefined;
            if (t && n) {
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
                object: historyTableName,
                where: filter,
                orderBy: [{ field: 'version', order: 'desc' as const }],
                fields: ['id'],
              });

              if (historyRecords.length > this.policy.maxVersions) {
                const toDelete = historyRecords.slice(this.policy.maxVersions);
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
    const records = await driver.find(table, { object: table, where: filter, fields: ['id'] });
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
    const organizationId = (this.dbLoader as any).organizationId as string | undefined;

    let recordsByAge = 0;
    let recordsByCount = 0;

    try {
      const baseWhere: Record<string, unknown> = {};
      if (organizationId) baseWhere.organization_id = organizationId;

      // Count records that would be deleted by age
      if (this.policy.maxAgeDays) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.policy.maxAgeDays);
        const cutoffISO = cutoffDate.toISOString();

        const filter: Record<string, unknown> = {
          recorded_at: { $lt: cutoffISO },
          ...baseWhere,
        };

        recordsByAge = await driver.count(historyTableName, {
          object: historyTableName,
          where: filter,
        });
      }

      // Count records that would be deleted by version limit
      if (this.policy.maxVersions) {
        const metaItems = await driver.find(historyTableName, {
          object: historyTableName,
          where: baseWhere,
          fields: ['type', 'name'],
        });

        const uniqueKeys = new Set<string>();
        for (const record of metaItems) {
          const t = record.type as string | undefined;
          const n = record.name as string | undefined;
          if (t && n) {
            uniqueKeys.add(`${t}\x1f${n}`);
          }
        }

        for (const key of uniqueKeys) {
          const [type, name] = key.split('\x1f');
          const filter: Record<string, unknown> = { type, name, ...baseWhere };

          const count = await driver.count(historyTableName, {
            object: historyTableName,
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
