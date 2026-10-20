// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Branding namespace is offered only where no organization wall stands
 * (#24766, the maintainer's ruling B′ and its amendment).
 *
 * Its values feed the anonymous runtime-config door, which resolves no
 * organization before sign-in. Under a walled posture (`group` / `isolated`)
 * the ruling keeps the page away entirely: the settings service does not offer
 * the namespace, so it is absent from the listing and a read or write of it is
 * refused by the unknown-namespace path every undeclared namespace takes.
 * Under `single` nothing changes: the page is offered and saves.
 *
 * Driven through the REAL `SettingsServicePlugin` production sequence
 * (`init` → `start` → the `kernel:ready` hook) with its `tenancy` service on a
 * REAL `ObjectKernel`, so the posture reaches the plugin the way it does in a
 * deployment. The REST family is the real `registerSettingsRoutes` over the
 * service the plugin built; only the caller's identity is injected (an admin
 * holding the namespace's own `setup.access` / `setup.write`), because who may
 * reach the door is not this file's subject — whether the namespace is there is.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsServicePlugin } from './settings-service-plugin.js';
import type { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';

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

/** How the boot reaches a posture: a `tenancy` service, none at all, or one that cannot answer. */
type Tenancy =
  | { kind: 'service'; posture: 'single' | 'group' | 'isolated' }
  | { kind: 'unregistered' }
  | { kind: 'no-async-registry' }
  | { kind: 'factory-throws' };

const admin = () => ({ enforced: true, permissions: ['setup.access', 'setup.write'], userId: 'usr_admin' });

async function boot(tenancy: Tenancy) {
  // `gracefulShutdown: false` — a fixture kernel must not hook the test
  // runner's process signals.
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  if (tenancy.kind === 'service') {
    kernel.registerService('tenancy', { posture: tenancy.posture });
  } else if (tenancy.kind === 'factory-throws') {
    // The registry's own unbranded rejection: registered, and unable to answer.
    kernel.registerServiceFactory('tenancy', () => {
      throw new Error('tenancy backend unavailable');
    });
  }
  const getService = kernel.getService.bind(kernel);
  const registerService = kernel.registerService.bind(kernel);
  const warnings: string[] = [];
  let readyHook: (() => Promise<void>) | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: (m: string) => { warnings.push(String(m)); }, error: () => {}, debug: () => {} },
    registerService,
    getService,
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    // A `KernelBase`-shaped host (`LiteKernel`) has no `getServiceAsync`.
    getKernel: () => (tenancy.kind === 'no-async-registry' ? { getService } : kernel),
  };

  // The bundled manifests and handlers, as `os serve` mounts them.
  const plugin = new SettingsServicePlugin({ env: {}, registerRoutes: false });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();

  const service = getService('settings') as SettingsService;
  const http = new MockHttp();
  registerSettingsRoutes(http, service, { contextFromRequest: admin });

  const call = async (route: string, req: Partial<IHttpRequest>) => {
    const state: { status: number; body?: any } = { status: 200 };
    const res = {
      json: vi.fn((data: any) => { state.body = data; }),
      send: vi.fn(),
      status: vi.fn((code: number) => { state.status = code; return res; }),
      header: vi.fn(() => res),
    } as unknown as IHttpResponse;
    await http.routes.get(route)!({ query: {}, params: {}, headers: {}, ...req } as IHttpRequest, res);
    return state;
  };
  const listed = async () =>
    ((await call('GET /api/settings', { method: 'GET' })).body.data.manifests as Array<{ namespace: string }>)
      .map((m) => m.namespace);
  const putBranding = () =>
    call('PUT /api/settings/:namespace', {
      method: 'PUT', params: { namespace: 'branding' } as any,
      body: { workspace_name: 'Acme', logo_url: 'https://acme.test/logo.svg' } as any,
    });
  const getBranding = () =>
    call('GET /api/settings/:namespace', { method: 'GET', params: { namespace: 'branding' } as any });

  return { service, listed, putBranding, getBranding, warnings };
}

describe('the Branding namespace under a walled posture (#24766)', () => {
  for (const posture of ['group', 'isolated'] as const) {
    describe(`posture '${posture}'`, () => {
      it('is absent from the settings listing, while the other tenant namespaces stay', async () => {
        const b = await boot({ kind: 'service', posture });
        const namespaces = await b.listed();
        expect(namespaces).not.toContain('branding');
        // Control: the listing is real and the rest of the slate is offered.
        expect(namespaces).toEqual(expect.arrayContaining(['company', 'localization', 'feature_flags']));
        expect(b.service.listManifests().map((m) => m.namespace)).not.toContain('branding');
      });

      it('a PUT to it is refused 404 UNKNOWN_NAMESPACE, never a silent 200', async () => {
        const b = await boot({ kind: 'service', posture });
        const state = await b.putBranding();
        expect(state.status).toBe(404);
        expect(state.body.error.code).toBe('UNKNOWN_NAMESPACE');
      });

      it('a GET of it is refused the same way: there is no form to render', async () => {
        const b = await boot({ kind: 'service', posture });
        const state = await b.getBranding();
        expect(state.status).toBe(404);
        expect(state.body.error.code).toBe('UNKNOWN_NAMESPACE');
      });
    });
  }
});

describe('the Branding namespace where no wall stands (#24766)', () => {
  const unwalled: Array<[string, Tenancy]> = [
    ["posture 'single'", { kind: 'service', posture: 'single' }],
    ['no tenancy service registered', { kind: 'unregistered' }],
    ['a host with no async registry', { kind: 'no-async-registry' }],
  ];
  for (const [label, tenancy] of unwalled) {
    it(`${label}: listed, readable and saved`, async () => {
      const b = await boot(tenancy);
      expect(await b.listed()).toContain('branding');
      const saved = await b.putBranding();
      expect(saved.status).toBe(200);
      expect(saved.body.data.values.logo_url).toMatchObject({ value: 'https://acme.test/logo.svg', source: 'tenant' });
      const read = await b.getBranding();
      expect(read.status).toBe(200);
      expect(read.body.data.values.workspace_name).toMatchObject({ value: 'Acme', source: 'tenant' });
    });
  }
});

describe('a posture that cannot be read (#24766)', () => {
  it('withholds the namespace and says why, rather than guessing there is no wall', async () => {
    const b = await boot({ kind: 'factory-throws' });
    expect(await b.listed()).not.toContain('branding');
    // One line names the withheld namespace.
    expect(b.warnings.filter((w) => w.includes("'branding'"))).toHaveLength(1);
  });
});
