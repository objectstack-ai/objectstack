// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20351] The NUMBER-comparand declared-type door at the engine's filter
 * collection point — lane (2) of the two-lane route #20336 took on #15661's
 * precedent.
 *
 * The door's definition lives in `@objectstack/spec/data`
 * (`filter-number-comparand-declared-type.ts`, lane 1): the grammar, the
 * verdict, the words, the fixture and the derived case table. This file is its
 * CONSUMER, driven the way that module's header prescribes — register
 * {@link NUMBER_COMPARAND_DOOR_FIXTURE} against a recording driver and run the
 * cases through `find`:
 *
 * - `door-refusal`: rejects with `code` AND `status` (the ADR-0112 envelope —
 *   `toThrow()` alone is not a pin), the message carries every `mustMention`
 *   substring, and NO driver read ran.
 * - `narrows`: the driver read ran and received `c.expectedFilter()`.
 * - `passes` / `deferred`: the driver read ran and received the filter as
 *   written.
 *
 * ## Two partitions, each measured rather than dropped
 *
 * - **`formula`** — refused one door EARLIER, by the #8296 materializable door,
 *   with `INVALID_FIELD`, whatever its return type: no driver materialises a
 *   formula column. Pinned in the direction it answers (the contract's module
 *   header says the suite partitions these rows out), and the door's own walk
 *   is pinned to judge the class correctly for the day that neighbour opens.
 * - **The staged `$empty` row** — `$empty` is declared but staged out of
 *   `FILTER_OPERATORS` until its engine arm lands (#20311's lane cards), so an
 *   end-to-end drive can answer it for a reason that is not this door's. The
 *   row is pinned at the DOOR ALONE (the walk and the narrowing return it
 *   untouched), and partitioned out of the engine drive.
 *
 * The three-driver and REST cells (InMemoryDriver's answer is this suite's
 * recording driver's by construction — the door runs before any driver is
 * resolved; SqlDriver on SQLite, PostgreSQL and MySQL) live in
 * `@objectstack/rest`'s `data-number-comparand-door.test.ts`.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/20351 (this door)
 * @see https://github.com/objectstack-ai/objectstack/issues/20336 (the contract)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  NON_NUMERIC_STRING_FORMS,
  NON_NUMERIC_VALUE_FORMS,
  NUMBER_COMPARAND_DOOR_CASES,
  normalizeFilterComparandTypes,
  NUMBER_COMPARAND_DOOR_FIXTURE,
  NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT,
  NUMBER_COMPARAND_DOOR_LIST_OPERATORS,
  NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS,
  type EngineAggregateOptions,
  type EngineQueryOptions,
  type FilterCondition,
  type NumberComparandDoorCase,
  type NumberComparandDoorNarrowsCase,
  type NumberComparandDoorRefusalCase,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import {
  findNonNumericComparand,
  narrowHavingNumberComparands,
  narrowNumberComparands,
} from './number-comparand-declared-type-door.js';

const OBJECT = NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT;

interface SeenRead { ast: any }

/** Minimal recording driver — the same witness shape as the sibling door suites. */
function makeRecordingDriver() {
  const rows = new Map<string, Record<string, unknown>>();
  const reads: SeenRead[] = [];
  const writes: SeenRead[] = [];
  const run = (_ast: any) => [...rows.values()];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: any) { reads.push({ ast }); return run(ast); },
    async findOne(_o: string, ast: any) { reads.push({ ast }); return run(ast)[0] ?? null; },
    async count(_o: string, ast: any) { reads.push({ ast }); return run(ast).length; },
    async create(_o: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? `r_${rows.size + 1}`;
      const row = { ...data, id }; rows.set(id, row); return row;
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      const cur = rows.get(id) ?? {};
      const up = { ...cur, ...data, id }; rows.set(id, up); return up;
    },
    async updateMany(_o: string, ast: any) { writes.push({ ast }); return 0; },
    async delete(_o: string, id: string) { return rows.delete(id); },
    async deleteMany(_o: string, ast: any) { writes.push({ ast }); return 0; },
    async bulkCreate(o: string, batch: Record<string, unknown>[]) {
      return Promise.all(batch.map((r) => this.create(o, r)));
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads, writes, rows };
}

type Thrown = (Error & { code?: string; status?: number; httpStatus?: number }) | null;

const refusalOf = async (p: Promise<unknown>): Promise<Thrown> =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

/** A `formula` case — judged one door earlier, see the header. */
const isFormulaCase = (c: NumberComparandDoorCase): boolean => c.declaredType === 'formula';
/** The staged `$empty` row — pinned at the door alone, see the header. */
const isStagedCase = (c: NumberComparandDoorCase): boolean => c.position.endsWith('.$empty');
const engineDriven = (c: NumberComparandDoorCase): boolean => !isFormulaCase(c) && !isStagedCase(c);

const SEEDED = [
  { id: 'r1', f_number: 5 },
  { id: 'r2', f_number: 12 },
  { id: 'r3', f_number: 30 },
];

describe('[#20351] the number-comparand declared-type door at the engine collection point', () => {
  let engine: ObjectQL;
  let reads: SeenRead[];
  let writes: SeenRead[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    reads = rec.reads;
    writes = rec.writes;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(NUMBER_COMPARAND_DOOR_FIXTURE as any, 'test');
    for (const row of SEEDED) await engine.insert(OBJECT, { ...row });
    reads.length = 0;
    writes.length = 0;
  });

  // ── the derived case table, driven end to end ────────────────────────────

  const REFUSALS = NUMBER_COMPARAND_DOOR_CASES.filter(
    (c): c is NumberComparandDoorRefusalCase => c.verdict === 'door-refusal' && engineDriven(c));
  const NARROWS = NUMBER_COMPARAND_DOOR_CASES.filter(
    (c): c is NumberComparandDoorNarrowsCase => c.verdict === 'narrows' && engineDriven(c));
  const PASSES = NUMBER_COMPARAND_DOOR_CASES.filter((c) => c.verdict === 'passes' && engineDriven(c));
  const DEFERRED = NUMBER_COMPARAND_DOOR_CASES.filter((c) => c.verdict === 'deferred' && engineDriven(c));
  const FORMULA = NUMBER_COMPARAND_DOOR_CASES.filter(isFormulaCase);
  const STAGED = NUMBER_COMPARAND_DOOR_CASES.filter(isStagedCase);

  it('GUARD the case table is partitioned exactly, and every partition that carries a verdict is non-empty', () => {
    expect(NUMBER_COMPARAND_DOOR_CASES.length).toBe(
      REFUSALS.length + NARROWS.length + PASSES.length + DEFERRED.length + FORMULA.length + STAGED.length,
    );
    expect(REFUSALS.length).toBeGreaterThan(0);
    expect(NARROWS.length).toBeGreaterThan(0);
    expect(PASSES.length).toBeGreaterThan(0);
    expect(FORMULA.length).toBeGreaterThan(0);
    // The untyped formula is the table's only deferred row, and it is judged one door earlier.
    expect(DEFERRED).toHaveLength(0);
    expect(STAGED.map((c) => c.verdict)).toEqual(['passes']);
    // Every refused form the grammar names is driven, not just the card's "abc" —
    // and [#20502] every non-string form (a boolean, a Date, an array) beside them.
    expect(new Set(REFUSALS.map((c) => c.form))).toEqual(new Set([...NON_NUMERIC_STRING_FORMS, ...NON_NUMERIC_VALUE_FORMS]));
    // Every judged position is driven both ways.
    const positions = (cs: readonly NumberComparandDoorCase[]) =>
      new Set(cs.filter((c) => c.key === 'f_number').map((c) => c.position.replace(/\[\d\]$/, '')));
    const judged = ['f_number', ...NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS.map((op) => `f_number.${op}`),
      ...NUMBER_COMPARAND_DOOR_LIST_OPERATORS.map((op) => `f_number.${op}`)];
    for (const p of judged) {
      expect(positions(REFUSALS).has(p), `refused at ${p}`).toBe(true);
      expect(positions(NARROWS).has(p), `narrowed at ${p}`).toBe(true);
    }
  });

  it('refuses every door-refusal case with the ADR-0112 envelope, in the contract\'s words, and NO driver read runs', async () => {
    for (const c of REFUSALS) {
      reads.length = 0;
      const err = await refusalOf(engine.find(OBJECT, { where: c.filter() }));
      expect(err, `${c.name}: expected a refusal`).not.toBeNull();
      expect({ code: err!.code, status: err!.status }, c.name).toEqual({ code: c.code, status: c.status });
      expect(err!.httpStatus, c.name).toBe(400);
      for (const substring of c.mustMention) {
        expect(err!.message, `${c.name}: message must mention ${substring}`).toContain(substring);
      }
      expect(err!.message, c.name).toMatch(/^find\('number_door_probe'\): /);
      expect(err!.message, c.name).toMatch(/NOT applied/);
      expect(reads, `${c.name}: the driver must not have been read`).toHaveLength(0);
    }
  });

  it('narrows every numeric string to its number — the driver receives the expected filter, the caller\'s is untouched', async () => {
    for (const c of NARROWS) {
      reads.length = 0;
      const filter = c.filter();
      const asWritten = JSON.stringify(filter);
      await expect(engine.find(OBJECT, { where: filter }), c.name).resolves.toBeDefined();
      expect(reads, `${c.name}: the driver must have been read`).toHaveLength(1);
      expect(reads[0]?.ast?.where, `${c.name}: the driver must receive the number`).toEqual(c.expectedFilter());
      // Copy-on-write: the filter belongs to the caller (view metadata, flow config).
      expect(JSON.stringify(filter), `${c.name}: the caller's filter must not be edited`).toBe(asWritten);
    }
  });

  it('lets every passing case through UNCHANGED — not a numeric field, or not a string', async () => {
    for (const c of PASSES) {
      reads.length = 0;
      const filter = c.filter();
      await expect(engine.find(OBJECT, { where: filter }), c.name).resolves.toBeDefined();
      expect(reads, `${c.name}: the driver must have been read`).toHaveLength(1);
      expect(reads[0]?.ast?.where, `${c.name}: the filter must reach the driver unchanged`).toEqual(filter);
    }
  });

  it('NAMED DIVERGENCE — every formula case is refused one door EARLIER, by #8296, with INVALID_FIELD', async () => {
    for (const c of FORMULA) {
      reads.length = 0;
      const err = await refusalOf(engine.find(OBJECT, { where: c.filter() }));
      expect(err, `${c.name}: expected the #8296 refusal`).not.toBeNull();
      expect({ code: err!.code, status: err!.status }, c.name).toEqual({ code: 'INVALID_FIELD', status: 400 });
      expect(reads, c.name).toHaveLength(0);
    }
    // …and the door's own walk judges the class by its return type, so the day
    // that neighbour opens, this door already answers.
    const schema = engine.registry.getObject(OBJECT);
    expect(findNonNumericComparand(schema, { f_formula_number: { $gt: 'abc' } }))
      .toMatchObject({ field: 'f_formula_number', declaredType: 'formula', returnType: 'number', form: 'not-a-number' });
    expect(findNonNumericComparand(schema, { f_formula_text: { $gt: 'abc' } })).toBeNull();
    expect(findNonNumericComparand(schema, { f_formula_untyped: { $gt: 'abc' } })).toBeNull();
  });

  it('the staged $empty row is pinned at the DOOR ALONE — the walk neither refuses nor rewrites it', () => {
    const schema = engine.registry.getObject(OBJECT);
    for (const c of STAGED) {
      const filter = c.filter();
      expect(findNonNumericComparand(schema, filter), c.name).toBeNull();
      expect(narrowNumberComparands(OBJECT, 'find', schema, filter), c.name).toBe(filter);
    }
  });

  // ── the door's reach: every verb, both filter forms, nested structure ────

  it('covers every engine verb that collects a filter — read and write sides', async () => {
    const where = { f_number: { $gt: 'abc' } };
    for (const call of [
      () => engine.find(OBJECT, { where }),
      () => engine.findOne(OBJECT, { where }),
      () => engine.count(OBJECT, { where }),
      () => engine.aggregate(OBJECT, { where, aggregations: [{ function: 'count', alias: 'n' }] } as EngineAggregateOptions),
      () => engine.update(OBJECT, { f_text: 'x' }, { where, multi: true }),
      () => engine.delete(OBJECT, { where, multi: true }),
    ]) {
      const err = await refusalOf(call());
      expect(err).not.toBeNull();
      expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message).toContain("'f_number'");
    }
    expect(reads).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('answers the same mistake arriving as FilterArray sugar — one answer per mistake, not per spelling', async () => {
    // The cast names the contract being bypassed: `FilterArray` is INPUT-ONLY
    // sugar `EngineQueryOptions.where` deliberately excludes (#5285).
    const err = await refusalOf(
      engine.find(OBJECT, { where: [['f_number', '>', 'abc']] } as unknown as EngineQueryOptions),
    );
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(err!.message).toContain('where.f_number.$gt');
    expect(reads).toHaveLength(0);

    await engine.find(OBJECT, { where: [['f_number', '>', '12']] } as unknown as EngineQueryOptions);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.ast?.where).toEqual({ f_number: { $gt: 12 } });
  });

  it('reaches inside $and / $or / $not — structure does not launder the comparand, and narrowing reaches there too', async () => {
    for (const where of [
      { $and: [{ f_text: 'a' }, { f_number: { $gt: 'abc' } }] },
      { $or: [{ f_text: 'a' }, { f_currency: { $in: [1, 'x'] } }] },
      { $not: { f_percent: { $between: ['', 10] } } },
    ]) {
      reads.length = 0;
      const err = await refusalOf(engine.find(OBJECT, { where: where as FilterCondition }));
      expect(err, JSON.stringify(where)).not.toBeNull();
      expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(reads).toHaveLength(0);
    }
    await engine.find(OBJECT, { where: { $or: [{ f_text: 'a' }, { $not: { f_number: { $in: ['12', 5] } } }] } });
    expect(reads[0]?.ast?.where).toEqual({ $or: [{ f_text: 'a' }, { $not: { f_number: { $in: [12, 5] } } }] });
  });

  it('refuses a {placeholder} against a number field UNRESOLVED — before the token resolver, in the door\'s words', async () => {
    const err = await refusalOf(engine.find(
      OBJECT,
      { where: { f_number: { $gt: '{current_user_id}' } }, context: { userId: 'u1' } } as EngineQueryOptions,
    ));
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(err!.message).toContain('{placeholder}');
    expect(reads).toHaveLength(0);
  });

  it('the judge-only judgeFilter gives the verdict execution gives, without a read', () => {
    const refused = engine.judgeFilter(OBJECT, { f_number: { $gt: 'abc' } });
    expect(refused).toMatchObject({ ok: false, code: 'INVALID_FILTER', status: 400 });
    expect((refused as { message: string }).message).toContain("'f_number'");
    expect(engine.judgeFilter(OBJECT, { f_number: { $gt: '12' } })).toEqual({ ok: true });
    expect(reads).toHaveLength(0);
  });

  // ── the per-aggregation `filter` and `having` ────────────────────────────

  it('refuses a non-numeric string in ONE aggregation\'s own filter, rooted at that position — no read', async () => {
    for (const op of ['$gt', '$ne', '$eq'] as const) {
      reads.length = 0;
      const err = await refusalOf(engine.aggregate(OBJECT, {
        aggregations: [
          { function: 'count', alias: 'all' },
          { function: 'count', alias: 'bad', filter: { f_number: { [op]: 'abc' } } },
        ],
      } as EngineAggregateOptions));
      expect(err, op).not.toBeNull();
      expect({ code: err!.code, status: err!.status }, op).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message, op).toContain(`aggregations[1].filter.f_number.${op}`);
      expect(err!.message, op).toMatch(/^aggregate\('number_door_probe'\): /);
      expect(reads, op).toHaveLength(0);
    }
  });

  it('a numeric string in a per-aggregation filter counts what its number counts — the control', async () => {
    const count = async (filter: FilterCondition) => {
      const rows = await engine.aggregate(OBJECT, {
        aggregations: [{ function: 'count', alias: 'all' }, { function: 'count', alias: 'm', filter }],
      } as EngineAggregateOptions);
      return Number((rows[0] as Record<string, unknown>).m);
    };
    for (const [asString, asNumber] of [
      [{ f_number: { $eq: '12' } }, { f_number: { $eq: 12 } }],
      [{ f_number: { $gt: '10' } }, { f_number: { $gt: 10 } }],
      [{ f_number: { $in: ['5', '30'] } }, { f_number: { $in: [5, 30] } }],
    ] as const) {
      expect(await count(asString as FilterCondition), JSON.stringify(asString)).toBe(await count(asNumber as FilterCondition));
    }
    expect(await count({ f_number: { $eq: '12' } })).toBe(1);
  });

  it('refuses a non-numeric string against a NUMERIC `having` column — count, sum and a numeric min alike', async () => {
    for (const [fn, field] of [['count', undefined], ['sum', 'f_number'], ['min', 'f_currency']] as const) {
      for (const op of ['$gt', '$ne'] as const) {
        reads.length = 0;
        const err = await refusalOf(engine.aggregate(OBJECT, {
          groupBy: ['f_text'],
          aggregations: [{ function: fn, ...(field ? { field } : {}), alias: 'total' }],
          having: { total: { [op]: 'abc' } },
        } as EngineAggregateOptions));
        expect(err, `${fn} ${op}`).not.toBeNull();
        expect({ code: err!.code, status: err!.status }, `${fn} ${op}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
        expect(err!.message, `${fn} ${op}`).toContain(`having.total.${op}`);
        expect(reads, `${fn} ${op}`).toHaveLength(0);
      }
    }
  });

  it('a {placeholder} against a numeric `having` column is refused unresolved, as on `where` — before the resolver', async () => {
    const err = await refusalOf(engine.aggregate(OBJECT, {
      groupBy: ['f_text'],
      aggregations: [{ function: 'count', alias: 'n' }],
      having: { n: { $gte: '{not_a_token}' } },
    } as EngineAggregateOptions));
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(err!.message).toContain('having.n.$gte');
    expect(err!.message).toContain('{placeholder}');
    expect(reads).toHaveLength(0);
  });

  it('a numeric string in `having` keeps the groups its number keeps; a text column is not this door\'s', async () => {
    const groups = async (having: FilterCondition) =>
      (await engine.aggregate(OBJECT, {
        groupBy: ['id'],
        aggregations: [{ function: 'sum', field: 'f_number', alias: 'total' }],
        having,
      } as EngineAggregateOptions)).map((r) => (r as Record<string, unknown>).id).sort();
    expect(await groups({ total: { $gt: '10' } })).toEqual(await groups({ total: { $gt: 10 } }));
    expect(await groups({ total: { $eq: '12' } })).toEqual(['r2']);
    // `id` is a text column of the aggregated row — the door has no opinion there.
    expect(await groups({ id: { $ne: 'abc' } })).toEqual(['r1', 'r2', 'r3']);
  });

  // ── [#20502] a boolean, a Date, an array: one refusal at every position ──

  /** The non-string comparands the widened verdict refuses — each a value the card measured three ways. */
  const NON_STRING: ReadonlyArray<readonly [string, () => unknown, string]> = [
    ['true', () => true, 'boolean'],
    ['false', () => false, 'boolean'],
    ['a Date', () => new Date(Date.UTC(2026, 0, 1)), 'date'],
    ['an array', () => [10], 'array'],
  ];

  it('[#20502] refuses a boolean, a Date or an array in ONE aggregation\'s own filter, rooted at that position — no read', async () => {
    for (const [name, value, form] of NON_STRING) {
      for (const op of ['$gt', '$lte'] as const) {
        reads.length = 0;
        const err = await refusalOf(engine.aggregate(OBJECT, {
          aggregations: [
            { function: 'count', alias: 'all' },
            { function: 'count', alias: 'bad', filter: { f_number: { [op]: value() } } },
          ],
        } as EngineAggregateOptions));
        expect(err, `${name} ${op}`).not.toBeNull();
        expect({ code: err!.code, status: err!.status }, `${name} ${op}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
        expect(err!.message, `${name} ${op}`).toContain(`aggregations[1].filter.f_number.${op}`);
        expect(err!.message, `${name} ${op}`).toMatch(/^aggregate\('number_door_probe'\): filter on 'f_number' compares a declared number field/);
        expect(findNonNumericComparand(engine.registry.getObject(OBJECT), { f_number: { [op]: value() } }), name)
          .toMatchObject({ field: 'f_number', form });
        expect(reads, `${name} ${op}`).toHaveLength(0);
      }
    }
  });

  it('[#20502] refuses a boolean, a Date or an array against a NUMERIC `having` column — count, sum and a numeric min alike', async () => {
    for (const [name, value] of NON_STRING) {
      for (const [fn, field] of [['count', undefined], ['sum', 'f_number'], ['min', 'f_currency']] as const) {
        reads.length = 0;
        const err = await refusalOf(engine.aggregate(OBJECT, {
          groupBy: ['f_text'],
          aggregations: [{ function: fn, ...(field ? { field } : {}), alias: 'total' }],
          having: { total: { $gt: value() } },
        } as EngineAggregateOptions));
        expect(err, `${name} ${fn}`).not.toBeNull();
        expect({ code: err!.code, status: err!.status }, `${name} ${fn}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
        expect(err!.message, `${name} ${fn}`).toContain('having.total.$gt');
        expect(err!.message, `${name} ${fn}`).toContain("filter on 'total' compares a declared number field");
        expect(reads, `${name} ${fn}`).toHaveLength(0);
      }
    }
  });

  it('[#20502] the numeric control at all three positions: a number reaches the driver and the evaluator as written', async () => {
    reads.length = 0;
    await engine.find(OBJECT, { where: { f_number: { $gt: 10 } } });
    expect(reads[0]?.ast?.where).toEqual({ f_number: { $gt: 10 } });
    const counted = await engine.aggregate(OBJECT, {
      aggregations: [{ function: 'count', alias: 'all' }, { function: 'count', alias: 'm', filter: { f_number: { $gt: 10 } } }],
    } as EngineAggregateOptions);
    expect(Number((counted[0] as Record<string, unknown>).m)).toBe(2);
    const groups = (await engine.aggregate(OBJECT, {
      groupBy: ['id'],
      aggregations: [{ function: 'sum', field: 'f_number', alias: 'total' }],
      having: { total: { $gt: 10 } },
    } as EngineAggregateOptions)).map((r) => (r as Record<string, unknown>).id).sort();
    expect(groups).toEqual(['r2', 'r3']);
  });

  it('[#20502] the same mistake as FilterArray sugar and inside $and / $or / $not — one answer per mistake', async () => {
    const sugar = await refusalOf(
      engine.find(OBJECT, { where: [['f_number', '>', true]] } as unknown as EngineQueryOptions),
    );
    expect({ code: sugar!.code, status: sugar!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(sugar!.message).toContain("filter on 'f_number' compares a declared number field against true at where.f_number.$gt");
    for (const where of [
      { $and: [{ f_text: 'a' }, { f_number: { $gt: true } }] },
      { $or: [{ f_text: 'a' }, { f_currency: { $in: [1, new Date(0)] } }] },
      { $not: { f_percent: { $between: [[1], 10] } } },
    ]) {
      const err = await refusalOf(engine.find(OBJECT, { where: where as FilterCondition }));
      expect({ code: err?.code, status: err?.status }, JSON.stringify(where)).toEqual({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);
    expect(engine.judgeFilter(OBJECT, { f_number: { $gt: new Date(0) } })).toMatchObject({ ok: false, code: 'INVALID_FILTER', status: 400 });
  });

  it('[#20502] a value OUTSIDE the accepted comparand types is the comparand-TYPE door\'s refusal, in that door\'s words, on both spellings', async () => {
    const context = `find('${OBJECT}')`;
    for (const [name, value] of [['a plain object', { a: 1 }], ['undefined', undefined], ['a Map', new Map()]] as const) {
      const where = { f_number: { $gt: value } };
      // The verdict passes it, so THIS door has no second opinion …
      expect(findNonNumericComparand(engine.registry.getObject(OBJECT), where), name).toBeNull();
      // … and the engine answers exactly what the comparand-type door answers.
      let expected: Error | undefined;
      try { normalizeFilterComparandTypes(where, context); } catch (e) { expected = e as Error; }
      expect(expected, name).toBeDefined();
      const err = await refusalOf(engine.find(OBJECT, { where: where as FilterCondition }));
      expect({ code: err?.code, status: err?.status }, name).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message, name).toBe(expected!.message);
    }
    const sugar = await refusalOf(engine.find(OBJECT, { where: [['f_number', '>', { a: 1 }]] } as unknown as EngineQueryOptions));
    let expected: Error | undefined;
    try { normalizeFilterComparandTypes({ f_number: { $gt: { a: 1 } } }, context); } catch (e) { expected = e as Error; }
    expect(sugar!.message).toBe(expected!.message);
    expect(reads).toHaveLength(0);
  });

  it('GUARD the having walk narrows copy-on-write and judges only columns classed numeric', () => {
    const classes = new Map([['total', 'numeric' as const], ['label', 'text' as const], ['unknown', undefined]]);
    const having = { total: { $in: ['1', 2] }, label: { $eq: 'abc' }, unknown: { $eq: 'abc' } };
    const narrowed = narrowHavingNumberComparands(OBJECT, having, classes);
    expect(narrowed).toEqual({ total: { $in: [1, 2] }, label: { $eq: 'abc' }, unknown: { $eq: 'abc' } });
    expect(having.total.$in).toEqual(['1', 2]);
    const untouched = { total: { $gt: 5 } };
    expect(narrowHavingNumberComparands(OBJECT, untouched, classes)).toBe(untouched);
  });

  // ── the REST doors that reach findData ──────────────────────────────────

  describe('the REST doors — one answer however the query arrived', () => {
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
      protocol = new ObjectStackProtocolImplementation(engine);
    });

    const DOORS: ReadonlyArray<{ door: string; query: (comparand: string) => Record<string, unknown> }> = [
      // `where` object — `POST /data/:object/query` body.
      { door: 'where object', query: (v) => ({ where: { f_number: { $gt: v } } }) },
      // `$filter` string — the OData spelling, JSON nested in a querystring value.
      { door: '$filter string', query: (v) => ({ $filter: JSON.stringify({ f_number: { $gt: v } }) }) },
      // Filter AST — the sugar the ObjectUI client and FilterBuilder emit.
      { door: 'filter AST', query: (v) => ({ filter: [['f_number', '>', v]] }) },
      // An implicit query parameter — `GET /data/:object?f_number=…`, always a string.
      { door: 'implicit query parameter', query: (v) => ({ f_number: v }) },
    ];

    it.each(DOORS)('the $door door refuses a non-numeric string against a declared number field', async ({ query }) => {
      const err = await refusalOf(protocol.findData({ object: OBJECT, query: query('abc') } as any));
      expect(err).not.toBeNull();
      expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message).toContain("'f_number'");
      expect(reads).toHaveLength(0);
    });

    it.each(DOORS)('the $door door hands the driver the number a numeric string names', async ({ query }) => {
      await expect(protocol.findData({ object: OBJECT, query: query('12') } as any)).resolves.toBeDefined();
      expect(reads).toHaveLength(1);
      expect(JSON.stringify(reads[0]?.ast?.where)).toContain('12');
      expect(JSON.stringify(reads[0]?.ast?.where)).not.toContain('"12"');
    });
  });

  // ── where the door deliberately has NO opinion ───────────────────────────

  it('GUARD a registry-less host gets no verdict — a door that cannot see the field map invents none', () => {
    expect(findNonNumericComparand(undefined, { f_number: { $gt: 'abc' } })).toBeNull();
    expect(findNonNumericComparand({}, { f_number: { $gt: 'abc' } })).toBeNull();
    expect(findNonNumericComparand({ fields: {} }, { f_number: { $gt: 'abc' } })).toBeNull();
    const where = { f_number: { $gt: '12' } };
    expect(narrowNumberComparands(OBJECT, 'find', undefined, where)).toBe(where);
  });

  it('GUARD an UNKNOWN filter field keeps the engine\'s registry-less tolerance — no second opinion about a name', async () => {
    await expect(engine.find(OBJECT, { where: { not_a_field: { $gt: 'abc' } } })).resolves.toBeDefined();
    expect(reads).toHaveLength(1);
  });

  it('GUARD a filter with nothing to narrow is returned BY REFERENCE — the common path allocates nothing', () => {
    const schema = engine.registry.getObject(OBJECT);
    for (const where of [
      { f_number: { $gt: 5 } },
      { f_number: 5, f_text: 'abc' },
      { f_text: { $gt: 'abc' } },
      { f_number: { $null: true } },
      { f_number: { $gt: { $field: 'f_currency' } } },
      { 'f_number.x': { $gt: 'abc' } },
    ]) {
      expect(narrowNumberComparands(OBJECT, 'find', schema, where), JSON.stringify(where)).toBe(where);
    }
  });

  it('GUARD an unrecognised $ combinator leaves the fields beneath it ungated — a hole, never a false 400', () => {
    expect(findNonNumericComparand(
      { fields: { f_number: { type: 'number' } } },
      { $nor: [{ f_number: { $gt: 'abc' } }] },
    )).toBeNull();
  });
});
