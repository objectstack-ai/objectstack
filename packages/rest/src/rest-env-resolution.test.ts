// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0076 D11 step ④ (#2462) — request→environment resolution unified on the
 * host's ADR-0006 `kernel-resolver` seam.
 *
 * Locks the resolution-chain contract of `resolveRequestEnvironmentId`:
 *   explicit id → host-injected RestRequestEnvResolver (normal return is
 *   FINAL, throw degrades) → legacy hostname/header chain → single-project
 *   default — and the RestApiPlugin adapter that binds the host's
 *   `kernel-resolver` service into that seam.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer, RestRequestEnvResolver, RestEnvRegistry } from './rest-server';
import { createRestApiPlugin } from './rest-api-plugin';

// ---------------------------------------------------------------------------
// Mocks & Helpers
// ---------------------------------------------------------------------------

function createMockServer() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
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

const ANON_API = { api: { requireAuth: false } };

/** Node-style request with a Host header + optional X-Environment-Id. */
function mockReq(headers: Record<string, string> = {}): any {
  return { headers: { host: 'tenant-a.example.com', ...headers }, url: '/api/v1/data/account' };
}

type RestServerArgs = {
  envRegistry?: RestEnvRegistry;
  defaultEnvironmentIdProvider?: () => string | undefined;
  requestEnvResolver?: RestRequestEnvResolver;
  kernelManager?: { getOrCreate: (id: string) => Promise<any> };
  /** Single-env service-existence probe — answers for the HOST kernel. */
  serviceExistsProvider?: (name: string) => boolean;
};

/** Build a RestServer with only the seams under test wired. */
function buildRest(args: RestServerArgs = {}) {
  const server = createMockServer();
  const protocol = createMockProtocol();
  const kernelManager =
    args.kernelManager ??
    ({
      getOrCreate: vi.fn().mockResolvedValue({
        getServiceAsync: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);
  const rest = new RestServer(
    server as any,
    protocol as any,
    ANON_API as any,
    kernelManager as any,
    args.envRegistry,
    args.defaultEnvironmentIdProvider,
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
    args.serviceExistsProvider,
    undefined, // securityServiceProvider
    args.requestEnvResolver,
  );
  const resolve = (environmentId?: string, req?: any): Promise<string | undefined> =>
    (rest as any).resolveRequestEnvironmentId(environmentId, req);
  return { rest, server, protocol, kernelManager, resolve };
}

/** Legacy registry that resolves every hostname to `legacy-env`. */
function legacyRegistry(): RestEnvRegistry & { resolveByHostname: ReturnType<typeof vi.fn> } {
  return {
    resolveByHostname: vi.fn().mockResolvedValue({ environmentId: 'legacy-env' }),
    resolveById: vi.fn().mockResolvedValue({}),
  } as any;
}

// ---------------------------------------------------------------------------
// Resolution-chain contract
// ---------------------------------------------------------------------------

describe('resolveRequestEnvironmentId (D11④ seam)', () => {
  it('returns an explicit environmentId without consulting any resolver', async () => {
    const resolver: RestRequestEnvResolver = {
      resolveRequestEnvironmentId: vi.fn().mockResolvedValue('resolver-env'),
    };
    const registry = legacyRegistry();
    const { resolve } = buildRest({ requestEnvResolver: resolver, envRegistry: registry });

    await expect(resolve('explicit-env', mockReq())).resolves.toBe('explicit-env');
    expect(resolver.resolveRequestEnvironmentId).not.toHaveBeenCalled();
    expect(registry.resolveByHostname).not.toHaveBeenCalled();
  });

  it('prefers the injected resolver over the legacy envRegistry chain', async () => {
    const resolver: RestRequestEnvResolver = {
      resolveRequestEnvironmentId: vi.fn().mockResolvedValue('resolver-env'),
    };
    const registry = legacyRegistry();
    const { resolve } = buildRest({ requestEnvResolver: resolver, envRegistry: registry });

    await expect(resolve(undefined, mockReq())).resolves.toBe('resolver-env');
    // The legacy chain must not even be consulted — one authority per host.
    expect(registry.resolveByHostname).not.toHaveBeenCalled();
  });

  it("treats the resolver's undefined as FINAL — legacy chain and default do not second-guess it", async () => {
    const resolver: RestRequestEnvResolver = {
      resolveRequestEnvironmentId: vi.fn().mockResolvedValue(undefined),
    };
    const registry = legacyRegistry();
    const { resolve } = buildRest({
      requestEnvResolver: resolver,
      envRegistry: registry,
      defaultEnvironmentIdProvider: () => 'default-env',
    });

    // Both fallbacks COULD produce an id; the resolver's verdict wins anyway
    // (e.g. it deliberately skipped a control-plane route).
    await expect(resolve(undefined, mockReq())).resolves.toBeUndefined();
    expect(registry.resolveByHostname).not.toHaveBeenCalled();
  });

  it('degrades to the legacy chain when the resolver throws', async () => {
    const resolver: RestRequestEnvResolver = {
      resolveRequestEnvironmentId: vi.fn().mockRejectedValue(new Error('resolver down')),
    };
    const registry = legacyRegistry();
    const { resolve } = buildRest({ requestEnvResolver: resolver, envRegistry: registry });

    await expect(resolve(undefined, mockReq())).resolves.toBe('legacy-env');
  });

  it('runs the legacy hostname chain unchanged when no resolver is injected', async () => {
    const registry = legacyRegistry();
    const { resolve } = buildRest({ envRegistry: registry });

    await expect(resolve(undefined, mockReq())).resolves.toBe('legacy-env');
    expect(registry.resolveByHostname).toHaveBeenCalledWith('tenant-a.example.com');
  });

  it('falls back to X-Environment-Id header, then the single-project default, when hostname misses', async () => {
    const registry: RestEnvRegistry = {
      resolveByHostname: vi.fn().mockResolvedValue(null),
      resolveById: vi.fn().mockImplementation(async (id: string) => (id === 'header-env' ? {} : null)),
    };
    const { resolve } = buildRest({
      envRegistry: registry,
      defaultEnvironmentIdProvider: () => 'default-env',
    });

    await expect(
      resolve(undefined, mockReq({ 'x-environment-id': 'header-env' })),
    ).resolves.toBe('header-env');
    await expect(resolve(undefined, mockReq())).resolves.toBe('default-env');
  });

  it('routes resolver-provided environments into kernelManager.getOrCreate via resolveProtocol', async () => {
    const resolver: RestRequestEnvResolver = {
      resolveRequestEnvironmentId: vi.fn().mockResolvedValue('resolver-env'),
    };
    const perEnvProtocol = createMockProtocol();
    const kernelManager = {
      getOrCreate: vi.fn().mockResolvedValue({
        getServiceAsync: vi.fn().mockResolvedValue(perEnvProtocol),
      }),
    };
    const { rest } = buildRest({ requestEnvResolver: resolver, kernelManager });

    const resolved = await (rest as any).resolveProtocol(undefined, mockReq());
    expect(kernelManager.getOrCreate).toHaveBeenCalledWith('resolver-env');
    expect(resolved).toBe(perEnvProtocol);
  });
});

// ---------------------------------------------------------------------------
// probeMcpServeable — the NINTH consumer of the shared entry point (#9120)
//
// `/discovery`'s `mcp` advertisement is computed from this probe. It used to
// re-derive the environment itself (`req.params.environmentId`, else
// `defaultEnvironmentIdProvider`), so it saw neither the host's ADR-0006
// `kernel-resolver` seam nor the legacy hostname / `X-Environment-Id` chain.
// On a hostname-routed multi-tenant host neither of its two inputs is present
// — the route is unscoped and the default provider is `createSingleEnvironment
// Plugin`'s wiring — so it fell through to `serviceExistsProvider`, which
// answers for the HOST kernel. Both misadvertisement directions were reachable
// from there; single-environment boots were correct throughout, which is why
// every pin below is written on the multi-tenant shape.
// ---------------------------------------------------------------------------

/**
 * A per-request kernel double, answering BY SERVICE NAME.
 *
 * [#9292] It used to resolve every name to one value, which was enough while
 * `mcp` was the only slot anything asked it for. `/discovery` now resolves the
 * request's `protocol` off this same kernel (the shared `resolveProtocol` path
 * every other handler in rest-server.ts already uses), so a double that hands
 * the mcp stub back for `protocol` produces a document builder with no
 * `getDiscovery`. A real kernel serves both slots; this one now does too. The
 * #9120 assertions below are unchanged — only the double got faithful.
 */
function kernelServing(services: Record<string, any>) {
  return { getServiceAsync: vi.fn(async (name: string) => services[name]) };
}
/** A kernel whose `mcp` slot holds a service of the shape `/mcp` needs. */
function kernelWithMcp() {
  return kernelServing({
    mcp: { handleHttpRequest: () => undefined },
    protocol: createMockProtocol(),
  });
}
/** A kernel with no `mcp` service at all — `/mcp` would 501 here. */
function kernelWithoutMcp() {
  return kernelServing({ protocol: createMockProtocol() });
}

describe('probeMcpServeable (D11④ seam, ninth consumer)', () => {
  /**
   * A hostname-routed multi-tenant host: the injected resolver answers for the
   * request, and NO `defaultEnvironmentIdProvider` is registered — that is
   * single-environment wiring, and its absence is what left the old derivation
   * with nothing but the host-wide `serviceExistsProvider`.
   */
  function multiTenantHost(envKernel: any, hostHasMcp: boolean) {
    const getOrCreate = vi.fn().mockResolvedValue(envKernel);
    const { rest } = buildRest({
      requestEnvResolver: { resolveRequestEnvironmentId: vi.fn().mockResolvedValue('tenant-b') },
      kernelManager: { getOrCreate },
      serviceExistsProvider: () => hostHasMcp,
    });
    return { getOrCreate, probe: (req: any) => (rest as any).probeMcpServeable(req) };
  }

  it('answers for the REQUEST environment when the host kernel serves mcp and that environment does not', async () => {
    const { probe, getOrCreate } = multiTenantHost(kernelWithoutMcp(), true);

    // The over-advertisement direction #4024 was filed to close: the host says
    // yes, the request's own kernel would 501. `false` withholds `routes.mcp`.
    await expect(probe(mockReq())).resolves.toBe(false);
    expect(getOrCreate).toHaveBeenCalledWith('tenant-b');
  });

  it('answers for the REQUEST environment when it serves mcp and the host kernel does not', async () => {
    const { probe, getOrCreate } = multiTenantHost(kernelWithMcp(), false);

    // The other direction: a confident `false` computed against the wrong
    // kernel withholds a route that would have served (`mcpServeable !== false`
    // fails open only for `null`).
    await expect(probe(mockReq())).resolves.toBe(true);
    expect(getOrCreate).toHaveBeenCalledWith('tenant-b');
  });

  it('reaches the request environment through the legacy hostname chain when no resolver is injected', async () => {
    const getOrCreate = vi.fn().mockResolvedValue(kernelWithMcp());
    const { rest } = buildRest({
      envRegistry: legacyRegistry(),
      kernelManager: { getOrCreate },
      serviceExistsProvider: () => false,
    });

    await expect((rest as any).probeMcpServeable(mockReq())).resolves.toBe(true);
    expect(getOrCreate).toHaveBeenCalledWith('legacy-env');
  });

  it('follows X-Environment-Id, which the hand-rolled derivation never read', async () => {
    const getOrCreate = vi.fn().mockResolvedValue(kernelWithMcp());
    const { rest } = buildRest({
      envRegistry: {
        resolveByHostname: vi.fn().mockResolvedValue(null),
        resolveById: vi.fn().mockImplementation(async (id: string) => (id === 'header-env' ? {} : null)),
      },
      kernelManager: { getOrCreate },
      serviceExistsProvider: () => false,
    });

    await expect(
      (rest as any).probeMcpServeable(mockReq({ 'x-environment-id': 'header-env' })),
    ).resolves.toBe(true);
    expect(getOrCreate).toHaveBeenCalledWith('header-env');
  });

  it('keeps the single-environment answer unchanged (default provider → that kernel)', async () => {
    const getOrCreate = vi.fn().mockResolvedValue(kernelWithoutMcp());
    const { rest } = buildRest({
      defaultEnvironmentIdProvider: () => 'default-env',
      kernelManager: { getOrCreate },
      serviceExistsProvider: () => true,
    });

    // Correct before this change and correct after: the shared entry point's
    // step 3 IS the default provider, so single-env boots keep their answer.
    await expect((rest as any).probeMcpServeable(mockReq())).resolves.toBe(false);
    expect(getOrCreate).toHaveBeenCalledWith('default-env');
  });

  it("keeps the 'platform' guard — the reserved id is never handed to getOrCreate", async () => {
    const getOrCreate = vi.fn().mockResolvedValue(kernelWithMcp());
    const { rest } = buildRest({
      kernelManager: { getOrCreate },
      serviceExistsProvider: (name: string) => name === 'mcp',
    });

    // `platform` is a virtual id, not a row in the environments table.
    await expect(
      (rest as any).probeMcpServeable({ ...mockReq(), params: { environmentId: 'platform' } }),
    ).resolves.toBe(true);
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it('never mistakes the literal ":environmentId" placeholder for an environment', async () => {
    const getOrCreate = vi.fn().mockResolvedValue(kernelWithMcp());
    const { rest } = buildRest({
      requestEnvResolver: { resolveRequestEnvironmentId: vi.fn().mockResolvedValue('tenant-b') },
      kernelManager: { getOrCreate },
      serviceExistsProvider: () => false,
    });

    // An unsubstituted route pattern is the absence of an id, not an id — the
    // shared entry point short-circuits on any truthy explicit value, so the
    // placeholder must be normalised away before it is passed in.
    await expect(
      (rest as any).probeMcpServeable({ ...mockReq(), params: { environmentId: ':environmentId' } }),
    ).resolves.toBe(true);
    expect(getOrCreate).toHaveBeenCalledWith('tenant-b');
    expect(getOrCreate).not.toHaveBeenCalledWith(':environmentId');
  });

  it('keeps the serviceExistsProvider fallback when no environment resolves at all', async () => {
    const getOrCreate = vi.fn().mockResolvedValue(kernelWithMcp());
    const { rest } = buildRest({
      kernelManager: { getOrCreate },
      serviceExistsProvider: (name: string) => name === 'mcp',
    });

    await expect((rest as any).probeMcpServeable(mockReq())).resolves.toBe(true);
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it('still reports null ("cannot probe") when nothing in either path can answer', async () => {
    const { rest } = buildRest({ kernelManager: { getOrCreate: vi.fn() } });
    await expect((rest as any).probeMcpServeable(mockReq())).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// /discovery end to end — the advertisement the probe feeds, driven through
// the real handler so the `req` it receives is the one the route was given.
// ---------------------------------------------------------------------------

describe('/discovery mcp advertisement (#9120)', () => {
  function driveDiscovery(args: RestServerArgs) {
    const { rest, server } = buildRest(args);
    rest.registerRoutes();
    const route = server.get.mock.calls.find((c: any[]) => c[0] === '/api/v1/discovery');
    expect(route, 'GET /api/v1/discovery must be registered').toBeDefined();
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    };
    return async (req: any) => {
      await route![1](req, res);
      expect(res.json).toHaveBeenCalledTimes(1);
      return res.json.mock.calls[0][0];
    };
  }

  it('withholds routes.mcp when the request environment cannot serve it, though the host kernel can', async () => {
    const discovery = await driveDiscovery({
      requestEnvResolver: { resolveRequestEnvironmentId: vi.fn().mockResolvedValue('tenant-b') },
      kernelManager: { getOrCreate: vi.fn().mockResolvedValue(kernelWithoutMcp()) },
      serviceExistsProvider: () => true,
    })(mockReq());

    expect(discovery.routes.mcp).toBeUndefined();
  });

  it('advertises routes.mcp when the request environment serves it, though the host kernel does not', async () => {
    const discovery = await driveDiscovery({
      requestEnvResolver: { resolveRequestEnvironmentId: vi.fn().mockResolvedValue('tenant-b') },
      kernelManager: { getOrCreate: vi.fn().mockResolvedValue(kernelWithMcp()) },
      serviceExistsProvider: () => false,
    })(mockReq());

    expect(discovery.routes.mcp).toBe('/api/v1/mcp');
  });
});

// ---------------------------------------------------------------------------
// RestApiPlugin adapter — binds the host's `kernel-resolver` service
// ---------------------------------------------------------------------------

describe('RestApiPlugin kernel-resolver adapter (D11④)', () => {
  function createMockPluginContext(services: Record<string, any>) {
    return {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (services[name]) return services[name];
        throw new Error(`Service '${name}' not found`);
      }),
      getServices: vi.fn(() => new Map(Object.entries(services))),
      hook: vi.fn(),
      trigger: vi.fn().mockResolvedValue(undefined),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getKernel: vi.fn(),
    };
  }

  /** Base services every plugin boot needs. */
  function baseServices() {
    return {
      'http.server': createMockServer(),
      protocol: createMockProtocol(),
      objectql: { registerObject: vi.fn(), find: vi.fn().mockResolvedValue([]) },
    };
  }

  it('wires the kernel-resolver service into the REST env seam (context.environmentId read-back)', async () => {
    const resolveKernel = vi.fn().mockImplementation(async (context: any) => {
      context.environmentId = 'cloud-env';
      return undefined;
    });
    const services: Record<string, any> = {
      ...baseServices(),
      'kernel-resolver': { resolveKernel },
      'kernel-manager': {
        getOrCreate: vi.fn().mockResolvedValue({
          getServiceAsync: vi.fn().mockResolvedValue(undefined),
        }),
      },
    };
    const ctx = createMockPluginContext(services);
    const plugin = createRestApiPlugin({ api: ANON_API as any });
    await plugin.init?.(ctx as any);
    await (plugin as any).start(ctx as any);

    // Pull the registered GET /api/v1/data/:object handler and drive one
    // unscoped request through it — the adapter must consult resolveKernel.
    const server = services['http.server'];
    expect(server.get.mock.calls.map((c: any[]) => c[0])).toContain('/api/v1/data/:object');
    const listRoute = server.get.mock.calls.find((c: any[]) => c[0] === '/api/v1/data/:object');
    const handler = listRoute![1];
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    };
    await handler({ params: { object: 'account' }, query: {}, headers: { host: 'x.example.com' } }, res);

    expect(resolveKernel).toHaveBeenCalled();
    const [context, hostKernel] = resolveKernel.mock.calls[0];
    expect(context.request).toBeDefined();
    // The facade must expose the hosting kernel's service surface (the
    // resolver's session/default-project levels resolve services off it).
    expect(hostKernel.getService('protocol')).toBe(services.protocol);
    await expect(hostKernel.getServiceAsync('protocol')).resolves.toBe(services.protocol);
    // The resolver's answer must reach kernelManager.getOrCreate — the REST
    // request is served from the SAME environment the dispatcher would pick.
    expect(services['kernel-manager'].getOrCreate).toHaveBeenCalledWith('cloud-env');
  });

  it('boots and serves without a kernel-resolver service (OSS single-environment mode)', async () => {
    const services: Record<string, any> = { ...baseServices() };
    const ctx = createMockPluginContext(services);
    const plugin = createRestApiPlugin({ api: ANON_API as any });
    await plugin.init?.(ctx as any);
    await (plugin as any).start(ctx as any);

    const server = services['http.server'];
    const listRoute = server.get.mock.calls.find((c: any[]) => c[0] === '/api/v1/data/:object');
    expect(listRoute).toBeDefined();
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    };
    // No resolver, no crash — and the shared anonymous-deny gate applies even in
    // single-environment OSS mode: an anonymous data read is 401, never served
    // (#3963). The control protocol is only reached once a caller authenticates.
    await listRoute![1]({ params: { object: 'account' }, query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(services.protocol.findData).not.toHaveBeenCalled();
  });
});
