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
  ListNotificationsRequestSchema,
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
  // The gaps the double assertion cannot see — one now closed, one still open
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The two assertions above are 3/3 green for this family. These two facts
  // were real inconsistencies that BOTH assertions are structurally blind to,
  // and that is the point worth writing down for #3877's Stage D ratchet:
  //
  //   * `unreadCount` is a `number` whether it counts the total or the window,
  //     so a VALUE assertion cannot see a wrong semantic;
  //   * `cursor` is `optional`, so "no producer ever emits it" is a legal
  //     parse and the KEY assertion (⊆, not =) cannot see it either.
  //
  // Both were pinned here as the measured behaviour of `origin/main`, on the
  // note that whichever way #6361 / #6363 were ruled, these assertions are the
  // ones that must flip. BOTH have now been ruled (2026-08-07, Option A, and
  // ruled JOINTLY — one capability's two halves are never half-deleted), and
  // both assertions have flipped:
  //
  //   * #6363 made the declaration true — `unreadCount` really is the total;
  //   * #6361 removed the declaration instead — `cursor` is gone from the
  //     request half, the response half and the SDK producer, because there was
  //     no implementation to make it true ABOUT. Opposite repairs, same rule:
  //     declared must equal enforced.
  //
  // The two directions are why the pair is worth keeping side by side. Note the
  // #6361 assertion below now pins something subtler than the #6363 one: the
  // WIRE did not change (an unknown `?cursor=` was ignored before and is
  // ignored now), so what it proves is that the CONTRACT stopped promising the
  // thing the wire never delivered. A test that only checked "page2 === page1"
  // would be just as green before and after, which is exactly the vacuity this
  // family keeps paying for.
  //
  // The Stage D input stands either way, and is if anything sharper now: the
  // ratchet still cannot see EITHER fact. Both had to be written by hand, and
  // the fixes below would have been just as invisible to it as the defects were
  // — a removed optional key changes no parse verdict at all.
  describe('[#6361 / #6363] the gaps the double assertion cannot see', () => {
    it('[#6363] `unreadCount` is the TOTAL the schema describes, and survives a smaller window', async () => {
      const all = await getJson(GAP_USER, '/api/v1/notifications');
      expect(all.unreadCount, 'fixture must leave more than one unread for this to mean anything')
        .toBeGreaterThan(1);

      const windowed = await getJson(GAP_USER, '/api/v1/notifications?limit=1');

      // The LIST is still windowed — that half never changed.
      expect(windowed.notifications).toHaveLength(1);
      // The BADGE is not: declared 'Total number of unread notifications', and
      // now delivered as one. Before #6363 this read `1` — the window's size,
      // which is what a user with more unread than the page size was told
      // forever. The parse was green either way; only this assertion can tell.
      expect(windowed.unreadCount).toBe(all.unreadCount);
      // Stated as the property rather than only as an equality, so the pin
      // cannot go quietly vacuous if a future fixture change flattens both
      // sides: the count MUST be able to exceed the window it came back in.
      expect(windowed.unreadCount).toBeGreaterThan(windowed.notifications.length);
      expect(ListNotificationsResponseSchema.safeParse(windowed).success).toBe(true);
    });

    it('[#6361] `cursor` is declared on NEITHER side now, and the wire is unchanged', async () => {
      const page1 = await getJson(GAP_USER, '/api/v1/notifications?limit=2');
      const ids1 = page1.notifications.map((n: any) => n.id);

      // Both halves are TOMBSTONED — retired, not silently dropped. Asserted as
      // a refusal on each schema, because a bare deletion on a non-strict object
      // would have re-created this very issue's defect (silent strip, ADR-0104).
      expect(Object.prototype.hasOwnProperty.call(page1, 'cursor')).toBe(false);
      for (const schema of [ListNotificationsRequestSchema, ListNotificationsResponseSchema]) {
        const refused = schema.safeParse({ notifications: [], unreadCount: 0, cursor: 'n_42' });
        expect(refused.success).toBe(false);
        expect(refused.error!.issues.some((i) => i.path.join('.') === 'cursor')).toBe(true);
      }

      // ⚠️ WIRE BEHAVIOUR DELIBERATELY UNCHANGED, measured over a real socket:
      // a request still carrying `?cursor=` is IGNORED, not refused. Nothing
      // validates this query against a schema, so the unknown key is simply not
      // read — it returned the same window before the removal and it returns the
      // same window after. Removing a declaration must not silently start
      // rejecting traffic, and this is the assertion that would catch it.
      const stillSent = await getJson(
        GAP_USER,
        `/api/v1/notifications?limit=2&cursor=${encodeURIComponent(ids1[ids1.length - 1])}`,
      );
      expect(stillSent.notifications.map((n: any) => n.id)).toEqual(ids1);
      expect(ListNotificationsResponseSchema.safeParse(page1).success).toBe(true);
      expect(ListNotificationsResponseSchema.safeParse(stillSent).success).toBe(true);
    });

    it('[#6361] the removed `limit` default was never in effect — the server window still answers', async () => {
      // The other half of the ruling, over the wire. The declaration used to say
      // `default(20)`; the server has always answered its own window. With the
      // fiction removed, the two agree by SAYING LESS rather than by changing
      // behaviour — so the fixture's whole inbox must still come back on a
      // request that names no limit.
      const all = await getJson(GAP_USER, '/api/v1/notifications');
      expect(all.notifications.length).toBeGreaterThan(1);
      // Never truncated at the retired declared default.
      expect(all.notifications.length).toBeLessThanOrEqual(50);
      expect(ListNotificationsRequestSchema.parse({})).not.toHaveProperty('limit');
    });
  });
});
