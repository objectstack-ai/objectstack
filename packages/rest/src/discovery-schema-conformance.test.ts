// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#4828] The REST `/discovery` half of the conformance gate — and the one that
// matters most, because this is the shape a browser client actually receives.
//
// It is a COMPOSED shape: `getDiscovery()` (metadata-protocol) builds the base,
// then `registerDiscoveryEndpoints` overrides `version` and `routes`, ANDs
// `capabilities.transactionalBatch` with its own `api.enableBatch`, and attaches
// `scoping`. Neither producer alone could be checked against the schema and be
// meaningful here, so this test drives the REAL protocol implementation through
// the REAL handler rather than the `createMockProtocol()` double the other
// rest tests use — a mock would only prove the mock's shape conforms.
//
// Before this issue the composed shape could not satisfy `DiscoverySchema` at
// all: `name`/`environment`/`locale` were absent (required), and `scoping` was
// undeclared.

import { describe, it, expect, vi } from 'vitest';
import { ApiRoutesSchema, DiscoverySchema, GetDiscoveryResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

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
function discoveryHandler(opts: { scoped?: boolean } = {}) {
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
      ...(opts.scoped ? { enableProjectScoping: true, projectResolution: 'auto' } : {}),
    },
  };
  const rest = new RestServer(createMockServer() as any, protocol as any, config);
  rest.registerRoutes();

  const path = opts.scoped
    ? '/api/v1/environments/:environmentId/discovery'
    : '/api/v1/discovery';
  const entry = rest.getRouteManager().get('GET', path);
  if (!entry) throw new Error(`discovery route not registered at ${path}`);
  return entry.handler as (req: any, res: any) => Promise<void>;
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

  it('keeps `capabilities` as the one capability key — no `features`, no `endpoints`', async () => {
    const body = await invoke(discoveryHandler());

    expect(body).not.toHaveProperty('features');
    expect(body).not.toHaveProperty('endpoints');
    // The REST layer's own AND of the runtime verdict with `api.enableBatch`
    // still lands inside `capabilities` (#3298) — pinned so the retirement
    // cannot take the composed capability with it.
    expect(body.capabilities.transactionalBatch).toBeDefined();
  });
});
