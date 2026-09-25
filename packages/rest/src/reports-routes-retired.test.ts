// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20102] The saved-report `/api/v1/reports` family is RETIRED, and a retired
 * path answers exactly what a path that never existed answers.
 *
 * The eight routes (list, save, get, delete, run, schedule, list schedules,
 * unschedule) left with the saved-report stack — the service contract, the two
 * platform objects, the SDK namespace and `@objectstack/plugin-reports`. Nothing
 * replaces them at this address: a report is `report` metadata, and a saved
 * ad-hoc object query is a ListView.
 *
 * What "retired" must mean on the wire, and what each case below holds:
 *
 *  - no route is REGISTERED under the prefix (a `501 not configured` answer
 *    would still advertise a capability the platform no longer has);
 *  - every former method + path gets the adapter's standard unmatched answer —
 *    `404`, byte-identical to a control path nobody ever mounted. Not `405`:
 *    a 405 would mean some other verb still lives at that path;
 *  - the server under test is really serving: a mounted sibling capability
 *    family (`/approvals`, which answers `501` with no provider wired) does NOT
 *    fall into the 404 — otherwise every assertion above passes against a
 *    server that mounted nothing.
 *
 * Driven through the real `HonoHttpServer` with its `notFound` seam installed,
 * the adapter `os serve` mounts, so the 404 is the platform's own answer and
 * not a mock's default.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { RestServer } from './rest-server';

const ANON_API = { api: { requireAuth: false } };

function createMockProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({
      version: 'v0',
      routes: { data: '', metadata: '', ui: '', auth: '/auth' },
    }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
    getData: vi.fn().mockResolvedValue({}),
    createData: vi.fn().mockResolvedValue({ id: '1' }),
    updateData: vi.fn().mockResolvedValue({}),
    deleteData: vi.fn().mockResolvedValue({ success: true }),
  };
}

/** The eight former routes, as they were registered — method + concrete path. */
const RETIRED: ReadonlyArray<readonly [method: string, path: string]> = [
  ['GET', '/api/v1/reports'],
  ['POST', '/api/v1/reports'],
  ['GET', '/api/v1/reports/r1'],
  ['DELETE', '/api/v1/reports/r1'],
  ['POST', '/api/v1/reports/r1/run'],
  ['POST', '/api/v1/reports/r1/schedule'],
  ['GET', '/api/v1/reports/r1/schedules'],
  ['DELETE', '/api/v1/reports/schedules/s1'],
];

function boot() {
  const server = new HonoHttpServer(0);
  server.installNotFoundSeam();
  const rest = new RestServer(server as any, createMockProtocol() as any, ANON_API as any);
  rest.registerRoutes();
  return { rest, app: server.getRawApp() };
}

async function answer(app: any, method: string, path: string) {
  const res: Response = await app.fetch(
    new Request(`http://local${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    }),
  );
  return { status: res.status, allow: res.headers.get('allow'), body: await res.text() };
}

describe('[#20102] the saved-report /api/v1/reports family is retired', () => {
  it('registers no route under the retired prefix — and does register the rest of the API', () => {
    const { rest } = boot();
    const routes: Array<{ method: string; path: string }> = rest.getRoutes();
    // Anti-vacuity: an empty route table satisfies the absence below for free.
    expect(routes.some((r) => r.path.startsWith('/api/v1/approvals/'))).toBe(true);
    expect(
      routes.filter((r) => r.path === '/api/v1/reports' || r.path.startsWith('/api/v1/reports/')),
    ).toEqual([]);
  });

  it.each(RETIRED)('%s %s answers the standard unmounted-route 404', async (method, path) => {
    const { app } = boot();
    const retired = await answer(app, method, path);
    // The control: the same verb at a path no code ever mounted.
    const control = await answer(app, method, '/api/v1/zz-never-mounted');

    expect(control.status).toBe(404);
    expect(retired.status).toBe(404);
    // Not a 405 — no other verb survives at the retired path.
    expect(retired.allow).toBeNull();
    // Byte-identical to "never existed": no residual refusal text, code or hint.
    expect(retired.body).toBe(control.body);
  });

  it('a mounted sibling capability family still answers — the 404 above is not a dead server', async () => {
    const { app } = boot();
    // `/approvals` is served by the same registrar pass and answers 501 when
    // no approvals provider is wired, which is the case here.
    const sibling = await answer(app, 'GET', '/api/v1/approvals/requests');
    expect(sibling.status).not.toBe(404);
    expect(sibling.status).toBe(501);
  });
});
