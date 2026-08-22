// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0006 `KernelResolver.resolveEnvironment` — one kernel-waiter window per
 * REST request.
 *
 * ## What is being pinned, and why the obvious assertion is worthless here
 *
 * `RestApiPlugin` wraps the host's `kernel-resolver` so `RestServer` can ask
 * "which environment is this request in?". It asked `resolveKernel` — a kernel
 * ACQUISITION api — and kept only `context.environmentId`. A real host resolver
 * writes the id and THEN awaits the kernel, so the wrapper paid a full waiter
 * window and discarded what it bought; `resolveProtocol` then acquired the
 * kernel again. Measured on a live multi-tenant host (`waiterTimeoutMs: 20s`):
 * dispatcher-owned routes answered 503 in ~21s, REST-owned ones
 * (`/api/v1/discovery`, `/api/v1/data/:object`) in ~42s.
 *
 * "The request still answered" / "an env id came back" pass on today's code,
 * on the naive fix, and on the real one — the card measured the naive fix
 * (catch the resolver's throw, keep the id it already wrote) at 2.38x/2.02x
 * with **two** acquisitions, because the window is spent inside the resolver
 * call before any id is returned. So every assertion below counts the
 * MECHANISM: `getOrCreate` calls per request.
 *
 * Three properties, each with its own leg:
 *   1. one acquisition per REST-owned route when the host implements
 *      `resolveEnvironment`;
 *   2. still two when the host implements only `resolveKernel` — the
 *      back-compat path is EXERCISED, not assumed, since it is the state every
 *      deployed host is in until it implements the new member;
 *   3. fail-closed survives — the surviving `getOrCreate` still rejects and the
 *      caller still gets the host's declared 503, never a response served
 *      against no kernel. This is the property most at risk from collapsing the
 *      windows, so it is asserted rather than argued.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRestApiPlugin } from './rest-api-plugin';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

const ENV = 'env_probe';
const ANON_API = { api: { requireAuth: false } };

/** One bounded waiter window, scaled down from the host's 20s to keep tests fast. */
const WINDOW_MS = 20;

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

function createMockProtocol(tag: string) {
  return {
    __tag: tag,
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

/**
 * The error a host's kernel manager rejects a wedged build with — cloud's
 * `kernel_warming`, carrying the `503` / `SERVICE_UNAVAILABLE` pair REST's
 * declared-status passthrough answers with.
 */
function kernelWarmingError() {
  return Object.assign(new Error('Environment kernel is still warming up.'), {
    status: 503,
    statusCode: 503,
    code: 'SERVICE_UNAVAILABLE',
    declaredCode: 'kernel_warming',
  });
}

/**
 * A kernel manager whose build stays in flight: every `getOrCreate` opens its
 * OWN bounded wait and rejects when it expires. Counting its calls counts
 * waiter windows, which is the whole subject of this file.
 */
function wedgedKernelManager() {
  const acquisitions: string[] = [];
  return {
    acquisitions,
    getOrCreate: (environmentId: string) => {
      acquisitions.push(environmentId);
      return new Promise<any>((_resolve, reject) => {
        setTimeout(() => reject(kernelWarmingError()), WINDOW_MS);
      });
    },
  };
}

/** A kernel manager that hands back a live per-environment kernel (warm path). */
function warmKernelManager(services: Record<string, any>) {
  const acquisitions: string[] = [];
  const kernel = { getServiceAsync: vi.fn(async (name: string) => services[name]) };
  return {
    acquisitions,
    kernel,
    getOrCreate: async (environmentId: string) => {
      acquisitions.push(environmentId);
      return kernel;
    },
  };
}

/**
 * A host `kernel-resolver` shaped like a real one: it resolves the environment
 * onto the context FIRST and only then awaits that environment's kernel — the
 * ordering that makes `resolveKernel` an expensive way to ask a cheap question.
 *
 * `environmentOnly: true` adds the ADR-0006 `resolveEnvironment` member: same
 * environment answer, no acquisition.
 */
function hostKernelResolver(km: { getOrCreate: (id: string) => Promise<any> }, opts: { environmentOnly: boolean }) {
  const resolveKernel = vi.fn(async (context: any) => {
    context.environmentId = ENV;      // resolved BEFORE the kernel is awaited
    return await km.getOrCreate(ENV); // ← the window this wrapper used to buy and discard
  });
  const resolveEnvironment = vi.fn(async (context: any) => {
    context.environmentId = ENV;      // and nothing else
  });
  const resolver: any = { resolveKernel };
  if (opts.environmentOnly) resolver.resolveEnvironment = resolveEnvironment;
  return { resolver, resolveKernel, resolveEnvironment };
}

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

type HostArgs = {
  kernelResolver?: any;
  kernelManager: any;
  hostProtocol?: any;
  /** Omit to boot a host with no legacy chain at all. */
  envRegistry?: any;
};

/**
 * The legacy hostname chain, which a real multi-tenant host wires next to its
 * `kernel-resolver`. It is load-bearing for the back-compat leg and NOT
 * scenery: when the resolver's kernel await rejects,
 * `resolveRequestEnvironmentId` swallows the throw and this chain supplies the
 * id — which is what lets `resolveProtocol` go on to open the SECOND waiter
 * window the card measured at 42s. A host without it would degrade to the
 * control-plane protocol instead, a different (and much worse) shape.
 */
function legacyHostnameRegistry() {
  return {
    resolveByHostname: vi.fn().mockResolvedValue({ environmentId: ENV }),
    resolveById: vi.fn().mockResolvedValue({}),
  };
}

/**
 * Boot the REAL plugin over these services and hand back the route handlers it
 * registered. Driving the plugin (rather than `new RestServer(...)`) is the
 * point: the wrapper under test is built inside `RestApiPlugin.start`, so a
 * test that constructed its own `requestEnvResolver` would assert nothing about
 * the code that ships.
 */
async function bootRest(args: HostArgs) {
  const server = createMockServer();
  const hostProtocol = args.hostProtocol ?? createMockProtocol('host');
  const services: Record<string, any> = {
    'http.server': server,
    protocol: hostProtocol,
    objectql: { registerObject: vi.fn(), find: vi.fn().mockResolvedValue([]) },
    'kernel-manager': args.kernelManager,
  };
  if (args.kernelResolver) services['kernel-resolver'] = args.kernelResolver;
  if (args.envRegistry) services['env-registry'] = args.envRegistry;

  const ctx = createMockPluginContext(services);
  const plugin = createRestApiPlugin({ api: ANON_API as any });
  await plugin.init?.(ctx as any);
  await (plugin as any).start(ctx as any);

  const routeFor = (path: string) => {
    const call = server.get.mock.calls.find((c: any[]) => c[0] === path);
    expect(call, `GET ${path} must be registered`).toBeDefined();
    return call![1];
  };

  /** Drive one request and report exactly what the caller received. */
  const drive = async (path: string, req: any) => {
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
      header: vi.fn(),
      headersSent: false,
    };
    await routeFor(path)(req, res);
    return {
      status: res.status.mock.calls.at(-1)?.[0],
      body: res.json.mock.calls.at(-1)?.[0],
      res,
    };
  };

  return { drive, hostProtocol, services, envRegistry: args.envRegistry };
}

const discoveryReq = () => ({ params: {}, query: {}, headers: { host: 'tenant-a.example.com' }, url: '/api/v1/discovery' });
const dataReq = () => ({ params: { object: 'sys_user' }, query: {}, headers: { host: 'tenant-a.example.com' }, url: '/api/v1/data/sys_user' });

const REST_OWNED_ROUTES: Array<[string, string, () => any]> = [
  ['/api/v1/discovery', '/api/v1/discovery', discoveryReq],
  ['/api/v1/data/:object', '/api/v1/data/:object', dataReq],
];

// ---------------------------------------------------------------------------
// 1 + 3. One window, and it still fails closed
// ---------------------------------------------------------------------------

describe('a host implementing resolveEnvironment pays ONE waiter window per REST request', () => {
  for (const [label, path, makeReq] of REST_OWNED_ROUTES) {
    it(`${label} acquires exactly one kernel`, async () => {
      const km = wedgedKernelManager();
      const { resolver, resolveKernel, resolveEnvironment } = hostKernelResolver(km, { environmentOnly: true });
      const envRegistry = legacyHostnameRegistry();
      const { drive } = await bootRest({ kernelResolver: resolver, kernelManager: km, envRegistry });

      const { status, body } = await drive(path, makeReq());

      // THE pin: one request, one kernel acquisition. Two is today's defect,
      // and the naive catch-and-keep-the-id fix measured two as well.
      expect(km.acquisitions).toEqual([ENV]);
      // The environment question was asked of the environment-only member, and
      // the acquisition api was never touched by the wrapper.
      expect(resolveEnvironment).toHaveBeenCalledTimes(1);
      expect(resolveKernel).not.toHaveBeenCalled();
      // The resolver answered normally, so the legacy chain never ran — the id
      // came from the seam, not from a degrade.
      expect(envRegistry.resolveByHostname).not.toHaveBeenCalled();
      // Fail-closed: the surviving getOrCreate still rejects, so the caller
      // still gets the host's declared 503. Shorter wait, same verdict.
      expect(status).toBe(503);
      expect(body.code).toBe('SERVICE_UNAVAILABLE');
    });
  }

  it('never serves a REST-owned route against a kernel it could not acquire', async () => {
    const km = wedgedKernelManager();
    const { resolver } = hostKernelResolver(km, { environmentOnly: true });
    const hostProtocol = createMockProtocol('host');
    const { drive } = await bootRest({
      kernelResolver: resolver,
      kernelManager: km,
      hostProtocol,
      envRegistry: legacyHostnameRegistry(),
    });

    const discovery = await drive('/api/v1/discovery', discoveryReq());
    const data = await drive('/api/v1/data/:object', dataReq());

    // Collapsing the windows must not degrade "waited, then 503" into "served
    // from the CONTROL-PLANE protocol" — the failure mode a fallback-on-throw
    // would have introduced. The host protocol answers neither request.
    expect(discovery.status).toBe(503);
    expect(data.status).toBe(503);
    expect(hostProtocol.getDiscovery).not.toHaveBeenCalled();
    expect(hostProtocol.findData).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. The back-compat path, exercised
// ---------------------------------------------------------------------------

describe('a host implementing only resolveKernel keeps working — and keeps paying twice', () => {
  for (const [label, path, makeReq] of REST_OWNED_ROUTES) {
    it(`${label} still acquires two kernels`, async () => {
      const km = wedgedKernelManager();
      const { resolver, resolveKernel } = hostKernelResolver(km, { environmentOnly: false });
      const envRegistry = legacyHostnameRegistry();
      const { drive } = await bootRest({ kernelResolver: resolver, kernelManager: km, envRegistry });

      const { status, body } = await drive(path, makeReq());

      // `resolveEnvironment` is `?.`-optional precisely so this host needs no
      // change to keep serving. It pays the documented double window; that is
      // the deal, and it is pinned so "it still works" is a measurement.
      //
      // The exact production shape: window #1 is the resolver's own kernel
      // await, whose rejection is swallowed by `resolveRequestEnvironmentId`;
      // the legacy hostname chain then supplies the same id, and
      // `resolveProtocol` opens window #2 to acquire the kernel for real.
      expect(km.acquisitions).toEqual([ENV, ENV]);
      expect(resolveKernel).toHaveBeenCalledTimes(1);
      expect(envRegistry.resolveByHostname).toHaveBeenCalled();
      expect(status).toBe(503);
      expect(body.code).toBe('SERVICE_UNAVAILABLE');
    });
  }
});

// ---------------------------------------------------------------------------
// The environment answer itself is unchanged
// ---------------------------------------------------------------------------

describe('collapsing the window does not change WHICH environment serves the request', () => {
  it('a warm request is served from the resolved environment kernel, acquired once', async () => {
    const envProtocol = createMockProtocol('env');
    const km = warmKernelManager({ protocol: envProtocol, mcp: undefined });
    const { resolver } = hostKernelResolver(km, { environmentOnly: true });
    const hostProtocol = createMockProtocol('host');
    const { drive } = await bootRest({ kernelResolver: resolver, kernelManager: km, hostProtocol });

    const { body } = await drive('/api/v1/discovery', discoveryReq());

    // Every acquisition is for the environment the resolver named, and the
    // document is the ENVIRONMENT kernel's, not the control plane's.
    expect(new Set(km.acquisitions)).toEqual(new Set([ENV]));
    expect(envProtocol.getDiscovery).toHaveBeenCalled();
    expect(hostProtocol.getDiscovery).not.toHaveBeenCalled();
    expect(body.version).toBeDefined();
  });

  it('drops the discarded acquisition from the warm path too — one per environment resolution', async () => {
    const withNew = warmKernelManager({ protocol: createMockProtocol('env') });
    const withoutNew = warmKernelManager({ protocol: createMockProtocol('env') });

    const a = await bootRest({
      kernelResolver: hostKernelResolver(withNew, { environmentOnly: true }).resolver,
      kernelManager: withNew,
    });
    await a.drive('/api/v1/discovery', discoveryReq());

    const b = await bootRest({
      kernelResolver: hostKernelResolver(withoutNew, { environmentOnly: false }).resolver,
      kernelManager: withoutNew,
    });
    await b.drive('/api/v1/discovery', discoveryReq());

    // The waste is on the success path too — it is simply free there, because
    // a warm `getOrCreate` is a cache hit, which is why this went unnoticed for
    // so long. `/discovery` resolves the environment TWICE (once for the
    // protocol, once for the mcp-serveability probe), so the old wrapper bought
    // and discarded a kernel twice: four acquisitions where two are genuine.
    expect(withNew.acquisitions).toEqual([ENV, ENV]);
    expect(withoutNew.acquisitions).toEqual([ENV, ENV, ENV, ENV]);
  });
});

// ---------------------------------------------------------------------------
// "No environment" stays a final answer
// ---------------------------------------------------------------------------

describe('resolveEnvironment leaving the id unset is FINAL', () => {
  it('does not retry through resolveKernel, and acquires nothing', async () => {
    const km = wedgedKernelManager();
    const resolveKernel = vi.fn(async (context: any) => {
      context.environmentId = ENV;
      return await km.getOrCreate(ENV);
    });
    const hostProtocol = createMockProtocol('host');
    const { drive } = await bootRest({
      kernelResolver: {
        resolveKernel,
        // A control-plane / unscoped request: the resolver deliberately names
        // no environment.
        resolveEnvironment: vi.fn(async () => { /* no id */ }),
      },
      kernelManager: km,
      hostProtocol,
    });

    const { body } = await drive('/api/v1/discovery', discoveryReq());

    // "Unscoped" is the seam's contract answer, not a decline. Retrying through
    // the acquisition api would re-buy the very window this prefers away, on
    // requests that need no environment at all.
    expect(resolveKernel).not.toHaveBeenCalled();
    expect(km.acquisitions).toEqual([]);
    expect(hostProtocol.getDiscovery).toHaveBeenCalled();
    expect(body.version).toBeDefined();
  });
});
