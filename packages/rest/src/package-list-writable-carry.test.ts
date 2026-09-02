// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST `GET /packages` CARRIES the producer's `writable` verdict (#14375).
 *
 * The REST list door does not compute writability itself — it must not: this
 * package has no runtime dependency on `@objectstack/metadata-protocol`, and
 * the verdict has one definition (`isWritablePackage`, ADR-0070 D2) that the
 * protocol's `getMetaItems({ type: 'package' })` now stamps on every registry
 * item. What THIS door owns is the merge: the durable (`PackageService.list()`)
 * row is spread OVER the registry item, so a durable row that carries no
 * `writable` key must leave the registry item's verdict standing, and a
 * durable-only row (no registry presence) carries no verdict at all. Both are
 * pinned here, because the spread order is the one place this file could lose
 * the field.
 */

import { describe, it, expect } from 'vitest';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';

type Captured = { status: number; body: any };

function mount(svc: any, protocol: any) {
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
  registerPackageRoutes(server, () => svc, '/api/v1', {
    resolveExecutionContext: async () => ({
      userId: 'u_pkg', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    }),
    protocol,
  });
  return routes;
}

async function drive(routes: Map<string, RouteHandler>, method: string, path: string, req: Record<string, any> = {}): Promise<Captured> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`no handler for ${method} ${path}`);
  const captured: Captured = { status: 200, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler({ params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as any, res);
  return captured;
}

/** The scope-less booted module — the producer says read-only. */
const MODULE = 'app.acme.crm.billing';
/** A scope-less Studio base — the producer says writable; it also has a durable row. */
const BASE = 'com.acme.mybase';
/** A durable-only row: published, never registered on this process. */
const DURABLE_ONLY = 'com.acme.published-elsewhere';

const registryItems = [
  { manifest: { id: MODULE, name: MODULE, version: '1.0.0', type: 'module' }, status: 'installed', enabled: true, writable: false },
  { manifest: { id: BASE, name: BASE, version: '1.0.0' }, status: 'installed', enabled: true, writable: true },
];
const protocol = { getMetaItems: async () => ({ type: 'package', items: registryItems }) };
const svc = {
  list: async () => [
    // The durable row for BASE has NO `writable` key — a durable copy is not
    // where the verdict lives.
    { id: BASE, version: '1.0.0', manifest: { id: BASE, name: BASE, version: '1.0.0' } },
    { id: DURABLE_ONLY, version: '3.0.0', manifest: { id: DURABLE_ONLY, version: '3.0.0' } },
  ],
};

const rowOf = (body: any, id: string) => body.data.packages.find((p: any) => (p.manifest?.id ?? p.id) === id);

describe('REST GET /packages carries the producer\'s writable verdict through the merge (#14375)', () => {
  it('a registry-only row keeps the producer\'s verdict', async () => {
    const r = await drive(mount(svc, protocol), 'GET', '/api/v1/packages');
    expect(r.status).toBe(200);
    const row = rowOf(r.body, MODULE);
    expect(row.source).toBe('registry');
    expect(row.writable).toBe(false);
  });

  it('a durable row spread over a registry item does NOT erase the verdict (spread order)', async () => {
    const r = await drive(mount(svc, protocol), 'GET', '/api/v1/packages');
    const row = rowOf(r.body, BASE);
    expect(row.source).toBe('both');
    // The durable row carried no `writable`; the registry item's stands.
    expect(row.writable).toBe(true);
  });

  it('a durable-only row carries no verdict — the registry item is the only carrier', async () => {
    const r = await drive(mount(svc, protocol), 'GET', '/api/v1/packages');
    const row = rowOf(r.body, DURABLE_ONLY);
    expect(row.source).toBe('database');
    expect('writable' in row).toBe(false);
  });

  it('is additive: nothing else about the merged rows changed', async () => {
    const r = await drive(mount(svc, protocol), 'GET', '/api/v1/packages');
    expect(r.body.data.total).toBe(3);
    const { writable, ...rest } = rowOf(r.body, MODULE);
    expect(writable).toBe(false);
    const { writable: _producerVerdict, ...producerItem } = registryItems[0];
    expect(rest).toEqual({ ...producerItem, source: 'registry' });
  });
});
