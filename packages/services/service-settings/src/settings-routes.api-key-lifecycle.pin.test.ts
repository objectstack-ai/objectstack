// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23367, ruling A item 3] The settings family answers a key its own
 * lifecycle refuses with that refusal's 403 and ledger code.
 *
 * ## What is pinned, through the booted plugin's own resolver
 *
 *  - a revoked key → every mounted route answers `403 API_KEY_REVOKED`;
 *  - an expired key → `403 API_KEY_EXPIRED`, and an idle one
 *    `403 API_KEY_INACTIVE`, each in the family's declared envelope;
 *  - an unknown key is no lifecycle refusal: the anonymous floor answers it the
 *    generic `401 UNAUTHENTICATED`;
 *  - control: the same key, live, is served.
 *
 * The path: `SettingsServicePlugin`'s resolver re-raises the branded
 * `ApiKeyLifecycleRefusalError` beside the store outage, and the family's door
 * (`registerSettingsRoutes`) relays it beside `relayAuthzStoreOutage`. The boot
 * is `settings-routes.api-key-account-posture.pin.test.ts`'s.
 */

import { describe, expect, it } from 'vitest';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsServicePlugin } from './settings-service-plugin.js';

const KEY = 'osk_settings_lifecycle_pin';
const OWNER = 'usr_key_owner';

interface Registered { verb: string; path: string; handler: RouteHandler }

class MockHttp implements IHttpServer {
  routes: Registered[] = [];
  private add(verb: string, path: string, handler: RouteHandler) { this.routes.push({ verb, path, handler }); }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

async function bootPlugin(row: Record<string, unknown>) {
  const http = new MockHttp();
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  const keyHash = hashApiKey(KEY);
  const services: Record<string, unknown> = {
    'http-server': http,
    auth: {
      api: { getSession: async () => undefined },
      resolveUserAuthGates: async () => [],
      resolveApiKeyLifecyclePolicy: () => ({ defaultExpiryDays: 90, maxExpiryDays: 365, inactivityDays: 90 }),
    },
    objectql: {
      find: async (object: string, q: any) => (
        object === 'sys_api_key' && q?.where?.key === keyHash
          ? [{ id: 'key_1', key: keyHash, prefix: 'osk_settings', user_id: OWNER, revoked: false, scopes: '[]', ...row }]
          : []
      ),
    },
  };
  let readyHook: (() => Promise<void>) | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: () => {},
    getService: (name: string) => services[name],
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    getKernel: () => kernel,
  };
  const plugin = new SettingsServicePlugin({ manifests: [], env: {}, actionHandlers: {} });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();
  if (http.routes.length === 0) throw new Error('fixture: the settings routes were not registered');
  return { http };
}

async function drive(route: Registered, key: string) {
  const answer: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { answer.body = data; return res; },
    send() { return res; },
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  const params: Record<string, string> = {};
  for (const seg of route.path.split('/')) if (seg.startsWith(':')) params[seg.slice(1)] = 'branding';
  await route.handler(
    { params, query: {}, body: route.verb === 'GET' ? undefined : { workspace_name: 'x' }, headers: { 'x-api-key': key }, method: route.verb, path: route.path } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return answer;
}

const DAY = 86_400_000;
const LONG_AGO = '2000-01-01T00:00:00.000Z';
const FAR = '2999-01-01T00:00:00.000Z';

describe('[#23367] settings family — a key its lifecycle refuses answers its own 403 and code', () => {
  it('a revoked key is refused 403 API_KEY_REVOKED on every mounted route', async () => {
    const { http } = await bootPlugin({ revoked: true });
    for (const route of http.routes) {
      const answer = await drive(route, KEY);
      expect(answer.status, `${route.verb} ${route.path}`).toBe(403);
      expect(answer.body?.success).toBe(false);
      expect(answer.body?.error?.code).toBe('API_KEY_REVOKED');
    }
  });

  it('an expired key is refused 403 API_KEY_EXPIRED', async () => {
    const { http } = await bootPlugin({ expires_at: LONG_AGO });
    const answer = await drive(http.routes[0], KEY);
    expect(answer.status).toBe(403);
    expect(answer.body?.error?.code).toBe('API_KEY_EXPIRED');
  });

  it('an idle key is refused 403 API_KEY_INACTIVE', async () => {
    const idleSince = new Date(Date.now() - 200 * DAY).toISOString();
    const { http } = await bootPlugin({ created_at: idleSince, last_used_at: idleSince, expires_at: FAR });
    const answer = await drive(http.routes[0], KEY);
    expect(answer.status).toBe(403);
    expect(answer.body?.error?.code).toBe('API_KEY_INACTIVE');
  });

  it('an unknown key is no lifecycle refusal: the anonymous floor answers the generic 401', async () => {
    const { http } = await bootPlugin({});
    for (const route of http.routes) {
      const answer = await drive(route, 'osk_never_issued');
      expect(answer.status, `${route.verb} ${route.path}`).toBe(401);
      expect(answer.body?.error?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('control: the same key, live, is served', async () => {
    const { http } = await bootPlugin({ expires_at: FAR });
    const list = http.routes.find((r) => r.verb === 'GET' && !r.path.includes(':'));
    expect(list, 'the family index route').toBeDefined();
    const answer = await drive(list!, KEY);
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
  });
});
