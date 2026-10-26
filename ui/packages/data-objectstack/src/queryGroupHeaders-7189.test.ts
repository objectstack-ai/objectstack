/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `queryGroupHeaders()` — the transport for server-side grid grouping
 * (objectui#7189, maintainer ruling A).
 *
 * A grouped grid that owns its fetch hands this member the header query
 * `@objectstack/spec/ui`'s `compileListViewGroupQuery` compiles, and gets one
 * row per group back. The spec half of the ruling (objectstack#14556) named the
 * door: the EXISTING `POST /data/:object/query`, whose `findData` routes a body
 * carrying `groupBy` / `aggregations` to `engine.aggregate` and answers the
 * header rows as `records`. These pins hold the adapter to that door:
 *
 *   - the compiled query goes out VERBATIM — the body on the wire IS the
 *     compiler's output, so a pin here goes red when either end drifts;
 *   - the answer is the `records` array, untouched;
 *   - there is NO fallback: a refused query throws, and a body with no
 *     `records` is refused rather than read as "no groups" — the two ways a
 *     degrading member would hand a grid page slices under a name that promises
 *     the query's own numbers.
 */

import { describe, it, expect, vi } from 'vitest';
import { compileListViewGroupQuery } from '@objectstack/spec/ui';
import { ObjectStackAdapter } from './index';

const HEADER_ROWS = [
  { business_unit: 'northgate_operations', count: 86 },
  { business_unit: 'northgate_quality', count: 61 },
  { business_unit: 'riverside_plant', count: 31 },
  { business_unit: 'northgate_plant', count: 7 },
  { business_unit: 'harbour_office', count: 1 },
];

function makeAdapter(answer: { status: number; body: unknown }) {
  const posted: Array<{ url: string; method?: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes('/api/v1/discovery')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, data: { version: 'v1', routes: {} } }),
      } as any;
    }
    posted.push({ url: u, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      ok: answer.status < 400, status: answer.status, statusText: String(answer.status),
      json: async () => answer.body,
    } as any;
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as any,
  });
  return { adapter, posted };
}

const VIEW = {
  grouping: { fields: [{ field: 'business_unit' }] },
  columns: [{ field: 'amount', summary: 'sum' as const }],
};

describe('ObjectStackAdapter.queryGroupHeaders (objectui#7189)', () => {
  it('posts the compiled header query verbatim to POST /data/:object/query and answers its records', async () => {
    const { adapter, posted } = makeAdapter({
      status: 200,
      body: { success: true, data: { object: 'work_item', records: HEADER_ROWS, total: 5, hasMore: false } },
    });
    const query = compileListViewGroupQuery(VIEW, { where: { status: { $eq: 'open' } } });

    const rows = await adapter.queryGroupHeaders('work_item', query);

    expect(posted).toHaveLength(1);
    expect(posted[0].method).toBe('POST');
    expect(posted[0].url).toMatch(/\/api\/v1\/data\/work_item\/query$/);
    // The body IS the compiler's output — not a restatement of it.
    expect(posted[0].body).toEqual(JSON.parse(JSON.stringify(query)));
    expect(rows).toEqual(HEADER_ROWS);
  });

  it('refuses an answer with no `records` array instead of reading it as "no groups"', async () => {
    const { adapter } = makeAdapter({ status: 200, body: { success: true, data: { object: 'work_item', total: 0 } } });
    const error = await adapter
      .queryGroupHeaders('work_item', compileListViewGroupQuery(VIEW))
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toContain('records');
  });

  it('CONTROL: an empty `records` array IS an answer — zero groups, no refusal', async () => {
    const { adapter } = makeAdapter({
      status: 200,
      body: { success: true, data: { object: 'work_item', records: [], total: 0, hasMore: false } },
    });
    await expect(adapter.queryGroupHeaders('work_item', compileListViewGroupQuery(VIEW))).resolves.toEqual([]);
  });

  it('throws the server refusal with its ADR-0112 code and status — no client-side fallback', async () => {
    const { adapter, posted } = makeAdapter({
      status: 400,
      body: { success: false, error: { code: 'INVALID_FIELD', message: "Unknown field 'nope'" } },
    });
    const error = await adapter
      .queryGroupHeaders('work_item', compileListViewGroupQuery({ grouping: { fields: [{ field: 'nope' }] } }))
      .then(() => null, (e: unknown) => e) as { code?: string; httpStatus?: number; status?: number } | null;
    expect(error).not.toBeNull();
    expect(error?.code).toBe('INVALID_FIELD');
    expect(error?.httpStatus ?? error?.status).toBe(400);
    // One request, and it was the header query: nothing re-read the rows to
    // approximate the groups.
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toMatch(/\/data\/work_item\/query$/);
  });
});
