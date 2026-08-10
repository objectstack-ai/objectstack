// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { ObjectKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { MessagingServicePlugin, MessagingService } from '@objectstack/service-messaging';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { DriverPlugin } from './driver-plugin.js';
import type { IHttpServer } from '@objectstack/spec/contracts';

/**
 * End-to-end regression for framework #3362 (`#3354 not effective on hono`).
 *
 * The in-app notifications surface (ADR-0030) — `GET /api/v1/notifications`,
 * `POST /api/v1/notifications/read[/all]` — is mounted by the dispatcher plugin
 * (`createDispatcherPlugin`) on the shared `IHttpServer`. #3362 claimed those
 * mounts never reached the standalone `os dev` / `os serve` hono listener, so
 * mark-read 404'd and the unread badge never cleared. It does NOT reproduce on
 * a real hono boot: the dispatcher's `server.<verb>()` registrations DO land on
 * the hono app (proven by `dispatcher-plugin.ready.integration.test.ts` for
 * `/ready`), the `notification` service resolves (backed by the messaging
 * service), and mark-read persists.
 *
 * The pre-existing coverage only ever asserted route *registration* on a FAKE
 * server (`dispatcher-plugin.routes.test.ts`) — it could not catch a real
 * unmounting on hono, nor a break in service resolution or receipt persistence.
 * This test closes that gap: it boots the actual HTTP stack (ObjectQL +
 * messaging + hono + dispatcher), opens a real socket, delivers notifications,
 * and drives mark-read over `fetch` exactly like the Console bell, asserting the
 * `sys_notification_receipt` rows flip to `read` and the unread count drops.
 */

const TEST_USER = 'usr_notif_e2e';

/**
 * Minimal `auth` service so `resolveExecutionContext` can resolve an
 * authenticated principal from the request. `getSession` returns the test user
 * when the `x-test-user` header is present, else anonymous — enough to exercise
 * both the authed (200) and self-gated (401) paths without a full better-auth
 * stack. Mirrors the `{ api: { getSession } }` shape the resolver reads.
 */
function fakeAuthPlugin(): Plugin {
  return {
    name: 'com.objectstack.test.fake-auth',
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

describe('in-app notifications over a real hono server (integration, #3362)', () => {
  let kernel: ObjectKernel;
  let baseUrl: string;
  let messaging: MessagingService;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logLevel: 'silent' });
    // In-memory SQLite backs persistence; ObjectQL (registered after the
    // driver so it discovers it) provides `objectql` + `data` + `manifest`;
    // MessagingServicePlugin registers the `notification` service the dispatcher
    // resolves and owns the inbox tables. Inline delivery (reliableDelivery:false)
    // writes the inbox row synchronously so `emit()` is observable immediately.
    await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));
    await kernel.use(new ObjectQLPlugin());
    // No app plugin registers `sys_notification` here: MessagingServicePlugin
    // contributes the L2 event it writes, so this lean kernel needs nothing
    // extra (#4154). Until that move it was contributed by the OPTIONAL
    // AuditPlugin, and this suite had to register the object itself — which is
    // exactly the shape of the deployment bug: messaging's single ingress
    // depending on another plugin being installed.
    await kernel.use(new MessagingServicePlugin({ reliableDelivery: false }));
    await kernel.use(fakeAuthPlugin());
    // port 0 → OS-assigned free port; resolved via getPort() after listening.
    await kernel.use(new HonoServerPlugin({ port: 0 }));
    await kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false, requireAuth: false }));

    await kernel.bootstrap();

    const httpServer = kernel.getService<IHttpServer>('http.server');
    baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
    messaging = kernel.getService<MessagingService>('notification');
  }, 30_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([
        kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
  }, 30_000);

  const as = (user: string, path: string, init?: RequestInit) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'x-test-user': user, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });

  const authed = (path: string, init?: RequestInit) => as(TEST_USER, path, init);

  it('resolves the notification service in discovery (declared === enforced)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/discovery`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const disc = body.data ?? body;
    // The route is advertised AND the service is reported available — the exact
    // `declared === enforced` invariant #3362 said was violated.
    expect(disc.routes?.notifications).toBe('/api/v1/notifications');
    expect(disc.services?.notification?.status).toBe('available');
  });

  it('self-gates an unauthenticated request with 401 (route reachable, not a 404)', async () => {
    // The route IS mounted on hono — an anonymous caller reaches the handler and
    // is told to authenticate (401), rather than hitting the hono not-found (404)
    // that #3362 reported. That distinction is the whole bug.
    const res = await fetch(`${baseUrl}/api/v1/notifications`, { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('[#6928] refuses `?limit=abc` on the wire with 400 VALIDATION_FAILED, and still serves a valid window', async () => {
    // The defect, over a real socket. `Number('abc')` was `NaN`, `listInbox`'s
    // clamp (`Math.min(Math.max(NaN ?? 50, 1), 200)`) passed it through — `??`
    // does not catch NaN — and `data.find({ limit: NaN })` reached the driver,
    // whose behaviour is its own business. The caller was never told.
    //
    // This lives at the wire and not only under the handler because the ADR-0112
    // envelope is assembled by the dispatcher plugin's error exit, not by the
    // domain: the handler throws the house `VALIDATION_FAILED` shape and only
    // this path proves it lands as a 400 with the code in `error.code`. A
    // throw-only assertion could not tell that apart from the driver's own
    // rejection of NaN, which is exactly what used to happen on some drivers.
    const refused = await authed('/api/v1/notifications?limit=abc');
    expect(refused.status).toBe(400);
    // Typed rather than `any`: the envelope's three load-bearing fields are the
    // assertion, so naming them here keeps this case out of the package's
    // TEST_DEBT ledger instead of adding to it.
    const body = await refused.json() as {
      error: { code: string; httpStatus: number; details: { fields: unknown[] } };
    };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.httpStatus).toBe(400);
    expect(body.error.details.fields).toEqual([
      { field: 'limit', code: 'invalid_number', message: expect.stringContaining('`limit`') },
    ]);

    // The other half, and the one a refusal is cheap to break: a well-formed
    // window is answered exactly as before.
    const served = await authed('/api/v1/notifications?limit=5&read=false');
    expect(served.status).toBe(200);
    expect((await served.json() as { success: boolean }).success).toBe(true);
  });

  it('lists, marks specific read, then marks all read — flipping receipts and clearing the unread count', async () => {
    // Deliver two unread notifications to the user through the real pipeline.
    await messaging.emit({ topic: 'deal.won', audience: [TEST_USER], payload: { title: 'Deal one', body: 'first' } });
    await messaging.emit({ topic: 'deal.won', audience: [TEST_USER], payload: { title: 'Deal two', body: 'second' } });

    // GET /notifications → both show as unread.
    const listRes = await authed('/api/v1/notifications');
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.success).toBe(true);
    expect(list.data.unreadCount).toBe(2);
    expect(list.data.notifications).toHaveLength(2);
    const ids: string[] = list.data.notifications.map((n: any) => n.id);

    // POST /notifications/read — mark ONE specific notification read.
    const readOne = await authed('/api/v1/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ ids: [ids[0]] }),
    });
    expect(readOne.status).toBe(200);
    expect((await readOne.json()).data).toMatchObject({ success: true, readCount: 1 });

    const afterOne = await (await authed('/api/v1/notifications')).json();
    expect(afterOne.data.unreadCount).toBe(1);

    // POST /notifications/read/all — clear the remainder.
    const readAll = await authed('/api/v1/notifications/read/all', { method: 'POST' });
    expect(readAll.status).toBe(200);
    expect((await readAll.json()).data).toMatchObject({ success: true, readCount: 1 });

    // GET again → the badge is clear.
    const cleared = await (await authed('/api/v1/notifications')).json();
    expect(cleared.data.unreadCount).toBe(0);
    expect(cleared.data.notifications.every((n: any) => n.read === true)).toBe(true);

    // The receipts were actually persisted as `read` (not merely a view-layer
    // computation) — the server-side state the console poll re-reads.
    const data = kernel.getService<IDataEngine>('data');
    const receipts = await data.find('sys_notification_receipt', {
      where: { user_id: TEST_USER, channel: 'inbox' },
    });
    expect(receipts.length).toBe(2);
    expect(receipts.every((r: any) => r.state === 'read')).toBe(true);
  });

  it('[#6436] mark-all-read clears an inbox LARGER than the list window — no readCount/unreadCount contradiction', async () => {
    // The issue, over the wire, on the real stack. `markAllRead` swept one page
    // of the list (`limit: 200`, that list's hard cap), so a user with more
    // unread than the cap pressed "mark all read" and the badge did not clear:
    //
    //   POST /api/v1/notifications/read/all  →  { readCount: 200 }
    //   GET  /api/v1/notifications           →  { unreadCount: 150 }
    //
    // #6363 did not cause that — it removed the cover. While `unreadCount` was
    // window-scoped the shortfall was self-consistent and invisible; once the
    // badge became a true total the same request pair states it out loud, which
    // is why this pin lives at the wire and not only under the service.
    //
    // Rows are seeded through the data engine rather than 260 `emit()` calls:
    // this asserts the READ/SWEEP path over HTTP, and the delivery path is
    // already covered by the test above.
    const BULK_USER = 'usr_notif_bulk';
    const TOTAL = 260; // > the list's hard cap of 200
    const data = kernel.getService<IDataEngine>('data');
    for (let i = 0; i < TOTAL; i++) {
      await data.insert('sys_inbox_message', {
        user_id: BULK_USER,
        notification_id: `bulk_n${String(i).padStart(3, '0')}`,
        topic: 'deal.won',
        title: `Bulk ${i}`,
        body_md: 'body',
        severity: 'info',
        created_at: `2026-02-01T00:00:00.${String(i).padStart(3, '0')}Z`,
      });
    }

    const before = await (await as(BULK_USER, '/api/v1/notifications')).json();
    expect(before.data.unreadCount).toBe(TOTAL); // the true total (#6363)
    expect(before.data.notifications).toHaveLength(50); // the list is still one window

    const readAll = await (await as(BULK_USER, '/api/v1/notifications/read/all', { method: 'POST' })).json();
    expect(readAll.data).toMatchObject({ success: true, readCount: TOTAL }); // was 200

    const after = await (await as(BULK_USER, '/api/v1/notifications')).json();
    expect(after.data.unreadCount).toBe(0); // was 60
    expect(after.data.notifications.every((n: any) => n.read === true)).toBe(true);

    // Persisted, not computed: one `read` receipt per notification.
    const receipts = await data.find('sys_notification_receipt', {
      where: { user_id: BULK_USER, channel: 'inbox' },
    });
    expect(receipts.length).toBe(TOTAL);
    expect(receipts.every((r: any) => r.state === 'read')).toBe(true);
  }, 120_000);
});
