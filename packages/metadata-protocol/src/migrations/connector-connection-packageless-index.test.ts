// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';
import { inspect } from 'node:util';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME,
    CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME,
    CONNECTOR_CONNECTION_PACKAGELESS_SHADOW_COLUMN,
    CONNECTOR_CONNECTION_TABLE,
    buildConnectorConnectionOldKeySql,
    buildConnectorConnectionPackagelessDuplicateProbeSql,
    buildConnectorConnectionPackagelessIndexPresenceSql,
    buildConnectorConnectionPackagelessIndexSql,
    buildConnectorConnectionPackagelessMariaDbKeySql,
    buildConnectorConnectionPackagelessMariaDbSql,
    createConnectorConnectionGuardAtSchemaSync,
    ensureConnectorConnectionPackagelessIndex,
} from './connector-connection-packageless-index.js';
import type { IndexExec } from './partial-index-probe.js';

/**
 * The guard's own catalog read (`buildConnectorConnectionPackagelessIndexPresenceSql`),
 * told apart from the table-presence read the recording fixtures below answer
 * "present": only the guard's read names the index. Those fixtures answer it
 * with no row, so the build they exercise still runs.
 */
const isGuardPresenceRead = (sql: string): boolean =>
    /^SELECT 1 FROM /.test(sql) && sql.includes(`'${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}'`);

/** A statement that changes the schema, as opposed to a read. */
const isDdl = (sql: string): boolean => /^\s*(CREATE|ALTER|DROP)\b/i.test(sql);

/**
 * `sys_connector_connection` — one connection per `(organization_id,
 * connector_name)` among the connections that name no package, beside the
 * NULL-distinct `(organization_id, connector_package, connector_name)` key
 * ADR-0150 D4 gives the connection (#31699), which these fixtures declare.
 *
 * Real SQLite (`node:sqlite`), because the claim is about what a UNIQUE index
 * does with NULLs over real rows. PostgreSQL and MySQL are measured in the
 * `.live-postgres` / `.live-mysql` siblings.
 */
describe('sys_connector_connection: one package-less connection per (organization_id, connector_name)', () => {
    let db: DatabaseSync;
    let exec: IndexExec;

    /**
     * What `SqlDriver.syncDeclaredIndexes` builds on SQLite for the declared key
     * `{ fields: ['organization_id', 'connector_package', 'connector_name'], unique: 'global' }`:
     * a plain, NULL-distinct UNIQUE.
     */
    const DECLARED_INDEX_DDL =
        'CREATE UNIQUE INDEX `uniq_sys_connector_connection_declared` on `sys_connector_connection` ' +
        '(`organization_id`, `connector_package`, `connector_name`)';
    /** The key this one replaced, as the driver built it for `{ fields: ['connector_name'], unique: 'organization' }`. */
    const OLD_INDEX_DDL =
        'CREATE UNIQUE INDEX `uniq_sys_connector_connection_old` on `sys_connector_connection` ' +
        '(`organization_id`, `connector_name`)';

    const createTable = (handle: DatabaseSync, ddl: string): void => {
        handle.exec(`CREATE TABLE ${CONNECTOR_CONNECTION_TABLE} (
            id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, connector_name TEXT NOT NULL, connector_package TEXT
        );`);
        handle.exec(ddl);
    };
    const insertInto = (handle: DatabaseSync) => (
        id: string,
        pkg: string | null,
        org = 'org_1',
        name = 'github',
    ): boolean => {
        try {
            handle
                .prepare(
                    `INSERT INTO ${CONNECTOR_CONNECTION_TABLE} (id, organization_id, connector_name, connector_package) VALUES (?, ?, ?, ?)`,
                )
                .run(id, org, name, pkg);
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

    it('without it, the declared key admits two package-less connections of one instance (the hole this closes)', () => {
        expect(insert('a', null)).toBe(true);
        expect(insert('b', null)).toBe(true);
    });

    it('with it, a second package-less connection of one (organization, instance) is refused', async () => {
        const log = logger();
        expect(await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'better-sqlite3' })).toEqual({ status: 'created' });
        expect(indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)).toContain('(organization_id, connector_name) WHERE connector_package IS NULL');

        expect(insert('a', null)).toBe(true);
        expect(insert('b', null)).toBe(false);
        // Another organization or instance is another key.
        expect(insert('c', null, 'org_2')).toBe(true);
        expect(insert('d', null, 'org_1', 'slack')).toBe(true);
        expect(log.error).not.toHaveBeenCalled();
    });

    it('leaves packaged connections to the declared key: two packages admitted, one package twice refused', async () => {
        await ensureConnectorConnectionPackagelessIndex(exec, logger(), { client: 'better-sqlite3' });
        expect(insert('p1', 'com.acme.crm')).toBe(true);
        expect(insert('p2', 'com.acme.hr')).toBe(true);
        expect(insert('p1b', 'com.acme.crm')).toBe(false);
    });

    /**
     * Measured side by side over the same rows: among connections that name no
     * package, the old `(organization_id, connector_name)` key and the new key
     * plus this index answer every row alike.
     *
     * What the store alone admits that the old key refused: a connection naming
     * a package beside one naming none, for one organization and instance. The
     * connection store is the table's one writer and reads before it writes (a
     * connect updates the row it finds, `service-automation`'s
     * `connector-connections.ts`), so it never writes that row; this pin names
     * the store's own answer, so a later guard turns it red.
     */
    it('among package-less connections admits nothing the old key refused; the store alone admits a packaged connection beside a package-less one', async () => {
        const old = new DatabaseSync(':memory:');
        try {
            createTable(old, OLD_INDEX_DDL);
            const insertOld = insertInto(old);
            await ensureConnectorConnectionPackagelessIndex(exec, logger(), { client: 'better-sqlite3' });

            const rows: Array<[string, string | null]> = [
                ['n1', null],
                ['n2', null], // a second package-less connection of the instance
                ['m1', 'com.acme.crm'], // a packaged connection beside n1
                ['m2', 'com.acme.crm'], // that package twice
                ['h1', 'com.acme.hr'], // a second package's instance of the name
            ];
            const answers = rows.map(([id, pkg]) => ({ id, old: insertOld(id, pkg), now: insert(id, pkg) }));

            expect(answers).toEqual([
                { id: 'n1', old: true, now: true },
                { id: 'n2', old: false, now: false },
                // The store alone: admitted beside n1, where the old key refused it.
                { id: 'm1', old: false, now: true },
                { id: 'm2', old: false, now: false },
                // What the ruling asks for: one organization connects both packages' instances.
                { id: 'h1', old: false, now: true },
            ]);
        } finally {
            old.close();
        }
    });

    it('is idempotent: a second boot keeps the index and reports created', async () => {
        await ensureConnectorConnectionPackagelessIndex(exec, logger(), { client: 'better-sqlite3' });
        const first = indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME);
        expect(await ensureConnectorConnectionPackagelessIndex(exec, logger(), { client: 'better-sqlite3' })).toEqual({ status: 'created' });
        expect(indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)).toBe(first);
        // The declared key is untouched: this index replaces nothing.
        expect(indexDdl('uniq_sys_connector_connection_declared')).toBe(DECLARED_INDEX_DDL);
    });

    it('existing duplicates: refuses, names the keys, deletes and re-stamps nothing, and gives the listing query', async () => {
        insert('a', null);
        insert('b', null);
        insert('c', 'com.acme.crm');
        const log = logger();

        const result = await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'better-sqlite3' });

        expect(result.status).toBe('conflict');
        expect(indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)).toBeUndefined();
        expect(db.prepare(`SELECT id, connector_package FROM ${CONNECTOR_CONNECTION_TABLE} ORDER BY id`).all()).toEqual([
            { id: 'a', connector_package: null },
            { id: 'b', connector_package: null },
            { id: 'c', connector_package: 'com.acme.crm' },
        ]);
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message).toContain('existing connections violate');
        expect(message).toContain('organization_id=org_1, connector_name=github (2 connections)');
        expect(message).toContain('no package is guessed');
        expect(message).toContain(buildConnectorConnectionPackagelessDuplicateProbeSql());
        expect(message).toContain('os migrate duplicates');
        expect(db.prepare(buildConnectorConnectionPackagelessDuplicateProbeSql()).all()).toEqual([
            { organization_id: 'org_1', connector_name: 'github', duplicate_rows: 2 },
        ]);

        // Re-runnable: once an operator revokes the extra connection, the next boot builds it.
        db.prepare(`DELETE FROM ${CONNECTOR_CONNECTION_TABLE} WHERE id = 'b'`).run();
        expect(await ensureConnectorConnectionPackagelessIndex(exec, logger(), { client: 'better-sqlite3' })).toEqual({ status: 'created' });
    });

    it('names ten duplicated keys, then how many more', async () => {
        for (let i = 0; i < 12; i++) {
            insert(`a${i}`, null, 'org_1', `conn_${String(i).padStart(2, '0')}`);
            insert(`b${i}`, null, 'org_1', `conn_${String(i).padStart(2, '0')}`);
        }
        const log = logger();
        expect((await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'better-sqlite3' })).status).toBe('conflict');
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message.match(/\(2 connections\)/g)).toHaveLength(10);
        expect(message).toContain('; and 2 more');
    });

    it('a kernel without the table, or without a SQL driver, is a silent no-op', async () => {
        db.exec(`DROP TABLE ${CONNECTOR_CONNECTION_TABLE}`);
        const log = logger();
        expect(await ensureConnectorConnectionPackagelessIndex(exec, log)).toEqual({ status: 'absent' });
        expect(await ensureConnectorConnectionPackagelessIndex(undefined, log)).toEqual({ status: 'no-driver' });
        expect(log.error).not.toHaveBeenCalled();
        expect(log.warn).not.toHaveBeenCalled();
    });

    /**
     * [#31699, as the grant guard's #32164 MF6 pins] The ensurer each kernel's
     * schema-sync event runs, over an engine whose driver serves this table the
     * way `SqlDriver` does: `execute` for raw SQL, `config.client` for the
     * dialect, `schemaDdlDeferred` while a one-shot CLI boot holds DDL back.
     */
    describe('createConnectorConnectionGuardAtSchemaSync: once per pass, on every kernel that performs the DDL', () => {
        const engineOver = (driver: { schemaDdlDeferred?: boolean }) => ({
            getDriverForObject: (table: string) => (table === CONNECTOR_CONNECTION_TABLE ? driver : undefined),
        });
        const sqliteDriver = () => ({
            schemaDdlDeferred: false as boolean,
            config: { client: 'better-sqlite3' },
            execute: (sql: string) => exec(sql),
        });

        it('a pass whose driver holds DDL back (a dry run, or apply before its confirmation) builds nothing and latches nothing; the pass after the flush builds it', async () => {
            const driver = sqliteDriver();
            driver.schemaDdlDeferred = true;
            const log = logger();
            const ensure = createConnectorConnectionGuardAtSchemaSync(engineOver(driver), log);

            expect(await ensure()).toBe('held-back');
            expect(indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)).toBeUndefined();

            driver.schemaDdlDeferred = false; // the flush performed what was held back
            expect(await ensure()).toBe('created');
            expect(indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)).toBeDefined();
            expect(log.error).not.toHaveBeenCalled();
            expect(log.warn).not.toHaveBeenCalled();
        });

        it('`created` never latches: a guard the table lost (a SQLite table rebuild drops it) is built again by the next pass, silently', async () => {
            const log = logger();
            const ensure = createConnectorConnectionGuardAtSchemaSync(engineOver(sqliteDriver()), log);
            expect(await ensure()).toBe('created');

            db.exec(`DROP INDEX ${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}`);
            expect(await ensure()).toBe('created');
            expect(indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)).toBeDefined();
            expect(log.error).not.toHaveBeenCalled();
            expect(log.warn).not.toHaveBeenCalled();
        });

        it('a later pass over a table the guard stands on reads the catalog and issues no DDL (a metadata:reloaded re-sync locks nothing)', async () => {
            const statements: string[] = [];
            const driver = { ...sqliteDriver(), execute: (sql: string) => (statements.push(sql), exec(sql)) };
            const log = logger();
            const ensure = createConnectorConnectionGuardAtSchemaSync(engineOver(driver), log);

            expect(await ensure()).toBe('created');
            expect(statements.filter(isDdl)).toEqual([buildConnectorConnectionPackagelessIndexSql('better-sqlite3')]);

            statements.length = 0;
            expect(await ensure()).toBe('created');
            expect(statements.filter(isDdl)).toEqual([]);
            expect(statements).toContain(buildConnectorConnectionPackagelessIndexPresenceSql('better-sqlite3'));
            expect(indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)).toBeDefined();
            expect(log.error).not.toHaveBeenCalled();
            expect(log.warn).not.toHaveBeenCalled();
        });

        it('a refused catalog read never skips the build: the pass builds as it did without the read', async () => {
            const driver = {
                ...sqliteDriver(),
                execute: (sql: string) => (isGuardPresenceRead(sql) ? Promise.reject(new Error('no such table: sqlite_master')) : exec(sql)),
            };
            const ensure = createConnectorConnectionGuardAtSchemaSync(engineOver(driver), logger());

            expect(await ensure()).toBe('created');
            expect(indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)).toBeDefined();
        });

        it('a refusal latches: reported once, and a later pass in the same boot neither tries again nor says it twice', async () => {
            insert('a', null);
            insert('b', null);
            const log = logger();
            const ensure = createConnectorConnectionGuardAtSchemaSync(engineOver(sqliteDriver()), log);

            expect(await ensure()).toBe('conflict');
            expect(await ensure()).toBe('refused-earlier');
            expect(log.error).toHaveBeenCalledTimes(1);
            expect(indexDdl(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)).toBeUndefined();

            // The next boot is a new ensurer, and tries again.
            db.prepare(`DELETE FROM ${CONNECTOR_CONNECTION_TABLE} WHERE id = 'b'`).run();
            expect(await createConnectorConnectionGuardAtSchemaSync(engineOver(sqliteDriver()), logger())()).toBe('created');
        });

        it('an engine with no SQL driver for the table: a silent no-op, never latched', async () => {
            const log = logger();
            const ensure = createConnectorConnectionGuardAtSchemaSync({ getDriverForObject: () => undefined }, log);
            expect(await ensure()).toBe('no-driver');
            expect(await ensure()).toBe('no-driver');
            expect(log.error).not.toHaveBeenCalled();
            expect(log.warn).not.toHaveBeenCalled();
        });
    });
});

describe('the MySQL-family arms (statement and verdict)', () => {
    const presentTable: IndexExec = async (sql: string) => {
        if (isGuardPresenceRead(sql)) return [[], []];
        if (/information_schema|sqlite_master|to_regclass|WHERE 1 = 0/i.test(sql)) return [[{ present: 1 }]];
        throw new Error('unexpected');
    };

    it('the guard read per dialect: an index of its name on this table, in the schema the unqualified DDL resolves; no arm for an unknown client', () => {
        expect(buildConnectorConnectionPackagelessIndexPresenceSql('better-sqlite3')).toBe(
            `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}' ` +
                `AND tbl_name = '${CONNECTOR_CONNECTION_TABLE}'`,
        );
        expect(buildConnectorConnectionPackagelessIndexPresenceSql('pg')).toBe(
            'SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid ' +
                `WHERE i.indrelid = to_regclass('"${CONNECTOR_CONNECTION_TABLE}"') AND c.relname = '${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}'`,
        );
        expect(buildConnectorConnectionPackagelessIndexPresenceSql('mysql2')).toBe(
            'SELECT 1 FROM information_schema.statistics ' +
                `WHERE table_schema = DATABASE() AND table_name = '${CONNECTOR_CONNECTION_TABLE}' ` +
                `AND index_name = '${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}'`,
        );
        expect(buildConnectorConnectionPackagelessIndexPresenceSql('oracledb')).toBeUndefined();
        expect(buildConnectorConnectionPackagelessIndexPresenceSql(undefined)).toBeUndefined();
    });

    it('a guard the catalog names is left alone: no version read, no CREATE, no ALTER', async () => {
        const seen: string[] = [];
        const exec: IndexExec = async (sql) => {
            seen.push(sql);
            if (isGuardPresenceRead(sql)) return [[{ 1: 1 }], []];
            return presentTable(sql);
        };
        expect(await ensureConnectorConnectionPackagelessIndex(exec, { warn: vi.fn(), error: vi.fn() }, { client: 'mysql2' }))
            .toEqual({ status: 'created' });
        expect(seen.filter(isDdl)).toEqual([]);
        expect(seen.some((q) => /VERSION\(\)/.test(q))).toBe(false);
    });

    it('a client with no catalog arm builds as before (the read never guesses a spelling)', async () => {
        const seen: string[] = [];
        // The table's fallback probe answers a result set (present); every statement succeeds.
        const exec: IndexExec = async (sql) => (seen.push(sql), []);
        expect(await ensureConnectorConnectionPackagelessIndex(exec, { warn: vi.fn(), error: vi.fn() }, { client: 'oracledb' }))
            .toEqual({ status: 'created' });
        expect(seen.filter(isDdl)).toEqual([buildConnectorConnectionPackagelessIndexSql('oracledb')]);
        expect(seen.some(isGuardPresenceRead)).toBe(false);
    });

    it("MySQL takes a functional key part over the driver's own digest, NULL for a packaged connection", () => {
        expect(buildConnectorConnectionPackagelessIndexSql('mysql2')).toBe(
            `CREATE UNIQUE INDEX ${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME} ON ${CONNECTOR_CONNECTION_TABLE} ` +
                '((CASE WHEN connector_package IS NULL THEN ' +
                'unhex(sha2(concat(organization_id, 0x1f, connector_name), 256)) END))',
        );
        expect(buildConnectorConnectionPackagelessIndexSql('pg')).toBe(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME} ON ${CONNECTOR_CONNECTION_TABLE} ` +
                '(organization_id, connector_name) WHERE connector_package IS NULL',
        );
        expect(buildConnectorConnectionPackagelessIndexSql(undefined)).toContain('WHERE connector_package IS NULL');
    });

    it('an index of that name already there (ER_DUP_KEYNAME) is the index being in place', async () => {
        const exec: IndexExec = async (sql) => {
            if (sql.startsWith('CREATE')) throw Object.assign(new Error(`Duplicate key name '${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}'`), { errno: 1061 });
            return presentTable(sql);
        };
        expect(await ensureConnectorConnectionPackagelessIndex(exec, { warn: vi.fn(), error: vi.fn() }, { client: 'mysql2' }))
            .toEqual({ status: 'created' });
    });

    /** A server with no guard form: the guard's CREATE is a syntax error, the old key's plain CREATE runs. */
    const noGuardForm = (oldKey: (sql: string) => unknown = () => []) => {
        const ran: string[] = [];
        const exec: IndexExec = async (sql) => {
            if (sql.startsWith('CREATE')) {
                ran.push(sql);
                if (sql.includes(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME)) {
                    throw new Error("You have an error in your SQL syntax; check the manual near '(CASE WHEN'");
                }
                return oldKey(sql);
            }
            return presentTable(sql);
        };
        return { exec, ran };
    };

    it('a server with no form at all keeps the old two-column key in its place: built where missing, reported at error', async () => {
        const { exec, ran } = noGuardForm();
        const log = { warn: vi.fn(), error: vi.fn() };
        const result = await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'mysql2' });
        expect(result).toMatchObject({ status: 'unsupported', oldKey: 'kept' });
        expect(ran[ran.length - 1]).toBe(buildConnectorConnectionOldKeySql('mysql2'));
        expect(buildConnectorConnectionOldKeySql('mysql2')).toBe(
            `CREATE UNIQUE INDEX ${CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME} ON ${CONNECTOR_CONNECTION_TABLE} (organization_id, connector_name)`,
        );
        expect(log.error).toHaveBeenCalledTimes(1);
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message).toContain('is NOT enforced by an index of its own');
        expect(message).toContain(`'${CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME}' stands in its place`);
        expect(message).toContain("a second package's connector instance of the same name");
    });

    it('an old key already there (an upgraded database, ER_DUP_KEYNAME) is kept as it is', async () => {
        const { exec } = noGuardForm(() => {
            throw Object.assign(new Error(`Duplicate key name '${CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME}'`), { errno: 1061 });
        });
        const log = { warn: vi.fn(), error: vi.fn() };
        expect(await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'mysql2' }))
            .toMatchObject({ status: 'unsupported', oldKey: 'kept' });
        expect(String(log.error.mock.calls[0]?.[0] ?? '')).toContain('stands in its place');
    });

    it('an old key that cannot be built either says nothing guards, with its own driver text', async () => {
        const { exec } = noGuardForm(() => {
            throw Object.assign(new Error("Duplicate entry 'org_1-github' for key"), { errno: 1062 });
        });
        const log = { warn: vi.fn(), error: vi.fn() };
        const result = await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'mysql2' });
        expect(result).toMatchObject({ status: 'unsupported', oldKey: 'failed' });
        expect(result.oldKeyDetail).toContain('Duplicate entry');
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message).toContain('could not be built in its place either');
        expect(message).toContain("revoking one leaves the other's refresh token stored");
    });

    it('the old key statement elsewhere is idempotent by IF NOT EXISTS', () => {
        expect(buildConnectorConnectionOldKeySql('pg')).toBe(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME} ON ${CONNECTOR_CONNECTION_TABLE} (organization_id, connector_name)`,
        );
    });
});

/**
 * [#21418] The three `operatorFacingErrorText()` sites in this migration — the
 * CREATE's failure detail, the old key's failure detail where the guard has no
 * form (`oldKeyDetail`), and the schema-sync ensurer's own catch — and the
 * presence read's detail it also reports: a value bound into a refused raw
 * statement reaches neither the returned result nor the `error` line. The
 * fixture is the raw terminal's envelope, as
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
        if (isGuardPresenceRead(sql)) return [];
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
        const result = await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'better-sqlite3' });
        expect(result.status).toBe(status);
        expect(result.detail).toContain(diagnostic);
        // On `unsupported` the old key's CREATE is refused the same way: its own detail, the second site.
        if (status === 'unsupported') expect(result.oldKeyDetail).toContain(diagnostic);
        expect(log.error).toHaveBeenCalled();
        expect(carriers(result, log)).not.toContain(SENTINEL);
    });

    it("the schema-sync ensurer's own catch (a throw no collaborator is meant to raise): its error line carries the dialect text, never the bound value", async () => {
        const fault = rawStatementFault(knexDump('select ? as v', [SENTINEL], 'no such column: v'));
        // A driver whose raw-SQL surface cannot even be read: the seam lookup,
        // the first thing a pass asks, throws straight into the ensurer's backstop.
        const driver = {
            get execute(): never {
                throw fault;
            },
        };
        const engine = { getDriverForObject: (table: string) => (table === CONNECTOR_CONNECTION_TABLE ? driver : undefined) };
        const log = { error: vi.fn(), warn: vi.fn() };

        const outcome = await createConnectorConnectionGuardAtSchemaSync(engine, log)();

        // Reached the catch, not some other branch: its own line, its own outcome.
        expect(outcome).toBe('failed');
        expect(log.error).toHaveBeenCalledTimes(1);
        expect(String(log.error.mock.calls[0]?.[0] ?? '')).toContain('connector connection index migration skipped');
        expect((log.error.mock.calls[0]?.[1] as Error | undefined)?.message).toContain('no such column: v');
        expect(carriers(outcome, log)).not.toContain(SENTINEL);
    });

    it('the presence read refused: the failed result and its error line carry no bound value', async () => {
        const exec: IndexExec = async () => {
            throw rawStatementFault(knexDump('select ? as v', [SENTINEL], 'no such column: v'));
        };
        const log = { error: vi.fn(), warn: vi.fn() };
        const result = await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'better-sqlite3' });
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
            if (isGuardPresenceRead(sql)) return [[], []];
            if (/information_schema|sqlite_master|to_regclass|WHERE 1 = 0/i.test(sql)) return [[{ present: 1 }]];
            if (/^SELECT VERSION\(\)/.test(sql)) return [[{ version: '11.8.9-MariaDB-ubu2404' }]];
            return onDdl(sql);
        };
        return { exec, seen };
    };
    const ddl = (seen: string[]) => seen.filter((q) => /^(ALTER|CREATE)/.test(q));

    it('the carrier is named as driver-sql names a hash shadow (index name + __hash), so its differ owns it', () => {
        expect(CONNECTOR_CONNECTION_PACKAGELESS_SHADOW_COLUMN).toBe(`${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}__hash`);
    });

    it('one ALTER adds the INVISIBLE column (the digest, NULL for a packaged connection) and the UNIQUE key over it', () => {
        expect(buildConnectorConnectionPackagelessMariaDbSql()).toBe(
            `ALTER TABLE ${CONNECTOR_CONNECTION_TABLE} ADD COLUMN ${CONNECTOR_CONNECTION_PACKAGELESS_SHADOW_COLUMN} VARBINARY(32) ` +
                'GENERATED ALWAYS AS (CASE WHEN connector_package IS NULL THEN ' +
                'unhex(sha2(concat(organization_id, 0x1f, connector_name), 256)) END) ' +
                'VIRTUAL INVISIBLE, ' +
                `ADD UNIQUE KEY ${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME} (${CONNECTOR_CONNECTION_PACKAGELESS_SHADOW_COLUMN})`,
        );
    });

    it('MariaDB takes that form, never the MySQL functional statement it refuses', async () => {
        const { exec, seen } = mariadb(() => [[]]);
        const log = { warn: vi.fn(), error: vi.fn() };
        expect(await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'mysql2' })).toEqual({ status: 'created' });
        expect(ddl(seen)).toEqual([buildConnectorConnectionPackagelessMariaDbSql()]);
        expect(log.error).not.toHaveBeenCalled();
    });

    it('a second boot (ER_DUP_FIELDNAME) re-keys the standing column, and a key already there (ER_DUP_KEYNAME) is the index in place', async () => {
        const { exec, seen } = mariadb((sql) => {
            if (sql.includes('ADD COLUMN')) throw Object.assign(new Error("Duplicate column name 'x'"), { errno: 1060, code: 'ER_DUP_FIELDNAME' });
            throw Object.assign(new Error("Duplicate key name 'x'"), { errno: 1061, code: 'ER_DUP_KEYNAME' });
        });
        expect(await ensureConnectorConnectionPackagelessIndex(exec, { warn: vi.fn(), error: vi.fn() }, { client: 'mysql2' }))
            .toEqual({ status: 'created' });
        expect(ddl(seen)).toEqual([buildConnectorConnectionPackagelessMariaDbSql(), buildConnectorConnectionPackagelessMariaDbKeySql()]);
    });

    it('existing duplicates (ER_DUP_ENTRY) are a conflict: reported at error with the listing query, nothing deleted', async () => {
        const { exec, seen } = mariadb((sql) => {
            if (/^ALTER/.test(sql)) throw Object.assign(new Error(`Duplicate entry 'x' for key '${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}'`), { errno: 1062, code: 'ER_DUP_ENTRY' });
            return [[{ duplicate_keys: 1, duplicate_rows: 2 }]];
        });
        const log = { warn: vi.fn(), error: vi.fn() };
        const result = await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'mysql2' });
        expect(result.status).toBe('conflict');
        expect(String(log.error.mock.calls[0]?.[0] ?? '')).toContain(buildConnectorConnectionPackagelessDuplicateProbeSql());
        expect(seen.some((q) => /^(DELETE|DROP|UPDATE)/i.test(q))).toBe(false);
    });
});
