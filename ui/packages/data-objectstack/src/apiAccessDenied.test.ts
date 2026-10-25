/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4408 — an `enable`-block denial must not arrive at the surface as
 * "no data".
 *
 * `find()` degraded EVERY 404 into `{ data: [], total: 0 }` and memoised the
 * resource in `missingResources`, so a list pointed at an object the server
 * refuses to expose (`enable.apiEnabled: false` → HTTP 404 +
 * `code: 'OBJECT_API_DISABLED'`) resolved successfully with zero rows. A
 * resolved promise with zero rows is indistinguishable from a genuinely empty
 * object, so the list rendered its ordinary empty state: "you have no records"
 * over a page that can never hold any. The reported instance (Setup › Advanced
 * › Signing Keys) could not load for any persona and said so to nobody — which
 * is also how the upstream defect objectstack#7544 survived review for its
 * whole life.
 *
 * The discrimination is on the ADR-0112 `code`, never the status: a 404 from a
 * missing collection and a 404 from a disabled object are the same status, and
 * the optional-collection probes below depend on the missing-collection half
 * still degrading to empty. Both halves are asserted here, in both directions.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter, isApiAccessDeniedError, API_ACCESS_DENIED_CODES } from './index';

/** An error shaped the way `@objectstack/client`'s fetch wrapper throws one. */
function clientError(message: string, httpStatus: number, code?: string) {
  const err = new Error(message) as Error & { httpStatus: number; code?: string };
  err.httpStatus = httpStatus;
  if (code) err.code = code;
  return err;
}

function makeDS(find: any) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { data: { find } };
  return ds;
}

describe('isApiAccessDeniedError', () => {
  it('matches both enable-block denial codes', () => {
    expect(isApiAccessDeniedError({ code: 'OBJECT_API_DISABLED' })).toBe(true);
    expect(isApiAccessDeniedError({ code: 'OBJECT_API_METHOD_NOT_ALLOWED' })).toBe(true);
    expect([...API_ACCESS_DENIED_CODES]).toEqual([
      'OBJECT_API_DISABLED',
      'OBJECT_API_METHOD_NOT_ALLOWED',
    ]);
  });

  it('matches case-insensitively (the pre-ADR-0112 spelling still resolves)', () => {
    expect(isApiAccessDeniedError({ code: 'object_api_disabled' })).toBe(true);
  });

  it('does NOT match the codes a missing collection or record answers with', () => {
    expect(isApiAccessDeniedError({ code: 'OBJECT_NOT_FOUND' })).toBe(false);
    expect(isApiAccessDeniedError({ code: 'RECORD_NOT_FOUND' })).toBe(false);
    expect(isApiAccessDeniedError({ code: 'PERMISSION_DENIED' })).toBe(false);
    // A bare 404 carries no code at all — status alone must never qualify.
    expect(isApiAccessDeniedError({ httpStatus: 404 })).toBe(false);
    expect(isApiAccessDeniedError(undefined)).toBe(false);
  });
});

describe('ObjectStackDataSource.find — enable-block denials are surfaced, not emptied', () => {
  // ── The defect pin ────────────────────────────────────────────────────────
  it('REJECTS a 404 OBJECT_API_DISABLED instead of resolving to zero rows', async () => {
    const find = vi.fn().mockRejectedValue(
      clientError('Object API is disabled', 404, 'OBJECT_API_DISABLED'),
    );
    const ds = makeDS(find);

    await expect(ds.find('sys_jwks')).rejects.toMatchObject({
      code: 'OBJECT_API_DISABLED',
      httpStatus: 404,
    });
  });

  it('REJECTS the 405 sibling and keeps its code intact for the surface', async () => {
    const find = vi.fn().mockRejectedValue(
      clientError('Method not allowed', 405, 'OBJECT_API_METHOD_NOT_ALLOWED'),
    );
    const ds = makeDS(find);

    await expect(ds.find('sys_jwks')).rejects.toMatchObject({
      code: 'OBJECT_API_METHOD_NOT_ALLOWED',
      httpStatus: 405,
    });
  });

  it('does not memoise a denial — the second call still asks and still rejects', async () => {
    // `missingResources` short-circuits later calls to `{ data: [], total: 0 }`
    // WITHOUT touching the network. Absorbing a denial into it would pin the
    // object to "empty" for the rest of the session, so the honest state would
    // appear once and then silently revert to the masking empty state.
    const find = vi.fn().mockRejectedValue(
      clientError('Object API is disabled', 404, 'OBJECT_API_DISABLED'),
    );
    const ds = makeDS(find);

    await expect(ds.find('sys_jwks')).rejects.toThrow();
    await expect(ds.find('sys_jwks')).rejects.toMatchObject({ code: 'OBJECT_API_DISABLED' });
    expect(find).toHaveBeenCalledTimes(2);
  });

  // ── The controls: must stay green on BOTH sides of the fix ────────────────
  it('CONTROL: a bare 404 (collection absent on this backend) still degrades to empty', async () => {
    // The optional-collection probes (AppHeader's sys_presence/sys_activity …)
    // read empty data as "feature unavailable". Turning those into thrown
    // errors would be a worse bug than the one being fixed.
    const find = vi.fn().mockRejectedValue(clientError('Not found', 404));
    const ds = makeDS(find);

    await expect(ds.find('sys_presence')).resolves.toMatchObject({ data: [], total: 0 });
  });

  it('CONTROL: a 404 OBJECT_NOT_FOUND still degrades to empty, and is still memoised', async () => {
    const find = vi.fn().mockRejectedValue(clientError('No such object', 404, 'OBJECT_NOT_FOUND'));
    const ds = makeDS(find);

    await expect(ds.find('sys_activity')).resolves.toMatchObject({ data: [], total: 0 });
    // Memoised: the second call short-circuits without asking again.
    await expect(ds.find('sys_activity')).resolves.toMatchObject({ data: [], total: 0 });
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a 404 RECORD_NOT_FOUND is not an enable-block denial', async () => {
    const find = vi.fn().mockRejectedValue(clientError('No such record', 404, 'RECORD_NOT_FOUND'));
    const ds = makeDS(find);

    await expect(ds.find('account')).resolves.toMatchObject({ data: [], total: 0 });
  });

  it('CONTROL: a 2xx with zero rows resolves as an ordinary empty result', async () => {
    // The overwhelmingly common case, and the one the empty state exists for.
    // A fix that turned "no records yet" into an error surface would be worse
    // than the bug.
    const find = vi.fn().mockResolvedValue({ records: [], total: 0 });
    const ds = makeDS(find);

    await expect(ds.find('account')).resolves.toMatchObject({ data: [], total: 0 });
  });

  it('CONTROL: a 2xx with rows is untouched', async () => {
    const find = vi.fn().mockResolvedValue({ records: [{ id: '1' }], total: 1 });
    const ds = makeDS(find);

    await expect(ds.find('account')).resolves.toMatchObject({ data: [{ id: '1' }], total: 1 });
  });

  it('CONTROL: a 403 still propagates (it was never swallowed)', async () => {
    const find = vi.fn().mockRejectedValue(clientError('Forbidden', 403, 'PERMISSION_DENIED'));
    const ds = makeDS(find);

    await expect(ds.find('account')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

/**
 * The `$expand` / `$search` branch of `find()` bypasses `@objectstack/client`
 * and hand-rolls its own fetch, so it also has to stamp the ADR-0112 envelope
 * itself. It used to set only `status`, which left the surface with a bare 404
 * or 405 and nothing to discriminate on — the same denial, arriving anonymous,
 * on the path a list takes whenever it expands a lookup or runs a search.
 */
describe('ObjectStackDataSource.find — the raw $expand/$search branch carries the code', () => {
  function makeRawDS(status: number, body: unknown) {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/data/')) {
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
    ds.connected = true;
    ds.connectionState = 'connected';
    return ds;
  }

  it('propagates a top-level `code` from the error body', async () => {
    const ds = makeRawDS(404, { code: 'OBJECT_API_DISABLED', message: 'Object API is disabled' });

    await expect(ds.find('sys_jwks', { $search: 'anything' })).rejects.toMatchObject({
      code: 'OBJECT_API_DISABLED',
      status: 404,
      httpStatus: 404,
    });
  });

  it('propagates a nested `error.code` envelope, like the client wrapper does', async () => {
    const ds = makeRawDS(405, {
      error: { code: 'OBJECT_API_METHOD_NOT_ALLOWED', message: 'Method not allowed' },
    });

    await expect(ds.find('sys_jwks', { $expand: ['owner'] })).rejects.toMatchObject({
      code: 'OBJECT_API_METHOD_NOT_ALLOWED',
      httpStatus: 405,
    });
  });

  it('CONTROL: a body with no code leaves `code` undefined rather than inventing one', async () => {
    const ds = makeRawDS(404, { message: 'Not found' });

    await expect(ds.find('sys_jwks', { $expand: ['owner'] })).rejects.toMatchObject({
      status: 404,
    });
    await ds.find('sys_jwks', { $expand: ['owner'] }).catch((e: any) => {
      expect(e.code).toBeUndefined();
      expect(isApiAccessDeniedError(e)).toBe(false);
    });
  });
});
