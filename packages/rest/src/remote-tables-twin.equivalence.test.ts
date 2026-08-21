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

/**
 * The credential every request-shape case presents: authenticated (#9391) AND
 * holding `manage_platform_settings`, which the admin spelling requires as of
 * #9593.
 *
 * The entitlement is not decoration. Before #9593 the admin spelling admitted
 * any authenticated caller, so a bare session was enough to compare the two
 * answers; now an unentitled session makes the admin spelling answer 403 and
 * every case below would be comparing a 200 against a refusal — reading an
 * ADMISSION difference as a request-shape divergence, the one thing this file
 * exists not to confuse (the same reason #9391 made it wire `auth` at all).
 */
const SESSION = 'Bearer twin-session';

/**
 * [#9593] A second credential: authenticated, holding nothing. This was the
 * posture the two spellings diverged on until #9901; it now has its own
 * AGREEMENT case at the bottom of this file — both spellings refuse it, and the
 * two refusals are compared to each other.
 */
const UNENTITLED_SESSION = 'Bearer twin-session-unentitled';

/**
 * [#9901] A third credential: authenticated and holding a real permission set
 * that simply is not the one either spelling requires.
 *
 * Without it, "unentitled" in this file would only ever mean "holds no grant at
 * all", and a gate that asked whether the caller holds ANYTHING would satisfy
 * every case here. The two spellings must agree on the capability, not on the
 * existence of a grant — which is what makes the equivalence a statement about
 * `manage_platform_settings` rather than about permission sets in general.
 */
const OTHER_GRANT_SESSION = 'Bearer twin-session-other-grant';

const USERS: Record<string, string> = {
  [SESSION]: 'u_twin',
  [UNENTITLED_SESSION]: 'u_twin_plain',
  [OTHER_GRANT_SESSION]: 'u_twin_other',
};

const authService = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = USERS[headers?.get?.('authorization') ?? ''];
      return id ? { user: { id } } : null;
    },
  },
};

/** The permission set carrying the grant `u_twin` holds and `u_twin_plain` does not. */
const GRANT_SET_ID = 'ps_twin_datasource_operator';

/**
 * [#9901] A permission set that is real, non-empty, and carries neither
 * capability this family gates on — held by `u_twin_other`.
 */
const OTHER_SET_ID = 'ps_twin_org_user_admin';

/**
 * The RBAC tables `resolveAuthzContext` reads, as a fake data engine — the
 * same idiom this package's other authz fixtures use
 * (`rest-exec-ctx-principal-kind.test.ts`), and the same four-table shape the
 * admin family's own pin builds in `@objectstack/service-datasource`.
 *
 * ONE engine serves BOTH spellings: it is wired into the plugin context the
 * admin registrar resolves `objectql` from, and handed to the
 * `resolveAuthzContext` call behind the federation registrar's
 * `resolveExecutionContext`. That is deliberate and load-bearing — the two
 * spellings must read one identity AND one grant aggregation, or this file
 * could manufacture agreement (or disagreement) out of two different notions of
 * who the caller is.
 *
 * The set is deliberately not `admin_full_access`: that platform set carries
 * `manage_platform_settings` among six other capabilities, so a gate keyed on
 * platform-admin posture rather than on the capability would pass unnoticed.
 */
const SETS: Record<string, { name: string; systemPermissions: string[] }> = {
  [GRANT_SET_ID]: { name: 'twin_datasource_operator', systemPermissions: ['manage_platform_settings'] },
  // [#9901] Deliberately a DECLARED capability (`packages/spec`'s capability
  // catalog) from a different family: a set whose grants are real but
  // irrelevant here. An invented name would make this case pass for the wrong
  // reason — because nothing recognises it — rather than because the gate reads
  // the capability it names.
  [OTHER_SET_ID]: { name: 'twin_org_user_admin', systemPermissions: ['manage_org_users'] },
};

const HOLDS: Record<string, string> = {
  u_twin: GRANT_SET_ID,
  u_twin_other: OTHER_SET_ID,
  // `u_twin_plain` holds nothing, deliberately — it is not listed.
};

const makeQl = () => ({
  find: async (object: string, opts: any) => {
    const where = opts?.where ?? {};
    if (object === 'sys_user_permission_set') {
      const setId = HOLDS[where.user_id as string];
      return setId
        ? [{ id: `ups_${where.user_id}`, user_id: where.user_id, permission_set_id: setId, organization_id: null }]
        : [];
    }
    if (object === 'sys_permission_set') {
      const ids: string[] = where.id?.$in ?? [];
      return ids
        .filter((id) => id in SETS)
        .map((id) => ({
          id,
          name: SETS[id].name,
          // JSON string — the spelling SQLite hands back, which the resolver
          // parses. Pinning the stored shape keeps the fixture on the real
          // read path.
          system_permissions: JSON.stringify(SETS[id].systemPermissions),
          object_permissions: '{}',
        }));
    }
    return [];
  },
});

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
  const ql = makeQl();
  const ctx = {
    getService: (name: string) => {
      if (name === 'external-datasource') return service;
      // The admin spelling requires authentication (#9391) and resolves the
      // caller through the platform's shared resolver, so the fixture wires an
      // `auth` service that admits `SESSION` below. Without it this file would
      // compare a 200 against a 401 and read the difference as a request-shape
      // divergence — which is the one thing it exists NOT to confuse.
      if (name === 'auth') return authService;
      // [#9593] …and the admin spelling now also requires a CAPABILITY, which
      // the same resolver aggregates off the data engine. Same reasoning one
      // step further: without a grant to read, the comparison would be a 200
      // against a 403. `objectql` and `data` are one registration under two
      // names, and the registrar tries them in that order.
      if (name === 'objectql' || name === 'data') return ql;
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
      // [#9593] The SAME engine the admin spelling resolves `objectql` to,
      // stated rather than omitted. It used to be `undefined` here, which was
      // right while only a session mattered; now that one spelling reads
      // GRANTS, handing this side a different (or absent) engine would let the
      // two spellings disagree about the caller for a reason that is the
      // fixture's, not the code's. One identity function, and now one grant
      // aggregation.
      ql,
      headers,
      getSession: async (h: any) => authService.api.getSession({ headers: h }),
    });
    // [#9901] `systemPermissions` is carried through because the federation
    // spelling now READS it: its capability gate resolves the caller through
    // this resolver exactly as production does. It was already supplied here
    // while the federation spelling gated on authentication alone, which is why
    // closing that gap needed no change on this line.
    return authz.userId
      ? { userId: authz.userId, systemPermissions: authz.systemPermissions }
      : undefined;
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
 *
 * ## [#9593 → #9901] The axis diverged in the middle for one card's width
 *
 * #9593 raised the ADMIN spelling from "any authenticated caller" to
 * `manage_platform_settings` while the federation spelling still gated on
 * authentication alone (#9686 ruled the capability question out of its scope
 * and pointed it at #9901). For that interval the two spellings agreed at the
 * ends of the axis and disagreed in the middle, and the disagreement was pinned
 * here as a record of a known gap — with the standing instruction that closing
 * it should fold the row back into the agreement rather than delete the case.
 *
 * #9901 closed it (maintainer ruling, 2026-08-20, verbatim:
 * 「其他接受你的建议。」 — the federation family is NOT deliberately the
 * lower-privilege door), and this is that fold-back. The axis is one line
 * again:
 *
 *  - anonymous — both refuse `401 UNAUTHENTICATED`;
 *  - unrecognised credential — both refuse `401 UNAUTHENTICATED`;
 *  - authenticated but UNENTITLED — both refuse `403 PERMISSION_DENIED`;
 *  - authenticated AND entitled — both serve, identically.
 *
 * The middle row is asserted as an EQUIVALENCE now, exactly like the other
 * three: both spellings' status and machine-readable code are compared to each
 * other, not merely each checked against a literal. A capability gate added to
 * one spelling and not the other — or added to both with different codes —
 * fails here, whichever side it is added to, which is the property this file
 * exists for. The row keeps its own case rather than being merged into the
 * anonymous one: `401` and `403` are different facts about a caller, and a
 * single "both refuse" case could be satisfied by either.
 *
 * ⚠️ Note which capability the twins are compared on: the READ capability.
 * The federation family also carries three routes this file's operation has no
 * twin for, two of which #9901 gates on `manage_metadata` instead — that split
 * is pinned in `external-datasource-routes-auth-guard.test.ts`, since a
 * spelling with no twin has no equivalence to assert.
 */
describe('listRemoteTables twins agree on WHO may ask (#9686, #9593, #9901)', () => {
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

  it('an ENTITLED credential clears both spellings — same identity, same answer', async () => {
    // The other direction, and the one that makes the refusal cases mean
    // something: the two spellings do not agree merely by refusing everyone.
    // "Entitled" is now two facts (authenticated, and holding
    // `manage_platform_settings`), and the default credential carries both.
    const { federation, admin } = await readBoth('?schema=public');

    expect(federation.status).toBe(200);
    expect(admin.status).toBe(200);
    expect(qualified(admin)).toEqual(qualified(federation));
  });

  it('[#9901] an authenticated but UNENTITLED caller is refused identically on both spellings', async () => {
    // The row #9593 could only record as a divergence, folded back into the
    // agreement now that #9901 has closed it. It stays a case of its own
    // because the middle of the axis is a distinct fact from its ends: this
    // caller WAS read (unlike the anonymous one) and still holds nothing.
    const { federation, admin } = await readBoth('', { authorization: UNENTITLED_SESSION });

    // Status AND machine-readable code (ADR-0112 envelope) — "not 200" would be
    // satisfied by the 401 the anonymous case already covers, which would mean
    // the credential was never read.
    expect(federation.status).toBe(403);
    expect(federation.code).toBe('PERMISSION_DENIED');
    // The equivalence itself: compared to the other spelling, not to a literal,
    // so this fails whichever side drifts.
    expect(admin.status).toBe(federation.status);
    expect(admin.code).toBe(federation.code);
    // …and neither leaked the listing it refused to serve.
    expect(federation.tables).toEqual([]);
    expect(admin.tables).toEqual([]);
  });

  it('[#9901] …and the refusal is keyed on the CAPABILITY, not on merely holding some grant', async () => {
    // `u_twin_plain` holds no permission set at all, so the case above would
    // also pass against a gate that asked "does this caller hold anything?".
    // This one presents a caller who holds a real, non-empty grant that simply
    // is not `manage_platform_settings` — the posture a deployment produces the
    // moment it defines any operator set. Both spellings must still refuse, and
    // still identically.
    const { federation, admin } = await readBoth('', { authorization: OTHER_GRANT_SESSION });

    expect(federation.status).toBe(403);
    expect(federation.code).toBe('PERMISSION_DENIED');
    expect(admin.status).toBe(federation.status);
    expect(admin.code).toBe(federation.code);
    expect(federation.tables).toEqual([]);
    expect(admin.tables).toEqual([]);
  });
});
