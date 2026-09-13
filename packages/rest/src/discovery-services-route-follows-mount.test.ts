// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#16674] One deployment, one data address -- `/discovery` must not
// contradict itself.
//
// The defect: `registerDiscoveryEndpoints`' handler rewrote `discovery.routes.*`
// to the paths this server actually mounts and left `discovery.services.*.route`
// carrying the producer's convention literals. Measured on this file's harness
// against the pre-fix source, booting with `crud: { dataPrefix: '/objects' }`
// and reading `GET /api/v1/discovery`:
//
//     routes.data           = "/api/v1/objects"   <- the mounted path
//     services.data.route   = "/api/v1/data"      <- nothing is mounted here
//
// and on an `apiPath: '/backend/api/v9'` boot the same split opened on four
// keys at once (`data`, `metadata`, `ui`, `auth`). A reader that trusts the
// `services` half is sent to a path this deployment serves nothing on, by the
// very document whose job is to say where the routes are (AGENTS.md "Route &
// surface ownership" #4).
//
// WHAT THIS FILE ASSERTS, and why it is shaped this way.
//
//  * It asserts AGREEMENT, not two literals. The subject is "the document does
//    not contradict itself", so every consistency case compares the two halves
//    of the SAME served document against each other. Pinning `services.data.route
//    === '/api/v1/objects'` twice over would pass just as well with the two
//    halves computed apart again, which is the defect.
//  * The prefix cases are DRIVEN, not unit-called: `createRestApiPlugin(config)
//    .start(ctx)` composes the real plugin over a recording host, and the
//    document comes back out of the handler mounted at `GET {base}/discovery`
//    -- the same route the card measured on a live server. The value under test
//    is produced by the real protocol builder and rewritten by the real pass.
//  * The NEGATIVE CONTROL is the load-bearing one. An implementation that
//    rewrites the `services` block unconditionally satisfies every agreement
//    case above while handing every DEFAULT deployment a gratuitous diff -- a
//    `route` key invented on a route-less slot, or an entry rebuilt in a new key
//    order. So the default-config case compares the served `services` block to
//    the producer's own, `JSON.stringify` to `JSON.stringify`: byte-for-byte,
//    key order and key presence included.
//  * `DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS` is a hand-written pairing table in
//    a second package from the producer that defines the pairs, so it is held
//    COMPLETE against that producer here rather than trusted: the pairs are
//    re-derived from a real `getDiscovery()` document and the table must
//    contain every one of them. A newly routed slot reds this pin instead of
//    silently opting out of the mirror.
//
// The `services.*` route-shaped inventory this covers, as the producer emits it
// (`metadata-protocol/src/protocol.ts`), and the disposition of each:
//
//   data, metadata, ui, auth ......... mirrored; these are the four the REST
//                                      substitution pass moves, so these are the
//                                      four that could drift -- and did.
//   analytics, automation, ai, i18n,
//   notification, storage,
//   file-storage ..................... mirrored by the same table, a no-op today:
//                                      the producer derives `routes.X` FROM
//                                      `services.X.route` for these (#14646), and
//                                      this pass never rewrites those route keys.
//                                      In the table so that a future substitution
//                                      carries them automatically.
//   realtime ......................... mirrored when the occupant names a mounted
//                                      channel route; the stock in-process bus
//                                      names none, and no route is invented.
//   cache, queue, job ................ route-LESS by contract (in-process, #4318).
//                                      Never gain a route here; pinned below.
//   search ........................... declares a route with no `ApiRoutesSchema`
//                                      key to follow, so there is nothing to
//                                      mirror from. Left alone.

// Relative imports carry their `.js` extension: under `moduleResolution:
// nodenext` an extension-less one does not resolve and every symbol it names
// becomes `any`.
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { createRestApiPlugin } from './rest-api-plugin.js';
import { DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS } from './rest-server.js';

type Handler = (req: any, res: any) => any;

/**
 * Every `CoreServiceName` slot the protocol's service table knows, plus the
 * non-slot `package` service. A rich boot on purpose: an empty registry would
 * emit `enabled: false` rows with no `route` at all, and every agreement case
 * below would pass vacuously.
 */
const ALL_SLOTS = [
  'metadata', 'data', 'analytics', 'auth', 'automation', 'cache', 'queue', 'job',
  'ui', 'realtime', 'notification', 'ai', 'i18n', 'storage', 'search', 'package',
] as const;

/** A host server whose registrations land in a real handler table. */
function createRecordingServer() {
  const table = new Map<string, Handler>();
  const on = (method: string) => vi.fn((path: string, handler: Handler) => {
    table.set(`${method} ${path}`, handler);
  });
  return {
    table,
    get: on('GET'), post: on('POST'), put: on('PUT'), delete: on('DELETE'), patch: on('PATCH'),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

/** A REAL `getDiscovery()` producer over a described kernel. */
function makeProtocol() {
  const engine: any = {
    registry: { getObject: (_n: string) => undefined, getRegisteredTypes: () => [] },
  };
  const services = new Map<string, any>();
  for (const slot of ALL_SLOTS) {
    services.set(
      slot,
      slot === 'i18n' ? { getDefaultLocale: () => 'en', getLocales: () => ['en'] } : {},
    );
  }
  return new ObjectStackProtocolImplementation(engine as any, () => services);
}

function createCtx(services: Record<string, unknown>) {
  return {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name in services) return services[name];
      throw new Error(`Service '${name}' not found`);
    }),
    getServices: vi.fn(() => new Map(Object.entries(services))),
    hook: vi.fn(),
    trigger: vi.fn().mockResolvedValue(undefined),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getKernel: vi.fn(),
  };
}

/** Match a concrete URL against the table's `:param` patterns. */
function resolveRoute(table: Map<string, Handler>, method: string, url: string) {
  const urlSegs = url.split('/');
  for (const [key, handler] of table) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const patSegs = pattern.split('/');
    if (patSegs.length !== urlSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (patSegs[i].startsWith(':')) params[patSegs[i].slice(1)] = urlSegs[i];
      else if (patSegs[i] !== urlSegs[i]) { ok = false; break; }
    }
    if (ok) return { handler, params };
  }
  return undefined;
}

/** Boot the REST plugin exactly as production does and serve `GET {base}/discovery`. */
async function serveDiscovery(apiConfig: Record<string, unknown>, base: string): Promise<any> {
  const server = createRecordingServer();
  const ctx = createCtx({
    'http.server': server,
    protocol: makeProtocol(),
    package: { list: vi.fn(), get: vi.fn(), publish: vi.fn(), delete: vi.fn() },
    'external-datasource': { listRemoteTables: async () => [{ name: 'customers' }] },
  });
  await createRestApiPlugin(apiConfig as any).start!(ctx as any);

  const entry = resolveRoute(server.table, 'GET', `${base}/discovery`);
  expect(entry, `GET ${base}/discovery must be mounted for this pin to mean anything`).toBeDefined();

  let body: any;
  const res: any = {
    status: () => res,
    json: (b: any) => { body = b; },
    header: () => res,
    send: () => {},
  };
  await entry!.handler(
    { params: entry!.params, query: {}, body: {}, headers: { host: 'example.test' } },
    res,
  );
  expect(body, 'the discovery handler answered nothing').toBeDefined();
  return body;
}

/**
 * Every (route key, slot) pair the served document states twice, with both
 * values present. The subject of the agreement cases below.
 */
function statedTwice(doc: any): Array<{ routeKey: string; slot: string; route: string; service: string }> {
  const out: Array<{ routeKey: string; slot: string; route: string; service: string }> = [];
  for (const [routeKey, slots] of Object.entries(DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS)) {
    const route = doc.routes?.[routeKey];
    if (typeof route !== 'string') continue;
    for (const slot of slots) {
      const service = doc.services?.[slot]?.route;
      if (typeof service !== 'string') continue;
      out.push({ routeKey, slot, route, service });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. the card's own measurement, driven
// ---------------------------------------------------------------------------

describe('#16674 — a moved `crud.dataPrefix` moves BOTH halves of the document', () => {
  it('advertises the mounted data path in `services.data.route`, not the convention literal', async () => {
    const doc = await serveDiscovery({ api: { crud: { dataPrefix: '/objects' } } }, '/api/v1');

    // The half that was already right.
    expect(doc.routes.data).toBe('/api/v1/objects');
    // The half the card measured wrong: 3 occurrences of "/api/v1/data", 0 of
    // "/api/v1/objects", on a server that mounts only the latter.
    expect(doc.services.data.route).toBe('/api/v1/objects');

    // …and the unmounted convention path is gone from both halves, which is the
    // occurrence count the card reported, now zero.
    const bothHalves = JSON.stringify({ routes: doc.routes, services: doc.services });
    expect(bothHalves).not.toContain('"/api/v1/data"');
  });

  it('moves `metadata` on the same terms — the instance was `data`, the cause was the pass', async () => {
    const doc = await serveDiscovery(
      { api: { crud: { dataPrefix: '/objects' }, metadata: { prefix: '/metadata' } } },
      '/api/v1',
    );
    expect(doc.routes.metadata).toBe('/api/v1/metadata');
    expect(doc.services.metadata.route).toBe('/api/v1/metadata');
  });

  it('moves all four rewritten keys when `apiPath` moves the whole surface', async () => {
    const doc = await serveDiscovery({ api: { api: { apiPath: '/backend/api/v9' } } }, '/backend/api/v9');

    for (const [routeKey, slot] of [['data', 'data'], ['metadata', 'metadata'], ['ui', 'ui'], ['auth', 'auth']] as const) {
      expect(doc.routes[routeKey], `routes.${routeKey}`).toContain('/backend/api/v9');
      expect(doc.services[slot].route, `services.${slot}.route`).toBe(doc.routes[routeKey]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. the document does not contradict itself — agreement, not literals
// ---------------------------------------------------------------------------

describe('#16674 — `routes.X` and `services.Y.route` are one answer', () => {
  const CASES: Array<{ name: string; config: Record<string, unknown>; base: string }> = [
    { name: 'default configuration', config: {}, base: '/api/v1' },
    {
      name: 'moved data + metadata prefixes',
      config: { api: { crud: { dataPrefix: '/objects' }, metadata: { prefix: '/metadata' } } },
      base: '/api/v1',
    },
    { name: 'apiPath deployment', config: { api: { api: { apiPath: '/backend/api/v9' } } }, base: '/backend/api/v9' },
  ];

  for (const { name, config, base } of CASES) {
    it(`agrees on every key it states twice — ${name}`, async () => {
      const doc = await serveDiscovery(config, base);
      const pairs = statedTwice(doc);

      // Guard against a vacuous pass: the four keys the substitution pass
      // rewrites must all be present and compared on every one of these boots.
      expect(
        pairs.filter((p) => ['data', 'metadata', 'ui', 'auth'].includes(p.routeKey)).map((p) => p.routeKey).sort(),
        'the four rewritten keys must all be stated twice on this boot',
      ).toEqual(['auth', 'data', 'metadata', 'ui']);

      const disagreements = pairs
        .filter((p) => p.route !== p.service)
        .map((p) => `routes.${p.routeKey}=${p.route} vs services.${p.slot}.route=${p.service}`);
      expect(disagreements, 'one document must not give two addresses for one thing').toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. NEGATIVE CONTROL — a default deployment's document does not move a byte
// ---------------------------------------------------------------------------

describe('#16674 — the mirror is a correction, not a rewrite', () => {
  it('leaves the default-configuration `services` block byte-identical to the producer', async () => {
    const served = await serveDiscovery({}, '/api/v1');
    const produced: any = await (makeProtocol() as any).getDiscovery();

    // `JSON.stringify` on purpose, not `toEqual`: key ORDER and key PRESENCE
    // are the two things an "always rewrite the services block" implementation
    // disturbs while every agreement case above stays green.
    expect(JSON.stringify(served.services)).toBe(JSON.stringify(produced.services));
  });

  it('never invents a `route` on a slot that has no HTTP surface', async () => {
    // Moved prefixes, so the mirror is definitely doing work on this boot.
    const doc = await serveDiscovery(
      { api: { crud: { dataPrefix: '/objects' }, metadata: { prefix: '/metadata' } } },
      '/api/v1',
    );
    // Read it the way a client does — off the serialized document. The
    // producer leaves the `route` KEY present with an `undefined` value on a
    // route-less slot, which `JSON.stringify` drops; what must never appear on
    // the wire is a route STRING.
    const onTheWire = JSON.parse(JSON.stringify(doc.services));
    for (const slot of ['cache', 'queue', 'job', 'realtime']) {
      expect(onTheWire[slot], `services.${slot} must exist for this pin to mean anything`).toBeDefined();
      expect(
        onTheWire[slot].route,
        `services.${slot} declares no HTTP surface; the mirror must not give it one`,
      ).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. the pairing table is held complete against the producer that defines it
// ---------------------------------------------------------------------------

describe('#16674 — `DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS` covers every pair the producer states twice', () => {
  it('names every (route key, slot) pair a real discovery document states twice', async () => {
    const produced: any = await (makeProtocol() as any).getDiscovery();

    // Re-derive the pairing from the producer instead of restating the table:
    // on a producer document `routes.X` IS `services.Y.route` for every paired
    // key, so equal values name the pairs. That is what makes a newly routed
    // slot show up here rather than quietly skipping the mirror.
    const derived: string[] = [];
    for (const [slot, info] of Object.entries(produced.services as Record<string, { route?: string }>)) {
      if (typeof info?.route !== 'string') continue;
      for (const [routeKey, routeValue] of Object.entries(produced.routes as Record<string, unknown>)) {
        if (routeValue === info.route) derived.push(`${routeKey} -> ${slot}`);
      }
    }
    expect(derived.length, 'the producer must state at least one pair twice, or this pin is vacuous')
      .toBeGreaterThan(0);

    const declared = new Set(
      Object.entries(DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS)
        .flatMap(([routeKey, slots]) => slots.map((slot) => `${routeKey} -> ${slot}`)),
    );
    expect(
      derived.filter((pair) => !declared.has(pair)),
      'a route key the producer pairs with a service slot is missing from the mirror table',
    ).toEqual([]);
  });

  it('names only slots the producer actually emits — a misspelled slot is a silent no-op', async () => {
    const produced: any = await (makeProtocol() as any).getDiscovery();
    const emitted = new Set(Object.keys(produced.services as Record<string, unknown>));
    const unknown = Object.values(DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS)
      .flat()
      .filter((slot) => !emitted.has(slot));
    expect(unknown, 'these slot names match nothing the producer emits, so the mirror silently skips them')
      .toEqual([]);
  });
});
