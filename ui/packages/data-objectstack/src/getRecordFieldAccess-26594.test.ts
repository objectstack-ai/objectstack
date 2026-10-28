/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectStackAdapter.getRecordFieldAccess` (objectstack#26594) — the record
 * form's question to the server: `GET /api/v1/data/:object/:id/field-access`.
 *
 * Pinned:
 *  - the wire: that route, the object and id encoded, the envelope unwrapped;
 *  - "no answer" is `null`, never a throw, for the two refusals that mean it —
 *    the record read's own 404 (absent or hidden from the caller) and a server
 *    without the route (501 `NOT_IMPLEMENTED`) — so the form keeps its
 *    row-blind answer;
 *  - any other refusal reaches the caller, as a read's does.
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ACCESS = { object: 'rfa_contract', recordId: 'c/1', readable: ['title', 'summary'], editable: ['title', 'summary'] };

describe('[#26594] ObjectStackAdapter.getRecordFieldAccess', () => {
  it("GETs the record's field-access route and hands back the projection", async () => {
    const fetchImpl: FetchSpy = vi.fn(async () => json(200, { success: true, data: ACCESS }));
    const ds = makeDS(fetchImpl);
    await expect(ds.getRecordFieldAccess('rfa_contract', 'c/1')).resolves.toEqual(ACCESS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://test.local/api/v1/data/rfa_contract/c%2F1/field-access');
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET');
  });

  it('a record the read answers 404 for is no answer, not a failure', async () => {
    const fetchImpl: FetchSpy = vi.fn(async () =>
      json(404, { success: false, error: { code: 'RECORD_NOT_FOUND', message: 'Record c1 not found in rfa_memo' } }));
    await expect(makeDS(fetchImpl).getRecordFieldAccess('rfa_memo', 'c1')).resolves.toBeNull();
  });

  it('a server without the route (501) is no answer, not a failure', async () => {
    const fetchImpl: FetchSpy = vi.fn(async () =>
      json(501, { success: false, error: { code: 'NOT_IMPLEMENTED', message: 'no record-scoped projection' } }));
    await expect(makeDS(fetchImpl).getRecordFieldAccess('rfa_contract', 'c1')).resolves.toBeNull();
  });

  it('any other refusal reaches the caller', async () => {
    const fetchImpl: FetchSpy = vi.fn(async () =>
      json(403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'no read' } }));
    await expect(makeDS(fetchImpl).getRecordFieldAccess('rfa_contract', 'c1')).rejects.toMatchObject({ httpStatus: 403 });
  });
});
