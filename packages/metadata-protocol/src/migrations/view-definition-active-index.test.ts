// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    ensureViewDefinitionActiveIndex,
    resolveIndexExec,
    buildActiveIndexSql,
    classifyIndexFailure,
    VIEW_ACTIVE_INDEX_NAME,
    VIEW_ACTIVE_PROBE_INDEX_NAME,
    type IndexExec,
} from './view-definition-active-index.js';

/**
 * `sys_view_definition` — "unique among ACTIVE rows" (#5839).
 *
 * Every assertion here runs against a REAL SQLite database, because the whole
 * defect was a claim about DDL that no test ever asked the database to confirm.
 * The starting index is byte-for-byte what `SqlDriver.syncDeclaredIndexes`
 * emits today — `packages/drivers/driver-sql/src/declared-index-retired-keys.test.ts`
 * pins that string against the same engine, so the fixture below is that test's
 * measured output rather than a guess at it.
 *
 * Uses Node's built-in `node:sqlite` rather than `better-sqlite3` (which the
 * driver packages use) on purpose: this package needs no SQL dependency of its
 * own for anything else, and adding one to run a test would put a native module
 * in the lockfile purely for fixture purposes. The built-in gives the same real
 * SQLite — real partial indexes, real UNIQUE enforcement — for free.
 */
describe('sys_view_definition active-row uniqueness (#5839)', () => {
    let db: DatabaseSync;
    let exec: IndexExec;

    /** Exactly the DDL `syncDeclaredIndexes` produces for the declaration. */
    const DECLARED_INDEX_DDL =
        'CREATE UNIQUE INDEX `idx_sys_view_def_active` on `sys_view_definition` ' +
        '(`name`, `organization_id`, `owner`)';

    const indexDdl = (name: string): string | undefined =>
        (db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as
            | { sql?: string }
            | undefined)?.sql ?? undefined;

    const insert = (
        id: string,
        name: string,
        org: string | null,
        owner: string | null,
        state: string,
    ): { ok: boolean; error?: string } => {
        try {
            db.prepare(
                'INSERT INTO sys_view_definition (id, name, organization_id, owner, state) VALUES (?,?,?,?,?)',
            ).run(id, name, org, owner, state);
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    };

    const archive = (id: string): void => {
        db.prepare("UPDATE sys_view_definition SET state='archived' WHERE id=?").run(id);
    };

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`CREATE TABLE sys_view_definition (
            id TEXT PRIMARY KEY, name TEXT, organization_id TEXT, owner TEXT, state TEXT
        );`);
        db.exec(DECLARED_INDEX_DDL);
        exec = async (sql: string) => db.exec(sql);
    });

    afterEach(() => {
        db.close();
    });

    // ── The nail: an archived view frees its name slot ────────────────────

    it('BEFORE the migration, an archived view still occupies its slot (the defect)', () => {
        expect(insert('v1', 'lead.my_pipeline', 'org1', 'user1', 'active').ok).toBe(true);
        archive('v1');

        const retry = insert('v2', 'lead.my_pipeline', 'org1', 'user1', 'active');
        expect(retry.ok).toBe(false);
        expect(retry.error).toContain('UNIQUE constraint failed');
    });

    it('AFTER the migration, an archived view frees its slot', async () => {
        expect(insert('v1', 'lead.my_pipeline', 'org1', 'user1', 'active').ok).toBe(true);
        archive('v1');

        const result = await ensureViewDefinitionActiveIndex(exec);
        expect(result.status).toBe('created');

        // The whole point of the issue: the user can re-create the view they
        // archived, under the same name.
        expect(insert('v2', 'lead.my_pipeline', 'org1', 'user1', 'active').ok).toBe(true);
    });

    it('the index it leaves behind is the PARTIAL one, under the DECLARED name', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        const ddl = indexDdl(VIEW_ACTIVE_INDEX_NAME);
        expect(ddl).toBeDefined();
        // The predicate the declaration always promised and never delivered.
        expect(ddl!.toLowerCase()).toContain("where state = 'active'");
        expect(ddl!.toLowerCase()).toContain('unique');
        // Reusing the declared name is what stops `syncDeclaredIndexes` — which
        // skips by name — from re-imposing the unrestricted form next boot.
        expect(ddl).not.toEqual(DECLARED_INDEX_DDL);
        // And the throwaway probe never survives.
        expect(indexDdl(VIEW_ACTIVE_PROBE_INDEX_NAME)).toBeUndefined();
    });

    // ── Uniqueness is scoped, NOT relaxed ─────────────────────────────────

    it('still rejects two ACTIVE rows with the same (name, organization_id, owner)', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('v3', 'lead.hot', 'org1', 'user1', 'active').ok).toBe(true);
        const dup = insert('v4', 'lead.hot', 'org1', 'user1', 'active');
        expect(dup.ok).toBe(false);
        expect(dup.error).toContain('UNIQUE constraint failed');
    });

    it('admits MANY archived rows under one name — the slot is scoped, not shared', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('a1', 'lead.rev', 'org1', 'user1', 'archived').ok).toBe(true);
        expect(insert('a2', 'lead.rev', 'org1', 'user1', 'archived').ok).toBe(true);
        // …and an active one alongside them.
        expect(insert('a3', 'lead.rev', 'org1', 'user1', 'active').ok).toBe(true);
        // …but only ONE active one.
        expect(insert('a4', 'lead.rev', 'org1', 'user1', 'active').ok).toBe(false);
    });

    it('keeps distinct owners and orgs independent', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('o1', 'lead.mine', 'org1', 'user1', 'active').ok).toBe(true);
        // Same name, different user → a personal view of their own.
        expect(insert('o2', 'lead.mine', 'org1', 'user2', 'active').ok).toBe(true);
        // Same name, different tenant.
        expect(insert('o3', 'lead.mine', 'org2', 'user1', 'active').ok).toBe(true);
    });

    /**
     * Honest scope note. `owner` is NULL for SHARED views and `organization_id`
     * is NULL for env-wide ones, and SQL UNIQUE treats NULLs as DISTINCT — so
     * two active SHARED views may carry the same name. That hole is older than
     * this migration and is NOT what #5839 decided: the partial index changes
     * the ROW SCOPE (`WHERE state = 'active'`) and deliberately leaves the KEY
     * spelling alone, which is also what makes it strictly weaker than the
     * index it replaces and therefore incapable of failing on existing data.
     * Pinned so the gap is a recorded fact rather than a surprise; closing it
     * needs the NULL-safe key (`COALESCE`) and its own ruling — filed separately.
     */
    it('does NOT close the pre-existing NULL-distinct hole for shared views (recorded, not fixed)', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('s1', 'lead.team', 'org1', null, 'active').ok).toBe(true);
        expect(insert('s2', 'lead.team', 'org1', null, 'active').ok).toBe(true);
    });

    // ── Idempotence ───────────────────────────────────────────────────────

    it('is idempotent — a second run leaves the schema byte-identical', async () => {
        const first = await ensureViewDefinitionActiveIndex(exec);
        const afterFirst = indexDdl(VIEW_ACTIVE_INDEX_NAME);

        const second = await ensureViewDefinitionActiveIndex(exec);
        const afterSecond = indexDdl(VIEW_ACTIVE_INDEX_NAME);

        expect(first.status).toBe('created');
        expect(second.status).toBe('created');
        expect(afterSecond).toEqual(afterFirst);
        // No probe residue accumulates across runs.
        expect(indexDdl(VIEW_ACTIVE_PROBE_INDEX_NAME)).toBeUndefined();
    });

    it('is idempotent in BEHAVIOUR too — slot recycling survives a re-run', async () => {
        await ensureViewDefinitionActiveIndex(exec);
        expect(insert('v1', 'lead.p', 'org1', 'user1', 'active').ok).toBe(true);
        archive('v1');
        await ensureViewDefinitionActiveIndex(exec);
        expect(insert('v2', 'lead.p', 'org1', 'user1', 'active').ok).toBe(true);
    });

    it('converges from a table that never had the declared index at all', async () => {
        db.exec(`DROP INDEX ${VIEW_ACTIVE_INDEX_NAME}`);
        const result = await ensureViewDefinitionActiveIndex(exec);
        expect(result.status).toBe('created');
        expect(indexDdl(VIEW_ACTIVE_INDEX_NAME)!.toLowerCase()).toContain("where state = 'active'");
    });

    // ── Degradation: the constraint is never destroyed ────────────────────

    /**
     * MySQL has no partial indexes. The paradigm this module follows
     * (`ensureOverlayIndex`) drops the legacy index BEFORE attempting the
     * partial one, so a rejected `WHERE` leaves the table with no unique index
     * at all. This module probes first for exactly that reason, and this test
     * is the proof: after a dialect refusal the ORIGINAL index is still there,
     * still enforcing, byte-for-byte unchanged.
     */
    it('a dialect without partial indexes keeps the original UNIQUE index intact', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const mysqlish: IndexExec = async (sql: string) => {
            if (/where/i.test(sql)) {
                throw new Error(
                    "You have an error in your SQL syntax; check the manual … near 'WHERE state = 'active''",
                );
            }
            return db.exec(sql);
        };

        const result = await ensureViewDefinitionActiveIndex(mysqlish, logger);

        expect(result.status).toBe('unsupported');
        // The pre-existing constraint is untouched — degraded to yesterday's
        // behaviour, never below it.
        expect(indexDdl(VIEW_ACTIVE_INDEX_NAME)).toEqual(DECLARED_INDEX_DDL);
        expect(insert('m1', 'lead.x', 'org1', 'user1', 'active').ok).toBe(true);
        expect(insert('m2', 'lead.x', 'org1', 'user1', 'active').ok).toBe(false);
        // Reported, and not as an operator error — this is expected on MySQL.
        expect(logger.info).toHaveBeenCalledTimes(1);
        expect(String(logger.info.mock.calls[0]![0])).toContain('no partial indexes');
        expect(logger.error).not.toHaveBeenCalled();
    });

    /**
     * ADR-0120 D4's wording contract: name what is NOT enforced and the command
     * that lists the offending rows, at `error`, without failing the boot.
     */
    it('conflicting rows are named at error level and the old index survives', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const conflicting: IndexExec = async (sql: string) => {
            if (/CREATE UNIQUE INDEX/i.test(sql)) {
                throw new Error(
                    'UNIQUE constraint failed: sys_view_definition.name, ' +
                        'sys_view_definition.organization_id, sys_view_definition.owner',
                );
            }
            return db.exec(sql);
        };

        const result = await ensureViewDefinitionActiveIndex(conflicting, logger);

        expect(result.status).toBe('conflict');
        expect(indexDdl(VIEW_ACTIVE_INDEX_NAME)).toEqual(DECLARED_INDEX_DDL);
        expect(logger.error).toHaveBeenCalledTimes(1);
        const msg = String(logger.error.mock.calls[0]![0]);
        expect(msg).toContain('name, organization_id, owner');
        expect(msg).toContain('os migrate plan');
    });

    it('a host with no raw-SQL driver is a silent no-op, not a failure', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const result = await ensureViewDefinitionActiveIndex(undefined, logger);
        expect(result.status).toBe('no-driver');
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    // ── Seams ─────────────────────────────────────────────────────────────

    it('classifies duplicate-row wording as a conflict even when it also says "key"', () => {
        // MySQL's duplicate message mentions the key name; the data verdict has
        // to win over the dialect verdict or a real conflict reads as "no
        // partial index support here".
        expect(classifyIndexFailure("Duplicate entry 'a-b-c' for key 'idx_sys_view_def_active'")).toBe(
            'conflict',
        );
        expect(classifyIndexFailure('near "WHERE": syntax error')).toBe('unsupported');
        expect(classifyIndexFailure('disk I/O error')).toBe('failed');
    });

    it('buildActiveIndexSql scopes rows without changing the declared key', () => {
        const sql = buildActiveIndexSql(VIEW_ACTIVE_INDEX_NAME);
        expect(sql).toContain('(name, organization_id, owner)');
        expect(sql).toContain("WHERE state = 'active'");
        expect(sql).toContain('IF NOT EXISTS');
    });

    it('resolveIndexExec prefers raw(), falls back to execute(), else undefined', async () => {
        const raw = vi.fn(async () => undefined);
        const execute = vi.fn(async () => undefined);

        await resolveIndexExec({ driver: { raw, execute } })!('SELECT 1');
        expect(raw).toHaveBeenCalledWith('SELECT 1');
        expect(execute).not.toHaveBeenCalled();

        await resolveIndexExec({ driver: { execute } })!('SELECT 2');
        expect(execute).toHaveBeenCalledWith('SELECT 2');

        // getDriver() and the drivers Map, the two other shapes the paradigm walks.
        expect(resolveIndexExec({ getDriver: () => ({ raw }) })).toBeTypeOf('function');
        expect(resolveIndexExec({ drivers: new Map([['a', { execute }]]) })).toBeTypeOf('function');
        expect(resolveIndexExec({})).toBeUndefined();
        expect(resolveIndexExec({ driver: {} })).toBeUndefined();
    });

    it('asks which driver OWNS sys_view_definition before taking any default', () => {
        const owner = { raw: vi.fn(async () => undefined) };
        const fallback = { raw: vi.fn(async () => undefined) };
        const getDriverForObject = vi.fn(() => owner);

        const resolved = resolveIndexExec({ getDriverForObject, driver: fallback });

        // The table-scoped answer wins over the engine-wide default: on a
        // multi-datasource kernel the platform objects can live elsewhere.
        expect(getDriverForObject).toHaveBeenCalledWith('sys_view_definition');
        void resolved!('SELECT 1');
        expect(owner.raw).toHaveBeenCalled();
        expect(fallback.raw).not.toHaveBeenCalled();
    });

    /**
     * Regression pin. `ObjectQL.getDriver(objectName)` REQUIRES an object name
     * and throws `No driver available for object 'undefined'` without one, so
     * the paradigm's bare `getDriver?.()` probe throws on a memory-driver
     * kernel. `ensureOverlayIndex` never notices because its entire body sits
     * in a swallow-everything try/catch; this resolver runs from a
     * `kernel:ready` hook, where a throw failed 16 ObjectQL boot tests before
     * each probe was guarded individually.
     */
    it('never throws when the engine\'s driver accessors do', () => {
        const thrower = () => {
            throw new Error("[ObjectQL] No driver available for object 'undefined'");
        };

        expect(resolveIndexExec({ getDriver: thrower, getDriverForObject: thrower })).toBeUndefined();
        expect(() => resolveIndexExec({ getDriver: thrower })).not.toThrow();
        expect(
            resolveIndexExec({
                getDriverForObject: thrower,
                get driver() {
                    throw new Error('boom');
                },
                drivers: new Map([['memory', { execute: vi.fn(async () => undefined) }]]),
            }),
        ).toBeTypeOf('function');
    });
});
