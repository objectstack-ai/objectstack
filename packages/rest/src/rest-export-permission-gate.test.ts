// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3544 — the user-level EXPORT gate on `GET /data/:object/export`.
 *
 * The axis shipped as a spec bit plus a `/me/permissions` annotation, which hid
 * the client's Export button and nothing more. `export ⊆ list`, so the route
 * streams through `findData` and the engine middleware sees a plain `find`
 * gated by `allowRead` — `allowExport` was never consulted on the wire, and a
 * caller holding `allowExport: false` could still `curl` the whole table out.
 *
 * These pin the door itself: the 403, and — the assertion that actually matters
 * — that `findData` is NEVER reached on a denial, so a refusal cannot leak the
 * first chunk before it fires. Rows are stubbed on purpose; this is a test of
 * the gate, not of the streaming path (`export-integration.test.ts` owns that).
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectKernel, isServiceNotRegisteredError } from '@objectstack/core';
import { RestServer } from './rest-server';

const TASK = {
  name: 'task',
  label: '任务',
  fields: {
    id: { type: 'text', label: 'ID' },
    title: { type: 'text', label: '标题' },
  },
};

const ROWS = [
  { id: '1', title: '写代码' },
  { id: '2', title: '写文档' },
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  let status = 200;
  const res: any = {
    write: (s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true; },
    end: () => {},
    header: (n: string, v: string) => { headers[n] = v; return res; },
    status: (code: number) => { status = code; return res; },
    json: (body: any) => { (res as any)._json = body; return res; },
  };
  return { res, chunks, headers, getStatus: () => status, getJson: () => (res as any)._json };
}

/**
 * Boot the export route over a stub protocol, with `security` resolved from
 * `securityServiceProvider` (the 18th positional ctor arg) — or, when
 * `provider` is given, from that provider itself.
 *
 * `enable` is left undefined on the object so the OBJECT-level gate
 * (`apiAccessDenialFromEnable`) is fully open — every denial these tests observe
 * is therefore the USER-level axis, never the `apiMethods` whitelist.
 */
function boot(security: any, provider?: () => Promise<unknown>) {
  const findData = vi.fn().mockResolvedValue({ object: 'task', records: ROWS });
  const protocol: any = {
    getMetaItems: vi.fn().mockResolvedValue({ items: [TASK] }),
    getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'task', item: TASK }),
    findData,
  };
  const rest = new RestServer(
    createMockServer() as any,
    protocol as any,
    { api: { requireAuth: false } } as any,
    undefined, // kernelManager
    undefined, // envRegistry
    undefined, // defaultEnvironmentIdProvider
    undefined, // authServiceProvider
    undefined, // objectQLProvider
    undefined, // emailServiceProvider
    undefined, // sharingServiceProvider
    undefined, // reportsServiceProvider
    undefined, // approvalsServiceProvider
    undefined, // sharingRulesServiceProvider
    undefined, // i18nServiceProvider
    undefined, // analyticsServiceProvider
    undefined, // settingsServiceProvider
    undefined, // serviceExistsProvider
    provider ?? (security === undefined ? undefined : async () => security),
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
  );
  expect(route).toBeDefined();
  return { route, findData };
}

const run = async (route: any) => {
  const out = makeRes();
  await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, out.res);
  return out;
};

describe('export route — user-level export axis (#3544)', () => {
  it('canExport:false → 403 EXPORT_NOT_PERMITTED, and NOTHING is read', async () => {
    const { route, findData } = boot({ canExport: async () => false });
    const out = await run(route);

    expect(out.getStatus()).toBe(403);
    expect(out.getJson()).toMatchObject({ code: 'EXPORT_NOT_PERMITTED', object: 'task' });
    // The whole point: the refusal lands BEFORE the first chunk is fetched, so
    // a denied export cannot dribble rows out ahead of the status code.
    expect(findData).not.toHaveBeenCalled();
    expect(out.chunks.join('')).toBe('');
  });

  it('canExport:true → the export proceeds and streams rows', async () => {
    const { route, findData } = boot({ canExport: async () => true });
    const out = await run(route);

    expect(out.getStatus()).toBe(200);
    expect(findData).toHaveBeenCalled();
    expect(out.chunks.join('')).toContain('写代码');
  });

  it('passes the object name and the request ExecutionContext to canExport', async () => {
    // The decision is per-object AND per-caller: handing the service anything
    // less would make it answer a different question than the one being asked.
    const canExport = vi.fn().mockResolvedValue(true);
    const { route } = boot({ canExport });
    await run(route);

    expect(canExport).toHaveBeenCalledTimes(1);
    expect(canExport.mock.calls[0][0]).toBe('task');
  });

  it('no security service at all → allowed (deployment has no permission sets)', async () => {
    // Matches every other permission gate in this layer, and `/me/permissions`'
    // documented fail-open: without plugin-security there is nothing to enforce.
    const { route, findData } = boot(undefined);
    const out = await run(route);

    expect(out.getStatus()).toBe(200);
    expect(findData).toHaveBeenCalled();
  });

  it('service present but without canExport → allowed (feature-detected)', async () => {
    // An older or partial implementation degrades instead of hard-failing —
    // the contract's stated posture for the whole `security` surface.
    const { route, findData } = boot({ getReadableFields: async () => undefined });
    const out = await run(route);

    expect(out.getStatus()).toBe(200);
    expect(findData).toHaveBeenCalled();
  });

  it('canExport throws → 403 (fail CLOSED, ADR-0049)', async () => {
    // It resolves permission sets to decide; a resolution failure must never
    // read as a grant.
    const { route, findData } = boot({
      canExport: async () => { throw new Error('permission set resolution failed'); },
    });
    const out = await run(route);

    expect(out.getStatus()).toBe(403);
    expect(out.getJson()).toMatchObject({ code: 'EXPORT_NOT_PERMITTED' });
    expect(findData).not.toHaveBeenCalled();
  });

  it('a wired security provider that REJECTS → 503 SERVICE_UNAVAILABLE, and NOTHING is read', async () => {
    // A door whose security service cannot be resolved refuses rather than
    // proceeds: a service that is registered but unresolvable is not "no
    // security service" (ADR-0106 D6 tier 3; ADR-0049).
    const { route, findData } = boot(undefined, async () => {
      throw new Error('the security service failed to construct');
    });
    const out = await run(route);

    expect(out.getStatus()).toBe(503);
    expect(out.getJson()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(findData).not.toHaveBeenCalled();
    expect(out.chunks.join('')).toBe('');
  });

  it('a provider rejecting with the registry\'s "never registered" brand → allowed, as with no security service at all', async () => {
    // The registry's own rejection for a slot nothing ever registered, from a
    // real kernel: the one rejection that means "no permission posture here".
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
    const provider = () => kernel.getServiceAsync('security');
    await expect(provider()).rejects.toSatisfy(isServiceNotRegisteredError);
    const { route, findData } = boot(undefined, provider);
    const out = await run(route);

    expect(out.getStatus()).toBe(200);
    expect(findData).toHaveBeenCalled();
  });

  it('the object-level 405 still precedes the user-level 403', async () => {
    // Two gates, two questions: `apiMethods` decides whether the OBJECT exposes
    // export (405), this axis decides whether the CALLER may use it (403). An
    // object that exposes no export must answer 405 whatever the user holds.
    const findData = vi.fn().mockResolvedValue({ object: 'task', records: ROWS });
    // [#24031] The gate reads its one object BY NAME; the by-name read answers
    // the object the list holds, as the real protocol's two reads agree.
    const exposedForGetOnly = { ...TASK, enable: { apiMethods: ['get'] } };
    const protocol: any = {
      getMetaItems: vi.fn().mockResolvedValue({ items: [exposedForGetOnly] }),
      getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'task', item: exposedForGetOnly }),
      findData,
    };
    const rest = new RestServer(
      createMockServer() as any,
      protocol as any,
      { api: { requireAuth: false } } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined,
      async () => ({ canExport: async () => false }),
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
    const route = rest.getRoutes().find(
      (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
    );
    const out = await run(route);

    expect(out.getStatus()).toBe(405);
    expect(out.getJson()).toMatchObject({ code: 'OBJECT_API_METHOD_NOT_ALLOWED' });
    expect(findData).not.toHaveBeenCalled();
  });
});
