/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A plain list read of an object the server does not know must reach the
 * surface as a failure, not as "no data yet".
 *
 * `find()`'s SDK path (no `$expand`, no `$search`) degraded every 404 to
 * `{ data: [], total: 0 }` and memoised the resource in `missingResources`.
 * That memo exists for OPTIONAL platform collections (`sys_presence`,
 * `sys_activity`, …), whose absence means "this deployment does not install
 * the feature". It also swallowed the 404 of a list's OWN object: an object
 * that failed to register answered 404 `OBJECT_NOT_FOUND`, the list showed its
 * empty state, and every later read of that object short-circuited to empty
 * without asking again.
 *
 * The error code cannot split the two cases: an uninstalled `sys_presence` and
 * an unregistered `crm_invoice` both answer 404 `OBJECT_NOT_FOUND`. The split
 * is by name, against the platform's curated registry
 * (`isPlatformProvidedObjectName`, @objectstack/spec): a registry name keeps
 * the empty answer and the memo; any other object's 404 is rethrown and not
 * memoised.
 */

import { describe, it, expect, vi } from 'vitest';
import { isPlatformProvidedObjectName } from '@objectstack/spec/system';
import { ObjectStackAdapter } from './index';

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

const MISSING = 'crm_invoice';
const NOT_FOUND_SENTENCE = "Object 'crm_invoice' is not registered";

describe('find — a 404 on a non-platform object is rethrown, not emptied', () => {
  it('the names these tests lean on sit on the right side of the registry', () => {
    expect(isPlatformProvidedObjectName(MISSING)).toBe(false);
    expect(isPlatformProvidedObjectName('sys_presence')).toBe(true);
    expect(isPlatformProvidedObjectName('sys_activity')).toBe(true);
  });

  it('REJECTS a plain find answered 404 OBJECT_NOT_FOUND, with the code, status and sentence', async () => {
    const find = vi.fn().mockRejectedValue(clientError(NOT_FOUND_SENTENCE, 404, 'OBJECT_NOT_FOUND'));
    const ds = makeDS(find);

    await expect(ds.find(MISSING, { $top: 0 })).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
      httpStatus: 404,
      message: NOT_FOUND_SENTENCE,
    });
  });

  it('does not memoise it: a second find asks the server again and rejects again', async () => {
    const find = vi.fn().mockRejectedValue(clientError(NOT_FOUND_SENTENCE, 404, 'OBJECT_NOT_FOUND'));
    const ds = makeDS(find);

    await expect(ds.find(MISSING)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    await expect(ds.find(MISSING, { $top: 25 })).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('a bare 404 with no code on a non-platform object is rethrown too', async () => {
    const find = vi.fn().mockRejectedValue(clientError('Not found', 404));
    const ds = makeDS(find);

    await expect(ds.find(MISSING)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(ds.find(MISSING)).rejects.toMatchObject({ httpStatus: 404 });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('over the real client: the wrapped 404 envelope reaches the caller as code + status', async () => {
    const dataUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('/data/')) {
        dataUrls.push(href);
        return new Response(
          JSON.stringify({ success: false, error: { code: 'OBJECT_NOT_FOUND', message: NOT_FOUND_SENTENCE } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
    ds.connected = true;
    ds.connectionState = 'connected';

    await expect(ds.find(MISSING, { $top: 0 })).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
      httpStatus: 404,
    });
    await expect(ds.find(MISSING, { $top: 0 })).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    expect(dataUrls).toHaveLength(2);
    expect(dataUrls.every((u) => u.includes(`/data/${MISSING}`))).toBe(true);
  });
});

describe('find — CONTROLS: the platform optional-collection half is unchanged', () => {
  it('CONTROL: a registry name answered 404 OBJECT_NOT_FOUND degrades to empty and is memoised', async () => {
    const find = vi.fn().mockRejectedValue(clientError("Object 'sys_presence' not found", 404, 'OBJECT_NOT_FOUND'));
    const ds = makeDS(find);

    await expect(ds.find('sys_presence')).resolves.toMatchObject({ data: [], total: 0 });
    // Short-circuited: the second call never reaches the server.
    await expect(ds.find('sys_presence', { $top: 5 })).resolves.toMatchObject({ data: [], total: 0 });
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: the memo is per resource: an emptied platform name does not empty a missing object', async () => {
    const find = vi.fn(async (resource: string) => {
      throw clientError(`Object '${resource}' not found`, 404, 'OBJECT_NOT_FOUND');
    });
    const ds = makeDS(find);

    await expect(ds.find('sys_activity')).resolves.toMatchObject({ data: [], total: 0 });
    await expect(ds.find(MISSING)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });

  it('CONTROL: an enable-block denial still rethrows, on a platform name and on any other', async () => {
    const find = vi.fn().mockRejectedValue(clientError('Object API is disabled', 404, 'OBJECT_API_DISABLED'));
    const ds = makeDS(find);

    await expect(ds.find('sys_jwks')).rejects.toMatchObject({ code: 'OBJECT_API_DISABLED', httpStatus: 404 });
    await expect(ds.find(MISSING)).rejects.toMatchObject({ code: 'OBJECT_API_DISABLED', httpStatus: 404 });
    // Neither is memoised: the platform name is asked again.
    await expect(ds.find('sys_jwks')).rejects.toMatchObject({ code: 'OBJECT_API_DISABLED' });
    expect(find).toHaveBeenCalledTimes(3);
  });

  it('CONTROL: a 2xx with zero rows on a non-platform object is still an ordinary empty result', async () => {
    const find = vi.fn().mockResolvedValue({ records: [], total: 0 });
    const ds = makeDS(find);

    await expect(ds.find(MISSING)).resolves.toMatchObject({ data: [], total: 0 });
  });
});
