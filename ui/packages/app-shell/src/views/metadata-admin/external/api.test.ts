// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listRemoteTables,
  generateObjectDraft,
  refreshCatalog,
  validateDatasource,
  importObjectDraft,
  ExternalServiceUnavailableError,
  type ObjectDraft,
} from './api';

/**
 * Build a minimal Response-like object the client's readers accept.
 *
 * `headers` is real (objectui#4467): these calls go out through
 * `createAuthenticatedFetch`, which reads `set-auth-token` off every API
 * response to adopt a session rotation the server declares — the same capture
 * the auth lane has always done. A fake that omits `headers` is not a
 * `Response`, and the cast is the only reason the compiler ever believed it
 * was; an empty `Headers` keeps the fake honest without asserting anything
 * about rotation.
 */
function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? status < 400,
    status,
    statusText: 'STATUS',
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

/*
 * The WIRE shapes of the five `/datasources/:name/external/*` routes
 * (objectui#11628). Every body there is written by the shared `sendOk` /
 * `sendError` of `@objectstack/types` (`registerExternalDatasourceRoutes` in
 * `@objectstack/rest`): a success is `{ success: true, data }` with the
 * route's payload one level down, and a refusal is the ADR-0112 envelope
 * `{ success: false, error: { code, message } }`.
 *
 * These fixtures used to be the BARE payloads (`{ tables }`, `{ draft }`, a
 * string `error`), which is the shape the client read and the server never
 * sent — so this file stayed green while the live panel listed no tables,
 * showed no catalog timestamp and crashed on Validation.
 */
const ok = (data: unknown) => ({ success: true, data });
const refusal = (code: string, message: string) => ({ success: false, error: { code, message } });

function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(typeof input === 'string' ? input : String(input), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('external datasource api', () => {
  it('lists remote tables out of the { success, data: { tables } } envelope', async () => {
    const spy = stubFetch(() =>
      jsonResponse(
        ok({
          tables: [
            { name: 'customers', columnCount: 7 },
            { name: 'orders', columnCount: 7 },
          ],
        }),
      ),
    );
    const tables = await listRemoteTables('showcase_external');
    expect(tables).toEqual([
      { name: 'customers', columnCount: 7 },
      { name: 'orders', columnCount: 7 },
    ]);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('/api/v1/datasources/showcase_external/external/tables');
  });

  it('passes the ?schema filter through', async () => {
    const spy = stubFetch(() => jsonResponse(ok({ tables: [] })));
    await expect(listRemoteTables('warehouse', { schema: 'analytics' })).resolves.toEqual([]);
    expect(String(spy.mock.calls[0][0])).toContain('tables?schema=analytics');
  });

  it('POSTs draft generation with the remote schema option and reads data.draft', async () => {
    const spy = stubFetch(() =>
      jsonResponse(
        ok({
          draft: { name: 'orders', datasource: 'warehouse', definition: {}, source: '', review: [] },
        }),
      ),
    );
    const draft = await generateObjectDraft('warehouse', 'orders', { remoteSchema: 'public' });
    expect(draft.name).toBe('orders');
    expect(draft.review).toEqual([]);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/external/tables/orders/draft');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ remoteSchema: 'public' });
  });

  it('refreshes the catalog and reads data.catalog, snapshotAt included', async () => {
    const catalog = {
      name: 'showcase_external_catalog',
      datasource: 'showcase_external',
      snapshotAt: '2026-10-05T02:00:00.000Z',
      tables: [],
    };
    const spy = stubFetch(() => jsonResponse(ok({ catalog })));
    const got = await refreshCatalog('showcase_external');
    expect(got).toEqual(catalog);
    expect(got.snapshotAt).toBe('2026-10-05T02:00:00.000Z');
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/datasources/showcase_external/external/refresh-catalog');
    expect(init?.method).toBe('POST');
  });

  it('validates and reads the { ok, results } verdict out of data', async () => {
    const results = [
      { object: 'showcase_ext_customer', ok: true, diffs: [] },
      { object: 'showcase_ext_order', ok: true, diffs: [] },
    ];
    const spy = stubFetch(() => jsonResponse(ok({ ok: true, results })));
    const report = await validateDatasource('showcase_external');
    expect(report).toEqual({ ok: true, results });
    expect(report.results).toHaveLength(2);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/datasources/showcase_external/external/validate');
    expect(init?.method).toBe('POST');
  });

  it('refuses a 200 that is not the declared envelope instead of reading it as empty', async () => {
    // The bare payload this file used to mock. Read through the old client it
    // was "no tables"; it is not a body these routes send, so it is a loud
    // failure naming the route rather than an empty list.
    stubFetch(() => jsonResponse({ tables: [{ name: 'orders', columnCount: 7 }] }));
    const err = await listRemoteTables('warehouse').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ExternalServiceUnavailableError);
    expect((err as Error).message).toContain('/external/tables');
  });

  it.each([
    ['listRemoteTables', () => listRemoteTables('warehouse')],
    ['generateObjectDraft', () => generateObjectDraft('warehouse', 'orders')],
    ['refreshCatalog', () => refreshCatalog('warehouse')],
    ['validateDatasource', () => validateDatasource('warehouse')],
  ])('%s maps 503 SERVICE_UNAVAILABLE to the typed error', async (_name, call) => {
    stubFetch(() =>
      jsonResponse(
        refusal('SERVICE_UNAVAILABLE', 'The external-datasource service is not available.'),
        { status: 503 },
      ),
    );
    await expect(call()).rejects.toBeInstanceOf(ExternalServiceUnavailableError);
  });

  it('surfaces the refusal envelope message and code, never "[object Object]"', async () => {
    stubFetch(() =>
      jsonResponse(refusal('EXTERNAL_DATASOURCE_ERROR', 'no such schema: analytics'), {
        status: 400,
      }),
    );
    const err = await validateDatasource('warehouse').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ExternalServiceUnavailableError);
    expect((err as Error).message).not.toContain('[object Object]');
    expect((err as Error).message).toContain('no such schema: analytics');
    expect((err as Error).message).toContain('EXTERNAL_DATASOURCE_ERROR');
  });

  it('a 503 whose envelope names another code is not read as "federation not wired"', async () => {
    stubFetch(() => jsonResponse(refusal('INTERNAL_ERROR', 'Internal server error'), { status: 503 }));
    const err = await listRemoteTables('warehouse').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ExternalServiceUnavailableError);
    expect((err as Error).message).toContain('INTERNAL_ERROR');
  });

  it('falls back to the HTTP status when a failure carries no readable body', async () => {
    stubFetch(() => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }) as unknown as Response);
    await expect(refreshCatalog('warehouse')).rejects.toThrow('502 Bad Gateway');
  });

  it('imports a draft as an object via PUT /meta/object/:name', async () => {
    // The `/meta` door's own success body — the save result, no `data`.
    const spy = stubFetch(() =>
      jsonResponse({ success: true, version: 'v1', seq: 1, state: 'active', message: 'Saved' }),
    );
    const draft: ObjectDraft = {
      name: 'orders',
      datasource: 'warehouse',
      definition: { name: 'orders', label: 'Orders' },
      source: '',
      review: [],
    };
    await importObjectDraft(draft);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/meta/object/orders');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'orders', label: 'Orders' });
  });

  /*
   * The `/meta` door answers a refused save in two dialects, both measured
   * live: the capability gate's nested `{ error: { code, message } }` and the
   * spec-validation flat `{ error: '<sentence>', code }`.
   */
  const importDraft: ObjectDraft = {
    name: 'orders',
    datasource: 'warehouse',
    definition: { name: 'orders', label: 'Orders' },
    source: '',
    review: [],
  };

  it('surfaces the /meta capability refusal (nested error) instead of "[object Object]"', async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Saving a metadata item requires the `manage_metadata` capability.',
          },
        },
        { status: 403 },
      ),
    );
    const err = await importObjectDraft(importDraft).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('[object Object]');
    expect((err as Error).message).toContain('manage_metadata');
    expect((err as Error).message).toContain('FORBIDDEN');
  });

  it('surfaces the /meta spec-validation refusal (flat string error)', async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: 'object/orders failed spec validation: 1 issue — fields [invalid_type]',
          code: 'INVALID_METADATA',
        },
        { status: 422 },
      ),
    );
    await expect(importObjectDraft(importDraft)).rejects.toThrow(
      'object/orders failed spec validation',
    );
  });
});
