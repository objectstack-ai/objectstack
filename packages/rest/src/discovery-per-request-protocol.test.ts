// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9292] `/discovery` must describe the environment the REQUEST names.
//
// The defect: `registerDiscoveryEndpoints`' handler opened with
// `this.protocol.getDiscovery()` — the CONTROL-PLANE protocol captured at
// construction — while ~30 sibling handlers in the same file obtain theirs
// from `resolveProtocol(environmentId, req)`. Everything else in the handler
// composes over that one document, so the whole body followed the host's
// kernel. `/discovery` is the surface SDKs, codegen and AI clients read
// (AGENTS.md "Route & surface ownership" #4: machine-readable surfaces must
// not lie), and it was the one surface that did not follow the request.
//
// The sharper half is the SCOPED route: `registerRoutes` registers the same
// closure for the unscoped base and for `.../environments/:environmentId`, so
// `GET /api/v1/environments/abc/discovery` — a request that names its
// environment in the URL — still received the control plane's document. There
// is no ambiguity about which environment that caller means, which is why the
// scoped pins below are the ones that must never silently regress.
//
// WHAT THIS FILE ASSERTS, and why it is shaped this way. It does not hardcode
// capability booleans — that assertion survives someone pinning the bits one
// layer over, which is the same class of defect. It asserts IDENTITY AGAINST
// THE RIGHT PRODUCER, both sides measured in the same test: the body served by
// the real `/discovery` handler versus `getDiscovery()` called directly on the
// environment's own real protocol. Each pin carries its negative half — the
// served body must NOT equal the host's — because a host that happened to
// match would make the positive half pass vacuously. The three protocols below
// genuinely differ from each other for exactly that reason.
//
// Measured before the fix, on this harness: the two scoped documents were
// BYTE-IDENTICAL in `capabilities`, `services` and `locale`, and both carried
// the host's answers — 13/13 capability keys wrong for `tenant-a`, its whole
// `services` map wrong, its `locale` wrong, four of its real route keys
// missing and a phantom `routes.notifications` advertised in their place. Only
// the `realBase` prefix substitution differed, because that half already read
// `req.params.environmentId`.

import { describe, it, expect, vi } from 'vitest';
import type { IHttpRequest } from '@objectstack/spec/contracts';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

function createMockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * A REAL `getDiscovery()` producer over a described kernel. Every input here is
 * one the builder actually reads: `engine.registry.getObject('sys_comment')`
 * (→ `capabilities.comments`), `engine.transaction` (→ `transactionalBatch`),
 * and the services registry (→ the whole `services` map, the optional `routes`
 * keys, and the service-backed capabilities). The `i18n` occupant carries real
 * locale accessors because `locale` is derived from them — that field is
 * host-derived too, and the card did not name it.
 */
function realProtocol(opts: { transaction?: boolean; sysComment?: boolean; services?: string[] }) {
  const engine: any = {
    registry: {
      getObject: (n: string) => (opts.sysComment && n === 'sys_comment' ? {} : undefined),
      getRegisteredTypes: () => [],
    },
  };
  if (opts.transaction) engine.transaction = async (fn: any) => fn();
  const services = new Map<string, any>();
  for (const s of opts.services ?? []) {
    services.set(
      s,
      s === 'i18n'
        ? { getDefaultLocale: () => 'zh-CN', getLocales: () => ['zh-CN', 'en'] }
        : {},
    );
  }
  return new ObjectStackProtocolImplementation(engine as any, () => services) as any;
}

/** Rich environment: transactions, sys_comment, and five service slots filled. */
const tenantAShape = {
  transaction: true,
  sysComment: true,
  services: ['automation', 'i18n', 'ai', 'analytics', 'job'],
};
/** Bare environment: nothing at all. */
const tenantBShape = { transaction: false, sysComment: false, services: [] as string[] };
/**
 * The control plane. Deliberately matches NEITHER tenant: it holds the one
 * service neither of them has, so a document that leaked from here is
 * identifiable by a `notifications` capability no tenant can deliver — and no
 * pin below can pass by the host coincidentally agreeing with a tenant.
 */
const hostShape = { transaction: false, sysComment: false, services: ['notification'] };

const API_CONFIG = {
  api: {
    requireAuth: false,
    enableProjectScoping: true,
    projectResolution: 'optional',
    enableCrud: true,
    enableMetadata: true,
    enableBatch: true,
  },
};

/**
 * The substance of a discovery document that the KERNEL determines — the part
 * this issue is about.
 *
 * Capabilities are reduced to their `enabled` bits deliberately. The handler
 * legitimately re-writes two descriptors after composing the document:
 * `transactionalBatch` gains its ADR-0034 `description` and is ANDed with
 * `api.enableBatch`, and `search` is ANDed with `api.enableSearch` (#3298,
 * #7541 — each layer stating the fact only it knows). Those overlays are a
 * different contract with its own pins; comparing whole descriptors here would
 * make this file assert them too, and fail the day either description is
 * reworded. The `enabled` bit is what the environment's own kernel decides,
 * and it is what a client reads.
 */
function substance(doc: any) {
  return {
    capabilities: Object.fromEntries(
      Object.entries(doc.capabilities as Record<string, { enabled: boolean }>)
        .map(([k, v]) => [k, v.enabled]),
    ),
    services: doc.services,
    locale: doc.locale,
  };
}

type Boot = {
  serve: (path: string, params?: Record<string, string>) => Promise<any>;
  getOrCreate: ReturnType<typeof vi.fn>;
};

/**
 * Boot a REST server over a control-plane protocol plus a set of per-environment
 * kernels, and serve `/discovery` through the REAL route the router registered.
 */
function boot(opts: {
  environments?: Record<string, any>;
  host: any;
  defaultEnvironmentId?: string;
  resolvesTo?: string;
  withKernelManager?: boolean;
}): Boot {
  const environments = opts.environments ?? {};
  const getOrCreate = vi.fn(async (id: string) => ({
    getServiceAsync: vi.fn(async () => environments[id]),
  }));
  const rest = new RestServer(
    createMockServer() as any,
    opts.host,
    API_CONFIG as any,
    opts.withKernelManager === false ? undefined : ({ getOrCreate } as any),
    undefined, // envRegistry
    opts.defaultEnvironmentId ? () => opts.defaultEnvironmentId : undefined,
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
    undefined, // securityServiceProvider
    opts.resolvesTo
      ? { resolveRequestEnvironmentId: vi.fn().mockResolvedValue(opts.resolvesTo) }
      : undefined,
  );
  rest.registerRoutes();
  const routes = rest.getRouteManager();

  const serve = async (path: string, params: Record<string, string> = {}) => {
    const entry = routes.get('GET', path);
    if (!entry) throw new Error(`route not registered: GET ${path}`);
    const req: IHttpRequest = { params, query: {}, headers: {}, method: 'GET', path };
    let body: any;
    const res: any = { json: (b: any) => { body = b; }, status: () => res, header: () => res };
    await entry.handler(req, res);
    if (body === undefined) throw new Error(`no body served for GET ${path}`);
    return body;
  };
  return { serve, getOrCreate };
}

const SCOPED = '/api/v1/environments/:environmentId/discovery';
const UNSCOPED = '/api/v1/discovery';

// ---------------------------------------------------------------------------
// The scoped route — an invariant restoration. A request that names its
// environment in the URL has no second reading.
// ---------------------------------------------------------------------------

describe('[#9292] scoped /environments/:id/discovery describes THAT environment', () => {
  it('serves the named environment\'s document, not the control plane\'s', async () => {
    const tenantA = realProtocol(tenantAShape);
    const host = realProtocol(hostShape);
    const { serve, getOrCreate } = boot({ environments: { 'tenant-a': tenantA }, host });

    const served = await serve(SCOPED, { environmentId: 'tenant-a' });

    // Positive half: measured against the environment's OWN producer.
    expect(substance(served)).toEqual(substance(await tenantA.getDiscovery()));
    // Negative half: and demonstrably not the host's, which is what it was.
    expect(substance(served)).not.toEqual(substance(await host.getDiscovery()));
    expect(getOrCreate).toHaveBeenCalledWith('tenant-a');
  });

  it('gives two environments named in the URL their own documents', async () => {
    const tenantA = realProtocol(tenantAShape);
    const tenantB = realProtocol(tenantBShape);
    const { serve } = boot({
      environments: { 'tenant-a': tenantA, 'tenant-b': tenantB },
      host: realProtocol(hostShape),
    });

    const docA = await serve(SCOPED, { environmentId: 'tenant-a' });
    const docB = await serve(SCOPED, { environmentId: 'tenant-b' });

    // Before the fix these two were byte-identical — both the host's.
    expect(substance(docA)).not.toEqual(substance(docB));
    expect(substance(docA)).toEqual(substance(await tenantA.getDiscovery()));
    expect(substance(docB)).toEqual(substance(await tenantB.getDiscovery()));
  });

  it('reports capabilities, services and locale from the named environment', async () => {
    const tenantA = realProtocol(tenantAShape);
    const { serve } = boot({ environments: { 'tenant-a': tenantA }, host: realProtocol(hostShape) });

    const served = await serve(SCOPED, { environmentId: 'tenant-a' });

    // Three fields, three different derivations inside the builder — a single
    // field could agree by accident, these three cannot.
    //   engine.transaction  → transactionalBatch
    //   services registry   → the automation slot and its capability
    //   the i18n occupant's own accessors → locale
    expect(served.capabilities.transactionalBatch.enabled).toBe(true);
    expect(served.capabilities.automation.enabled).toBe(true);
    expect(served.services.automation.enabled).toBe(true);
    expect(served.locale.default).toBe('zh-CN');
    // The host's one service must not appear as the tenant's capability — this
    // is the leak direction, stated positively.
    expect(served.capabilities.notifications.enabled).toBe(false);
  });

  it('keeps advertising the named environment in the route strings (realBase)', async () => {
    const { serve } = boot({
      environments: { 'tenant-a': realProtocol(tenantAShape) },
      host: realProtocol(hostShape),
    });

    const served = await serve(SCOPED, { environmentId: 'tenant-a' });

    // This half already followed `req.params.environmentId` and must stay that
    // way — the fix changed which protocol is read, not the substitution.
    expect(served.routes.data).toBe('/api/v1/environments/tenant-a/data');
    expect(served.routes.metadata).toBe('/api/v1/environments/tenant-a/meta');
    expect(served.scoping).toMatchObject({ scoped: true, environmentId: 'tenant-a' });
  });

  it('never mistakes the literal ":environmentId" placeholder for an environment', async () => {
    const { serve, getOrCreate } = boot({
      environments: { 'tenant-a': realProtocol(tenantAShape) },
      host: realProtocol(hostShape),
    });

    // An unsubstituted route pattern is the ABSENCE of an id, not an id: the
    // shared entry point short-circuits on any truthy explicit value, so a
    // placeholder reaching it would send `getOrCreate` after a kernel named
    // after the pattern. Same normalisation, same reason, as probeMcpServeable.
    await serve(SCOPED, { environmentId: ':environmentId' });
    expect(getOrCreate).not.toHaveBeenCalledWith(':environmentId');
  });
});

// ---------------------------------------------------------------------------
// The unscoped route — the established pattern, and the control-plane answer
// preserved exactly where it is the correct one.
// ---------------------------------------------------------------------------

describe('[#9292] unscoped /discovery follows the shared resolution chain', () => {
  it('keeps the control-plane document when no environment resolves at all', async () => {
    const host = realProtocol(hostShape);
    const { serve } = boot({ host, withKernelManager: false });

    // Nothing in scope: no scoped id, no resolver, no default provider. The
    // shared chain returns undefined and `resolveProtocol` falls through to the
    // captured control-plane protocol — this boot is unchanged by the fix.
    expect(substance(await serve(UNSCOPED))).toEqual(substance(await host.getDiscovery()));
  });

  it('follows the single-environment default provider to that kernel', async () => {
    const only = realProtocol(tenantAShape);
    const host = realProtocol(hostShape);
    const { serve, getOrCreate } = boot({
      environments: { 'the-only-env': only },
      host,
      defaultEnvironmentId: 'the-only-env',
    });

    const served = await serve(UNSCOPED);

    // Step 3 of the shared chain is `createSingleEnvironmentPlugin`'s wiring, so
    // a single-environment boot now describes the kernel that serves its data.
    expect(getOrCreate).toHaveBeenCalledWith('the-only-env');
    expect(substance(served)).toEqual(substance(await only.getDiscovery()));
    expect(substance(served)).not.toEqual(substance(await host.getDiscovery()));
  });

  it('follows the host-injected resolver on a hostname-routed multi-tenant host', async () => {
    const tenantA = realProtocol(tenantAShape);
    const host = realProtocol(hostShape);
    const { serve, getOrCreate } = boot({
      environments: { 'tenant-a': tenantA },
      host,
      resolvesTo: 'tenant-a',
    });

    // The ADR-0076 D11④ seam — the same authority the HTTP dispatcher uses, so
    // an unscoped `/discovery` and the data routes beside it describe one kernel.
    const served = await serve(UNSCOPED);
    expect(getOrCreate).toHaveBeenCalledWith('tenant-a');
    expect(substance(served)).toEqual(substance(await tenantA.getDiscovery()));
  });
});
