// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3, #23679] A composed `ReadableIds` leaf hashes its readable ids
 * once per query, never once per row.
 *
 * The leaf is rewritten into the ids of every readable parent row. Handed to
 * mingo as a plain `$in`, that list was re-hashed for every row tested, so a
 * read over R rows under N readable parents made R × N hash inserts. The E3
 * conformance pins (`memory-readable-ids-conformance.test.ts`) took 2–3 s per
 * test on an idle box, within reach of vitest's 5 s default under CI's
 * per-core worker share, and `main`'s hourly full run went red on them.
 * `memory-readable-ids-member.ts` lowers the leaf's list to a member test that
 * hashes it when the query compiles.
 *
 * Three parts, all deterministic, with no wall clock anywhere:
 *   - COST: the `HashMap#set` calls a composed-leaf read makes, counted on
 *     mingo's own class, are linear in rows + ids on every read door, and under
 *     every combinator. The bound is a tenth of R × N, and the per-row hashing
 *     made R × N.
 *   - ANSWERS: over a matrix of values, lists and selectors, the member test
 *     answers exactly what mingo's `$in` answers, and the write doors answer a
 *     composed leaf as they did.
 *   - NOT AUTHORABLE: a filter naming the private operator is refused by the
 *     shape gate.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Query as MingoQuery } from 'mingo';
import { HashMap } from 'mingo/util';
import { ReadableIds, lowerFilterCondition } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { InMemoryDriver } from './memory-driver.js';
import { Query, READABLE_IDS_MEMBER_OP, isReadableIdsList, markReadableIdsList } from './memory-readable-ids-member.js';

const seamed = (where: unknown): DriverQuery['where'] =>
  lowerFilterCondition(where, { isDatetimeColumn: () => false }) as DriverQuery['where'];

const TEXT = (name: string) => ({ type: 'text', name });
const PARENT = 'hashed_once_parent';
const CHILD = 'hashed_once_child';
const ROWS = 500;
const READABLE = 400;
/** What the per-row hashing made for the list alone: one insert per readable id, per row tested. */
const PER_ROW_INSERTS = ROWS * READABLE;
const LINEAR_BOUND = PER_ROW_INSERTS / 10;

const parentId = (i: number) => `p${String(i).padStart(4, '0')}`;
const composed = () => ReadableIds.compose(ReadableIds.of(PARENT), { owner: 'reader' });

async function seed(): Promise<InMemoryDriver> {
  const driver = new InMemoryDriver({ persistence: false });
  await driver.connect();
  await driver.syncSchema(PARENT, { fields: { id: TEXT('id'), owner: TEXT('owner') } });
  await driver.syncSchema(CHILD, { fields: { id: TEXT('id'), record_id: TEXT('record_id'), label: TEXT('label') } });
  for (let i = 0; i < ROWS; i++) {
    await driver.create(PARENT, { id: parentId(i), owner: i < READABLE ? 'reader' : 'someone_else' });
    await driver.create(CHILD, { id: `c${String(i).padStart(4, '0')}`, record_id: parentId(i), label: 'x' });
  }
  return driver;
}

/** The `HashMap#set` calls `read` makes, counted on mingo's own class. */
async function insertsDuring<T>(read: () => Promise<T>): Promise<{ result: T; inserts: number }> {
  const set = vi.spyOn(HashMap.prototype, 'set');
  try {
    const result = await read();
    return { result, inserts: set.mock.calls.length };
  } finally {
    set.mockRestore();
  }
}

describe('[ADR-0139 D3] InMemoryDriver — a composed ReadableIds leaf hashes its ids once per query', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = await seed();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cost: linear in rows + ids, on every read door and under every combinator', () => {
    const where = () => seamed({ record_id: { $in: composed() } });

    it('find', async () => {
      const { result, inserts } = await insertsDuring(() => driver.find(CHILD, { where: where() }));
      expect(result).toHaveLength(READABLE);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });

    it('count', async () => {
      const { result, inserts } = await insertsDuring(() => driver.count(CHILD, { where: where() }));
      expect(result).toBe(READABLE);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });

    it('aggregate', async () => {
      const { result, inserts } = await insertsDuring(() =>
        driver.aggregate(CHILD, { where: where(), aggregations: [{ function: 'count', alias: 'n' }] }),
      );
      expect(Number((result[0] as Record<string, unknown>).n)).toBe(READABLE);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });

    it('distinct', async () => {
      const { result, inserts } = await insertsDuring(() => driver.distinct(CHILD, 'record_id', { where: where() }));
      expect(result).toHaveLength(READABLE);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });

    it('under $not: the leaf compiles inside the sub-query mingo builds for $nor', async () => {
      const { result, inserts } = await insertsDuring(() =>
        driver.find(CHILD, { where: seamed({ $not: { record_id: { $in: composed() } } }) }),
      );
      expect(result).toHaveLength(ROWS - READABLE);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });

    it('under $or', async () => {
      const { result, inserts } = await insertsDuring(() =>
        driver.find(CHILD, { where: seamed({ $or: [{ record_id: { $in: composed() } }, { id: 'c0499' }] }) }),
      );
      expect(result).toHaveLength(READABLE + 1);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });
  });

  describe('answers', () => {
    it('the write doors answer a composed leaf as before: updateMany, then deleteMany', async () => {
      const fresh = await seed();
      const where = seamed({ record_id: { $in: composed() } });
      expect(await fresh.updateMany(CHILD, { where }, { label: 'readable' })).toBe(READABLE);
      expect(await fresh.count(CHILD, { where: seamed({ label: 'readable' }) })).toBe(READABLE);
      expect(await fresh.deleteMany(CHILD, { where })).toBe(READABLE);
      expect(await fresh.count(CHILD, {})).toBe(ROWS - READABLE);
    });

    it("only a list the driver marked is the leaf's: a filter-written array is not", () => {
      expect(isReadableIdsList(['p0000'])).toBe(false);
      expect(isReadableIdsList(markReadableIdsList(['p0000']))).toBe(true);
    });

    const VALUES: Array<[string, unknown]> = [
      ['a string', 'a'],
      ['another string', 'abc'],
      ['a number', 1],
      ['a numeric string', '1'],
      ['a boolean', true],
      ['null', null],
      ['an array of strings', ['a', 'z']],
      ['an empty array', []],
      ['an array holding null', [null]],
      ['an object', { x: 1 }],
      ['an array of objects', [{ x: 1 }]],
      ['a date', new Date(0)],
      ['a nested array', [['a', 'z']]],
    ];
    const LISTS: Array<[string, unknown[]]> = [
      ['empty', []],
      ['one string', ['a']],
      ['one number', [1]],
      ['one numeric string', ['1']],
      ['a number and its string', [1, '1']],
      ['null', [null]],
      ['null and a string', [null, 'a']],
      ['a RegExp', [/^a/]],
      ['a string and a RegExp', ['z', /b/]],
      ['an object', [{ x: 1 }]],
      ['an array', [['a', 'z']]],
      ['a date', [new Date(0)]],
      ['a boolean', [true]],
    ];
    const DOCS = (value: unknown): Array<[string, string, Record<string, unknown>]> => [
      ['top-level field', 'f', { f: value }],
      ['missing field', 'f', { g: value }],
      ['dotted path', 'g.f', { g: { f: value } }],
      ['dotted path through an array of subdocuments', 'g.f', { g: [{ f: value }, { f: 'b' }] }],
    ];

    for (const [listName, list] of LISTS) {
      it(`the member test answers what mingo's $in answers — list: ${listName}`, () => {
        for (const [valueName, value] of VALUES) {
          for (const [docName, selector, doc] of DOCS(value)) {
            const expected = new MingoQuery({ [selector]: { $in: list } }).test(doc);
            const actual = new Query({ [selector]: { [READABLE_IDS_MEMBER_OP]: list } }).test(doc);
            expect(actual, `${valueName} at ${docName}`).toBe(expected);
          }
        }
      });
    }

    it('a compiled member test answers the same on every row it is asked (the hash is built once, then only read)', () => {
      const query = new Query({ f: { [READABLE_IDS_MEMBER_OP]: ['a', 1, null, /^z/] } });
      const docs = [{ f: 'a' }, { f: 2 }, {}, { f: 'zed' }, { f: ['q', 1] }];
      const first = docs.map((d) => query.test(d));
      expect(docs.map((d) => query.test(d))).toEqual(first);
      expect(first).toEqual([true, false, true, true, true]);
    });

    it("a comparand that is not an array is mingo's $in to answer, unchanged", () => {
      const run = (test: () => boolean) => {
        try {
          return { matched: test() };
        } catch (e) {
          return { threw: (e as Error).message };
        }
      };
      for (const doc of [{ f: 'a' }, {}]) {
        expect(run(() => new Query({ f: { [READABLE_IDS_MEMBER_OP]: 'a' } }).test(doc))).toEqual(
          run(() => new MingoQuery({ f: { $in: 'a' } }).test(doc)),
        );
      }
    });
  });

  describe('not authorable', () => {
    it('a filter naming the private operator is refused by the shape gate', async () => {
      await expect(
        driver.find(CHILD, { where: { record_id: { [READABLE_IDS_MEMBER_OP]: [parentId(0)] } } }),
      ).rejects.toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    });
  });
});
