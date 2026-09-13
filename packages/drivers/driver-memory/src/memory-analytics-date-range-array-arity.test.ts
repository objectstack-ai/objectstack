// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17596] The cube face's ARRAY arm, read at ROW level: an array that is not a
 * two-bound window is refused, and a window that is one still selects exactly
 * the rows it selected before.
 *
 * ## Why this file exists beside the conformance runner
 *
 * `memory-analytics-date-range-conformance.test.ts` runs the shared kit, whose
 * ARITY case (`ANALYTICS_DATE_RANGE_NOT_A_WINDOW`) is what holds this face and
 * the `service-analytics` faces to ONE answer — and ⛔ no rule is written here
 * that is not the kit's. What the kit cannot see is the CONSEQUENCE: it reads
 * the pipeline dump, so "no window" and "a window" are what it compares, while
 * the defect was visible only in the ROWS. MEASURED on `49cd71548`, four rows
 * spanning 2020…2099 through `MemoryAnalyticsService.query`:
 *
 * | `dateRange` | rows selected | pipeline emitted |
 * |---|---|---|
 * | `['2026-01-01', '2026-01-01']` | `b_target` — the one day | `$match` + `$group` |
 * | `['2026-01-01']` | ⛔ ALL FOUR, 2020 and 2099 included | ⛔ byte-identical to a query with NO `dateRange` |
 * | `[]` | ⛔ ALL FOUR | ⛔ same |
 * | `['2026-01-01', '2026-01-31', '2026-02-01']` | ⛔ ALL FOUR | ⛔ same |
 * | `[null, null]` | none — `$gte: 'null'`, which no instant sorts inside | `$match` |
 *
 * ⇒ the "plot all of history" shape #3650 was filed about, on the arm #16322
 * did not repair. ⭐ The last column is the sharpest statement of it: for three
 * of those shapes the face produced the SAME pipeline it produces when the
 * caller asked for no time window at all, so nothing downstream — not a status,
 * not a field, not the dump — could tell a widened dashboard from a correct one.
 *
 * ## The population is the KIT's, deliberately
 *
 * The shapes are imported rather than restated: a shape added to the kit's case
 * must gain its row-level reading here automatically, or this file would drift
 * back into being one package's private idea of the rule.
 */

import { describe, it, expect } from 'vitest';
import { ANALYTICS_DATE_RANGE_NOT_A_WINDOW } from '@objectstack/core';
import type { AnalyticsQuery, Cube } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

/** The ADR-0112 fields the REST catch classifies a thrown error on. */
interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

const CUBE: Cube = {
  name: 'events',
  title: 'Events',
  sql: 'events',
  measures: { count: { name: 'count', label: 'Count', type: 'count', sql: 'id' } },
  dimensions: {
    probe: { name: 'probe', label: 'Probe', type: 'string', sql: 'probe' },
    createdAt: {
      name: 'created_at', label: 'Created At', type: 'time', sql: 'created_at',
      granularities: ['day'],
    },
  },
  public: true,
};

/**
 * Rows far outside the window on BOTH sides, so "all of history", "unbounded
 * above" and "one day" are three distinguishable answers rather than one.
 */
const ROWS = [
  { id: 'r1', probe: 'a_2020', created_at: '2020-01-01T00:00:00.000Z' },
  { id: 'r2', probe: 'b_target', created_at: '2026-01-01T12:00:00.000Z' },
  { id: 'r3', probe: 'c_2026_06', created_at: '2026-06-15T00:00:00.000Z' },
  { id: 'r4', probe: 'd_2099', created_at: '2099-12-31T00:00:00.000Z' },
];

/**
 * Drive the cube face end to end.
 *
 * ⛔ Deliberately NOT through `AnalyticsQuerySchema.parse`: the schema door is
 * BEHIND this face — `POST /analytics/dataset/query` types its selection from
 * `AnalyticsQuery` and never Zod-parses it — so an in-process caller reaching
 * the face with one of these shapes is the live path, not a contrivance.
 */
async function query(dateRange?: unknown): Promise<{ probes: string[]; sql: string }> {
  const driver = new InMemoryDriver({ initialData: { events: ROWS.map((r) => ({ ...r })) } });
  await driver.connect();
  const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });
  const result = await service.query({
    cube: 'events',
    measures: ['events.count'],
    dimensions: ['events.probe'],
    timeDimensions: [{ dimension: 'events.createdAt', ...(dateRange === undefined ? {} : { dateRange }) }],
  } as unknown as AnalyticsQuery);
  return {
    // The projection keys a dimension by its QUALIFIED name (`events.probe`),
    // with the short name as the fallback the cube's own shape decides.
    probes: (result.rows as Array<Record<string, unknown>>)
      .map((r) => String(r['events.probe'] ?? r.probe)).sort(),
    sql: String(result.sql),
  };
}

async function refusalFrom(thunk: () => Promise<unknown>): Promise<Refusal | undefined> {
  try {
    await thunk();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

describe('#17596 — an array arm that is not a two-bound window is REFUSED, not dropped', () => {
  for (const shape of ANALYTICS_DATE_RANGE_NOT_A_WINDOW) {
    it(`refuses ${JSON.stringify(shape)} (${shape.length} element(s))`, async () => {
      const err = await refusalFrom(() => query(shape));
      expect(err, `the face ANSWERED ${JSON.stringify(shape)} — a window it invented`)
        .toBeInstanceOf(Error);
      // Read exactly as the REST catch reads them. ⛔ Not `toThrow()`: before
      // this change three of these shapes threw NOTHING, and a face that threw
      // a bare `Error` would satisfy it.
      expect(err?.code).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
      expect(err?.status).toBe(400);
    });
  }

  it('says what arrived, the two-element contract, and the single-day spelling to write', async () => {
    const msg = String((await refusalFrom(() => query(['2026-01-01'])))?.message);
    expect(msg).toContain('["2026-01-01"]');          // ① what arrived
    expect(msg).toContain('1-element array');          // ② why it is not a window
    expect(msg).toContain('TWO-element array [start, end]');   // ③ the contract
    expect(msg).toContain('["2026-01-01", "2026-01-01"]');     // ④ what to write instead
  });
});

describe('#17596 CONTROL — a real window still answers exactly as it did before', () => {
  // ⭐ Without these, every assertion above is satisfied by a face that refuses
  // EVERY array — the opposite defect, and just as silent.
  it('a two-element window selects that day and nothing else', async () => {
    const { probes, sql } = await query(['2026-01-01', '2026-01-01']);
    expect(probes).toEqual(['b_target']);
    // #4042's half-open bare-day widening, byte for byte.
    expect(sql).toContain('"$gte":"2026-01-01","$lt":"2026-01-02"');
  });

  it('a preset still resolves through the shared vocabulary', async () => {
    const { probes } = await query('today');
    expect(probes).toEqual([]);   // no row is stamped today
    expect((await query('last_90_days')).sql).toContain('$match');
  });

  it('⭐ NO dateRange still selects all of history — the answer the defect gave', async () => {
    // The measurement that makes the rows above mean something: this is the
    // pipeline three refused shapes used to produce, so "refused" and "dropped"
    // are distinguishable here rather than both reading as a green.
    const { probes, sql } = await query(undefined);
    expect(probes).toEqual(['a_2020', 'b_target', 'c_2026_06', 'd_2099']);
    expect(sql).not.toContain('$match');
  });
});
