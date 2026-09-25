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
 */

import { describe, it, expect } from 'vitest';
import {
  assertListComparandShapes,
  normalizeFilterComparandTypes,
  FILTER_COMPARAND_TYPE_CASES,
  type ComparandTypeRefusalCase,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const OBJECT = 'order';

const ROWS = [
  { customer_id: 'c1', amount: 100 },
  { customer_id: 'c1', amount: 400 },
  { customer_id: 'c2', amount: 900 },
  { customer_id: 'c2', amount: 300 },
  { customer_id: 'c2', amount: 50 },
  { customer_id: 'c3', amount: 20 },
];

const AGG_QUERY = {
  groupBy: ['customer_id'],
  aggregations: [
    { function: 'count', alias: 'order_count' },
    { function: 'sum', field: 'amount', alias: 'total' },
  ],
};

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
    // Groups and sums itself, ignores `ast.having` — as every real native
    // driver does today; the engine's post-filter is what makes it live.
    driver.aggregate = async () => {
      calls.aggregate += 1;
      const groups = new Map<string, { customer_id: string; order_count: number; total: number }>();
      for (const r of rows as Array<{ customer_id: string; amount: number }>) {
        const g = groups.get(r.customer_id) ?? { customer_id: r.customer_id, order_count: 0, total: 0 };
        g.order_count += 1;
        g.total += r.amount;
        groups.set(r.customer_id, g);
      }
      return Array.from(groups.values());
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
    fields: { customer_id: { type: 'text' }, amount: { type: 'number' } },
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
        whereEngine.aggregate(OBJECT, { ...AGG_QUERY, where: filter() } as any));
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
          engine.aggregate(OBJECT, { ...AGG_QUERY, having: filter() } as any));
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
      const run = () => engine.aggregate(OBJECT, { ...AGG_QUERY, having: filter() } as any);
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

  for (const c of shapeRows) {
    it(`${c.name} — on the having path`, async () => {
      for (const [door, native] of DOORS) {
        const { engine, calls } = await makeEngine(ROWS, native);
        const err = await refusalOf(() =>
          engine.aggregate(OBJECT, { ...AGG_QUERY, having: c.filter() } as any));
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
  const PASSING: ReadonlyArray<readonly [string, Record<string, unknown>, readonly string[]]> = [
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
        const rows = await engine.aggregate(OBJECT, { ...AGG_QUERY, having } as any);
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
        const emptyErr = await refusalOf(() => empty.aggregate(OBJECT, { ...AGG_QUERY, having } as any));
        const populatedErr = await refusalOf(() => populated.aggregate(OBJECT, { ...AGG_QUERY, having } as any));
        expectEnvelope(emptyErr);
        expect(emptyErr.message, door).toBe(populatedErr.message);
      }
    }
  });
});
