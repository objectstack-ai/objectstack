// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21333] The BOOLEAN-comparand arm of the engine's field-aware filter walk —
 * lane (2) of the boolean twin of the number-comparand door. The contract (the
 * accepted spellings, the verdict, the words, the fixture and the derived case
 * table) is `@objectstack/spec/data`'s `filter-boolean-comparand-declared-type.ts`;
 * this file is its CONSUMER, driven the way that module prescribes, through a
 * recording driver.
 *
 * ## What ran before the arm, measured on `origin/main` `6c5bef5f4`
 *
 * Two rows of a declared `boolean` field (one `true`, one `false`), through
 * `engine.find`, `engine.aggregate` (`where`, the per-aggregation `filter`)
 * and every spelling the REST doors hand `findData` (the `POST …/query` body's
 * `where`, `?filter=` JSON, `?$filter=`, a `FilterArray`, a bare `?f=` query
 * parameter), on InMemoryDriver and on SqlDriver over SQLite:
 *
 * | comparand | InMemoryDriver | SQLite | correct |
 * |:--|:--|:--|:--|
 * | `"true"` / `"false"` — implicit, `$eq`, `$in`, every REST spelling | 0 rows | 0 rows | 1 row |
 * | `$ne "true"`, `$nin ["true"]`, `$ne "false"` | **2 rows** | **2 rows** | 1 row |
 * | `"yes"` / `"TRUE"` (`$ne "yes"`) | 0 rows (2) | 0 rows (2) | 400 |
 * | `1` / `"1"` / `0` / `"0"` — `where` and every REST spelling | **0 rows** | 1 row | 1 row |
 * | `$ne 1` / `$ne "1"` | **2 rows** | 1 row | 1 row |
 * | `true` / `false` / `$ne true` / `$in [true]` (the controls) | 1 row | 1 row | 1 row |
 *
 * The per-aggregation `filter` (the engine's own evaluator) answered `"true"`
 * with 0, `$ne "true"` with 2 and `1` / `"1"` with 1, on both drivers; `having`
 * over a groupBy of the field kept no group for `"true"` and both groups for
 * `$ne "true"`. After the arm every cell answers its correct column on both
 * drivers (re-measured on the same harness against freshly built dists).
 *
 * ## Why a recording driver carries the pin
 *
 * The arm answers before any driver is resolved: a refusal reads nothing, and
 * a narrowed comparand reaches the driver as the very boolean its control
 * hands it — pinned below as byte-identical driver input, so each driver's
 * answer for `"true"` IS its answer for `true`, which the table measured
 * correct on both. This package depends on neither driver, and the in-memory
 * driver's test consumers are a closed census (`check:driver-memory-census`).
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/21333
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  BOOLEAN_COMPARAND_DOOR_CASES,
  BOOLEAN_COMPARAND_DOOR_FIXTURE,
  BOOLEAN_COMPARAND_DOOR_FIXTURE_OBJECT,
  BOOLEAN_COMPARAND_DOOR_LIST_OPERATORS,
  BOOLEAN_COMPARAND_DOOR_SCALAR_OPERATORS,
  NON_BOOLEAN_STRING_FORMS,
  lowerFilterCondition,
  type BooleanComparandDoorCase,
  type BooleanComparandDoorNarrowsCase,
  type BooleanComparandDoorRefusalCase,
  type EngineAggregateOptions,
  type EngineQueryOptions,
  type FilterCondition,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { narrowHavingNumberComparands, narrowNumberComparands } from './number-comparand-declared-type-door.js';

const OBJECT = BOOLEAN_COMPARAND_DOOR_FIXTURE_OBJECT;

/** What a driver receives is the door's output after the engine's shared lowering (the NULL-polarity guards). */
const lowered = (where: unknown): unknown => lowerFilterCondition(where, { isDatetimeColumn: () => false });

interface SeenRead { ast: any }

/** Minimal recording driver — the witness shape the sibling door suites use. */
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
  return { driver, reads, writes };
}

type Thrown = (Error & { code?: string; status?: number; httpStatus?: number }) | null;

const refusalOf = async (p: Promise<unknown>): Promise<Thrown> =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

const isFormulaCase = (c: BooleanComparandDoorCase): boolean => c.declaredType === 'formula';

const SEEDED = [
  { id: 'rt', f_text: 'a', f_boolean: true, f_toggle: true },
  { id: 'rf', f_text: 'b', f_boolean: false, f_toggle: false },
];

/** The card's table: the filter as written, and the control that names the same boolean. */
const CARD: ReadonlyArray<readonly [string, FilterCondition, FilterCondition]> = [
  ['implicit "true"', { f_boolean: 'true' }, { f_boolean: true }],
  ['$eq "true"', { f_boolean: { $eq: 'true' } }, { f_boolean: { $eq: true } }],
  ['$in ["true"]', { f_boolean: { $in: ['true'] } }, { f_boolean: { $in: [true] } }],
  ['$ne "true" (returned the true row)', { f_boolean: { $ne: 'true' } }, { f_boolean: { $ne: true } }],
  ['$nin ["true"]', { f_boolean: { $nin: ['true'] } }, { f_boolean: { $nin: [true] } }],
  ['implicit "false"', { f_boolean: 'false' }, { f_boolean: false }],
  ['$ne "false"', { f_boolean: { $ne: 'false' } }, { f_boolean: { $ne: false } }],
  ['control 1', { f_boolean: 1 }, { f_boolean: true }],
  ['control "1"', { f_boolean: '1' }, { f_boolean: true }],
  ['control 0', { f_boolean: 0 }, { f_boolean: false }],
  ['control "0"', { f_boolean: '0' }, { f_boolean: false }],
  ['$ne 1', { f_boolean: { $ne: 1 } }, { f_boolean: { $ne: true } }],
  ['a toggle field: "true"', { f_toggle: 'true' }, { f_toggle: true }],
];

/** The refused comparands of the card, and their neighbours. */
const REFUSED: ReadonlyArray<readonly [string, FilterCondition]> = [
  ['implicit "yes" (the card)', { f_boolean: 'yes' }],
  ['$ne "yes"', { f_boolean: { $ne: 'yes' } }],
  ['a $in member "yes"', { f_boolean: { $in: [true, 'yes'] } }],
  ['"TRUE"', { f_boolean: { $eq: 'TRUE' } }],
  ['a toggle field: "on"', { f_toggle: 'on' }],
];

describe('[#21333] the boolean-comparand arm at the engine collection point', () => {
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
    engine.registry.registerObject(BOOLEAN_COMPARAND_DOOR_FIXTURE as any, 'test');
    for (const row of SEEDED) await engine.insert(OBJECT, { ...row });
    reads.length = 0;
    writes.length = 0;
  });

  /** The `where` the driver received for one `find`, after the shared lowering. */
  const driverWhere = async (where: FilterCondition): Promise<unknown> => {
    reads.length = 0;
    await engine.find(OBJECT, { where });
    expect(reads, JSON.stringify(where)).toHaveLength(1);
    return reads[0]?.ast?.where;
  };

  // ── the derived case table, driven end to end ────────────────────────────

  const REFUSALS = BOOLEAN_COMPARAND_DOOR_CASES.filter(
    (c): c is BooleanComparandDoorRefusalCase => c.verdict === 'door-refusal' && !isFormulaCase(c));
  const NARROWS = BOOLEAN_COMPARAND_DOOR_CASES.filter(
    (c): c is BooleanComparandDoorNarrowsCase => c.verdict === 'narrows' && !isFormulaCase(c));
  const PASSES = BOOLEAN_COMPARAND_DOOR_CASES.filter((c) => c.verdict === 'passes' && !isFormulaCase(c));
  const FORMULA = BOOLEAN_COMPARAND_DOOR_CASES.filter(isFormulaCase);

  it('GUARD the case table is partitioned exactly, every refused form is driven, and every position both ways', () => {
    expect(BOOLEAN_COMPARAND_DOOR_CASES.length).toBe(REFUSALS.length + NARROWS.length + PASSES.length + FORMULA.length);
    expect(new Set(REFUSALS.map((c) => c.form))).toEqual(new Set(NON_BOOLEAN_STRING_FORMS));
    const positions = (cs: readonly BooleanComparandDoorCase[]) =>
      new Set(cs.filter((c) => c.key === 'f_boolean').map((c) => c.position.replace(/\[\d\]$/, '')));
    const judged = ['f_boolean', ...BOOLEAN_COMPARAND_DOOR_SCALAR_OPERATORS.map((op) => `f_boolean.${op}`),
      ...BOOLEAN_COMPARAND_DOOR_LIST_OPERATORS.map((op) => `f_boolean.${op}`)];
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
      for (const substring of c.mustMention) expect(err!.message, `${c.name}: ${substring}`).toContain(substring);
      expect(err!.message, c.name).toMatch(/^find\('boolean_door_probe'\): /);
      expect(err!.message, c.name).toContain('which is not a boolean');
      expect(reads, `${c.name}: the driver must not have been read`).toHaveLength(0);
    }
  });

  it('narrows every accepted spelling to its boolean — the driver receives the expected filter, the caller\'s is untouched', async () => {
    for (const c of NARROWS) {
      const filter = c.filter();
      const asWritten = JSON.stringify(filter);
      expect(await driverWhere(filter), c.name).toEqual(lowered(c.expectedFilter()));
      expect(JSON.stringify(filter), `${c.name}: the caller's filter must not be edited`).toBe(asWritten);
    }
  });

  it('lets every passing case through UNCHANGED — a boolean, null, a non-boolean field, a flag, a reference', async () => {
    for (const c of PASSES) {
      const filter = c.filter();
      expect(await driverWhere(filter), c.name).toEqual(lowered(filter));
    }
  });

  it('NAMED DIVERGENCE — every formula case is refused one door EARLIER, by the unmaterializable-field door, with INVALID_FIELD', async () => {
    expect(FORMULA.length).toBeGreaterThan(0);
    for (const c of FORMULA) {
      reads.length = 0;
      const err = await refusalOf(engine.find(OBJECT, { where: c.filter() }));
      expect({ code: err?.code, status: err?.status }, c.name).toEqual({ code: 'INVALID_FIELD', status: 400 });
      expect(reads, c.name).toHaveLength(0);
    }
    // …and the walk itself judges the class by its return type.
    const schema = engine.registry.getObject(OBJECT);
    expect(() => narrowNumberComparands(OBJECT, 'find', schema, { f_formula_boolean: 'yes' })).toThrow(/declared formula field returning boolean/);
    expect(narrowNumberComparands(OBJECT, 'find', schema, { f_formula_boolean: 'true' })).toEqual({ f_formula_boolean: true });
    const untyped = { f_formula_untyped: 'yes' };
    expect(narrowNumberComparands(OBJECT, 'find', schema, untyped)).toBe(untyped);
  });

  // ── the card's table ─────────────────────────────────────────────────────

  it('the card\'s table: each comparand reaches the driver as the very filter its boolean control does', async () => {
    for (const [name, written, control] of CARD) {
      expect(await driverWhere(written), name).toEqual(await driverWhere(control));
    }
    // The controls themselves reach the driver as written (after the shared lowering).
    for (const control of [{ f_boolean: true }, { f_boolean: false }, { f_boolean: { $ne: true } }] as FilterCondition[]) {
      expect(await driverWhere(control), JSON.stringify(control)).toEqual(lowered(control));
    }
  });

  it('the card\'s refusals: 400 INVALID_FILTER naming the field and its declared type, before any read', async () => {
    for (const [name, where] of REFUSED) {
      reads.length = 0;
      const err = await refusalOf(engine.find(OBJECT, { where }));
      expect({ code: err?.code, status: err?.status }, name).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message, name).toMatch(/filter on 'f_(boolean|toggle)' compares a declared (boolean|toggle) field against /);
      expect(reads, name).toHaveLength(0);
    }
  });

  it('a filter with nothing to narrow is returned BY REFERENCE — the controls allocate nothing', () => {
    const schema = engine.registry.getObject(OBJECT);
    for (const where of [
      { f_boolean: true },
      { f_boolean: { $ne: false } },
      { f_boolean: { $in: [true, false] } },
      { f_boolean: { $null: true } },
      { f_text: 'true' },
    ]) {
      expect(narrowNumberComparands(OBJECT, 'find', schema, where), JSON.stringify(where)).toBe(where);
    }
  });

  // ── the door's reach: every verb, both filter forms, nested structure ────

  it('covers every engine verb that collects a filter — read and write sides', async () => {
    const where = { f_boolean: 'yes' };
    for (const call of [
      () => engine.find(OBJECT, { where }),
      () => engine.findOne(OBJECT, { where }),
      () => engine.count(OBJECT, { where }),
      () => engine.aggregate(OBJECT, { where, aggregations: [{ function: 'count', alias: 'n' }] } as EngineAggregateOptions),
      () => engine.update(OBJECT, { f_text: 'x' }, { where, multi: true }),
      () => engine.delete(OBJECT, { where, multi: true }),
    ]) {
      const err = await refusalOf(call());
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message).toContain("filter on 'f_boolean' compares a declared boolean field");
    }
    expect(reads).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('a write verb scoped by "true" updates the rows true names — the narrowing reaches the write side too', async () => {
    await engine.update(OBJECT, { f_text: 'x' }, { where: { f_boolean: 'true' }, multi: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.ast?.where).toEqual(lowered({ f_boolean: true }));
  });

  it('answers the FilterArray sugar the same — one answer per comparand, not per spelling', async () => {
    const err = await refusalOf(engine.find(OBJECT, { where: [['f_boolean', '=', 'yes']] } as unknown as EngineQueryOptions));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    // `parseFilterAST` lowers `=` to the implicit comparand, so the path is the key's own.
    expect(err!.message).toContain('against "yes" at where.f_boolean,');
    expect(reads).toHaveLength(0);
    for (const [v, b] of [['true', true], ['false', false], ['1', true], ['0', false]] as const) {
      reads.length = 0;
      await engine.find(OBJECT, { where: [['f_boolean', '=', v]] } as unknown as EngineQueryOptions);
      expect(reads[0]?.ast?.where, v).toEqual(lowered({ f_boolean: b }));
    }
    reads.length = 0;
    await engine.find(OBJECT, { where: [['f_boolean', '!=', 'true']] } as unknown as EngineQueryOptions);
    expect(reads[0]?.ast?.where).toEqual(lowered({ f_boolean: { $ne: true } }));
  });

  it('reaches inside $and / $or / $not — structure does not launder the comparand', async () => {
    for (const where of [
      { $and: [{ f_text: 'a' }, { f_boolean: 'yes' }] },
      { $or: [{ f_text: 'a' }, { f_toggle: { $in: [true, 'on'] } }] },
      { $not: { f_boolean: { $ne: 'nope' } } },
    ]) {
      const err = await refusalOf(engine.find(OBJECT, { where: where as FilterCondition }));
      expect({ code: err?.code, status: err?.status }, JSON.stringify(where)).toEqual({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);
    expect(await driverWhere({ $or: [{ f_text: 'a' }, { $not: { f_boolean: { $in: ['true', 0] } } }] }))
      .toEqual(lowered({ $or: [{ f_text: 'a' }, { $not: { f_boolean: { $in: [true, false] } } }] }));
  });

  it('refuses a {placeholder} against a boolean field UNRESOLVED — before the token resolver, in the arm\'s words', async () => {
    const err = await refusalOf(engine.find(
      OBJECT,
      { where: { f_boolean: '{current_user_id}' }, context: { userId: 'u1' } } as EngineQueryOptions,
    ));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(err!.message).toContain('{placeholder}');
    expect(reads).toHaveLength(0);
  });

  it('the judge-only judgeFilter gives the verdict execution gives, without a read', () => {
    expect(engine.judgeFilter(OBJECT, { f_boolean: 'yes' })).toMatchObject({ ok: false, code: 'INVALID_FILTER', status: 400 });
    expect(engine.judgeFilter(OBJECT, { f_boolean: 'true' })).toEqual({ ok: true });
    expect(reads).toHaveLength(0);
  });

  // ── engine.aggregate: `where`, the per-aggregation `filter`, `having` ────

  it('aggregate\'s `where` — the card\'s count row — reaches the driver narrowed, and "yes" is refused', async () => {
    const counted = async (where: FilterCondition) => {
      reads.length = 0;
      await engine.aggregate(OBJECT, { where, aggregations: [{ function: 'count', alias: 'n' }] } as EngineAggregateOptions);
      expect(reads.length, JSON.stringify(where)).toBeGreaterThan(0);
      return reads[0]?.ast?.where;
    };
    expect(await counted({ f_boolean: 'true' })).toEqual(await counted({ f_boolean: true }));
    expect(await counted({ f_boolean: { $ne: 'true' } })).toEqual(await counted({ f_boolean: { $ne: true } }));
    const err = await refusalOf(engine.aggregate(OBJECT, {
      where: { f_boolean: 'yes' }, aggregations: [{ function: 'count', alias: 'n' }],
    } as EngineAggregateOptions));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
  });

  it('a per-aggregation filter counts what its boolean counts, and refuses "yes" rooted at its position — no read', async () => {
    const count = async (filter: FilterCondition) => {
      const rows = await engine.aggregate(OBJECT, {
        aggregations: [{ function: 'count', alias: 'all' }, { function: 'count', alias: 'm', filter }],
      } as EngineAggregateOptions);
      return Number((rows[0] as Record<string, unknown>).m);
    };
    for (const [name, written, control] of CARD) {
      expect(await count(written), name).toBe(await count(control));
      expect(await count(written), name).toBe(1);
    }
    reads.length = 0;
    const err = await refusalOf(engine.aggregate(OBJECT, {
      aggregations: [{ function: 'count', alias: 'all' }, { function: 'count', alias: 'bad', filter: { f_boolean: { $ne: 'yes' } } }],
    } as EngineAggregateOptions));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(err!.message).toContain('aggregations[1].filter.f_boolean.$ne');
    expect(err!.message).toMatch(/^aggregate\('boolean_door_probe'\): filter on 'f_boolean' compares a declared boolean field/);
    expect(reads).toHaveLength(0);
  });

  it('`having` over a groupBy of the boolean field keeps the group its boolean keeps, and refuses "yes" as an aggregated column', async () => {
    const groups = async (having: FilterCondition) =>
      (await engine.aggregate(OBJECT, {
        groupBy: ['f_boolean'],
        aggregations: [{ function: 'count', alias: 'n' }],
        having,
      } as EngineAggregateOptions)).map((r) => (r as Record<string, unknown>).f_boolean);
    expect(await groups({ f_boolean: 'true' })).toEqual([true]);
    expect(await groups({ f_boolean: 'true' })).toEqual(await groups({ f_boolean: true }));
    expect(await groups({ f_boolean: { $ne: 'true' } })).toEqual([false]);
    expect(await groups({ f_boolean: '0' })).toEqual([false]);
    reads.length = 0;
    const err = await refusalOf(engine.aggregate(OBJECT, {
      groupBy: ['f_boolean'], aggregations: [{ function: 'count', alias: 'n' }], having: { f_boolean: 'yes' },
    } as EngineAggregateOptions));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(err!.message).toContain("filter on 'f_boolean' compares a boolean aggregated column against \"yes\" at having.f_boolean");
    expect(err!.message).not.toContain('declared');
    expect(reads).toHaveLength(0);
  });

  it('GUARD the having walk narrows copy-on-write and judges a column only by a boolean type', () => {
    const classes = new Map([['flag', 'boolean' as const], ['n', 'numeric' as const]]);
    const types = new Map<string, string | undefined>([['flag', 'boolean'], ['n', 'number'], ['label', 'text']]);
    const having = { flag: { $in: ['true', 0] }, label: { $eq: 'yes' } };
    expect(narrowHavingNumberComparands(OBJECT, having, classes as any, types)).toEqual({ flag: { $in: [true, false] }, label: { $eq: 'yes' } });
    expect(having.flag.$in).toEqual(['true', 0]);
    const untouched = { flag: true, n: { $gt: 1 } };
    expect(narrowHavingNumberComparands(OBJECT, untouched, classes as any, types)).toBe(untouched);
  });

  // ── the REST doors that reach findData ───────────────────────────────────

  describe('the REST doors — one answer however the query arrived', () => {
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
      protocol = new ObjectStackProtocolImplementation(engine);
    });

    const DOORS: ReadonlyArray<{ door: string; query: (comparand: string) => Record<string, unknown> }> = [
      // `POST /data/:object/query` body.
      { door: 'where object', query: (v) => ({ where: { f_boolean: v } }) },
      // `GET /data/:object?filter=<json>` — the JSON nested in a querystring value.
      { door: 'filter JSON string', query: (v) => ({ filter: JSON.stringify({ f_boolean: v }) }) },
      // `?$filter=<json>` — the OData spelling.
      { door: '$filter string', query: (v) => ({ $filter: JSON.stringify({ f_boolean: v }) }) },
      // `?filter=[["f_boolean","=",…]]` — the AST sugar.
      { door: 'filter AST', query: (v) => ({ filter: JSON.stringify([['f_boolean', '=', v]]) }) },
      // `GET /data/:object?f_boolean=…` — a bare query parameter: what the GET
      // route hands `findData` is `req.query` itself, every value a string.
      { door: 'bare query parameter', query: (v) => ({ f_boolean: v }) },
    ];

    it.each(DOORS)('the $door door refuses "yes" against a declared boolean field, naming the type — no read', async ({ query }) => {
      const err = await refusalOf(protocol.findData({ object: OBJECT, query: query('yes') } as any));
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message).toContain("filter on 'f_boolean' compares a declared boolean field against \"yes\"");
      expect(reads).toHaveLength(0);
    });

    it.each(DOORS)('the $door door hands the driver the boolean "true" / "false" / "1" / "0" names', async ({ query }) => {
      for (const [v, b] of [['true', true], ['false', false], ['1', true], ['0', false]] as const) {
        reads.length = 0;
        await expect(protocol.findData({ object: OBJECT, query: query(v) } as any), v).resolves.toBeDefined();
        const seen = reads.find((r) => JSON.stringify(r.ast?.where ?? null).includes('f_boolean'));
        expect(seen, v).toBeDefined();
        const text = JSON.stringify(seen!.ast.where);
        expect(text, v).toContain(`"f_boolean"`);
        expect(text, v).toContain(String(b));
        expect(text, v).not.toContain(`"${v}"`);
      }
    });
  });
});
