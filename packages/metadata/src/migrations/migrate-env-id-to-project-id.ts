// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Migration: env_id → project_id
 *
 * Renames the `env_id` column to `project_id` on the metadata storage tables:
 *   - sys_metadata
 *   - sys_metadata_history
 *
 * (The per-type projection tables `sys_object` / `sys_view` / `sys_flow` /
 * `sys_agent` / `sys_tool` were removed in 2026-05 along with the projection
 * pipeline — see ADR 0005 addendum. They are intentionally not included.)
 *
 * Safe to run multiple times (idempotent): checks for column existence before
 * attempting to rename. If `project_id` already exists, the step is skipped.
 *
 * Usage:
 *   import { migrateEnvIdToProjectId } from '@objectstack/metadata/migrations';
 *   await migrateEnvIdToProjectId(driver);
 */

import type { IDataDriver } from '@objectstack/spec/contracts';

const AFFECTED_TABLES = [
    'sys_metadata',
    'sys_metadata_history',
] as const;

export interface MigrationResult {
    table: string;
    status: 'renamed' | 'already_done' | 'table_missing' | 'error';
    error?: string;
}

/**
 * Rename `env_id` → `project_id` on all metadata tables.
 *
 * @param driver  An IDataDriver with access to the target database.
 *                Must expose a raw query method: `driver.raw(sql, bindings?)`.
 * @returns       Per-table migration results.
 */
export async function migrateEnvIdToProjectId(driver: IDataDriver): Promise<MigrationResult[]> {
    const driverAny = driver as any;

    if (typeof driverAny.raw !== 'function') {
        throw new Error(
            'migrateEnvIdToProjectId: driver must expose a .raw(sql, bindings?) method. ' +
            'SqlDriver (better-sqlite3/knex) and TursoDriver both support this.'
        );
    }

    const results: MigrationResult[] = [];

    for (const table of AFFECTED_TABLES) {
        try {
            // Detect dialect: SQLite uses PRAGMA, others use information_schema.
            const hasColumn = await _columnExists(driverAny, table, 'env_id');
            const alreadyMigrated = await _columnExists(driverAny, table, 'project_id');

            if (alreadyMigrated && !hasColumn) {
                results.push({ table, status: 'already_done' });
                continue;
            }

            if (!hasColumn) {
                // Neither column exists — table might not exist yet.
                results.push({ table, status: 'table_missing' });
                continue;
            }

            // Perform the rename.  SQLite ≥ 3.25.0 supports ALTER TABLE RENAME COLUMN.
            await driverAny.raw(`ALTER TABLE "${table}" RENAME COLUMN env_id TO project_id`);

            results.push({ table, status: 'renamed' });
        } catch (err: any) {
            results.push({ table, status: 'error', error: err?.message ?? String(err) });
        }
    }

    return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _columnExists(driver: any, table: string, column: string): Promise<boolean> {
    try {
        // SQLite: PRAGMA table_info returns rows with `name` column.
        const rows: any[] = await driver.raw(`PRAGMA table_info("${table}")`);
        if (Array.isArray(rows) && rows.length > 0) {
            // knex wraps PRAGMA result; handle both `rows` and `rows[0]` shapes.
            const list: any[] = Array.isArray(rows[0]) ? rows[0] : rows;
            return list.some((r: any) => r?.name === column);
        }

        // Fallback for non-SQLite: query information_schema.
        const result: any[] = await driver.raw(
            `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
            [table, column]
        );
        const list: any[] = Array.isArray(result[0]) ? result[0] : result;
        return list.length > 0;
    } catch {
        return false;
    }
}
