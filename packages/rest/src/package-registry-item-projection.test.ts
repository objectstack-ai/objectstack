// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The REST package read doors project a REGISTRY-sourced entry onto its
 * declared fields instead of spreading it whole.
 *
 * ## Where this sits
 *
 * The card behind it is the `500 Converting circular structure to JSON` a stock
 * showcase boot answered on `GET /api/v1/packages` — `SchemaRegistry.install-
 * Package` stored the caller's live `defineStack()` object, whose `plugins: [...]`
 * held initialised plugin instances and through them the engine. The REPAIR is
 * at that producer (`@objectstack/objectql`), so by the time an entry reaches
 * this door there is nothing unserializable left in it.
 *
 * ⚠️ Measured, and worth writing down because the card attributed the 500 here:
 * in the showcase composition these two same-pattern routes are NOT the ones
 * that answered — the dispatcher twin (`packages/runtime/src/domains/packages.ts`)
 * did. The 404 wording separates them: `Package "x" was not found.` here,
 * `Package 'x' not found` there, and the live probe returned the latter. So what
 * this file pins is this door's own posture, not the reproduction of the boot.
 *
 * ## What it pins
 *
 * `{ ...item, source: 'registry' }` gave ONE undeclared member on ONE package
 * the power to fail the whole list for every caller. The projection turns that
 * into a field the response never mentions. Both halves matter and both are
 * asserted: the undeclared member is DROPPED, and every declared field —
 * including the `_diagnostics` the protocol's own decoration grafts on — is
 * still SERVED. A projection that quietly ate `_diagnostics` would pass a
 * "no longer 500" assertion just as well.
 *
 * ⛔ The DATABASE half is deliberately not projected and is asserted unchanged:
 * its shape belongs to `PackageService`, not to this door.
 */

import { describe, it, expect } from 'vitest';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';

interface Captured { status: number; body: any }

/** The engine's own `actionActivation -> store -> engine` cycle, reproduced. */
function cyclicEngine(): Record<string, unknown> {
  const engine: Record<string, unknown> = { name: '_ObjectQL' };
  const store: Record<string, unknown> = { name: 'ObjectStoreActionActivationStore', engine };
  engine.actionActivation = { name: 'ActionActivationProjection', store };
  return engine;
}

/**
 * A registry entry in the shape `protocol.getMetaItems({ type: 'package' })`
 * yields: the installed-package record, plus the `_diagnostics` that
 * `decorateMetadataItem` grafts on, plus — the case under test — an undeclared
 * member holding a live object.
 */
function registryEntry(extra: Record<string, unknown> = {}) {
  return {
    manifest: { id: 'com.example.showcase', name: 'Showcase', version: '0.3.16' },
    status: 'installed',
    enabled: true,
    installedAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    settings: { theme: 'dark' },
    _diagnostics: [{ code: 'SOMETHING', message: 'noted' }],
    ...extra,
  };
}

function mount(svc: any, protocolItems: unknown[]) {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: () => {},
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  } as any;
  // The authorization gate (#7033 / #7023) is not this file's subject.
  registerPackageRoutes(server, () => svc as any, '/api/v1', {
    resolveExecutionContext: async () => ({
      userId: 'u_pkg', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    }),
    protocol: { getMetaItems: async () => ({ items: protocolItems }) },
  } as any);
  return routes;
}

async function drive(
  routes: Map<string, RouteHandler>,
  method: string,
  path: string,
  req: Record<string, any> = {},
): Promise<Captured> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`no handler for ${method} ${path}`);
  const captured: Captured = { status: 200, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as any,
    res,
  );
  return captured;
}

/** A durable half that finds nothing, so only the registry half is exercised. */
const EMPTY_DB = { list: async () => [], get: async () => null };

describe('GET /packages — registry entries are projected, not spread', () => {
  it('serves the entry when it carries an undeclared LIVE member, instead of 500', async () => {
    const routes = mount(EMPTY_DB, [registryEntry({ liveEngineHandle: cyclicEngine() })]);
    const { status, body } = await drive(routes, 'GET', PKGS);

    expect(status).toBe(200);
    // The step the transport takes next, and the one that threw on the boot.
    expect(() => JSON.stringify(body)).not.toThrow();
    expect(body.data.packages).toHaveLength(1);
    expect('liveEngineHandle' in body.data.packages[0]).toBe(false);
  });

  it('still serves every declared field, and the protocol’s `_diagnostics`', async () => {
    const routes = mount(EMPTY_DB, [registryEntry({ liveEngineHandle: cyclicEngine() })]);
    const { body } = await drive(routes, 'GET', PKGS);
    const served = body.data.packages[0];

    expect(served.manifest).toEqual({ id: 'com.example.showcase', name: 'Showcase', version: '0.3.16' });
    expect(served.status).toBe('installed');
    expect(served.enabled).toBe(true);
    expect(served.installedAt).toBe('2026-09-02T00:00:00.000Z');
    expect(served.updatedAt).toBe('2026-09-02T00:00:00.000Z');
    expect(served.settings).toEqual({ theme: 'dark' });
    expect(served._diagnostics).toEqual([{ code: 'SOMETHING', message: 'noted' }]);
    // The provenance marker the door adds is unchanged.
    expect(served.source).toBe('registry');
  });

  it('omits a declared field that is absent rather than serialising `undefined`', async () => {
    const routes = mount(EMPTY_DB, [{
      manifest: { id: 'com.objectstack.setup' }, status: 'installed', enabled: true,
    }]);
    const { body } = await drive(routes, 'GET', PKGS);

    expect(Object.keys(body.data.packages[0]).sort())
      .toEqual(['enabled', 'manifest', 'source', 'status']);
  });

  it('leaves the DATABASE half’s shape alone — this door does not own it', async () => {
    const dbRow = {
      id: 'com.acme.published',
      manifest: { id: 'com.acme.published', version: '2.0.0' },
      publishedBy: 'u_release',
      artifactSize: 4096,
    };
    const routes = mount({ list: async () => [dbRow], get: async () => null }, []);
    const { body } = await drive(routes, 'GET', PKGS);

    // Fields that are NOT part of the installed-package record still travel.
    expect(body.data.packages[0].publishedBy).toBe('u_release');
    expect(body.data.packages[0].artifactSize).toBe(4096);
    expect(body.data.packages[0].source).toBe('database');
  });
});

describe('GET /packages/:id — the registry fallback is projected too', () => {
  it('serves the entry with the undeclared member dropped', async () => {
    const routes = mount(EMPTY_DB, [registryEntry({ liveEngineHandle: cyclicEngine() })]);
    const { status, body } = await drive(
      routes, 'GET', `${PKGS}/:id`, { params: { id: 'com.example.showcase' } },
    );

    expect(status).toBe(200);
    expect(() => JSON.stringify(body)).not.toThrow();
    expect('liveEngineHandle' in body.data.package).toBe(false);
    expect(body.data.package.manifest.id).toBe('com.example.showcase');
    expect(body.data.package._diagnostics).toEqual([{ code: 'SOMETHING', message: 'noted' }]);
    expect(body.data.package.source).toBe('registry');
  });

  it('a genuine MISS is still a 404 with this door’s own wording', async () => {
    // The other direction: projection must not turn "absent" into "present".
    const routes = mount(EMPTY_DB, [registryEntry()]);
    const { status, body } = await drive(
      routes, 'GET', `${PKGS}/:id`, { params: { id: 'no.such.package' } },
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.error.message).toBe('Package "no.such.package" was not found.');
  });
});
