// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23679] A `$in` list is hashed once per compiled query, never once per row.
 *
 * mingo's own `$in` rebuilds a hash map of the whole list for every document it
 * tests, so a read over R rows with an N-member list cost R × N hash inserts.
 * The composed `ReadableIds` leaf ([ADR-0139 D3]) lowers into exactly such a
 * list, as long as the readable parent set, and the E3 conformance pins
 * (`memory-readable-ids-conformance.test.ts`) took 2–3 s per test on an idle
 * box, which put them in reach of vitest's 5 s default under CI's per-core
 * worker share: `main`'s hourly full run went red on them. `memory-mingo.ts`
 * builds this driver's mingo context with a `$in` that hashes the list when
 * the query compiles.
 *
 * Two halves, both deterministic, with no wall clock anywhere:
 *   - COST: the number of `HashMap#set` calls a read makes, counted on mingo's
 *     own class, is linear in rows + ids on every door that compiles a `$in`.
 *     The bound is a tenth of R × N, and mingo's per-row hashing makes R × N.
 *   - SEMANTICS: over a matrix of values, lists and selectors, the driver's
 *     `Query` answers exactly what mingo's own `Query` answers.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Query as MingoQuery } from 'mingo';
import { HashMap } from 'mingo/util';
import { ReadableIds, lowerFilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { Query } from './memory-mingo.js';

const seamed = (where: unknown): any => lowerFilterCondition(where, { isDatetimeColumn: () => false });

const TEXT = (name: string) => ({ type: 'text', name });
const PARENT = 'hashed_once_parent';
const CHILD = 'hashed_once_child';
const ROWS = 500;
const READABLE = 400;
/** What mingo's per-row hashing made for the list alone: one insert per member, per row tested. */
const PER_ROW_INSERTS = ROWS * READABLE;
const LINEAR_BOUND = PER_ROW_INSERTS / 10;

const readableIds = (): string[] =>
  Array.from({ length: READABLE }, (_, i) => `p${String(i).padStart(4, '0')}`);

describe('[#23679] InMemoryDriver — a `$in` list is hashed once per compiled query', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(PARENT, { fields: { id: TEXT('id'), owner: TEXT('owner') } });
    await driver.syncSchema(CHILD, { fields: { id: TEXT('id'), record_id: TEXT('record_id') } });
    for (let i = 0; i < ROWS; i++) {
      const id = `p${String(i).padStart(4, '0')}`;
      await driver.create(PARENT, { id, owner: i < READABLE ? 'reader' : 'someone_else' });
      await driver.create(CHILD, { id: `c${String(i).padStart(4, '0')}`, record_id: id });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The `HashMap#set` calls `read` makes, counted on mingo's own class. */
  const insertsDuring = async <T>(read: () => Promise<T>): Promise<{ result: T; inserts: number }> => {
    const set = vi.spyOn(HashMap.prototype, 'set');
    const result = await read();
    const inserts = set.mock.calls.length;
    set.mockRestore();
    return { result, inserts };
  };

  describe('cost: linear in rows + ids, on every door that compiles a `$in`', () => {
    const composed = () => seamed({ record_id: { $in: ReadableIds.compose(ReadableIds.of(PARENT), { owner: 'reader' }) } });

    it('find over a composed ReadableIds leaf', async () => {
      const { result, inserts } = await insertsDuring(() => driver.find(CHILD, { where: composed() }));
      expect(result).toHaveLength(READABLE);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });

    it('count over a composed ReadableIds leaf', async () => {
      const { result, inserts } = await insertsDuring(() => driver.count(CHILD, { where: composed() }));
      expect(result).toBe(READABLE);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });

    it('aggregate (the query shape) over a composed ReadableIds leaf', async () => {
      const { result, inserts } = await insertsDuring(() =>
        driver.aggregate(CHILD, { where: composed(), aggregations: [{ function: 'count', alias: 'n' }] }),
      );
      expect(Number((result[0] as Record<string, unknown>).n)).toBe(READABLE);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });

    it('find over a `$in` list the caller wrote', async () => {
      const { result, inserts } = await insertsDuring(() =>
        driver.find(CHILD, { where: seamed({ record_id: { $in: readableIds() } }) }),
      );
      expect(result).toHaveLength(READABLE);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });

    it("aggregate (the pipeline shape): a `$match` stage's `$in`", async () => {
      const { result, inserts } = await insertsDuring(() =>
        driver.aggregate(CHILD, [{ $match: { record_id: { $in: readableIds() } } }, { $count: 'n' }]),
      );
      expect(result).toEqual([{ n: READABLE }]);
      expect(inserts).toBeLessThan(LINEAR_BOUND);
    });
  });

  describe("semantics: the driver's `$in` answers what mingo's answers", () => {
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
      it(`list: ${listName}`, () => {
        for (const [valueName, value] of VALUES) {
          for (const [docName, selector, doc] of DOCS(value)) {
            const condition = { [selector]: { $in: list } };
            const expected = new MingoQuery(condition).test(doc);
            expect(new Query(condition).test(doc), `${valueName} at ${docName}`).toBe(expected);
          }
        }
      });
    }

    it('a list matched a second time is answered the same (the hash is built once, then only read)', () => {
      const query = new Query({ f: { $in: ['a', 1, null, /^z/] } });
      const docs = [{ f: 'a' }, { f: 2 }, {}, { f: 'zed' }, { f: ['q', 1] }];
      const first = docs.map((d) => query.test(d));
      expect(docs.map((d) => query.test(d))).toEqual(first);
      expect(first).toEqual([true, false, true, true, true]);
    });

    it('a comparand that is not an array is mingo\'s to answer, unchanged', () => {
      const condition = { f: { $in: 'a' } };
      const run = (test: () => boolean) => {
        try {
          return { matched: test() };
        } catch (e) {
          return { threw: (e as Error).message };
        }
      };
      for (const doc of [{ f: 'a' }, {}]) {
        expect(run(() => new Query(condition).test(doc))).toEqual(run(() => new MingoQuery(condition).test(doc)));
      }
    });
  });
});
