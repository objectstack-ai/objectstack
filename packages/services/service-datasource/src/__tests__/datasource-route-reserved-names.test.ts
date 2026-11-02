// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Route-shadowed datasource names (#29164).
 *
 * `GET /datasources/drivers` is the driver catalog, mounted before
 * `GET /datasources/:name`, so a runtime datasource named `drivers` was
 * created (201) and listed while its detail read — the edit form's load —
 * always answered the catalog. Create now refuses every literal the registrar
 * mounts beside a same-method `/:name` route, the way it refuses the
 * host-owned `default`.
 *
 * Two halves:
 *  - the DRIFT PIN derives the shadowing literals from what
 *    `registerDatasourceAdminRoutes` actually mounts (a capturing mock
 *    `IHttpServer`, the route-ledger conformance seam) and holds the reserved
 *    list equal to them, so a new literal sibling of `/:name` mounted without
 *    a reservation fails here;
 *  - the DOOR cases run the real `HonoHttpServer` over a real
 *    `DatasourceAdminService`: the refusal envelope, the service never
 *    writing, `default` unchanged, and the names that stay creatable.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import { ROUTE_SHADOWED_DATASOURCE_NAMES } from '../datasource-route-reserved-names.js';
import {
  ENTITLED_CREDENTIAL,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

const BASE = '/api/v1';
const ROOT = `${BASE}/datasources`;
const VERBS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Every `[VERB, path]` the registrar mounts at the default base. */
function enumerateMounts(): Array<[string, string]> {
  const server = Object.fromEntries([
    ...VERBS.map((v) => [v, vi.fn()]),
    ['use', vi.fn()],
    ['listen', vi.fn().mockResolvedValue(undefined)],
    ['close', vi.fn().mockResolvedValue(undefined)],
  ]) as Record<(typeof VERBS)[number], ReturnType<typeof vi.fn>>;
  const ctx = { getService: () => undefined, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  registerDatasourceAdminRoutes(server as never, ctx as never, BASE);
  return VERBS.flatMap((v) => server[v].mock.calls.map((c): [string, string] => [v.toUpperCase(), String(c[0])]));
}

/**
 * The literal single segments under the root that share a method with a
 * `/:name` route — the names that route would never see.
 */
function shadowingLiterals(mounts: Array<[string, string]>): string[] {
  const byNameMethods = new Set(mounts.filter(([, p]) => p === `${ROOT}/:name`).map(([m]) => m));
  const literals = new Set<string>();
  for (const [method, path] of mounts) {
    if (!path.startsWith(`${ROOT}/`)) continue;
    const rest = path.slice(ROOT.length + 1);
    if (rest.includes('/') || rest.startsWith(':')) continue;
    if (byNameMethods.has(method)) literals.add(rest);
  }
  return [...literals].sort();
}

describe('reserved datasource names ↔ the registrar\'s literal siblings of /:name', () => {
  it('reserves exactly the literals that shadow a same-method /:name route', () => {
    const mounts = enumerateMounts();
    // Control: the enumeration saw the by-name read and a literal at all, so
    // an empty answer below could not be a silent nothing-enumerated.
    expect(mounts).toContainEqual(['GET', `${ROOT}/:name`]);
    expect(mounts).toContainEqual(['POST', `${ROOT}/test`]);

    expect([...ROUTE_SHADOWED_DATASOURCE_NAMES].sort()).toEqual(shadowingLiterals(mounts));
  });

  it('a literal beside a /:name route of ANOTHER method is not a shadowing one', () => {
    // `POST /datasources/test` shares no method with a `/:name` route; were a
    // `GET /datasources/test` mounted, `test` would join the derived set and
    // the pin above would fail until it is reserved.
    expect(shadowingLiterals([['POST', `${ROOT}/test`], ['GET', `${ROOT}/:name`]])).toEqual([]);
    expect(shadowingLiterals([['GET', `${ROOT}/test`], ['GET', `${ROOT}/:name`]])).toEqual(['test']);
  });
});

// ---------------------------------------------------------------------------
// The create door, end to end.

function harness(seed: StoredDatasource[] = []) {
  const records: StoredDatasource[] = seed.map((r) => ({ ...r }));
  const puts: string[] = [];
  const config: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true, latencyMs: 1 }),
    listDatasourceRecords: async () => records.map((r) => ({ ...r })),
    getDatasourceRecord: async (n) => {
      const r = records.find((x) => x.name === n);
      return r ? { ...r } : undefined;
    },
    putDatasourceRecord: async (record) => {
      puts.push(record.name);
      const i = records.findIndex((r) => r.name === record.name);
      if (i >= 0) records[i] = { ...record };
      else records.push({ ...record });
    },
    deleteDatasourceRecord: async (n) => {
      const i = records.findIndex((r) => r.name === n);
      if (i >= 0) records.splice(i, 1);
    },
    writeSecret: async (_input, hint) => `sys_secret://datasource/${hint.name}`,
    countBoundObjects: async () => 0,
    listObjectsBoundTo: async () => [],
  };
  const service = new DatasourceAdminService(config);
  const authService = createSessionAuthService();
  const grantsEngine = createGrantsEngine();
  const server = new HonoHttpServer(0);
  const ctx = {
    getService: (name: string) =>
      name === 'auth'
        ? authService
        : name === 'objectql' || name === 'data'
          ? grantsEngine
          : name === 'datasource-admin'
            ? service
            : undefined,
  };
  registerDatasourceAdminRoutes(server, ctx as never, BASE);
  const app = server.getRawApp();
  const call = (path: string, method = 'GET', body?: unknown) =>
    app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: ENTITLED_CREDENTIAL },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { call, puts, records };
}

const draft = (name: string) => ({ name, driver: 'postgres', config: { database: 'analytics' } });

describe('POST /api/v1/datasources — route-shadowed names', () => {
  it('refuses `drivers` with the 400 DATASOURCE_ADMIN_ERROR naming the segment, and writes nothing', async () => {
    const { call, puts, records } = harness();
    const res = await call(ROOT, 'POST', draft('drivers'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('DATASOURCE_ADMIN_ERROR');
    expect(body.error.message).toContain("'drivers'");
    expect(puts).toEqual([]);
    expect(records).toEqual([]);
  });

  it('keeps refusing the host-owned `default` the same way', async () => {
    const { call, puts } = harness();
    const res = await call(ROOT, 'POST', draft('default'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('DATASOURCE_ADMIN_ERROR');
    expect(body.error.message).toContain("'default'");
    expect(puts).toEqual([]);
  });

  it('still creates an ordinary name (201) and reads it back by name', async () => {
    const { call, puts } = harness();
    const res = await call(ROOT, 'POST', draft('reporting'));
    expect(res.status).toBe(201);
    expect(puts).toEqual(['reporting']);
    const read = await call(`${ROOT}/reporting`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as any).data.datasource.name).toBe('reporting');
  });

  it('still creates `test` — the draft-probe literal shadows no by-name door', async () => {
    const { call, puts } = harness();
    const res = await call(ROOT, 'POST', draft('test'));
    expect(res.status).toBe(201);
    expect(puts).toEqual(['test']);
    const read = await call(`${ROOT}/test`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as any).data.datasource.name).toBe('test');
  });
});

describe('a stored `drivers` row written before the refusal', () => {
  it('stays listed, patchable and removable — the refusal is at create only', async () => {
    const { call, records } = harness([{ name: 'drivers', driver: 'postgres', config: { database: 'a' }, origin: 'runtime' }]);

    const list = await call(ROOT);
    expect(list.status).toBe(200);
    expect(((await list.json()) as any).data.datasources.map((d: { name: string }) => d.name)).toContain('drivers');

    const patched = await call(`${ROOT}/drivers`, 'PATCH', { label: 'Old drivers' });
    expect(patched.status).toBe(200);
    expect(records.find((r) => r.name === 'drivers')?.label).toBe('Old drivers');

    const removed = await call(`${ROOT}/drivers`, 'DELETE');
    expect(removed.ok).toBe(true);
    expect(records.some((r) => r.name === 'drivers')).toBe(false);
  });
});
