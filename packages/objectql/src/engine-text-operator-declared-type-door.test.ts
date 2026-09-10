// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15773] The text-operator DECLARED-TYPE door at the engine's filter
 * collection point — execution lane (2) of the #15661 C-deny ruling.
 *
 * The door's definition lives in `@objectstack/spec/data`
 * (`filter-text-operator-declared-type.ts`, lane 1, where the ruling is quoted
 * verbatim); this file is its CONSUMER, driven exactly the way that module's
 * header prescribes: register {@link TEXT_OPERATOR_DOOR_FIXTURE} against a
 * recording driver, run every case of {@link TEXT_OPERATOR_DOOR_CASES} through
 * `find`, and assert per verdict —
 *
 * - `door-refusal`: rejects with `code` AND `status` (the ADR-0112 envelope —
 *   `toThrow()` alone is not a pin), the message carries every `mustMention`
 *   substring, and NO driver read ran.
 * - `passes` / `deferred`: the driver read ran and received the filter
 *   UNCHANGED.
 *
 * Because the case table is DERIVED from the published value classes, a type
 * added to `NUMERIC_VALUE_TYPES` (or to any other class) arrives here as a new
 * case with no edit in this package — which is what lane (1)'s "⛔ no new set"
 * buys at the consuming end.
 *
 * ## ⚠️ One NAMED DIVERGENCE, measured rather than dropped: `formula`
 *
 * The table's `formula` rows cannot be consumed as written AT THIS SEAM, and
 * the reason is a neighbouring door rather than this one. `formula` is the one
 * field type no driver materialises a column for, so
 * `assertFilterIsMaterializable` (#8296) refuses EVERY filter over one, one
 * step above this door, with `INVALID_FIELD` / 400. Measured on `origin/main`
 * 59db8a02cb, before this card's door existed, for all three return-type
 * shapes:
 *
 * ```
 * find(o, { where: { f_formula_number:  { $contains: '5' } } })  -> INVALID_FIELD 400 (#8296)
 * find(o, { where: { f_formula_text:    { $contains: '5' } } })  -> INVALID_FIELD 400 (#8296)
 * find(o, { where: { f_formula_untyped: { $contains: '5' } } })  -> INVALID_FIELD 400 (#8296)
 * ```
 *
 * So at this seam a `formula`'s declared return type is never the deciding
 * fact, and the door was NOT reordered to make it one: doing so would answer
 * ONE condition ("a formula field cannot be filtered") with TWO wire codes
 * chosen by `returnType`. The rows are pinned below in the direction they
 * actually answer — refused, `INVALID_FIELD`, no driver read — so that the day
 * formula fields become filterable this file goes RED and the divergence is
 * re-judged rather than silently inherited.
 *
 * ## Beneath the door, #14079's option-A row is untouched
 *
 * The ruling keeps that row for "every evaluator no door fronts". Two of them
 * are pinned here: a DIRECT driver call (the door is at the engine seam, not
 * inside a driver) and `having` (this package's own evaluator, which no filter
 * door fronts), held to `FILTER_TEXT_CASES`' own numeric-column rows.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/15773 (this lane)
 * @see https://github.com/objectstack-ai/objectstack/issues/15661 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/14079 (the row beneath)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  TEXT_FILTER_OPERATORS,
  TEXT_OPERATOR_DOOR_CASES,
  TEXT_OPERATOR_DOOR_FIXTURE,
  TEXT_OPERATOR_DOOR_FIXTURE_OBJECT,
  TEXT_OPERATOR_DOOR_TYPE_CLASSES,
  type FilterTextCase,
  type FilterTextRowsCase,
  type TextOperatorDoorCase,
  type EngineAggregateOptions,
  type EngineQueryOptions,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applyHaving } from './having-filter.js';
import { findTextOperatorOverNonTextField } from './text-operator-declared-type-door.js';

const OBJECT = TEXT_OPERATOR_DOOR_FIXTURE_OBJECT;

interface SeenRead { ast: any }

/** Minimal recording driver — the same witness shape as the #7872 door suite. */
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

/** A `formula` case — judged one door earlier, see the header's divergence note. */
const isFormulaCase = (c: TextOperatorDoorCase): boolean => c.declaredType === 'formula';

describe('[#15773] the text-operator declared-type door at the engine collection point', () => {
  let engine: ObjectQL;
  let reads: SeenRead[];
  let writes: SeenRead[];
  let driver: any;

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    reads = rec.reads;
    writes = rec.writes;
    driver = rec.driver;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(TEXT_OPERATOR_DOOR_FIXTURE as any, 'test');
    await engine.insert(OBJECT, { id: 'r1' });
    reads.length = 0;
    writes.length = 0;
  });

  // ── the derived case table, driven end to end ────────────────────────────

  const REFUSALS = TEXT_OPERATOR_DOOR_CASES.filter((c) => c.verdict === 'door-refusal' && !isFormulaCase(c));
  const PASSES = TEXT_OPERATOR_DOOR_CASES.filter((c) => c.verdict === 'passes' && !isFormulaCase(c));
  const DEFERRED = TEXT_OPERATOR_DOOR_CASES.filter((c) => c.verdict === 'deferred' && !isFormulaCase(c));
  const FORMULA = TEXT_OPERATOR_DOOR_CASES.filter(isFormulaCase);

  it('GUARD the case table is non-empty in all four partitions — a shrunk table cannot read as coverage', () => {
    expect(TEXT_OPERATOR_DOOR_CASES.length).toBe(REFUSALS.length + PASSES.length + DEFERRED.length + FORMULA.length);
    expect(REFUSALS.length).toBeGreaterThan(0);
    expect(PASSES.length).toBeGreaterThan(0);
    expect(DEFERRED.length).toBeGreaterThan(0);
    expect(FORMULA.length).toBeGreaterThan(0);
    // Every text operator the ruling names is exercised, not just `$contains`.
    expect(new Set(REFUSALS.map((c) => c.operator))).toEqual(new Set(TEXT_FILTER_OPERATORS));
  });

  it('refuses every door-refusal case with the ADR-0112 envelope, and NO driver read runs', async () => {
    for (const c of REFUSALS) {
      reads.length = 0;
      const err = await refusalOf(engine.find(OBJECT, { where: c.filter() }));
      expect(err, `${c.name}: expected a refusal`).not.toBeNull();
      // `code` AND `status` — `toThrow()` alone would stay green for a bare Error.
      expect({ code: err!.code, status: err!.status }, c.name).toEqual({ code: c.code, status: c.status });
      // ADR-0112 D5's second spelling, which the CLI's `--json` envelope reads.
      expect(err!.httpStatus, c.name).toBe(400);
      for (const substring of c.mustMention) {
        expect(err!.message, `${c.name}: message must mention ${substring}`).toContain(substring);
      }
      // The engine's wording contract, shared with the three sibling gates.
      expect(err!.message, c.name).toMatch(/^find\('text_door_probe'\): /);
      expect(err!.message, c.name).toMatch(/NOT applied/);
      // The whole point of a DOOR: refused before any driver dispatch.
      expect(reads, `${c.name}: the driver must not have been read`).toHaveLength(0);
    }
  });

  it('lets every passing case through UNCHANGED — the door rewrites nothing', async () => {
    for (const c of PASSES) {
      reads.length = 0;
      const filter = c.filter();
      await expect(engine.find(OBJECT, { where: filter }), c.name).resolves.toBeDefined();
      expect(reads, `${c.name}: the driver must have been read`).toHaveLength(1);
      expect(reads[0]?.ast?.where, `${c.name}: the filter must reach the driver unchanged`).toEqual(filter);
    }
  });

  it('records NO verdict for a deferred case — a dotted path into structured JSON stays #8371\'s carve-out', async () => {
    for (const c of DEFERRED) {
      reads.length = 0;
      const filter = c.filter();
      await expect(engine.find(OBJECT, { where: filter }), c.name).resolves.toBeDefined();
      expect(reads, `${c.name}: the driver must have been read`).toHaveLength(1);
      expect(reads[0]?.ast?.where, `${c.name}: the filter must reach the driver unchanged`).toEqual(filter);
    }
  });

  it('NAMED DIVERGENCE — every formula case is refused one door EARLIER, by #8296, with INVALID_FIELD', async () => {
    // Not the table's own expectation for the refusal rows (`INVALID_FILTER`),
    // and deliberately so — the header carries the measurement and the reason
    // the ladder was not reordered around it. Pinned in the direction it
    // answers so that a change to either door lands here first.
    for (const c of FORMULA) {
      reads.length = 0;
      const err = await refusalOf(engine.find(OBJECT, { where: c.filter() }));
      expect(err, `${c.name}: expected the #8296 refusal`).not.toBeNull();
      expect({ code: err!.code, status: err!.status }, c.name).toEqual({ code: 'INVALID_FIELD', status: 400 });
      expect(err!.message, c.name).toContain('virtual formula field');
      expect(reads, c.name).toHaveLength(0);
    }
    // …and the door's own verdict function still judges the class correctly,
    // so the day that neighbour opens up, this door already answers.
    const fields = (engine.registry.getObject(OBJECT) as any).fields;
    expect(findTextOperatorOverNonTextField({ fields }, { f_formula_number: { $contains: '5' } }))
      .toMatchObject({ field: 'f_formula_number', declaredType: 'formula', returnType: 'number', operator: '$contains' });
    expect(findTextOperatorOverNonTextField({ fields }, { f_formula_text: { $contains: '5' } })).toBeNull();
    expect(findTextOperatorOverNonTextField({ fields }, { f_formula_untyped: { $contains: '5' } })).toBeNull();
  });

  it('pins EVERY class of the verdict matrix — refused and passing alike, one member at a time', async () => {
    // Per-CLASS pins, not per-case: the case drive above could stay green with
    // a class silently absent from the fixture, and "pins per refused class AND
    // per passing class" is the card's own deliverable.
    let refusedClasses = 0;
    let passingClasses = 0;
    for (const row of TEXT_OPERATOR_DOOR_TYPE_CLASSES) {
      if (row.verdict === 'by-return-type') continue; // `formula` — the divergence above.
      for (const type of row.types) {
        reads.length = 0;
        const field = `f_${type}`;
        const err = await refusalOf(engine.find(OBJECT, { where: { [field]: { $contains: '5' } } }));
        if (row.verdict === 'door-refusal') {
          expect(err, `${row.name}/${type}: must be refused — ${row.note}`).not.toBeNull();
          expect({ code: err!.code, status: err!.status }, `${row.name}/${type}`)
            .toEqual({ code: 'INVALID_FILTER', status: 400 });
          expect(err!.message, `${row.name}/${type}`).toContain(type);
          expect(reads, `${row.name}/${type}`).toHaveLength(0);
        } else {
          expect(err, `${row.name}/${type}: must pass — ${row.note}`).toBeNull();
          expect(reads, `${row.name}/${type}`).toHaveLength(1);
        }
      }
      if (row.verdict === 'door-refusal') refusedClasses += 1; else passingClasses += 1;
    }
    // Both halves were actually exercised — a matrix that lost one verdict
    // entirely must not read as a green run.
    expect(refusedClasses).toBeGreaterThan(0);
    expect(passingClasses).toBeGreaterThan(0);
  });

  // ── the door's reach: every verb, both filter forms, nested structure ────

  it('covers every engine verb that collects a filter — read and write sides', async () => {
    const where = { f_number: { $contains: '5' } };
    for (const call of [
      () => engine.find(OBJECT, { where }),
      () => engine.findOne(OBJECT, { where }),
      () => engine.count(OBJECT, { where }),
      () => engine.aggregate(OBJECT, { where, aggregations: [{ function: 'count', alias: 'n' }] } as EngineAggregateOptions),
      () => engine.update(OBJECT, { id: 'r1' }, { where, multi: true }),
      () => engine.delete(OBJECT, { where, multi: true }),
    ]) {
      const err = await refusalOf(call());
      expect(err).not.toBeNull();
      expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('refuses the same mistake arriving as FilterArray sugar — one answer per mistake, not per spelling', async () => {
    // The cast names the contract being bypassed: `FilterArray` is INPUT-ONLY
    // sugar `EngineQueryOptions.where` deliberately excludes (#5285).
    const err = await refusalOf(
      engine.find(OBJECT, { where: [['f_number', 'contains', '5']] } as unknown as EngineQueryOptions),
    );
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(err!.message).toContain('f_number');
    expect(reads).toHaveLength(0);
  });

  it('reaches inside $and / $or / $not — structure does not launder the predicate', async () => {
    for (const where of [
      { $and: [{ f_text: { $contains: 'a' } }, { f_number: { $contains: '5' } }] },
      { $or: [{ f_text: { $contains: 'a' } }, { f_boolean: { $startsWith: 't' } }] },
      { $not: { f_date: { $endsWith: '01' } } },
    ]) {
      reads.length = 0;
      const err = await refusalOf(engine.find(OBJECT, { where }));
      expect(err, JSON.stringify(where)).not.toBeNull();
      expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(reads).toHaveLength(0);
    }
  });

  it('refuses a text operator in ONE aggregation\'s own filter — the second filter position on the verb', async () => {
    const err = await refusalOf(engine.aggregate(OBJECT, {
      aggregations: [
        { function: 'count', alias: 'all' },
        { function: 'count', alias: 'bad', filter: { f_number: { $contains: '5' } } },
      ],
    } as EngineAggregateOptions));
    expect(err).not.toBeNull();
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(err!.message).toContain('f_number');
    expect(reads).toHaveLength(0);
  });

  // ── where the door deliberately has NO opinion ───────────────────────────

  it('GUARD a registry-less host gets no verdict — a door that cannot see the field map invents none', () => {
    expect(findTextOperatorOverNonTextField(undefined, { f_number: { $contains: '5' } })).toBeNull();
    expect(findTextOperatorOverNonTextField({}, { f_number: { $contains: '5' } })).toBeNull();
    expect(findTextOperatorOverNonTextField({ fields: {} }, { f_number: { $contains: '5' } })).toBeNull();
  });

  it('GUARD an UNKNOWN filter field keeps the engine\'s registry-less tolerance — no second opinion about a name', async () => {
    await expect(engine.find(OBJECT, { where: { not_a_field: { $contains: 'x' } } })).resolves.toBeDefined();
    expect(reads).toHaveLength(1);
  });

  it('GUARD a NON-text operator over the same refused field is untouched', async () => {
    for (const where of [
      { f_number: { $gt: 5 } },
      { f_number: 5 },
      { f_boolean: { $eq: true } },
      { f_json: { $ne: null } },
    ]) {
      reads.length = 0;
      await expect(engine.find(OBJECT, { where }), JSON.stringify(where)).resolves.toBeDefined();
      expect(reads, JSON.stringify(where)).toHaveLength(1);
    }
  });

  it('GUARD an unrecognised $ combinator leaves the fields beneath it ungated — a hole, never a false 400', () => {
    expect(findTextOperatorOverNonTextField(
      { fields: { f_number: { type: 'number' } } },
      { $nor: [{ f_number: { $contains: '5' } }] },
    )).toBeNull();
  });

  // ── the REST doors that reach findData ──────────────────────────────────

  describe('the REST doors — one answer however the query arrived', () => {
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
      protocol = new ObjectStackProtocolImplementation(engine);
    });

    const DOORS: ReadonlyArray<{ door: string; query: (field: string) => any }> = [
      // `where` object — `POST /data/:object/query` body.
      { door: 'where object', query: (f) => ({ where: { [f]: { $contains: '5' } } }) },
      // `$filter` string — the OData spelling, JSON nested in a querystring value.
      { door: '$filter string', query: (f) => ({ $filter: JSON.stringify({ [f]: { $contains: '5' } }) }) },
      // Filter AST — the sugar the ObjectUI client and FilterBuilder emit.
      { door: 'filter AST', query: (f) => ({ filter: [[f, 'contains', '5']] }) },
    ];

    it.each(DOORS)('the $door door refuses a text operator over a declared number field', async ({ query }) => {
      const err = await refusalOf(protocol.findData({ object: OBJECT, query: query('f_number') }));
      expect(err).not.toBeNull();
      expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message).toContain('f_number');
      expect(reads).toHaveLength(0);
    });

    it.each(DOORS)('GUARD the $door door still applies a text operator over a text field', async ({ query }) => {
      await expect(protocol.findData({ object: OBJECT, query: query('f_text') })).resolves.toBeDefined();
      expect(reads).toHaveLength(1);
    });
  });

  // ── beneath the door: #14079's option-A row, unmoved ─────────────────────

  describe('beneath the door — #14079\'s option-A row still answers', () => {
    it('a DIRECT driver call is untouched: the door is at the engine seam, not inside a driver', async () => {
      // The direct path the ruling protects — an embedder calling a driver it
      // constructed, and this repo's own driver conformance suites.
      await expect(driver.find(OBJECT, { where: { f_number: { $contains: '5' } } })).resolves.toBeDefined();
      expect(reads).toHaveLength(1);
      expect(reads[0]?.ast?.where).toEqual({ f_number: { $contains: '5' } });
    });

    it('`having` — an evaluator no filter door fronts — still answers FILTER_TEXT_CASES\' numeric-column rows', () => {
      const rows = FILTER_TEXT_ROWS.map((r) => ({ ...r }));
      const aRow = FILTER_TEXT_CASES.filter(
        (c): c is FilterTextRowsCase =>
          c.expectRejection !== true && Object.keys(c.filter)[0] === 'score',
      );
      // Derived from the table, so the row cannot quietly leave the standard.
      expect(aRow.length).toBeGreaterThan(0);
      for (const c of aRow) {
        expect(applyHaving(rows, c.filter).map((r: any) => r.id), c.name).toEqual([...c.expected]);
      }
      // Both directions of the row are present in what was just asserted:
      // the positive operators match nothing, `$notContains` matches every row.
      expect(aRow.some((c: FilterTextCase & { expected?: readonly string[] }) => c.expected?.length === 0)).toBe(true);
      expect(aRow.some((c: FilterTextCase & { expected?: readonly string[] }) => c.expected?.length === rows.length)).toBe(true);
    });
  });
});
