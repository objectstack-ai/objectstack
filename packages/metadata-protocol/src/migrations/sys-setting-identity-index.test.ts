// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    buildSysSettingDuplicateProbeSql,
    buildSysSettingIdentityIndexSql,
    buildSysSettingPresenceSql,
    ensureSysSettingIdentityIndex,
    resolveSysSettingIndexExec,
    sysSettingIdentityKeyParts,
    SYS_SETTING_IDENTITY_INDEX_COLUMNS,
    SYS_SETTING_IDENTITY_INDEX_NAME,
    SYS_SETTING_IDENTITY_PROBE_INDEX_NAME,
    SYS_SETTING_NULL_SENTINELS,
    SYS_SETTING_TABLE,
} from './sys-setting-identity-index.js';
import type { IndexExec } from './partial-index-probe.js';

/**
 * `sys_setting` — the declared row identity, made real (#8629).
 *
 * Every assertion here runs against a REAL SQLite database, because the defect
 * is a claim about what a UNIQUE index does with NULLs that no test ever asked a
 * database to confirm — and because the fix is a tightening, whose one
 * interesting failure mode (existing duplicates) only exists over real rows.
 *
 * Uses Node's built-in `node:sqlite` rather than `better-sqlite3` (which the
 * driver packages use), for the reason both sibling migration suites give: this
 * package needs no SQL dependency of its own, and the built-in gives the same
 * real SQLite — real UNIQUE enforcement, real NULL-distinctness — for free.
 */
describe('sys_setting row-identity uniqueness (#8629)', () => {
    let db: DatabaseSync;
    let exec: IndexExec;

    /**
     * ⚠️ MEASURED, not assembled: this is byte for byte what
     * `SqlDriver.syncDeclaredIndexes` emits on SQLite for the shipped
     * declaration `{ fields: ['namespace','key','scope','user_id'], unique:
     * 'organization' }` after #8555 — captured by running the real driver over
     * the real declaration, the same way the sibling suites source their
     * fixtures. It is the NULL-safe-on-organization, NULL-DISTINCT-on-user_id
     * index this migration exists to replace, and what it must not destroy.
     */
    const DECLARED_INDEX_DDL =
        'CREATE UNIQUE INDEX `uniq_sys_setting_organization_id_namespace_key_scope_user_id` ' +
        "ON `sys_setting` (COALESCE(`organization_id`, '__global__'), `namespace`, `key`, `scope`, `user_id`)";

    const indexDdl = (name: string): string | undefined =>
        (db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as
            | { sql?: string }
            | undefined)?.sql ?? undefined;

    /**
     * Explicitly created indexes only — `sql IS NOT NULL` drops SQLite's
     * implicit `sqlite_autoindex_*` for the PRIMARY KEY, which nothing here
     * creates or may touch.
     */
    const indexNames = (): string[] =>
        (
            db
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? " +
                        'AND sql IS NOT NULL ORDER BY name',
                )
                .all(SYS_SETTING_TABLE) as Array<{ name: string }>
        ).map((r) => r.name);

    const rowCount = (): number =>
        (db.prepare('SELECT COUNT(*) AS n FROM sys_setting').get() as { n: number }).n;

    /**
     * One settings row, written the way `SettingsService.set` writes them:
     * `user_id` is the caller's id on the `user` layer and NULL on every other,
     * which is the whole mechanism under test.
     */
    const insert = (
        id: string,
        over: {
            organization_id?: string | null;
            namespace?: string;
            key?: string;
            scope?: string;
            user_id?: string | null;
        } = {},
    ): { ok: boolean; error?: string } => {
        const r = {
            organization_id: null as string | null,
            namespace: 'lifecycle',
            key: 'retention_overrides',
            scope: 'tenant',
            user_id: null as string | null,
            ...over,
        };
        try {
            db.prepare(
                'INSERT INTO sys_setting (id, organization_id, namespace, key, scope, user_id, value) ' +
                    'VALUES (?,?,?,?,?,?,?)',
            ).run(id, r.organization_id, r.namespace, r.key, r.scope, r.user_id, '"v"');
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    };

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`CREATE TABLE sys_setting (
            id TEXT PRIMARY KEY, organization_id TEXT, namespace TEXT, key TEXT,
            scope TEXT, user_id TEXT, value TEXT
        );`);
        db.exec(DECLARED_INDEX_DDL);
        exec = async (sql: string) => db.exec(sql);
    });

    afterEach(() => {
        db.close();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 1. The defect, on a real engine, before and after
    // ─────────────────────────────────────────────────────────────────────────

    it('BEFORE: the declared index constrains nothing on the tenant and global layers', () => {
        // The card's measurement, reproduced against the real declared DDL. Both
        // inserts land: SQL UNIQUE treats the two NULL `user_id`s as distinct.
        expect(insert('a', { organization_id: 'org_jia' }).ok).toBe(true);
        expect(insert('b', { organization_id: 'org_jia' }).ok).toBe(true);
        expect(insert('g1', { scope: 'global', key: 'smtp_host' }).ok).toBe(true);
        expect(insert('g2', { scope: 'global', key: 'smtp_host' }).ok).toBe(true);
        expect(rowCount()).toBe(4);

        // The control that identifies the mechanism: with a non-NULL user_id the
        // very same rows ARE constrained. It is the NULL, not the layer.
        expect(insert('u1', { organization_id: 'org_jia', scope: 'user', user_id: 'usr_1' }).ok).toBe(true);
        expect(insert('u2', { organization_id: 'org_jia', scope: 'user', user_id: 'usr_1' }).ok).toBe(false);
    });

    it('AFTER: a same-organization tenant-scope duplicate is refused', async () => {
        expect(await ensureSysSettingIdentityIndex(exec)).toEqual({ status: 'created' });

        expect(insert('a', { organization_id: 'org_jia' }).ok).toBe(true);
        const dup = insert('b', { organization_id: 'org_jia' });
        expect(dup.ok).toBe(false);
        expect(dup.error).toContain(SYS_SETTING_IDENTITY_INDEX_NAME);
    });

    it('AFTER: two platform defaults on the global layer are refused', async () => {
        await ensureSysSettingIdentityIndex(exec);

        expect(insert('g1', { scope: 'global', namespace: 'mail', key: 'smtp_host' }).ok).toBe(true);
        expect(insert('g2', { scope: 'global', namespace: 'mail', key: 'smtp_host' }).ok).toBe(false);
    });

    it('AFTER (anti-vacuity): the key stays PER-ORGANIZATION — two organizations may hold it', async () => {
        // The tightening must not become the installation-wide constraint #8555
        // just finished relaxing. Without this, "duplicates are refused" would
        // also be satisfied by a strictly worse index.
        await ensureSysSettingIdentityIndex(exec);

        expect(insert('a', { organization_id: 'org_jia' }).ok).toBe(true);
        expect(insert('b', { organization_id: 'org_yi' }).ok).toBe(true);
    });

    it('AFTER: the user layer is unchanged — same user refused, different user allowed', async () => {
        await ensureSysSettingIdentityIndex(exec);

        expect(insert('u1', { organization_id: 'org_jia', scope: 'user', user_id: 'usr_1' }).ok).toBe(true);
        expect(insert('u2', { organization_id: 'org_jia', scope: 'user', user_id: 'usr_1' }).ok).toBe(false);
        expect(insert('u3', { organization_id: 'org_jia', scope: 'user', user_id: 'usr_2' }).ok).toBe(true);
    });

    it('AFTER: the scope column still separates the layers', async () => {
        // `scope` is a key column, so one (namespace, key) may hold one row per
        // layer. A tightening that collapsed the layers would break the cascade.
        await ensureSysSettingIdentityIndex(exec);

        expect(insert('t', { organization_id: 'org_jia', scope: 'tenant' }).ok).toBe(true);
        expect(insert('g', { organization_id: 'org_jia', scope: 'global' }).ok).toBe(true);
        expect(
            insert('u', { organization_id: 'org_jia', scope: 'user', user_id: 'usr_1' }).ok,
        ).toBe(true);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. The index that ends up on the table
    // ─────────────────────────────────────────────────────────────────────────

    it('claims the DECLARED name, so a later boot never re-imposes the NULL-distinct form', async () => {
        await ensureSysSettingIdentityIndex(exec);

        // `syncDeclaredIndexes` skips by name — the slot being occupied by THIS
        // definition is the entire durability mechanism.
        //
        // Compared against the builder's own output rather than a hand-written
        // string, so the two can never drift; `sqlite_master` records the
        // statement verbatim EXCEPT for the `IF NOT EXISTS` clause, which it
        // normalizes away.
        expect(indexDdl(SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(
            buildSysSettingIdentityIndexSql(SYS_SETTING_IDENTITY_INDEX_NAME).replace(
                'IF NOT EXISTS ',
                '',
            ),
        );
        expect(indexNames()).toEqual([SYS_SETTING_IDENTITY_INDEX_NAME]);
    });

    it('leaves no probe index behind', async () => {
        await ensureSysSettingIdentityIndex(exec);
        expect(indexDdl(SYS_SETTING_IDENTITY_PROBE_INDEX_NAME)).toBeUndefined();
    });

    it('is idempotent — a second run leaves a byte-identical definition', async () => {
        await ensureSysSettingIdentityIndex(exec);
        const first = indexDdl(SYS_SETTING_IDENTITY_INDEX_NAME);
        expect(await ensureSysSettingIdentityIndex(exec)).toEqual({ status: 'created' });
        expect(indexDdl(SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(first);
    });

    it('the table itself is untouched — the rows keep their NULLs', async () => {
        insert('a', { organization_id: 'org_jia' });
        await ensureSysSettingIdentityIndex(exec);

        // ADR-0120 D3's invariant: only the INDEX folds NULL into a bucket. A
        // sentinel that reached storage would be a silent data rewrite.
        expect(rowCount()).toBe(1);
        expect(
            (db.prepare('SELECT user_id, organization_id FROM sys_setting WHERE id=?').get('a') as {
                user_id: unknown;
                organization_id: unknown;
            }),
        ).toEqual({ user_id: null, organization_id: 'org_jia' });
        expect(db.prepare("SELECT COUNT(*) AS n FROM sys_setting WHERE user_id = ''").get()).toEqual({
            n: 0,
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Refuse-to-migrate — the maintainer's ruling, on a duplicate-carrying
    //    database (2026-08-14: never keep-newest)
    // ─────────────────────────────────────────────────────────────────────────

    describe('a database that already accumulated duplicates', () => {
        beforeEach(() => {
            // Exactly what the void constraint has been permitting all along.
            insert('d1', { organization_id: 'org_jia' });
            insert('d2', { organization_id: 'org_jia' });
        });

        it('refuses, and DELETES NOTHING', async () => {
            const result = await ensureSysSettingIdentityIndex(exec);

            expect(result.status).toBe('conflict');
            // The ruling, asserted as behaviour rather than as a comment: both
            // admin-authored rows survive, in their original form.
            expect(rowCount()).toBe(2);
            expect(
                (db.prepare('SELECT id FROM sys_setting ORDER BY id').all() as Array<{ id: string }>).map(
                    (r) => r.id,
                ),
            ).toEqual(['d1', 'd2']);
        });

        it('leaves the PREVIOUS index in place, byte for byte, and still enforcing', async () => {
            await ensureSysSettingIdentityIndex(exec);

            expect(indexDdl(SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(DECLARED_INDEX_DDL);
            expect(indexDdl(SYS_SETTING_IDENTITY_PROBE_INDEX_NAME)).toBeUndefined();
            // Not merely present — still doing its job on the limb it did cover.
            expect(insert('u1', { organization_id: 'org_jia', scope: 'user', user_id: 'usr_1' }).ok).toBe(
                true,
            );
            expect(insert('u2', { organization_id: 'org_jia', scope: 'user', user_id: 'usr_1' }).ok).toBe(
                false,
            );
        });

        it('reports at ERROR, naming what is not enforced, the refusal, and the row query', async () => {
            const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
            await ensureSysSettingIdentityIndex(exec, logger);

            // `error`, not `warn`: the platform keeps looking healthy while a row
            // identity it states it enforces is void (AGENTS.md durability rule).
            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.warn).not.toHaveBeenCalled();
            const [message] = logger.error.mock.calls[0]!;
            expect(message).toContain(SYS_SETTING_IDENTITY_INDEX_NAME);
            expect(message).toContain('The previous index is left in place');
            expect(message).toContain('no row is discarded automatically');
            expect(message).toContain(buildSysSettingDuplicateProbeSql());
            expect(message).toContain('os migrate plan');
        });

        it('the shipped query lists the offending rows, on the folded key', () => {
            const rows = db.prepare(buildSysSettingDuplicateProbeSql()).all() as Array<
                Record<string, unknown>
            >;

            expect(rows).toEqual([
                {
                    organization_id_key: 'org_jia',
                    namespace: 'lifecycle',
                    key: 'retention_overrides',
                    scope: 'tenant',
                    user_id_key: '',
                    duplicate_rows: 2,
                },
            ]);
        });

        it('keeps refusing until an operator resolves it — and then converges', async () => {
            expect((await ensureSysSettingIdentityIndex(exec)).status).toBe('conflict');
            // The operator's decision, made by the operator.
            db.prepare('DELETE FROM sys_setting WHERE id=?').run('d2');
            expect(await ensureSysSettingIdentityIndex(exec)).toEqual({ status: 'created' });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. The SQL, pinned
    // ─────────────────────────────────────────────────────────────────────────

    describe('the statements', () => {
        it('folds exactly the two nullable key columns, with the precedents’ sentinels', () => {
            // Both literals are load-bearing and neither is this module's to
            // choose: '__global__' is ADR-0120 D3 / `SqlDriver.GLOBAL_TENANT`,
            // and '' is `ensureOverlayIndex`'s spelling for a non-tenant
            // nullable discriminator. Editing either re-partitions the index.
            expect(SYS_SETTING_NULL_SENTINELS).toEqual({ organization_id: '__global__', user_id: '' });
            expect(sysSettingIdentityKeyParts()).toEqual([
                "COALESCE(organization_id, '__global__')",
                'namespace',
                'key',
                'scope',
                "COALESCE(user_id, '')",
            ]);
        });

        it('keys on the driver’s normalized column order — tenant column first', () => {
            expect(SYS_SETTING_IDENTITY_INDEX_COLUMNS).toEqual([
                'organization_id',
                'namespace',
                'key',
                'scope',
                'user_id',
            ]);
        });

        it('builds an UNRESTRICTED unique index — this table has no active-row subset', () => {
            expect(buildSysSettingIdentityIndexSql(SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(
                'CREATE UNIQUE INDEX IF NOT EXISTS ' +
                    'uniq_sys_setting_organization_id_namespace_key_scope_user_id ON sys_setting ' +
                    "(COALESCE(organization_id, '__global__'), namespace, key, scope, COALESCE(user_id, ''))",
            );
            expect(buildSysSettingIdentityIndexSql(SYS_SETTING_IDENTITY_INDEX_NAME)).not.toMatch(/where/i);
        });

        it('the index name is the DECLARED one, on the 60-character boundary', () => {
            // One more character and the driver emits a sha1-suffixed truncation
            // instead, and this constant would silently stop naming the declared
            // index — the failure that makes the whole migration a no-op.
            expect(SYS_SETTING_IDENTITY_INDEX_NAME).toBe(
                'uniq_sys_setting_organization_id_namespace_key_scope_user_id',
            );
            expect(SYS_SETTING_IDENTITY_INDEX_NAME).toHaveLength(60);
        });

        it('the probe name fits every dialect’s identifier limit', () => {
            // PostgreSQL truncates at 63 bytes and MySQL errors at 64, so the
            // usual `<declared>_probe` spelling — 66 here — is not available.
            expect(SYS_SETTING_IDENTITY_PROBE_INDEX_NAME.length).toBeLessThanOrEqual(63);
            expect(SYS_SETTING_IDENTITY_PROBE_INDEX_NAME).not.toBe(SYS_SETTING_IDENTITY_INDEX_NAME);
        });

        it('the duplicate query groups by exactly the index’s own key parts', () => {
            const sql = buildSysSettingDuplicateProbeSql();
            expect(sql).toContain(`GROUP BY ${sysSettingIdentityKeyParts().join(', ')}`);
            // Every folded column is projected through its OWN coalesce, never
            // bare: PostgreSQL rejects a bare projection of a column that appears
            // in GROUP BY only inside an expression (#6772), and this query has
            // to be legal on both dialects that can build the index.
            expect(sql).toContain("COALESCE(organization_id, '__global__') AS organization_id_key");
            expect(sql).toContain("COALESCE(user_id, '') AS user_id_key");
            expect(sql).not.toMatch(/SELECT organization_id,/);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 5. The hosts where there is nothing to do — and nothing to say
    // ─────────────────────────────────────────────────────────────────────────

    describe('composition and dialect', () => {
        it('no sys_setting table: a silent no-op, not a degradation report', async () => {
            const bare = new DatabaseSync(':memory:');
            const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
            const statements: string[] = [];
            const bareExec: IndexExec = async (sql: string) => {
                statements.push(sql);
                return bare.exec(sql);
            };

            expect(await ensureSysSettingIdentityIndex(bareExec, logger)).toEqual({ status: 'absent' });
            // `service-settings` is optional, so this is an ordinary kernel
            // composition — reporting it every boot is how the real degradation
            // lines below stop being read.
            expect(logger.error).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            // And nothing was issued at the database beyond the presence probe.
            expect(statements).toEqual([buildSysSettingPresenceSql()]);
            bare.close();
        });

        it('the presence probe reads no rows and writes nothing', () => {
            insert('a', { organization_id: 'org_jia' });
            expect(db.prepare(buildSysSettingPresenceSql()).all()).toEqual([]);
            expect(rowCount()).toBe(1);
        });

        it('no raw-SQL driver: a no-op', async () => {
            const logger = { error: vi.fn(), warn: vi.fn() };
            expect(await ensureSysSettingIdentityIndex(undefined, logger)).toEqual({
                status: 'no-driver',
            });
            expect(logger.error).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('a dialect that rejects functional key parts: degraded, previous index intact', async () => {
            const logger = { error: vi.fn(), warn: vi.fn() };
            const refusing: IndexExec = async (sql: string) => {
                if (/^CREATE UNIQUE INDEX/i.test(sql)) {
                    throw new Error("You have an error in your SQL syntax near '(COALESCE'");
                }
                return db.exec(sql);
            };

            const result = await ensureSysSettingIdentityIndex(refusing, logger);

            expect(result.status).toBe('unsupported');
            expect(indexDdl(SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(DECLARED_INDEX_DDL);
            const [message] = logger.error.mock.calls[0]!;
            expect(message).toContain('stays NULL-distinct on user_id');
            expect(message).toContain(buildSysSettingDuplicateProbeSql());
        });

        it('an unclassifiable failure is still reported at error, with the previous index kept', async () => {
            const logger = { error: vi.fn(), warn: vi.fn() };
            const broken: IndexExec = async (sql: string) => {
                if (/^CREATE UNIQUE INDEX/i.test(sql)) throw new Error('disk I/O error');
                return db.exec(sql);
            };

            expect((await ensureSysSettingIdentityIndex(broken, logger)).status).toBe('failed');
            expect(indexDdl(SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(DECLARED_INDEX_DDL);
            expect(logger.error).toHaveBeenCalledTimes(1);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 6. The seam
    // ─────────────────────────────────────────────────────────────────────────

    describe('resolveSysSettingIndexExec', () => {
        it('asks which driver owns sys_setting, not the engine-wide default', async () => {
            const owner = { raw: vi.fn(async () => 'owned') };
            const engine = {
                getDriverForObject: vi.fn(() => owner),
                driver: { raw: vi.fn(async () => 'default') },
            };

            const resolved = resolveSysSettingIndexExec(engine);
            await resolved?.('SELECT 1');

            expect(engine.getDriverForObject).toHaveBeenCalledWith(SYS_SETTING_TABLE);
            expect(owner.raw).toHaveBeenCalledWith('SELECT 1');
            expect(engine.driver.raw).not.toHaveBeenCalled();
        });

        it('returns undefined on a host with no raw-SQL-capable driver', () => {
            expect(resolveSysSettingIndexExec({ getDriverForObject: () => ({}) })).toBeUndefined();
            expect(resolveSysSettingIndexExec(undefined)).toBeUndefined();
        });

        it('does not throw when the engine rejects a driver lookup', () => {
            // `ObjectQL.getDriver` throws rather than returning undefined; a boot
            // hook must not inherit that.
            expect(
                resolveSysSettingIndexExec({
                    getDriverForObject: () => {
                        throw new Error('No driver available');
                    },
                }),
            ).toBeUndefined();
        });
    });
});
