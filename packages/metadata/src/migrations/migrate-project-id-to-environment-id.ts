// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Migration: project_id → environment_id
 *
 * Renames the `project_id` column to `environment_id` on the metadata storage
 * tables — but only on the tables whose CURRENT declaration actually knows
 * `environment_id`.
 *
 * Forward counterpart of {@link migrateEnvIdToProjectId} (which performed the
 * earlier `env_id → project_id` rename). Together they let an operator walk an
 * old schema all the way forward in two steps:
 *
 *   migrateEnvIdToProjectId(driver);            // env_id     → project_id    (legacy)
 *   migrateProjectIdToEnvironmentId(driver);    // project_id → environment_id (v5)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  Why the table list is DERIVED and not written out (#13205)
 *
 *  This migration is the terminal step of that chain: its target column is
 *  the CURRENT declared shape, so "should this table be renamed?" is not an
 *  independent fact — it is `does this object still declare environment_id?`.
 *  Written out by hand, the two drifted apart: `sys_metadata_history` stayed
 *  on the list after the branch/project-removal amendment (M1) removed
 *  `environment_id` from its declaration, so against a database whose
 *  physical `sys_metadata_history` still carried `project_id` this migration
 *  renamed it to a column NO declaration knows about — minting exactly the
 *  orphan column class the metadata drift audit exists to remove.
 *
 *  The old guard could not catch it: the loop gates on `project_id` existing
 *  PHYSICALLY (`_columnExists`), which says nothing about the target column
 *  being DECLARED. So the list is now computed from the declarations in
 *  `@objectstack/metadata-core` (already a dependency of this package — no
 *  new edge), and a candidate that does not declare the target column is
 *  reported as `skipped_not_declared` rather than dropped silently: an
 *  operator reading the result sees the table was considered and why nothing
 *  happened, instead of having to guess whether it was forgotten again.
 *
 *  ⚠️ The sibling `migrate-env-id-to-project-id.ts` is deliberately NOT
 *  changed this way. Its target (`project_id`) is an INTERMEDIATE column that
 *  no current declaration carries by design — gating it on today's
 *  declarations would disable the chain's first step entirely. The rule
 *  "target must be declared" is sound only for the terminal migration.
 * ─────────────────────────────────────────────────────────────────────
 *
 * (The per-type projection tables `sys_object` / `sys_view` / `sys_flow` /
 * `sys_agent` / `sys_tool` were removed in 2026-05 along with the projection
 * pipeline — see ADR 0005 addendum. They are intentionally not included.)
 *
 * Safe to run multiple times (idempotent): checks for column existence before
 * attempting to rename. If `environment_id` already exists, the step is
 * skipped.
 *
 * Usage:
 *   import { migrateProjectIdToEnvironmentId } from '@objectstack/metadata/migrations';
 *   await migrateProjectIdToEnvironmentId(driver);
 */

import type { IDataDriver } from '@objectstack/spec/contracts';
import { SysMetadataObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';

/** The column this migration RENAMES AWAY FROM. */
const SOURCE_COLUMN = 'project_id';

/** The column this migration PRODUCES. Must be declared, or the rename mints an orphan. */
const TARGET_COLUMN = 'environment_id';

/**
 * Every metadata storage table this migration considers. Membership here says
 * "this table has, historically, carried the tenancy column" — whether the
 * rename actually runs is decided by {@link AFFECTED_TABLES} below, from the
 * declaration.
 */
const CANDIDATE_OBJECTS = [SysMetadataObject, SysMetadataHistoryObject] as const;

function declaresColumn(object: { fields?: Record<string, unknown> }, column: string): boolean {
    return Object.prototype.hasOwnProperty.call(object.fields ?? {}, column);
}

/** Candidate table names, in declaration order. */
const CANDIDATE_TABLES: readonly string[] = CANDIDATE_OBJECTS.map((o) => o.name);

/**
 * The tables this migration will actually rename: the candidates whose CURRENT
 * declaration carries {@link TARGET_COLUMN}.
 *
 * Exported for the pin in `migrate-project-id-to-environment-id.test.ts` (not
 * re-exported from `./index.ts` — this is not package surface).
 */
export const AFFECTED_TABLES: readonly string[] = CANDIDATE_OBJECTS
    .filter((o) => declaresColumn(o, TARGET_COLUMN))
    .map((o) => o.name);

export interface ProjectIdToEnvironmentIdResult {
    table: string;
    /**
     * `skipped_not_declared` — the table is a known metadata storage table, but
     * its current declaration has no `environment_id`, so renaming into it
     * would create a column nothing declares. Nothing was executed.
     */
    status: 'renamed' | 'already_done' | 'table_missing' | 'skipped_not_declared' | 'error';
    error?: string;
}

/**
 * Rename `project_id` → `environment_id` on all metadata tables that still
 * declare `environment_id`.
 *
 * @param driver  An IDataDriver with access to the target database.
 *                Must expose a raw query method: `driver.raw(sql, bindings?)`.
 * @returns       Per-table migration results — one entry per candidate table,
 *                including the ones skipped for lacking the declared target.
 */
export async function migrateProjectIdToEnvironmentId(
    driver: IDataDriver,
): Promise<ProjectIdToEnvironmentIdResult[]> {
    const driverAny = driver as any;

    if (typeof driverAny.raw !== 'function') {
        throw new Error(
            'migrateProjectIdToEnvironmentId: driver must expose a .raw(sql, bindings?) method. ' +
            'SqlDriver (better-sqlite3/knex) supports this; cloud-side TursoDriver also conforms.'
        );
    }

    const results: ProjectIdToEnvironmentIdResult[] = [];

    for (const table of CANDIDATE_TABLES) {
        // The declared-target gate, ahead of every physical probe: a table whose
        // declaration lost `environment_id` must never be renamed INTO it, no
        // matter what the physical schema still carries (#13205).
        if (!AFFECTED_TABLES.includes(table)) {
            results.push({ table, status: 'skipped_not_declared' });
            continue;
        }

        try {
            const hasColumn = await _columnExists(driverAny, table, SOURCE_COLUMN);
            const alreadyMigrated = await _columnExists(driverAny, table, TARGET_COLUMN);

            if (alreadyMigrated && !hasColumn) {
                results.push({ table, status: 'already_done' });
                continue;
            }

            if (!hasColumn) {
                results.push({ table, status: 'table_missing' });
                continue;
            }

            await driverAny.raw(
                `ALTER TABLE "${table}" RENAME COLUMN ${SOURCE_COLUMN} TO ${TARGET_COLUMN}`,
            );

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
        const rows: any[] = await driver.raw(`PRAGMA table_info("${table}")`);
        if (Array.isArray(rows) && rows.length > 0) {
            const list: any[] = Array.isArray(rows[0]) ? rows[0] : rows;
            return list.some((r: any) => r?.name === column);
        }

        const result: any[] = await driver.raw(
            `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
            [table, column],
        );
        const list: any[] = Array.isArray(result[0]) ? result[0] : result;
        return list.length > 0;
    } catch {
        return false;
    }
}
