// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { brandingSettingsManifest } from './manifests/branding.manifest.js';
import { localizationSettingsManifest } from './manifests/localization.manifest.js';

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
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

function makeReqRes(opts: { params?: Record<string, string>; body?: any; headers?: Record<string, string> } = {}) {
  const req: IHttpRequest = {
    params: opts.params ?? {},
    query: {},
    body: opts.body,
    headers: opts.headers ?? {},
    method: 'GET',
    path: '/',
  };
  const state: { status: number; body?: any } = { status: 200 };
  const res: IHttpResponse = {
    json: vi.fn((data) => { state.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { state.status = code; return res; }) as any,
    header: vi.fn(() => res) as any,
  };
  return { req, res, state };
}

// [Finding-1] An authorized admin context (verified, holds the branding
// manifest's setup.access/setup.write capabilities). The production plugin
// derives this from the verified session/API-key; here we inject it directly.
const adminProvider = () => ({ enforced: true, permissions: ['setup.access', 'setup.write'] });

describe('settings-routes', () => {
  it('GET /api/settings → manifests', async () => {
    const http = new MockHttp();
    const svc = new SettingsService();
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('GET /api/settings')!;
    const { req, res, state } = makeReqRes();
    await h(req, res);
    expect(state.body.data.manifests.length).toBe(1);
  });

  it('GET /api/settings/:ns → payload', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('GET /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' } });
    await h(req, res);
    expect(state.body.data.manifest.namespace).toBe('branding');
    expect(state.body.data.values.workspace_name.source).toBe('default');
  });

  it('PUT returns 409 for env-locked', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: { OS_BRANDING_WORKSPACE_NAME: 'X' } });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' }, body: { workspace_name: 'Y' } });
    await h(req, res);
    expect(state.status).toBe(409);
    expect(state.body.error.code).toBe('SETTINGS_LOCKED');
  });

  it('PUT 404 for unknown namespace', async () => {
    const http = new MockHttp();
    const svc = new SettingsService();
    registerSettingsRoutes(http, svc);
    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'nope' }, body: { a: 1 } });
    await h(req, res);
    expect(state.status).toBe(404);
  });

  it('PUT accepts the {values:{...}} envelope (flat inner) symmetrically with GET', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' }, body: { values: { workspace_name: 'My Co' } } });
    await h(req, res);
    expect(state.body.error).toBeUndefined();
    expect(state.body.data.values.workspace_name.value).toBe('My Co');
    expect(state.body.data.values.workspace_name.source).toBe('tenant');
  });

  it('PUT accepts the read-shape envelope echoed back from GET', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    // Exactly what GET returns: { values: { key: { value, source, ... } } }
    const { req, res, state } = makeReqRes({
      params: { namespace: 'branding' },
      body: { values: { workspace_name: { value: 'Echoed', source: 'tenant', locked: false } } },
    });
    await h(req, res);
    expect(state.body.error).toBeUndefined();
    expect(state.body.data.values.workspace_name.value).toBe('Echoed');
  });

  it('POST action invokes service.runAction', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    svc.registerAction('branding', 'ping', () => ({ ok: true, message: 'pong' }));
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('POST /api/settings/:namespace/:actionId')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding', actionId: 'ping' }, body: null });
    await h(req, res);
    expect(state.status).toBe(200);
    expect(state.body.data.ok).toBe(true);
  });

  // ── [Finding-1] the DEFAULT (no verified provider) is SECURE ──────────────
  // Header-trusted identity is gone; an unauthenticated request can neither
  // enumerate protected namespaces nor write them.
  it('anonymous GET /api/settings hides manifests that require a read capability', async () => {
    const http = new MockHttp();
    const svc = new SettingsService();
    svc.registerManifest(brandingSettingsManifest); // requires setup.access
    registerSettingsRoutes(http, svc); // secure default → anonymous + enforced

    const h = http.routes.get('GET /api/settings')!;
    const { req, res, state } = makeReqRes();
    await h(req, res);
    expect(state.body.data.manifests.length).toBe(0);
  });

  it('anonymous GET /api/settings/:ns is DENIED (403), not served', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc);

    const h = http.routes.get('GET /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' } });
    await h(req, res);
    expect(state.status).toBe(403);
    expect(state.body.error.code).toBe('SETTINGS_FORBIDDEN');
  });

  it('anonymous PUT /api/settings/:ns is DENIED (403) — the unauthenticated write hole is closed', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc);

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' }, body: { workspace_name: 'pwn' } });
    await h(req, res);
    expect(state.status).toBe(403);
    expect(state.body.error.code).toBe('SETTINGS_FORBIDDEN');
  });

  it('a spoofed x-user-id / x-permissions header grants NOTHING (default ignores identity headers)', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc);

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'branding' },
      body: { workspace_name: 'pwn' },
      headers: { 'x-user-id': 'attacker', 'x-permissions': 'setup.write,setup.access' },
    });
    await h(req, res);
    expect(state.status).toBe(403);
  });

  it('a caller holding only read (setup.access) may read but NOT write', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: () => ({ enforced: true, permissions: ['setup.access'] }) });

    const read = http.routes.get('GET /api/settings/:namespace')!;
    const r1 = makeReqRes({ params: { namespace: 'branding' } });
    await read(r1.req, r1.res);
    expect(r1.state.body.data.manifest.namespace).toBe('branding');

    const write = http.routes.get('PUT /api/settings/:namespace')!;
    const r2 = makeReqRes({ params: { namespace: 'branding' }, body: { workspace_name: 'X' } });
    await write(r2.req, r2.res);
    expect(r2.state.status).toBe(403); // has setup.access, lacks setup.write
  });

  // ── #5712 — the declared valueDomain, as it lands on the HTTP surface ─────
  // The card's repros, asserted with the full envelope: status AND code, per
  // the rejection-test contract — a bare "it threw" carries one bit where the
  // defect has two.

  it('PUT /api/settings/localization accepts Europe/Zurich + CHF (the #5712 repro)', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(localizationSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'localization' },
      body: { timezone: 'Europe/Zurich', currency: 'CHF' },
    });
    await h(req, res);
    expect(state.status).toBe(200);
    expect(state.body.error).toBeUndefined();
    expect(state.body.data.values.timezone.value).toBe('Europe/Zurich');
    expect(state.body.data.values.currency.value).toBe('CHF');
  });

  it('PUT /api/settings/localization rejects garbage with 400 + SETTINGS_VALIDATION + invalid_value', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(localizationSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'localization' },
      body: { timezone: 'Mars/Olympus' },
    });
    await h(req, res);
    expect(state.status).toBe(400);
    expect(state.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(state.body.error.details.fields).toEqual([
      expect.objectContaining({
        field: 'timezone',
        code: 'invalid_value',
        constraint: { valueDomain: 'iana_time_zone' },
        value: 'Mars/Olympus',
      }),
    ]);
  });

  /**
   * #7169 — the STATUS half of the fail-closed refusal.
   *
   * `SettingsValidationError` carries `code` and the service suite pins that; a
   * rejection case's other required assertion is the HTTP `status`, and this
   * surface mints it here rather than on the error (ADR-0112 envelope, same
   * 400 + `SETTINGS_VALIDATION` mapping every other save-time refusal takes).
   * Restore `catch { continue }` in `validatePatch` and this case answers 200.
   */
  it('PUT rejects an unparseable `visible` predicate with 400 + SETTINGS_VALIDATION + invalid_value', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'celns',
      label: 'CEL namespace',
      specifiers: [
        { type: 'text', key: 'note', label: 'Note' },
        // CEL the spec's `ExpressionInputSchema` declares legal and this
        // service's evaluator cannot parse.
        { type: 'text', key: 'api_key', label: 'API key', required: true,
          visible: "${data.note in ['x']}" },
      ],
    } as any);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'celns' },
      body: { note: 'anything' },
    });
    await h(req, res);
    expect(state.status).toBe(400);
    expect(state.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(state.body.error.details.fields).toEqual([
      expect.objectContaining({
        field: 'api_key',
        code: 'invalid_value',
        constraint: { visible: "data.note in ['x']" },
      }),
    ]);
  });
});
