/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27626 — opening one record asked `GET /data/OBJ/ID/field-access`
 * four times in the same millisecond: `record:details` and `record:highlights`
 * each mount a `RecordFieldAccessScope`, and the drawer's form and the page
 * host ask too. Every ask reaches `getRecordFieldAccess`, so the adapter is
 * where the four become one.
 *
 * Measured through the REAL adapter and the REAL client over a transport that
 * holds every data request open until the test answers it, so "at once" means
 * the first request is genuinely still pending when the next call is made.
 *
 * Pinned:
 *  - concurrent asks for one record share one request and one answer;
 *  - a settled projection is not remembered: the scopes re-ask after a save,
 *    and that ask must reach the server (this is not a response cache);
 *  - "no answer" is remembered — a record the read answers 404 for stays
 *    unanswered until a write to its object, and a server without the route
 *    (501) is not asked again for any record;
 *  - a write to the object drops both the shared ask and the remembered 404,
 *    so an ask made after the save is never answered from before it.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

const BASE = 'http://test.local';

interface HeldRequest {
  method: string;
  path: string;
  respond: (status: number, body: unknown) => void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A connected adapter whose data requests wait until the test answers them. */
async function heldAdapter() {
  const held: HeldRequest[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (
      init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    ).toUpperCase();
    if (url.endsWith('/api/v1/discovery')) {
      return Promise.resolve(json(200, { success: true, data: { capabilities: {}, routes: {} } }));
    }
    return new Promise<Response>((resolve) => {
      held.push({
        method,
        path: url.replace(BASE, ''),
        respond: (status, body) => resolve(json(status, body)),
      });
    });
  });
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  return { ds, held };
}

/** Let every queued continuation run, so a call that WOULD fetch has fetched. */
async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const accessOf = (path: string) => /\/field-access$/.test(path);
const ACCESS = { object: 'fa_contact', recordId: 'c1', readable: ['name'], editable: ['name'] };
const NOT_FOUND = { success: false, error: { code: 'RECORD_NOT_FOUND', message: 'Record c1 not found' } };

describe('[#27626] getRecordFieldAccess shares one request per record', () => {
  it('four concurrent asks for one record send ONE request and all get its answer', async () => {
    const { ds, held } = await heldAdapter();
    const asks = [1, 2, 3, 4].map(() => ds.getRecordFieldAccess('fa_contact', 'c1'));
    await drain();
    const wire = held.filter((r) => accessOf(r.path));
    expect(wire).toHaveLength(1);
    expect(wire[0].path).toBe('/api/v1/data/fa_contact/c1/field-access');
    wire[0].respond(200, { success: true, data: ACCESS });
    await expect(Promise.all(asks)).resolves.toEqual([ACCESS, ACCESS, ACCESS, ACCESS]);
  });

  it('another record is another question', async () => {
    const { ds, held } = await heldAdapter();
    void ds.getRecordFieldAccess('fa_contact', 'c1');
    void ds.getRecordFieldAccess('fa_contact', 'c2');
    void ds.getRecordFieldAccess('fa_account', 'c1');
    await drain();
    expect(held.filter((r) => accessOf(r.path)).map((r) => r.path)).toEqual([
      '/api/v1/data/fa_contact/c1/field-access',
      '/api/v1/data/fa_contact/c2/field-access',
      '/api/v1/data/fa_account/c1/field-access',
    ]);
  });

  it('a settled projection is not remembered — the next ask reaches the server', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.getRecordFieldAccess('fa_contact', 'c1');
    await drain();
    held.filter((r) => accessOf(r.path))[0].respond(200, { success: true, data: ACCESS });
    await first;
    void ds.getRecordFieldAccess('fa_contact', 'c1');
    await drain();
    expect(held.filter((r) => accessOf(r.path))).toHaveLength(2);
  });

  it('a 404 is remembered as no answer for that record, and only that record', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.getRecordFieldAccess('fa_contact', 'c1');
    await drain();
    held.filter((r) => accessOf(r.path))[0].respond(404, NOT_FOUND);
    await expect(first).resolves.toBeNull();
    await expect(ds.getRecordFieldAccess('fa_contact', 'c1')).resolves.toBeNull();
    await expect(ds.getRecordFieldAccess('fa_contact', 'c1')).resolves.toBeNull();
    await drain();
    expect(held.filter((r) => accessOf(r.path))).toHaveLength(1);
    // Control: a different record of the same object is still asked.
    void ds.getRecordFieldAccess('fa_contact', 'c2');
    await drain();
    expect(held.filter((r) => accessOf(r.path))).toHaveLength(2);
  });

  it('a server without the route (501) is not asked again for any record', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.getRecordFieldAccess('fa_contact', 'c1');
    await drain();
    held.filter((r) => accessOf(r.path))[0].respond(501, {
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'no record-scoped projection' },
    });
    await expect(first).resolves.toBeNull();
    await expect(ds.getRecordFieldAccess('fa_contact', 'c2')).resolves.toBeNull();
    await expect(ds.getRecordFieldAccess('fa_account', 'a9')).resolves.toBeNull();
    await drain();
    expect(held.filter((r) => accessOf(r.path))).toHaveLength(1);
  });

  it('a write to the object drops the remembered 404 and the shared ask', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.getRecordFieldAccess('fa_contact', 'c1');
    await drain();
    held.filter((r) => accessOf(r.path))[0].respond(404, NOT_FOUND);
    await first;

    // An ask on the wire when the write lands was asked before it.
    void ds.getRecordFieldAccess('fa_contact', 'c2');
    await drain();
    expect(held.filter((r) => accessOf(r.path))).toHaveLength(2);

    const save = ds.update('fa_contact', 'c1', { name: 'Ada' });
    await drain();
    held.find((r) => r.method === 'PATCH' || r.method === 'PUT')!.respond(200, {
      success: true,
      data: { id: 'c1', name: 'Ada' },
    });
    await save;

    void ds.getRecordFieldAccess('fa_contact', 'c1');
    void ds.getRecordFieldAccess('fa_contact', 'c2');
    await drain();
    expect(held.filter((r) => accessOf(r.path)).map((r) => r.path)).toEqual([
      '/api/v1/data/fa_contact/c1/field-access',
      '/api/v1/data/fa_contact/c2/field-access',
      '/api/v1/data/fa_contact/c1/field-access',
      '/api/v1/data/fa_contact/c2/field-access',
    ]);
  });
});
