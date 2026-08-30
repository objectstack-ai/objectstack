// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13195] `$exists` = HAS A VALUE, and the four exits of this package that do
 * not all say so — measured, not read.
 *
 * ## The ruling
 *
 * `$exists` means "the field has a value" (`!= null`), never key-presence:
 * #5298 leg 3 / #5369, landed in PR #5962. It is settled and shipped on the
 * surfaces that ruling named — `@objectstack/formula`'s `matchesFilterCondition`
 * and this package's reference matcher (`memory-matcher.ts`, pinned by
 * `memory-matcher-not-null-safe.test.ts`).
 *
 * ## What this file is, and what it is NOT
 *
 * It is a PIN OF THE MEASURED PRESENT, taken because the card that records this
 * divergence records it as reading rather than execution and its own header
 * says so ("Read, not re-measured"). Executing it found the reading OPTIMISTIC
 * by a factor of three, exactly as `aggregation-conformance.ts`'s DEBT note
 * predicts a read row will be.
 *
 * It is NOT the ruling's enforcement, and it is NOT a decision. The direction
 * for `driver-mongodb` is unsettled (its `$exists` is key-presence at the wire
 * level), and the `FILTER_LOGIC_CASES` enrolment that would enforce the ruling
 * cannot land before the backends move — the DEBT ledger in
 * `scripts/check-driver-conformance.mjs` is per (driver x case-set), so a row
 * added ahead of a backend is only "a gate that reports a known red" (#5903).
 *
 * ⚠️ WHEN THE DIRECTION IS DECIDED, INVERT THESE IN PLACE. Do not delete them
 * and do not re-baseline them to whatever the new output happens to be: each
 * divergent expectation below names the ruling's answer beside the measured
 * one, so flipping it is a one-line edit that stays reviewable.
 *
 * ## Why the fixture has TWO readings and why that is the load-bearing part
 *
 * "No value" has two shapes, and they reach different code:
 *
 *   - `name: null`   — how a SQL NULL round-trips into a record;
 *   - the key ABSENT — what a partial write leaves.
 *
 * Measured: EVERY divergent cell in this file is on the `name: null` reading,
 * and the key-absent reading agrees with the ruling on all four exits. That is
 * the opposite shape from the neighbouring #13166 cell, where `$notContains`
 * diverged on both readings and `$nin` on the absent one only. Consequence
 * worth stating loudly: a fixture that spells "no value" as an ABSENT KEY
 * measures ZERO of this divergence. Keep both columns.
 *
 * ## Why `$exists: false` is here and not only `$exists: true`
 *
 * The recorded table carries one column, `$exists: true` on a null value, whose
 * divergence is SURPLUS — a row the author can see and narrow. `$exists: false`
 * diverges in the opposite direction, and it is the worse one: the row with no
 * value is DROPPED from the query that asks for rows with no value, so the
 * caller sees an empty result and nothing to narrow. `filter-logic-conformance.ts`
 * makes exactly that trade its reason for keeping the include direction on
 * `$ne` / `$nin` ("silent absence for visible surplus"); this cell sits on the
 * wrong side of it and was invisible while only `$exists: true` was recorded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

/** `name` present but NULL — how a SQL NULL round-trips into a record. */
const NULLED: Array<Record<string, unknown>> = [
  { id: '1', name: 'alpha-one' },
  { id: '2', name: 'beta' },
  { id: '3', name: null },
];

/** The same rows with `name` ABSENT — the shape a partial write leaves. */
const MISSING: Array<Record<string, unknown>> = [
  { id: '1', name: 'alpha-one' },
  { id: '2', name: 'beta' },
  { id: '3' },
];

const sorted = (ids: string[]): string[] => [...ids].sort();

/** Exit 1 — the LIVE query path: `find()` → `convertToMongoQuery` → mingo. */
async function liveIds(rows: Array<Record<string, unknown>>, where: unknown): Promise<string[]> {
  const driver = new InMemoryDriver({ persistence: false });
  await driver.connect();
  for (const row of rows) await driver.create('t', { ...row });
  try {
    const out = await driver.find('t', { where } as never);
    return sorted((out as Array<Record<string, unknown>>).map((r) => String(r.id)));
  } finally {
    await driver.disconnect();
  }
}

/** Exit 2 — the REFERENCE matcher, the exit #5962 already aligned. */
const matcherIds = (rows: Array<Record<string, unknown>>, where: unknown): string[] =>
  sorted(rows.filter((r) => match(r, where)).map((r) => String(r.id)));

const CUBE = {
  name: 'deals',
  title: 'Deals',
  sql: 't',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: 'id' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
  },
  public: true,
} as never;

/** Exits 3 and 4 — the analytics face's EXECUTED rows and its ECHOED statement. */
async function analytics(
  rows: Array<Record<string, unknown>>,
  where: unknown,
): Promise<{ executed: string[]; sql: string }> {
  const driver = new InMemoryDriver({ persistence: false });
  await driver.connect();
  for (const row of rows) await driver.create('t', { ...row });
  const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] } as never);
  const query = { cube: 'deals', measures: ['total'], dimensions: ['id'], where } as never;
  try {
    const executed = sorted(
      ((await service.query(query)).rows as Array<Record<string, unknown>>).map((r) => String(r.id)),
    );
    const { sql } = await service.generateSql(query);
    return { executed, sql: sql.replace(/\s+/g, ' ') };
  } finally {
    await driver.disconnect();
  }
}

describe('[#13195] `$exists` on a row with NO VALUE — the two readings, the four exits', () => {
  describe('the key-absent reading: every exit already answers the ruling', () => {
    it('`$exists: true` excludes the no-key row everywhere', async () => {
      expect(await liveIds(MISSING, { name: { $exists: true } })).toEqual(['1', '2']);
      expect(matcherIds(MISSING, { name: { $exists: true } })).toEqual(['1', '2']);
      expect((await analytics(MISSING, { name: { $exists: true } })).executed).toEqual(['1', '2']);
    });

    it('`$exists: false` returns the no-key row everywhere', async () => {
      expect(await liveIds(MISSING, { name: { $exists: false } })).toEqual(['3']);
      expect(matcherIds(MISSING, { name: { $exists: false } })).toEqual(['3']);
      expect((await analytics(MISSING, { name: { $exists: false } })).executed).toEqual(['3']);
    });

    it('`$not` around it agrees too, on the exits that accept `$not`', async () => {
      expect(await liveIds(MISSING, { $not: { name: { $exists: true } } })).toEqual(['3']);
      expect(matcherIds(MISSING, { $not: { name: { $exists: true } } })).toEqual(['3']);
    });
  });

  describe('the `name: null` reading: the reference matcher answers the ruling, the other exits do not', () => {
    it('the reference matcher reads HAS-VALUE — the ruling, shipped by #5962', () => {
      expect(matcherIds(NULLED, { name: { $exists: true } })).toEqual(['1', '2']);
      expect(matcherIds(NULLED, { name: { $exists: false } })).toEqual(['3']);
      expect(matcherIds(NULLED, { $not: { name: { $exists: true } } })).toEqual(['3']);
    });

    it('DIVERGENT — the live mingo path reads KEY-PRESENCE: `$exists: true` keeps the null row', async () => {
      // Ruling: ['1','2']. Measured: ['1','2','3'] — mingo tests key presence.
      expect(await liveIds(NULLED, { name: { $exists: true } })).toEqual(['1', '2', '3']);
    });

    it('DIVERGENT and WORSE — `$exists: false` on the live path returns NOTHING', async () => {
      // Ruling: ['3']. Measured: [] — the row with no value is dropped from the
      // query that asks for rows with no value. Silent absence, not surplus.
      expect(await liveIds(NULLED, { name: { $exists: false } })).toEqual([]);
      expect(await liveIds(NULLED, { $not: { name: { $exists: true } } })).toEqual([]);
    });

    it('DIVERGENT — the analytics face EXECUTES the live mingo key-presence answer', async () => {
      expect((await analytics(NULLED, { name: { $exists: true } })).executed).toEqual(['1', '2', '3']);
      expect((await analytics(NULLED, { name: { $exists: false } })).executed).toEqual([]);
    });

    it('the analytics face ECHOES the has-value answer — so it disagrees with ITSELF', async () => {
      // The statement drawn beside the chart says `IS NOT NULL` / `IS NULL`,
      // which is the ruling; the rows the chart is drawn FROM say key-presence.
      // Asserted as an INEQUALITY as well, so it cannot be closed in silence.
      const t = await analytics(NULLED, { name: { $exists: true } });
      const f = await analytics(NULLED, { name: { $exists: false } });
      expect(t.sql).toContain('name IS NOT NULL');
      expect(f.sql).toContain('name IS NULL');
      expect(t.executed).not.toEqual(matcherIds(NULLED, { name: { $exists: true } }));
      expect(f.executed).not.toEqual(matcherIds(NULLED, { name: { $exists: false } }));
    });
  });

  describe('controls — the fixture really carries the two readings, and the exits still discriminate', () => {
    it('the driver stores a null VALUE for one fixture and NO KEY for the other', async () => {
      const store = async (rows: Array<Record<string, unknown>>) => {
        const driver = new InMemoryDriver({ persistence: false });
        await driver.connect();
        for (const row of rows) await driver.create('t', { ...row });
        try {
          const all = (await driver.find('t', {} as never)) as Array<Record<string, unknown>>;
          const three = all.find((r) => r.id === '3')!;
          return { hasKey: Object.prototype.hasOwnProperty.call(three, 'name'), value: three.name };
        } finally {
          await driver.disconnect();
        }
      };
      expect(await store(NULLED)).toEqual({ hasKey: true, value: null });
      expect(await store(MISSING)).toEqual({ hasKey: false, value: undefined });
    });

    it('a predicate that should narrow still narrows on every exit', async () => {
      expect(await liveIds(NULLED, { name: { $eq: 'beta' } })).toEqual(['2']);
      expect(matcherIds(NULLED, { name: { $eq: 'beta' } })).toEqual(['2']);
      expect((await analytics(NULLED, { name: { $eq: 'beta' } })).executed).toEqual(['2']);
    });
  });
});
