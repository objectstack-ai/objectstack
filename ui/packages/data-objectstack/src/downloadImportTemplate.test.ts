/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectStackAdapter.downloadImportTemplate` (objectui#9600) — the import
 * wizard's 「下载模板」 request: `GET /api/v1/data/:object/export?template=true`.
 *
 * Three things are pinned:
 *  - the wire: the export route, `template=true` and nothing else (the server
 *    refuses the export's row parameters on a template request);
 *  - the locale: the server writes the template's labels in the request's
 *    locale, and the import accepts a translated label only in its OWN
 *    request's locale. So the template request must carry the same
 *    `Accept-Language` the import request does. Asserted as parity against the
 *    real `importRecords` request, through the same `fetch`, in both states of
 *    the client locale;
 *  - the refusals the server answers a template with: 403 `PERMISSION_DENIED`
 *    (no create permission, ADR-0112 nested envelope) and 405
 *    `OBJECT_API_METHOD_NOT_ALLOWED` (object not open for import, flat
 *    dialect). Both reach the caller as `code` + `status`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

type FetchSpy = ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

function makeDS(fetchImpl: FetchSpy, baseUrl = 'http://test.local') {
  const ds: any = new ObjectStackAdapter({ baseUrl, fetch: fetchImpl as any });
  ds.connected = true;
  ds.connectionState = 'connected';
  return ds;
}

const xlsxResponse = () =>
  new Response('xlsx-bytes', {
    status: 200,
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  });

/** Read one header off a recorded `init`, whatever shape its headers took. */
function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers as HeadersInit | undefined).get(name);
}

describe('ObjectStackAdapter.downloadImportTemplate — the wire', () => {
  it('GETs the export route with template=true and no other parameter', async () => {
    const fetchImpl: FetchSpy = vi.fn(async () => xlsxResponse());
    const ds = makeDS(fetchImpl);

    const blob = await ds.downloadImportTemplate('task');

    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe('xlsx-bytes');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/v1/data/task/export');
    expect([...parsed.searchParams.entries()]).toEqual([['template', 'true']]);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('does not double the version segment when the base URL already ends in /api/v1', async () => {
    const fetchImpl: FetchSpy = vi.fn(async () => xlsxResponse());
    const ds = makeDS(fetchImpl, 'http://test.local/api/v1');

    await ds.downloadImportTemplate('task');

    expect(new URL(fetchImpl.mock.calls[0][0]).pathname).toBe('/api/v1/data/task/export');
  });

  it('sends the bearer token like the export does', async () => {
    const fetchImpl: FetchSpy = vi.fn(async () => xlsxResponse());
    const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', token: 'tok', fetch: fetchImpl as any });
    ds.connected = true;

    await ds.downloadImportTemplate('task');

    expect(headerOf(fetchImpl.mock.calls[0][1], 'Authorization')).toBe('Bearer tok');
  });
});

describe('ObjectStackAdapter.downloadImportTemplate — same locale as the import request', () => {
  /**
   * A fetch that answers both routes: the import's JSON result and the
   * template's bytes. Every call is recorded, so the two requests are read off
   * the same spy.
   */
  function bothRoutes(): FetchSpy {
    return vi.fn(async (url: string) =>
      /\/import(\?|$)/.test(new URL(url).pathname)
        ? new Response(JSON.stringify({ success: true, data: { total: 0, created: 0, updated: 0, skipped: 0, errors: 0, results: [] } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : xlsxResponse(),
    );
  }

  const callTo = (spy: FetchSpy, route: RegExp) => {
    const call = spy.mock.calls.find(([u]) => route.test(new URL(u).pathname));
    expect(call, `no request to ${route}`).toBeDefined();
    return call![1];
  };

  it('carries the client locale on both requests when one is set', async () => {
    const fetchImpl = bothRoutes();
    const ds = makeDS(fetchImpl);
    ds.getClient().setLocale('zh-CN');

    await ds.importRecords('task', { format: 'json', rows: [] });
    await ds.downloadImportTemplate('task');

    const importLang = headerOf(callTo(fetchImpl, /\/task\/import$/), 'Accept-Language');
    const templateLang = headerOf(callTo(fetchImpl, /\/task\/export$/), 'Accept-Language');
    expect(importLang).toBe('zh-CN');
    expect(templateLang).toBe(importLang);
  });

  it('carries none on either when no client locale is set, so the host fetch stamps both alike', async () => {
    const fetchImpl = bothRoutes();
    const ds = makeDS(fetchImpl);

    await ds.importRecords('task', { format: 'json', rows: [] });
    await ds.downloadImportTemplate('task');

    expect(headerOf(callTo(fetchImpl, /\/task\/import$/), 'Accept-Language')).toBeNull();
    expect(headerOf(callTo(fetchImpl, /\/task\/export$/), 'Accept-Language')).toBeNull();
  });
});

describe('ObjectStackAdapter.downloadImportTemplate — refusals', () => {
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

  it('403: a caller without create gets PERMISSION_DENIED with its sentence', async () => {
    const ds = failWith(403, 'Forbidden', {
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: "Creating records on object 'task' is not permitted for this user, so its import template is not served",
        details: { object: 'task' },
      },
    });

    await expect(ds.downloadImportTemplate('task')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      message: "Creating records on object 'task' is not permitted for this user, so its import template is not served",
    });
  });

  it('405: an object not open for import gets OBJECT_API_METHOD_NOT_ALLOWED', async () => {
    const ds = failWith(405, 'Method Not Allowed', {
      error: "API operation 'import' is not allowed on object 'task'",
      code: 'OBJECT_API_METHOD_NOT_ALLOWED',
      object: 'task',
      allowed: ['read'],
    });

    await expect(ds.downloadImportTemplate('task')).rejects.toMatchObject({
      code: 'OBJECT_API_METHOD_NOT_ALLOWED',
      status: 405,
      message: "API operation 'import' is not allowed on object 'task'",
    });
  });
});
