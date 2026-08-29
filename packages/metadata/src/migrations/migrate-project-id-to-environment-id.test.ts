// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13205 — the migration's table list must never outlive the declarations.
 *
 * `migrateProjectIdToEnvironmentId` is the TERMINAL step of the tenancy-column
 * chain, so its target column (`environment_id`) is by definition the current
 * declared shape. A table on its list whose declaration no longer carries that
 * column is therefore not a stale comment — it is a rename that MINTS AN ORPHAN
 * COLUMN, on a real database, that no declaration knows about.
 *
 * `sys_metadata_history` was exactly that: the branch/project-removal amendment
 * (M1) took `environment_id` out of its declaration and the hand-written
 * `AFFECTED_TABLES` kept naming it. The old `_columnExists` guard could not see
 * it — it gates on `project_id` being PHYSICALLY present, which says nothing
 * about the target being DECLARED.
 *
 * So these are pins on the PROPERTY, not on today's answer:
 *   1. every table the migration will touch declares the column it produces
 *      (quantified over `AFFECTED_TABLES`, so a hand-added entry is caught);
 *   2. membership TRACKS the declaration in both directions (so the derivation
 *      cannot be replaced by a literal that happens to match today, and cannot
 *      quietly degrade to nothing);
 *   3. the migration issues no SQL AT ALL against a table it must not rename,
 *      even when that table physically still carries `project_id` — which is
 *      the shape the defect actually took.
 */

import { describe, expect, it } from 'vitest';
import {
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
    SysMetadataCommitObject,
    SysViewDefinitionObject,
} from '@objectstack/metadata-core';

import {
    AFFECTED_TABLES,
    migrateProjectIdToEnvironmentId,
} from './migrate-project-id-to-environment-id.js';

/** The column the migration produces. Renaming into it is only legal if it is declared. */
const TARGET_COLUMN = 'environment_id';
/** The column the migration renames away from. */
const SOURCE_COLUMN = 'project_id';

type DeclaredObject = { name: string; fields?: Record<string, unknown> };

/**
 * Every metadata storage object declared by `@objectstack/metadata-core`. Used
 * to RESOLVE a table named by the migration back to its declaration — a name
 * with no declaration at all is itself drift.
 */
const DECLARED_OBJECTS: readonly DeclaredObject[] = [
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
    SysMetadataCommitObject,
    SysViewDefinitionObject,
] as unknown as readonly DeclaredObject[];

/**
 * The tables this migration may ever consider: the metadata storage tables that
 * historically carried the tenancy column. This is the migration's UNIVERSE
 * (fixed by history), not its answer — the answer is what the assertions below
 * derive from the declarations.
 */
const CANDIDATE_TABLES = ['sys_metadata', 'sys_metadata_history'] as const;

function declaration(table: string): DeclaredObject | undefined {
    return DECLARED_OBJECTS.find((o) => o.name === table);
}

function declaresTarget(table: string): boolean {
    const object = declaration(table);
    return !!object && Object.prototype.hasOwnProperty.call(object.fields ?? {}, TARGET_COLUMN);
}

/** Records every statement the migration issues, and answers column probes. */
function fakeDriver(physicalColumns: Record<string, readonly string[]>) {
    const statements: string[] = [];
    const raw = async (sql: string, _bindings?: unknown[]) => {
        statements.push(sql);
        const pragma = /^PRAGMA table_info\("(.+)"\)$/.exec(sql);
        if (pragma) {
            const columns = physicalColumns[pragma[1]!] ?? [];
            return columns.map((name) => ({ name }));
        }
        if (sql.startsWith('SELECT column_name')) return [];
        return [];
    };
    return { driver: { raw } as any, statements };
}

describe('migrateProjectIdToEnvironmentId — AFFECTED_TABLES is pinned to declared reality', () => {
    it('every table it will rename DECLARES the column the rename produces', () => {
        // The safety property, quantified over the list itself: whatever ends up
        // in AFFECTED_TABLES — derived today, hand-written tomorrow — must be a
        // table whose CURRENT declaration carries `environment_id`. This is the
        // assertion that would have failed on `sys_metadata_history`.
        const orphanMinting = AFFECTED_TABLES.filter((table) => !declaresTarget(table));
        expect(orphanMinting).toEqual([]);
    });

    it('names only tables that have a declaration at all', () => {
        const undeclared = AFFECTED_TABLES.filter((table) => declaration(table) === undefined);
        expect(undeclared).toEqual([]);
    });

    it('membership TRACKS the declaration, in both directions', () => {
        // Not `toEqual(['sys_metadata'])` — that would re-state today's answer and
        // pin nothing. Each candidate's membership is compared against its own
        // declaration, so this keeps holding (and keeps meaning something) if a
        // declaration legitimately regains or loses `environment_id`.
        for (const table of CANDIDATE_TABLES) {
            expect(
                AFFECTED_TABLES.includes(table),
                `${table}: list membership must equal "declares ${TARGET_COLUMN}"`,
            ).toBe(declaresTarget(table));
        }
    });

    it('is not vacuous — the derivation still selects the tables that do declare it', () => {
        // Guards the other failure direction: a derivation that silently degrades
        // to an empty list would satisfy every assertion above.
        const expected = CANDIDATE_TABLES.filter(declaresTarget);
        expect(expected.length).toBeGreaterThan(0);
        expect([...AFFECTED_TABLES].sort()).toEqual([...expected].sort());
    });

    it('considers no table outside the historical candidate set', () => {
        expect(AFFECTED_TABLES.every((t) => (CANDIDATE_TABLES as readonly string[]).includes(t))).toBe(true);
    });
});

describe('migrateProjectIdToEnvironmentId — behaviour against a physically-stale database', () => {
    /**
     * The defect's exact shape: BOTH physical tables still carry `project_id`.
     * The pre-fix code renamed both, because it only asked whether `project_id`
     * was physically there.
     */
    const stale = {
        sys_metadata: ['id', 'name', 'type', SOURCE_COLUMN],
        sys_metadata_history: ['id', 'name', 'type', SOURCE_COLUMN],
    };

    it('renames only the declared table and issues NO statement against the undeclared one', async () => {
        const { driver, statements } = fakeDriver(stale);

        const results = await migrateProjectIdToEnvironmentId(driver);

        const renamed = results.filter((r) => r.status === 'renamed').map((r) => r.table);
        expect(renamed).toEqual(CANDIDATE_TABLES.filter(declaresTarget));

        const alters = statements.filter((s) => s.startsWith('ALTER TABLE'));
        expect(alters).toEqual([
            `ALTER TABLE "sys_metadata" RENAME COLUMN ${SOURCE_COLUMN} TO ${TARGET_COLUMN}`,
        ]);

        // Sharper than "no ALTER": a table the migration must not touch is never
        // even probed. Pre-fix this list held a PRAGMA and an ALTER.
        const undeclared = CANDIDATE_TABLES.filter((t) => !declaresTarget(t));
        for (const table of undeclared) {
            expect(statements.filter((s) => s.includes(table))).toEqual([]);
        }
    });

    it('reports the skipped table instead of dropping it silently', async () => {
        const { driver } = fakeDriver(stale);

        const results = await migrateProjectIdToEnvironmentId(driver);

        // One entry per candidate — an operator can tell "considered and skipped"
        // from "forgotten again", which is the state this card started in.
        expect(results.map((r) => r.table).sort()).toEqual([...CANDIDATE_TABLES].sort());
        for (const table of CANDIDATE_TABLES.filter((t) => !declaresTarget(t))) {
            expect(results.find((r) => r.table === table)?.status).toBe('skipped_not_declared');
        }
    });

    it('is idempotent on an already-migrated database', async () => {
        const { driver, statements } = fakeDriver({
            sys_metadata: ['id', 'name', 'type', TARGET_COLUMN],
            sys_metadata_history: ['id', 'name', 'type'],
        });

        const results = await migrateProjectIdToEnvironmentId(driver);

        expect(results.find((r) => r.table === 'sys_metadata')?.status).toBe('already_done');
        expect(statements.filter((s) => s.startsWith('ALTER TABLE'))).toEqual([]);
    });

    it('still refuses a driver without .raw()', async () => {
        await expect(migrateProjectIdToEnvironmentId({} as any)).rejects.toThrow(
            /must expose a \.raw\(sql, bindings\?\) method/,
        );
    });
});
