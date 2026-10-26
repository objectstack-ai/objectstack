/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7028 — `aggregate()` reads ONE row spelling at the
 * `client.analytics.query` boundary: `rows` on the post-unwrap
 * `AnalyticsResult`.
 *
 * `@objectstack/client` 17.3.0 converged `analytics.query` on `unwrapResponse`
 * (objectstack#13079), and the ruling on that card ordered this adapter's
 * tolerant ladder tightened in the same wave. The ladder read five spellings —
 * a bare array, `rows`, `data` as an array, `data.data.rows`, `results` — and
 * answered anything else with `[]`. These pins are scoped to that one site:
 *
 *   1. the unwrapped shape yields its rows, through the REAL client, from the
 *      `{ success, data }` wire envelope every 17.x server sends;
 *   2. an envelope reaching the boundary THROWS `AnalyticsResultShapeError` and
 *      is not answered by the client-side fallback — once through the real
 *      client (a success-less `{ data: { rows } }` body `unwrapResponse` leaves
 *      alone) and once as the value a pre-17.3.0 client's `res.json()` handed
 *      back;
 *   3. the ladder's other retired spellings throw the same error rather than
 *      degrading to `[]`;
 *   4. CONTROL: the measure-missing client-side fallback right below the read
 *      still runs — the throw is not a blanket refusal of odd rows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AnalyticsResultShapeError,
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
} from './index';

const RECORDS = [
  { id: '1', stage: 'won', amount: 100 },
  { id: '2', stage: 'won', amount: 50 },
  { id: '3', stage: 'lost', amount: 20 },
];

const SUM_BY_STAGE = { function: 'sum', field: 'amount', groupBy: 'stage' };

const ROWS = [{ stage: 'won', amount_sum: 150 }];

/**
 * Discovery, the analytics query (answering `analyticsBody` with a 200), and
 * the `/data` read the fallback performs — the same three doors
 * `aggregate-capability.test.ts` keeps apart, so "the fallback did not run" is
 * a statement about a URL that was never requested.
 */
function makeFetch(analyticsBody: unknown) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    calls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) } as any;
    }
    if (u.includes('/api/v1/analytics/query')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => analyticsBody } as any;
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

const fellBack = (calls: string[]) => calls.some((c) => c.includes('/api/v1/data'));

async function refusal(run: Promise<unknown>): Promise<AnalyticsResultShapeError> {
  const err = await run.then(
    () => { throw new Error('aggregate() resolved; it was expected to throw AnalyticsResultShapeError'); },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AnalyticsResultShapeError);
  return err as AnalyticsResultShapeError;
}

describe('aggregate() reads `rows` on the post-unwrap AnalyticsResult — and nothing else (objectui#7028)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('the unwrapped shape yields its rows: the wire envelope goes through the real client and comes out as `rows`', async () => {
    const { fetchImpl, calls } = makeFetch({
      success: true,
      data: { rows: ROWS, fields: [{ name: 'amount_sum', type: 'number' }] },
    });

    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE);

    expect(rows).toEqual([{ stage: 'won', amount: 150 }]);
    expect(fellBack(calls)).toBe(false);
  });

  it('an envelope at the boundary THROWS — `{ data: { rows } }` through the real client, never the fallback', async () => {
    // No `success` flag, so `unwrapResponse` has nothing to strip and hands the
    // envelope to the adapter as-is: the boundary sees `{ data: { rows } }`.
    const { fetchImpl, calls } = makeFetch({ data: { rows: ROWS } });

    const err = await refusal(makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE));

    expect(err.code).toBe('ANALYTICS_RESULT_SHAPE_INVALID');
    expect(err.envelope).toBe(true);
    expect(err.resource).toBe('opportunity');
    expect(fellBack(calls)).toBe(false);
  });

  it('an envelope at the boundary THROWS — the value a pre-17.3.0 client handed back, never the fallback', async () => {
    const { fetchImpl, calls } = makeFetch({ success: true, data: { rows: ROWS } });
    const adapter = makeAdapter(fetchImpl);
    // What `analytics.query` resolved to before objectstack#13079: the parsed
    // body, envelope and all (`return res.json()`).
    (adapter as any).client.analytics.query = vi.fn(async () => ({ success: true, data: { rows: ROWS } }));

    const err = await refusal(adapter.aggregate('opportunity', SUM_BY_STAGE));

    expect(err.code).toBe('ANALYTICS_RESULT_SHAPE_INVALID');
    expect(err.envelope).toBe(true);
    expect(fellBack(calls)).toBe(false);
  });

  it.each([
    ['a bare array', ROWS],
    ['`data` as an array', { data: ROWS }],
    ['`results`', { results: ROWS }],
  ])('the retired spelling %s throws instead of degrading to []', async (_label, body) => {
    const { fetchImpl, calls } = makeFetch(body);

    const err = await refusal(makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE));

    expect(err.code).toBe('ANALYTICS_RESULT_SHAPE_INVALID');
    expect(err.envelope).toBe(false);
    expect(fellBack(calls)).toBe(false);
  });

  it('CONTROL: rows that lack the measure still fall back to client-side aggregation', async () => {
    const { fetchImpl, calls } = makeFetch({ success: true, data: { rows: [{ stage: 'won' }] } });

    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE);

    expect(fellBack(calls)).toBe(true);
    expect(rows.find((r: any) => r.stage === 'won')?.amount).toBe(150);
    expect(rows.find((r: any) => r.stage === 'lost')?.amount).toBe(20);
  });
});
