// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `listRemoteTables` REQUEST-shape equivalence across its two live spellings
 * (#7955).
 *
 * `IExternalDatasourceService.listRemoteTables` is reachable through two
 * mounted routes, in two packages:
 *
 *   GET /api/v1/datasources/:name/external/tables   ← this package, federation
 *   GET /api/v1/datasources/:name/remote-tables     ← @objectstack/service-datasource, admin
 *
 * They are not near-duplicates that happen to look alike: both resolve the SAME
 * `external-datasource` service slot and call the SAME method with the same
 * datasource name. #4249 already reconciled what happens when that one call
 * THROWS ("One operation, one failure contract now, on both paths",
 * `external-datasource-routes.ts`). What was never compared is the other half —
 * what the two paths do with the REQUEST — and #7955 is the residue: the admin
 * spelling never read `req.query`, so `?schema=public` came back as the
 * UNFILTERED listing there and the filtered one here. Not an error, not the
 * filter: the quietest form of "declared ≠ enforced".
 *
 * ## Why this test is here, and why it drives BOTH routes
 *
 * A test that exercised only the fixed route could not fail if the twins drift
 * apart again — it would pin one path's behaviour and say nothing about the
 * relationship, which IS the invariant. So every case below issues the same
 * query to both spellings and asserts the two answers are equal, against ONE
 * service instance mounted on ONE server: the difference between the readings
 * can then only come from the two handlers.
 *
 * It lives in `packages/rest` because that is the side that can reach both
 * halves without widening anyone's public API: `registerDatasourceAdminRoutes`
 * is exported from `@objectstack/service-datasource`'s index, while
 * `registerExternalDatasourceRoutes` is deliberately internal here (it is
 * composed by `rest-api-plugin.ts`, not published). The dependency is dev-only
 * and points rest → service-datasource, which is not a cycle: that package
 * depends on `core`/`spec`/`types` and never on this one. Same reasoning the
 * client-side ledger guard used when it chose its side (`service-route-ledger-
 * coverage.test.ts`, "a service→client package edge would be backwards").
 *
 * The service under the routes is the REAL `ExternalDatasourceService` over a
 * fake introspector, not a `vi.fn()` recording its arguments. A mock would only
 * prove the admin handler now passes an options bag; what the card asks is that
 * the two routes return the same SET, which takes the real filter.
 *
 * Driven through the real `HonoHttpServer` — the adapter `os serve` mounts — so
 * `?schema=` is parsed by the code that parses it in production. That matters
 * for the last case: a repeated key reaches a handler as an ARRAY, and only a
 * real adapter produces one.
 */

import { describe, it, expect } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import {
  ExternalDatasourceService,
  registerDatasourceAdminRoutes,
} from '@objectstack/service-datasource';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';

const DS = 'demo_ext';

/** Two remote schemas, so a `?schema=` filter has something to exclude. */
const REMOTE: IntrospectedSchema = {
  dialect: 'postgres',
  introspectedAt: '2026-08-12T00:00:00.000Z',
  tables: {
    'public.customers': {
      name: 'public.customers',
      columns: [
        { name: 'id', type: 'uuid', nullable: false },
        { name: 'email', type: 'text', nullable: true },
      ],
      indexes: [],
    },
    'public.orders': {
      name: 'public.orders',
      columns: [{ name: 'id', type: 'uuid', nullable: false }],
      indexes: [],
    },
    'analytics.events': {
      name: 'analytics.events',
      columns: [{ name: 'id', type: 'uuid', nullable: false }],
      indexes: [],
    },
  } as IntrospectedSchema['tables'],
};

/**
 * One server, one service, both registrars — the point of the fixture.
 *
 * `registerDatasourceAdminRoutes` also mounts the datasource-lifecycle family,
 * whose services are absent here; those routes answer 503 and are simply never
 * driven. The two paths under test both resolve `external-datasource`, which is
 * the one service wired.
 */
function mountBoth() {
  const service = new ExternalDatasourceService({
    introspect: async () => REMOTE,
    getDatasource: async (name: string) => ({ name }),
    getObject: async () => undefined,
    listObjects: async () => [],
  });
  const server = new HonoHttpServer(0);
  const ctx = {
    getService: (name: string) => {
      if (name === 'external-datasource') return service;
      throw new Error(`no service: ${name}`);
    },
  } as any;
  registerExternalDatasourceRoutes(server, ctx, '/api/v1');
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  return server.getRawApp();
}

/** The two wire spellings of the one operation, keyed by how they are named. */
const SPELLING = {
  federation: (qs: string) => `/api/v1/datasources/${DS}/external/tables${qs}`,
  admin: (qs: string) => `/api/v1/datasources/${DS}/remote-tables${qs}`,
} as const;

interface Reading {
  status: number;
  tables: Array<{ schema?: string; name: string }>;
}

/** Drive one spelling and read back the table set it answers with. */
async function read(app: any, spelling: keyof typeof SPELLING, qs: string): Promise<Reading> {
  const res = await app.fetch(new Request(`http://local${SPELLING[spelling](qs)}`));
  const body = (await res.json()) as { success: boolean; data?: { tables?: Reading['tables'] } };
  return { status: res.status, tables: body.data?.tables ?? [] };
}

/** Both spellings, same query — the comparison every case makes. */
async function readBoth(qs: string): Promise<{ federation: Reading; admin: Reading }> {
  const app = mountBoth();
  return {
    federation: await read(app, 'federation', qs),
    admin: await read(app, 'admin', qs),
  };
}

const qualified = (r: Reading) => r.tables.map((t) => `${t.schema}.${t.name}`).sort();

describe('listRemoteTables twins agree on the request shape (#7955)', () => {
  it('?schema= returns the SAME filtered set on both spellings', async () => {
    const { federation, admin } = await readBoth('?schema=public');

    expect(federation.status).toBe(200);
    expect(admin.status).toBe(200);
    // The filter really filtered — otherwise "equal" could mean "both unfiltered",
    // which is precisely the pre-#7955 reading on one of the two paths.
    expect(qualified(federation)).toEqual(['public.customers', 'public.orders']);
    expect(qualified(admin)).toEqual(qualified(federation));
  });

  it('no ?schema= returns the SAME unfiltered set on both spellings', async () => {
    const { federation, admin } = await readBoth('');

    expect(qualified(federation)).toEqual([
      'analytics.events',
      'public.customers',
      'public.orders',
    ]);
    // The absent-parameter arm is not a formality: a fix that filtered
    // unconditionally would satisfy the case above and break every existing
    // caller of the admin spelling, which has never passed one.
    expect(qualified(admin)).toEqual(qualified(federation));
  });

  it('a ?schema= that matches nothing returns the SAME empty set on both spellings', async () => {
    const { federation, admin } = await readBoth('?schema=nonexistent');

    expect(federation.tables).toEqual([]);
    expect(admin.tables).toEqual([]);
    expect(admin.status).toBe(federation.status);
  });

  it('a repeated ?schema= degrades to no filter on both spellings, identically', async () => {
    // The adapter surfaces a repeated key as an array; `typeof … === 'string'`
    // is what both handlers do with it, so both fall back to the unfiltered
    // listing rather than filtering by an arbitrary one of the two. Whether such
    // a request should be REFUSED instead is #7606's global ingress question —
    // this case pins that the twins answer it the SAME way today, whatever that
    // card decides tomorrow.
    const { federation, admin } = await readBoth('?schema=public&schema=analytics');

    expect(qualified(federation)).toEqual([
      'analytics.events',
      'public.customers',
      'public.orders',
    ]);
    expect(qualified(admin)).toEqual(qualified(federation));
    expect(admin.status).toBe(federation.status);
  });

  it('an empty ?schema= is no filter on both spellings, identically', async () => {
    // `?schema=` parses to the empty string, which is a string — so the
    // coercion keeps it and the service's own `opts?.schema &&` guard is what
    // treats it as "no filter". Both spellings inherit that from the one
    // service, and this pins that neither route second-guesses it.
    const { federation, admin } = await readBoth('?schema=');

    expect(qualified(federation)).toEqual([
      'analytics.events',
      'public.customers',
      'public.orders',
    ]);
    expect(qualified(admin)).toEqual(qualified(federation));
  });
});
