// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21299] The family's enumeration pin: every position that judges a
 * `{ $field }` reference, crossed with every answer the spec's comparison-class
 * verdict (`crossFieldComparisonVerdict`, `@objectstack/spec/data`) gives.
 *
 * The class rule is ONE rule, the spec's, and `where` is where it was written
 * first (`driver-sql`'s cross-field compiler). Each engine-evaluated position
 * runs that one verdict and refuses exactly its two refused answers, before any
 * row is read:
 *
 * | verdict                  | `where` (driver-sql) | `having`   | `aggregations[i].filter` | `applyInMemoryAggregation` |
 * |:-------------------------|:---------------------|:-----------|:-------------------------|:---------------------------|
 * | `comparable`             | answered             | answered   | answered                 | answered                   |
 * | `cross-class`            | 400                  | 400        | 400                      | 400                        |
 * | `no-class`               | 400                  | 400        | 400                      | 400                        |
 * | `unjudged`               | its own aliases      | unreachable | unreachable             | not judged                 |
 * | no declaration           | 400                  | not judged | not judged               | not judged                 |
 *
 * - `unjudged` (a type outside `FieldType`) cannot reach the two engine
 *   positions: the registry refuses the whole object declaration. A host may
 *   hand `applyInMemoryAggregation` any field map, so there it is reachable,
 *   and not judged.
 * - "No declaration" is a side the field map does not carry: a registry-less
 *   host, or an audit-opt-out object's row-carried `created_at` /
 *   `updated_at`. It is not judged at any engine position — the fail-open
 *   direction every declared-type door of the engine takes — while `where`
 *   refuses it (`driver-sql` judges against its own column set). Recorded here,
 *   not implied.
 * - At `having`, a list-or-object column never becomes an aggregated column:
 *   the engine's groupBy door and its `min` / `max` door refuse it first. The
 *   aggregated column's type carries no `multiple` flag, and the rows below
 *   hold that it needs none.
 *
 * The `where` column is measured in `packages/rest`
 * (`aggregation-filter-where-doors.test.ts`), where a real `SqlDriver` answers
 * it, with its words: the engine judges no `where` reference, and this package
 * has no `driver-sql`. This file holds the three engine-side columns over one
 * declared column per row of the spec's class table
 * (`CROSS_FIELD_COMPARISON_TYPE_CLASSES`), a multi-capable type flagged
 * `multiple: true`, and a type outside `FieldType` — every ordered pair, at each
 * position, judged against what the spec's verdict says of that pair.
 *
 * A new answer in the spec's verdict, a new reason for having no class, a new
 * filter slot on the aggregate verb, or a new published entry of the two
 * evaluator modules turns this file red until it is placed here. A new row of
 * the class table is swept on arrival.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  AggregationNodeSchema,
  CROSS_FIELD_COMPARISON_TYPE_CLASSES,
  CROSS_FIELD_NO_CLASS_REASONS,
  EngineAggregateOptionsSchema,
  FilterConditionSchema,
  crossFieldColumnVerdict,
  crossFieldComparisonVerdict,
  type CrossFieldComparisonFieldMeta,
  type CrossFieldComparisonVerdict,
  type EngineAggregateOptions,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';

const OBJECT = 'qa_verdict';

// ───────────────────────────────────────────────────────────────────────────
// The verdicts, and the posture each position takes on them
// ───────────────────────────────────────────────────────────────────────────

/**
 * What an engine-side position answers for each of the spec's verdicts. A
 * `Record` over the verdict union, so an answer the spec adds is a type error
 * here until it is placed — and the sweep below refuses an unplaced one at run
 * time too.
 */
const POSTURE: Record<CrossFieldComparisonVerdict['verdict'], 'answered' | 'refused' | 'not judged'> = {
  comparable: 'answered',
  'cross-class': 'refused',
  'no-class': 'refused',
  unjudged: 'not judged',
};

/** A single-choice type is a legal declaration only with its options (`FieldSchema`). */
const OPTIONS = [{ label: 'Open', value: 'open' }];

/** One declared column per row of the spec's class table, plus the two its rows do not hold. */
function representativeFields(): Record<string, CrossFieldComparisonFieldMeta & { options?: typeof OPTIONS }> {
  const fields: Record<string, CrossFieldComparisonFieldMeta & { options?: typeof OPTIONS }> = {};
  for (const row of CROSS_FIELD_COMPARISON_TYPE_CLASSES) {
    const type = [...row.types][0];
    fields[`f_${type}`] = type === 'select' || type === 'radio' ? { type, options: OPTIONS } : { type };
  }
  // A multi-capable type flagged `multiple: true` — the spec reads it as `list-or-object`.
  fields.f_select_multi = { type: 'select', multiple: true, options: OPTIONS };
  // A type outside `FieldType` — the spec does not judge it (`unjudged`).
  fields.f_outside = { type: 'string' };
  return fields;
}

const FIELDS = representativeFields();
const NAMES = Object.keys(FIELDS);
/** The registry refuses a type outside `FieldType`, so the engine positions see the rest. */
const REGISTRABLE = Object.fromEntries(Object.entries(FIELDS).filter(([name]) => name !== 'f_outside'));
const LIST_OR_OBJECT = new Set(
  NAMES.filter((name) => {
    const v = crossFieldColumnVerdict(FIELDS[name]);
    return v?.kind === 'no-class' && v.reason === 'list-or-object';
  }),
);

/**
 * The column the refusal names, as `where` names it: the referent when it has
 * no class (`where` asks it first), else the target; with its declared type.
 */
function namedNoClassColumn(target: string, referent: string): string {
  const side = crossFieldColumnVerdict(FIELDS[referent])?.kind === 'no-class' ? referent : target;
  const { type, multiple } = FIELDS[side];
  return `"${side}" (type "${type}"${multiple ? ', multiple' : ''})`;
}

// ───────────────────────────────────────────────────────────────────────────
// Harness
// ───────────────────────────────────────────────────────────────────────────

function makeDriver() {
  const calls = { aggregate: 0, find: 0 };
  const driver: any = {
    name: 'verdict-recorder',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { calls.find += 1; return []; },
    async findOne() { return null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return 0; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls };
}

async function makeEngine(object: Record<string, unknown> | null) {
  const { driver, calls } = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  if (object) (engine.registry as any).registerObject(object);
  const warnings: string[] = [];
  (engine as any).logger.warn = (line: unknown) => { warnings.push(String(line)); };
  return { engine, calls, warnings };
}

interface Outcome { refused: boolean; code?: unknown; status?: unknown; message: string; diagnostic: string }

async function outcomeOf(run: () => unknown, logged: () => readonly string[]): Promise<Outcome> {
  try {
    await run();
    return { refused: false, message: '', diagnostic: '' };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; message?: unknown };
    return { refused: true, code: err.code, status: err.status, message: String(err.message), diagnostic: logged().join('\n') };
  }
}

const perAggregation = (filter: unknown) => ({
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
}) as unknown as EngineAggregateOptions;

/** The three engine-side positions, each judging `{ [target]: { $eq: { $field: referent } } }`. */
const POSITIONS = {
  'aggregations[i].filter': async (target: string, referent: string) => {
    const { engine, calls, warnings } = await makeEngine({ name: OBJECT, fields: REGISTRABLE });
    const out = await outcomeOf(
      () => engine.aggregate(OBJECT, perAggregation({ [target]: { $eq: { $field: referent } } })),
      () => warnings,
    );
    return { ...out, reads: calls.aggregate + calls.find };
  },
  having: async (target: string, referent: string) => {
    const { engine, calls, warnings } = await makeEngine({ name: OBJECT, fields: REGISTRABLE });
    const out = await outcomeOf(() => engine.aggregate(OBJECT, {
      groupBy: target === referent ? [target] : [target, referent],
      aggregations: [{ function: 'count', alias: 'n' }],
      having: { [target]: { $eq: { $field: referent } } },
    } as unknown as EngineAggregateOptions), () => warnings);
    return { ...out, reads: calls.aggregate + calls.find };
  },
  applyInMemoryAggregation: async (target: string, referent: string) => {
    const withheld: string[] = [];
    const out = await outcomeOf(
      () => applyInMemoryAggregation([], perAggregation({ [target]: { $eq: { $field: referent } } }) as never,
        undefined, FIELDS, (diagnostic) => withheld.push(diagnostic)),
      () => withheld,
    );
    return { ...out, reads: 0 };
  },
} as const;

type Position = keyof typeof POSITIONS;

/**
 * What one position answers for one pair: the verdict's posture, or the door
 * that answers the pair before the verdict is asked, named. Every pre-emption
 * is a 400 that `where` gives the same pair too, or a declaration that cannot
 * exist at that position.
 */
type Expected =
  | { kind: 'answered' }
  | { kind: 'refused by the verdict'; verdict: 'cross-class' | 'no-class' }
  | { kind: 'refused first by'; door: string; code: 'INVALID_FIELD' | 'INVALID_FILTER' }
  | { kind: 'unreachable'; why: string };

function expectedAt(position: Position, target: string, referent: string): Expected {
  const verdict = crossFieldComparisonVerdict(FIELDS[target], FIELDS[referent]);
  const outside = target === 'f_outside' || referent === 'f_outside';
  if (position !== 'applyInMemoryAggregation' && outside) {
    return { kind: 'unreachable', why: 'the registry refuses a field type outside FieldType' };
  }
  if (position === 'having' && (LIST_OR_OBJECT.has(target) || LIST_OR_OBJECT.has(referent))) {
    // The `multiple` seam (pointer 5944816815): no aggregated column holds a list.
    return { kind: 'refused first by', door: 'the groupBy door (a multi-value or JSON field is not grouped by)', code: 'INVALID_FIELD' };
  }
  if (position === 'aggregations[i].filter' && FIELDS[target].type === 'formula') {
    // `where` meets the same door first: a formula is computed on read, never filtered on.
    return { kind: 'refused first by', door: 'the materializable-filter door (a formula key)', code: 'INVALID_FIELD' };
  }
  const posture = POSTURE[verdict.verdict];
  if (posture === 'refused') return { kind: 'refused by the verdict', verdict: verdict.verdict as 'cross-class' | 'no-class' };
  if (posture === 'not judged' && LIST_OR_OBJECT.has(target)) {
    // Not the class rule's to judge — and then `where`'s JSON-column rule, which
    // runs after it at this position, refuses a scalar comparison on the column.
    return { kind: 'refused first by', door: 'the JSON-column rule', code: 'INVALID_FILTER' };
  }
  return { kind: 'answered' };
}

function assertCell(position: Position, target: string, referent: string, got: Outcome & { reads: number }): void {
  const cell = `${position}: ${target} (${FIELDS[target].type}) vs ${referent} (${FIELDS[referent].type})`;
  const expected = expectedAt(position, target, referent);
  if (expected.kind === 'unreachable') return;
  if (expected.kind === 'answered') {
    expect(got.refused, `${cell} — ${got.message}`).toBe(false);
    return;
  }
  expect(got.refused, cell).toBe(true);
  expect(got.status, cell).toBe(400);
  expect(got.reads, `${cell}: refused before any read`).toBe(0);
  if (expected.kind === 'refused first by') {
    expect(got.code, `${cell} — ${expected.door}`).toBe(expected.code);
    return;
  }
  expect(got.code, cell).toBe('INVALID_FILTER');
  // The words name what `where`'s words name: both classes, or the column with
  // no class and its declared type. `having` puts them on the wire (the columns
  // are the author's own projection); the filter positions withhold them and
  // log them, as `where` does.
  const words = position === 'having' ? got.message : got.diagnostic;
  if (position !== 'having') {
    for (const name of [target, referent]) expect(got.message, `${cell}: withheld`).not.toContain(`"${name}"`);
  }
  if (expected.verdict === 'cross-class') {
    const v = crossFieldComparisonVerdict(FIELDS[target], FIELDS[referent]) as Extract<CrossFieldComparisonVerdict, { verdict: 'cross-class' }>;
    expect(words, cell).toContain(`"${target}" is ${v.left} but "${referent}" is ${v.right}`);
  } else {
    expect(words, cell).toContain(namedNoClassColumn(target, referent));
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The table
// ───────────────────────────────────────────────────────────────────────────

describe('[#21299] every position that judges a { $field } runs the spec\'s one verdict — every pair, every position', () => {
  it('the representative columns cover every answer the verdict gives, and every reason for having no class', () => {
    const verdicts = new Set<string>();
    for (const a of NAMES) for (const b of NAMES) verdicts.add(crossFieldComparisonVerdict(FIELDS[a], FIELDS[b]).verdict);
    // Every answer the sweep meets is placed in POSTURE, and every placed answer is met.
    expect([...verdicts].sort()).toEqual(Object.keys(POSTURE).sort());
    const reasons = new Set<string>();
    for (const name of NAMES) {
      const v = crossFieldColumnVerdict(FIELDS[name]);
      if (v?.kind === 'no-class') reasons.add(v.reason);
    }
    expect([...reasons].sort()).toEqual([...CROSS_FIELD_NO_CLASS_REASONS].sort());
  });

  for (const position of Object.keys(POSITIONS) as Position[]) {
    it(`${position}: each of the ${NAMES.length * NAMES.length} ordered pairs answers as the spec's verdict says`, async () => {
      for (const target of NAMES) {
        for (const referent of NAMES) {
          if (expectedAt(position, target, referent).kind === 'unreachable') continue;
          assertCell(position, target, referent, await POSITIONS[position](target, referent));
        }
      }
    });
  }

  it('a type outside FieldType never reaches the engine positions: the registry refuses the object declaration', async () => {
    const { driver } = makeDriver();
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    expect(() => (engine.registry as any).registerObject({ name: OBJECT, fields: FIELDS })).toThrow(/not a member of `FieldType`/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The card's four measured shapes, refused whatever the rows
// ───────────────────────────────────────────────────────────────────────────

describe('[#21299] the card\'s four measured shapes are refused before any read, whatever the rows', () => {
  // Before, measured on `SqlDriver` over better-sqlite3 through
  // `engine.aggregate` (base `db0cf2231b`), each beside a `where` twin that
  // `driver-sql` refused 400: the text-vs-image filter counted 6 of 6, the
  // datetime-vs-formula filter counted 0 of 6, `having` on an image groupBy
  // kept all 6 groups, and the number-vs-multiselect filter counted 6 of 6 when
  // the column held no value — and was refused by the per-row array floor, in
  // other words, when it held a list (a verdict that depended on the rows).
  const ROWS = [
    { id: 'o1', customer_id: 'c1', amount: 100, photo: 'img1', tags: ['a'], due_on: '2026-01-05', closed_at: '2026-01-03T10:00:00.000Z' },
    { id: 'o2', customer_id: 'c1', amount: 400, photo: 'img2', tags: ['b'], due_on: '2026-01-20', closed_at: '2026-01-20T12:00:00.000Z' },
    { id: 'o3', customer_id: 'c2', amount: 900, photo: 'img3', tags: null, due_on: '2026-01-01', closed_at: '2026-02-10T10:00:00.000Z' },
  ];
  const OBJ = {
    name: OBJECT,
    fields: {
      customer_id: { type: 'text' },
      amount: { type: 'number' },
      photo: { type: 'image' },
      tags: { type: 'multiselect', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
      due_on: { type: 'date' },
      closed_at: { type: 'datetime' },
      due_f: { type: 'formula', expression: 'due_on', returnType: 'date' },
    },
  };

  function makeRowDriver(rows: ReadonlyArray<Record<string, unknown>>, native: boolean) {
    const { driver, calls } = makeDriver();
    driver.find = async () => { calls.find += 1; return rows.map((r) => ({ ...r })); };
    if (native) driver.aggregate = async () => { calls.aggregate += 1; return []; };
    return { driver, calls };
  }

  const FILTER_SHAPES: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
    ['a text against an image', { customer_id: { $ne: { $field: 'photo' } } }, '"photo" (type "image")'],
    ['a number against a multiselect', { amount: { $ne: { $field: 'tags' } } }, '"tags" (type "multiselect")'],
    ['a datetime against a formula', { closed_at: { $lte: { $field: 'due_f' } } }, '"due_f" (type "formula")'],
  ];

  for (const [name, filter, named] of FILTER_SHAPES) {
    it(`the per-aggregation filter, ${name}: INVALID_FILTER / 400 on both driver kinds, empty and populated, grouped and ungrouped`, async () => {
      let message: string | undefined;
      const warnings: string[] = [];
      for (const native of [true, false]) {
        for (const rows of [[], ROWS]) {
          for (const groupBy of [undefined, ['customer_id']]) {
            const cell = `${native ? 'native-capable' : 'raw'}, ${rows.length ? 'populated' : 'empty'}, ${groupBy ? 'grouped' : 'ungrouped'}`;
            const { driver, calls } = makeRowDriver(rows, native);
            const engine = new ObjectQL();
            engine.registerDriver(driver, true);
            await engine.init();
            (engine.registry as any).registerObject(OBJ);
            (engine as any).logger.warn = (line: unknown) => { warnings.push(String(line)); };
            const out = await outcomeOf(() => engine.aggregate(OBJECT, {
              ...(groupBy ? { groupBy } : {}),
              ...perAggregation(filter),
            } as unknown as EngineAggregateOptions), () => []);
            expect(out, cell).toMatchObject({ refused: true, code: 'INVALID_FILTER', status: 400 });
            expect(calls, cell).toEqual({ aggregate: 0, find: 0 });
            message ??= out.message;
            expect(out.message, `${cell}: one filter, one answer`).toBe(message);
          }
        }
      }
      expect(message).toContain('`aggregations[1].filter`');
      expect(warnings).toHaveLength(8);
      for (const line of warnings) expect(line).toContain(named);
    });
  }

  it('having on an image groupBy against a count: INVALID_FILTER / 400 on both doors, empty and populated', async () => {
    for (const native of [true, false]) {
      for (const rows of [[], ROWS]) {
        const cell = `${native ? 'native' : 'in-memory'} door, ${rows.length ? 'populated' : 'empty'}`;
        const { driver, calls } = makeRowDriver(rows, native);
        const engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        (engine.registry as any).registerObject(OBJ);
        const out = await outcomeOf(() => engine.aggregate(OBJECT, {
          groupBy: ['photo'],
          aggregations: [{ function: 'count', alias: 'n' }],
          having: { photo: { $ne: { $field: 'n' } } },
        }), () => []);
        expect(out, cell).toMatchObject({ refused: true, code: 'INVALID_FILTER', status: 400 });
        expect(calls, cell).toEqual({ aggregate: 0, find: 0 });
        expect(out.message, cell).toContain('having.photo.$ne');
        expect(out.message, cell).toContain('the target field "photo" (type "image")');
      }
    }
  });

  it('…and an addDays pair against a formula, which was answered: refused too, as where refuses it before it reads the offset', async () => {
    const { engine, calls, warnings } = await makeEngine(OBJ);
    const out = await outcomeOf(
      () => engine.aggregate(OBJECT, perAggregation({ due_on: { $lte: { $field: 'due_f', addDays: 1 } } })),
      () => warnings,
    );
    expect(out).toMatchObject({ refused: true, code: 'INVALID_FILTER', status: 400 });
    expect(calls).toEqual({ aggregate: 0, find: 0 });
    expect(out.diagnostic).toContain('"due_f" (type "formula")');
  });

  it('…and at having, an addDays pair from a formula projection, which was answered: refused, naming the formula', async () => {
    const { engine, calls } = await makeEngine(OBJ);
    const out = await outcomeOf(() => engine.aggregate(OBJECT, {
      groupBy: ['due_f', { field: 'due_on', dateGranularity: 'day', alias: 'due_day' }],
      aggregations: [{ function: 'count', alias: 'n' }],
      having: { due_f: { $lte: { $field: 'due_day', addDays: 1 } } },
    } as unknown as EngineAggregateOptions), () => []);
    expect(out).toMatchObject({ refused: true, code: 'INVALID_FILTER', status: 400 });
    expect(calls).toEqual({ aggregate: 0, find: 0 });
    expect(out.message).toContain('the target field "due_f" (type "formula")');
    expect(out.message).toContain('{ "$field": "due_day" } with addDays');
  });

  it('the same-class control on the same object answers as before', async () => {
    const { engine } = await makeEngine(OBJ);
    expect(await engine.aggregate(OBJECT, perAggregation({ due_on: { $lte: { $field: 'due_on' } } }))).toEqual([{ n: 0, m: 0 }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The positions: a new filter slot, or a new published evaluator, is placed here
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every slot of the aggregate verb's declared request
 * (`EngineAggregateOptionsSchema`) that holds a filter condition, as a path —
 * each is a position a `{ $field }` reference can be written in.
 */
function filterConditionSlots(schema: unknown, path: string, out: string[], depth = 0): string[] {
  if (depth > 8 || schema == null) return out;
  if (schema === FilterConditionSchema) {
    out.push(path);
    return out;
  }
  const def = (schema as { def?: any }).def ?? (schema as { _zod?: { def?: any } })._zod?.def;
  switch (def?.type) {
    case 'optional': case 'nullable': case 'default': case 'prefault': case 'readonly': case 'nonoptional': case 'catch':
      return filterConditionSlots(def.innerType, path, out, depth + 1);
    case 'union':
      if ((def.options as unknown[]).some((option) => option === FilterConditionSchema)) out.push(path);
      return out;
    case 'object':
      for (const [key, value] of Object.entries(def.shape as Record<string, unknown>)) {
        filterConditionSlots(value, path ? `${path}.${key}` : key, out, depth + 1);
      }
      return out;
    case 'array':
      return filterConditionSlots(def.element, `${path}[i]`, out, depth + 1);
    default:
      return out;
  }
}

/** Where each filter slot's `{ $field }` reference is judged. */
const REQUEST_POSITIONS: Record<string, string> = {
  where: "driver-sql's cross-field compiler — the parity half is in packages/rest",
  having: 'assertHavingIsEvaluable (engine.aggregate), this file',
  'aggregations[i].filter': 'assertAggregationFilterIsEvaluable (engine.aggregate), this file',
};

/**
 * The published entries of the two modules that evaluate a per-aggregation
 * filter or a `having`, each placed: a position, or not one, with why.
 */
const PUBLISHED_EVALUATOR_EXPORTS: Record<string, string> = {
  applyInMemoryAggregation: 'a position — a host may call it with a field map, this file',
  bucketDateValue: 'not a position — it labels a date bucket and reads no filter',
};

describe('[#21299] the positions are enumerated, not remembered', () => {
  it('every filter slot of the aggregate verb\'s declared request is a placed position', () => {
    expect(AggregationNodeSchema).toBeDefined();
    const slots = filterConditionSlots(EngineAggregateOptionsSchema, '', []);
    expect(slots.sort()).toEqual(Object.keys(REQUEST_POSITIONS).sort());
  });

  it('every published entry of the evaluator modules is placed', () => {
    const published = new Set<string>();
    for (const entry of ['./index.ts', './core.ts']) {
      const source = readFileSync(new URL(entry, import.meta.url), 'utf8');
      for (const m of source.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/(?:in-memory-aggregation|having-filter)\.js'/g)) {
        for (const name of m[1].split(',')) {
          const exported = name.trim().split(/\s+as\s+/).pop()!.trim();
          if (exported && !exported.startsWith('type ')) published.add(exported);
        }
      }
    }
    expect([...published].sort()).toEqual(Object.keys(PUBLISHED_EVALUATOR_EXPORTS).sort());
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The recorded postures: no declaration, and the `multiple` seam at `having`
// ───────────────────────────────────────────────────────────────────────────

describe('[#21299] a side with no declaration is not judged, at every engine-side position (recorded, as #21255 pins)', () => {
  const PAIR = { f_text: { $ne: { $field: 'f_image' } } };

  it('a registry-less host: [#21516] the engine refuses the object; applyInMemoryAggregation, which reads no registry, answers as written', async () => {
    const { engine } = await makeEngine(null);
    // [#21516] An in-process verb refuses a name the registry does not resolve
    // with the data door's own `OBJECT_NOT_FOUND`, before the per-aggregation
    // filter or `having` is judged — no verdict is invented about the pair.
    for (const query of [
      perAggregation(PAIR),
      { groupBy: ['f_text', 'f_image'], aggregations: [{ function: 'count', alias: 'n' }], having: PAIR } as unknown as EngineAggregateOptions,
    ]) {
      await expect(engine.aggregate(OBJECT, query)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404 });
    }
    expect(applyInMemoryAggregation([{ f_text: 'a', f_image: 'b' }], perAggregation(PAIR) as never)).toEqual([{ n: 1, m: 1 }]);
  });

  it('an audit-opt-out object\'s row-carried created_at / updated_at against a file field: answered, as written', async () => {
    const { engine } = await makeEngine({ name: OBJECT, fields: REGISTRABLE, systemFields: { audit: false } });
    for (const column of ['created_at', 'updated_at']) {
      const filter = { [column]: { $ne: { $field: 'f_image' } } };
      expect(await engine.aggregate(OBJECT, perAggregation(filter)), column).toEqual([{ n: 0, m: 0 }]);
      expect(applyInMemoryAggregation([], perAggregation(filter) as never, undefined, REGISTRABLE), column).toEqual([{ n: 0, m: 0 }]);
    }
  });

  it('…the same pair on an object that keeps its audit columns is judged: no-class, refused before any read (the control)', async () => {
    const { engine, calls, warnings } = await makeEngine({ name: OBJECT, fields: REGISTRABLE });
    const out = await outcomeOf(() => engine.aggregate(OBJECT, perAggregation({ created_at: { $ne: { $field: 'f_image' } } })), () => warnings);
    expect(out).toMatchObject({ refused: true, code: 'INVALID_FILTER', status: 400 });
    expect(calls).toEqual({ aggregate: 0, find: 0 });
    expect(out.diagnostic).toContain('"f_image" (type "image")');
  });
});

describe('[#21299] the `multiple` seam at having is unreachable: no aggregated column holds a list', () => {
  // `having`'s column meta carries a type and no `multiple` flag, so a
  // `multiple: true` select / lookup projection would read as a scalar text.
  // It cannot exist: the doors below refuse it before `having` is read. A door
  // that admits one turns these rows red, and the seam must be placed then.
  const MULTI = {
    f_text: { type: 'text' },
    tags_select: { type: 'select', multiple: true, options: [{ label: 'A', value: 'a' }] },
    owners: { type: 'lookup', reference: 'sys_user', multiple: true },
    assignees: { type: 'user', multiple: true },
  };
  const HAVING = (column: string) => ({ [column]: { $ne: { $field: 'n' } } });
  const SHAPES: ReadonlyArray<readonly [string, (column: string) => Record<string, unknown>]> = [
    ['a groupBy on it', (column) => ({ groupBy: [column], aggregations: [{ function: 'count', alias: 'n' }], having: HAVING(column) })],
    ['min of it', (column) => ({ groupBy: ['f_text'], aggregations: [{ function: 'count', alias: 'n' }, { function: 'min', field: column, alias: 'x' }], having: HAVING('x') })],
    ['max of it', (column) => ({ groupBy: ['f_text'], aggregations: [{ function: 'count', alias: 'n' }, { function: 'max', field: column, alias: 'x' }], having: HAVING('x') })],
  ];

  for (const column of ['tags_select', 'owners', 'assignees']) {
    for (const [name, query] of SHAPES) {
      it(`${column} (multiple: true) — ${name}: INVALID_FIELD / 400 before having is read`, async () => {
        const { engine, calls } = await makeEngine({ name: OBJECT, fields: MULTI });
        const out = await outcomeOf(() => engine.aggregate(OBJECT, query(column) as unknown as EngineAggregateOptions), () => []);
        expect(out).toMatchObject({ refused: true, code: 'INVALID_FIELD', status: 400 });
        expect(out.message).toContain(column);
        expect(calls).toEqual({ aggregate: 0, find: 0 });
      });
    }
  }
});
