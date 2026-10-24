/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

/** Build an adapter whose fetch is a spy returning the given Response. */
function makeDS(fetchImpl: any) {
  const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
  ds.connected = true;
  ds.connectionState = 'connected';
  return ds;
}

function csvResponse(body = 'ID,Name\n1,Acme') {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv' } });
}

describe('ObjectStackAdapter.exportDownload', () => {
  it('GETs the /export route with format, fields, orderby, header and limit', async () => {
    // Typed like `fetch` so `fetchImpl.mock.calls[0]` is `[url, init]` rather
    // than an empty tuple (the zero-arg impl would otherwise infer `never`).
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => csvResponse());
    const ds = makeDS(fetchImpl);

    const blob = await ds.exportDownload('task', {
      format: 'xlsx',
      fields: ['title', 'owner'],
      sort: [{ field: 'title', direction: 'desc' }, { field: 'owner' }],
      includeHeaders: false,
      limit: 5000,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/v1/data/task/export');
    expect(parsed.searchParams.get('format')).toBe('xlsx');
    expect(parsed.searchParams.get('fields')).toBe('title,owner');
    // direction defaults to asc when omitted.
    expect(parsed.searchParams.get('orderby')).toBe('title:desc,owner:asc');
    expect(parsed.searchParams.get('header')).toBe('false');
    expect(parsed.searchParams.get('limit')).toBe('5000');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('defaults to csv and omits optional params when not provided', async () => {
    // Typed like `fetch` so `fetchImpl.mock.calls[0]` is `[url, init]` rather
    // than an empty tuple (the zero-arg impl would otherwise infer `never`).
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => csvResponse());
    const ds = makeDS(fetchImpl);

    await ds.exportDownload('task', {});

    const [url] = fetchImpl.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('format')).toBe('csv');
    expect(parsed.searchParams.get('fields')).toBeNull();
    expect(parsed.searchParams.get('orderby')).toBeNull();
    expect(parsed.searchParams.get('header')).toBeNull();
    expect(parsed.searchParams.get('limit')).toBeNull();
  });

  it('serializes the filter to a JSON AST query param', async () => {
    // Typed like `fetch` so `fetchImpl.mock.calls[0]` is `[url, init]` rather
    // than an empty tuple (the zero-arg impl would otherwise infer `never`).
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => csvResponse());
    const ds = makeDS(fetchImpl);

    await ds.exportDownload('task', { filter: [['status', '=', 'open']] });

    const [url] = fetchImpl.mock.calls[0];
    const raw = new URL(url).searchParams.get('filter');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual([['status', '=', 'open']]);
  });

  it('throws an error carrying the server message and status on failure', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'Permission denied' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const ds = makeDS(fetchImpl);

    await expect(ds.exportDownload('task', { format: 'csv' })).rejects.toMatchObject({
      message: 'Permission denied',
      status: 403,
    });
  });
});

/**
 * `search` — the half of a list this request could not carry.
 *
 * The route mirrored `filter` and `orderby` only, so an export taken while a
 * search was active downloaded the UNSEARCHED superset: more rows than the
 * screen showed, in a file that looks authoritative. Server half:
 * objectstack#4230.
 */
describe('ObjectStackAdapter.exportDownload — search', () => {
  const paramsFor = async (request: Record<string, unknown>) => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => csvResponse());
    await makeDS(fetchImpl).exportDownload('task', request);
    return new URL(fetchImpl.mock.calls[0][0]).searchParams;
  };

  it('sends the term as `search`', async () => {
    expect((await paramsFor({ search: 'acme' })).get('search')).toBe('acme');
  });

  it('sends `searchFields` as a comma list alongside the term', async () => {
    const p = await paramsFor({ search: 'acme', searchFields: ['name', 'stage'] });
    expect(p.get('searchFields')).toBe('name,stage');
  });

  it('omits both when no term is given — `searchFields` alone means nothing', async () => {
    const p = await paramsFor({ searchFields: ['name'] });
    expect(p.get('search')).toBeNull();
    expect(p.get('searchFields')).toBeNull();
  });

  it('treats a whitespace-only term as absent, and trims a real one', async () => {
    expect((await paramsFor({ search: '   ' })).get('search')).toBeNull();
    expect((await paramsFor({ search: '  acme  ' })).get('search')).toBe('acme');
  });

  it('carries search and filter together — neither replaces the other', async () => {
    const p = await paramsFor({ search: 'acme', filter: [['status', '=', 'open']] });
    expect(p.get('search')).toBe('acme');
    expect(JSON.parse(p.get('filter')!)).toEqual([['status', '=', 'open']]);
  });
});

/**
 * `exportDownload` -- the error envelope the operator actually reads
 * (objectui#9594).
 *
 * A console operator clicking "export to CSV" without the `allowExport` grant
 * was shown one word: `Forbidden`. The server had answered a full sentence
 * naming the object and the user, in the flat `{ code, error: <string> }`
 * dialect the old ladder could not read -- it looked for `error.message` and
 * `message`, found neither, and fell through to `res.statusText`.
 *
 * The 401 case is the CONTROL, not a duplicate: same route, one status apart,
 * flat envelope too, but its sentence lives in `message` while its `error` key
 * holds the code word. It rendered correctly all along, which is what shows the
 * producer was never at fault -- and it pins the rung order, because reading a
 * string `error` before `message` would make this 401 render the bare word
 * `UNAUTHENTICATED`.
 *
 * Whether the caller SHOULD have been denied is not in scope here: it should
 * have been, and the 403 stays a 403. Only its legibility changes.
 */
describe('ObjectStackAdapter.exportDownload -- error envelope dialects', () => {
  const failWith = (status: number, statusText: string, body: unknown) =>
    makeDS(
      vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status,
            statusText,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

  it('403 flat dialect: surfaces the sentence and the code, not "Forbidden"', async () => {
    const ds = failWith(403, 'Forbidden', {
      code: 'EXPORT_NOT_PERMITTED',
      error: "Export is not permitted on object 'crm_lead' for this user",
      object: 'crm_lead',
    });

    await expect(ds.exportDownload('crm_lead', { format: 'csv' })).rejects.toMatchObject({
      message: "Export is not permitted on object 'crm_lead' for this user",
      code: 'EXPORT_NOT_PERMITTED',
      status: 403,
    });
  });

  it('403 flat dialect: the status word is NOT what reaches the operator', async () => {
    const ds = failWith(403, 'Forbidden', {
      code: 'EXPORT_NOT_PERMITTED',
      error: "Export is not permitted on object 'crm_lead' for this user",
      object: 'crm_lead',
    });

    // The whole card in one assertion.
    await expect(ds.exportDownload('crm_lead', { format: 'csv' })).rejects.toThrow(
      /Export is not permitted on object 'crm_lead'/,
    );
  });

  it('401 CONTROL: the sentence in `message` still wins over the code word', async () => {
    const ds = failWith(401, 'Unauthorized', {
      error: 'UNAUTHENTICATED',
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required to access this endpoint.',
    });

    await expect(ds.exportDownload('crm_lead', { format: 'csv' })).rejects.toMatchObject({
      message: 'Authentication is required to access this endpoint.',
      code: 'UNAUTHENTICATED',
      status: 401,
    });
  });

  it('404 ADR-0112 nested dialect keeps working, code carried too', async () => {
    const ds = failWith(404, 'Not Found', {
      success: false,
      error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
    });

    await expect(ds.exportDownload('crm_lead', { format: 'csv' })).rejects.toMatchObject({
      message: 'Not found',
      code: 'ENDPOINT_NOT_FOUND',
      status: 404,
    });
  });

  it('falls back to statusText only when the body carries no sentence at all', async () => {
    const ds = failWith(500, 'Internal Server Error', { object: 'crm_lead' });

    await expect(ds.exportDownload('crm_lead', { format: 'csv' })).rejects.toMatchObject({
      message: 'Internal Server Error',
      status: 500,
    });
  });

  it('falls back to statusText when the body is not JSON at all', async () => {
    const ds = makeDS(
      vi.fn(
        async () =>
          new Response('<html>gateway</html>', {
            status: 502,
            statusText: 'Bad Gateway',
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    await expect(ds.exportDownload('crm_lead', { format: 'csv' })).rejects.toMatchObject({
      message: 'Bad Gateway',
      status: 502,
    });
  });
});
