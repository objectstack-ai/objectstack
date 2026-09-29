// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20444] The staged `$empty` operator on this package's three filter faces.
 *
 * - **The live query path** (`InMemoryDriver.find` → mingo) holds the field
 *   declarations `syncSchema` recorded, so it answers by the field's DECLARED
 *   row of the ruled 「is empty」 table (ruling A on #20399, record 5865693155;
 *   the spec's `expandEmptyOperator`): text-like = null or `''`; multi-value =
 *   null or `[]`; every other type = null only; `$empty: false` the exact
 *   complement. A field it holds no declaration for is REFUSED.
 * - **The reference matcher** (`match`) holds no declarations at all, so it
 *   takes the reading the spec gives such a face — by value
 *   (`isEmptyFilterValue`): null, a missing key, `''` and `[]` are empty.
 * - **The analytics (cube) face** does not lower the flag (nor `$null`), and
 *   refuses it loudly as a declared operator it cannot compile.
 *
 * The two value-level faces agree on every value a field's own type can hold;
 * the one place they part is a stored state the declaration does not predict,
 * and that cell is pinned below so the divergence is a measurement, not a
 * surprise.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

const TABLE = 'os20444_empty';

const FIELDS = {
  id: { type: 'text' },
  title: { type: 'text' },
  tags: { type: 'tags' },
  owners: { type: 'lookup', reference: TABLE, multiple: true },
  score: { type: 'number' },
};

const ROWS: Array<Record<string, unknown>> = [
  { id: 'r1', title: 'x', tags: ['a'], owners: ['u1'], score: 5 },
  { id: 'r2', title: '', tags: [], owners: [], score: 0 },
  { id: 'r3', title: null, tags: null, owners: null, score: null },
  { id: 'r4', title: '  ', tags: ['a', 'b'], owners: ['u2'], score: -1 },
  // Every column MISSING — the other reading of "no value".
  { id: 'r5' },
];

const CASES: Array<{ where: FilterCondition; expected: string[] }> = [
  { where: { title: { $empty: true } }, expected: ['r2', 'r3', 'r5'] },
  { where: { title: { $empty: false } }, expected: ['r1', 'r4'] },
  { where: { tags: { $empty: true } }, expected: ['r2', 'r3', 'r5'] },
  { where: { tags: { $empty: false } }, expected: ['r1', 'r4'] },
  { where: { owners: { $empty: true } }, expected: ['r2', 'r3', 'r5'] },
  { where: { owners: { $empty: false } }, expected: ['r1', 'r4'] },
  { where: { score: { $empty: true } }, expected: ['r3', 'r5'] },
  { where: { score: { $empty: false } }, expected: ['r1', 'r2', 'r4'] },
  { where: { $not: { title: { $empty: true } } }, expected: ['r1', 'r4'] },
  { where: { $not: { tags: { $empty: false } } }, expected: ['r2', 'r3', 'r5'] },
  { where: { $or: [{ score: 5 }, { tags: { $empty: true } }] }, expected: ['r1', 'r2', 'r3', 'r5'] },
  { where: { $and: [{ title: { $empty: false } }, { owners: { $empty: false } }] }, expected: ['r1', 'r4'] },
  { where: { title: { $empty: false, $ne: 'x' } }, expected: ['r4'] },
  { where: { tags: { $empty: true, $ne: null } }, expected: ['r2'] },
];

function refusal(run: () => unknown): Promise<{ code?: string; status?: number } | 'answered'> {
  return Promise.resolve()
    .then(run)
    .then(
      () => 'answered' as const,
      (err) => ({ code: (err as { code?: string }).code, status: (err as { status?: number }).status }),
    );
}

describe('[#20444] InMemoryDriver — $empty on the live path, the reference matcher and the analytics face', () => {
  let driver: InMemoryDriver;
  const ids = async (where: FilterCondition) =>
    ((await driver.find(TABLE, { where })) as Array<Record<string, unknown>>).map((r) => String(r.id)).sort();
  const reference = (where: FilterCondition) =>
    ROWS.filter((r) => match(r, where)).map((r) => String(r.id)).sort();

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(TABLE, { fields: FIELDS });
    for (const row of ROWS) await driver.create(TABLE, { ...row });
  });

  it('the fixture is the five rows', async () => {
    expect(await ids({})).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });

  for (const c of CASES) {
    it(`${JSON.stringify(c.where)} → ${JSON.stringify(c.expected)} on the live path AND the reference matcher`, async () => {
      expect(await ids(c.where), 'live').toEqual(c.expected);
      expect(reference(c.where), 'reference matcher').toEqual(c.expected);
    });
  }

  it('$empty: false partitions every declared field with $empty: true, on both faces', async () => {
    for (const field of ['title', 'tags', 'owners', 'score']) {
      const empty = await ids({ [field]: { $empty: true } });
      const full = await ids({ [field]: { $empty: false } });
      expect([...empty, ...full].sort(), field).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
      expect(reference({ [field]: { $empty: true } }), field).toEqual(empty);
    }
  });

  it('the live path REFUSES a field it holds no declaration for; the matcher judges the value', async () => {
    expect(await refusal(() => driver.find(TABLE, { where: { nope: { $empty: true } } })))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(await refusal(() => driver.find('never_synced', { where: { title: { $empty: true } } })))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(reference({ nope: { $empty: true } })).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });

  it('the one cell where the declared row and the by-value reading part: a stored state the type cannot hold', async () => {
    // A number column holding '' is a write-door defect, never a value the
    // declaration predicts. The declared null-only row does not count it; the
    // declaration-free matcher does. Pinned so the divergence is known.
    const odd = new InMemoryDriver({ persistence: false });
    await odd.connect();
    await odd.syncSchema('odd', { fields: { id: { type: 'text' }, score: { type: 'number' } } });
    const rows = [{ id: 'blank', score: '' }];
    for (const row of rows) await odd.create('odd', { ...row });
    const live = ((await odd.find('odd', { where: { score: { $empty: true } } })) as Array<Record<string, unknown>>)
      .map((r) => r.id);
    expect(live).toEqual([]);
    expect(rows.filter((r) => match(r, { score: { $empty: true } })).map((r) => r.id)).toEqual(['blank']);
  });

  it('a non-boolean flag is refused by both faces, on the shared shape gate', async () => {
    expect(await refusal(() => driver.find(TABLE, { where: { title: { $empty: 'yes' as never } } })))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(await refusal(() => match(ROWS[0], { title: { $empty: 1 as never } })))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
    // Even where an identity would settle the node before any arm ran.
    expect(await refusal(() => match(ROWS[0], { $or: [{}, { title: { $empty: 'no' as never } }] })))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
  });

  it('the analytics (cube) face refuses $empty as a declared operator it cannot compile — never drops it', async () => {
    const cube: Cube = {
      name: TABLE,
      title: 'empty',
      sql: TABLE,
      measures: { count: { label: 'Rows', type: 'count', sql: 'id' } },
      dimensions: {
        id: { label: 'id', type: 'string', sql: 'id' },
        title: { label: 'title', type: 'string', sql: 'title' },
      },
      public: true,
    } as Cube;
    const service = new MemoryAnalyticsService({ driver, cubes: [cube] });
    expect(
      await refusal(() =>
        service.query({
          cube: TABLE,
          measures: [`${TABLE}.count`],
          dimensions: [`${TABLE}.id`],
          where: { title: { $empty: true } },
        } as never),
      ),
    ).toEqual({ code: 'INVALID_FILTER', status: 400 });
  });
});
