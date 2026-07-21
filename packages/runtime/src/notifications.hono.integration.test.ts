// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { MessagingServicePlugin, MessagingService } from '@objectstack/service-messaging';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { DriverPlugin } from './driver-plugin.js';

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
    // An in-memory driver backs persistence; ObjectQL (registered after the
    // driver so it discovers it) provides `objectql` + `data` + `manifest`;
    // MessagingServicePlugin registers the `notification` service the dispatcher
    // resolves and owns the inbox tables. Inline delivery (reliableDelivery:false)
    // writes the inbox row synchronously so `emit()` is observable immediately.
    await kernel.use(new DriverPlugin(new InMemoryDriver()));
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new MessagingServicePlugin({ reliableDelivery: false }));
    await kernel.use(fakeAuthPlugin());
    // port 0 → OS-assigned free port; resolved via getPort() after listening.
    await kernel.use(new HonoServerPlugin({ port: 0, registerStandardEndpoints: true }));
    await kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false, requireAuth: false }));

    await kernel.bootstrap();

    const httpServer = kernel.getService<any>('http.server');
    baseUrl = `http://127.0.0.1:${httpServer.getPort()}`;
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

  const authed = (path: string, init?: RequestInit) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'x-test-user': TEST_USER, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });

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
    const data = kernel.getService<any>('data');
    const receipts = await data.find('sys_notification_receipt', {
      where: { user_id: TEST_USER, channel: 'inbox' },
    });
    expect(receipts.length).toBe(2);
    expect(receipts.every((r: any) => r.state === 'read')).toBe(true);
  });
});
