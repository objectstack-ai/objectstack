// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5792 / Part of #3877] Stage A, notification family — the PRODUCER half.
//
// `/api/v1/notifications` is served by the dispatcher's `/notifications` domain,
// which forwards `deps.success(result)` untouched. So the body on the wire is
// authored HERE: `MessagingService.listInbox / markRead / markAllRead` are the
// only things that decide its shape, and the catalog
// (`plugin-rest-api.zod.ts`, `DEFAULT_NOTIFICATION_ROUTES`) declares one
// `responseSchema` per route:
//
//   GET  /notifications        → ListNotificationsResponseSchema      → listInbox()
//   POST /notifications/read   → MarkNotificationsReadResponseSchema  → markRead()
//   POST /notifications/read/all → MarkAllNotificationsReadResponseSchema → markAllRead()
//
// Until this file nothing had ever put an emitted body and its declaring schema
// in the same assertion — every existing inbox test compares the result against
// a hand-written literal, which proves the code does what the test author
// believed, never what the contract declares (#3877's founding observation).
//
// ## The two assertions, and why one is not enough (#5682's lesson)
//
// Each route gets TWO deliberately different questions:
//
//   * `Schema.safeParse()` judges VALUES — required keys present, `createdAt`
//     a real ISO-8601 instant, `read` a boolean, `unreadCount` a number.
//   * the key-set subset check judges KEYS — nothing emitted that the protocol
//     never declared. `safeParse` is BLIND to this: a zod object strips unknown
//     keys by default, so a producer that grows an extra key parses clean
//     forever. That is exactly how `features` / `endpoints` survived on the
//     discovery surface until #4828.
//
// The allowed key set is derived from the schema's own `shape` — never a
// hand-written array — so this gate cannot become a third dialect of the
// contract (#5682, and the maintainer's 2026-08-06 ruling point 3).
//
// ## Extended one level down, not recursed
//
// `notifications[]` rows are checked against `NotificationSchema` the same way.
// That is where this family's whole payload lives — a top-level-only gate would
// see two keys and nothing else, i.e. it would be nearly vacuous. Same call
// #5679 made for `routes`: extend to the level with a measured producer, do not
// recurse into open `z.record`s.
//
// ## Why the fixture is written by the REAL inbox channel
//
// `listInbox` maps stored rows, so a hand-written row fixture would let the test
// author invent the input as well as expect the output. The seed here is
// produced by driving the real single ingress (`emit()`) through the real
// `inbox` channel (`createInboxChannel`) into an in-memory engine, so only the
// STORAGE is a double. The row shape under test is the one `sys_inbox_message`
// actually receives in production.

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
    ListNotificationsResponseSchema,
    MarkNotificationsReadResponseSchema,
    MarkAllNotificationsReadResponseSchema,
    NotificationSchema,
} from '@objectstack/spec/api';
import { MessagingService } from './messaging-service.js';
import { createInboxChannel } from './inbox-channel.js';

const USER = 'usr_conformance';

/** Declared top-level keys of the list response — derived, never hand-listed. */
function declaredListKeys(): Set<string> {
    return new Set(Object.keys((ListNotificationsResponseSchema as any).shape));
}

/** Declared keys of ONE inbox row (`notifications[]`) — the level down. */
function declaredNotificationKeys(): Set<string> {
    return new Set(Object.keys((NotificationSchema as any).shape));
}

/** Declared keys of the mark-read responses (both routes share the shape). */
function declaredMarkReadKeys(): Set<string> {
    return new Set(Object.keys((MarkNotificationsReadResponseSchema as any).shape));
}

function declaredMarkAllReadKeys(): Set<string> {
    return new Set(Object.keys((MarkAllNotificationsReadResponseSchema as any).shape));
}

const silentLogger = () => ({
    debug() {}, info() {}, warn() {}, error() {},
}) as any;

/**
 * In-memory stand-in for the data engine, supporting the flat-equality `where`
 * filters the inbox read API issues plus the receipt upsert. The STORAGE is the
 * only fake here.
 *
 * `update` opens with `assertEngineUpdateDispatch(data, options)` — the
 * PRODUCER's own dispatch predicate (`@objectstack/metadata-core`), not a
 * hand-mirrored `if`. `check:engine-double-contract` requires it, and the
 * reason is this file's whole subject one layer down: a double looser than the
 * real engine accepts calls a real server refuses, and the suite stays green
 * over a route that is dead in production (#4434 / #5197). Declared members are
 * exactly the ones the inbox read path calls — a fake verb nothing exercises is
 * a second contract nobody checks.
 */
function inboxEngine() {
    const store: Record<string, any[]> = {};
    let seq = 0;
    const matches = (row: any, where: any = {}) =>
        Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return String(row[k]) === String(v);
        });
    return {
        store,
        async find(object: string, query: any = {}) {
            let rows = (store[object] ?? []).filter((r) => matches(r, query.where));
            const ob = Array.isArray(query.orderBy) ? query.orderBy : [];
            if (ob.some((o: any) => o.field === 'created_at' && o.order === 'desc')) {
                rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            }
            return typeof query.limit === 'number' ? rows.slice(0, query.limit) : rows;
        },
        async findOne(object: string, query: any = {}) {
            return (store[object] ?? []).find((r) => matches(r, query.where)) ?? null;
        },
        async insert(object: string, row: any) {
            const created = { id: `row_${++seq}`, ...row };
            (store[object] ??= []).push(created);
            return created;
        },
        async update(object: string, data: any, options: any = {}) {
            assertEngineUpdateDispatch(data, options);
            for (const r of store[object] ?? []) {
                if (matches(r, options.where)) Object.assign(r, data);
            }
            return {};
        },
    } as any;
}

/**
 * A service whose inbox rows were written by the REAL `inbox` channel through
 * the REAL `emit()` ingress. Two notifications: one carrying an `actionUrl`,
 * one without — so the optional key is exercised in both states.
 */
async function seededService() {
    const engine = inboxEngine();
    const service = new MessagingService({ logger: silentLogger(), getData: () => engine });
    service.registerChannel(createInboxChannel({ getData: () => engine }));

    await service.emit({
        topic: 'deal.won',
        audience: [USER],
        payload: { title: 'Deal one', body: 'first', actionUrl: '/records/1' },
    });
    await service.emit({
        topic: 'task.assigned',
        audience: [USER],
        payload: { title: 'Task two', body: 'second' },
    });

    return { service, engine };
}

describe('[#5792] MessagingService conforms to the schemas the catalog declares', () => {
    describe('GET /notifications → listInbox() / ListNotificationsResponseSchema', () => {
        it('satisfies the declared schema (VALUE assertion)', async () => {
            const { service } = await seededService();

            const body = await service.listInbox(USER);

            const result = ListNotificationsResponseSchema.safeParse(body);
            expect(
                result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
                'listInbox() must satisfy ListNotificationsResponseSchema',
            ).toEqual([]);
        });

        it('emits NO top-level key the protocol does not declare (KEY assertion)', async () => {
            const { service } = await seededService();

            const body = await service.listInbox(USER);

            const declared = declaredListKeys();
            const undeclared = Object.keys(body).filter((k) => !declared.has(k));
            expect(undeclared, 'undeclared top-level keys on the listInbox() body').toEqual([]);
        });

        it('emits NO `notifications[]` key the protocol does not declare (KEY assertion, one level down)', async () => {
            const { service } = await seededService();

            const body = await service.listInbox(USER);

            const declared = declaredNotificationKeys();
            const undeclared = [
                ...new Set(body.notifications.flatMap((n) => Object.keys(n).filter((k) => !declared.has(k)))),
            ];
            expect(undeclared, 'undeclared keys inside notifications[] on the listInbox() body').toEqual([]);
        });

        it('anti-vacuity: the fixture really produces rows, so neither assertion passes on an empty list', async () => {
            const { service } = await seededService();

            const body = await service.listInbox(USER);

            // Without this, both gates above are satisfied by `{notifications: [], unreadCount: 0}`
            // — the empty-verdict green #5046 warns about.
            expect(body.notifications).toHaveLength(2);
            expect(body.unreadCount).toBe(2);
            expect(body.notifications.every((n) => NotificationSchema.safeParse(n).success)).toBe(true);
        });

        it('every row carries the REQUIRED keys, with `createdAt` a real ISO-8601 instant', async () => {
            const { service } = await seededService();

            const body = await service.listInbox(USER);

            for (const row of body.notifications) {
                // `NotificationSchema.createdAt` is `z.string().datetime()`, which is
                // stricter than "a string": a SQL-flavoured `2026-01-01 00:00:00`
                // would parse as a string and fail the datetime refinement. This is
                // the one value in the family a driver could plausibly hand back in
                // the wrong dialect, so it is asserted as a value, not a type.
                expect(typeof row.createdAt, `createdAt on ${row.id}`).toBe('string');
                expect(
                    NotificationSchema.safeParse(row).success,
                    `row ${row.id} does not satisfy NotificationSchema: ${JSON.stringify(row)}`,
                ).toBe(true);
                expect(new Date(row.createdAt).toISOString()).toBe(row.createdAt);
            }
        });

        it('`actionUrl` is a DECLARED optional — the key is present either way, value `undefined` when absent', async () => {
            const { service } = await seededService();

            const body = await service.listInbox(USER);
            const withUrl = body.notifications.find((n) => n.title === 'Deal one')!;
            const withoutUrl = body.notifications.find((n) => n.title === 'Task two')!;

            expect(withUrl.actionUrl).toBe('/records/1');
            // The mapper writes `actionUrl: … ?? undefined` unconditionally, so
            // `Object.keys()` sees the key on BOTH rows while `JSON.stringify`
            // drops it from the one that is empty. The key gate above reads
            // `Object.keys()`, i.e. the stricter of the two views — the same
            // `routes.mcp` nuance #5679 measured on the discovery producer.
            expect(Object.prototype.hasOwnProperty.call(withoutUrl, 'actionUrl')).toBe(true);
            expect(withoutUrl.actionUrl).toBeUndefined();
            expect(declaredNotificationKeys().has('actionUrl')).toBe(true);
        });
    });

    describe('POST /notifications/read → markRead() / MarkNotificationsReadResponseSchema', () => {
        it('satisfies the declared schema (VALUE assertion)', async () => {
            const { service } = await seededService();
            const ids = (await service.listInbox(USER)).notifications.map((n) => n.id);

            const body = await service.markRead(USER, [ids[0]]);

            const result = MarkNotificationsReadResponseSchema.safeParse(body);
            expect(
                result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
                'markRead() must satisfy MarkNotificationsReadResponseSchema',
            ).toEqual([]);
            // Anti-vacuity: a no-op `{success:true, readCount:0}` also parses, so
            // pin that this call really transitioned a notification.
            expect(body.readCount).toBe(1);
        });

        it('emits NO key the protocol does not declare (KEY assertion)', async () => {
            const { service } = await seededService();
            const ids = (await service.listInbox(USER)).notifications.map((n) => n.id);

            const body = await service.markRead(USER, [ids[0]]);

            const declared = declaredMarkReadKeys();
            expect(
                Object.keys(body).filter((k) => !declared.has(k)),
                'undeclared keys on the markRead() body',
            ).toEqual([]);
        });

        it('the degraded exit (no data engine) is a CONFORMING body too', async () => {
            // The early return `{ success: true, readCount: 0 }` is its own emit
            // site; a shape that only conforms on the happy path is not a
            // conforming route.
            const noData = new MessagingService({ logger: silentLogger() });

            const body = await noData.markRead(USER, ['n1']);

            expect(MarkNotificationsReadResponseSchema.safeParse(body).success).toBe(true);
            expect(Object.keys(body).filter((k) => !declaredMarkReadKeys().has(k))).toEqual([]);
        });
    });

    describe('POST /notifications/read/all → markAllRead() / MarkAllNotificationsReadResponseSchema', () => {
        it('satisfies the declared schema (VALUE assertion)', async () => {
            const { service } = await seededService();

            const body = await service.markAllRead(USER);

            const result = MarkAllNotificationsReadResponseSchema.safeParse(body);
            expect(
                result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
                'markAllRead() must satisfy MarkAllNotificationsReadResponseSchema',
            ).toEqual([]);
            expect(body.readCount).toBe(2);
        });

        it('emits NO key the protocol does not declare (KEY assertion)', async () => {
            const { service } = await seededService();

            const body = await service.markAllRead(USER);

            const declared = declaredMarkAllReadKeys();
            expect(
                Object.keys(body).filter((k) => !declared.has(k)),
                'undeclared keys on the markAllRead() body',
            ).toEqual([]);
        });

        it('the empty-inbox exit is a CONFORMING body too', async () => {
            const { service } = await seededService();
            await service.markAllRead(USER);

            const body = await service.markAllRead(USER); // nothing left unread

            expect(MarkAllNotificationsReadResponseSchema.safeParse(body).success).toBe(true);
            expect(body.readCount).toBe(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // The two mark-read routes declare SEPARATE schemas for one shape
    // ═══════════════════════════════════════════════════════════════════════
    //
    // #5682 added an equivalence pin because discovery had a lenient response
    // schema beside a strict producer schema, and either could grow a key alone.
    // This family has no lenient/strict pair — the catalog's `responseSchema`
    // IS the producer contract, and no consumer parses a second, looser copy
    // (`client.notifications.*` types its returns with `z.infer` of these very
    // schemas and performs no runtime parse). What it DOES have is the other
    // shape of the same risk: two separately-declared schemas that must stay
    // identical because ONE producer method (`markAllRead` delegates to
    // `markRead`) emits both bodies. Pinned for the same reason.
    it('MarkNotificationsRead and MarkAllNotificationsRead declare the SAME key set', () => {
        expect(declaredMarkAllReadKeys()).toEqual(declaredMarkReadKeys());
    });
});
