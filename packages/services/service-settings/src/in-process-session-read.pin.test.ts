// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] The settings door's in-process `auth.api.getSession` read
 * (`verifiedContextFromRequest`'s `getSession`, behind every `/api/settings`
 * route) hands better-auth the in-process session-read rule's input
 * (`inProcessSessionReadInput`, `@objectstack/types`).
 *
 * A request carrying a session cookie reads with `query.disableRefresh`: these
 * routes answer with their own response, so a renewal here would move the
 * session's expiry while its renewed cookie is discarded — the browser's
 * cookie would then die before its session (a split session). A bearer-only
 * request reads exactly as before, renewal included. What that input DOES
 * against real better-auth is pinned end to end in
 * `packages/runtime/src/in-process-session-renewal.pin.test.ts` and
 * `packages/plugins/plugin-auth/src/in-process-session-renewal.pin.test.ts`.
 *
 * The plugin is booted for real (`init` → `start` → `kernel:ready`), and the
 * seam is captured through a PASS-THROUGH of the real route registration, as
 * `settings-admission-tenancy-posture.test.ts` captures it: the routes still
 * mount, and the closure called here is the one every route calls. No engine
 * is registered (the memory fallback), so the read under test is the only
 * thing the seam does with the caller.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { IHttpRequest, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import type { SettingsContext } from './settings-service.types.js';

const captured = vi.hoisted(() => ({ contextFromRequest: undefined as
  | ((req: IHttpRequest) => SettingsContext | Promise<SettingsContext>)
  | undefined }));

vi.mock('./settings-routes.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./settings-routes.js')>();
  return {
    ...real,
    registerSettingsRoutes: (http: any, service: any, opts: any = {}) => {
      captured.contextFromRequest = opts.contextFromRequest;
      return real.registerSettingsRoutes(http, service, opts);
    },
  };
});

const { SettingsServicePlugin } = await import('./settings-service-plugin.js');

const capturedSeam = () => captured.contextFromRequest;

const SESSION_COOKIE = 'better-auth.session_token=tok_22258.c2lnbmF0dXJl';
const BEARER = 'Bearer tok_22258.c2lnbmF0dXJl';

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) { this.routes.set(`${method} ${path}`, handler); }
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

async function resolveContext(headers: Record<string, string>) {
  const calls: any[] = [];
  const http = new MockHttp();
  // No `tenancy` registered: the branded "never registered" arm, a quiet
  // `undefined` posture — this file's subject is the session read alone.
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  const services: Record<string, unknown> = {
    'http-server': http,
    auth: {
      api: {
        getSession: async (input: any) => {
          calls.push(input);
          return { user: { id: 'usr_22258' }, session: { id: 'sess_22258' } };
        },
      },
    },
  };
  let readyHook: (() => Promise<void>) | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: () => {},
    // An absent slot answers `undefined` — `objectql` among them, so the
    // service settles on its memory fallback.
    getService: (name: string) => services[name],
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    getKernel: () => kernel,
  };

  captured.contextFromRequest = undefined;
  const plugin = new SettingsServicePlugin({ manifests: [], env: {}, actionHandlers: {} });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();
  expect(http.routes.size, 'the real routes mounted').toBeGreaterThan(0);
  // Read through a getter: the reset above narrows the slot to `undefined`
  // for the type checker, which cannot see the plugin's boot write it back.
  const contextFromRequest = capturedSeam();
  if (!contextFromRequest) throw new Error('fixture: the settings routes were not registered');

  const context = await contextFromRequest({ headers, method: 'GET', path: '/api/settings' } as unknown as IHttpRequest);
  return { calls, context };
}

describe('[#22258] the settings door reads the session by the in-process rule', () => {
  it('a request carrying a session cookie reads without renewal', async () => {
    const { calls, context } = await resolveContext({ cookie: SESSION_COOKIE });
    // The read resolved the caller — the seam really ran past it.
    expect(context.userId).toBe('usr_22258');
    expect(calls).toHaveLength(1);
    expect(calls[0].query, 'a cookie request renewed in-process').toEqual({ disableRefresh: true });
    expect(calls[0].headers.get('cookie')).toBe(SESSION_COOKIE);
  });

  it('the console sends cookie AND bearer — still no renewal in-process', async () => {
    const { calls } = await resolveContext({ cookie: SESSION_COOKIE, authorization: BEARER });
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toEqual({ disableRefresh: true });
  });

  it('a bearer-only request reads exactly as before — renewal stays on, no query at all', async () => {
    const { calls, context } = await resolveContext({ authorization: BEARER });
    expect(context.userId).toBe('usr_22258');
    expect(calls).toHaveLength(1);
    expect('query' in calls[0], 'a bearer-only read lost its renewal').toBe(false);
    expect(calls[0].headers.get('authorization')).toBe(BEARER);
  });
});
