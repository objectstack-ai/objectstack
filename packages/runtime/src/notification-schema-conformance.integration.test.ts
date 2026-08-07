// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5792 / Part of #3877] Stage A, notification family — the WIRE half.
//
// The other two gates check the two halves in isolation: the producer
// (`service-messaging/src/notification-schema-conformance.test.ts`) and the
// dispatcher domain (`./notification-schema-conformance.test.ts`). This one
// checks the composed shape a browser actually receives, over a real socket,
// through a real SQL driver — the same call #5682 made for the REST discovery
// gate, and for the same reason: neither producer alone is the thing a client
// parses.
//
// Two facts are only measurable here:
//
//   1. `createdAt` is `z.string().datetime()`, i.e. an ISO-8601 instant and not
//      merely "a string". The value makes a full round trip through
//      `sys_inbox_message.created_at` (`Field.datetime()`) and back out of the
//      driver. A driver dialect (`2026-01-01 00:00:00`, or a `Date` object)
//      would satisfy the in-memory producer gate's fixture and fail here.
//   2. `actionUrl` is written unconditionally as `… ?? undefined`, so
//      `Object.keys()` sees the key on every row while `JSON.stringify` drops
//      it from the empty ones. The producer gate reads the object view; only
//      this file reads the JSON view. Both must conform — the `routes.mcp`
//      nuance #5679 measured, in this family.
//
// The boot mirrors `notifications.hono.integration.test.ts` (the #3362
// regression), deliberately: that suite proved the routes are REACHABLE, this
// one proves what comes back is what the catalog declares. Kept as a separate
// file rather than bolted onto it so the conformance gate can be read, moved
// or ratcheted (#3877 Stage D) without dragging a reachability regression with
// it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { MessagingServicePlugin, MessagingService } from '@objectstack/service-messaging';
import {
  envelopeViolations,
  ListNotificationsResponseSchema,
  MarkNotificationsReadResponseSchema,
  MarkAllNotificationsReadResponseSchema,
  NotificationSchema,
} from '@objectstack/spec/api';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { DriverPlugin } from './driver-plugin.js';

// One inbox per concern. The mark-read routes MUTATE read-state, so a shared
// user would make these suites order-dependent — the unread fixture the gap
// suite needs would be consumed by whichever mark-read test ran first.
const LIST_USER = 'usr_notif_conformance_list';
const MARK_USER = 'usr_notif_conformance_mark';
const GAP_USER = 'usr_notif_conformance_gap';

/** Declared key sets — derived from the schemas, never hand-listed. */
const declaredListKeys = () => new Set(Object.keys((ListNotificationsResponseSchema as any).shape));
const declaredNotificationKeys = () => new Set(Object.keys((NotificationSchema as any).shape));
const declaredMarkReadKeys = () => new Set(Object.keys((MarkNotificationsReadResponseSchema as any).shape));
const declaredMarkAllReadKeys = () => new Set(Object.keys((MarkAllNotificationsReadResponseSchema as any).shape));

/** Minimal `auth` service — `x-test-user` names the principal, absent = anonymous. */
function fakeAuthPlugin(): Plugin {
  return {
    name: 'com.objectstack.test.fake-auth-notif-conformance',
    version: '1.0.0',
    init: async (ctx: PluginContext) => {
      ctx.registerService('auth', {
        api: {
          getSession: async ({ headers }: { headers: any }) => {
            const uid = typeof headers?.get === 'function'
              ? headers.get('x-test-user')
              : headers?.['x-test-user'];
            return uid ? { user: { id: uid } } : undefined;
          },
        },
      });
    },
  };
}

describe('[#5792] the notification wire bodies conform to the schemas the catalog declares', () => {
  let kernel: ObjectKernel;
  let baseUrl: string;
  let messaging: MessagingService;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logLevel: 'silent' });
    await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));
    await kernel.use(new ObjectQLPlugin());
    // Inline delivery so `emit()` materializes the inbox row synchronously.
    await kernel.use(new MessagingServicePlugin({ reliableDelivery: false }));
    await kernel.use(fakeAuthPlugin());
    await kernel.use(new HonoServerPlugin({ port: 0 }));
    await kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false, requireAuth: false }));
    await kernel.bootstrap();

    const httpServer = kernel.getService<IHttpServer>('http.server');
    baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
    messaging = kernel.getService<MessagingService>('notification');

    // Three notifications per inbox: one WITH an `actionUrl`, two without — so
    // the optional key is exercised in both states on the wire.
    for (const user of [LIST_USER, MARK_USER, GAP_USER]) {
      await messaging.emit({ topic: 'deal.won', audience: [user], payload: { title: 'Deal one', body: 'first', actionUrl: '/records/1' } });
      await messaging.emit({ topic: 'task.assigned', audience: [user], payload: { title: 'Task two', body: 'second' } });
      await messaging.emit({ topic: 'task.assigned', audience: [user], payload: { title: 'Task three', body: 'third' } });
    }
  }, 60_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([
        kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
  }, 30_000);

  /** Drive one route as `user`, asserting the shared envelope, and hand back `data`. */
  const getJson = async (user: string, path: string, init?: RequestInit) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'x-test-user': user, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    expect(res.status, `${path} must answer 200`).toBe(200);
    const body = await res.json();
    expect(envelopeViolations(body), `${path} is not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    return body.data;
  };

  describe('GET /api/v1/notifications', () => {
    it('satisfies ListNotificationsResponseSchema (VALUE assertion)', async () => {
      const data = await getJson(LIST_USER, '/api/v1/notifications');

      const parsed = ListNotificationsResponseSchema.safeParse(data);
      expect(
        parsed.success ? [] : parsed.error!.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
        'the wire body must satisfy ListNotificationsResponseSchema',
      ).toEqual([]);
      // Anti-vacuity: an empty list parses too.
      expect(parsed.data?.notifications).toHaveLength(3);
      expect(parsed.data?.unreadCount).toBe(3);
    });

    it('emits NO key the protocol does not declare, at the top level and one level down (KEY assertion)', async () => {
      const data = await getJson(LIST_USER, '/api/v1/notifications');

      expect(
        Object.keys(data).filter((k) => !declaredListKeys().has(k)),
        'undeclared top-level keys on the wire body',
      ).toEqual([]);

      const rows: Array<Record<string, unknown>> = data.notifications;
      expect(
        [...new Set(rows.flatMap((n) => Object.keys(n).filter((k) => !declaredNotificationKeys().has(k))))],
        'undeclared keys inside notifications[] on the wire body',
      ).toEqual([]);
    });

    it('`createdAt` survives the driver round trip as a real ISO-8601 instant', async () => {
      const data = await getJson(LIST_USER, '/api/v1/notifications');

      for (const row of data.notifications as Array<{ id: string; createdAt: string }>) {
        expect(typeof row.createdAt, `createdAt on ${row.id}`).toBe('string');
        // The refinement the in-memory fixture cannot prove: a SQL-flavoured
        // `2026-01-01 00:00:00` is a string and would fail here.
        expect(new Date(row.createdAt).toISOString(), `createdAt on ${row.id} is not ISO-8601`).toBe(row.createdAt);
        expect(NotificationSchema.safeParse(row).success).toBe(true);
      }
    });

    it('the JSON view of an absent `actionUrl` is a conforming body too', async () => {
      const data = await getJson(LIST_USER, '/api/v1/notifications');
      const rows: Array<Record<string, unknown>> = data.notifications;

      const withUrl = rows.find((n) => n.title === 'Deal one')!;
      const withoutUrl = rows.find((n) => n.title === 'Task two')!;

      expect(withUrl.actionUrl).toBe('/records/1');
      // In-process the key is present carrying `undefined` (pinned by the
      // producer gate); `JSON.stringify` drops it here. Both views conform —
      // `actionUrl` is declared `optional`, not `nullable`.
      expect(Object.prototype.hasOwnProperty.call(withoutUrl, 'actionUrl')).toBe(false);
      expect(NotificationSchema.safeParse(withoutUrl).success).toBe(true);
    });
  });

  describe('POST /api/v1/notifications/read and /read/all', () => {
    it('both bodies satisfy their declared schemas and emit no undeclared key', async () => {
      const ids: string[] = (await getJson(MARK_USER, '/api/v1/notifications')).notifications.map((n: any) => n.id);

      const readOne = await getJson(MARK_USER, '/api/v1/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ ids: [ids[0]] }),
      });
      const parsedOne = MarkNotificationsReadResponseSchema.safeParse(readOne);
      expect(
        parsedOne.success ? [] : parsedOne.error!.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
        'POST /read wire body must satisfy MarkNotificationsReadResponseSchema',
      ).toEqual([]);
      expect(Object.keys(readOne).filter((k) => !declaredMarkReadKeys().has(k))).toEqual([]);
      expect(parsedOne.data?.readCount).toBe(1); // anti-vacuity: a no-op also parses

      const readAll = await getJson(MARK_USER, '/api/v1/notifications/read/all', { method: 'POST' });
      const parsedAll = MarkAllNotificationsReadResponseSchema.safeParse(readAll);
      expect(
        parsedAll.success ? [] : parsedAll.error!.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
        'POST /read/all wire body must satisfy MarkAllNotificationsReadResponseSchema',
      ).toEqual([]);
      expect(Object.keys(readAll).filter((k) => !declaredMarkAllReadKeys().has(k))).toEqual([]);
      expect(parsedAll.data?.readCount).toBe(2); // the two still unread
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Declared, not delivered — recorded, NOT endorsed
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The two assertions above are 3/3 green for this family. These two facts are
  // real inconsistencies that BOTH assertions are structurally blind to, and
  // that is the point worth writing down for #3877's Stage D ratchet:
  //
  //   * `unreadCount` is a `number` whether it counts the total or the window,
  //     so a VALUE assertion cannot see a wrong semantic;
  //   * `cursor` is `optional`, so "no producer ever emits it" is a legal
  //     parse and the KEY assertion (⊆, not =) cannot see it either.
  //
  // Pinned as the measured behaviour of `origin/main`, with the issues that own
  // the judgement call. Whichever way #6361 / #6363 are ruled, these two
  // assertions are the ones that must flip — which is why they are here rather
  // than left for the next reader to rediscover.
  describe('[#6361 / #6363] the gaps the double assertion cannot see', () => {
    it('[#6363] `unreadCount` counts the RETURNED WINDOW, not the total the schema describes', async () => {
      const all = await getJson(GAP_USER, '/api/v1/notifications');
      expect(all.unreadCount, 'fixture must leave more than one unread for this to mean anything')
        .toBeGreaterThan(1);

      const windowed = await getJson(GAP_USER, '/api/v1/notifications?limit=1');

      expect(windowed.notifications).toHaveLength(1);
      // Declared: 'Total number of unread notifications'. Delivered: the unread
      // count within the fetched window. See #6363.
      expect(windowed.unreadCount).toBe(1);
      expect(windowed.unreadCount).not.toBe(all.unreadCount);
      // …and it still parses, which is exactly the blind spot.
      expect(ListNotificationsResponseSchema.safeParse(windowed).success).toBe(true);
    });

    it('[#6361 / #6363] `cursor` is declared on both sides and honoured on neither', async () => {
      const page1 = await getJson(GAP_USER, '/api/v1/notifications?limit=2');
      const ids1 = page1.notifications.map((n: any) => n.id);

      // Response half (#6363): the declared `cursor` key is never emitted.
      expect(Object.prototype.hasOwnProperty.call(page1, 'cursor')).toBe(false);
      expect(declaredListKeys().has('cursor')).toBe(true);

      // Request half (#6361): sending the declared `cursor` returns the SAME
      // page. An SDK caller paginating by the published contract loops forever.
      const page2 = await getJson(GAP_USER, `/api/v1/notifications?limit=2&cursor=${encodeURIComponent(ids1[ids1.length - 1])}`);
      expect(page2.notifications.map((n: any) => n.id)).toEqual(ids1);

      // Both pages conform — the whole reason this needed measuring by hand.
      expect(ListNotificationsResponseSchema.safeParse(page1).success).toBe(true);
      expect(ListNotificationsResponseSchema.safeParse(page2).success).toBe(true);
    });
  });
});
