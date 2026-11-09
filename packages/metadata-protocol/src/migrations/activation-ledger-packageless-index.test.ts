// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME,
    ACTIVATION_LEDGER_TABLE,
    buildActivationLedgerPackagelessDuplicateProbeSql,
    buildActivationLedgerPackagelessIndexSql,
    ensureActivationLedgerPackagelessIndex,
} from './activation-ledger-packageless-index.js';
import type { IndexExec } from './partial-index-probe.js';

/**
 * `sys_metadata_activation` — one row per `(metadata_type, name)` among the rows
 * that name no package, beside the declared NULL-distinct
 * `(metadata_type, package_id, name)` key (ADR-0150 D4).
 *
 * Real SQLite (`node:sqlite`, as the sibling migration suites use), because the
 * claim is about what a UNIQUE index does with NULLs over real rows. PostgreSQL
 * and MySQL/MariaDB are measured in the `.live.test.ts` sibling; the engine and
 * boot half is the dogfood file `activation-ledger-package-key.dogfood.test.ts`.
 */
describe('sys_metadata_activation: one package-less row per (metadata_type, name)', () => {
    let db: DatabaseSync;
    let exec: IndexExec;

    /**
     * What `SqlDriver.syncDeclaredIndexes` builds on SQLite for the declared key
     * `{ fields: ['metadata_type', 'package_id', 'name'], unique: 'global' }`:
     * a plain, NULL-distinct UNIQUE.
     */
    const DECLARED_INDEX_DDL =
        'CREATE UNIQUE INDEX `uniq_sys_metadata_activation_metadata_type_package_id_name` on ' +
        '`sys_metadata_activation` (`metadata_type`, `package_id`, `name`)';

    const insert = (id: string, packageId: string | null, name = 'x'): boolean => {
        try {
            db.prepare(
                `INSERT INTO ${ACTIVATION_LEDGER_TABLE} (id, metadata_type, name, package_id, active) VALUES (?, 'flow', ?, ?, 0)`,
            ).run(id, name, packageId);
            return true;
        } catch {
            return false;
        }
    };
    const indexDdl = (name: string): string | undefined =>
        (db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as { sql?: string } | undefined)
            ?.sql ?? undefined;
    const logger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`CREATE TABLE ${ACTIVATION_LEDGER_TABLE} (
            id TEXT PRIMARY KEY, metadata_type TEXT, name TEXT, package_id TEXT, active INTEGER
        );`);
        db.exec(DECLARED_INDEX_DDL);
        exec = async (sql: string) => db.exec(sql);
    });

    afterEach(() => db.close());

    it('without it, the declared key admits two package-less rows of one name (the hole this closes)', () => {
        expect(insert('a', null)).toBe(true);
        expect(insert('b', null)).toBe(true);
    });

    it('with it, a second package-less row of one (metadata_type, name) is refused', async () => {
        const log = logger();
        expect(await ensureActivationLedgerPackagelessIndex(exec, log, { client: 'better-sqlite3' })).toEqual({ status: 'created' });
        expect(indexDdl(ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME)).toContain('WHERE package_id IS NULL');

        expect(insert('a', null)).toBe(true);
        expect(insert('b', null)).toBe(false);
        // Another name is another key.
        expect(insert('c', null, 'y')).toBe(true);
        expect(log.error).not.toHaveBeenCalled();
    });

    it('leaves packaged rows to the declared key: two packages admitted, one package twice refused', async () => {
        await ensureActivationLedgerPackagelessIndex(exec, logger(), { client: 'better-sqlite3' });
        expect(insert('a', null)).toBe(true);
        expect(insert('p1', 'com.acme.alpha')).toBe(true);
        expect(insert('p2', 'com.acme.beta')).toBe(true);
        expect(insert('p1b', 'com.acme.alpha')).toBe(false);
    });

    it('is idempotent: a second boot keeps the index and reports created', async () => {
        await ensureActivationLedgerPackagelessIndex(exec, logger(), { client: 'better-sqlite3' });
        const first = indexDdl(ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME);
        expect(await ensureActivationLedgerPackagelessIndex(exec, logger(), { client: 'better-sqlite3' })).toEqual({ status: 'created' });
        expect(indexDdl(ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME)).toBe(first);
        // The declared key is untouched: this index replaces nothing.
        expect(indexDdl('uniq_sys_metadata_activation_metadata_type_package_id_name')).toBe(DECLARED_INDEX_DDL);
    });

    it('existing duplicates: refuses, deletes nothing, and tells the operator at error with the listing query', async () => {
        insert('a', null);
        insert('b', null);
        const log = logger();

        const result = await ensureActivationLedgerPackagelessIndex(exec, log, { client: 'better-sqlite3' });

        expect(result.status).toBe('conflict');
        expect(indexDdl(ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME)).toBeUndefined();
        expect((db.prepare(`SELECT COUNT(*) AS n FROM ${ACTIVATION_LEDGER_TABLE}`).get() as { n: number }).n).toBe(2);
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message).toContain('existing rows violate');
        expect(message).toContain(buildActivationLedgerPackagelessDuplicateProbeSql());
        expect(message).toContain('os migrate duplicates');
        // The listing query itself names the offending key.
        const rows = db.prepare(buildActivationLedgerPackagelessDuplicateProbeSql()).all();
        expect(rows).toEqual([{ metadata_type: 'flow', name: 'x', duplicate_rows: 2 }]);
    });

    it('a kernel without the table, or without a SQL driver, is a silent no-op', async () => {
        db.exec(`DROP TABLE ${ACTIVATION_LEDGER_TABLE}`);
        const log = logger();
        // No client: the fallback presence statement, which `node:sqlite`'s
        // result-less `exec` answers by refusing (no such table).
        expect(await ensureActivationLedgerPackagelessIndex(exec, log)).toEqual({ status: 'absent' });
        expect(await ensureActivationLedgerPackagelessIndex(undefined, log)).toEqual({ status: 'no-driver' });
        expect(log.error).not.toHaveBeenCalled();
        expect(log.warn).not.toHaveBeenCalled();
    });
});

describe('the MySQL-family arms (statement and verdict)', () => {
    const presentTable: IndexExec = async (sql: string) => {
        // The catalog presence probe answers one row; the CREATE is the caller's.
        if (/information_schema|sqlite_master|to_regclass|WHERE 1 = 0/i.test(sql)) return [[{ present: 1 }]];
        throw new Error('unexpected');
    };

    it('MySQL takes a functional key part over the driver\'s own digest, NULL for a packaged row', () => {
        expect(buildActivationLedgerPackagelessIndexSql('mysql2')).toBe(
            `CREATE UNIQUE INDEX ${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME} ON ${ACTIVATION_LEDGER_TABLE} ` +
                '((CASE WHEN package_id IS NULL THEN unhex(sha2(concat(metadata_type, 0x1f, name), 256)) END))',
        );
        expect(buildActivationLedgerPackagelessIndexSql('pg')).toContain('WHERE package_id IS NULL');
        expect(buildActivationLedgerPackagelessIndexSql(undefined)).toContain('WHERE package_id IS NULL');
    });

    it('an index of that name already there (ER_DUP_KEYNAME) is the index being in place', async () => {
        const exec: IndexExec = async (sql) => {
            if (sql.startsWith('CREATE')) throw Object.assign(new Error("Duplicate key name 'uniq_sys_metadata_activation_packageless'"), { errno: 1061 });
            return presentTable(sql);
        };
        expect(await ensureActivationLedgerPackagelessIndex(exec, { warn: vi.fn(), error: vi.fn() }, { client: 'mysql2' }))
            .toEqual({ status: 'created' });
    });

    it('a dialect with neither form (MariaDB) is unsupported, reported at error, and names what still guards', async () => {
        const exec: IndexExec = async (sql) => {
            if (sql.startsWith('CREATE')) throw new Error("You have an error in your SQL syntax; check the manual near '(CASE WHEN'");
            return presentTable(sql);
        };
        const log = { warn: vi.fn(), error: vi.fn() };
        const result = await ensureActivationLedgerPackagelessIndex(exec, log, { client: 'mysql2' });
        expect(result.status).toBe('unsupported');
        const message = String(log.error.mock.calls[0]?.[0] ?? '');
        expect(message).toContain('is NOT enforced by an index of its own');
        expect(message).toContain('keeps its old (metadata_type, name) index');
    });
});
