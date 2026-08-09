// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    ensureViewDefinitionActiveIndex,
    resolveIndexExec,
    buildActiveIndexSql,
    buildDuplicateProbeSql,
    classifyIndexFailure,
    viewActiveIndexKeyParts,
    VIEW_ACTIVE_INDEX_NAME,
    VIEW_ACTIVE_PROBE_INDEX_NAME,
    VIEW_ACTIVE_INDEX_COLUMNS,
    VIEW_ACTIVE_NULL_SENTINELS,
    type IndexExec,
} from './view-definition-active-index.js';

/**
 * `sys_view_definition` — "unique among ACTIVE rows" (#5839), on a key that is
 * NULL-SAFE (#6417).
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
describe('sys_view_definition active-row uniqueness (#5839) on a NULL-safe key (#6417)', () => {
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

    it('the index it leaves behind is the PARTIAL, NULL-SAFE one, under the DECLARED name', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        const ddl = indexDdl(VIEW_ACTIVE_INDEX_NAME);
        expect(ddl).toBeDefined();
        // The predicate the declaration always promised and never delivered.
        expect(ddl!.toLowerCase()).toContain("where state = 'active'");
        expect(ddl!.toLowerCase()).toContain('unique');
        // …over the NULL-safe key parts (#6417), each copied from its own
        // in-repo precedent: ADR-0120 D3's sentinel for the tenant column,
        // `ensureOverlayIndex`'s `COALESCE(package_id, '')` form for `owner`.
        expect(ddl).toContain("COALESCE(organization_id, '__global__')");
        expect(ddl).toContain("COALESCE(owner, '')");
        // Reusing the declared name is what stops `syncDeclaredIndexes` — which
        // skips by name — from re-imposing the unrestricted form next boot.
        expect(ddl).not.toEqual(DECLARED_INDEX_DDL);
        // And the throwaway probe never survives.
        expect(indexDdl(VIEW_ACTIVE_PROBE_INDEX_NAME)).toBeUndefined();
    });

    // ── Uniqueness is scoped, NOT relaxed ─────────────────────────────────

    /** CASE 2 of #6417 — the one bucket that WAS already constrained. */
    it('still rejects two ACTIVE PERSONAL rows with the same (name, organization_id, owner)', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('v3', 'lead.hot', 'org1', 'user1', 'active').ok).toBe(true);
        const dup = insert('v4', 'lead.hot', 'org1', 'user1', 'active');
        expect(dup.ok).toBe(false);
        // The constraint's IDENTITY, not merely "something threw": SQLite names
        // the index for an expression key, so this pins WHICH constraint fired.
        expect(dup.error).toContain('UNIQUE constraint failed');
        expect(dup.error).toContain(VIEW_ACTIVE_INDEX_NAME);
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

    // ── The NULL-distinct hole, now CLOSED (#6417) ────────────────────────

    /**
     * The pin PR #6415 left here read `does NOT close the pre-existing
     * NULL-distinct hole for shared views (recorded, not fixed)` and asserted
     * that the second insert succeeded. The maintainer ruling of 2026-08-08
     * forbids that outcome, so the pin flips: same fixture, opposite verdict.
     *
     * `owner` is NULL for SHARED views, and SQL UNIQUE treats NULLs as mutually
     * DISTINCT, so the raw column constrained nothing for them —
     * `COALESCE(owner, '')` folds every shared row into ONE bucket that is
     * unique among itself. CASE 3 of the issue, measured.
     */
    it('rejects a second ACTIVE SHARED view (owner NULL) under the same name', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('s1', 'lead.team', 'org1', null, 'active').ok).toBe(true);
        const dup = insert('s2', 'lead.team', 'org1', null, 'active');
        expect(dup.ok).toBe(false);
        expect(dup.error).toContain('UNIQUE constraint failed');
        expect(dup.error).toContain(VIEW_ACTIVE_INDEX_NAME);
    });

    /** CASE 4 — `organization_id` is NULL for environment-level views. */
    it('rejects a second ACTIVE ENVIRONMENT-LEVEL view (organization_id NULL) under the same name', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('e1', 'lead.env', null, 'user9', 'active').ok).toBe(true);
        const dup = insert('e2', 'lead.env', null, 'user9', 'active');
        expect(dup.ok).toBe(false);
        expect(dup.error).toContain('UNIQUE constraint failed');
        expect(dup.error).toContain(VIEW_ACTIVE_INDEX_NAME);
    });

    /** Both nullable parts NULL at once — an environment-level SHARED view. */
    it('rejects a second ACTIVE view with BOTH organization_id and owner NULL', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('b1', 'lead.both', null, null, 'active').ok).toBe(true);
        const dup = insert('b2', 'lead.both', null, null, 'active');
        expect(dup.ok).toBe(false);
        expect(dup.error).toContain('UNIQUE constraint failed');
        expect(dup.error).toContain(VIEW_ACTIVE_INDEX_NAME);
    });

    /**
     * The tightening must not have swallowed #5839's row scoping. Shared views
     * are the bucket #6417 newly constrains, so the archived exemption is
     * re-proved THERE and not only on personal rows.
     */
    it('archived SHARED rows stay exempt — the #5839 active-only scoping survives', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('sa1', 'lead.shared_arc', 'org1', null, 'archived').ok).toBe(true);
        expect(insert('sa2', 'lead.shared_arc', 'org1', null, 'archived').ok).toBe(true);
        // …plus exactly one active shared view alongside them.
        expect(insert('sa3', 'lead.shared_arc', 'org1', null, 'active').ok).toBe(true);
        expect(insert('sa4', 'lead.shared_arc', 'org1', null, 'active').ok).toBe(false);

        // And the recycling the whole of #5839 was about, on a shared view.
        archive('sa3');
        expect(insert('sa5', 'lead.shared_arc', 'org1', null, 'active').ok).toBe(true);
    });

    /**
     * The half of the declaration's comment that WAS true stays true: a shared
     * view and a personal view may carry one name, and so may two environments'
     * / two tenants' rows. The sentinels are chosen so they cannot collide with
     * real data — an organization id may never be `'__global__'` (ADR-0120 D3
     * reserves the token) and an owner is a user id, never `''`.
     */
    it('a SHARED view and a PERSONAL view still share a name, across tenants too', async () => {
        await ensureViewDefinitionActiveIndex(exec);

        expect(insert('x1', 'lead.mix', 'org1', null, 'active').ok).toBe(true);
        expect(insert('x2', 'lead.mix', 'org1', 'user1', 'active').ok).toBe(true);
        // A shared view in another tenant, and the environment-level one.
        expect(insert('x3', 'lead.mix', 'org2', null, 'active').ok).toBe(true);
        expect(insert('x4', 'lead.mix', null, null, 'active').ok).toBe(true);
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

    /**
     * The upgrade every already-migrated deployment takes: the table arrives
     * carrying #5839's partial index with the OLD, NULL-distinct key, and this
     * run has to replace it in place — same name, tighter key.
     */
    it('upgrades a table already carrying #5839\'s NULL-distinct partial index', async () => {
        db.exec(`DROP INDEX ${VIEW_ACTIVE_INDEX_NAME}`);
        db.exec(
            `CREATE UNIQUE INDEX ${VIEW_ACTIVE_INDEX_NAME} ON sys_view_definition ` +
                `(name, organization_id, owner) WHERE state = 'active'`,
        );
        // The #5839 shape admits two shared views under one name…
        expect(insert('pre1', 'lead.pre', 'org1', null, 'active').ok).toBe(true);
        db.prepare("UPDATE sys_view_definition SET state='archived' WHERE id='pre1'").run();

        const result = await ensureViewDefinitionActiveIndex(exec);

        expect(result.status).toBe('created');
        expect(indexDdl(VIEW_ACTIVE_INDEX_NAME)).toContain("COALESCE(owner, '')");
        // …and after the upgrade it does not.
        expect(insert('post1', 'lead.pre', 'org1', null, 'active').ok).toBe(true);
        expect(insert('post2', 'lead.pre', 'org1', null, 'active').ok).toBe(false);
    });

    // ── Degradation: the constraint is never destroyed ────────────────────

    /**
     * MySQL has no partial indexes (and, before 8.0.13, no functional key parts
     * for the `COALESCE` parts either). The paradigm this module follows
     * (`ensureOverlayIndex`) drops the legacy index BEFORE attempting the
     * partial one, so a rejected `WHERE` leaves the table with no unique index
     * at all. This module probes first for exactly that reason, and this test
     * is the proof: after a dialect refusal the ORIGINAL index is still there,
     * still enforcing, byte-for-byte unchanged — which IS ADR-0120 D3's
     * bare-composite degradation, reached by keeping rather than rebuilding.
     */
    it('a dialect that cannot build the form keeps the original UNIQUE index intact', async () => {
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
        // Reported at `error`, RAISED from #6415's `info` by #6417: the same
        // missing DDL now costs an integrity guarantee the platform states it
        // enforces (not merely slot recycling), so it lands in the durability
        // arm of AGENTS.md's rule — the system keeps looking healthy while
        // duplicates accumulate. An `error` owes the consequence and the fix,
        // and both gaps that stay open are named.
        expect(logger.error).toHaveBeenCalledTimes(1);
        const note = String(logger.error.mock.calls[0]![0]);
        expect(note).toContain('UNRESTRICTED and NULL-distinct');
        expect(note).toContain('keeps looking healthy');
        expect(note).toContain('#5839');
        expect(note).toContain('#6417');
        // The fix, and the query that surfaces the duplicates meanwhile.
        expect(note).toContain('SQLite/PostgreSQL');
        expect(note).toContain(buildDuplicateProbeSql());
        expect(logger.info).not.toHaveBeenCalled();
    });

    /**
     * The tightening-failure path, on a REAL database rather than a mocked
     * throw: seed the exact duplicate pair the old index admitted (#6417 CASE
     * 3), then run the migration and assert ADR-0120 D4's whole disposition.
     *
     * This is the case #5839 could not have — its partial index was strictly
     * WEAKER than the one it replaced, so it could not fail on existing data.
     * A NULL-safe key can, and does.
     */
    it('a pre-existing duplicate pair blocks the tightening — old index kept, rows named, boot survives', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        // Two ACTIVE shared views under one name — legal until today.
        expect(insert('d1', 'lead.team', 'org1', null, 'active').ok).toBe(true);
        expect(insert('d2', 'lead.team', 'org1', null, 'active').ok).toBe(true);

        const result = await ensureViewDefinitionActiveIndex(exec, logger);

        // Reported, never thrown: a boot must not fail over an index.
        expect(result.status).toBe('conflict');
        expect(result.detail).toContain('UNIQUE constraint failed');
        // The PREVIOUS index survives byte-for-byte, and still enforces what it
        // always did — at no point is the table left unconstrained.
        expect(indexDdl(VIEW_ACTIVE_INDEX_NAME)).toEqual(DECLARED_INDEX_DDL);
        expect(insert('d3', 'lead.hot', 'org1', 'user1', 'active').ok).toBe(true);
        expect(insert('d4', 'lead.hot', 'org1', 'user1', 'active').ok).toBe(false);
        // No probe residue, and no half-built index under either name.
        expect(indexDdl(VIEW_ACTIVE_PROBE_INDEX_NAME)).toBeUndefined();

        // D4's wording contract: what is not enforced, the rows, the command.
        expect(logger.error).toHaveBeenCalledTimes(1);
        const msg = String(logger.error.mock.calls[0]![0]);
        expect(msg).toContain("COALESCE(owner, '')");
        expect(msg).toContain('os migrate plan');
        expect(msg).toContain(buildDuplicateProbeSql());

        // …and that shipped query really does name the offending rows, on this
        // very database. It is not a decorative string.
        const offenders = db.prepare(buildDuplicateProbeSql()).all() as Array<Record<string, unknown>>;
        expect(offenders).toHaveLength(1);
        expect(offenders[0]!.name).toBe('lead.team');
        expect(offenders[0]!.duplicate_rows).toBe(2);
        // The folded columns come back under their bucket-key aliases (#6772),
        // and the operator loses nothing by reading them: the offending pair is
        // `owner IS NULL`, and `''` is the only way that can be spelled here
        // because an owner is a user id and never the empty string.
        expect(offenders[0]!.organization_id_key).toBe('org1');
        expect(offenders[0]!.owner_key).toBe('');
        // ⚠️ What this test can and cannot see: the pre-#6772 bare projection
        // EXECUTED here without error and returned the same one offender row
        // with `duplicate_rows: 2` — SQLite grouped it happily, so the three
        // assertions above the alias pair were green on the broken query too.
        // Only the alias names (and the dialect pin below) move. Running the
        // query on a real database therefore proves it lists the rows; it can
        // never prove the query is legal on PostgreSQL, because the engine
        // this test has is precisely the lenient one.
    });

    /**
     * The same disposition when the driver reports the conflict in MySQL's
     * wording rather than SQLite's — the classification, not the dialect, is
     * what selects the branch.
     */
    it('conflicting rows are named at error level and the old index survives (MySQL wording)', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const conflicting: IndexExec = async (sql: string) => {
            if (/CREATE UNIQUE INDEX/i.test(sql)) {
                throw new Error("Duplicate entry 'lead.team-__global__-' for key 'idx_sys_view_def_active'");
            }
            return db.exec(sql);
        };

        const result = await ensureViewDefinitionActiveIndex(conflicting, logger);

        expect(result.status).toBe('conflict');
        expect(indexDdl(VIEW_ACTIVE_INDEX_NAME)).toEqual(DECLARED_INDEX_DDL);
        expect(logger.error).toHaveBeenCalledTimes(1);
        const msg = String(logger.error.mock.calls[0]![0]);
        expect(msg).toContain("COALESCE(organization_id, '__global__')");
        expect(msg).toContain('os migrate plan');
    });

    /**
     * The catch-all arm. Same class as the dialect arm — the DDL did not run
     * and nothing else looks wrong — so it is `error` too, and it must not be
     * QUIETER than the failure we can name.
     */
    it('an unclassifiable failure is reported at error and leaves the index alone', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const broken: IndexExec = async (sql: string) => {
            if (/CREATE UNIQUE INDEX/i.test(sql)) throw new Error('disk I/O error');
            return db.exec(sql);
        };

        const result = await ensureViewDefinitionActiveIndex(broken, logger);

        expect(result.status).toBe('failed');
        expect(indexDdl(VIEW_ACTIVE_INDEX_NAME)).toEqual(DECLARED_INDEX_DDL);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(String(logger.error.mock.calls[0]![0])).toContain('can still coexist');
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
        // MariaDB's refusal of a functional key part, which #6417 introduces.
        expect(classifyIndexFailure('Functional index on a column is not supported')).toBe('unsupported');
        expect(classifyIndexFailure('disk I/O error')).toBe('failed');
        // #6699: the same verdict off the `code` channel, with prose that
        // carries no signal at all. Asserted through THIS module's re-export
        // (the public `@objectstack/metadata-protocol` surface), because that is
        // the export the classifier's own home is reached by — the full
        // channel matrix lives in `partial-index-probe.test.ts`.
        expect(
            classifyIndexFailure(Object.assign(new Error('insert failed'), { code: 'ER_DUP_ENTRY' })),
        ).toBe('conflict');
    });

    it('buildActiveIndexSql scopes rows AND spells the key NULL-safe', () => {
        const sql = buildActiveIndexSql(VIEW_ACTIVE_INDEX_NAME);
        expect(sql).toContain("(name, COALESCE(organization_id, '__global__'), COALESCE(owner, ''))");
        expect(sql).toContain("WHERE state = 'active'");
        expect(sql).toContain('IF NOT EXISTS');
    });

    /**
     * The sentinels are the point of #6417, so they are asserted as literals
     * rather than only through the builder that produces them: `'__global__'`
     * is ADR-0120 D3's reserved token (the driver's `GLOBAL_TENANT`), `''` is
     * `ensureOverlayIndex`'s `COALESCE(package_id, '')` form. A silent change
     * to either would re-partition every existing index without a migration.
     */
    it('pins the two sentinels and the key order', () => {
        expect(VIEW_ACTIVE_NULL_SENTINELS).toEqual({ organization_id: '__global__', owner: '' });
        expect(viewActiveIndexKeyParts()).toEqual([
            'name',
            "COALESCE(organization_id, '__global__')",
            "COALESCE(owner, '')",
        ]);
    });

    it('buildDuplicateProbeSql groups by exactly the index key the CREATE uses', () => {
        const probe = buildDuplicateProbeSql();
        // Same key parts as the index, so what it reports and what the index
        // rejects cannot diverge.
        expect(probe).toContain(`GROUP BY ${viewActiveIndexKeyParts().join(', ')}`);
        // The projection is those same key parts — each folded column under
        // its bucket-key alias, never bare (#6772; see the dialect pin below).
        expect(probe).toContain(
            "SELECT name, COALESCE(organization_id, '__global__') AS organization_id_key, "
            + "COALESCE(owner, '') AS owner_key, COUNT(*) AS duplicate_rows",
        );
        expect(probe).toContain("WHERE state = 'active'");
        expect(probe).toContain('HAVING COUNT(*) > 1');
    });

    /**
     * The query is shipped to an operator inside an `error`-level degradation
     * report, on both dialects that can build the index it explains. It has to
     * RUN on both. PostgreSQL requires every non-aggregated projection to
     * appear verbatim in `GROUP BY`; a bare `organization_id` projected against
     * `GROUP BY COALESCE(organization_id, '__global__')` is rejected with
     * `must appear in the GROUP BY clause` — which is exactly what shipped
     * until #6772, invisible because the only engine the sibling test above can
     * run is the lenient one.
     *
     * Mirrors `overlay-index.test.ts`'s
     * `the duplicate-listing query is groupable on PostgreSQL, not only SQLite`.
     */
    it('the duplicate-listing query is groupable on PostgreSQL, not only SQLite', () => {
        const sql = buildDuplicateProbeSql();
        expect(sql).toEqual(
            "SELECT name, COALESCE(organization_id, '__global__') AS organization_id_key, "
            + "COALESCE(owner, '') AS owner_key, COUNT(*) AS duplicate_rows "
            + "FROM sys_view_definition WHERE state = 'active' "
            + "GROUP BY name, COALESCE(organization_id, '__global__'), COALESCE(owner, '') "
            + 'HAVING COUNT(*) > 1',
        );

        // PG's rule, applied term by term rather than only to the whole string:
        // every BARE projection must be a bare GROUP BY term, and every folded
        // column must reach the select list only through its own expression.
        const selectList = sql.slice('SELECT '.length, sql.indexOf(' FROM '));
        const groupBy = sql.slice(sql.indexOf('GROUP BY ') + 'GROUP BY '.length, sql.indexOf(' HAVING'));
        for (const column of VIEW_ACTIVE_INDEX_COLUMNS) {
            const bare = new RegExp(`(^|, )${column}(,|$)`);
            const sentinel = VIEW_ACTIVE_NULL_SENTINELS[column];
            if (sentinel === undefined) {
                expect(selectList).toMatch(bare);
                expect(groupBy).toMatch(bare);
            } else {
                expect(selectList).not.toMatch(bare);
                expect(selectList).toContain(`COALESCE(${column}, '${sentinel}') AS ${column}_key`);
                expect(groupBy).toContain(`COALESCE(${column}, '${sentinel}')`);
            }
        }
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
