// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `$contains` / `$notContains` on `translateFilter`, by the field's DECLARED
 * value shape — the contract `FILTER_OPERATORS`' `$contains` docblock
 * (`@objectstack/spec`) states: MEMBERSHIP on a `multiple: true` field or a
 * JSON-stored type, the SUBSTRING test on a scalar string column, as
 * `driver-sql` answers on every dialect and `driver-memory` on every face.
 *
 * | declared shape | `$contains: v` | `$notContains: v` |
 * |---|---|---|
 * | JSON-stored | `{ f: { $elemMatch: { $in: members, $not: { $type: 'array' } } } }` | the same test under `$not` |
 * | anything else, or none held | `{ f: { $regex: escaped(v) } }` | `{ f: { $not: { $regex } } }` |
 *
 * Before, every field took the `$regex`, and MongoDB applies a `$regex` to each
 * element of an array value: `'u1'` matched a stored `['u10']`, the cell this
 * file pins first, beside a scalar text column that still answers substring.
 *
 * Pinned twice, as `mongodb-20444-empty-operator.test.ts` pins `$empty`: the
 * emitted DOCUMENTS, and the rows they select under a server-free reading of
 * the MongoDB semantics those documents use. A live `mongod` suite runs the
 * same cases when the opt-in server is available.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { FilterCondition } from '@objectstack/spec/data';
import { translateFilter, type ValueShapeResolver } from './mongodb-filter.js';
import { buildAggregationPipeline } from './mongodb-aggregation.js';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

const OBJECT = 'os_contains_membership';

const FIELDS: Record<string, { type: string; multiple?: boolean; reference?: string }> = {
  title: { type: 'text' },
  owners: { type: 'lookup', reference: OBJECT, multiple: true },
  tags: { type: 'tags' },
  meta: { type: 'json' },
};
const SHAPES: ValueShapeResolver = (field) => FIELDS[field];

const ROWS: Array<Record<string, unknown>> = [
  { id: 'r1', title: 'u10', owners: ['u10'], tags: ['redwood'], meta: [10, 21] },
  { id: 'r2', title: 'u1', owners: ['u1', 'u2'], tags: ['red'], meta: [1, 2] },
  { id: 'r3', title: 'x', owners: [], tags: [], meta: [true, null] },
  { id: 'r4', title: null, owners: null, tags: null, meta: null },
  { id: 'r5' },
  { id: 'r6', title: 'y', owners: [['u1']], tags: ['RED'], meta: { k: 'u1' } },
  { id: 'r7', title: 'z', owners: 'u1', tags: ['blue'], meta: [1.5] },
];

const CASES: Array<{ name: string; where: FilterCondition; expected: string[] }> = [
  { name: "'u1' against a stored ['u10'] is not a member", where: { owners: { $contains: 'u1' } }, expected: ['r2'] },
  { name: 'the exact complement, the rows with no value included', where: { owners: { $notContains: 'u1' } }, expected: ['r1', 'r3', 'r4', 'r5', 'r6', 'r7'] },
  { name: 'the scalar control: a text column keeps the substring test', where: { title: { $contains: 'u1' } }, expected: ['r1', 'r2'] },
  { name: 'the scalar control, negated', where: { title: { $notContains: 'u1' } }, expected: ['r3', 'r4', 'r5', 'r6', 'r7'] },
  { name: "a tags field: 'red' is not a member of ['redwood'], and the test is case-exact", where: { tags: { $contains: 'red' } }, expected: ['r2'] },
  { name: "a json field: '1' names the number 1, and not 10 or 21", where: { meta: { $contains: '1' } }, expected: ['r2'] },
  { name: "a json field: '1.50' names the number 1.5", where: { meta: { $contains: '1.50' } }, expected: ['r7'] },
  { name: "a json field: 'true' and 'null' name the literals", where: { $and: [{ meta: { $contains: 'true' } }, { meta: { $contains: 'null' } }] }, expected: ['r3'] },
  { name: 'an object root has no member', where: { meta: { $contains: 'u1' } }, expected: [] },
  { name: 'under $or beside a scalar column', where: { $or: [{ owners: { $contains: 'u2' } }, { title: { $contains: 'x' } }] }, expected: ['r2', 'r3'] },
];

// ── A server-free reading of the MongoDB vocabulary these documents use ─────

/** `$elemMatch` with operator queries: some ELEMENT of an array value satisfies every one. */
function elemMatches(value: unknown, query: Record<string, unknown>): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((element) => Object.entries(query).every(([op, arg]) => {
    switch (op) {
      // A scalar element equals a member of its own BSON type only: `'1'` never equals `1`.
      case '$in': return (arg as unknown[]).some((member) => element === member);
      case '$not': {
        const inner = arg as Record<string, unknown>;
        if (Object.keys(inner).length !== 1 || inner.$type !== 'array') throw new Error(`unmodelled $not ${JSON.stringify(inner)}`);
        return !Array.isArray(element);
      }
      default: throw new Error(`unmodelled $elemMatch operator ${op}`);
    }
  }));
}

/** `$regex` on a field: a string value, or ANY string element of an array value (one level). */
function regexMatches(value: unknown, pattern: string): boolean {
  const re = new RegExp(pattern);
  if (typeof value === 'string') return re.test(value);
  if (Array.isArray(value)) return value.some((element) => typeof element === 'string' && re.test(element));
  return false;
}

function matchOps(value: unknown, ops: Record<string, unknown>): boolean {
  for (const [op, arg] of Object.entries(ops)) {
    switch (op) {
      case '$elemMatch': if (!elemMatches(value, arg as Record<string, unknown>)) return false; break;
      case '$regex': if (!regexMatches(value, arg as string)) return false; break;
      // MongoDB's field `$not` also matches a document whose field is missing.
      case '$not': if (matchOps(value, arg as Record<string, unknown>)) return false; break;
      default: throw new Error(`unmodelled field operator ${op}`);
    }
  }
  return true;
}

/** MongoDB implicit equality: a scalar matches itself, and an array value matches by element. */
function equals(value: unknown, comparand: unknown): boolean {
  if (Array.isArray(value)) return value.some((element) => element === comparand);
  return value === comparand;
}

function matchDoc(row: Record<string, unknown>, doc: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(doc)) {
    if (key === '$and') { if (!(value as Array<Record<string, unknown>>).every((d) => matchDoc(row, d))) return false; continue; }
    if (key === '$or') { if (!(value as Array<Record<string, unknown>>).some((d) => matchDoc(row, d))) return false; continue; }
    if (key.startsWith('$')) throw new Error(`unmodelled document operator ${key}`);
    const cond = value as Record<string, unknown>;
    const isOps = cond !== null && typeof cond === 'object' && !Array.isArray(cond)
      && Object.keys(cond).every((k) => k.startsWith('$'));
    if (isOps ? !matchOps(row[key], cond) : !equals(row[key], value)) return false;
  }
  return true;
}

const select = (doc: Record<string, unknown>) => ROWS.filter((r) => matchDoc(r, doc)).map((r) => String(r.id)).sort();

describe('translateFilter — $contains asks membership on a declared JSON-stored field', () => {
  it('emits the membership test on a JSON-stored field and the substring pattern on a scalar column', () => {
    const membership = (members: unknown[]) => ({ $elemMatch: { $in: members, $not: { $type: 'array' } } });
    expect(translateFilter({ owners: { $contains: 'u1' } }, undefined, SHAPES)).toEqual({ owners: membership(['u1']) });
    expect(translateFilter({ owners: { $notContains: 'u1' } }, undefined, SHAPES)).toEqual({ owners: { $not: membership(['u1']) } });
    expect(translateFilter({ meta: { $contains: '1' } }, undefined, SHAPES)).toEqual({ meta: membership(['1', 1]) });
    expect(translateFilter({ meta: { $contains: '1.50' } }, undefined, SHAPES)).toEqual({ meta: membership(['1.50', 1.5]) });
    expect(translateFilter({ meta: { $contains: 'true' } }, undefined, SHAPES)).toEqual({ meta: membership(['true', true]) });
    expect(translateFilter({ meta: { $contains: 'null' } }, undefined, SHAPES)).toEqual({ meta: membership(['null', null]) });
    expect(translateFilter({ title: { $contains: 'u1' } }, undefined, SHAPES)).toEqual({ title: { $regex: 'u1' } });
    expect(translateFilter({ title: { $notContains: 'u1' } }, undefined, SHAPES)).toEqual({ title: { $not: { $regex: 'u1' } } });
  });

  it('a member is matched literally: no regex metacharacter reaches the membership test', () => {
    expect(translateFilter({ tags: { $contains: 'a.b+c' } }, undefined, SHAPES))
      .toEqual({ tags: { $elemMatch: { $in: ['a.b+c'], $not: { $type: 'array' } } } });
  });

  for (const c of CASES) {
    it(`${c.name}: ${JSON.stringify(c.where)} selects ${JSON.stringify(c.expected)}`, () => {
      const doc = translateFilter(c.where, undefined, SHAPES) as Record<string, unknown>;
      expect(select(doc), JSON.stringify(doc)).toEqual(c.expected);
    });
  }

  it('beside $startsWith on the same field, both constraints survive — $elemMatch contests no key', () => {
    expect(translateFilter({ tags: { $contains: 'red', $startsWith: 'r' } }, undefined, SHAPES))
      .toEqual({ tags: { $elemMatch: { $in: ['red'], $not: { $type: 'array' } }, $regex: '^r' } });
  });

  it('the aggregate $match translates it the way find() does', () => {
    const pipeline = buildAggregationPipeline({
      where: { owners: { $contains: 'u1' } },
      aggregations: [{ function: 'count', alias: 'n' }] as never,
      valueShape: SHAPES,
    });
    expect(pipeline[0]).toEqual({ $match: { owners: { $elemMatch: { $in: ['u1'], $not: { $type: 'array' } } } } });
  });

  it('with no declaration held, every field keeps the substring reading, as driver-sql does for a table it was never told about', () => {
    const doc = translateFilter({ owners: { $contains: 'u1' } }) as Record<string, unknown>;
    expect(doc).toEqual({ owners: { $regex: 'u1' } });
    // The per-element substring the declaration exists to replace: 'u1' answers
    // ['u10']. (Whether a `$regex` reaches into the NESTED array of r6 is left
    // unmodelled here; the membership test above excludes it by construction.)
    expect(select(doc)).toEqual(expect.arrayContaining(['r1', 'r2', 'r7']));
    expect(translateFilter({ nope: { $contains: 'u1' } }, undefined, SHAPES)).toEqual({ nope: { $regex: 'u1' } });
  });
});

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('$contains membership');

describe.skipIf(!sharedMongod)('MongoDBDriver — $contains membership against a live mongod', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: OBJECT });
    await driver.connect();
    await driver.syncSchema(OBJECT, { name: OBJECT, fields: FIELDS });
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (sharedMongod) await sharedMongod.stop();
  });

  for (const c of CASES) {
    it(`${c.name}: selects ${JSON.stringify(c.expected)}`, async () => {
      const rows = (await driver.find(OBJECT, { where: c.where })) as Array<Record<string, unknown>>;
      expect(rows.map((r) => String(r.id)).sort()).toEqual(c.expected);
    });
  }
});
