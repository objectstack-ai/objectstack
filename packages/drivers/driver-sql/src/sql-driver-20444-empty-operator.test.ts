// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20444] The staged `$empty` operator on `driver-sql`'s filter compiler
 * (`applyFilterCondition`), answered by the field's DECLARED row of the ruled
 * 「is empty」 table — ruling B on #20311 (record 5861435168), spelled as this
 * operator by ruling A on #20399 (record 5865693155) — through the spec's one
 * expansion, `expandEmptyOperator`:
 *
 * | declared row | `$empty: true` | `$empty: false` |
 * |---|---|---|
 * | text-like (`text`) | null or `''` | the exact complement |
 * | multi-value (`tags`; `lookup` with `multiple: true`) | null or `[]` | the exact complement |
 * | every other type (`number`; `lookup` single) | null only | the exact complement |
 *
 * The shared `FILTER_LOGIC_CASES` rows cannot tell those rows apart (their
 * fixture stores neither `''` nor `[]`); this file can. It runs on every cell
 * of the live dialect matrix, because the multi-value row is a different JSON
 * construct per dialect — SQLite always, PostgreSQL and MySQL where the
 * `Temporal Conformance (live PG + MySQL)` job provisions them.
 *
 * `$empty` is staged out of `FILTER_OPERATORS` (「照 $like 先例分阶段」, record
 * 5868169573), so the engine's front door still refuses it; the driver is
 * driven directly here, which is exactly the caller the arm answers today.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os20444_empty_operator';

const shape = (name: string) => ({
  name,
  fields: {
    title: { type: 'text' },
    tags: { type: 'tags' },
    owners: { type: 'lookup', reference: name, multiple: true },
    parent: { type: 'lookup', reference: name },
    score: { type: 'number' },
  },
}) as any;

/**
 * Every stored state a column of each row can hold: a value, the empty string,
 * the empty list, NULL — plus `'  '` (not `''`) and `0` (not empty), the two
 * values a lenient reading would count as empty.
 */
const ROWS = [
  { id: 'r1', title: 'x', tags: ['a'], owners: ['u1'], parent: 'p1', score: 5 },
  { id: 'r2', title: '', tags: [], owners: [], parent: null, score: 0 },
  { id: 'r3', title: null, tags: null, owners: null, parent: null, score: null },
  { id: 'r4', title: '  ', tags: ['a', 'b'], owners: ['u2'], parent: 'p2', score: -1 },
];

const NO_AUDIT = { bypassTenantAudit: true };

function measure(cell: DialectCell): void {
  describe(`[#20444] $empty by the declared row — ${cell.label}`, () => {
    let driver: SqlDriver;
    const ids = async (where: FilterCondition) =>
      (await driver.find(TABLE, { where }, NO_AUDIT)).map((r) => String(r.id)).sort();
    const refusal = async (where: FilterCondition) => {
      try {
        await driver.find(TABLE, { where }, NO_AUDIT);
      } catch (err) {
        return { code: (err as { code?: string }).code, status: (err as { status?: number }).status };
      }
      return 'answered';
    };

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([shape(TABLE)]);
      for (const row of ROWS) await driver.create(TABLE, { ...row }, NO_AUDIT);
    });

    afterAll(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.disconnect();
    });

    it('the fixture is the four rows, stored as written', async () => {
      expect(await ids({})).toEqual(['r1', 'r2', 'r3', 'r4']);
      const r2 = await driver.findOne(TABLE, { where: { id: 'r2' } }, NO_AUDIT);
      // The two stored states the operator exists to recognise, read back.
      expect(r2?.title).toBe('');
      expect(r2?.tags).toEqual([]);
    });

    it("text-like: null or '' — not '  '", async () => {
      expect(await ids({ title: { $empty: true } })).toEqual(['r2', 'r3']);
      expect(await ids({ title: { $empty: false } })).toEqual(['r1', 'r4']);
    });

    it('multi-value: null or [] — tags and a lookup with multiple: true', async () => {
      for (const field of ['tags', 'owners']) {
        expect(await ids({ [field]: { $empty: true } }), field).toEqual(['r2', 'r3']);
        expect(await ids({ [field]: { $empty: false } }), field).toEqual(['r1', 'r4']);
      }
    });

    it('every other type: null only — 0 is a value, and a single lookup is not a list', async () => {
      expect(await ids({ score: { $empty: true } })).toEqual(['r3']);
      expect(await ids({ score: { $empty: false } })).toEqual(['r1', 'r2', 'r4']);
      expect(await ids({ parent: { $empty: true } })).toEqual(['r2', 'r3']);
      expect(await ids({ parent: { $empty: false } })).toEqual(['r1', 'r4']);
    });

    it('$empty: false is the exact complement on every field — the two partition the table', async () => {
      for (const field of ['title', 'tags', 'owners', 'parent', 'score']) {
        const empty = await ids({ [field]: { $empty: true } });
        const full = await ids({ [field]: { $empty: false } });
        expect([...empty, ...full].sort(), field).toEqual(['r1', 'r2', 'r3', 'r4']);
        expect(empty.filter((id) => full.includes(id)), field).toEqual([]);
      }
    });

    it('under $not the answer is the complement — no row is lost to UNKNOWN', async () => {
      expect(await ids({ $not: { title: { $empty: true } } })).toEqual(['r1', 'r4']);
      expect(await ids({ $not: { tags: { $empty: false } } })).toEqual(['r2', 'r3']);
      expect(await ids({ $not: { score: { $empty: true } } })).toEqual(['r1', 'r2', 'r4']);
    });

    it('nests under $and / $or like any predicate, and ANDs with a sibling operator', async () => {
      expect(await ids({ $or: [{ score: 5 }, { tags: { $empty: true } }] })).toEqual(['r1', 'r2', 'r3']);
      expect(await ids({ $and: [{ title: { $empty: false } }, { owners: { $empty: false } }] })).toEqual(['r1', 'r4']);
      expect(await ids({ $or: [{ $and: [{ score: { $empty: false } }, { title: { $empty: true } }] }, { id: 'r1' }] }))
        .toEqual(['r1', 'r2']);
      expect(await ids({ title: { $empty: false, $ne: 'x' } })).toEqual(['r4']);
    });

    it('a field with no declaration is REFUSED, never guessed', async () => {
      // `id` is a builtin column no field declares.
      expect(await refusal({ id: { $empty: true } })).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(await refusal({ $or: [{ id: 'r1' }, { nope: { $empty: false } }] }))
        .toEqual({ code: 'INVALID_FILTER', status: 400 });
    });

    it('a non-boolean flag is REFUSED on the walk, even where an identity would skip the emitter', async () => {
      expect(await refusal({ title: { $empty: 'yes' as unknown as boolean } }))
        .toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(await refusal({ $or: [{}, { title: { $empty: 1 as unknown as boolean } }] }))
        .toEqual({ code: 'INVALID_FILTER', status: 400 });
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, '$empty operator', measure);
