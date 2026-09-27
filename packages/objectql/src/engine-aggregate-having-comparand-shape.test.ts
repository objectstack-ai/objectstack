// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19974] `engine.aggregate({ having })` walks through the shared
 * comparand-SHAPE face — the same `assertListComparandShapes` the engine
 * already applies to `where` and to `aggregations[i].filter` on this verb.
 *
 * The 2026-09-23 ruling on #19757 refuses an array in the equality slot at
 * that face "for every driver at once". `having` never reaches a driver: the
 * engine evaluates it itself (`applyHaving`, having-filter.ts), once after the
 * native `driver.aggregate()` door and once after the in-memory fallback. That
 * walker sent an array into its implicit-equality arm (`value == condition`)
 * and compared `$eq` with `!=`, so by JS coercion (`500 == [500]` is true) the
 * shape the ruling refuses still ANSWERED. Measured on the base (9b8c74c6c5)
 * through the public `engine.aggregate`, on driver-memory AND
 * driver-sqlite-wasm, on both doors, over the groups c1 (total 500), c2 (1250)
 * and c3 (20):
 *
 *   | `having`                               | `where` (same shape)  | `having` (both doors, both drivers) |
 *   |:--|:--|:--|
 *   | `{ total: [500] }`                     | 400 `INVALID_FILTER`  | c1 — answered by `==` coercion      |
 *   | `{ total: { $eq: [500] } }`            | 400                   | c1                                  |
 *   | `{ customer_id: { $nin: 'c1' } }`      | 400                   | c1, c2, c3 — the filter dropped     |
 *   | `{ total: { $between: 500 } }`         | 400                   | c1, c2, c3 — the filter dropped     |
 *   | `{ total: { $lt: null } }`             | 400                   | no group                            |
 *
 * — and every other arm the face refuses answered the same way (the full
 * table is {@link FACE_REFUSED}; before this change all 20 rows answered on
 * `having` while all 20 were refused on `where`).
 *
 * Four pins, each on BOTH doors:
 *
 * 1. the where/having parity table — every shape the face refuses for `where`
 *    is refused for `having`, with the SAME envelope and the same words, path
 *    aside, and no driver is asked for a row;
 * 2. the shared conformance table — `FILTER_COMPARAND_TYPE_CASES`' door-refusal
 *    rows that belong to this face, driven down the `having` path;
 * 3. scalars and the declared list/range spellings pass and answer exactly as
 *    before;
 * 4. the verdict is the FILTER's, not the data's — an empty grouped set refuses
 *    the same `having` a populated one does.
 *
 * Every refusal asserts the ADR-0112 envelope (`code` + `status`); a bare
 * `toThrow()` would be satisfied by any uncoded error.
 *
 * ## [#20099] The rest of `where`'s doors, on the same table
 *
 * The face above was the only door `having` took. Measured on the base
 * (aa04ea2964) through `engine.aggregate` on driver-memory and
 * driver-sqlite-wasm, both doors, the four others answered like this — and the
 * blocks after the face's extend the same table to each of them:
 *
 *   | `having`                                   | `where` (same shape)          | `having` before                    |
 *   |:--|:--|:--|
 *   | `{ total: { $gt: { $field: 'max_cap' } } }` | sqlite: the rows, resolved    | no group — the reference never read |
 *   | `{ total: { $eq: { v: 1 } } }`              | 400, the comparand-TYPE door  | no group                           |
 *   | `[['total', '>', 100]]`                     | lowered sugar, the rows       | no group — index keys as columns   |
 *   | `{ total: { $median: 1 } }`                 | 400                           | 400 on a populated set, `200 []` on an empty one |
 *
 * 5. the comparand-TYPE door — its own where/having parity table, and the
 *    `FILTER_COMPARAND_TYPE_CASES` rows that are that door's, now driven down
 *    the `having` path too;
 * 6. `having` is a filter condition OBJECT — an array (the `FilterArray` sugar
 *    is declared on `where` alone) or a scalar is refused, never read;
 * 7. the walker's own refusals are row-independent — each on an empty and a
 *    populated grouped set, in the walker's own words;
 * 8. a `{ $field }` reference resolves against the aggregated row in the six
 *    scalar comparisons, `addDays` included, and is refused in every other
 *    position and when it names no column.
 */

import { describe, it, expect } from 'vitest';
import {
  assertListComparandShapes,
  normalizeFilterComparandTypes,
  FILTER_COMPARAND_TYPE_CASES,
  type ComparandTypeRefusalCase,
  type EngineAggregateOptions,
  type FilterCondition,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applyHaving } from './having-filter.js';

const OBJECT = 'order';

const ROWS = [
  { customer_id: 'c1', amount: 100 },
  { customer_id: 'c1', amount: 400 },
  { customer_id: 'c2', amount: 900 },
  { customer_id: 'c2', amount: 300 },
  { customer_id: 'c2', amount: 50 },
  { customer_id: 'c3', amount: 20 },
];

const AGG_QUERY: EngineAggregateOptions = {
  groupBy: ['customer_id'],
  aggregations: [
    { function: 'count', alias: 'order_count' },
    { function: 'sum', field: 'amount', alias: 'total' },
  ],
};

/**
 * The refused shapes are OFF-CONTRACT by design — a scalar `$in`, a null
 * `$between` bound — so the bag carrying one is cast through `unknown` to the
 * contract it bypasses, never erased to `any`: the rest of the call stays
 * checked, and the cast names what is being bypassed.
 */
function offContract(bag: Record<string, unknown>): EngineAggregateOptions {
  return bag as unknown as EngineAggregateOptions;
}

interface Calls { aggregate: number; find: number }

/**
 * A stand-in driver that records every read. `native: true` gives it an
 * `aggregate()` (the first `applyHaving` door); `native: false` leaves only
 * `find()`, so the engine takes the in-memory fallback (the second door).
 */
function makeDriver(rows: ReadonlyArray<Record<string, unknown>>, native: boolean) {
  const calls: Calls = { aggregate: 0, find: 0 };
  const driver: any = {
    name: native ? 'native-agg-recorder' : 'raw-recorder',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { calls.find += 1; return rows.map((r) => ({ ...r })); },
    async findOne() { return rows[0] ?? null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  if (native) {
    // Groups by `customer_id` and computes the requested aggregations itself,
    // ignoring `ast.having` — as every real native driver does today; the
    // engine's post-filter is what makes it live. [#20099] It reads the
    // requested aliases rather than hard-coding two, so a `{ $field }`
    // reference can name a third column (`count` / `sum` / `min` / `max`, with
    // `applyInMemoryAggregation`'s null-for-an-empty-min/max reading).
    driver.aggregate = async (_object: string, ast: any) => {
      calls.aggregate += 1;
      const groups = new Map<string, Array<Record<string, any>>>();
      for (const r of rows as Array<Record<string, any>>) {
        groups.set(r.customer_id, [...(groups.get(r.customer_id) ?? []), r]);
      }
      return Array.from(groups.entries()).map(([customerId, members]) => {
        const out: Record<string, unknown> = { customer_id: customerId };
        for (const a of ast.aggregations as Array<{ function: string; field?: string; alias: string }>) {
          const values = members.map((m) => m[a.field ?? '']).filter((v) => v != null);
          if (a.function === 'count') out[a.alias] = members.length;
          else if (a.function === 'sum') out[a.alias] = values.reduce((s, v) => s + v, 0);
          else if (a.function === 'min') out[a.alias] = values.length ? values.reduce((m, v) => (v < m ? v : m)) : null;
          else if (a.function === 'max') out[a.alias] = values.length ? values.reduce((m, v) => (v > m ? v : m)) : null;
        }
        return out;
      });
    };
  }
  return { driver, calls };
}

async function makeEngine(rows: ReadonlyArray<Record<string, unknown>>, native: boolean) {
  const { driver, calls } = makeDriver(rows, native);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: OBJECT,
    fields: {
      customer_id: { type: 'text' },
      amount: { type: 'number' },
      // [#20099] The columns the `{ $field }` rows aggregate — declared so the
      // `where` doors a per-aggregation filter takes judge a real object.
      cap: { type: 'number' },
      placed_on: { type: 'date' },
      due_on: { type: 'date' },
      grace: { type: 'number' },
      // [#20127] Declared types are what an aggregated column's class is read
      // from, so the `addDays` pairs need a datetime class beside the date one.
      opened_at: { type: 'datetime' },
      closed_at: { type: 'datetime' },
    },
  } as any);
  return { engine, calls };
}

const DOORS = [
  ['native driver.aggregate() door', true],
  ['in-memory fallback door', false],
] as const;

interface Refusal extends Error { code?: unknown; status?: unknown }

async function refusalOf(run: () => Promise<unknown>): Promise<Refusal> {
  let out: unknown;
  try {
    out = await run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, but it answered ${JSON.stringify(out)}`);
}

function syncRefusalOf(run: () => unknown): Refusal | undefined {
  try {
    run();
  } catch (e) {
    return e as Refusal;
  }
  return undefined;
}

function expectEnvelope(err: Refusal): void {
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
}

/** The group ids an aggregate answered, sorted. */
const groups = (rows: any[]) => rows.map((r) => r.customer_id).sort();

/**
 * The face's refused set — one row per arm it carries today, at every depth it
 * walks. Each filter is written once and used VERBATIM as a `where` and as a
 * `having`: the engine keeps its registry-less tolerance for filter field
 * names, so `total` / `order_count` reach the face in `where` exactly as they
 * do in `having`, and the two refusals can be compared word for word.
 *
 * The factory is deliberate: the filters are handed to the engine, and a
 * shared instance across tests would let one call's handling change what the
 * next one judged.
 */
const FACE_REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>]> = [
  ['an array in the implicit-equality slot (the triage shape)', () => ({ total: [500] })],
  ['an EMPTY array in the implicit-equality slot', () => ({ total: [] })],
  ['an array under $eq (the triage shape)', () => ({ total: { $eq: [500] } })],
  ['an equality-slot array nested in $or', () => ({ $or: [{ order_count: 99 }, { total: [500] }] })],
  ['an equality-slot array nested in $and', () => ({ $and: [{ customer_id: 'c1' }, { total: [500] }] })],
  ['an equality-slot array under $not', () => ({ $not: { total: [500] } })],
  ['a scalar $in', () => ({ customer_id: { $in: 'c1' } })],
  ['a scalar $nin', () => ({ customer_id: { $nin: 'c1' } })],
  ['a null $in member', () => ({ customer_id: { $in: ['c1', null] } })],
  ['a null $nin member', () => ({ customer_id: { $nin: ['c1', null] } })],
  ['$gt: null', () => ({ total: { $gt: null } })],
  ['$gte: null', () => ({ total: { $gte: null } })],
  ['$lt: null', () => ({ total: { $lt: null } })],
  ['$lte: null', () => ({ total: { $lte: null } })],
  ['a scalar $between', () => ({ total: { $between: 500 } })],
  ['a one-bound $between', () => ({ total: { $between: [500] } })],
  ['a null $between bound', () => ({ total: { $between: [null, 1000] } })],
  ['an empty-string $between bound', () => ({ total: { $between: ['', 1000] } })],
  ['an undefined $between bound', () => ({ total: { $between: [undefined, 1000] } })],
  ['a { $field } $between bound', () => ({ total: { $between: [{ $field: 'order_count' }, 1000] } })],
];

describe('[#19974] having — the where/having parity table over the comparand-shape face', () => {
  for (const [name, filter] of FACE_REFUSED) {
    it(`${name}: refused as a where AND as a having, one envelope, one wording, both doors`, async () => {
      const { engine: whereEngine, calls: whereCalls } = await makeEngine(ROWS, true);
      const whereErr = await refusalOf(() =>
        whereEngine.aggregate(OBJECT, offContract({ ...AGG_QUERY, where: filter() })));
      expectEnvelope(whereErr);
      expect(whereCalls).toEqual({ aggregate: 0, find: 0 });
      // The row is a real member of the face's refused set, and the where
      // refusal is the face's own sentence — not some other gate that happens
      // to refuse the same input.
      const faceWhere = syncRefusalOf(() => assertListComparandShapes(filter(), `aggregate('${OBJECT}')`));
      expect(faceWhere, 'the face must refuse this row directly').toBeDefined();
      expect(whereErr.message).toBe(faceWhere!.message);
      expect(whereErr.message).toContain('where.');
      expect(whereErr.message).not.toContain('having.');

      for (const [door, native] of DOORS) {
        const { engine, calls } = await makeEngine(ROWS, native);
        const havingErr = await refusalOf(() =>
          engine.aggregate(OBJECT, offContract({ ...AGG_QUERY, having: filter() })));
        expectEnvelope(havingErr);
        // Byte for byte the `where` refusal of the same shape, path aside.
        expect(havingErr.message, door).toBe(whereErr.message.replaceAll('where.', 'having.'));
        // Refused before either door is chosen: no driver was asked for a row.
        expect(calls, door).toEqual({ aggregate: 0, find: 0 });
      }
    });
  }

  it('the arm this card does not move ($ne with an array) is held to the face\'s own answer', async () => {
    // `$ne` is equality's negation, left out of the 2026-09-23 ruling and
    // carried by #19886. Whatever the face answers for it, `having` answers
    // the same — refused with the face's words once the face refuses it, and
    // passed while the face passes it — so this row cannot drift from the
    // `where` side in either direction.
    const filter = () => ({ total: { $ne: [500] } });
    const face = syncRefusalOf(() => assertListComparandShapes(filter(), `aggregate('${OBJECT}')`, 'having'));
    for (const [door, native] of DOORS) {
      const { engine } = await makeEngine(ROWS, native);
      const run = () => engine.aggregate(OBJECT, offContract({ ...AGG_QUERY, having: filter() }));
      if (face) {
        const err = await refusalOf(run);
        expectEnvelope(err);
        expect(err.message, door).toBe(face.message);
      } else {
        await expect(run(), door).resolves.toBeInstanceOf(Array);
      }
    }
  });
});

describe('[#19974] having — driven from the shared FILTER_COMPARAND_TYPE_CASES table', () => {
  const doorRefusals = FILTER_COMPARAND_TYPE_CASES.filter(
    (c): c is ComparandTypeRefusalCase => c.verdict === 'door-refusal');
  // The table carries rows for TWO faces: the comparand-SHAPE face (the #19757
  // equality-slot rows) and the comparand-TYPE door (#7872: undefined, a
  // function, a Map, …). Only the first is this change's subject. The split is
  // taken from the faces themselves, never from a list kept here, so a row
  // added to the table later lands on the right side of it by construction.
  const shapeRows = doorRefusals.filter((c) =>
    syncRefusalOf(() => assertListComparandShapes(c.filter(), `aggregate('${OBJECT}')`, 'having')) !== undefined);
  const otherRows = doorRefusals.filter((c) => !shapeRows.includes(c));

  it('the table carries shape-face rows at all — the leg below can never pass on zero rows', () => {
    expect(shapeRows.length).toBeGreaterThanOrEqual(3);
  });

  it('every row the shape face does NOT refuse belongs to the comparand-TYPE door instead', () => {
    // Recorded, not skipped: these rows are the type door's subject, not this
    // face's, and the assertion proves the partition is principled.
    for (const c of otherRows) {
      expect(syncRefusalOf(() => normalizeFilterComparandTypes(c.filter())), c.name).toBeDefined();
    }
  });

  // [#20099] …and those rows are now `having`'s too: the engine runs the same
  // comparand-TYPE door on the clause, path rooted at `having`, so the table
  // drives BOTH partitions down the having path.
  it('the type door\'s partition is not empty either — its leg below can never pass on zero rows', () => {
    expect(otherRows.length).toBeGreaterThanOrEqual(3);
  });

  for (const c of [...shapeRows, ...otherRows]) {
    it(`${c.name} — on the having path`, async () => {
      for (const [door, native] of DOORS) {
        const { engine, calls } = await makeEngine(ROWS, native);
        const err = await refusalOf(() =>
          engine.aggregate(OBJECT, { ...AGG_QUERY, having: c.filter() }));
        expect(err.code, door).toBe(c.code);
        expect(err.status, door).toBe(400);
        for (const needle of c.mustMention) {
          expect(err.message, `${door}: ${needle}`).toContain(needle.replaceAll('where.', 'having.'));
        }
        expect(calls, door).toEqual({ aggregate: 0, find: 0 });
      }
    });
  }
});

describe('[#19974] having — what the face leaves alone answers exactly as before', () => {
  const PASSING: ReadonlyArray<readonly [string, FilterCondition, readonly string[]]> = [
    ['a scalar in the implicit-equality slot', { total: 500 }, ['c1']],
    ['a scalar under $eq', { total: { $eq: 500 } }, ['c1']],
    ['a string in the implicit-equality slot', { customer_id: 'c2' }, ['c2']],
    ['$eq: null (the null predicate)', { total: { $eq: null } }, []],
    ['a list under $in', { customer_id: { $in: ['c1', 'c3'] } }, ['c1', 'c3']],
    ['an EMPTY list under $in', { customer_id: { $in: [] } }, []],
    ['a list under $nin', { customer_id: { $nin: ['c1'] } }, ['c2', 'c3']],
    ['a [min, max] pair under $between', { total: { $between: [100, 1000] } }, ['c1']],
    ['a scalar ordering bound', { total: { $gt: 100 } }, ['c1', 'c2']],
    ['scalars composed under $and / $or', { $or: [{ total: 20 }, { $and: [{ order_count: { $gte: 3 } }] }] }, ['c2', 'c3']],
  ];

  for (const [name, having, expected] of PASSING) {
    it(`${name} answers ${JSON.stringify(expected)} on both doors`, async () => {
      for (const [door, native] of DOORS) {
        const { engine } = await makeEngine(ROWS, native);
        const rows = await engine.aggregate(OBJECT, { ...AGG_QUERY, having });
        expect(groups(rows), door).toEqual([...expected]);
      }
    });
  }
});

describe('[#19974] having — the verdict belongs to the filter, not to the data', () => {
  it('an EMPTY grouped set refuses the triage shapes exactly as a populated one does', async () => {
    // On the base an empty set answered `[]` for `{ total: [500] }` with no
    // error, and a populated one answered `['c1']` — neither was a refusal, and
    // a walker-local check would have kept the empty set silent, because the
    // walker only runs per aggregated row.
    for (const having of [{ total: [500] }, { total: { $eq: [500] } }]) {
      for (const [door, native] of DOORS) {
        const { engine: empty } = await makeEngine([], native);
        const { engine: populated } = await makeEngine(ROWS, native);
        const emptyErr = await refusalOf(() => empty.aggregate(OBJECT, offContract({ ...AGG_QUERY, having })));
        const populatedErr = await refusalOf(() => populated.aggregate(OBJECT, offContract({ ...AGG_QUERY, having })));
        expectEnvelope(emptyErr);
        expect(emptyErr.message, door).toBe(populatedErr.message);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#20099] The rest of `where`'s doors
// ───────────────────────────────────────────────────────────────────────────

/**
 * Refused on BOTH doors, on an EMPTY and on a populated grouped set, with one
 * message, before any driver is asked for a row. Returns the message, so a row
 * can hold it to the words it owes.
 */
async function expectRowIndependentRefusal(
  query: EngineAggregateOptions,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<string> {
  let message: string | undefined;
  for (const [door, native] of DOORS) {
    for (const [population, data] of [['empty', []], ['populated', rows]] as const) {
      const { engine, calls } = await makeEngine(data, native);
      const err = await refusalOf(() => engine.aggregate(OBJECT, query));
      expectEnvelope(err);
      expect(calls, `${door}, ${population}`).toEqual({ aggregate: 0, find: 0 });
      if (message === undefined) message = err.message;
      expect(err.message, `${door}, ${population}`).toBe(message);
    }
  }
  return message!;
}

describe('[#20099] having — the comparand-TYPE door, the same where/having parity table', () => {
  // Before: every row answered `having` with no group (the walker compared the
  // object, the Map, the function… and matched nothing), while `where` refused
  // each one at the type door.
  const TYPE_REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>]> = [
    ['a plain object under $eq (the triage shape)', () => ({ total: { $eq: { v: 1 } } })],
    ['undefined in the implicit-equality slot', () => ({ total: undefined })],
    ['a Map under $eq', () => ({ total: { $eq: new Map() } })],
    ['a function under $gt', () => ({ total: { $gt: () => 1 } })],
    ['a Symbol under $ne', () => ({ total: { $ne: Symbol('x') } })],
    ['an undefined $in member', () => ({ total: { $in: [undefined] } })],
    ['a bigint beyond 2^53', () => ({ total: { $gt: 2n ** 60n } })],
    ['a { $field } whose $field is not a string', () => ({ total: { $gt: { $field: 5 } } })],
    ['a plain object nested in $or', () => ({ $or: [{ order_count: 99 }, { total: { $eq: { v: 1 } } }] })],
    ['undefined under $not', () => ({ $not: { total: undefined } })],
  ];

  for (const [name, filter] of TYPE_REFUSED) {
    it(`${name}: refused as a where AND as a having, one envelope, one wording, both doors, any population`, async () => {
      const { engine: whereEngine, calls: whereCalls } = await makeEngine(ROWS, true);
      const whereErr = await refusalOf(() =>
        whereEngine.aggregate(OBJECT, offContract({ ...AGG_QUERY, where: filter() })));
      expectEnvelope(whereErr);
      expect(whereCalls).toEqual({ aggregate: 0, find: 0 });
      // The type door's own sentence — not some other gate refusing the input.
      const door = syncRefusalOf(() => normalizeFilterComparandTypes(filter(), `aggregate('${OBJECT}')`));
      expect(door, 'the type door must refuse this row directly').toBeDefined();
      expect(whereErr.message).toBe(door!.message);

      const havingMessage = await expectRowIndependentRefusal(offContract({ ...AGG_QUERY, having: filter() }), ROWS);
      expect(havingMessage).toBe(whereErr.message.replaceAll('where.', 'having.'));
    });
  }

  it('an exact-range bigint is NARROWED, as it is in where — and the caller\'s clause is not edited', async () => {
    // Before: `{ $in: [500n, 20n] }` kept no group — `[500n].includes(500)` is
    // false — while the same list in `where` is narrowed to numbers first.
    for (const [door, native] of DOORS) {
      const having = { total: { $in: [500n, 20n] } };
      const { engine } = await makeEngine(ROWS, native);
      const rows = await engine.aggregate(OBJECT, offContract({ ...AGG_QUERY, having }));
      expect(groups(rows), door).toEqual(['c1', 'c3']);
      expect(having.total.$in, door).toEqual([500n, 20n]);
    }
  });
});

describe('[#20099] having — a filter condition OBJECT, never an array or a scalar', () => {
  // Before: an array answered no group (its index keys were read as columns),
  // `[]` and every scalar answered EVERY group (no condition at all).
  const NOT_A_CONDITION: ReadonlyArray<readonly [string, () => unknown]> = [
    ['the FilterArray sugar, a list of comparisons', () => [['total', '>', 100]]],
    ['the FilterArray sugar, one comparison', () => ['total', '>', 100]],
    ['the FilterArray sugar, a logical group', () => ['and', ['total', '>', 100], ['order_count', '>=', 2]]],
    ['an empty array', () => []],
    ['a string', () => 'total > 100'],
    ['a number', () => 100],
    ['a boolean', () => true],
    ['a Map', () => new Map([['total', 500]])],
    ['a Date', () => new Date(0)],
  ];

  for (const [name, having] of NOT_A_CONDITION) {
    it(`${name}: refused, whatever the rows`, async () => {
      const message = await expectRowIndependentRefusal(offContract({ ...AGG_QUERY, having: having() }), ROWS);
      expect(message).toContain('`having`');
    });
  }

  it('the FilterArray sugar is still lowered on where — the refusal is about the slot, not the shape', async () => {
    // Control: the stand-in driver does not filter, so what is pinned is that
    // `where` ACCEPTS the sugar (lowered, handed on) where `having` refuses it.
    const { engine } = await makeEngine(ROWS, true);
    await expect(engine.aggregate(OBJECT, offContract({ ...AGG_QUERY, where: [['amount', '>', 100]] })))
      .resolves.toBeInstanceOf(Array);
  });

  const NO_CLAUSE: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['{}', {}],
    ['a null-prototype empty node', Object.create(null)],
  ];
  for (const [name, having] of NO_CLAUSE) {
    it(`${name} is still no clause: every group, both doors`, async () => {
      for (const [door, native] of DOORS) {
        const { engine } = await makeEngine(ROWS, native);
        const rows = await engine.aggregate(OBJECT, offContract({ ...AGG_QUERY, having }));
        expect(groups(rows), door).toEqual(['c1', 'c2', 'c3']);
      }
    });
  }
});

describe('[#20099] having — the walker\'s own refusals belong to the filter, not to the data', () => {
  // Each row: the filter, and a row that walks the per-row evaluator INTO the
  // refused arm — the floor whose words the engine-level refusal must keep.
  // Before: every row answered `200 []` on an empty grouped set; the column-
  // absent row answered `[]` on a populated one too (the no-value exit sat
  // before the operator switch); and the `$or` row answered EVERY group,
  // because its first branch held and the walk never reached the second.
  const WALKER_REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>, Record<string, unknown>]> = [
    ['an unknown condition operator', () => ({ total: { $median: 1 } }), { total: 1 }],
    ['an unknown logical operator', () => ({ $nand: [{ total: 1 }] }), { total: 1 }],
    ['a retired operator', () => ({ customer_id: { $regex: 'c' } }), { customer_id: 'c1' }],
    ['a retired operator with its retired sibling', () => ({ customer_id: { $regex: 'c', $options: 'i' } }), { customer_id: 'c1' }],
    ['an empty $icontains', () => ({ customer_id: { $icontains: '' } }), { customer_id: 'c1' }],
    ['a non-string $icontains', () => ({ customer_id: { $icontains: 5 } }), { customer_id: 'c1' }],
    ['a non-$ key beside an operator', () => ({ total: { $gt: 1, foo: 2 } }), { total: 5 }],
    ['an unknown operator on a column the row does not carry', () => ({ nope: { $median: 1 } }), { nope: 1 }],
    ['an unknown operator behind a $or branch that already held', () => ({ $or: [{ total: { $gt: 0 } }, { total: { $median: 1 } }] }), { total: -1 }],
    ['an unknown operator under $not', () => ({ $not: { total: { $median: 1 } } }), { total: 1 }],
  ];

  for (const [name, filter, floorRow] of WALKER_REFUSED) {
    it(`${name}: refused on an empty and a populated set, in the walker's own words`, async () => {
      const floor = syncRefusalOf(() => applyHaving([floorRow], filter() as FilterCondition));
      expect(floor, 'the per-row walker must refuse this row when it reaches it').toBeDefined();
      const message = await expectRowIndependentRefusal(offContract({ ...AGG_QUERY, having: filter() }), ROWS);
      expect(message).toBe(floor!.message);
    });
  }
});

describe('[#20099] having — a { $field } reference resolves against the aggregated row', () => {
  const REF_ROWS = [
    { customer_id: 'c1', amount: 100, cap: 50, placed_on: '2026-01-10', due_on: '2026-01-05', grace: 3 },
    { customer_id: 'c1', amount: 400, cap: 10, placed_on: '2026-01-02', due_on: '2026-01-20', grace: 10 },
    { customer_id: 'c2', amount: 900, cap: 5000, placed_on: '2026-03-01', due_on: '2026-01-01', grace: 1 },
    { customer_id: 'c2', amount: 300, cap: 1, placed_on: '2026-02-01', due_on: '2026-02-01', grace: 1 },
    { customer_id: 'c2', amount: 50, cap: 2, placed_on: '2026-01-15', due_on: '2026-03-01', grace: 1 },
    { customer_id: 'c3', amount: 20, cap: 20, placed_on: '2026-02-01', due_on: '2026-01-31', grace: 0 },
  ];
  // Grouped:   total  max_cap  last_placed   first_due     max_grace
  //   c1        500       50   2026-01-10    2026-01-05           10
  //   c2       1250     5000   2026-03-01    2026-01-01            1
  //   c3         20       20   2026-02-01    2026-01-31            0
  const REF_QUERY: EngineAggregateOptions = {
    groupBy: ['customer_id'],
    aggregations: [
      { function: 'count', alias: 'order_count' },
      { function: 'sum', field: 'amount', alias: 'total' },
      { function: 'max', field: 'cap', alias: 'max_cap' },
      { function: 'max', field: 'placed_on', alias: 'last_placed' },
      { function: 'min', field: 'due_on', alias: 'first_due' },
      { function: 'max', field: 'grace', alias: 'max_grace' },
    ],
  };

  // Before: `$eq` / `$gt` / `$gte` / `$lt` / `$lte` kept NO group and `$ne`
  // kept EVERY group — the reference object itself was the comparand.
  const RESOLVED: ReadonlyArray<readonly [string, FilterCondition, readonly string[]]> = [
    ['$gt', { total: { $gt: { $field: 'max_cap' } } }, ['c1']],
    ['$gte', { total: { $gte: { $field: 'max_cap' } } }, ['c1', 'c3']],
    ['$lt', { total: { $lt: { $field: 'max_cap' } } }, ['c2']],
    ['$lte', { total: { $lte: { $field: 'max_cap' } } }, ['c2', 'c3']],
    ['$eq', { total: { $eq: { $field: 'max_cap' } } }, ['c3']],
    ['$ne', { total: { $ne: { $field: 'max_cap' } } }, ['c1', 'c2']],
    ['the two-bound spelling the $between refusal prescribes', { total: { $gte: { $field: 'max_cap' }, $lte: 1000 } }, ['c1', 'c3']],
    ['a groupBy projection as the referent', { customer_id: { $eq: { $field: 'customer_id' } } }, ['c1', 'c2', 'c3']],
    ['under $not', { $not: { total: { $gt: { $field: 'max_cap' } } } }, ['c2', 'c3']],
    ['a calendar day with no offset', { last_placed: { $lte: { $field: 'first_due' } } }, []],
    ['a whole-day addDays literal', { last_placed: { $lte: { $field: 'first_due', addDays: 7 } } }, ['c1', 'c3']],
    ['an addDays offset read from a column', { last_placed: { $lte: { $field: 'first_due', addDays: { $field: 'max_grace' } } } }, ['c1']],
  ];

  for (const [name, having, expected] of RESOLVED) {
    it(`${name} answers ${JSON.stringify(expected)} on both doors`, async () => {
      for (const [door, native] of DOORS) {
        const { engine } = await makeEngine(REF_ROWS, native);
        const rows = await engine.aggregate(OBJECT, { ...REF_QUERY, having });
        expect(groups(rows), door).toEqual([...expected]);
      }
    });
  }

  it('a missing value on either side follows the declared cross-field reading', () => {
    // The in-memory evaluator the SQL family is held to: an ordering against a
    // missing value is false, `$eq` is "both have none", `$ne` is its
    // complement. Evaluated on rows directly — no aggregate produces them here.
    const rows = [
      { g: 'a', t: 5, r: null },
      { g: 'b', t: null, r: null },
      { g: 'c', t: 5, r: 5 },
    ];
    const kept = (having: FilterCondition) => applyHaving(rows, having).map((row) => row.g);
    expect(kept({ t: { $gt: { $field: 'r' } } })).toEqual([]);
    expect(kept({ t: { $gte: { $field: 'r' } } })).toEqual(['c']);
    expect(kept({ t: { $eq: { $field: 'r' } } })).toEqual(['b', 'c']);
    expect(kept({ t: { $ne: { $field: 'r' } } })).toEqual(['a']);
  });

  it('a per-aggregation filter resolves one too, against the SOURCE row — the same walker', async () => {
    // Before: `amount > { $field: 'cap' }` compared the reference object and
    // counted no row in any group. The per-aggregation filter forces the
    // in-memory door, whatever the driver offers.
    for (const [door, native] of DOORS) {
      const { engine } = await makeEngine(REF_ROWS, native);
      const rows = await engine.aggregate(OBJECT, {
        groupBy: ['customer_id'],
        aggregations: [{ function: 'count', alias: 'over_cap', filter: { amount: { $gt: { $field: 'cap' } } } }],
      });
      const counts = Object.fromEntries(rows.map((r: any) => [r.customer_id, r.over_cap]));
      expect(counts, door).toEqual({ c1: 2, c2: 2, c3: 0 });
    }
  });

  // Before: the bare form was refused only when a grouped row carried the
  // column (an empty set answered `[]`); every other row answered no group, or
  // every group under `$nin`, whatever the data.
  const REFERENCE_REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>, string]> = [
    ['a bare reference with no operator', () => ({ total: { $field: 'max_cap' } }), 'having.total'],
    ['a bare reference carrying addDays', () => ({ last_placed: { $field: 'first_due', addDays: 1 } }), 'having.last_placed'],
    ['a reference as an $in member', () => ({ total: { $in: [{ $field: 'max_cap' }] } }), 'having.total.$in'],
    ['a reference as a $nin member', () => ({ total: { $nin: [1, { $field: 'max_cap' }] } }), 'having.total.$nin'],
    ['a reference as a $contains pattern', () => ({ customer_id: { $contains: { $field: 'customer_id' } } }), 'having.customer_id.$contains'],
    ['a reference as a $startsWith pattern', () => ({ customer_id: { $startsWith: { $field: 'customer_id' } } }), 'having.customer_id.$startsWith'],
    ['a reference under $exists', () => ({ total: { $exists: { $field: 'max_cap' } } }), 'having.total.$exists'],
    ['a reference under $null', () => ({ total: { $null: { $field: 'max_cap' } } }), 'having.total.$null'],
    ['a reference naming no column', () => ({ total: { $gt: { $field: 'nope' } } }), 'having.total.$gt'],
    ['a dotted reference (a relation path, not a column)', () => ({ total: { $gt: { $field: 'order.max_cap' } } }), 'having.total.$gt'],
    ['an addDays offset naming no column', () => ({ last_placed: { $lte: { $field: 'first_due', addDays: { $field: 'nope' } } } }), 'having.last_placed.$lte'],
    ['a fractional addDays', () => ({ last_placed: { $lte: { $field: 'first_due', addDays: 1.5 } } }), 'having.last_placed.$lte'],
    ['a string addDays', () => ({ last_placed: { $lte: { $field: 'first_due', addDays: '7' } } }), 'having.last_placed.$lte'],
    ['an unresolvable reference deep in $or', () => ({ $or: [{ total: { $gt: 0 } }, { total: { $lt: { $field: 'nope' } } }] }), 'having.$or[1].total.$lt'],
  ];

  for (const [name, having, path] of REFERENCE_REFUSED) {
    it(`${name}: refused at ${path}, whatever the rows`, async () => {
      const message = await expectRowIndependentRefusal(offContract({ ...REF_QUERY, having: having() }), REF_ROWS);
      expect(message).toContain(path);
    });
  }

  it('the unresolved-reference refusal names the columns the aggregated row has', async () => {
    const message = await expectRowIndependentRefusal(
      offContract({ ...REF_QUERY, having: { total: { $gt: { $field: 'nope' } } } }), REF_ROWS);
    for (const column of ['customer_id', 'order_count', 'total', 'max_cap', 'last_placed', 'first_due', 'max_grace']) {
      expect(message).toContain(column);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#20123] A `having` key names a column of the aggregated row
// ───────────────────────────────────────────────────────────────────────────

describe('[#20123] having — a key naming no column of the aggregated row is refused, whatever the rows', () => {
  // `AGG_QUERY` projects exactly three columns.
  const COLUMNS = ['customer_id', 'order_count', 'total'];

  // Before, measured through `engine.aggregate` on driver-memory and
  // driver-sql, both doors, and through `POST /data/:object/query`: no row
  // raised anything. A test for a value kept no group; a test for absence or
  // a negation — and a `$or` whose first branch held — kept EVERY group.
  const UNKNOWN_KEY: ReadonlyArray<readonly [string, () => Record<string, unknown>, string, string]> = [
    ['a typo for an alias under $gt (the triage shape)', () => ({ totl: { $gt: 100 } }), 'totl', 'having.totl'],
    ['a typo in the implicit-equality slot', () => ({ totl: 500 }), 'totl', 'having.totl'],
    ['a typo under $ne', () => ({ totl: { $ne: 1 } }), 'totl', 'having.totl'],
    ['a typo under $exists: false', () => ({ totl: { $exists: false } }), 'totl', 'having.totl'],
    ['a typo nested in $and', () => ({ $and: [{ total: { $gt: 0 } }, { totl: { $gt: 100 } }] }), 'totl', 'having.$and[1].totl'],
    ['a typo behind a $or branch that already held', () => ({ $or: [{ total: { $gt: 0 } }, { totl: { $gt: 100 } }] }), 'totl', 'having.$or[1].totl'],
    ['a typo under $not', () => ({ $not: { totl: { $gt: 100 } } }), 'totl', 'having.$not.totl'],
    ['a SOURCE column the aggregated row does not project', () => ({ amount: { $gt: 100 } }), 'amount', 'having.amount'],
    ['a dotted path', () => ({ 'customer_id.name': 'c1' }), 'customer_id.name', 'having.customer_id.name'],
    ['a key that also carries a { $field } reference', () => ({ totl: { $gt: { $field: 'total' } } }), 'totl', 'having.totl'],
  ];

  for (const [name, having, key, path] of UNKNOWN_KEY) {
    it(`${name}: refused at ${path}, naming the columns`, async () => {
      const message = await expectRowIndependentRefusal(offContract({ ...AGG_QUERY, having: having() }), ROWS);
      expect(message).toContain(`'${key}' at ${path}`);
      for (const column of COLUMNS) expect(message).toContain(column);
    });
  }

  it('every unknown key is named — the first with its position, the rest after it', async () => {
    const message = await expectRowIndependentRefusal(
      offContract({ ...AGG_QUERY, having: { $and: [{ totl: 1 }, { cnt: { $gt: 1 } }, { totl: 2 }] } }), ROWS);
    expect(message).toContain("'totl' at having.$and[0].totl");
    expect(message).toContain('(also: cnt)');
  });

  it('an operator refusal on an unknown column is still the operator\'s — the key is judged last', async () => {
    // The #20099 rule: a condition on a column the row does not carry is read
    // for its operator. Held here so the new check cannot jump ahead of it.
    const floor = syncRefusalOf(() => applyHaving([{ nope: 1 }], { nope: { $median: 1 } } as FilterCondition));
    const message = await expectRowIndependentRefusal(offContract({ ...AGG_QUERY, having: { nope: { $median: 1 } } }), ROWS);
    expect(message).toBe(floor!.message);
  });

  it('the source name of an ALIASED groupBy projection is not a column — its alias is', async () => {
    // Before: `{ customer_id: 'c1' }` kept no group — the row projects `cust`.
    const query = (having: FilterCondition): EngineAggregateOptions => ({
      groupBy: [{ field: 'customer_id', alias: 'cust' }],
      aggregations: [{ function: 'count', alias: 'order_count' }],
      having,
    });
    const message = await expectRowIndependentRefusal(query({ customer_id: 'c1' }), ROWS);
    expect(message).toContain("'customer_id' at having.customer_id");
    expect(message).toContain('cust, order_count');
    // The alias itself answers, on the door that projects it (the stand-in
    // native driver groups by `customer_id` and ignores the alias).
    const { engine } = await makeEngine(ROWS, false);
    const rows = await engine.aggregate(OBJECT, query({ cust: 'c1' }));
    expect(rows).toEqual([{ cust: 'c1', order_count: 2 }]);
  });

  // Every key names a column: answered exactly as before, both doors.
  const PASSING: ReadonlyArray<readonly [string, FilterCondition, readonly string[]]> = [
    ['a groupBy column', { customer_id: 'c1' }, ['c1']],
    ['an aggregation alias', { total: { $gt: 100 } }, ['c1', 'c2']],
    ['a count alias', { order_count: { $gte: 2 } }, ['c1', 'c2']],
    ['columns nested under $or / $and / $not', { $or: [{ total: { $gt: 1000 } }, { $and: [{ $not: { customer_id: 'c1' } }, { order_count: 1 }] }] }, ['c2', 'c3']],
    ['a negation of a column', { total: { $ne: 500 } }, ['c2', 'c3']],
  ];
  for (const [name, having, expected] of PASSING) {
    it(`${name} answers ${JSON.stringify(expected)} on both doors`, async () => {
      for (const [door, native] of DOORS) {
        const { engine } = await makeEngine(ROWS, native);
        expect(groups(await engine.aggregate(OBJECT, { ...AGG_QUERY, having })), door).toEqual([...expected]);
      }
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// [#20127] `addDays` between two temporal columns of one class
// ───────────────────────────────────────────────────────────────────────────

describe('[#20127] having — a { $field, addDays } pair is judged by each aggregated column\'s class, whatever the rows', () => {
  const OPENED = ['2026-01-01T10:00:00.000Z', '2026-01-02T10:00:00.000Z', '2026-02-01T10:00:00.000Z', '2026-02-05T10:00:00.000Z', '2026-02-06T10:00:00.000Z', '2026-03-01T10:00:00.000Z'];
  const CLOSED = ['2026-01-03T10:00:00.000Z', '2026-01-02T12:00:00.000Z', '2026-02-10T10:00:00.000Z', '2026-02-05T11:00:00.000Z', '2026-02-06T10:00:00.000Z', '2026-03-01T10:00:00.000Z'];
  const DT_ROWS = [
    { customer_id: 'c1', amount: 100, cap: 50, placed_on: '2026-01-10', due_on: '2026-01-05', grace: 3 },
    { customer_id: 'c1', amount: 400, cap: 10, placed_on: '2026-01-02', due_on: '2026-01-20', grace: 10 },
    { customer_id: 'c2', amount: 900, cap: 5000, placed_on: '2026-03-01', due_on: '2026-01-01', grace: 1 },
    { customer_id: 'c2', amount: 300, cap: 1, placed_on: '2026-02-01', due_on: '2026-02-01', grace: 1 },
    { customer_id: 'c2', amount: 50, cap: 2, placed_on: '2026-01-15', due_on: '2026-03-01', grace: 1 },
    { customer_id: 'c3', amount: 20, cap: 20, placed_on: '2026-02-01', due_on: '2026-01-31', grace: 0 },
  ].map((row, i) => ({ ...row, opened_at: OPENED[i], closed_at: CLOSED[i] }));
  // Grouped:   total  max_cap  last_placed  first_due   max_grace  first_opened       last_closed
  //   c1        500       50   2026-01-10   2026-01-05         10  2026-01-01T10:00Z  2026-01-03T10:00Z
  //   c2       1250     5000   2026-03-01   2026-01-01          1  2026-02-01T10:00Z  2026-02-10T10:00Z
  //   c3         20       20   2026-02-01   2026-01-31          0  2026-03-01T10:00Z  2026-03-01T10:00Z
  const DT_QUERY: EngineAggregateOptions = {
    groupBy: ['customer_id'],
    aggregations: [
      { function: 'count', alias: 'order_count' },
      { function: 'sum', field: 'amount', alias: 'total' },
      { function: 'max', field: 'cap', alias: 'max_cap' },
      { function: 'max', field: 'placed_on', alias: 'last_placed' },
      { function: 'min', field: 'due_on', alias: 'first_due' },
      { function: 'max', field: 'grace', alias: 'max_grace' },
      { function: 'min', field: 'opened_at', alias: 'first_opened' },
      { function: 'max', field: 'closed_at', alias: 'last_closed' },
    ],
  };

  // Before, measured through `engine.aggregate` on driver-memory and
  // driver-sql, both doors, and through `POST /data/:object/query`: every row
  // ANSWERED, by `@objectstack/formula`'s reading of the pair (a number read
  // as epoch milliseconds, a day added to it), where `driver-sql` refuses the
  // same pair on `where`. Each fragment is `driver-sql`'s own sentence.
  const REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>, string]> = [
    ['two numeric columns (the triage shape)', () => ({ total: { $gt: { $field: 'max_cap', addDays: 1 } } }), 'addDays adds whole days to a date or datetime column, and "max_cap" is numeric'],
    ['a count against itself', () => ({ order_count: { $gte: { $field: 'order_count', addDays: 0 } } }), '"order_count" is numeric — an offset has no meaning on it'],
    ['a date target against a numeric referent', () => ({ last_placed: { $lte: { $field: 'max_cap', addDays: 1 } } }), '"last_placed" is date but "max_cap" is numeric'],
    ['a numeric target against a date referent', () => ({ total: { $gt: { $field: 'first_due', addDays: 1 } } }), '"total" is numeric but "first_due" is date'],
    ['a date against a datetime', () => ({ last_placed: { $lte: { $field: 'last_closed', addDays: 1 } } }), '"last_placed" is date but "last_closed" is datetime'],
    ['a datetime against a date', () => ({ last_closed: { $gte: { $field: 'first_due', addDays: 1 } } }), '"last_closed" is datetime but "first_due" is date'],
    ['a groupBy text column against a date', () => ({ customer_id: { $lte: { $field: 'first_due', addDays: 1 } } }), '"customer_id" is text but "first_due" is date'],
    ['a text offset column', () => ({ last_placed: { $lte: { $field: 'first_due', addDays: { $field: 'customer_id' } } } }), 'the addDays offset "customer_id" (text) is not a numeric column'],
    ['a date offset column', () => ({ last_placed: { $lte: { $field: 'first_due', addDays: { $field: 'last_placed' } } } }), 'the addDays offset "last_placed" (date) is not a numeric column'],
    ['a numeric pair nested under $not in a $or', () => ({ $or: [{ total: { $gt: 0 } }, { $not: { total: { $gt: { $field: 'max_cap', addDays: 1 } } } }] }), '"max_cap" is numeric'],
  ];

  for (const [name, having, fragment] of REFUSED) {
    it(`${name}: refused in driver-sql's words`, async () => {
      const message = await expectRowIndependentRefusal(offContract({ ...DT_QUERY, having: having() }), DT_ROWS);
      expect(message).toContain(fragment);
    });
  }

  // Answered exactly as before, on both doors: the pairs the declaration admits.
  const ANSWERED: ReadonlyArray<readonly [string, FilterCondition, readonly string[]]> = [
    ['date / date with a positive literal', { last_placed: { $lte: { $field: 'first_due', addDays: 7 } } }, ['c1', 'c3']],
    ['date / date with a negative literal', { last_placed: { $gte: { $field: 'first_due', addDays: -3 } } }, ['c1', 'c2', 'c3']],
    ['date / date with a numeric offset column (a max)', { last_placed: { $lte: { $field: 'first_due', addDays: { $field: 'max_grace' } } } }, ['c1']],
    ['date / date with a numeric offset column (a count)', { last_placed: { $lte: { $field: 'first_due', addDays: { $field: 'order_count' } } } }, ['c3']],
    ['datetime / datetime', { last_closed: { $gte: { $field: 'first_opened', addDays: 1 } } }, ['c1', 'c2']],
    ['a numeric pair with NO addDays (the rule is the offset\'s)', { total: { $gt: { $field: 'max_cap' } } }, ['c1']],
  ];

  for (const [name, having, expected] of ANSWERED) {
    it(`${name} answers ${JSON.stringify(expected)} on both doors`, async () => {
      for (const [door, native] of DOORS) {
        const { engine } = await makeEngine(DT_ROWS, native);
        expect(groups(await engine.aggregate(OBJECT, { ...DT_QUERY, having })), door).toEqual([...expected]);
      }
    });
  }

  it('a "day" date bucket is a date column; a coarser bucket is a text label', async () => {
    const bucketed = (granularity: 'day' | 'month', having: FilterCondition): EngineAggregateOptions => ({
      groupBy: [{ field: 'placed_on', dateGranularity: granularity, alias: 'placed' }],
      aggregations: [{ function: 'min', field: 'due_on', alias: 'first_due' }],
      having,
    });
    const shifted = { placed: { $lte: { $field: 'first_due', addDays: 1 } } };
    for (const [door, native] of DOORS) {
      const { engine } = await makeEngine(DT_ROWS, native);
      const rows = await engine.aggregate(OBJECT, bucketed('day', shifted));
      expect(rows.map((r: any) => r.placed).sort(), door).toEqual(['2026-01-02', '2026-01-15', '2026-02-01']);
    }
    const message = await expectRowIndependentRefusal(bucketed('month', shifted), DT_ROWS);
    expect(message).toContain('"placed" is text but "first_due" is date');
  });

  it('a column whose class the declaration cannot tell is not judged — the pair is answered as before', async () => {
    // `ghost` is declared nowhere, so `min(ghost)` has no class to judge. The
    // engine keeps the fail-open direction its other declared-type doors take
    // for what the declaration cannot see; the reference reads no value, so
    // the ordering is false in every group.
    const query = offContract({
      ...DT_QUERY,
      aggregations: [...DT_QUERY.aggregations!, { function: 'min', field: 'ghost', alias: 'ghost_min' }],
      having: { first_due: { $gte: { $field: 'ghost_min', addDays: 1 } } },
    });
    for (const [door, native] of DOORS) {
      const { engine } = await makeEngine(DT_ROWS, native);
      expect(groups(await engine.aggregate(OBJECT, query)), door).toEqual([]);
    }
  });
});
