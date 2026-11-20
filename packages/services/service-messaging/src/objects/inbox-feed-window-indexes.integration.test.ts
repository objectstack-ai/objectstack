// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inbox feed's two window reads are served by an index, not by a sort of
 * the user's whole history.
 *
 * The Console's bell (and Home's action centre) polls two reads every 10 s in
 * the foreground (`useSharedInboxFeed` in `@object-ui/app-shell`):
 *
 *   - `sys_inbox_message` filtered by `user_id`, newest first, top 20;
 *   - `sys_notification_receipt` filtered by `user_id` + `channel: 'inbox'`,
 *     newest first, top 20.
 *
 * With no key leading on the filter columns and continuing with `created_at`,
 * the receipt read collected every row of the user's `(user_id, state)` range
 * and sorted it (SQLite: `USE TEMP B-TREE FOR ORDER BY`), and the inbox read
 * walked the table-wide `(created_at, id)` index backwards, filtering out
 * every other user's rows on the way: the cost grew with the history, not
 * with the window.
 *
 * Pinned in two halves:
 *
 *   1. the declarations, on the BUILT values a driver is handed
 *      (`ObjectSchema.create` normalizes `{ fields }` to `unique: false`);
 *   2. on a real `ObjectQL` over `SqlDriver` (better-sqlite3): schema sync
 *      creates both indexes, and the SQL the engine emits for each read
 *      (`created_at desc` plus the driver's `id desc` tie-breaker, `limit 20`)
 *      SEARCHes its index on the filter columns and sorts no more than the
 *      tie-breaker. The plan is asked of the emitted statement, captured off
 *      the connection, so a change to how the engine spells either read is
 *      judged too.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { InboxMessage } from './inbox-message.object.js';
import { NotificationReceipt } from './notification-receipt.object.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from '../default-organization.testkit.js';

const SYS = { context: { isSystem: true, tenantId: DEFAULT_ORGANIZATION_ID } } as any;
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

const INBOX_INDEX = 'idx_sys_inbox_message_user_id_created_at';
const RECEIPT_INDEX = 'idx_sys_notification_receipt_user_id_channel_created_at';

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

async function boot(): Promise<{ ql: ObjectQL; driver: SqlDriver }> {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    const ql = new ObjectQL({ logger: silent });
    ql.registerDriver(driver, true);
    await ql.init();
    for (const def of [InboxMessage, NotificationReceipt]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    await installDefaultOrganization(ql as any);
    engine = ql;
    return { ql, driver };
}

/** Run `read` and return the one SELECT it sent to `table`, as the connection saw it. */
async function emitted(
    driver: SqlDriver,
    table: string,
    read: () => Promise<unknown>,
): Promise<{ sql: string; bindings: unknown[] }> {
    const knex = driver.getKnex();
    const seen: Array<{ sql: string; bindings: unknown[] }> = [];
    const listener = (q: { sql: string; bindings: unknown[] }) => {
        if (/^select/i.test(q.sql) && q.sql.includes(`\`${table}\``)) seen.push({ sql: q.sql, bindings: q.bindings });
    };
    knex.on('query', listener);
    try {
        await read();
    } finally {
        knex.off('query', listener);
    }
    expect(seen, `exactly one SELECT on ${table}`).toHaveLength(1);
    return seen[0]!;
}

async function plan(driver: SqlDriver, stmt: { sql: string; bindings: unknown[] }): Promise<string[]> {
    const rows = await driver.getKnex().raw(`EXPLAIN QUERY PLAN ${stmt.sql}`, stmt.bindings as any[]);
    return (rows as Array<{ detail: string }>).map((r) => r.detail);
}

describe('the inbox feed window reads have an index each', () => {
    it('declares (user_id, channel, created_at) on sys_notification_receipt, beside its two existing indexes', () => {
        expect(NotificationReceipt.indexes).toEqual([
            { fields: ['notification_id', 'user_id', 'channel'], unique: 'global' },
            { fields: ['user_id', 'state'], unique: false },
            { fields: ['user_id', 'channel', 'created_at'], unique: false },
        ]);
    });

    it('declares (user_id, created_at) on sys_inbox_message, its only declared index', () => {
        expect(InboxMessage.indexes).toEqual([{ fields: ['user_id', 'created_at'], unique: false }]);
    });

    it('schema sync creates both indexes with the declared key order', async () => {
        const { driver } = await boot();
        const rows = (await driver.getKnex().raw(
            "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name IN (?, ?) ORDER BY name",
            [INBOX_INDEX, RECEIPT_INDEX],
        )) as Array<{ name: string; sql: string }>;
        expect(rows.map((r) => r.name)).toEqual([INBOX_INDEX, RECEIPT_INDEX]);
        expect(rows[0]!.sql).toContain('(`user_id`, `created_at`)');
        expect(rows[1]!.sql).toContain('(`user_id`, `channel`, `created_at`)');
    });

    it('the bell read of sys_inbox_message searches its index by user and sorts only the tie-breaker', async () => {
        const { ql, driver } = await boot();
        for (let i = 0; i < 5; i++) {
            await driver.create('sys_inbox_message', {
                id: `inb_${i}`, user_id: i % 2 ? 'usr_a' : 'usr_b', title: `t${i}`,
                organization_id: DEFAULT_ORGANIZATION_ID, created_at: `2026-11-0${i + 1}T00:00:00.000Z`,
            });
        }
        const stmt = await emitted(driver, 'sys_inbox_message', () =>
            ql.find('sys_inbox_message', {
                where: { user_id: 'usr_a' },
                orderBy: [{ field: 'created_at', order: 'desc' }],
                limit: 20,
            } as any, SYS),
        );
        expect(stmt.sql).toMatch(/order by `created_at` desc, `id` desc limit \?/);
        const detail = await plan(driver, stmt);
        expect(detail).toContain(`SEARCH sys_inbox_message USING INDEX ${INBOX_INDEX} (user_id=?)`);
        expect(detail).not.toContain('USE TEMP B-TREE FOR ORDER BY');
    });

    it('the bell read of sys_notification_receipt searches its index by user and channel and sorts only the tie-breaker', async () => {
        const { ql, driver } = await boot();
        for (let i = 0; i < 6; i++) {
            await driver.create('sys_notification_receipt', {
                id: `rcp_${i}`, notification_id: `ntf_${i}`, user_id: 'usr_a', channel: i % 2 ? 'inbox' : 'email',
                state: 'delivered', organization_id: DEFAULT_ORGANIZATION_ID, created_at: `2026-11-0${i + 1}T00:00:00.000Z`,
            });
        }
        const stmt = await emitted(driver, 'sys_notification_receipt', () =>
            ql.find('sys_notification_receipt', {
                where: { user_id: 'usr_a', channel: 'inbox' },
                orderBy: [{ field: 'created_at', order: 'desc' }],
                limit: 20,
            } as any, SYS),
        );
        expect(stmt.sql).toMatch(/order by `created_at` desc, `id` desc limit \?/);
        const detail = await plan(driver, stmt);
        expect(detail).toContain(`SEARCH sys_notification_receipt USING INDEX ${RECEIPT_INDEX} (user_id=? AND channel=?)`);
        expect(detail).not.toContain('USE TEMP B-TREE FOR ORDER BY');
    });
});
