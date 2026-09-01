// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
// [#5855] The fake engine's write verbs route through the producer's OWN
// dispatch predicates (#4550 delete / #5480 update), so this double cannot
// accept a call `ObjectQL.<verb>` refuses. Imported from
// `@objectstack/metadata-core` (already a `dependencies` entry here) and not
// from `@objectstack/objectql`, which depends on this package — that import
// would close a dependency cycle turbo rejects, and is why both of this file's
// (file, verb) pairs sat in the gate's DEBT ledger until #5619 sank the two
// predicates into a package that depends on neither side.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { migrateSysNotificationToEvent } from './migrate-sys-notification-to-event.js';

/** Columns the legacy (pre-ADR-0030) sys_notification table physically has. */
const LEGACY_TABLE_COLUMNS = [
    'id', 'recipient_id', 'type', 'title', 'body', 'url', 'actor_name',
    'is_read', 'read_at', 'created_at', 'organization_id', 'topic', 'payload', 'severity',
];

function fakeDriver(rows: any[], columns: string[] = LEGACY_TABLE_COLUMNS) {
    const updates: Array<{ sql: string; bindings: any[] }> = [];
    return {
        updates,
        driver: {
            async raw(sql: string, bindings: any[] = []) {
                if (sql.startsWith('PRAGMA table_info')) {
                    return columns.map((name) => ({ name }));
                }
                if (sql.startsWith('SELECT id, recipient_id')) {
                    return rows;
                }
                if (sql.startsWith('UPDATE')) {
                    updates.push({ sql, bindings });
                    return [];
                }
                return [];
            },
        } as any,
    };
}

function fakeEngine() {
    const inserts: Array<{ object: string; row: any }> = [];
    const updates: Array<{ object: string; data: any }> = [];
    return {
        inserts,
        updates,
        engine: {
            async insert(object: string, row: any) {
                inserts.push({ object, row });
                return { id: `${object}_${inserts.length}`, ...row };
            },
            async update(object: string, data: any, options?: Record<string, unknown>) {
                assertEngineUpdateDispatch(data, options);
                updates.push({ object, data });
                return data;
            },
            async find() { return []; },
            async findOne(object: string, query?: EngineFindOneQueryInput) {
                              assertEngineFindOnePredicate(object, query); return null; },
            async delete(_object?: string, options?: Record<string, unknown>) {
                assertEngineDeleteDispatch(options);
                return {};
            },
            async count() { return 0; },
            async aggregate() { return []; },
        } as any,
    };
}

describe('migrateSysNotificationToEvent', () => {
    it('splits each legacy row into inbox + receipt and rewrites the event', async () => {
        const d = fakeDriver([
            { id: 'n1', recipient_id: 'u1', type: 'mention', title: 'You were mentioned', body: 'hi', url: '/x', actor_name: 'Ada', is_read: 0, read_at: null, created_at: '2026-01-01T00:00:00.000Z', organization_id: 'org_1' },
            { id: 'n2', recipient_id: 'u2', type: 'assignment', title: 'Assigned', body: null, url: null, actor_name: null, is_read: 1, read_at: '2026-02-02T00:00:00.000Z', created_at: '2026-02-01T00:00:00.000Z', organization_id: 'org_1' },
        ]);
        const e = fakeEngine();

        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine });

        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(2);

        const inbox = e.inserts.filter((i) => i.object === 'sys_inbox_message');
        const receipts = e.inserts.filter((i) => i.object === 'sys_notification_receipt');
        expect(inbox).toHaveLength(2);
        expect(receipts).toHaveLength(2);

        // Row 1: unread → delivered receipt; inbox keyed by recipient, linked to event.
        expect(inbox[0].row).toMatchObject({ user_id: 'u1', notification_id: 'n1', title: 'You were mentioned', action_url: '/x', organization_id: 'org_1' });
        expect(receipts[0].row).toMatchObject({ notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'delivered' });

        // Row 2: read → read receipt carrying read_at.
        expect(receipts[1].row).toMatchObject({ notification_id: 'n2', user_id: 'u2', state: 'read', at: '2026-02-02T00:00:00.000Z' });

        // The event row is rewritten (topic ← type, payload built) and legacy columns nulled.
        const ev = e.updates.filter((u) => u.object === 'sys_notification');
        expect(ev[0].data).toMatchObject({ id: 'n1', topic: 'mention', payload: { title: 'You were mentioned', url: '/x', actorName: 'Ada' } });
        expect(d.updates).toHaveLength(2);
        expect(d.updates[0].sql).toContain('"recipient_id" = NULL');
        expect(d.updates[0].bindings).toEqual(['n1']);
    });

    it('works on a Postgres-style driver where PRAGMA throws (information_schema fallback)', async () => {
        // PRAGMA raises a syntax error on Postgres; columnExists must fall
        // through to information_schema rather than reporting not_applicable.
        const rows = [
            { id: 'n1', recipient_id: 'u1', type: 'mention', title: 'hi', body: null, url: null, actor_name: null, is_read: false, read_at: null, created_at: '2026-01-01T00:00:00.000Z', organization_id: 'org_1' },
        ];
        const updates: Array<{ sql: string; bindings: any[] }> = [];
        const pgDriver = {
            async raw(sql: string, bindings: any[] = []) {
                if (sql.startsWith('PRAGMA')) throw new Error('syntax error at or near "PRAGMA"');
                if (sql.includes('information_schema')) {
                    // bindings = [table, column]; report the column as present.
                    return [{ column_name: bindings[1] }];
                }
                if (sql.startsWith('SELECT id, recipient_id')) return rows;
                if (sql.startsWith('UPDATE')) { updates.push({ sql, bindings }); return []; }
                return [];
            },
        } as any;
        const e = fakeEngine();

        const result = await migrateSysNotificationToEvent({ driver: pgDriver, data: e.engine });

        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(1);
        expect(e.inserts.map((i) => i.object)).toEqual(['sys_inbox_message', 'sys_notification_receipt']);
    });

    it('is idempotent — no legacy rows means already_done', async () => {
        const d = fakeDriver([]);
        const e = fakeEngine();
        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine });
        expect(result.status).toBe('already_done');
        expect(e.inserts).toHaveLength(0);
    });

    it('reports not_applicable when the table never had a recipient_id column', async () => {
        const d = fakeDriver([], ['id', 'topic', 'payload', 'severity', 'created_at']);
        const e = fakeEngine();
        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine });
        expect(result.status).toBe('not_applicable');
    });

    it('errors cleanly when the driver has NEITHER raw() nor execute()', async () => {
        // The totality floor. A driver offering no raw-SQL surface at all must
        // still be refused — that half of the guard is not what was wrong with
        // it. What was wrong is that `raw` was the ONLY surface it accepted, so
        // it also refused every driver this repo ships; see
        // `real-driver-exec-surface.test.ts` for the other half.
        const e = fakeEngine();
        const result = await migrateSysNotificationToEvent({ driver: {} as any, data: e.engine });
        expect(result.status).toBe('error');
        expect(result.error).toContain('.execute(sql, bindings?)');
        expect(result.error).toContain('.raw(sql, bindings?)');
    });

    it('drives a driver that offers only execute(), passing bindings positionally', async () => {
        // A double deliberately shaped like the DECLARED contract
        // (`IDataDriver.execute(command, parameters?, options?)`) rather than
        // like the helper's old assumption. The real-driver coverage lives in
        // `real-driver-exec-surface.test.ts`; this case additionally pins that
        // the second argument arrives as the bindings ARRAY, which is the part a
        // mechanical `raw`->`execute` rename could get wrong silently.
        const seen: Array<{ sql: string; bindings: unknown }> = [];
        const executeOnly = {
            async execute(sql: string, bindings?: unknown[]) {
                seen.push({ sql, bindings });
                if (sql.startsWith('PRAGMA table_info')) {
                    return LEGACY_TABLE_COLUMNS.map((name) => ({ name }));
                }
                if (sql.startsWith('SELECT id, recipient_id')) {
                    return [{ id: 'n1', recipient_id: 'u1', type: 'mention', title: 't', body: null, url: null, actor_name: null, is_read: 0, read_at: null, created_at: '2026-01-01T00:00:00.000Z', organization_id: 'org_1' }];
                }
                return [];
            },
        } as any;
        expect(typeof executeOnly.raw, 'the double must NOT carry a raw()').not.toBe('function');
        const e = fakeEngine();

        const result = await migrateSysNotificationToEvent({ driver: executeOnly, data: e.engine });

        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(1);
        const update = seen.find((c) => c.sql.startsWith('UPDATE'));
        expect(update?.bindings).toEqual(['n1']);
        // An unbound statement gets an empty array, never `undefined` — the
        // shape `SqlDriver.execute` and TursoDriver both normalize to anyway.
        expect(seen.find((c) => c.sql.startsWith('PRAGMA'))?.bindings).toEqual([]);
    });
});
