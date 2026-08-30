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
import { captureExpectedReadRefusals } from './expected-read-refusal-noise.js';

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

// ═══════════════════════════════════════════════════════════════════════════
// [#10380 → #10629 → #13325] The authz resolver's expected read failures:
//          WITHHELD from the shared log, and ASSERTED instead
// ═══════════════════════════════════════════════════════════════════════════
//
// This fixture provisions the messaging objects and nothing else, so every
// request's `resolveUserAuthzGrants` (`core/src/security/resolve-authz-context.ts`)
// reads six `sys_*` tables that were never created. `tryFind` swallows each
// one by design — the resolver is fail-closed and must always resolve — but on
// the way out the driver and the engine each log it.
//
// ⚠️ [#13273] WHICH ENGINE CHANNEL — and why this file stopped rolling its own
// capture. `ObjectQL.reportFindFailure` now picks the level from the CAUSE: a
// read whose table was never provisioned — i.e. every read this block is
// declared over — is logged at `debug`, carrying a
// `reason: 'table-not-provisioned'` meta and no stack; every other read failure
// keeps `error` with the stack. This file used to carry its own copy of the
// capture and wrapped the engine's `error` channel ONLY, so from that change
// onward its recognition arm could not match a single frame — measured on this
// tree before the migration, the engine's `error` channel was invoked 0 times
// while 63 `Find operation failed` frames arrived on `debug`, every one of
// which satisfied that arm's own predicate. Dead suppression that read as live
// protection, and the file stayed green throughout because everything it
// asserted was fed by the DRIVER channel. It now uses the shared
// `captureExpectedReadRefusals` (#10629), which wraps BOTH channels, so which
// channel a frame arrives on is the ENGINE's classification and never this
// fixture's problem.
//
// Counts RE-MEASURED on this tree (#13325), not transcribed:
//
//   pnpm --filter @objectstack/runtime exec vitest run \
//     src/notification-schema-conformance.integration.test.ts
//
// → 63 `[sql-driver] DATABASE_ERROR — the backend refused a read on '…'`
//   refusals withheld on the DRIVER channel, and 63 matching engine
//   `Find operation failed` frames withheld on the `debug` channel, out of a
//   suite whose eight tests all PASS. ⛔ Those two totals are PROSE, not a pin
//   — they move with the routes this file drives, and re-deriving them means
//   reading `noise.totalRefusals()` / `noise.totalEngineFrames()` off a run,
//   never copying the numbers forward. What IS asserted is
//   `silentChannels()`: every always-read table fired on BOTH channels.
//
// Turbo interleaves package logs without attribution, so in the `Test Core`
// shard log those are indistinguishable from a real failure — they were lifted
// verbatim into a p1 flake signature (#10293) and cost a full dispatch cycle
// aimed at the wrong mechanism.
//
// ⛔ Not a mute. A capture that only silences would make this file blind: if
// those reads ever started SUCCEEDING (someone provisions the tables) or
// stopped happening (the resolver drops a read), the log would go quiet and
// nothing would notice. So the shared capture withholds ONLY the expected
// fault — each line must name one of the six tables AND carry that same
// table's `no such table` reason — and COUNTS what it withheld, per table and
// per channel, which `afterAll` asserts.

/**
 * The six tables the resolver reads and this fixture does not provision.
 * Derived by measurement, not from the resolver's source, so a read this
 * fixture stops provoking shows up as a changed set rather than silently.
 */
const ABSENT_AUTHZ_TABLES = [
  'sys_user',
  'sys_member',
  'sys_user_position',
  'sys_user_permission_set',
  'sys_position',
  'sys_setting',
] as const;

/**
 * The five of them read on EVERY grant resolution, i.e. on every request this
 * file makes. `sys_setting` is deliberately NOT here: it is read on only some
 * routes (3 of the 12 resolutions), so requiring it would turn a single-test
 * `-t` run red without meaning anything.
 */
const ALWAYS_READ_AUTHZ_TABLES = ABSENT_AUTHZ_TABLES.filter((t) => t !== 'sys_setting');

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
  /**
   * [#10629] The expected-noise capture, asserted in `afterAll`. The SHARED
   * one — see the block above for what the per-fixture copy this replaced
   * could no longer do.
   */
  const noise = captureExpectedReadRefusals([...ABSENT_AUTHZ_TABLES]);

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    // [#10380] The driver is named rather than inlined so its logger can be
    // scoped before it ever runs a statement.
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    noise.captureDriver(driver);
    await kernel.use(new DriverPlugin(driver));
    await kernel.use(new ObjectQLPlugin());
    // Inline delivery so `emit()` materializes the inbox row synchronously.
    await kernel.use(new MessagingServicePlugin({ reliableDelivery: false }));
    await kernel.use(fakeAuthPlugin());
    await kernel.use(new HonoServerPlugin({ port: 0 }));
    await kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false, requireAuth: false }));
    await kernel.bootstrap();

    // [#10380] The engine only exists once the kernel has bootstrapped; the
    // reads this scopes all happen later, per request.
    noise.captureEngine(kernel.getService<unknown>('objectql'));

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

    // [#10380] The capture is a PIN, not a mute — asserted after shutdown so
    // a failure here can never leave the kernel running. Every one of these
    // reads happens on EVERY grant resolution, so this holds for a single
    // filtered test as well as for the whole file. If one goes silent, the
    // right repair is to re-derive the list above, NOT to relax this: a
    // resolver read that stopped happening is a finding, and a table that
    // started resolving means this fixture now provisions it.
    //
    // ⚠️ [#13325] STRICTLY MORE than the per-table `withheld.has(table)` loop
    // this replaced, never less: that loop read the DRIVER channel only, which
    // is exactly why it kept passing while the engine half of the same capture
    // was dead. `silentChannels()` requires BOTH channels to have fired for
    // each table, and a silent one NAMES ITSELF in the diff.
    expect(noise.silentChannels(ALWAYS_READ_AUTHZ_TABLES)).toEqual([]);
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
