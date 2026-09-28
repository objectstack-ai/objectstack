// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20444] The staged `$empty` operator on `translateFilter`, translated by the
 * field's DECLARED row of the ruled 「is empty」 table (ruling A on #20399,
 * record 5865693155; the spec's `expandEmptyOperator`):
 *
 * | declared row | `$empty: true` | `$empty: false` |
 * |---|---|---|
 * | text-like | `{ f: { $in: [null, ''] } }` | `{ f: { $nin: [null, ''] } }` |
 * | multi-value | `{ $or: [{ f: { $eq: null } }, { f: { $size: 0 } }] }` | the same pair under `$nor` |
 * | every other type | `{ f: { $eq: null } }` | `{ f: { $ne: null } }` |
 *
 * Pinned twice: the emitted DOCUMENTS, and the rows they select under a
 * server-free reading of the MongoDB semantics those documents use (null
 * equality matches a missing field too; `$size` matches an array of that
 * length and nothing else). A live `mongod` suite runs the same cases when the
 * opt-in server is available.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { FilterCondition } from '@objectstack/spec/data';
import { translateFilter, type ValueShapeResolver } from './mongodb-filter.js';
import { buildAggregationPipeline } from './mongodb-aggregation.js';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

const FIELDS: Record<string, { type: string; multiple?: boolean; reference?: string }> = {
  title: { type: 'text' },
  tags: { type: 'tags' },
  owners: { type: 'lookup', reference: 'os20444_empty', multiple: true },
  score: { type: 'number' },
};
const SHAPES: ValueShapeResolver = (field) => FIELDS[field];

const ROWS: Array<Record<string, unknown>> = [
  { id: 'r1', title: 'x', tags: ['a'], owners: ['u1'], score: 5 },
  { id: 'r2', title: '', tags: [], owners: [], score: 0 },
  { id: 'r3', title: null, tags: null, owners: null, score: null },
  { id: 'r4', title: '  ', tags: ['a', 'b'], owners: ['u2'], score: -1 },
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
];

// ── A server-free reading of the MongoDB vocabulary `$empty` lowers to ───────

/** MongoDB equality: a missing field equals null, and an array matches by element. */
function mongoEquals(value: unknown, comparand: unknown): boolean {
  if (comparand === null) {
    return value === null || value === undefined || (Array.isArray(value) && value.includes(null));
  }
  if (Array.isArray(value)) return value.some((element) => element === comparand);
  return value === comparand;
}

function matchOps(value: unknown, ops: Record<string, unknown>): boolean {
  for (const [op, arg] of Object.entries(ops)) {
    switch (op) {
      case '$eq': if (!mongoEquals(value, arg)) return false; break;
      case '$ne': if (mongoEquals(value, arg)) return false; break;
      case '$in': if (!(arg as unknown[]).some((member) => mongoEquals(value, member))) return false; break;
      case '$nin': if ((arg as unknown[]).some((member) => mongoEquals(value, member))) return false; break;
      case '$size': if (!Array.isArray(value) || value.length !== arg) return false; break;
      default: throw new Error(`unmodelled field operator ${op}`);
    }
  }
  return true;
}

function matchDoc(row: Record<string, unknown>, doc: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(doc)) {
    if (key === '$and') { if (!(value as Array<Record<string, unknown>>).every((d) => matchDoc(row, d))) return false; continue; }
    if (key === '$or') { if (!(value as Array<Record<string, unknown>>).some((d) => matchDoc(row, d))) return false; continue; }
    if (key === '$nor') { if ((value as Array<Record<string, unknown>>).some((d) => matchDoc(row, d))) return false; continue; }
    if (key.startsWith('$')) throw new Error(`unmodelled document operator ${key}`);
    const cond = value as Record<string, unknown>;
    const isOps = cond !== null && typeof cond === 'object' && !Array.isArray(cond)
      && Object.keys(cond).every((k) => k.startsWith('$'));
    if (isOps ? !matchOps(row[key], cond) : !mongoEquals(row[key], value)) return false;
  }
  return true;
}

const select = (doc: Record<string, unknown>) => ROWS.filter((r) => matchDoc(r, doc)).map((r) => String(r.id)).sort();

function refusal(run: () => unknown): { code?: string; status?: number } | 'answered' {
  try {
    run();
  } catch (err) {
    return { code: (err as { code?: string }).code, status: (err as { status?: number }).status };
  }
  return 'answered';
}

describe('[#20444] translateFilter — $empty by the declared row', () => {
  it('emits the declared row per field kind, and its exact complement', () => {
    expect(translateFilter({ title: { $empty: true } }, undefined, SHAPES)).toEqual({ title: { $in: [null, ''] } });
    expect(translateFilter({ title: { $empty: false } }, undefined, SHAPES)).toEqual({ title: { $nin: [null, ''] } });
    expect(translateFilter({ tags: { $empty: true } }, undefined, SHAPES))
      .toEqual({ $or: [{ tags: { $eq: null } }, { tags: { $size: 0 } }] });
    expect(translateFilter({ tags: { $empty: false } }, undefined, SHAPES))
      .toEqual({ $nor: [{ tags: { $eq: null } }, { tags: { $size: 0 } }] });
    expect(translateFilter({ score: { $empty: true } }, undefined, SHAPES)).toEqual({ score: { $eq: null } });
    expect(translateFilter({ score: { $empty: false } }, undefined, SHAPES)).toEqual({ score: { $ne: null } });
  });

  it('never tests the empty list as an equality comparand', () => {
    for (const field of ['tags', 'owners']) {
      for (const flag of [true, false]) {
        const doc = JSON.stringify(translateFilter({ [field]: { $empty: flag } }, undefined, SHAPES));
        expect(doc, doc).not.toContain('[]');
      }
    }
  });

  it('beside a sibling operator on the same field, both constraints survive as separate conjuncts', () => {
    expect(translateFilter({ title: { $empty: false, $ne: 'x' } }, undefined, SHAPES))
      .toEqual({ $and: [{ title: { $ne: 'x' } }, { title: { $nin: [null, ''] } }] });
  });

  for (const c of CASES) {
    it(`${JSON.stringify(c.where)} selects ${JSON.stringify(c.expected)}`, () => {
      const doc = translateFilter(c.where, undefined, SHAPES) as Record<string, unknown>;
      expect(select(doc), JSON.stringify(doc)).toEqual(c.expected);
    });
  }

  it('the aggregate $match translates it the way find() does', () => {
    const pipeline = buildAggregationPipeline({
      where: { tags: { $empty: true } },
      aggregations: [{ function: 'count', alias: 'n' }] as never,
      valueShape: SHAPES,
    });
    expect(pipeline[0]).toEqual({ $match: { $or: [{ tags: { $eq: null } }, { tags: { $size: 0 } }] } });
  });

  it('with no declaration it REFUSES — a standalone call, an unknown field, a type-less field', () => {
    expect(refusal(() => translateFilter({ title: { $empty: true } }))).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(refusal(() => translateFilter({ nope: { $empty: true } }, undefined, SHAPES)))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(refusal(() => translateFilter({ $or: [{ title: 'x' }, { nope: { $empty: false } }] }, undefined, SHAPES)))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
  });

  it('a non-boolean flag is refused on the walk, even where an identity settles the node', () => {
    expect(refusal(() => translateFilter({ title: { $empty: 'yes' as never } }, undefined, SHAPES)))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(refusal(() => translateFilter({ $or: [{}, { title: { $empty: 1 as never } }] }, undefined, SHAPES)))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
  });
});

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('$empty operator');

describe.skipIf(!sharedMongod)('[#20444] MongoDBDriver — $empty against a live mongod', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'os20444_empty' });
    await driver.connect();
    await driver.syncSchema('os20444_empty', { name: 'os20444_empty', fields: FIELDS });
    for (const row of ROWS) await driver.create('os20444_empty', { ...row });
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (sharedMongod) await sharedMongod.stop();
  });

  for (const c of CASES) {
    it(`${JSON.stringify(c.where)} selects ${JSON.stringify(c.expected)}`, async () => {
      const rows = (await driver.find('os20444_empty', { where: c.where })) as Array<Record<string, unknown>>;
      expect(rows.map((r) => String(r.id)).sort()).toEqual(c.expected);
    });
  }
});
