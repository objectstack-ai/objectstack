// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Migration: drop deprecated metadata projection tables.
 *
 * In 2026-05 the per-type projection tables (`sys_object` / `sys_view` /
 * `sys_flow` / `sys_agent` / `sys_tool`) and the corresponding
 * `MetadataProjector` were removed (see ADR 0005 addendum). All metadata
 * now lives as JSON inside `sys_metadata` — these projection tables are
 * dead weight on any existing database.
 *
 * This migration drops them if present. It is idempotent and safe to run
 * on databases that never had them (the `DROP TABLE IF EXISTS` is a no-op).
 *
 * Usage:
 *   import { dropProjectionTables } from '@objectstack/metadata/migrations';
 *   await dropProjectionTables(driver);
 */

import type { IDataDriver } from '@objectstack/spec/contracts';

import { driverExecRefusal, resolveDriverExec } from './driver-exec.js';

const DEPRECATED_TABLES = [
    'sys_object',
    'sys_view',
    'sys_flow',
    'sys_agent',
    'sys_tool',
] as const;

export interface DropProjectionResult {
    table: string;
    status: 'dropped' | 'not_present' | 'error';
    error?: string;
}

/**
 * Drop the deprecated per-type metadata projection tables.
 *
 * @param driver  An `IDataDriver`. Raw SQL is issued through the surface
 *                `IDataDriver` declares — `execute(sql, bindings?)` — falling
 *                back to `raw(sql, bindings?)`; see `./driver-exec.ts`.
 * @returns       Per-table results.
 */
export async function dropProjectionTables(driver: IDataDriver): Promise<DropProjectionResult[]> {
    const exec = resolveDriverExec(driver);
    if (!exec) {
        throw new Error(driverExecRefusal('dropProjectionTables'));
    }

    const results: DropProjectionResult[] = [];
    for (const table of DEPRECATED_TABLES) {
        try {
            await exec(`DROP TABLE IF EXISTS ${table}`);
            results.push({ table, status: 'dropped' });
        } catch (error) {
            results.push({
                table,
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return results;
}
