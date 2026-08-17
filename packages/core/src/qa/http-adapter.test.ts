// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#7848) — the record action types address the route the server ACTUALLY
 * serves.
 *
 * `HttpTestAdapter` built `${baseUrl}/api/data/:object`. A stock server serves
 * `{apiPath}/data/:object` with `apiPath` = `/api/v1`, so every record-shaped
 * member of `TestActionTypeSchema` was one version segment short. Measured
 * verbatim against a booted showcase while authoring the `qa` checklist item
 * for #7347:
 *
 *   create_record  → HTTP Error 404: {"error":"Not found"}
 *   read_record    → 404
 *   update_record  → 404, and `PUT` where the route is `PATCH` — wrong twice
 *   delete_record  → 404
 *   query_records  → 404
 *   api_call / wait → executed (which is why the gap survived: everything the
 *                     Quality Protocol had been used for was expressible through
 *                     `api_call`)
 *   run_script     → no adapter branch, throws loudly (liveness ledger)
 *
 * So 5 of 8 declared action types could not do the thing their name promises,
 * and the suite author reading that 404 has every reason to think it is their
 * own URL rather than a platform defect.
 *
 * What these tests pin is the URL and the VERB per action type, against a
 * captured `fetch` — the wire statement, without needing a server.
 *
 * PIN (#7983) — the mount is now RESOLVED from the server, not assumed.
 *
 * The adapter asks `{apiBase}/discovery` once per run and addresses whatever
 * `routes.data` advertises; the schema-derived convention is the fallback, and
 * taking it is announced loudly (Route & surface ownership §3). So the record
 * URLs below are pinned against a discovery document that deliberately
 * advertises a NON-default mount — a pin written against the literal
 * `/api/v1/data` would pass while the probe was ignored entirely, and would go
 * red for #9292's reasons rather than this adapter's. The convention pins keep
 * asserting the schemas (`RestApiConfigSchema` + `CrudEndpointsConfigSchema`),
 * never a second copy of the literal they produce.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RestApiConfigSchema, CrudEndpointsConfigSchema } from '@objectstack/spec/api';
import type * as QA from '@objectstack/spec/qa';
import { HttpTestAdapter } from './http-adapter.js';

const BASE_URL = 'http://localhost:3000';

/** What `RestServer.getApiBasePath()` evaluates. */
const EXPECTED_API_BASE = (() => {
  const api = RestApiConfigSchema.parse({});
  return api.apiPath ?? `${api.basePath}/${api.version}`;
})();

/** What `RestServer` composes: `getApiBasePath()` + `crud.dataPrefix`. */
const EXPECTED_DATA_PATH = (() => {
  const crud = CrudEndpointsConfigSchema.parse({});
  return `${EXPECTED_API_BASE}${crud.dataPrefix}`;
})();

/** Where `registerDiscoveryEndpoints` mounts the document the adapter probes. */
const EXPECTED_DISCOVERY_URL = `${BASE_URL}${EXPECTED_API_BASE}/discovery`;

/**
 * The mount this suite's server advertises — deliberately NOT the convention,
 * so every record-URL assertion below fails if the probe is ignored.
 */
const ADVERTISED_DATA_PATH = '/api/v1/objects';

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;
let warnings: string[];

/** What the discovery probe gets back; per-test overridable. */
let discoveryReply: () => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A discovery document shaped like the one `@objectstack/rest` answers. */
function discoveryDocument(routes: Record<string, unknown>): Response {
  return jsonResponse({ version: 'v1', apiName: 'ObjectStack', routes });
}

beforeEach(() => {
  calls = [];
  warnings = [];
  discoveryReply = () => discoveryDocument({ data: ADVERTISED_DATA_PATH, metadata: '/api/v1/meta' });
  // `input` is deliberately `unknown`: this package's tsc program has no DOM lib,
  // so `RequestInfo` does not resolve here — and the assertions want the URL as a
  // string anyway.
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (String(input) === EXPECTED_DISCOVERY_URL) return discoveryReply();
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function action(type: QA.TestActionType, target: string, payload?: Record<string, unknown>): QA.TestAction {
  return { type, target, ...(payload ? { payload } : {}) } as QA.TestAction;
}

/** Every call the adapter made that was not the one-per-run discovery probe. */
function actionCalls(): Call[] {
  return calls.filter((c) => c.url !== EXPECTED_DISCOVERY_URL);
}

async function run(a: QA.TestAction): Promise<Call> {
  const adapter = new HttpTestAdapter(BASE_URL);
  await adapter.execute(a, {});
  const acted = actionCalls();
  expect(acted).toHaveLength(1);
  return acted[0];
}

describe('[#7848] HttpTestAdapter record action types reach the served route', () => {
  it('derives the convention from the schemas the server resolves from', () => {
    // Not a tautology: this is the one assertion that would fail if the
    // adapter went back to writing the prefix out by hand.
    expect(EXPECTED_DATA_PATH).toBe('/api/v1/data');
    expect(EXPECTED_API_BASE).toBe('/api/v1');
  });

  it('create_record POSTs the collection URL', async () => {
    const call = await run(action('create_record', 'crm_account', { name: 'Acme' }));
    expect(call.url).toBe(`${BASE_URL}${ADVERTISED_DATA_PATH}/crm_account`);
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ name: 'Acme' });
  });

  it('read_record GETs the record URL', async () => {
    const call = await run(action('read_record', 'crm_account', { id: 'rec_1' }));
    expect(call.url).toBe(`${BASE_URL}${ADVERTISED_DATA_PATH}/crm_account/rec_1`);
    expect(call.method).toBe('GET');
  });

  it('update_record PATCHes the record URL — the route has no PUT sibling', async () => {
    const call = await run(action('update_record', 'crm_account', { id: 'rec_1', name: 'Acme II' }));
    expect(call.url).toBe(`${BASE_URL}${ADVERTISED_DATA_PATH}/crm_account/rec_1`);
    expect(call.method).toBe('PATCH');
    // `id` addressed the record; the body is the field patch, not a column write.
    expect(call.body).toEqual({ name: 'Acme II' });
  });

  it('delete_record DELETEs the record URL', async () => {
    const call = await run(action('delete_record', 'crm_account', { id: 'rec_1' }));
    expect(call.url).toBe(`${BASE_URL}${ADVERTISED_DATA_PATH}/crm_account/rec_1`);
    expect(call.method).toBe('DELETE');
  });

  it('query_records POSTs the QueryAST to the collection query URL', async () => {
    const call = await run(action('query_records', 'crm_account', { filters: [['name', '=', 'Acme']] }));
    expect(call.url).toBe(`${BASE_URL}${ADVERTISED_DATA_PATH}/crm_account/query`);
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ filters: [['name', '=', 'Acme']] });
  });

  it('percent-encodes the record id so an id with a slash cannot forge a path', async () => {
    const call = await run(action('read_record', 'crm_account', { id: 'a/b c' }));
    expect(call.url).toBe(`${BASE_URL}${ADVERTISED_DATA_PATH}/crm_account/a%2Fb%20c`);
  });

  it('no record action type addresses the old unversioned `/api/data` path', async () => {
    for (const type of ['create_record', 'read_record', 'update_record', 'delete_record', 'query_records'] as const) {
      calls = [];
      const adapter = new HttpTestAdapter(BASE_URL);
      await adapter.execute(action(type, 'crm_account', { id: 'rec_1' }), {});
      expect(actionCalls()[0].url.startsWith(`${BASE_URL}/api/data/`)).toBe(false);
    }
  });
});

describe('[#7983] the data mount is resolved from the server, once per run', () => {
  it('probes the discovery document at the base path the server mounts it under', async () => {
    await run(action('create_record', 'crm_account', { name: 'Acme' }));
    const probes = calls.filter((c) => c.url === EXPECTED_DISCOVERY_URL);
    expect(probes).toHaveLength(1);
    expect(probes[0].method).toBe('GET');
  });

  it('addresses whatever routes.data advertises — a re-prefixed mount is reached', async () => {
    discoveryReply = () => discoveryDocument({ data: '/api/2026-01/records' });
    const call = await run(action('create_record', 'crm_account', { name: 'Acme' }));
    expect(call.url).toBe(`${BASE_URL}/api/2026-01/records/crm_account`);
  });

  it('probes ONCE per adapter, however many record actions run', async () => {
    const adapter = new HttpTestAdapter(BASE_URL);
    await adapter.execute(action('create_record', 'crm_account', { name: 'Acme' }), {});
    await adapter.execute(action('read_record', 'crm_account', { id: 'rec_1' }), {});
    await adapter.execute(action('query_records', 'crm_account', {}), {});
    expect(calls.filter((c) => c.url === EXPECTED_DISCOVERY_URL)).toHaveLength(1);
    expect(actionCalls()).toHaveLength(3);
  });

  it('probes once even when record actions start concurrently', async () => {
    const adapter = new HttpTestAdapter(BASE_URL);
    await Promise.all([
      adapter.execute(action('create_record', 'crm_account', { name: 'A' }), {}),
      adapter.execute(action('create_record', 'crm_account', { name: 'B' }), {}),
      adapter.execute(action('read_record', 'crm_account', { id: 'rec_1' }), {}),
    ]);
    expect(calls.filter((c) => c.url === EXPECTED_DISCOVERY_URL)).toHaveLength(1);
  });

  it('sends the bearer token on the probe — a host that gates discovery still answers', async () => {
    const adapter = new HttpTestAdapter(BASE_URL, 'tok_123');
    await adapter.execute(action('read_record', 'crm_account', { id: 'rec_1' }), {});
    const probe = calls.find((c) => c.url === EXPECTED_DISCOVERY_URL)!;
    expect(probe.headers['Authorization']).toBe('Bearer tok_123');
  });

  it('reads the dispatcher bridge\'s `{ data: … }` envelope as well as the bare document', async () => {
    discoveryReply = () => jsonResponse({ data: { routes: { data: '/api/v1/things' } } });
    const call = await run(action('read_record', 'crm_account', { id: 'rec_1' }));
    expect(call.url).toBe(`${BASE_URL}/api/v1/things/crm_account/rec_1`);
  });

  it('says nothing when the probe answered — no false alarm on a stock host', async () => {
    await run(action('create_record', 'crm_account', { name: 'Acme' }));
    expect(warnings).toEqual([]);
  });
});

describe('[#7983] falling back to the convention degrades LOUDLY', () => {
  /** Each row is a way the probe fails to settle the mount. */
  const failures: Array<[label: string, reply: () => Response, evidence: RegExp]> = [
    ['discovery is not mounted (404)', () => jsonResponse({ error: 'Not found' }, 404), /answered 404/],
    ['discovery is disabled (503)', () => jsonResponse({ error: 'nope' }, 503), /answered 503/],
    ['the document carries no routes.data', () => discoveryDocument({ metadata: '/api/v1/meta' }), /carried no routes\.data/],
    ['routes.data is not a usable path', () => discoveryDocument({ data: '' }), /carried no routes\.data/],
  ];

  for (const [label, reply, evidence] of failures) {
    it(`falls back and names the mount when ${label}`, async () => {
      discoveryReply = reply;
      const call = await run(action('create_record', 'crm_account', { name: 'Acme' }));
      expect(call.url).toBe(`${BASE_URL}${EXPECTED_DATA_PATH}/crm_account`);
      expect(warnings).toHaveLength(1);
      // The mount it resolved…
      expect(warnings[0]).toContain(`${BASE_URL}${EXPECTED_DATA_PATH}`);
      // …why it resolved that way…
      expect(warnings[0]).toMatch(evidence);
      expect(warnings[0]).toContain(EXPECTED_DISCOVERY_URL);
      // …and the remedy, which is the part a bare 404 never carries.
      expect(warnings[0]).toContain('api_call');
      expect(warnings[0]).toContain('api.apiPath');
    });
  }

  it('falls back when the host cannot be reached at all', async () => {
    discoveryReply = () => { throw new Error('ECONNREFUSED'); };
    const call = await run(action('read_record', 'crm_account', { id: 'rec_1' }));
    expect(call.url).toBe(`${BASE_URL}${EXPECTED_DATA_PATH}/crm_account/rec_1`);
    expect(warnings[0]).toContain('ECONNREFUSED');
  });

  it('warns ONCE per run, not once per action', async () => {
    discoveryReply = () => jsonResponse({ error: 'Not found' }, 404);
    const adapter = new HttpTestAdapter(BASE_URL);
    await adapter.execute(action('create_record', 'crm_account', { name: 'Acme' }), {});
    await adapter.execute(action('read_record', 'crm_account', { id: 'rec_1' }), {});
    expect(warnings).toHaveLength(1);
  });

  it('⛔ never probes /.well-known/objectstack — it advertises the dispatcher prefix, not the REST mount', async () => {
    discoveryReply = () => jsonResponse({ error: 'Not found' }, 404);
    await run(action('create_record', 'crm_account', { name: 'Acme' }));
    expect(calls.some((c) => c.url.includes('/.well-known/'))).toBe(false);
  });
});

describe('[#7983] a failed record action carries the mount it addressed', () => {
  it('appends the mount and its provenance to a 404', async () => {
    discoveryReply = () => jsonResponse({ error: 'Not found' }, 404);
    fetchMock.mockImplementation(async (input: unknown) => {
      if (String(input) === EXPECTED_DISCOVERY_URL) return jsonResponse({ error: 'Not found' }, 404);
      return jsonResponse({ error: 'Not found' }, 404);
    });
    const adapter = new HttpTestAdapter(BASE_URL);
    await expect(adapter.execute(action('create_record', 'crm_account', { name: 'Acme' }), {})).rejects.toThrow(
      /HTTP Error 404: .*record actions addressed http:\/\/localhost:3000\/api\/v1\/data \(data mount assumed by convention/,
    );
  });

  it('names discovery as the source when discovery answered', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      if (String(input) === EXPECTED_DISCOVERY_URL) {
        return discoveryDocument({ data: ADVERTISED_DATA_PATH });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    const adapter = new HttpTestAdapter(BASE_URL);
    await expect(adapter.execute(action('read_record', 'crm_account', { id: 'rec_1' }), {})).rejects.toThrow(
      /record actions addressed http:\/\/localhost:3000\/api\/v1\/objects \(data mount resolved from discovery/,
    );
  });

  it('leaves a non-routing failure undecorated — the server\'s own message stands alone', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      if (String(input) === EXPECTED_DISCOVERY_URL) {
        return discoveryDocument({ data: ADVERTISED_DATA_PATH });
      }
      return jsonResponse({ error: 'name is required' }, 422);
    });
    const adapter = new HttpTestAdapter(BASE_URL);
    const err = await adapter
      .execute(action('create_record', 'crm_account', {}), {})
      .then(() => undefined, (e: Error) => e);
    expect(err?.message).toBe('HTTP Error 422: {"error":"name is required"}');
  });
});

describe('[#7848] the three non-record action types are unchanged', () => {
  it('api_call resolves a relative target against the base URL', async () => {
    // Not routed through `run()`: this target IS the discovery path, and the
    // helper filters that URL out as the probe. `api_call` never probes, so
    // the single recorded call is the action's own — which is the point.
    const adapter = new HttpTestAdapter(BASE_URL);
    await adapter.execute(action('api_call', `${EXPECTED_API_BASE}/discovery`, { method: 'GET' }), {});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(EXPECTED_DISCOVERY_URL);
    expect(calls[0].method).toBe('GET');
  });

  it('api_call leaves an absolute target alone', async () => {
    const call = await run(action('api_call', 'http://example.test/health', { method: 'GET' }));
    expect(call.url).toBe('http://example.test/health');
  });

  it('[#7983] api_call issues NO discovery probe — it takes the path it is given', async () => {
    const adapter = new HttpTestAdapter(BASE_URL);
    await adapter.execute(action('api_call', '/api/2026-01/data/crm_account', { method: 'GET' }), {});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}/api/2026-01/data/crm_account`);
  });

  it('[#7983] an api_call failure is not decorated with a mount it never used', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'Not found' }, 404));
    const adapter = new HttpTestAdapter(BASE_URL);
    const err = await adapter
      .execute(action('api_call', '/nope', { method: 'GET' }), {})
      .then(() => undefined, (e: Error) => e);
    expect(err?.message).toBe('HTTP Error 404: {"error":"Not found"}');
  });

  it('wait resolves without touching the network', async () => {
    const adapter = new HttpTestAdapter(BASE_URL);
    const result = await adapter.execute(action('wait', 'n/a', { duration: 1 }), {});
    expect(result).toEqual({ waited: 1 });
    expect(calls).toHaveLength(0);
  });

  it('run_script still throws — no adapter branch, and this PR does not add one', async () => {
    const adapter = new HttpTestAdapter(BASE_URL);
    await expect(adapter.execute(action('run_script', 'doThing'), {})).rejects.toThrow(
      /Unsupported action type in HttpAdapter: run_script/,
    );
  });
});

describe('[#7848] auth and impersonation headers still ride along', () => {
  it('sends the bearer token and X-Run-As', async () => {
    const adapter = new HttpTestAdapter(BASE_URL, 'tok_123');
    await adapter.execute(
      { type: 'create_record', target: 'crm_account', payload: { name: 'Acme' }, user: 'alice' } as QA.TestAction,
      {},
    );
    const call = actionCalls()[0];
    expect(call.headers['Authorization']).toBe('Bearer tok_123');
    expect(call.headers['X-Run-As']).toBe('alice');
  });
});
