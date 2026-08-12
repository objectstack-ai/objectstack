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
 * captured `fetch` — the wire statement, without needing a server. The base
 * path is asserted against the spec schemas the server itself resolves from
 * (`RestApiConfigSchema` + `CrudEndpointsConfigSchema`), never against a second
 * copy of the literal `/api/v1/data`: a pin that hard-codes the string it is
 * guarding goes green the day the schema moves and the adapter does not.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RestApiConfigSchema, CrudEndpointsConfigSchema } from '@objectstack/spec/api';
import type * as QA from '@objectstack/spec/qa';
import { HttpTestAdapter } from './http-adapter.js';

const BASE_URL = 'http://localhost:3000';

/** What `RestServer` composes: `getApiBasePath()` + `crud.dataPrefix`. */
const EXPECTED_DATA_PATH = (() => {
  const api = RestApiConfigSchema.parse({});
  const crud = CrudEndpointsConfigSchema.parse({});
  return `${api.apiPath ?? `${api.basePath}/${api.version}`}${crud.dataPrefix}`;
})();

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  calls = [];
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
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function action(type: QA.TestActionType, target: string, payload?: Record<string, unknown>): QA.TestAction {
  return { type, target, ...(payload ? { payload } : {}) } as QA.TestAction;
}

async function run(a: QA.TestAction): Promise<Call> {
  const adapter = new HttpTestAdapter(BASE_URL);
  await adapter.execute(a, {});
  expect(calls).toHaveLength(1);
  return calls[0];
}

describe('[#7848] HttpTestAdapter record action types reach the served route', () => {
  it('derives the data path from the schemas the server resolves from', () => {
    // Not a tautology: this is the one assertion that would fail if the
    // adapter went back to writing the prefix out by hand.
    expect(EXPECTED_DATA_PATH).toBe('/api/v1/data');
  });

  it('create_record POSTs the collection URL', async () => {
    const call = await run(action('create_record', 'crm_account', { name: 'Acme' }));
    expect(call.url).toBe(`${BASE_URL}${EXPECTED_DATA_PATH}/crm_account`);
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ name: 'Acme' });
  });

  it('read_record GETs the record URL', async () => {
    const call = await run(action('read_record', 'crm_account', { id: 'rec_1' }));
    expect(call.url).toBe(`${BASE_URL}${EXPECTED_DATA_PATH}/crm_account/rec_1`);
    expect(call.method).toBe('GET');
  });

  it('update_record PATCHes the record URL — the route has no PUT sibling', async () => {
    const call = await run(action('update_record', 'crm_account', { id: 'rec_1', name: 'Acme II' }));
    expect(call.url).toBe(`${BASE_URL}${EXPECTED_DATA_PATH}/crm_account/rec_1`);
    expect(call.method).toBe('PATCH');
    // `id` addressed the record; the body is the field patch, not a column write.
    expect(call.body).toEqual({ name: 'Acme II' });
  });

  it('delete_record DELETEs the record URL', async () => {
    const call = await run(action('delete_record', 'crm_account', { id: 'rec_1' }));
    expect(call.url).toBe(`${BASE_URL}${EXPECTED_DATA_PATH}/crm_account/rec_1`);
    expect(call.method).toBe('DELETE');
  });

  it('query_records POSTs the QueryAST to the collection query URL', async () => {
    const call = await run(action('query_records', 'crm_account', { filters: [['name', '=', 'Acme']] }));
    expect(call.url).toBe(`${BASE_URL}${EXPECTED_DATA_PATH}/crm_account/query`);
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ filters: [['name', '=', 'Acme']] });
  });

  it('percent-encodes the record id so an id with a slash cannot forge a path', async () => {
    const call = await run(action('read_record', 'crm_account', { id: 'a/b c' }));
    expect(call.url).toBe(`${BASE_URL}${EXPECTED_DATA_PATH}/crm_account/a%2Fb%20c`);
  });

  it('no record action type addresses the old unversioned `/api/data` path', async () => {
    for (const type of ['create_record', 'read_record', 'update_record', 'delete_record', 'query_records'] as const) {
      calls = [];
      const adapter = new HttpTestAdapter(BASE_URL);
      await adapter.execute(action(type, 'crm_account', { id: 'rec_1' }), {});
      expect(calls[0].url.startsWith(`${BASE_URL}/api/data/`)).toBe(false);
    }
  });
});

describe('[#7848] the three non-record action types are unchanged', () => {
  it('api_call resolves a relative target against the base URL', async () => {
    const call = await run(action('api_call', '/api/v1/discovery', { method: 'GET' }));
    expect(call.url).toBe(`${BASE_URL}/api/v1/discovery`);
    expect(call.method).toBe('GET');
  });

  it('api_call leaves an absolute target alone', async () => {
    const call = await run(action('api_call', 'http://example.test/health', { method: 'GET' }));
    expect(call.url).toBe('http://example.test/health');
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
    expect(calls[0].headers['Authorization']).toBe('Bearer tok_123');
    expect(calls[0].headers['X-Run-As']).toBe('alice');
  });
});
