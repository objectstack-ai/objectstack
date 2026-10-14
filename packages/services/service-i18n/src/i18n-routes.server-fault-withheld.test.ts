// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23174] An i18n route's catch-all 5xx answers its declared `code` and
 * `status` with the route's own generic text, never the caught error's.
 *
 * The three routes' `catch` arms ended in `sendError(res, 500, 'INTERNAL',
 * error?.message ?? 'Internal error')`, so whatever a failing adapter said
 * reached the caller. They now answer through `sendServerFault`
 * (`@objectstack/types`): `Internal error` goes on the wire, and the caught
 * error, stack included, goes to the server-fault log as one line.
 *
 * ⛔ No `toThrow()` here: the unrepaired routes never threw, they ANSWERED with
 * the fault's text. The claim is `status` + `code` + what the body carries.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SERVER_FAULT_LOG_PREFIX } from '@objectstack/types';
import { I18nServicePlugin } from './i18n-service-plugin.js';

const BASE = '/api/v1/i18n';

/** Shaped like an adapter error: a server path to a locale bundle. */
const FAULT = 'EACCES: permission denied, open /srv/objectstack/i18n/tenant-a/zh-CN.json';

/** Mount the plugin's routes through its real lifecycle, over an adapter whose reads throw `FAULT`. */
async function mountFailing() {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const hooks = new Map<string, Array<(...a: unknown[]) => Promise<void>>>();
  const services = new Map<string, unknown>();
  const ctx = {
    registerService: vi.fn((name: string, svc: unknown) => { services.set(name, svc); }),
    replaceService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'http-server') return server;
      if (services.has(name)) return services.get(name);
      throw new Error(`Service '${name}' not found`);
    }),
    getServices: vi.fn(() => new Map()),
    getKernel: vi.fn(),
    hook: vi.fn((name: string, h: (...a: unknown[]) => Promise<void>) => {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name)!.push(h);
    }),
    trigger: vi.fn(async (name: string, ...a: unknown[]) => {
      for (const h of hooks.get(name) ?? []) await h(...a);
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };

  const plugin = new I18nServicePlugin();
  await plugin.init!(ctx as never);
  const raise = () => { throw new Error(FAULT); };
  Object.assign(services.get('i18n') as object, { getLocales: raise, getTranslations: raise, getFieldLabels: raise });
  await plugin.start!(ctx as never);
  await ctx.trigger('kernel:ready');
  return routes;
}

const ROUTES = [
  { path: `${BASE}/locales`, params: {} },
  { path: `${BASE}/translations/:locale`, params: { locale: 'zh-CN' } },
  { path: `${BASE}/labels/:object/:locale`, params: { object: 'customer', locale: 'zh-CN' } },
] as const;

async function drive(routes: Map<string, RouteHandler>, route: (typeof ROUTES)[number]) {
  const handler = routes.get(`GET:${route.path}`);
  if (!handler) throw new Error(`fixture: no handler for GET ${route.path}`);
  const captured = { status: 200, body: undefined as any };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: route.params, query: {}, body: undefined, headers: {}, method: 'GET', path: route.path } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return captured;
}

/** The fault log is `console.error` here: `sendServerFault` takes no logger, as `sendError` takes none. */
const quietConsole = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const faultLines = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => String(c[0]).startsWith(SERVER_FAULT_LOG_PREFIX));

afterEach(() => { vi.restoreAllMocks(); });

describe('[#23174] i18n — a catch-all 5xx withholds the caught text', () => {
  it.each(ROUTES)('GET $path answers 500 INTERNAL with the generic text, and none of the fault', async (route) => {
    quietConsole();
    const res = await drive(await mountFailing(), route);

    expect(res.status).toBe(500);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error?.code).toBe('INTERNAL');
    expect(res.body?.error?.message).toBe('Internal error');
    expect(JSON.stringify(res.body)).not.toContain('/srv/objectstack');
    expect(JSON.stringify(res.body)).not.toContain('EACCES');
    expect(BaseResponseSchema.safeParse(res.body).success).toBe(true);
    expect(envelopeViolations(res.body)).toEqual([]);
  });

  it.each(ROUTES)('GET $path logs the caught text ONCE, with its stack', async (route) => {
    const spy = quietConsole();
    await drive(await mountFailing(), route);

    const lines = faultLines(spy);
    expect(lines).toHaveLength(1);
    expect(String(lines[0][0])).toContain(FAULT);
    expect(String((lines[0][1] as Record<string, unknown>).stack)).toContain(FAULT);
  });
});
