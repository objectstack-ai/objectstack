/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11699 — concurrent `findOne` calls for one record share one request.
 *
 * Opening a record page sent `GET /api/v1/data/OBJ/ID` twice at once, both
 * from `record:details`' `DetailView`, whose load effect re-runs while its
 * first read is still on the wire. `find` has shared an in-flight read by key
 * for a long time; `findOne` did not, so every concurrent caller paid its own
 * round trip.
 *
 * Measured through the REAL adapter and the REAL client over a transport that
 * holds every data request open until the test answers it, so "at once" means
 * the first request is genuinely still pending when the second call is made,
 * and the count is a count of requests on the wire rather than of calls.
 *
 * The rules pinned here, besides the one-request count:
 *   - the key is resource + id + params, so a different record or a different
 *     projection is a different question;
 *   - the entry goes when the read settles, so a later call asks again — this
 *     is not a response cache;
 *   - a rejection reaches every caller that shared it and is not remembered;
 *   - a write to the resource drops its entries, so a read asked after a save
 *     is never answered by one sent before it.
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

const recordBody = (id: string, title: string) => ({
  success: true,
  data: { object: 'task', id, record: { id, title } },
});

const onWire = (held: HeldRequest[], method: string, path: string) =>
  held.filter((r) => r.method === method && r.path === path);

describe('ObjectStackAdapter.findOne — concurrent reads of one record share one request (objectui#11699)', () => {
  it('two concurrent calls for the same record put one GET on the wire, and both get the record', async () => {
    const { ds, held } = await heldAdapter();

    const first = ds.findOne('task', 'r1');
    await drain();
    const second = ds.findOne('task', 'r1');
    await drain();

    expect(onWire(held, 'GET', '/api/v1/data/task/r1')).toHaveLength(1);
    expect(held).toHaveLength(1);

    held[0].respond(200, recordBody('r1', 'Ship'));
    await expect(first).resolves.toEqual({ id: 'r1', title: 'Ship' });
    await expect(second).resolves.toEqual({ id: 'r1', title: 'Ship' });
  });

  it('a call made after the first read settled asks again — sharing is not a response cache', async () => {
    const { ds, held } = await heldAdapter();

    const first = ds.findOne('task', 'r1');
    await drain();
    held[0].respond(200, recordBody('r1', 'Ship'));
    await expect(first).resolves.toEqual({ id: 'r1', title: 'Ship' });

    const later = ds.findOne('task', 'r1');
    await drain();
    expect(onWire(held, 'GET', '/api/v1/data/task/r1')).toHaveLength(2);
    held[1].respond(200, recordBody('r1', 'Shipped'));
    await expect(later).resolves.toEqual({ id: 'r1', title: 'Shipped' });
  });

  it('a different record, or the same record with different params, is a different question', async () => {
    const { ds, held } = await heldAdapter();

    void ds.findOne('task', 'r1');
    void ds.findOne('task', 'r2');
    void ds.findOne('note', 'r1');
    void ds.findOne('task', 'r1', { $expand: ['project'] });
    void ds.findOne('task', 'r1', { $expand: ['project'] });
    await drain();

    expect(onWire(held, 'GET', '/api/v1/data/task/r1')).toHaveLength(1);
    expect(onWire(held, 'GET', '/api/v1/data/task/r2')).toHaveLength(1);
    expect(onWire(held, 'GET', '/api/v1/data/note/r1')).toHaveLength(1);
    // The `$expand` read goes through the populate route; two identical ones
    // still share, and neither is merged with the plain read above.
    const populate = held.filter((r) => r.path.startsWith('/api/v1/data/task?populate=project'));
    expect(populate).toHaveLength(1);
    expect(held).toHaveLength(4);
  });

  it('a rejection reaches every caller that shared it, and the next call asks again', async () => {
    const { ds, held } = await heldAdapter();

    const first = ds.findOne('task', 'r1');
    const second = ds.findOne('task', 'r1');
    await drain();
    expect(held).toHaveLength(1);
    held[0].respond(500, {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'database unavailable' },
    });

    const [a, b] = await Promise.allSettled([first, second]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    const errA = (a as PromiseRejectedResult).reason;
    const errB = (b as PromiseRejectedResult).reason;
    // ONE failure, delivered to both — not two requests that both failed.
    expect(errA).toBe(errB);
    expect(errA).toMatchObject({ httpStatus: 500, code: 'INTERNAL_ERROR' });

    const retry = ds.findOne('task', 'r1');
    await drain();
    expect(held).toHaveLength(2);
    held[1].respond(200, recordBody('r1', 'Ship'));
    await expect(retry).resolves.toEqual({ id: 'r1', title: 'Ship' });
  });

  it('a write to the resource while a read is on the wire makes the next read ask again', async () => {
    const { ds, held } = await heldAdapter();

    const before = ds.findOne('task', 'r1');
    await drain();
    expect(held).toHaveLength(1);

    const write = ds.update('task', 'r1', { title: 'Shipped' });
    await drain();
    const patch = onWire(held, 'PATCH', '/api/v1/data/task/r1');
    expect(patch).toHaveLength(1);
    patch[0].respond(200, recordBody('r1', 'Shipped'));
    await write;

    // Asked after the save landed: must not be answered by the read sent
    // before it.
    const after = ds.findOne('task', 'r1');
    await drain();
    expect(onWire(held, 'GET', '/api/v1/data/task/r1')).toHaveLength(2);

    held[0].respond(200, recordBody('r1', 'Ship'));
    onWire(held, 'GET', '/api/v1/data/task/r1')[1].respond(200, recordBody('r1', 'Shipped'));
    await expect(before).resolves.toEqual({ id: 'r1', title: 'Ship' });
    await expect(after).resolves.toEqual({ id: 'r1', title: 'Shipped' });
  });

  it('a write to a DIFFERENT resource leaves the in-flight read shared', async () => {
    const { ds, held } = await heldAdapter();

    void ds.findOne('task', 'r1');
    await drain();
    const write = ds.update('task_comment', 'c1', { body: 'hi' });
    await drain();
    onWire(held, 'PATCH', '/api/v1/data/task_comment/c1')[0].respond(200, {
      success: true,
      data: { object: 'task_comment', id: 'c1', record: { id: 'c1', body: 'hi' } },
    });
    await write;

    void ds.findOne('task', 'r1');
    await drain();
    expect(onWire(held, 'GET', '/api/v1/data/task/r1')).toHaveLength(1);
  });

  it('find keeps sharing concurrent identical reads through the same helper', async () => {
    const { ds, held } = await heldAdapter();

    const first = ds.find('task', { $top: 5 });
    const second = ds.find('task', { $top: 5 });
    await drain();
    const lists = held.filter((r) => r.method === 'GET' && r.path.startsWith('/api/v1/data/task'));
    expect(lists).toHaveLength(1);
    lists[0].respond(200, { success: true, data: { records: [{ id: 'r1' }], total: 1 } });
    const [a, b] = await Promise.all([first, second]);
    expect(a.data).toEqual([{ id: 'r1' }]);
    expect(b).toBe(a);
  });
});
