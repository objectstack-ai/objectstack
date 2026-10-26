/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12812 — `aggregate()` falls back to the client-side `find()` path
 * only when the measure KEY is absent from the analytics answer. A served
 * `null` is the answer (the max over rows whose field is all NULL is NULL):
 * it reaches the caller as `null`, and the rows are not re-read.
 *
 *   1. a present `null` (single bucket) → the value is `null`, ONE analytics
 *      request, no `/data` read;
 *   2. a present `null` in every bucket of a grouped answer → the same, per
 *      bucket;
 *   3. CONTROL: the key absent → today's fallback still runs;
 *   4. CONTROL: a present non-null value is mapped exactly as before.
 *
 * The real client is driven through `fetch`, so "no second read" is a
 * statement about a URL that was never requested.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

const RECORDS = [
  { id: '1', stage: 'won', amount: 100 },
  { id: '2', stage: 'won', amount: 50 },
  { id: '3', stage: 'lost', amount: 20 },
];

function makeFetch(analyticsRows: unknown[]) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    calls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) } as any;
    }
    if (u.includes('/api/v1/analytics/query')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, data: { rows: analyticsRows, fields: [] } }),
      } as any;
    }
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ success: true, data: { object: 'opportunity', records: RECORDS, total: RECORDS.length } }),
    } as any;
  });
  return { fetchImpl, calls };
}

function makeAdapter(fetchImpl: any) {
  return new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000',
    autoReconnect: false,
    fetch: fetchImpl as any,
  });
}

const analyticsCalls = (calls: string[]) => calls.filter((c) => c.includes('/api/v1/analytics/query')).length;
const dataCalls = (calls: string[]) => calls.filter((c) => c.includes('/api/v1/data')).length;

describe('aggregate() reads a served null measure as the answer, not as a missing measure (objectui#12812)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('a present `null` is returned as `null` with one analytics request and no row re-read', async () => {
    const { fetchImpl, calls } = makeFetch([{ amount_max: null }]);

    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', {
      function: 'max', field: 'amount', groupBy: '_all',
    });

    expect(rows).toEqual([{ amount: null }]);
    expect(analyticsCalls(calls)).toBe(1);
    expect(dataCalls(calls)).toBe(0);
  });

  it('a present `null` in every bucket of a grouped answer stays `null` per bucket, with no row re-read', async () => {
    const { fetchImpl, calls } = makeFetch([
      { stage: 'won', amount_max: null },
      { stage: 'lost', amount_max: null },
    ]);

    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', {
      function: 'max', field: 'amount', groupBy: 'stage',
    });

    expect(rows).toEqual([
      { stage: 'won', amount: null },
      { stage: 'lost', amount: null },
    ]);
    expect(analyticsCalls(calls)).toBe(1);
    expect(dataCalls(calls)).toBe(0);
  });

  it('CONTROL: rows without the measure key still fall back to client-side aggregation', async () => {
    const { fetchImpl, calls } = makeFetch([{ stage: 'won' }, { stage: 'lost' }]);

    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', {
      function: 'sum', field: 'amount', groupBy: 'stage',
    });

    expect(dataCalls(calls)).toBe(1);
    expect(rows.find((r: any) => r.stage === 'won')?.amount).toBe(150);
    expect(rows.find((r: any) => r.stage === 'lost')?.amount).toBe(20);
  });

  it('CONTROL: a present non-null value is mapped to the field column unchanged', async () => {
    const { fetchImpl, calls } = makeFetch([{ amount_max: 100 }]);

    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', {
      function: 'max', field: 'amount', groupBy: '_all',
    });

    expect(rows).toEqual([{ amount: 100 }]);
    expect(analyticsCalls(calls)).toBe(1);
    expect(dataCalls(calls)).toBe(0);
  });
});
