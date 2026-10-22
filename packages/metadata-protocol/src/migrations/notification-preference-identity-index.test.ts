// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    buildNotificationPreferenceDuplicateProbeSql,
    buildNotificationPreferenceIdentityIndexSql,
    buildNotificationPreferencePresenceSql,
    ensureNotificationPreferenceIdentityIndex,
    notificationPreferenceIdentityKeyParts,
    resolveNotificationPreferenceIndexSeam,
    NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME,
    NOTIFICATION_PREFERENCE_IDENTITY_PROBE_INDEX_NAME,
    NOTIFICATION_PREFERENCE_TABLE,
} from './notification-preference-identity-index.js';
import type { IndexExec } from './partial-index-probe.js';

/**
 * `sys_notification_preference` — one admin-global default per (organization,
 * topic, channel), the NULL-safe index ADR-0118 D1's empty reference needs.
 *
 * Real SQLite (`node:sqlite`, as the sibling migration suites use), because the
 * defect is a claim about what a UNIQUE index does with NULLs and the one
 * interesting failure mode — existing duplicates — exists only over real rows.
 * The end-to-end half (the real engine, the real driver, the real arming in
 * `assembleMetadataProtocol`) lives in `service-messaging`'s
 * `notification-preference-user-reference.integration.test.ts`.
 */
describe('sys_notification_preference: one admin-global default per key', () => {
    let db: DatabaseSync;
    let exec: IndexExec;

    /**
     * ⚠️ MEASURED, not assembled: byte for byte what `SqlDriver.syncDeclaredIndexes`
     * emits on SQLite for the shipped declaration `{ fields: ['user_id','topic',
     * 'channel'], unique: 'organization' }` — read back from `sqlite_master` after
     * a real `ObjectQL` + `SqlDriver` sync of the object. NULL-distinct on user_id.
     */
    const DECLARED_INDEX_DDL =
        'CREATE UNIQUE INDEX `uniq_sys_notification_preference_a22d7d27` on ' +
        '`sys_notification_preference` (`organization_id`, `user_id`, `topic`, `channel`)';
    /** What an 18.0 release built for the same declaration: ADR-0120 D3's NULL-safe organization part. */
    const DECLARED_INDEX_DDL_18_0 =
        'CREATE UNIQUE INDEX `uniq_sys_notification_preference_a22d7d27` ON `sys_notification_preference` ' +
        "(COALESCE(`organization_id`, '__global__'), `user_id`, `topic`, `channel`)";

    const indexDdl = (name: string): string | undefined =>
        (db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as { sql?: string } | undefined)
            ?.sql ?? undefined;

    const rows = (): Array<Record<string, unknown>> =>
        db.prepare(`SELECT id, organization_id, user_id, topic, channel FROM ${NOTIFICATION_PREFERENCE_TABLE} ORDER BY id`).all() as Array<
            Record<string, unknown>
        >;

    /** One preference row. `user_id` NULL is the admin-global default. */
    const insert = (
        id: string,
        over: { organization_id?: string | null; user_id?: string | null; topic?: string; channel?: string } = {},
    ): boolean => {
        const r = { organization_id: 'org_jia', user_id: null as string | null, topic: 'deal.won', channel: 'email', ...over };
        try {
            db.prepare(
                `INSERT INTO ${NOTIFICATION_PREFERENCE_TABLE} (id, organization_id, user_id, topic, channel, enabled) VALUES (?,?,?,?,?,0)`,
            ).run(id, r.organization_id, r.user_id, r.topic, r.channel);
            return true;
        } catch {
            return false;
        }
    };

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`CREATE TABLE sys_notification_preference (
            id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, topic TEXT, channel TEXT, enabled INTEGER
        );`);
        db.exec(DECLARED_INDEX_DDL);
        exec = async (sql: string) => db.exec(sql);
    });

    afterEach(() => {
        db.close();
    });

    it('BEFORE: the declared index admits two global defaults for one key in one organization', () => {
        expect(insert('a')).toBe(true);
        expect(insert('b')).toBe(true);
        // Control: the same real user twice IS refused, so it is the NULL.
        expect(insert('u1', { user_id: 'usr_1' })).toBe(true);
        expect(insert('u2', { user_id: 'usr_1' })).toBe(false);
    });

    it('AFTER: a second global default for the key is refused; NULL and the empty string are one bucket', async () => {
        expect(await ensureNotificationPreferenceIdentityIndex(exec)).toEqual({ status: 'created' });
        expect(insert('a')).toBe(true);
        expect(insert('b')).toBe(false);
        // '' is the engine's other "no link" spelling; the resolver reads it as
        // the global default too, so the index must not admit it beside a NULL.
        expect(insert('c', { user_id: '' })).toBe(false);
    });

    it('AFTER (anti-vacuity): the key stays per organization, per topic and per channel', async () => {
        await ensureNotificationPreferenceIdentityIndex(exec);
        expect(insert('a')).toBe(true);
        expect(insert('other-org', { organization_id: 'org_yi' })).toBe(true);
        expect(insert('other-topic', { topic: 'deal.lost' })).toBe(true);
        expect(insert('other-channel', { channel: 'inbox' })).toBe(true);
        expect(insert('wildcard-topic', { topic: '*' })).toBe(true);
    });

    it('AFTER: a real user still gets one row per key, and a user row never collides with the global default', async () => {
        await ensureNotificationPreferenceIdentityIndex(exec);
        expect(insert('g')).toBe(true);
        expect(insert('u1', { user_id: 'usr_1' })).toBe(true);
        expect(insert('u1-again', { user_id: 'usr_1' })).toBe(false);
        expect(insert('u2', { user_id: 'usr_2' })).toBe(true);
    });

    it('claims the DECLARED name with the NULL-safe key, leaves no probe index, and keeps the rows as stored', async () => {
        insert('g');
        insert('u', { user_id: 'usr_1' });
        await ensureNotificationPreferenceIdentityIndex(exec);
        const ddl = indexDdl(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME)!;
        expect(ddl).toContain("COALESCE(user_id, '')");
        expect(ddl).not.toContain('__global__');
        expect(indexDdl(NOTIFICATION_PREFERENCE_IDENTITY_PROBE_INDEX_NAME)).toBeUndefined();
        // Storage untouched: the global default keeps its NULL.
        expect(rows().map((r) => r.user_id)).toEqual([null, 'usr_1']);
    });

    it('is idempotent — a second run leaves a byte-identical definition', async () => {
        await ensureNotificationPreferenceIdentityIndex(exec);
        const first = indexDdl(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME);
        expect(await ensureNotificationPreferenceIdentityIndex(exec)).toEqual({ status: 'created' });
        expect(indexDdl(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME)).toBe(first);
    });

    it('an 18.0 index under the declared name (COALESCE organization) is rebuilt to the plain organization key', async () => {
        db.exec(`DROP INDEX ${NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME}`);
        db.exec(DECLARED_INDEX_DDL_18_0);
        await ensureNotificationPreferenceIdentityIndex(exec);
        expect(indexDdl(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME)).toBe(
            buildNotificationPreferenceIdentityIndexSql(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME).replace(' IF NOT EXISTS', ''),
        );
    });

    describe('a database that already holds two global defaults for one key', () => {
        beforeEach(() => {
            insert('d1');
            insert('d2');
        });

        it('refuses, deletes nothing, and leaves the previous index in place and enforcing', async () => {
            expect((await ensureNotificationPreferenceIdentityIndex(exec)).status).toBe('conflict');
            expect(rows().map((r) => r.id)).toEqual(['d1', 'd2']);
            expect(indexDdl(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME)).toBe(DECLARED_INDEX_DDL);
            expect(indexDdl(NOTIFICATION_PREFERENCE_IDENTITY_PROBE_INDEX_NAME)).toBeUndefined();
            expect(insert('u1', { user_id: 'usr_1' })).toBe(true);
            expect(insert('u2', { user_id: 'usr_1' })).toBe(false);
        });

        it('reports once at ERROR, naming the index, the consequence, and the query that lists the rows', async () => {
            const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
            await ensureNotificationPreferenceIdentityIndex(exec, logger);
            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.warn).not.toHaveBeenCalled();
            const [message] = logger.error.mock.calls[0]!;
            expect(message).toContain(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME);
            expect(message).toContain('The previous index is left in place');
            expect(message).toContain('no row is discarded automatically');
            expect(message).toContain(buildNotificationPreferenceDuplicateProbeSql());
            expect(message).toContain('os migrate duplicates');
        });

        it('the shipped query lists exactly the offending key, on the folded user part', () => {
            insert('other-org', { organization_id: 'org_yi' });
            insert('u', { user_id: 'usr_1' });
            expect(db.prepare(buildNotificationPreferenceDuplicateProbeSql()).all()).toEqual([
                { organization_id: 'org_jia', user_id_key: '', topic: 'deal.won', channel: 'email', duplicate_rows: 2 },
            ]);
        });

        it('keeps refusing until an operator deletes one — then converges', async () => {
            expect((await ensureNotificationPreferenceIdentityIndex(exec)).status).toBe('conflict');
            db.prepare(`DELETE FROM ${NOTIFICATION_PREFERENCE_TABLE} WHERE id=?`).run('d2');
            expect(await ensureNotificationPreferenceIdentityIndex(exec)).toEqual({ status: 'created' });
        });
    });

    describe('composition and dialect', () => {
        it('no such table: a silent no-op that issues only the presence probe', async () => {
            const bare = new DatabaseSync(':memory:');
            const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
            const statements: string[] = [];
            const bareExec: IndexExec = async (sql: string) => {
                statements.push(sql);
                return bare.exec(sql);
            };
            expect(await ensureNotificationPreferenceIdentityIndex(bareExec, logger)).toEqual({ status: 'absent' });
            expect(logger.error).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            expect(statements).toEqual([buildNotificationPreferencePresenceSql()]);
            bare.close();
        });

        it('no raw-SQL driver: a no-op', async () => {
            const logger = { error: vi.fn(), warn: vi.fn() };
            expect(await ensureNotificationPreferenceIdentityIndex(undefined, logger)).toEqual({ status: 'no-driver' });
            expect(logger.error).not.toHaveBeenCalled();
        });

        it('a dialect that rejects functional key parts (MySQL): degraded at error, previous index intact', async () => {
            const logger = { error: vi.fn(), warn: vi.fn() };
            const refusing: IndexExec = async (sql: string) => {
                if (/^CREATE UNIQUE INDEX/i.test(sql)) throw new Error("You have an error in your SQL syntax near '(COALESCE'");
                return db.exec(sql);
            };
            expect((await ensureNotificationPreferenceIdentityIndex(refusing, logger)).status).toBe('unsupported');
            expect(indexDdl(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME)).toBe(DECLARED_INDEX_DDL);
            const [message] = logger.error.mock.calls[0]!;
            expect(message).toContain('stays NULL-distinct on user_id');
            // No identifier in the listing is reserved on MySQL, so the one
            // statement is the remedy there too.
            expect(message).toContain(buildNotificationPreferenceDuplicateProbeSql());
        });

        it('an unclassifiable failure is still reported at error, with the previous index kept', async () => {
            const logger = { error: vi.fn(), warn: vi.fn() };
            const broken: IndexExec = async (sql: string) => {
                if (/^CREATE UNIQUE INDEX/i.test(sql)) throw new Error('disk I/O error');
                return db.exec(sql);
            };
            expect((await ensureNotificationPreferenceIdentityIndex(broken, logger)).status).toBe('failed');
            expect(indexDdl(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME)).toBe(DECLARED_INDEX_DDL);
            expect(logger.error).toHaveBeenCalledTimes(1);
        });
    });

    describe('the statements', () => {
        it('key parts: the plain organization column, the folded user, then topic and channel', () => {
            expect(notificationPreferenceIdentityKeyParts()).toEqual([
                'organization_id',
                "COALESCE(user_id, '')",
                'topic',
                'channel',
            ]);
        });

        it('the CREATE spans every row (no WHERE) under the given name', () => {
            expect(buildNotificationPreferenceIdentityIndexSql('x')).toBe(
                "CREATE UNIQUE INDEX IF NOT EXISTS x ON sys_notification_preference (organization_id, COALESCE(user_id, ''), topic, channel)",
            );
        });
    });

    describe('resolveNotificationPreferenceIndexSeam', () => {
        it('asks which driver owns the table, and returns nothing for a host with no raw-SQL driver', () => {
            const asked: string[] = [];
            const driver = { execute: async () => [], config: { client: 'better-sqlite3' } };
            const engine = {
                getDriverForObject: (name: string) => {
                    asked.push(name);
                    return driver;
                },
            };
            const seam = resolveNotificationPreferenceIndexSeam(engine);
            expect(asked).toEqual([NOTIFICATION_PREFERENCE_TABLE]);
            expect(typeof seam?.exec).toBe('function');
            expect(resolveNotificationPreferenceIndexSeam({})).toBeUndefined();
        });
    });
});

describe('armed from assembleMetadataProtocol, under runPlatformMigrations only', () => {
    /** The assembly over a recording seam; returns the statements each kernel:ready handler issued. */
    async function readyStatements(runPlatformMigrations: boolean): Promise<string[]> {
        const statements: string[] = [];
        const execute = async (sql: string) => {
            statements.push(String(sql));
            return [];
        };
        const driver = { execute, raw: execute, config: { client: 'better-sqlite3' } };
        const ql = { registerApp: () => {}, driver, getDriver: () => driver, getDriverForObject: () => driver };
        const hooks: Array<() => unknown> = [];
        const ctx = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            getService: vi.fn(() => undefined),
            getServices: () => new Map(),
            hook: (name: string, handler: () => unknown) => {
                if (name === 'kernel:ready') hooks.push(handler);
            },
        } as any;
        const { assembleMetadataProtocol } = await import('../plugin.js');
        assembleMetadataProtocol(ctx, ql, undefined, { runPlatformMigrations });
        for (const handler of hooks) await handler();
        return statements;
    }

    it('asks about sys_notification_preference at kernel:ready when the platform migrations are armed', async () => {
        const statements = await readyStatements(true);
        expect(statements.some((sql) => sql.includes(NOTIFICATION_PREFERENCE_TABLE))).toBe(true);
    });

    it('issues nothing against it when they are not (a per-project kernel)', async () => {
        const statements = await readyStatements(false);
        expect(statements.filter((sql) => sql.includes(NOTIFICATION_PREFERENCE_TABLE))).toEqual([]);
    });
});
