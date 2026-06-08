// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service';
import { registerSettingsRoutes } from './settings-routes';
import { brandingSettingsManifest } from './manifests/branding.manifest';

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

describe('settings-routes', () => {
  it('GET /api/settings → manifests', async () => {
    const http = new MockHttp();
    const svc = new SettingsService();
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc);

    const h = http.routes.get('GET /api/settings')!;
    const { req, res, state } = makeReqRes();
    await h(req, res);
    expect(state.body.manifests.length).toBe(1);
  });

  it('GET /api/settings/:ns → payload', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc);

    const h = http.routes.get('GET /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' } });
    await h(req, res);
    expect(state.body.manifest.namespace).toBe('branding');
    expect(state.body.values.workspace_name.source).toBe('default');
  });

  it('PUT returns 409 for env-locked', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: { OS_BRANDING_WORKSPACE_NAME: 'X' } });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc);

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

  it('POST action invokes service.runAction', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    svc.registerAction('branding', 'ping', () => ({ ok: true, message: 'pong' }));
    registerSettingsRoutes(http, svc);

    const h = http.routes.get('POST /api/settings/:namespace/:actionId')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding', actionId: 'ping' }, body: null });
    await h(req, res);
    expect(state.status).toBe(200);
    expect(state.body.ok).toBe(true);
  });
});
