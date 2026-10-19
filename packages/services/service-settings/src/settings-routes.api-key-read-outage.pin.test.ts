// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24299] The settings family answers a `sys_api_key` read that REJECTS as
 * the store outage — `503 SERVICE_UNAVAILABLE`, the answer a session caller
 * already got for the same fault — on `GET /api/settings`, through the booted
 * plugin's own resolver.
 *
 * Measured on the unrepaired tree through this boot, `sys_api_key` reads
 * rejecting and every other table healthy:
 *
 *   caller                       | before               | after
 *   -----------------------------|----------------------|------------------------
 *   key only                     | 401 UNAUTHENTICATED  | 503 SERVICE_UNAVAILABLE
 *   key + another user's cookie  | 200 (the session     | 503, the session is
 *                                | read answered)       | never read
 *   session only                 | 200                  | unchanged
 *
 * Control: a never-provisioned `sys_api_key` is still "no key" — the anonymous
 * floor's 401 — the boundary the 2026-08-30 ruling (option A) draws.
 *
 * The boot is `settings-routes.api-key-lifecycle.pin.test.ts`'s.
 */

import { describe, expect, it } from 'vitest';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsServicePlugin } from './settings-service-plugin.js';

const KEY = 'osk_settings_read_outage_pin';
const OWNER = 'usr_key_owner';
const COOKIE_USER = 'usr_cookie';

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

type KeyRead = 'healthy' | 'rejects' | 'unprovisioned';

async function bootPlugin(keyRead: KeyRead) {
  const http = new MockHttp();
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  const keyHash = hashApiKey(KEY);
  const sessionReads = { count: 0 };
  const services: Record<string, unknown> = {
    'http-server': http,
    auth: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          sessionReads.count += 1;
          return headers.get('cookie') ? { user: { id: COOKIE_USER }, session: { userId: COOKIE_USER } } : null;
        },
      },
      resolveUserAuthGates: async () => [],
    },
    objectql: {
      find: async (object: string, q: any) => {
        if (object === 'sys_api_key' && keyRead === 'rejects') throw new Error('connection terminated unexpectedly');
        if (object === 'sys_api_key' && keyRead === 'unprovisioned') throw new Error('no such table: sys_api_key');
        return object === 'sys_api_key' && q?.where?.key === keyHash
          ? [{ id: 'key_1', key: keyHash, user_id: OWNER, revoked: false, scopes: '[]' }]
          : [];
      },
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
  const list = http.routes.find((r) => r.verb === 'GET' && !r.path.includes(':'));
  if (!list) throw new Error('fixture: the settings index route was not registered');
  return { list, sessionReads };
}

async function drive(route: Registered, headers: Record<string, string>) {
  const answer: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { answer.body = data; return res; },
    send() { return res; },
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  await route.handler(
    { params: {}, query: {}, body: undefined, headers, method: 'GET', path: route.path } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return answer;
}

describe('[#24299] settings family — a rejecting sys_api_key read is the store outage', () => {
  it('key only: 503 SERVICE_UNAVAILABLE, not the anonymous floor\'s 401', async () => {
    const { list } = await bootPlugin('rejects');
    const answer = await drive(list, { 'x-api-key': KEY });
    expect(answer.status).toBe(503);
    expect(answer.body?.success).toBe(false);
    expect(answer.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('key + another user\'s cookie: 503, and the session is never read in the key\'s place', async () => {
    const { list, sessionReads } = await bootPlugin('rejects');
    const answer = await drive(list, { 'x-api-key': KEY, cookie: 'session=other-user' });
    expect(answer.status).toBe(503);
    expect(answer.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(sessionReads.count, 'the session answered for a key whose read failed').toBe(0);
  });

  it('session only: unchanged — served', async () => {
    const { list } = await bootPlugin('rejects');
    const answer = await drive(list, { cookie: 'session=other-user' });
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
  });

  it('control: a healthy key read is served', async () => {
    const { list } = await bootPlugin('healthy');
    const answer = await drive(list, { 'x-api-key': KEY });
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
  });

  it('control: a never-provisioned sys_api_key is still "no key" — the anonymous floor\'s 401', async () => {
    const { list } = await bootPlugin('unprovisioned');
    const answer = await drive(list, { 'x-api-key': KEY });
    expect(answer.status).toBe(401);
    expect(answer.body?.error?.code).toBe('UNAUTHENTICATED');
  });
});
