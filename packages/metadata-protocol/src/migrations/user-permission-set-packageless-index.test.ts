// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';
import { inspect } from 'node:util';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    USER_PERMISSION_SET_OLD_KEY_INDEX_NAME,
    USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME,
    USER_PERMISSION_SET_PACKAGELESS_SHADOW_COLUMN,
    USER_PERMISSION_SET_TABLE,
    buildUserPermissionSetOldKeySql,
    buildUserPermissionSetPackagelessDuplicateProbeSql,
    buildUserPermissionSetPackagelessIndexSql,
    buildUserPermissionSetPackagelessMariaDbKeySql,
    buildUserPermissionSetPackagelessMariaDbSql,
    ensureUserPermissionSetPackagelessIndex,
} from './user-permission-set-packageless-index.js';
import type { IndexExec } from './partial-index-probe.js';

/**
 * `sys_user_permission_set` — one grant per `(user_id, permission_set,
 * organization_id)` among the grants that name no package, beside the declared
 * NULL-distinct `(user_id, permission_set, permission_set_package,
 * organization_id)` key (ADR-0150 D4, #32164).
 *
 * Real SQLite (`node:sqlite`), because the claim is about what a UNIQUE index
 * does with NULLs over real rows. PostgreSQL is measured in the
 * `.live-dialects.test.ts` sibling.
 */
describe('sys_user_permission_set: one package-less grant per (user_id, permission_set, organization_id)', () => {
    let db: DatabaseSync;
    let exec: IndexExec;

    /**
     * What `SqlDriver.syncDeclaredIndexes` builds on SQLite for the declared key
     * `{ fields: ['user_id', 'permission_set', 'permission_set_package', 'organization_id'], unique: 'global' }`:
     * a plain, NULL-distinct UNIQUE.
     */
    const DECLARED_INDEX_DDL =
        'CREATE UNIQUE INDEX `uniq_sys_user_permission_set_declared` on `sys_user_permission_set` ' +
        '(`user_id`, `permission_set`, `permission_set_package`, `organization_id`)';
    /** The key this one replaced, as the driver built it for `unique: 'organization'` with the tenant column listed. */
    const OLD_INDEX_DDL =
        'CREATE UNIQUE INDEX `uniq_sys_user_permission_set_old` on `sys_user_permission_set` ' +
        '(`user_id`, `permission_set`, `organization_id`)';

    const createTable = (handle: DatabaseSync, ddl: string): void => {
        handle.exec(`CREATE TABLE ${USER_PERMISSION_SET_TABLE} (
            id TEXT PRIMARY KEY, user_id TEXT, permission_set TEXT, permission_set_package TEXT, organization_id TEXT
        );`);
        handle.exec(ddl);
    };
    const insertInto = (handle: DatabaseSync) => (
        id: string,
        pkg: string | null,
        org: string | null = 'org_1',
        set = 'sales_rep',
        user = 'u1',
    ): boolean => {
        try {
            handle
                .prepare(
                    `INSERT INTO ${USER_PERMISSION_SET_TABLE} (id, user_id, permission_set, permission_set_package, organization_id) VALUES (?, ?, ?, ?, ?)`,
                )
                .run(id, user, set, pkg, org);
            return true;
        } catch {
            return false;
        }
    };
    let insert: ReturnType<typeof insertInto>;
    const indexDdl = (name: string): string | undefined =>
        (db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as { sql?: string } | undefined)
            ?.sql ?? undefined;
    const logger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        createTable(db, DECLARED_INDEX_DDL);
        insert = insertInto(db);
        // A SELECT answers its rows (as knex's raw terminal does), so the
        // duplicated keys a refusal names are read from real rows.
        exec = async (sql: string) => (/^\s*SELECT/i.test(sql) ? db.prepare(sql).all() : db.exec(sql));
    });

    afterEach(() => db.close());

    it('without it, the declared key admits two package-less grants of one set (the hole this closes)', () => {
        expect(insert('a', null)).toBe(true);
        expect(insert('b', null)).toBe(true);
    });

    it('with it, a second package-less grant of one (user, set, organization) is refused', async () => {
        const log = logger();
        expect(await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'better-sqlite3' })).toEqual({ status: 'created' });
        expect(indexDdl(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME)).toContain('WHERE permission_set_package IS NULL');

        expect(insert('a', null)).toBe(true);
        expect(insert('b', null)).toBe(false);
        // Another user, set or organization is another key.
        expect(insert('c', null, 'org_1', 'sales_rep', 'u2')).toBe(true);
        expect(insert('d', null, 'org_1', 'auditor')).toBe(true);
        expect(insert('e', null, 'org_2')).toBe(true);
        expect(log.error).not.toHaveBeenCalled();
    });

    it('leaves packaged grants to the declared key: two packages admitted, one package twice refused', async () => {
        await ensureUserPermissionSetPackagelessIndex(exec, logger(), { client: 'better-sqlite3' });
        expect(insert('a', null)).toBe(true);
        expect(insert('p1', 'com.acme.crm')).toBe(true);
        expect(insert('p2', 'com.acme.hr')).toBe(true);
        expect(insert('p1b', 'com.acme.crm')).toBe(false);
    });

    /**
     * Epic condition 1: nothing the old key refused is admitted. Measured side by
     * side over the same rows, with a null and a non-null organization: the old
     * three-column key and the new key plus this index answer every row alike.
     */
    it('admits nothing the old key refused, with a non-null and a null organization (epic condition 1)', async () => {
        const old = new DatabaseSync(':memory:');
        try {
            createTable(old, OLD_INDEX_DDL);
            const insertOld = insertInto(old);
            await ensureUserPermissionSetPackagelessIndex(exec, logger(), { client: 'better-sqlite3' });

            const rows: Array<[string, string | null, string | null]> = [
                ['n1', null, 'org_1'],
                ['n2', null, 'org_1'], // a second package-less grant in one organization
                ['z1', null, null],
                ['z2', null, null], // a second package-less platform-wide grant
            ];
            const answers = rows.map(([id, pkg, org]) => ({ id, old: insertOld(id, pkg, org), now: insert(id, pkg, org) }));

            expect(answers).toEqual([
                { id: 'n1', old: true, now: true },
                { id: 'n2', old: false, now: false },
                // A NULL key part is distinct under a plain UNIQUE: the old key admitted
                // the second platform-wide grant, and so does this index — no new admission.
                { id: 'z1', old: true, now: true },
                { id: 'z2', old: true, now: true },
            ]);
        } finally {
            old.close();
        }
    });

    it('is idempotent: a second boot keeps the index and reports created', async () => {
        await ensureUserPermissionSetPackagelessIndex(exec, logger(), { client: 'better-sqlite3' });
        const first = indexDdl(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME);
        expect(await ensureUserPermissionSetPackagelessIndex(exec, logger(), { client: 'better-sqlite3' })).toEqual({ status: 'created' });
        expect(indexDdl(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME)).toBe(first);
        // The declared key is untouched: this index replaces nothing.
        expect(indexDdl('uniq_sys_user_permission_set_declared')).toBe(DECLARED_INDEX_DDL);
    });

    it('existing duplicates: refuses, names the keys, deletes and re-stamps nothing, and gives the listing query (epic condition 2)', async () => {
        insert('a', null);
        insert('b', null);
        insert('c', 'com.acme.crm');
        const log = logger();

        const result = await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'better-sqlite3' });

        expect(result.status).toBe('conflict');
        expect(indexDdl(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME)).toBeUndefined();
        expect(db.prepare(`SELECT id, permission_set_package FROM ${USER_PERMISSION_SET_TABLE} ORDER BY id`).all()).toEqual([
            { id: 'a', permission_set_package: null },
            { id: 'b', permission_set_package: null },
            { id: 'c', permission_set_package: 'com.acme.crm' },
        ]);
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message).toContain('existing grants violate');
        expect(message).toContain('user_id=u1, permission_set=sales_rep, organization_id=org_1 (2 grants)');
        expect(message).toContain('no package is guessed');
        expect(message).toContain(buildUserPermissionSetPackagelessDuplicateProbeSql());
        expect(message).toContain('os migrate duplicates');
        expect(db.prepare(buildUserPermissionSetPackagelessDuplicateProbeSql()).all()).toEqual([
            { user_id: 'u1', permission_set: 'sales_rep', organization_id: 'org_1', duplicate_rows: 2 },
        ]);

        // Re-runnable: once an operator revokes the extra grant, the next boot builds it.
        db.prepare(`DELETE FROM ${USER_PERMISSION_SET_TABLE} WHERE id = 'b'`).run();
        expect(await ensureUserPermissionSetPackagelessIndex(exec, logger(), { client: 'better-sqlite3' })).toEqual({ status: 'created' });
    });

    it('names ten duplicated keys, then how many more', async () => {
        for (let i = 0; i < 12; i++) {
            insert(`a${i}`, null, 'org_1', `set_${String(i).padStart(2, '0')}`);
            insert(`b${i}`, null, 'org_1', `set_${String(i).padStart(2, '0')}`);
        }
        const log = logger();
        expect((await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'better-sqlite3' })).status).toBe('conflict');
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message.match(/\(2 grants\)/g)).toHaveLength(10);
        expect(message).toContain('; and 2 more');
    });

    it('a kernel without the table, or without a SQL driver, is a silent no-op', async () => {
        db.exec(`DROP TABLE ${USER_PERMISSION_SET_TABLE}`);
        const log = logger();
        expect(await ensureUserPermissionSetPackagelessIndex(exec, log)).toEqual({ status: 'absent' });
        expect(await ensureUserPermissionSetPackagelessIndex(undefined, log)).toEqual({ status: 'no-driver' });
        expect(log.error).not.toHaveBeenCalled();
        expect(log.warn).not.toHaveBeenCalled();
    });
});

describe('the MySQL-family arms (statement and verdict)', () => {
    const presentTable: IndexExec = async (sql: string) => {
        if (/information_schema|sqlite_master|to_regclass|WHERE 1 = 0/i.test(sql)) return [[{ present: 1 }]];
        throw new Error('unexpected');
    };

    it("MySQL takes a functional key part over the driver's own digest, NULL for a packaged grant", () => {
        expect(buildUserPermissionSetPackagelessIndexSql('mysql2')).toBe(
            `CREATE UNIQUE INDEX ${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME} ON ${USER_PERMISSION_SET_TABLE} ` +
                '((CASE WHEN permission_set_package IS NULL THEN ' +
                'unhex(sha2(concat(user_id, 0x1f, permission_set, 0x1f, organization_id), 256)) END))',
        );
        expect(buildUserPermissionSetPackagelessIndexSql('pg')).toBe(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME} ON ${USER_PERMISSION_SET_TABLE} ` +
                '(user_id, permission_set, organization_id) WHERE permission_set_package IS NULL',
        );
        expect(buildUserPermissionSetPackagelessIndexSql(undefined)).toContain('WHERE permission_set_package IS NULL');
    });

    it('an index of that name already there (ER_DUP_KEYNAME) is the index being in place', async () => {
        const exec: IndexExec = async (sql) => {
            if (sql.startsWith('CREATE')) throw Object.assign(new Error(`Duplicate key name '${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}'`), { errno: 1061 });
            return presentTable(sql);
        };
        expect(await ensureUserPermissionSetPackagelessIndex(exec, { warn: vi.fn(), error: vi.fn() }, { client: 'mysql2' }))
            .toEqual({ status: 'created' });
    });

    /** A server with no guard form: the guard's CREATE is a syntax error, the old key's plain CREATE runs. */
    const noGuardForm = (oldKey: (sql: string) => unknown = () => []) => {
        const ran: string[] = [];
        const exec: IndexExec = async (sql) => {
            if (sql.startsWith('CREATE')) {
                ran.push(sql);
                if (sql.includes(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME)) {
                    throw new Error("You have an error in your SQL syntax; check the manual near '(CASE WHEN'");
                }
                return oldKey(sql);
            }
            return presentTable(sql);
        };
        return { exec, ran };
    };

    it('[MF6] a server with no form at all keeps the old three-column key in its place: built where missing, reported at error', async () => {
        const { exec, ran } = noGuardForm();
        const log = { warn: vi.fn(), error: vi.fn() };
        const result = await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'mysql2' });
        expect(result).toMatchObject({ status: 'unsupported', oldKey: 'kept' });
        expect(ran.at(-1)).toBe(buildUserPermissionSetOldKeySql('mysql2'));
        expect(buildUserPermissionSetOldKeySql('mysql2')).toBe(
            `CREATE UNIQUE INDEX ${USER_PERMISSION_SET_OLD_KEY_INDEX_NAME} ON ${USER_PERMISSION_SET_TABLE} (user_id, permission_set, organization_id)`,
        );
        expect(log.error).toHaveBeenCalledTimes(1);
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message).toContain('is NOT enforced by an index of its own');
        expect(message).toContain(`'${USER_PERMISSION_SET_OLD_KEY_INDEX_NAME}' stands in its place`);
        expect(message).toContain("a second package's set of the same name");
    });

    it('[MF6] an old key already there (an upgraded database, ER_DUP_KEYNAME) is kept as it is', async () => {
        const { exec } = noGuardForm(() => {
            throw Object.assign(new Error(`Duplicate key name '${USER_PERMISSION_SET_OLD_KEY_INDEX_NAME}'`), { errno: 1061 });
        });
        const log = { warn: vi.fn(), error: vi.fn() };
        expect(await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'mysql2' }))
            .toMatchObject({ status: 'unsupported', oldKey: 'kept' });
        expect(String(log.error.mock.calls[0]?.[0] ?? '')).toContain('stands in its place');
    });

    it('[MF6] an old key that cannot be built either says nothing guards, with its own driver text', async () => {
        const { exec } = noGuardForm(() => {
            throw Object.assign(new Error("Duplicate entry 'u1-sales_rep-org_1' for key"), { errno: 1062 });
        });
        const log = { warn: vi.fn(), error: vi.fn() };
        const result = await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'mysql2' });
        expect(result).toMatchObject({ status: 'unsupported', oldKey: 'failed' });
        expect(result.oldKeyDetail).toContain('Duplicate entry');
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message).toContain('could not be built in its place either');
        expect(message).toContain('revoking one leaves the other granting');
    });

    it('the old key statement elsewhere is idempotent by IF NOT EXISTS', () => {
        expect(buildUserPermissionSetOldKeySql('pg')).toBe(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${USER_PERMISSION_SET_OLD_KEY_INDEX_NAME} ON ${USER_PERMISSION_SET_TABLE} (user_id, permission_set, organization_id)`,
        );
    });
});

/**
 * [#21418] The one `operatorFacingErrorText()` site in this migration (the
 * CREATE's failure detail) and the presence read's detail it also reports: a
 * value bound into a refused raw statement reaches neither the returned result
 * nor the `error` line. The fixture is the raw terminal's envelope, as
 * `raw-exec-operator-detail-16657.test.ts` builds it for the sibling migrations.
 */
describe('[#21418] a bound sentinel reaches no carrier this migration writes', () => {
    const SENTINEL = 'SENTINEL-21418-BOUND-VALUE';

    /** knex's message for a refused raw statement: values inlined, then the dialect's words. */
    const knexDump = (sql: string, params: readonly unknown[], diagnostic: string): string => {
        let i = 0;
        return `${sql.replace(/\?/g, () => `'${String(params[i++])}'`)} - ${diagnostic}`;
    };

    /** `rawStatementFaultError`'s shape: a composed envelope, the dialect text on a non-enumerable cause. */
    function rawStatementFault(dialect: string, causeCode = 'SQLITE_ERROR'): Error {
        const err = Object.assign(new Error('The database refused to run a raw statement.'), {
            code: 'DATABASE_ERROR',
            status: 500,
        });
        const cause = Object.assign(new Error(dialect), { code: causeCode });
        Object.defineProperty(err, 'cause', { value: cause, enumerable: false, writable: true, configurable: true });
        return err;
    }

    const carriers = (result: unknown, log: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }) =>
        [inspect(result, { depth: 8 }), ...[...log.error.mock.calls, ...log.warn.mock.calls].map((c) => inspect(c, { depth: 8 }))].join('\n');

    const presentTable = async (sql: string) => {
        if (/information_schema|sqlite_master|to_regclass|WHERE 1 = 0/i.test(sql)) return [[{ present: 1 }]];
        return [];
    };

    it('[the fixture] the raw path really carries the sentinel on the cause the helper reads', () => {
        const thrown = rawStatementFault(knexDump('select ? as v', [SENTINEL], 'no such column: v'));
        expect((thrown as { cause?: Error }).cause?.message).toContain(SENTINEL);
        expect(thrown.message).not.toContain(SENTINEL);
    });

    it.each([
        ['failed', 'no such column: v', 'SQLITE_ERROR'],
        ['unsupported', 'near "WHERE": syntax error', 'SQLITE_ERROR'],
    ] as const)('the CREATE refused (%s): the result detail and the error line carry the dialect text, never the bound value', async (status, diagnostic, code) => {
        const exec: IndexExec = async (sql) => {
            if (sql.startsWith('CREATE')) throw rawStatementFault(knexDump(`${sql} -- ?`, [SENTINEL], diagnostic), code);
            return presentTable(sql);
        };
        const log = { error: vi.fn(), warn: vi.fn() };
        const result = await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'better-sqlite3' });
        expect(result.status).toBe(status);
        expect(result.detail).toContain(diagnostic);
        expect(log.error).toHaveBeenCalled();
        expect(carriers(result, log)).not.toContain(SENTINEL);
    });

    it('the presence read refused: the failed result and its error line carry no bound value', async () => {
        const exec: IndexExec = async () => {
            throw rawStatementFault(knexDump('select ? as v', [SENTINEL], 'no such column: v'));
        };
        const log = { error: vi.fn(), warn: vi.fn() };
        const result = await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'better-sqlite3' });
        expect(result.status).toBe('failed');
        expect(log.error).toHaveBeenCalled();
        expect(carriers(result, log)).not.toContain(SENTINEL);
    });
});

describe('the MariaDB arm (INVISIBLE generated carrier + UNIQUE key)', () => {
    const mariadb = (onDdl: (sql: string) => unknown) => {
        const seen: string[] = [];
        const exec: IndexExec = async (sql: string) => {
            seen.push(sql);
            if (/information_schema|sqlite_master|to_regclass|WHERE 1 = 0/i.test(sql)) return [[{ present: 1 }]];
            if (/^SELECT VERSION\(\)/.test(sql)) return [[{ version: '11.8.9-MariaDB-ubu2404' }]];
            return onDdl(sql);
        };
        return { exec, seen };
    };
    const ddl = (seen: string[]) => seen.filter((q) => /^(ALTER|CREATE)/.test(q));

    it('the carrier is named as driver-sql names a hash shadow (index name + __hash), so its differ owns it', () => {
        expect(USER_PERMISSION_SET_PACKAGELESS_SHADOW_COLUMN).toBe(`${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}__hash`);
    });

    it('one ALTER adds the INVISIBLE column (the digest, NULL for a packaged grant) and the UNIQUE key over it', () => {
        expect(buildUserPermissionSetPackagelessMariaDbSql()).toBe(
            `ALTER TABLE ${USER_PERMISSION_SET_TABLE} ADD COLUMN ${USER_PERMISSION_SET_PACKAGELESS_SHADOW_COLUMN} VARBINARY(32) ` +
                'GENERATED ALWAYS AS (CASE WHEN permission_set_package IS NULL THEN ' +
                'unhex(sha2(concat(user_id, 0x1f, permission_set, 0x1f, organization_id), 256)) END) ' +
                'VIRTUAL INVISIBLE, ' +
                `ADD UNIQUE KEY ${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME} (${USER_PERMISSION_SET_PACKAGELESS_SHADOW_COLUMN})`,
        );
    });

    it('MariaDB takes that form, never the MySQL functional statement it refuses', async () => {
        const { exec, seen } = mariadb(() => [[]]);
        const log = { warn: vi.fn(), error: vi.fn() };
        expect(await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'mysql2' })).toEqual({ status: 'created' });
        expect(ddl(seen)).toEqual([buildUserPermissionSetPackagelessMariaDbSql()]);
        expect(log.error).not.toHaveBeenCalled();
    });

    it('a second boot (ER_DUP_FIELDNAME) re-keys the standing column, and a key already there (ER_DUP_KEYNAME) is the index in place', async () => {
        const { exec, seen } = mariadb((sql) => {
            if (sql.includes('ADD COLUMN')) throw Object.assign(new Error("Duplicate column name 'x'"), { errno: 1060, code: 'ER_DUP_FIELDNAME' });
            throw Object.assign(new Error("Duplicate key name 'x'"), { errno: 1061, code: 'ER_DUP_KEYNAME' });
        });
        expect(await ensureUserPermissionSetPackagelessIndex(exec, { warn: vi.fn(), error: vi.fn() }, { client: 'mysql2' }))
            .toEqual({ status: 'created' });
        expect(ddl(seen)).toEqual([buildUserPermissionSetPackagelessMariaDbSql(), buildUserPermissionSetPackagelessMariaDbKeySql()]);
    });

    it('existing duplicates (ER_DUP_ENTRY) are a conflict: reported at error with the listing query, nothing deleted', async () => {
        const { exec, seen } = mariadb((sql) => {
            if (/^ALTER/.test(sql)) throw Object.assign(new Error(`Duplicate entry 'x' for key '${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}'`), { errno: 1062, code: 'ER_DUP_ENTRY' });
            return [[{ duplicate_keys: 1, duplicate_rows: 2 }]];
        });
        const log = { warn: vi.fn(), error: vi.fn() };
        const result = await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'mysql2' });
        expect(result.status).toBe('conflict');
        expect(String(log.error.mock.calls[0]?.[0] ?? '')).toContain(buildUserPermissionSetPackagelessDuplicateProbeSql());
        expect(seen.some((q) => /^(DELETE|DROP|UPDATE)/i.test(q))).toBe(false);
    });
});
