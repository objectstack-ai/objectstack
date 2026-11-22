// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#4828] The REST `/discovery` half of the conformance gate — and the one that
// matters most, because this is the shape a browser client actually receives.
//
// It is a COMPOSED shape: `getDiscovery()` (metadata-protocol) builds the base,
// then `registerDiscoveryEndpoints` overrides `routes`, ANDs
// `capabilities.transactionalBatch` with its own `api.enableBatch`, and attaches
// `scoping`. It no longer overrides `version` — see the #11292 suite at the
// bottom, which pins the served value's PROVENANCE. Neither producer alone could be checked against the schema and be
// meaningful here, so this test drives the REAL protocol implementation through
// the REAL handler rather than the `createMockProtocol()` double the other
// rest tests use — a mock would only prove the mock's shape conforms.
//
// Before this issue the composed shape could not satisfy `DiscoverySchema` at
// all: `name`/`environment`/`locale` were absent (required), and `scoping` was
// undeclared.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ApiRoutesSchema,
  DiscoverySchema,
  GetDiscoveryResponseSchema,
  WELL_KNOWN_CAPABILITY_KEYS,
} from '@objectstack/spec/api';
import * as specApi from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestrictionProfileNodeType, RestrictionProfileSchema } from '@objectstack/spec/system';
import { createRequire } from 'node:module';
// [#36198] The real router `os serve` mounts, for the on-the-wire not-found reading.
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
// Paid during collection (`check:test-source-alias`): `rest-server.ts` reaches it lazily.
import '@objectstack/objectql';
import { RestServer } from './rest-server.js';
import { REST_ROUTE_LEDGER } from './rest-route-ledger.js';

/** The keys the protocol declares for a discovery response (canonical + declared alias). */
function declaredResponseKeys(): Set<string> {
  return new Set(Object.keys((GetDiscoveryResponseSchema as any).shape));
}

/**
 * [#5679] The keys `ApiRoutesSchema` declares INSIDE `routes`.
 *
 * The #4828 gate was deliberately pinned at the top level, and `routes.mcp`
 * lived in exactly the blind spot that left: emitted here, read by objectui,
 * declared nowhere. Note which assertion catches it — `DiscoverySchema
 * .safeParse()` above stays GREEN on an undeclared `routes.mcp`, because
 * `ApiRoutesSchema` is a plain `z.object` and zod strips unknown keys. Only a
 * key-set check can see it, one level down exactly as at the top.
 *
 * Extended one level, not recursed: this is the level with a measured
 * producer/consumer pair. Full recursion is still out of scope (#4828), and
 * `capabilities` / `services` are `z.record`s whose keys are open by design.
 */
function declaredRouteKeys(): Set<string> {
  return new Set(Object.keys((ApiRoutesSchema as any).shape));
}

/** [#5672] The capability vocabulary, derived from the spec — never hand-listed. */
function declaredCapabilityKeys(): Set<string> {
  return new Set(WELL_KNOWN_CAPABILITY_KEYS as readonly string[]);
}

function createMockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * A REST server over the REAL `getDiscovery()` producer.
 *
 * `scoping` selects the mount under test: unscoped `/api/v1` (the default
 * deployment) or the environment-scoped `/api/v1/environments/:environmentId`
 * one, which is the only mount that can report `scoped: true`.
 */
function buildDiscovery(opts: { scoped?: boolean; apiVersion?: string } = {}) {
  const engine = {
    registry: {
      getObject: (_n: string) => undefined,
      getRegisteredTypes: () => [],
    },
  };
  const protocol = new ObjectStackProtocolImplementation(engine as any, () => new Map());
  const config: any = {
    api: {
      requireAuth: false,
      ...(opts.apiVersion ? { version: opts.apiVersion } : {}),
      ...(opts.scoped ? { enableProjectScoping: true, projectResolution: 'auto' } : {}),
    },
  };
  const rest = new RestServer(createMockServer() as any, protocol as any, config);
  rest.registerRoutes();

  // The mounted segment is `api.version`'s job (`getApiBasePath()`), which is
  // exactly why it is not the identity answer — see the #11292 suite below.
  const version = opts.apiVersion ?? 'v1';
  const path = opts.scoped
    ? `/api/${version}/environments/:environmentId/discovery`
    : `/api/${version}/discovery`;
  const entry = rest.getRouteManager().get('GET', path);
  if (!entry) throw new Error(`discovery route not registered at ${path}`);
  return {
    handler: entry.handler as (req: any, res: any) => Promise<void>,
    /** The REAL producer this server composes over — the provenance the wire answer must track. */
    protocol,
  };
}

function discoveryHandler(opts: { scoped?: boolean; apiVersion?: string } = {}) {
  return buildDiscovery(opts).handler;
}

async function invoke(
  handler: (req: any, res: any) => Promise<void>,
  params: Record<string, string> = {},
) {
  let body: any;
  const res: any = { json: (b: any) => { body = b; }, status: () => res };
  await handler({ params }, res);
  return body;
}

describe('[#4828] the REST /discovery live shape conforms to DiscoverySchema', () => {
  it('satisfies the canonical DiscoverySchema', async () => {
    const body = await invoke(discoveryHandler());

    const result = DiscoverySchema.safeParse(body);
    expect(
      result.success ? [] : result.error.issues.map(i => `${i.path.join('.')}: ${i.code}`),
      'the REST /discovery body must satisfy the canonical DiscoverySchema',
    ).toEqual([]);
  });

  it('emits NO key the protocol does not declare', async () => {
    const body = await invoke(discoveryHandler());

    const declared = declaredResponseKeys();
    const undeclared = Object.keys(body).filter(k => !declared.has(k));
    expect(undeclared, 'undeclared top-level keys on the REST /discovery body').toEqual([]);
  });

  it('[#5679] emits NO `routes` key the schema does not declare', async () => {
    const body = await invoke(discoveryHandler());

    const declared = declaredRouteKeys();
    const undeclared = Object.keys(body.routes).filter(k => !declared.has(k));
    expect(undeclared, 'undeclared keys inside `routes` on the REST /discovery body').toEqual([]);
  });

  it('[#5679] anti-vacuity: this mount really does advertise `routes.mcp`', async () => {
    const body = await invoke(discoveryHandler());

    // Without this the gate above would pass for the empty reason. MCP is
    // default-on and the probe returns `null` (cannot probe) with no kernel
    // manager and no serviceExistsProvider, so the fail-open branch advertises.
    expect(body.routes.mcp).toBe('/api/v1/mcp');
    expect(declaredRouteKeys().has('mcp')).toBe(true);
  });

  it('[#5679] advertises the UNSCOPED /mcp even from the scoped mount', async () => {
    const body = await invoke(
      discoveryHandler({ scoped: true }),
      { environmentId: 'env_alpha' },
    );

    // The /mcp route is mounted bare, so the advertised path must NOT pick up
    // the environment segment the sibling routes carry. Measured, then declared.
    expect(body.routes.data).toBe('/api/v1/environments/env_alpha/data');
    expect(body.routes.mcp).toBe('/api/v1/mcp');
  });

  it('[#5679] omits the key entirely when the env opts out of MCP', async () => {
    const old = process.env.OS_MCP_SERVER_ENABLED;
    process.env.OS_MCP_SERVER_ENABLED = 'false';
    try {
      const body = await invoke(discoveryHandler());

      // `optional`, not `nullable`: the emit site DELETES the key, so a
      // consumer sees an absent key rather than an explicit null.
      expect(Object.prototype.hasOwnProperty.call(body.routes, 'mcp')).toBe(false);
      expect(DiscoverySchema.safeParse(body).success).toBe(true);
    } finally {
      if (old === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
      else process.env.OS_MCP_SERVER_ENABLED = old;
    }
  });

  it('fills the three required identity keys the schema declares', async () => {
    const body = await invoke(discoveryHandler());

    expect(body.name).toBe('ObjectStack API');
    expect(['production', 'sandbox', 'development']).toContain(body.environment);
    expect(body.locale).toEqual({ default: 'en', supported: ['en'], timezone: 'UTC' });
  });

  it('declares `scoping` — reported, and now schema-checked, on the unscoped mount', async () => {
    const body = await invoke(discoveryHandler());

    expect(body.scoping).toEqual({
      enabled: false,
      resolution: 'auto',
      scoped: false,
      environmentId: undefined,
    });
  });

  it('reports the resolved environmentId on the scoped mount', async () => {
    const body = await invoke(
      discoveryHandler({ scoped: true }),
      { environmentId: 'env_alpha' },
    );

    expect(body.scoping).toEqual({
      enabled: true,
      resolution: 'auto',
      scoped: true,
      environmentId: 'env_alpha',
    });
    // Still schema-clean with every `scoping` sub-key populated.
    expect(DiscoverySchema.safeParse(body).success).toBe(true);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // [#5672] Fullness — on the COMPOSED shape, which is the one a browser gets
  // ═════════════════════════════════════════════════════════════════════════
  //
  // This producer composes over `getDiscovery()` and then overwrites exactly
  // one capability entry (`transactionalBatch`, ANDed with `api.enableBatch`).
  // So the vocabulary reaches the wire through it, and the one entry it
  // rewrites is the one most at risk of being rewritten into a different shape
  // — `caps.transactionalBatch = { enabled, description }` is a whole-entry
  // assignment, not a merge.
  describe('[#5672] the capability vocabulary survives composition, in full', () => {
    it('emits EVERY declared capability key on the composed body', async () => {
      const body = await invoke(discoveryHandler());

      const missing = [...declaredCapabilityKeys()].filter(
        k => !Object.prototype.hasOwnProperty.call(body.capabilities, k),
      );
      expect(missing, 'capability keys the composed REST /discovery body fails to emit').toEqual([]);
    });

    it('reports every capability with a boolean `enabled`', async () => {
      const body = await invoke(discoveryHandler());

      const nonBoolean = Object.entries(body.capabilities as Record<string, any>)
        .filter(([, v]) => typeof v?.enabled !== 'boolean')
        .map(([k, v]) => `${k}: ${typeof v?.enabled}`);
      expect(nonBoolean, 'capability entries whose `enabled` is not a boolean').toEqual([]);
    });

    it('emits NO capability key the vocabulary does not declare', async () => {
      const body = await invoke(discoveryHandler());

      const declared = declaredCapabilityKeys();
      const undeclared = Object.keys(body.capabilities).filter(k => !declared.has(k));
      expect(undeclared, 'undeclared keys inside `capabilities` on the composed body').toEqual([]);
    });

    it("the REST layer's own AND rewrites `transactionalBatch` without dropping it out of the vocabulary", async () => {
      const body = await invoke(discoveryHandler());

      // Anti-vacuity for the three above: the composition really does run here
      // (the entry carries the REST layer's description, which `getDiscovery()`
      // never attaches), and it still lands as a well-formed vocabulary entry.
      expect(typeof body.capabilities.transactionalBatch.enabled).toBe('boolean');
      expect(body.capabilities.transactionalBatch.description).toMatch(/Atomic cross-object batch/);
    });
  });

  it('keeps `capabilities` as the one capability key — no `features`, no `endpoints`', async () => {
    const body = await invoke(discoveryHandler());

    expect(body).not.toHaveProperty('features');
    expect(body).not.toHaveProperty('endpoints');
    // The REST layer's own AND of the runtime verdict with `api.enableBatch`
    // still lands inside `capabilities` (#3298) — pinned so the retirement
    // cannot take the composed capability with it.
    expect(body.capabilities.transactionalBatch).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // [#5791] The ledger row points AT this suite
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // `rest-route-ledger.ts`'s `GET /api/v1/discovery` row is one of the two
  // first-ever filled `responseSchema` values. The field may only be written
  // where the double assertion above already runs; that rule lives in a JSDoc,
  // which cannot fail a build, so the loop is closed here in the file the row
  // names. `packages/client/src/route-ledger-response-schema.test.ts` carries
  // the other half (every name across all five ledgers resolves).
  describe('[#5791] the ledger declares the schema this suite parses with', () => {
    it('names `DiscoverySchema`, resolving to the very object asserted above', () => {
      const row = REST_ROUTE_LEDGER.find(e => e.route === 'GET /api/v1/discovery');
      expect(row, 'the REST discovery row must exist in REST_ROUTE_LEDGER').toBeDefined();
      expect(row!.responseSchema).toBe('DiscoverySchema');

      // Identity, not just resolvability: a name resolving to some OTHER schema
      // would satisfy the client-side resolver and still describe the wrong
      // contract.
      expect((specApi as unknown as Record<string, unknown>)[row!.responseSchema!])
        .toBe(DiscoverySchema);
    });

    it('describes the WHOLE BODY here — this mount answers bare, no envelope', async () => {
      // The counterpart of the dispatcher's pin. `responseSchema` is defined
      // against the response PAYLOAD, which lands at two different depths for
      // the two discovery routes: `res.json(discovery)` here, so the named
      // schema is a claim about the entire body; `{ success, data }` on the
      // dispatcher, where the same name claims only `data`.
      const body = await invoke(discoveryHandler());

      expect(DiscoverySchema.safeParse(body).success).toBe(true);
      expect(body).not.toHaveProperty('success');
      expect(body).not.toHaveProperty('data');
    });

    it('leaves the bare-base alias UNFILLED — it shares the handler but not the coverage', () => {
      // `GET /api/v1` is registered with this very `discoveryHandler` closure,
      // so "same handler, therefore same shape" is tempting. It is also an
      // argument about the code rather than a measurement of it, which is the
      // substitution #3877 was opened about — and this suite resolves the
      // handler at `/api/v1/discovery`, so the alias has no coverage of its own.
      // Fill it in the PR that drives it; changing this expectation without
      // adding that drive is the mistake.
      const alias = REST_ROUTE_LEDGER.find(e => e.route === 'GET /api/v1');
      expect(alias, 'the bare-base discovery alias row must exist').toBeDefined();
      expect(
        alias!.responseSchema,
        'GET /api/v1 must not declare a responseSchema until this suite (or another) '
          + 'drives that mount — no coverage, no fill (#5791).',
      ).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // [#11292] `version` is the PRODUCER's — provenance, pinned without a literal
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // This seam used to run `discovery.version = this.config.api.version` one
  // line after calling the producer, so the wire answer was the MOUNTED PATH
  // SEGMENT (`'v1'` by default) — the string the caller had just typed to reach
  // the endpoint. `DiscoverySchema` declares `version` under "System Identity"
  // next to `name` and `environment`, and the #10993 ruling (which commits
  // 98ea3443f and 376c70f98 landed) settled that as the SERVING ARTIFACT's version.
  //
  // Every assertion below pins PROVENANCE, never a literal version string: the
  // wire answer is compared against the producer's own answer, or against a
  // stamp this test injects. A pin spelling `'1.0.0'` would rot at the next
  // release and would re-create the class #11295 is filed against.
  describe("[#11292] the served `version` is the producer's, not the mounted API version", () => {
    it('tracks the producer when the deployment stamps OS_RUNTIME_VERSION', async () => {
      // `resolveDiscoveryVersion()` reads the stamp LIVE (documented in
      // `metadata-protocol/src/discovery-version.ts`), so a value injected here
      // must appear on the wire. This is the provenance assertion: the sentinel
      // exists nowhere in the REST layer, so it can only have come through
      // `getDiscovery()`.
      const old = process.env.OS_RUNTIME_VERSION;
      process.env.OS_RUNTIME_VERSION = '9.9.9-provenance-sentinel';
      try {
        const body = await invoke(discoveryHandler());

        expect(body.version).toBe('9.9.9-provenance-sentinel');
        expect(DiscoverySchema.safeParse(body).success).toBe(true);
      } finally {
        if (old === undefined) delete process.env.OS_RUNTIME_VERSION;
        else process.env.OS_RUNTIME_VERSION = old;
      }
    });

    it('agrees with the producer called directly, whatever the producer derives', async () => {
      // No stamp: the producer falls through to its own package version. The
      // assertion still names no literal — it asks only that the two answers
      // are the SAME answer, which is the whole content of "the REST seam does
      // not rewrite this field".
      const { handler, protocol } = buildDiscovery();

      const body = await invoke(handler);
      const direct: any = await (protocol as any).getDiscovery();

      expect(body.version).toBe(direct.version);
      expect(typeof body.version).toBe('string');
      expect(body.version.length).toBeGreaterThan(0);
    });

    it('answers the producer even when `api.version` is set to something else', async () => {
      // The sharp edge, stated as a measurement. `api.version` still does its
      // real job — it builds the mount — and that job is visible in the SAME
      // document, on `routes`. What it no longer does is answer the identity
      // question.
      const { handler, protocol } = buildDiscovery({ apiVersion: 'v9' });

      const body = await invoke(handler);
      const direct: any = await (protocol as any).getDiscovery();

      // Anti-vacuity: `api.version` really is 'v9' on this server, and really
      // does drive the mounted path. Without this, the assertion below could
      // pass on a server where the option was silently ignored.
      expect(body.routes.data).toBe('/api/v9/data');

      expect(body.version).toBe(direct.version);
      expect(body.version).not.toBe('v9');
    });

    it('does not answer the mounted segment on the scoped mount either', async () => {
      // The scoped mount runs the same closure but resolves a per-request
      // protocol, so it is a second path to the same field.
      const { handler, protocol } = buildDiscovery({ scoped: true, apiVersion: 'v9' });

      const body = await invoke(handler, { environmentId: 'env_alpha' });
      const direct: any = await (protocol as any).getDiscovery();

      expect(body.routes.data).toBe('/api/v9/environments/env_alpha/data');
      expect(body.version).toBe(direct.version);
      expect(body.version).not.toBe('v9');
    });
  });
});

/**
 * [#34774] `GET {basePath}/discovery/restriction-profile`, the route
 * `os validate --target <url>` reads: its URL reader takes a 2xx JSON body in
 * the `{ success: true, data }` envelope, and parses `data` with
 * `RestrictionProfileSchema`, as here.
 */
describe('[#34774] the open runtime serves the restriction profile the CLI reads', () => {
  const SPEC_VERSION = (createRequire(import.meta.url)('@objectstack/spec/package.json') as { version: string }).version;

  /**
   * Drives the route, which is mounted on the unscoped base only (#36198, the
   * suite below). `scoped` mounts the environment-scoped base beside it.
   */
  async function served(scoped: boolean, req: any = {}) {
    const rest = new RestServer(createMockServer() as any, {} as any, {
      api: { requireAuth: false, ...(scoped ? { enableProjectScoping: true, projectResolution: 'auto' } : {}) },
    } as any);
    rest.registerRoutes();
    const handler = rest.getRouteManager().get('GET', '/api/v1/discovery/restriction-profile')!.handler as (req: any, res: any) => Promise<void>;
    let body: any;
    let status = 200;
    const res: any = { json: (b: any) => { body = b; }, status: (s: number) => { status = s; return res; } };
    await handler(req, res);
    return { status, body };
  }

  it('answers { success: true, data }, with or without the scoped base mounted beside it: data a profile that restricts nothing and names the versions run', async () => {
    for (const scoped of [false, true]) {
      const { status, body } = await served(scoped);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const parsed = RestrictionProfileSchema.safeParse(body.data);
      expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
      expect(body.data).toEqual({
        allowCode: true,
        allowSandboxedJs: true,
        allowScheduledAutomation: true,
        allowedFlowNodeTypes: [...RestrictionProfileNodeType.options],
        versions: { spec: SPEC_VERSION, skills: SPEC_VERSION },
      });
    }
  });

  it('reads no query parameter: an unknown one is refused 400 VALIDATION_ERROR', async () => {
    const { status, body } = await served(false, { query: { environment: 'prod' } });
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

/**
 * [#36198] The restriction profile is mounted on the UNSCOPED base only
 * (ADR-0138 D2, as amended 2026-11-22). The handler reads no host input, so
 * its environment-scoped twin answered the constant open profile for any
 * environment id, on a host that enforces a narrower one. Nothing read the
 * twin, so it is no longer mounted:
 *
 *  - NOT REGISTERED on the scoped base: not in the route table the server
 *    reports (`getRoutes()`), not in the route manager's own lookup, and not
 *    handed to the host's `IHttpServer`, under any verb.
 *  - THE UNSCOPED ROUTE STAYS wherever the unscoped base is mounted; the suite
 *    above pins what it answers there.
 *  - `required` registers the scoped base alone, so such a server mounts no
 *    restriction-profile route.
 *  - ON THE WIRE, through the real `HonoHttpServer` router: a request to the
 *    scoped path meets the host's own not-found answer and carries no profile.
 */
describe('[#36198] the restriction profile is mounted on the unscoped base only', () => {
  const UNSCOPED_BASE = '/api/v1';
  const SCOPED_BASE = '/api/v1/environments/:environmentId';
  const PROFILE = '/discovery/restriction-profile';
  /** Each HTTP method, with the `IHttpServer` member that mounts it. */
  const VERBS = { GET: 'get', POST: 'post', PUT: 'put', DELETE: 'delete', PATCH: 'patch' } as const;
  const METHODS = Object.keys(VERBS) as Array<keyof typeof VERBS>;
  const NONE = { reported: [], managed: [], host: [] };
  const GET_ONLY = { reported: ['GET'], managed: ['GET'], host: ['GET'] };

  /** The verbs a path is registered under on a scoped server, read three ways. */
  function registrations(projectResolution: 'auto' | 'optional' | 'required') {
    const httpServer = createMockServer();
    const rest = new RestServer(httpServer as any, {} as any, {
      api: { requireAuth: false, enableProjectScoping: true, projectResolution },
    } as any);
    rest.registerRoutes();
    return (path: string) => ({
      reported: rest.getRoutes().filter((r) => r.path === path).map((r) => r.method.toUpperCase()),
      managed: METHODS.filter((method) => rest.getRouteManager().get(method, path)),
      host: METHODS.filter((method) => httpServer[VERBS[method]].mock.calls.some((call) => call[0] === path)),
    });
  }

  for (const projectResolution of ['auto', 'optional'] as const) {
    it(`${projectResolution}: the scoped base carries no restriction-profile route, and the unscoped route stays`, () => {
      const at = registrations(projectResolution);
      // CONTROL: the scoped base is mounted and its discovery document is on
      // it, so the absence below is read from a populated mount.
      expect(at(`${SCOPED_BASE}/discovery`)).toEqual(GET_ONLY);
      expect(at(`${SCOPED_BASE}${PROFILE}`)).toEqual(NONE);
      expect(at(`${UNSCOPED_BASE}${PROFILE}`)).toEqual(GET_ONLY);
    });
  }

  it('required: only the scoped base is mounted, so no restriction-profile route is', () => {
    const at = registrations('required');
    // CONTROL: the scoped base is mounted, and the unscoped one is not.
    expect(at(`${SCOPED_BASE}/discovery`)).toEqual(GET_ONLY);
    expect(at(`${UNSCOPED_BASE}/discovery`)).toEqual(NONE);
    expect(at(`${SCOPED_BASE}${PROFILE}`)).toEqual(NONE);
    expect(at(`${UNSCOPED_BASE}${PROFILE}`)).toEqual(NONE);
  });

  it('on the wire: the scoped path meets the not-found answer, and the unscoped route answers the profile', async () => {
    const server = new HonoHttpServer(0);
    const protocol = {
      getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    };
    const rest = new RestServer(server as any, protocol as any, {
      api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'auto' },
    } as any);
    rest.registerRoutes();
    const get = async (path: string) => {
      const res: Response = await server.getRawApp().fetch(new Request(`http://local${path}`));
      const body: any = await res.json().catch(() => undefined);
      return { status: res.status, body };
    };

    // CONTROL: the scoped base answers on this router, so the 404 below is
    // about the route, not about the mount.
    expect((await get('/api/v1/environments/env_alpha/discovery')).status).toBe(200);

    const twin = await get('/api/v1/environments/env_alpha/discovery/restriction-profile');
    expect(twin.status).toBe(404);
    expect(twin.body?.data).toBeUndefined();

    const unscoped = await get('/api/v1/discovery/restriction-profile');
    expect(unscoped.status).toBe(200);
    expect(unscoped.body?.success).toBe(true);
    expect(RestrictionProfileSchema.safeParse(unscoped.body?.data).success).toBe(true);
  });
});

describe('[#34774] the restriction profile when the spec manifest is unreadable', () => {
  afterEach(() => { vi.doUnmock('module'); vi.resetModules(); });

  it('answers 503 SERVICE_UNAVAILABLE and publishes no profile', async () => {
    vi.resetModules(); // a fresh module-level version cache
    vi.doMock('module', async (importOriginal) => {
      const real: any = await importOriginal();
      const createRequire = (url: any) => {
        const req = real.createRequire(url);
        return Object.assign((id: string) => {
          if (id === '@objectstack/spec/package.json') throw new Error('manifest unreadable');
          return req(id);
        }, req);
      };
      return { ...real, default: { ...real, createRequire }, createRequire };
    });
    const { RestServer: FreshRestServer } = await import('./rest-server.js');
    const rest = new FreshRestServer(createMockServer() as any, {} as any, { api: {} } as any);
    rest.registerRoutes();
    let body: any;
    let status = 200;
    const res: any = { json: (b: any) => { body = b; }, status: (s: number) => { status = s; return res; } };
    await rest.getRouteManager().get('GET', '/api/v1/discovery/restriction-profile')!.handler({} as any, res);
    expect(status).toBe(503);
    expect(body.code).toBe('SERVICE_UNAVAILABLE'); // `sendDeclaredFault`'s flat dialect
    expect(body.data).toBeUndefined();
  });
});
