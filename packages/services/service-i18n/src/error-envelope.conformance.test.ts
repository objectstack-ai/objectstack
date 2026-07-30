// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Error-envelope conformance for the autonomously-mounted `/api/v1/i18n/*`
 * routes (#3675) — the error-path twin of the success-path fix in #3636.
 *
 * #3636 aligned the SUCCESS bodies because those were the ones breaking
 * `ObjectStackClient.unwrapResponse`. The error bodies stayed a bare
 * `{ error: '<message>' }` while the dispatcher's `/i18n` domain — the OTHER
 * provider of these same three shapes — emitted
 * `{ success: false, error: { … } }` for the identical condition. Same SDK
 * method, two error shapes, decided by which plugin mounted the route.
 *
 * Both directions are guarded: every error branch is driven and parsed against
 * the real `BaseResponseSchema`, and the module source is scanned so a new
 * route cannot quietly reintroduce the bare shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkRouteEnvelope } from '@objectstack/route-envelope-conformance';
import { BaseResponseSchema } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { I18nServicePlugin } from './i18n-service-plugin';

const BASE = '/api/v1/i18n';

/**
 * Mount the plugin's routes through its REAL lifecycle and hand back the
 * handlers, so these assertions run against the routes the plugin actually
 * registers rather than a hand-copied table.
 */
async function mount(i18nOverrides: Record<string, unknown> = {}) {
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
  // Sabotage the registered service where a test needs the `catch` arm — the
  // routes close over whatever `init` registered.
  const svc = services.get('i18n') as Record<string, unknown> | undefined;
  if (svc) Object.assign(svc, i18nOverrides);
  await plugin.start!(ctx as never);
  await ctx.trigger('kernel:ready');
  return routes;
}

async function drive(
  routes: Map<string, RouteHandler>,
  path: string,
  req: Partial<IHttpRequest> = {},
): Promise<{ status: number; body: any }> {
  const handler = routes.get(`GET:${path}`);
  if (!handler) throw new Error(`no handler for GET ${path} (have: ${[...routes.keys()].join(', ')})`);
  const captured = { status: 200, body: undefined as any };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: {}, query: {}, body: undefined, headers: {}, method: 'GET', path, ...req } as IHttpRequest,
    res as IHttpResponse,
  );
  return captured;
}

describe('i18n error envelope (#3675)', () => {
  const CASES: Array<{
    name: string;
    status: number;
    code: string;
    run: () => Promise<{ status: number; body: any }>;
  }> = [
    {
      name: 'translations without a locale',
      status: 400,
      code: 'INVALID_REQUEST',
      run: async () => drive(await mount(), `${BASE}/translations/:locale`, { params: {} }),
    },
    {
      name: 'labels without an object or locale',
      status: 400,
      code: 'INVALID_REQUEST',
      run: async () => drive(await mount(), `${BASE}/labels/:object/:locale`, { params: {} }),
    },
    {
      name: 'a throwing i18n service on /locales',
      status: 500,
      code: 'INTERNAL',
      run: async () =>
        drive(
          await mount({ getLocales: () => { throw new Error('adapter exploded'); } }),
          `${BASE}/locales`,
        ),
    },
    {
      name: 'a throwing i18n service on /translations/:locale',
      status: 500,
      code: 'INTERNAL',
      run: async () =>
        drive(
          await mount({ getTranslations: () => { throw new Error('adapter exploded'); } }),
          `${BASE}/translations/:locale`,
          { params: { locale: 'en' } },
        ),
    },
    {
      name: 'a throwing i18n service on /labels/:object/:locale',
      status: 500,
      code: 'INTERNAL',
      run: async () =>
        drive(
          await mount({
            getFieldLabels: () => { throw new Error('adapter exploded'); },
            getTranslations: () => { throw new Error('adapter exploded'); },
          }),
          `${BASE}/labels/:object/:locale`,
          { params: { object: 'customer', locale: 'en' } },
        ),
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → ${c.status} ${c.code}, in the declared envelope`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);

      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe(c.code);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);

      // The pre-#3675 shape, explicitly dead.
      expect(typeof body.error).not.toBe('string');
    });
  }

  it('a 500 still carries a message when the thrown value has none', async () => {
    // `error.message` is REQUIRED by ApiErrorSchema, so passing a raw thrown
    // value straight through would emit an invalid body for anything that is
    // not an Error.
    const routes = await mount({ getLocales: () => { throw 'a bare string'; } });
    const { status, body } = await drive(routes, `${BASE}/locales`);
    expect(status).toBe(500);
    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(body.error.message).toBe('Internal error');
  });

  it('routes every error through `sendError` — no route may reintroduce the bare shape', () => {
    // Open-coded here until #3843 lifted the scan into
    // `@objectstack/route-envelope-conformance`. This module needs non-default
    // counts, and they are worth stating plainly rather than hiding:
    //
    //   - `errorBuilders: 1` — the error half IS consolidated behind
    //     `sendError`, which is what #3675 did to this module.
    //   - `successBuilders: 4` / `jsonCallSites: 5` — the success half is NOT.
    //     Each of the four read routes builds `{ success: true, data: … }`
    //     inline. The envelope those bodies emit is CORRECT (that is what
    //     `i18n-success-envelope.conformance.test.ts` in `packages/runtime`
    //     drives), so this is not the envelope drift #3843 is about — it is an
    //     unconsolidated builder, which makes the guard weaker: a fifth read
    //     route could get the shape wrong and only a driven test would notice.
    //
    // So these two numbers are a RATCHET, not a blessing. They pin the current
    // structure exactly — a new inline body moves the count and fails here —
    // and consolidating the four call sites behind a `sendOk` drives them to
    // the defaults (2 / 1) the other five route modules use.
    const source = readFileSync(new URL('./i18n-service-plugin.ts', import.meta.url), 'utf8');
    expect(
      checkRouteEnvelope({
        source,
        module: 'i18n-service-plugin.ts',
        jsonCallSites: 5,
        successBuilders: 4,
        errorBuilders: 1,
      }),
    ).toEqual([]);
  });
});
