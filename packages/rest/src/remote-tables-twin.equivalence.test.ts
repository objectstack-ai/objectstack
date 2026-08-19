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
import { resolveAuthzContext } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import {
  ExternalDatasourceService,
  registerDatasourceAdminRoutes,
} from '@objectstack/service-datasource';
import type { IntrospectedColumn, IntrospectedSchema } from '@objectstack/spec/contracts';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';

const DS = 'demo_ext';

/** One remote column, spelled in full so the fixture needs no cast to be an
 * `IntrospectedSchema` — `primaryKey` and `nullable` are both required. */
const col = (name: string, primaryKey = false): IntrospectedColumn => ({
  name,
  type: name === 'id' ? 'uuid' : 'text',
  nullable: !primaryKey,
  primaryKey,
});

/** Two remote schemas, so a `?schema=` filter has something to exclude. */
const REMOTE: IntrospectedSchema = {
  dialect: 'postgres',
  introspectedAt: '2026-08-12T00:00:00.000Z',
  tables: {
    'public.customers': {
      name: 'public.customers',
      columns: [col('id', true), col('email')],
      indexes: [],
    },
    'public.orders': {
      name: 'public.orders',
      columns: [col('id', true)],
      indexes: [],
    },
    'analytics.events': {
      name: 'analytics.events',
      columns: [col('id', true)],
      indexes: [],
    },
  },
};

/** The credential the admin spelling's authentication floor admits (#9391). */
const SESSION = 'Bearer twin-session';
const authService = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) =>
      headers?.get?.('authorization') === SESSION ? { user: { id: 'u_twin' } } : null,
  },
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
      // The admin spelling requires authentication (#9391) and resolves the
      // caller through the platform's shared resolver, so the fixture wires an
      // `auth` service that admits `SESSION` below. Without it this file would
      // compare a 200 against a 401 and read the difference as a request-shape
      // divergence — which is the one thing it exists NOT to confuse.
      if (name === 'auth') return authService;
      throw new Error(`no service: ${name}`);
    },
  } as any;
  /**
   * [#9686] Stands in for `RestServer.resolvePackageRouteExecutionContext`,
   * which is what `direct-mount-composition.ts` hands the federation registrar
   * in production. It resolves through `resolveAuthzContext` — the platform's
   * shared resolution, and the same one the admin spelling reaches through
   * `ctx` — so the two spellings under comparison read ONE identity function.
   * A fixture that hand-rolled a second notion of "authenticated" here could
   * make the twins agree by construction, which is the one thing this file
   * must not do.
   */
  const resolveExecutionContext = async (req: any) => {
    const raw: any = req?.headers;
    let headers: Headers;
    if (raw && typeof raw.get === 'function') {
      headers = raw as Headers;
    } else {
      headers = new Headers();
      for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
        if (v != null) headers.set(k, String(v));
      }
    }
    const authz = await resolveAuthzContext({
      // No data engine here, stated rather than omitted: `ql` is a required
      // member, and it is what the api-key admission path reads. This fixture
      // wires only a session, so that path resolves nothing and the session
      // path is the one under comparison.
      ql: undefined,
      headers,
      getSession: async (h: any) => authService.api.getSession({ headers: h }),
    });
    return authz.userId ? { userId: authz.userId } : undefined;
  };

  registerExternalDatasourceRoutes(server, ctx, '/api/v1', { resolveExecutionContext });
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
  /** [#9686] The machine-readable refusal code, when the answer is a refusal. */
  code?: string;
}

/** Drive one spelling and read back the table set it answers with. */
async function read(
  app: any,
  spelling: keyof typeof SPELLING,
  qs: string,
  headers: Record<string, string> = { authorization: SESSION },
): Promise<Reading> {
  const res = await app.fetch(new Request(`http://local${SPELLING[spelling](qs)}`, { headers }));
  const body = (await res.json()) as {
    success: boolean;
    data?: { tables?: Reading['tables'] };
    error?: { code?: string };
  };
  return { status: res.status, tables: body.data?.tables ?? [], code: body.error?.code };
}

/** Both spellings, same query — the comparison every case makes. */
async function readBoth(
  qs: string,
  headers?: Record<string, string>,
): Promise<{ federation: Reading; admin: Reading }> {
  const app = mountBoth();
  return {
    federation: await read(app, 'federation', qs, headers),
    admin: await read(app, 'admin', qs, headers),
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

/**
 * [#9686] The same equivalence, on the REFUSAL axis.
 *
 * #4249 gave the two spellings one failure contract and #7955 one request
 * shape; what neither covered is who is allowed to ASK. That axis was silently
 * false on `main` between the two guards landing: the admin spelling answered
 * 401 to an anonymous caller while the federation spelling served it — one
 * operation, two admission policies, and no case in this file could see it
 * because every case above presents a credential.
 *
 * The cases below drive both spellings with NO credential and compare the two
 * answers, exactly as the request-shape cases compare table sets. A guard added
 * to one spelling and not the other now fails here, whichever side it is added
 * to — which is the property the equivalence is for.
 */
describe('listRemoteTables twins agree on WHO may ask (#9686)', () => {
  it('an anonymous caller is refused identically on both spellings', async () => {
    const { federation, admin } = await readBoth('', {});

    expect(federation.status).toBe(401);
    expect(federation.code).toBe('UNAUTHENTICATED');
    // Not "both non-200": a 503 from an unwired service would satisfy that on
    // either side and say nothing about admission.
    expect(admin.status).toBe(federation.status);
    expect(admin.code).toBe(federation.code);
    // …and neither leaked the listing it refused to serve.
    expect(federation.tables).toEqual([]);
    expect(admin.tables).toEqual([]);
  });

  it('a credential the deployment does not admit is refused identically on both spellings', async () => {
    const { federation, admin } = await readBoth('', { authorization: 'Bearer not-the-session' });

    expect(federation.status).toBe(401);
    expect(federation.code).toBe('UNAUTHENTICATED');
    expect(admin.status).toBe(federation.status);
    expect(admin.code).toBe(federation.code);
  });

  it('the credential that clears one spelling clears the other — same identity, same answer', async () => {
    // The other direction, and the one that makes the refusal cases mean
    // something: the two spellings do not agree merely by refusing everyone.
    const { federation, admin } = await readBoth('?schema=public');

    expect(federation.status).toBe(200);
    expect(admin.status).toBe(200);
    expect(qualified(admin)).toEqual(qualified(federation));
  });
});
