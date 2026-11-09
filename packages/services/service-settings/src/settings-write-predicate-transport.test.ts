// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30203] What of a save's request reaches a write predicate.
 *
 * The settings routes hand the service the request a save arrived on
 * (`SettingsWriteOptions.transport`). A predicate sees the transport's peer
 * address and only the headers it named at registration
 * (`SettingsWritePredicateOptions.requestHeaders`), so a credential header
 * (`cookie`, `authorization`, an API key) never reaches a predicate that did
 * not ask for it. An in-process write carries no request at all.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { brandingSettingsManifest } from './manifests/branding.manifest.js';
import type { SettingsWritePredicateInput } from './settings-service.types.js';

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

const REQUEST_HEADERS = {
  cookie: 'better-auth.session_token=secret',
  authorization: 'Bearer secret',
  'x-api-key': 'osk_secret',
  'x-forwarded-for': '198.51.100.7',
  'x-real-ip': '198.51.100.8',
};

function rig(options?: { requestHeaders?: readonly string[] }) {
  const service = new SettingsService({ env: {} });
  service.registerManifest(brandingSettingsManifest);
  const seen: SettingsWritePredicateInput[] = [];
  service.registerWritePredicate(
    'branding',
    'workspace_name',
    (input) => {
      seen.push(input);
      return undefined;
    },
    options,
  );
  const http = new MockHttp();
  registerSettingsRoutes(http, service, {
    contextFromRequest: () => ({ enforced: true, permissions: ['setup.access', 'setup.write'], userId: 'usr_admin' }),
  });
  const save = async (value: string) => {
    let status = 200;
    const res: IHttpResponse = {
      json: vi.fn() as any,
      send: vi.fn() as any,
      status: vi.fn((code: number) => { status = code; return res; }) as any,
      header: vi.fn(() => res) as any,
    };
    const req: IHttpRequest = {
      params: { namespace: 'branding' },
      query: {},
      body: { workspace_name: value },
      headers: { ...REQUEST_HEADERS },
      method: 'PUT',
      path: '/api/settings/branding',
      remoteAddress: '10.0.0.1',
    };
    await http.routes.get('PUT /api/settings/:namespace')!(req, res);
    return status;
  };
  return { service, seen, save };
}

describe('#30203 a write predicate sees only the request headers it named', () => {
  it('a predicate that named the forwarded-address headers gets those and the peer address, no credential', async () => {
    const { seen, save } = rig({ requestHeaders: ['X-Forwarded-For', 'x-real-ip'] });
    expect(await save('Acme')).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.transport).toEqual({
      headers: { 'x-forwarded-for': '198.51.100.7', 'x-real-ip': '198.51.100.8' },
      remoteAddress: '10.0.0.1',
    });
  });

  it('a predicate that named no header gets the peer address and no header', async () => {
    const { seen, save } = rig();
    expect(await save('Acme')).toBe(200);
    expect(seen[0]!.transport).toEqual({ headers: {}, remoteAddress: '10.0.0.1' });
  });

  it('an in-process write carries no request', async () => {
    const { service, seen } = rig({ requestHeaders: ['x-forwarded-for'] });
    await service.set('branding', 'workspace_name', 'Acme', {});
    expect(seen).toHaveLength(1);
    expect(seen[0]!).not.toHaveProperty('transport');
  });
});
