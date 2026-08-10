// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    buildOverlayDuplicateProbeSql,
    buildOverlayFallbackIndexSql,
    buildOverlayIndexSql,
    ensureMetadataOverlayIndexes,
    ensureOverlayStateIndex,
    overlayIndexKeyParts,
    OVERLAY_INDEX_COLUMNS,
    OVERLAY_INDEX_NAMES,
    OVERLAY_NULL_SENTINELS,
    OVERLAY_PROBE_INDEX_NAMES,
} from './overlay-index.js';
import type { IndexExec } from './partial-index-probe.js';

/**
 * `sys_metadata` — overlay uniqueness survives a failed tightening (#6418).
 *
 * Every assertion here runs against a REAL SQLite database, because the defect
 * was a claim about DDL ordering that no test ever asked a database to confirm:
 * `ensureOverlayIndex` dropped the live index and then tried to build the
 * partial one, so a rejected `CREATE` left the table with NO unique index at
 * all — silently, since both `catch` blocks were empty.
 *
 * Uses Node's built-in `node:sqlite` rather than `better-sqlite3` (which the
 * driver packages use), for the reason the sibling
 * `view-definition-active-index.test.ts` gives: this package needs no SQL
 * dependency of its own, and the built-in gives the same real SQLite — real
 * partial indexes, real UNIQUE enforcement, real NULL-distinctness — for free.
 */
describe('sys_metadata overlay uniqueness (#6418)', () => {
    let db: DatabaseSync;
    let exec: IndexExec;

    /**
     * What `SqlDriver.syncDeclaredIndexes` materializes for
     * `sys-metadata.object.ts`'s declaration
     * (`['type','name','organization_id','package_id']`, `unique: true`) — knex's
     * form, mirrored from the sibling test's measured fixture. It is
     * UNRESTRICTED (no `WHERE`) and NULL-distinct, which is exactly why the
     * runtime migration exists and exactly what it must not destroy.
     */
    const DECLARED_ACTIVE_INDEX_DDL =
        'CREATE UNIQUE INDEX `idx_sys_metadata_overlay_active` on `sys_metadata` ' +
        '(`type`, `name`, `organization_id`, `package_id`)';

    /**
     * A draft index a pre-#6418 deployment can be carrying — state-scoped but
     * NULL-distinct on `package_id`. Seeded only by the draft-section cases,
     * since `sys-metadata.object.ts` declares no draft index at all and a fresh
     * boot therefore has none until this migration builds it.
     */
    const PRE_EXISTING_DRAFT_INDEX_DDL =
        'CREATE UNIQUE INDEX `idx_sys_metadata_overlay_draft` on `sys_metadata` ' +
        "(`type`, `name`, `organization_id`, `package_id`) WHERE state = 'draft'";

    const indexDdl = (name: string): string | undefined =>
        (db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as
            | { sql?: string }
            | undefined)?.sql ?? undefined;

    const insert = (
        id: string,
        type: string,
        name: string,
        org: string | null,
        packageId: string | null,
        state: string,
    ): { ok: boolean; error?: string } => {
        try {
            db.prepare(
                'INSERT INTO sys_metadata (id, type, name, organization_id, package_id, state) '
                + 'VALUES (?,?,?,?,?,?)',
            ).run(id, type, name, org, packageId, state);
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    };

    /** Insert bypassing every index, to seed rows the current index admits. */
    const forceInsert = (
        id: string,
        type: string,
        name: string,
        org: string | null,
        packageId: string | null,
        state: string,
    ): void => {
        const outcome = insert(id, type, name, org, packageId, state);
        if (!outcome.ok) throw new Error(`fixture insert rejected: ${outcome.error}`);
    };

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`CREATE TABLE sys_metadata (
            id TEXT PRIMARY KEY, type TEXT, name TEXT,
            organization_id TEXT, package_id TEXT, state TEXT
        );`);
        db.exec(DECLARED_ACTIVE_INDEX_DDL);
        exec = async (sql: string) => db.exec(sql);
    });

    afterEach(() => {
        db.close();
    });

    // ── What the migration is FOR ─────────────────────────────────────────

    it('BEFORE the migration, an ACTIVE and a DRAFT row for one key cannot coexist', () => {
        // The declared index is unrestricted, so it collides rows the platform
        // says are legal — that is the whole reason for two state-scoped indexes.
        expect(insert('a1', 'view', 'lead.list', 'org1', 'pkg1', 'active').ok).toBe(true);
        const draft = insert('d1', 'view', 'lead.list', 'org1', 'pkg1', 'draft');
        expect(draft.ok).toBe(false);
        expect(draft.error).toContain('UNIQUE constraint failed');
    });

    it('AFTER the migration, the ACTIVE+DRAFT pair is legal — and stays legal', async () => {
        const result = await ensureMetadataOverlayIndexes(exec);
        expect(result.active.status).toBe('created');
        expect(result.draft.status).toBe('created');

        expect(insert('a1', 'view', 'lead.list', 'org1', 'pkg1', 'active').ok).toBe(true);
        expect(insert('d1', 'view', 'lead.list', 'org1', 'pkg1', 'draft').ok).toBe(true);
    });

    it('leaves PARTIAL UNIQUE indexes under both official names, and no probe residue', async () => {
        await ensureMetadataOverlayIndexes(exec);

        const active = indexDdl(OVERLAY_INDEX_NAMES.active);
        expect(active).toBeDefined();
        expect(active!.toLowerCase()).toContain('unique');
        expect(active!.toLowerCase()).toContain("where state = 'active'");
        expect(active).toContain("COALESCE(package_id, '')");
        // Reusing the DECLARED name is what stops `syncDeclaredIndexes` — which
        // skips by name — from re-imposing the unrestricted form next boot.
        expect(active).not.toEqual(DECLARED_ACTIVE_INDEX_DDL);

        const draft = indexDdl(OVERLAY_INDEX_NAMES.draft);
        expect(draft!.toLowerCase()).toContain('unique');
        expect(draft!.toLowerCase()).toContain("where state = 'draft'");

        expect(indexDdl(OVERLAY_PROBE_INDEX_NAMES.active)).toBeUndefined();
        expect(indexDdl(OVERLAY_PROBE_INDEX_NAMES.draft)).toBeUndefined();
    });

    it('still rejects two ACTIVE rows, and two DRAFT rows, for one key', async () => {
        await ensureMetadataOverlayIndexes(exec);

        expect(insert('a1', 'view', 'lead.hot', 'org1', 'pkg1', 'active').ok).toBe(true);
        expect(insert('a2', 'view', 'lead.hot', 'org1', 'pkg1', 'active').ok).toBe(false);

        expect(insert('d1', 'view', 'lead.hot', 'org1', 'pkg1', 'draft').ok).toBe(true);
        expect(insert('d2', 'view', 'lead.hot', 'org1', 'pkg1', 'draft').ok).toBe(false);
    });

    it('closes the NULL-distinct hole for package-less rows — which is why a conflict is reachable', async () => {
        // BEFORE: the declared index treats the two NULL package_ids as
        // distinct, so this pair is legal. This is the tightening.
        expect(insert('g1', 'view', 'lead.g', 'org1', null, 'active').ok).toBe(true);
        expect(insert('g2', 'view', 'lead.g', 'org1', null, 'active').ok).toBe(true);
        db.exec("DELETE FROM sys_metadata WHERE id='g2'");

        await ensureMetadataOverlayIndexes(exec);

        // AFTER: COALESCE(package_id, '') folds them into one bucket.
        expect(insert('g3', 'view', 'lead.g', 'org1', null, 'active').ok).toBe(false);
        // …while a real package id still gets its own overlay row.
        expect(insert('g4', 'view', 'lead.g', 'org1', 'pkg1', 'active').ok).toBe(true);
    });

    it('keeps distinct types, names and organizations independent', async () => {
        await ensureMetadataOverlayIndexes(exec);

        expect(insert('i1', 'view', 'lead.x', 'org1', null, 'active').ok).toBe(true);
        expect(insert('i2', 'flow', 'lead.x', 'org1', null, 'active').ok).toBe(true);
        expect(insert('i3', 'view', 'lead.y', 'org1', null, 'active').ok).toBe(true);
        expect(insert('i4', 'view', 'lead.x', 'org2', null, 'active').ok).toBe(true);
    });

    // ── Idempotence ───────────────────────────────────────────────────────

    it('is idempotent — a second run leaves the schema byte-identical', async () => {
        const first = await ensureMetadataOverlayIndexes(exec);
        const afterFirst = [indexDdl(OVERLAY_INDEX_NAMES.active), indexDdl(OVERLAY_INDEX_NAMES.draft)];

        const second = await ensureMetadataOverlayIndexes(exec);
        const afterSecond = [indexDdl(OVERLAY_INDEX_NAMES.active), indexDdl(OVERLAY_INDEX_NAMES.draft)];

        expect(first.active.status).toBe('created');
        expect(second.active.status).toBe('created');
        expect(second.draft.status).toBe('created');
        expect(afterSecond).toEqual(afterFirst);
        expect(indexDdl(OVERLAY_PROBE_INDEX_NAMES.active)).toBeUndefined();
        expect(indexDdl(OVERLAY_PROBE_INDEX_NAMES.draft)).toBeUndefined();
    });

    it('converges from a table that never had either index at all', async () => {
        db.exec(`DROP INDEX ${OVERLAY_INDEX_NAMES.active}`);

        const result = await ensureMetadataOverlayIndexes(exec);

        expect(result.active.status).toBe('created');
        expect(result.draft.status).toBe('created');
        expect(indexDdl(OVERLAY_INDEX_NAMES.active)!.toLowerCase()).toContain("where state = 'active'");
    });

    // ── Degradation: the constraint is never destroyed ────────────────────

    /**
     * The nail of #6418, on a REAL database rather than a mocked throw: seed
     * the duplicate pair the declared NULL-distinct index admits, run the
     * migration, and assert ADR-0120 D4's whole disposition.
     *
     * Under the DROP-then-CREATE order this left `sys_metadata` with no unique
     * index at all and nothing in the log.
     */
    it('a pre-existing duplicate ACTIVE pair blocks the tightening — old index kept, rows named, boot survives', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        // Two package-less ACTIVE rows under one (type, name, org) — legal for
        // the declared index because SQL UNIQUE treats NULLs as DISTINCT.
        forceInsert('g1', 'view', 'lead.dupe', 'org1', null, 'active');
        forceInsert('g2', 'view', 'lead.dupe', 'org1', null, 'active');

        const result = await ensureMetadataOverlayIndexes(exec, logger);

        // Reported, never thrown: a boot must not fail over an index.
        expect(result.active.status).toBe('conflict');
        expect(result.active.detail).toContain('UNIQUE constraint failed');
        // The PREVIOUS index survives byte-for-byte and still enforces what it
        // always did — at no point is the table left unconstrained.
        expect(indexDdl(OVERLAY_INDEX_NAMES.active)).toEqual(DECLARED_ACTIVE_INDEX_DDL);
        expect(insert('k1', 'view', 'lead.k', 'org1', 'pkg1', 'active').ok).toBe(true);
        expect(insert('k2', 'view', 'lead.k', 'org1', 'pkg1', 'active').ok).toBe(false);
        // No probe residue, and no half-built index under the real name.
        expect(indexDdl(OVERLAY_PROBE_INDEX_NAMES.active)).toBeUndefined();
        // No non-UNIQUE fallback is smuggled in on a DATA conflict — the
        // fallback is the DIALECT arm's answer only.
        expect(result.active.fallback).toBe('not-attempted');

        // The two indexes are independent: the draft one still gets built.
        expect(result.draft.status).toBe('created');

        // D4's wording contract: what is not enforced, the rows, the command.
        expect(logger.error).toHaveBeenCalledTimes(1);
        const msg = String(logger.error.mock.calls[0]![0]);
        expect(msg).toContain("COALESCE(package_id, '')");
        expect(msg).toContain('The previous index is left in place');
        expect(msg).toContain('os migrate plan');
        expect(msg).toContain(buildOverlayDuplicateProbeSql('active'));

        // …and that shipped query really does name the offenders, on this very
        // database. It is not a decorative string.
        const offenders = db
            .prepare(buildOverlayDuplicateProbeSql('active'))
            .all() as Array<Record<string, unknown>>;
        expect(offenders).toHaveLength(1);
        expect(offenders[0]!.name).toBe('lead.dupe');
        expect(offenders[0]!.duplicate_rows).toBe(2);
    });

    /**
     * MariaDB shape: `CREATE INDEX IF NOT EXISTS` is understood, `WHERE` is not.
     * The pre-existing UNIQUE index must survive, and the fallback statement
     * must not be able to downgrade it.
     */
    it('a dialect without partial indexes keeps the original index intact and never downgrades it', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const mariadbish: IndexExec = async (sql: string) => {
            if (/where/i.test(sql)) {
                throw new Error(
                    "You have an error in your SQL syntax; check the manual … near 'WHERE state = 'active''",
                );
            }
            return db.exec(sql);
        };

        const result = await ensureOverlayStateIndex(mariadbish, 'active', logger);

        expect(result.status).toBe('unsupported');
        // The fallback statement ran and succeeded — as a NO-OP, because
        // `IF NOT EXISTS` sees the declared index already holding the name. The
        // stronger index is therefore still there, byte-for-byte.
        expect(result.fallback).toBe('ensured');
        expect(indexDdl(OVERLAY_INDEX_NAMES.active)).toEqual(DECLARED_ACTIVE_INDEX_DDL);
        expect(insert('m1', 'view', 'lead.m', 'org1', 'pkg1', 'active').ok).toBe(true);
        expect(insert('m2', 'view', 'lead.m', 'org1', 'pkg1', 'active').ok).toBe(false);

        expect(logger.error).toHaveBeenCalledTimes(1);
        const note = String(logger.error.mock.calls[0]![0]);
        expect(note).toContain('NOT enforced as specified on this dialect');
        expect(note).toContain('never replaced by something weaker');
        expect(note).toContain('deliberately NOT UNIQUE');
        expect(note).toContain('SQLite/PostgreSQL');
        expect(note).toContain(buildOverlayDuplicateProbeSql('active'));
        expect(logger.info).not.toHaveBeenCalled();
    });

    /**
     * #6848 — the same MariaDB refusal, behind a pooled wrapper.
     *
     * This is the consequence the classifier's wrap-depth actually decides, and
     * the reason the dialect arm was given the `cause` walk rather than a doc
     * comment. The fallback lookup index is built on the `unsupported` branch
     * and on no other, so while the second arm stopped at the outer message this
     * case graded `failed` and the degradation target was never attempted — the
     * dialect's answer was present, one step down, and unread.
     */
    it('a POOLED wrapper around the dialect refusal still reaches the fallback index (#6848)', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const pooled: IndexExec = async (sql: string) => {
            if (/where/i.test(sql)) {
                throw Object.assign(new Error('Write failed'), {
                    cause: new Error(
                        "You have an error in your SQL syntax; check the manual … near 'WHERE state = 'active''",
                    ),
                });
            }
            return db.exec(sql);
        };

        const result = await ensureOverlayStateIndex(pooled, 'active', logger);

        expect(result.status).toBe('unsupported');
        // The whole point: `not-attempted` here would mean the dialect that
        // cannot take the partial form silently got no lookup index either.
        expect(result.fallback).toBe('ensured');
        // `detail` stays the operator-facing OUTER prose, unchanged.
        expect(result.detail).toBe('Write failed');
        // Nothing was downgraded — the declared UNIQUE index is byte-for-byte there.
        expect(indexDdl(OVERLAY_INDEX_NAMES.active)).toEqual(DECLARED_ACTIVE_INDEX_DDL);
        expect(insert('w1', 'view', 'lead.w', 'org1', 'pkg1', 'active').ok).toBe(true);
        expect(insert('w2', 'view', 'lead.w', 'org1', 'pkg1', 'active').ok).toBe(false);
        expect(String(logger.error.mock.calls[0]![0])).toContain('NOT enforced as specified on this dialect');
    });

    /**
     * MySQL proper, where the old code was safe only by ACCIDENT: it has
     * neither `DROP INDEX IF EXISTS` nor `CREATE INDEX IF NOT EXISTS`, so every
     * statement this migration issues is refused. Nothing may be touched, and
     * the report must say the degradation target could not be built either.
     */
    it('MySQL refuses every statement — nothing is touched, and the report says so', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const mysqlish: IndexExec = async (sql: string) => {
            throw new Error(`You have an error in your SQL syntax near '${sql.slice(0, 24)}'`);
        };

        const result = await ensureOverlayStateIndex(mysqlish, 'active', logger);

        expect(result.status).toBe('unsupported');
        expect(result.fallback).toBe('refused');
        expect(indexDdl(OVERLAY_INDEX_NAMES.active)).toEqual(DECLARED_ACTIVE_INDEX_DDL);
        expect(String(logger.error.mock.calls[0]![0])).toContain('no index was added');
    });

    it('a conflict in MySQL wording takes the same disposition', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const conflicting: IndexExec = async (sql: string) => {
            if (/CREATE UNIQUE INDEX/i.test(sql)) {
                throw new Error("Duplicate entry 'view-lead.dupe-org1-' for key 'idx_sys_metadata_overlay_active'");
            }
            return db.exec(sql);
        };

        const result = await ensureOverlayStateIndex(conflicting, 'active', logger);

        expect(result.status).toBe('conflict');
        expect(indexDdl(OVERLAY_INDEX_NAMES.active)).toEqual(DECLARED_ACTIVE_INDEX_DDL);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(String(logger.error.mock.calls[0]![0])).toContain('os migrate plan');
    });

    it('an unclassifiable failure is reported at error and leaves the index alone', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const broken: IndexExec = async (sql: string) => {
            if (/CREATE UNIQUE INDEX/i.test(sql)) throw new Error('disk I/O error');
            return db.exec(sql);
        };

        const result = await ensureOverlayStateIndex(broken, 'active', logger);

        expect(result.status).toBe('failed');
        expect(result.fallback).toBe('not-attempted');
        expect(indexDdl(OVERLAY_INDEX_NAMES.active)).toEqual(DECLARED_ACTIVE_INDEX_DDL);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(String(logger.error.mock.calls[0]![0])).toContain('can still coexist');
    });

    /**
     * The one branch where the real name CAN end up empty: another process
     * changed the data between the probe and the rebuild. It is unreachable by
     * design and reported at the loudest level anyway, because it is the only
     * state in which the operator has to act now.
     */
    it('a race between the probe and the rebuild is named, not swallowed', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const racing: IndexExec = async (sql: string) => {
            // ⚠️ The probe name has the real name as a PREFIX, so "contains the
            // real name" also matches the probe statement. Match the probe out
            // explicitly or this mock fails the probe instead of the rebuild.
            const isProbe = sql.includes(OVERLAY_PROBE_INDEX_NAMES.active);
            if (!isProbe && sql.includes(OVERLAY_INDEX_NAMES.active) && /CREATE UNIQUE INDEX/i.test(sql)) {
                throw new Error('database is locked');
            }
            return db.exec(sql);
        };

        const result = await ensureOverlayStateIndex(racing, 'active', logger);

        expect(result.status).toBe('failed');
        expect(logger.error).toHaveBeenCalledTimes(1);
        const msg = String(logger.error.mock.calls[0]![0]);
        expect(msg).toContain('after the probe succeeded');
        expect(msg).toContain('may currently have NO unique index');
    });

    it('a host with no raw-SQL driver is a silent no-op, not a failure', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const result = await ensureMetadataOverlayIndexes(undefined, logger);
        expect(result.active.status).toBe('no-driver');
        expect(result.draft.status).toBe('no-driver');
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    // ── The DRAFT section gets the same treatment ─────────────────────────

    it('a duplicate DRAFT pair keeps the pre-existing draft index — and the active one still lands', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        // The draft index a pre-#6418 deployment can be carrying: state-scoped
        // but NULL-distinct on `package_id`, so two package-less DRAFT rows
        // under one (type, name, org) are legal for it and rejected by the
        // `COALESCE(package_id, '')` key. Exactly the tightening that fails.
        db.exec(PRE_EXISTING_DRAFT_INDEX_DDL);
        forceInsert('x1', 'view', 'lead.e', 'org1', null, 'draft');
        forceInsert('x2', 'view', 'lead.e', 'org1', null, 'draft');
        const draftDdlBefore = indexDdl(OVERLAY_INDEX_NAMES.draft);

        const result = await ensureMetadataOverlayIndexes(exec, logger);

        expect(result.draft.status).toBe('conflict');
        // Byte-for-byte survival of the draft index.
        expect(indexDdl(OVERLAY_INDEX_NAMES.draft)).toEqual(draftDdlBefore);
        expect(indexDdl(OVERLAY_PROBE_INDEX_NAMES.draft)).toBeUndefined();
        // …and it still enforces what it always did.
        expect(insert('y1', 'view', 'lead.f', 'org1', 'pkg1', 'draft').ok).toBe(true);
        expect(insert('y2', 'view', 'lead.f', 'org1', 'pkg1', 'draft').ok).toBe(false);
        // The ACTIVE index is unaffected by the draft conflict.
        expect(result.active.status).toBe('created');
        expect(indexDdl(OVERLAY_INDEX_NAMES.active)!.toLowerCase()).toContain("where state = 'active'");

        expect(logger.error).toHaveBeenCalledTimes(1);
        const msg = String(logger.error.mock.calls[0]![0]);
        expect(msg).toContain(OVERLAY_INDEX_NAMES.draft);
        expect(msg).toContain("state='draft'");
        expect(msg).toContain(buildOverlayDuplicateProbeSql('draft'));
        const offenders = db
            .prepare(buildOverlayDuplicateProbeSql('draft'))
            .all() as Array<Record<string, unknown>>;
        expect(offenders.map((o) => o.name)).toEqual(['lead.e']);
    });

    it('a dialect refusal on the DRAFT index reports it under the draft name', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const mariadbish: IndexExec = async (sql: string) => {
            if (/where/i.test(sql)) throw new Error("near 'WHERE state': syntax error");
            return db.exec(sql);
        };

        const result = await ensureOverlayStateIndex(mariadbish, 'draft', logger);

        expect(result.status).toBe('unsupported');
        expect(result.fallback).toBe('ensured');
        // Nothing partial survives, and the composite lookup index is what the
        // name now holds — non-UNIQUE, so the ACTIVE+DRAFT pair stays legal.
        expect(indexDdl(OVERLAY_INDEX_NAMES.draft)!.toLowerCase()).not.toContain('unique');
        expect(String(logger.error.mock.calls[0]![0])).toContain(OVERLAY_INDEX_NAMES.draft);
    });

    it('the ACTIVE+DRAFT pair stays legal even after BOTH indexes degrade', async () => {
        const mariadbish: IndexExec = async (sql: string) => {
            if (/where/i.test(sql)) throw new Error("near 'WHERE state': syntax error");
            return db.exec(sql);
        };
        // Start from a table with no unrestricted UNIQUE, so the degradation
        // target is the only index either name holds.
        db.exec(`DROP INDEX ${OVERLAY_INDEX_NAMES.active}`);

        const result = await ensureMetadataOverlayIndexes(mariadbish);

        expect(result.active.status).toBe('unsupported');
        expect(result.draft.status).toBe('unsupported');
        // The whole reason the fallback may never become a full UNIQUE.
        expect(insert('c1', 'view', 'lead.c', 'org1', 'pkg1', 'active').ok).toBe(true);
        expect(insert('c2', 'view', 'lead.c', 'org1', 'pkg1', 'draft').ok).toBe(true);
    });

    // ── Seams ─────────────────────────────────────────────────────────────

    /**
     * #6418 is an ORDER and REPORTING fix. The key spelling it inherited is
     * pinned as a literal — byte-identical to what `protocol.ts` issued before
     * — so a later "while we are in here" re-keying cannot ride in unnoticed:
     * re-partitioning a live unique index needs its own ADR-0120 D4 ceremony.
     */
    it('pins the key spelling, unchanged by this fix', () => {
        expect(OVERLAY_INDEX_COLUMNS).toEqual(['type', 'name', 'organization_id', 'package_id']);
        expect(OVERLAY_NULL_SENTINELS).toEqual({ package_id: '' });
        expect(overlayIndexKeyParts()).toEqual([
            'type',
            'name',
            'organization_id',
            "COALESCE(package_id, '')",
        ]);
        expect(buildOverlayIndexSql(OVERLAY_INDEX_NAMES.active, 'active')).toEqual(
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active '
            + "ON sys_metadata (type, name, organization_id, COALESCE(package_id, '')) "
            + "WHERE state = 'active'",
        );
        expect(buildOverlayIndexSql(OVERLAY_INDEX_NAMES.draft, 'draft')).toEqual(
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_metadata_overlay_draft '
            + "ON sys_metadata (type, name, organization_id, COALESCE(package_id, '')) "
            + "WHERE state = 'draft'",
        );
    });

    /**
     * The scope caution, as a test. A full UNIQUE here would reject the ACTIVE
     * + DRAFT coexistence this table is built on, which is the key difference
     * from `sys_view_definition`.
     */
    it('the dialect fallback is NOT unique, and never drops anything first', () => {
        const sql = buildOverlayFallbackIndexSql(OVERLAY_INDEX_NAMES.active);
        expect(sql).toEqual(
            'CREATE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active '
            + 'ON sys_metadata (type, name, organization_id, package_id)',
        );
        expect(sql.toUpperCase()).not.toContain('UNIQUE');
        expect(sql).toContain('IF NOT EXISTS');
    });

    /**
     * The duplicate-listing query projects the nullable column through the SAME
     * `COALESCE` it groups by. A bare `package_id` projection would be rejected
     * by PostgreSQL ("must appear in the GROUP BY clause"), and this query has
     * to run on both dialects that can build the index it explains.
     */
    it('the duplicate-listing query is groupable on PostgreSQL, not only SQLite', () => {
        const sql = buildOverlayDuplicateProbeSql('active');
        expect(sql).toEqual(
            'SELECT type, name, organization_id, '
            + "COALESCE(package_id, '') AS package_id_key, COUNT(*) AS duplicate_rows "
            + "FROM sys_metadata WHERE state = 'active' "
            + "GROUP BY type, name, organization_id, COALESCE(package_id, '') HAVING COUNT(*) > 1",
        );
        // Every bare projection is a bare GROUP BY term; the folded one is
        // projected only through its own expression.
        expect(sql).not.toMatch(/SELECT [^,]*, package_id,/);
    });
});
