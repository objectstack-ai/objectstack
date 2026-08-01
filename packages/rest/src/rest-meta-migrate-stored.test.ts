// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/meta/_migrate-stored` — the server-side form of
 * `os migrate meta --stored` (#4327 / #4454 / #4498).
 *
 * `os migrate meta --stored` needs shell access to the deployment's database.
 * A hosted operator has none, so ADR-0087's stored-metadata chain had no finish
 * line at all on a managed deployment — only the per-read conversion, running
 * forever. This route is that finish line, and because it runs inside a server
 * that already holds a live automation engine, flow rows are covered without
 * threading anything (#4498).
 *
 * What these pin is the route's POSTURE. The migration itself is covered by
 * `metadata-protocol`'s `protocol.stored-migration.test.ts`; here the questions
 * are: who may fire it, and does an under-specified request write.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const REPORT = {
  apply: false,
  protocol: '17.0.0',
  scanned: 4,
  canonical: 3,
  pending: 1,
  rewritten: 0,
  skipped: 0,
  failed: 0,
  rows: [],
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  let status = 200;
  const res: any = {
    status: (code: number) => { status = code; return res; },
    json: (body: any) => { (res as any)._json = body; return res; },
    header: () => res,
    write: () => true,
    end: () => {},
  };
  return { res, getStatus: () => status, getJson: () => (res as any)._json };
}

/** Boot the route over a stub protocol, with `execCtx` as the resolved caller. */
function boot(execCtx: any, protocolOverrides: Record<string, unknown> = {}) {
  const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
  const protocol: any = { migrateStoredMetadata, ...protocolOverrides };
  const rest = new RestServer(
    createMockServer() as any,
    protocol as any,
    { api: { requireAuth: false } } as any,
  );
  (rest as any).resolveExecCtx = async () => execCtx;
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'POST' && r.path === '/api/v1/meta/_migrate-stored',
  );
  expect(route).toBeDefined();
  return { route, migrateStoredMetadata };
}

const run = async (route: any, body: unknown) => {
  const out = makeRes();
  await route.handler({ params: {}, query: {}, body } as any, out.res);
  return out;
};

describe('POST /meta/_migrate-stored — mounting', () => {
  it('is registered BEFORE /meta/:type, so the segment is never read as a type name', async () => {
    const rest = new RestServer(
      createMockServer() as any,
      { migrateStoredMetadata: vi.fn() } as any,
      { api: { requireAuth: false } } as any,
    );
    rest.registerRoutes();
    const paths = rest.getRoutes().map((r: any) => `${r.method} ${r.path}`);
    expect(paths).toContain('POST /api/v1/meta/_migrate-stored');
    expect(paths.indexOf('POST /api/v1/meta/_migrate-stored'))
      .toBeLessThan(paths.indexOf('GET /api/v1/meta/:type'));
  });
});

describe('POST /meta/_migrate-stored — capability gate', () => {
  it('403s a caller without `manage_metadata`, and reads NOTHING', async () => {
    const { route, migrateStoredMetadata } = boot({ userId: 'u1', systemPermissions: ['setup.access'] });
    const out = await run(route, { apply: true });

    expect(out.getStatus()).toBe(403);
    expect(out.getJson()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    // Unlike the single-item `PUT /meta/:type/:name` next door, this rewrites
    // every eligible row in the deployment — a session is not enough.
    expect(migrateStoredMetadata).not.toHaveBeenCalled();
  });

  it('an anonymous caller never reaches the capability gate — 401 from the meta umbrella', async () => {
    // Every `/meta` route inherits the anonymous-deny wrapper
    // (`registerMetadataEndpoints`), so this route is closed to anonymous
    // callers by construction and the `manage_metadata` check below it is the
    // second layer, not the only one.
    const { route, migrateStoredMetadata } = boot(undefined);
    const out = await run(route, {});
    expect(out.getStatus()).toBe(401);
    expect(migrateStoredMetadata).not.toHaveBeenCalled();
  });

  it('allows a caller holding `manage_metadata`', async () => {
    const { route, migrateStoredMetadata } = boot({ userId: 'u1', systemPermissions: ['manage_metadata'] });
    const out = await run(route, {});
    expect(out.getStatus()).toBe(200);
    expect(migrateStoredMetadata).toHaveBeenCalledTimes(1);
  });

  it('isSystem bypasses, matching every other capability gate', async () => {
    const { route, migrateStoredMetadata } = boot({ isSystem: true });
    await run(route, {});
    expect(migrateStoredMetadata).toHaveBeenCalledTimes(1);
  });

  it('the gate fires BEFORE the protocol is probed, so 403 vs 501 leaks nothing', async () => {
    // A kernel with no `migrateStoredMetadata` answers 501 to an authorized
    // caller. An unauthorized one must not be able to tell the two apart.
    const { route } = boot({ userId: 'u1', systemPermissions: [] }, { migrateStoredMetadata: undefined });
    const out = await run(route, {});
    expect(out.getStatus()).toBe(403);
  });
});

describe('POST /meta/_migrate-stored — preview by default', () => {
  const admin = { userId: 'admin', systemPermissions: ['manage_metadata'] };

  it('an empty body previews — `apply` is never inferred', async () => {
    const { route, migrateStoredMetadata } = boot(admin);
    await run(route, {});
    expect(migrateStoredMetadata.mock.calls[0][0].apply).toBe(false);
  });

  it('a missing body previews rather than throwing', async () => {
    const { route, migrateStoredMetadata } = boot(admin);
    const out = await run(route, undefined);
    expect(out.getStatus()).toBe(200);
    expect(migrateStoredMetadata.mock.calls[0][0].apply).toBe(false);
  });

  it('only a literal `true` applies', async () => {
    const { route, migrateStoredMetadata } = boot(admin);
    await run(route, { apply: 'yes' });
    expect(migrateStoredMetadata.mock.calls[0][0].apply).toBe(false);
    await run(route, { apply: true });
    expect(migrateStoredMetadata.mock.calls[1][0].apply).toBe(true);
  });

  it('passes a `types` filter through, dropping non-string members', async () => {
    const { route, migrateStoredMetadata } = boot(admin);
    await run(route, { types: ['flow', 42, '', 'object'] });
    expect(migrateStoredMetadata.mock.calls[0][0].types).toEqual(['flow', 'object']);
  });

  it('omits `types` when none survive, so the run is not silently empty', async () => {
    const { route, migrateStoredMetadata } = boot(admin);
    await run(route, { types: [42] });
    expect(migrateStoredMetadata.mock.calls[0][0]).not.toHaveProperty('types');
  });

  it('threads NO canonicalizeFlow — the protocol resolves the engine itself (#4498)', async () => {
    const { route, migrateStoredMetadata } = boot(admin);
    await run(route, {});
    expect(migrateStoredMetadata.mock.calls[0][0]).not.toHaveProperty('canonicalizeFlow');
  });

  it('attributes the run to the caller — history and audit rows answer "who ran it"', async () => {
    const { route, migrateStoredMetadata } = boot(admin);
    await run(route, {});
    expect(migrateStoredMetadata.mock.calls[0][0].actor).toContain('admin');
  });

  it('returns the report unwrapped', async () => {
    const { route } = boot(admin);
    const out = await run(route, {});
    expect(out.getJson()).toEqual(REPORT);
  });

  it('501s an authorized caller on a kernel whose protocol predates the pass', async () => {
    const { route } = boot(admin, { migrateStoredMetadata: undefined });
    const out = await run(route, {});
    expect(out.getStatus()).toBe(501);
    expect(out.getJson()).toMatchObject({ error: { code: 'NOT_IMPLEMENTED' } });
  });
});
