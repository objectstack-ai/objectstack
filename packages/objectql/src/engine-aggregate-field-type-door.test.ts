// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20914] `engine.aggregate` asks the aggregate × field-type table for EVERY
 * aggregation that names a declared field, not only for `count_distinct`: a
 * pair the table refuses answers `INVALID_FIELD` / 400, naming the position,
 * the function, the field and its declared type, before any driver is asked.
 *
 * Measured on the base (`origin/main` `dfe5a0863`) through `engine.aggregate`
 * over two rows:
 *
 * | aggregation | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `max` / `min` over a `json` field | 200, a document | 200, a string | 500 `DATABASE_ERROR` |
 * | `max` / `min` over a `tags` field, or a `select` with `multiple: true` | 200, an array | 200, a serialized array | 500 `DATABASE_ERROR` |
 * | `avg` over a `datetime` field | 200, `null` | 200, `2026` | 500 `DATABASE_ERROR` |
 * | `max` over a `number`, `min` over a `datetime`, `avg` over a `percent` (controls) | one answer | the same | the same |
 *
 * …and the `sum` row, released after one landing held it for triage's census
 * answer, measured on `origin/main` `2821e9f15` the same way:
 *
 * | aggregation | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `sum` over a `json`, `text`, `select` or `tags` field | 200, `0` | 200, `0` | 500 `DATABASE_ERROR` |
 * | `sum` over a `formula` field | 200, `0` | 400 `INVALID_FIELD` (no column) | the same |
 * | `sum` over a `number`, `currency` or `boolean` (controls) | one answer | the same | the same |
 *
 * The InMemoryDriver cell is this suite's recording driver by construction:
 * the door answers before a driver is resolved, so no read runs. The SQL cells
 * over a real driver live in `@objectstack/rest`'s
 * `data-aggregate-field-type-door.test.ts`; that driver's test consumers are a
 * ruled, closed census (`check:driver-memory-census`), so no new suite of it
 * here. The `count_distinct` row keeps its own pins, unchanged, in
 * `engine-json-stored-group-distinct-door.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  FieldType,
  MULTI_CAPABLE_TYPES,
  isAggregateCompatibleWithFieldType,
  isMultiValueField,
  type EngineAggregateOptions,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { assertAggregationFieldTypesAccepted } from './aggregate-field-type-door.js';

const OBJECT = 'aggregate_type_probe';

const OPTIONS = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }];

const PROBE = {
  name: OBJECT,
  label: 'Aggregate field-type probe',
  fields: {
    title: { name: 'title', type: 'text' },
    amount: { name: 'amount', type: 'number' },
    price: { name: 'price', type: 'currency' },
    pct: { name: 'pct', type: 'percent' },
    due: { name: 'due', type: 'datetime' },
    flag: { name: 'flag', type: 'boolean' },
    status: { name: 'status', type: 'select', options: OPTIONS },
    meta: { name: 'meta', type: 'json' },
    labels: { name: 'labels', type: 'tags' },
    picks: { name: 'picks', type: 'select', multiple: true, options: OPTIONS },
    owners: { name: 'owners', type: 'lookup', multiple: true, reference: 'aggregate_type_target' },
    ship_to: { name: 'ship_to', type: 'address' },
    expected: { name: 'expected', type: 'formula', expression: 'record.amount * 2' },
  },
};

const agg = (fn: string, field?: string) =>
  [{ function: fn, ...(field === undefined ? {} : { field }), alias: 'v' }] as EngineAggregateOptions['aggregations'];

interface SeenRead { ast: any }

/** Minimal recording driver — the same witness shape as the sibling door suites. */
function makeRecordingDriver() {
  const rows = new Map<string, Record<string, unknown>>();
  const reads: SeenRead[] = [];
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
      const up = { ...(rows.get(id) ?? {}), ...data, id }; rows.set(id, up); return up;
    },
    async delete(_o: string, id: string) { return rows.delete(id); },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads };
}

type Thrown = (Error & {
  code?: string; status?: number; httpStatus?: number; field?: string; fields?: string[]; object?: string; param?: string;
}) | null;

const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);

const ENVELOPE = { code: 'INVALID_FIELD', status: 400, httpStatus: 400 };
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status, httpStatus: err?.httpStatus });

/** The function's words in the refusal — a control must never be answered in them. */
const DOES_NOT = { min: 'does not take the min of', max: 'does not take the max of', avg: 'does not average', sum: 'does not sum' } as const;
const DOES = { min: 'takes the min of', max: 'takes the max of', avg: 'averages', sum: 'sums' } as const;
const ACCEPTS_MIN_MAX = 'accepts a field of type number, currency, percent, rating, slider, progress, summary, '
  + 'date, datetime, time, boolean or toggle: aggregate a field of one of those types, or count the rows with count.';
const ACCEPTS_SUM = 'accepts a field of type number, currency, rating, slider, progress, summary, boolean or toggle: '
  + 'aggregate a field of one of those types, or count the rows with count.';

describe('[#20914] the engine\'s aggregate door asks the aggregate × field-type table for every row', () => {
  let engine: ObjectQL;
  let reads: SeenRead[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    reads = rec.reads;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(PROBE as any, 'test');
    reads.length = 0;
  });

  it('refuses max / min over a json field and over a tags field with INVALID_FIELD / 400, naming the position, the function, the field, its declaration and the accepted types — no read', async () => {
    const cases: ReadonlyArray<readonly ['min' | 'max', string, string]> = [
      ['max', 'meta', 'json field — a structured-JSON value'],
      ['min', 'meta', 'json field — a structured-JSON value'],
      ['max', 'labels', 'tags field — a multi-value field'],
      ['min', 'labels', 'tags field — a multi-value field'],
      ['max', 'picks', 'select field with multiple: true — a multi-value field'],
      ['min', 'ship_to', 'address field — a structured-JSON value'],
    ];
    for (const [fn, field, declared] of cases) {
      const label = `${fn}(${field})`;
      const err = await refusalOf(engine.aggregate(OBJECT, { aggregations: agg(fn, field) }));
      expect(envelopeOf(err), label).toEqual(ENVELOPE);
      expect({ field: err?.field, fields: err?.fields, object: err?.object, param: err?.param }, label)
        .toEqual({ field, fields: [field], object: OBJECT, param: 'aggregations' });
      expect(err!.message, label).toMatch(new RegExp(
        `^aggregate\\('${OBJECT}'\\): aggregations\\[0\\]\\.field ${DOES[fn]} '${field}', a declared ${declared}, which the engine ${DOES_NOT[fn]}\\. The query was NOT run\\.`,
      ));
      expect(err!.message, label).toContain(`${fn} ${ACCEPTS_MIN_MAX}`);
    }
    expect(reads, 'every refusal precedes the driver').toHaveLength(0);
  });

  it('refuses max over a multi-valued lookup under a groupBy — the shape measured as 500 on PostgreSQL, the serialized text on SQLite and the array in memory — no read', async () => {
    const query = { groupBy: ['title'], aggregations: [{ function: 'max', field: 'owners', alias: 'm' }] } as EngineAggregateOptions;
    const err = await refusalOf(engine.aggregate(OBJECT, query));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect({ field: err?.field, fields: err?.fields, param: err?.param })
      .toEqual({ field: 'owners', fields: ['owners'], param: 'aggregations' });
    expect(err!.message).toMatch(new RegExp(
      `^aggregate\\('${OBJECT}'\\): aggregations\\[0\\]\\.field takes the max of 'owners', a declared lookup field with multiple: true — a multi-value field, which the engine does not take the max of\\. The query was NOT run\\.`,
    ));
    expect(err!.message).toContain(`max ${ACCEPTS_MIN_MAX}`);
    expect(reads, 'the refusal precedes the driver').toHaveLength(0);
  });

  it('refuses the other refused pairs of the judged rows the same way — avg over a datetime, max over a text (the string-class row as ruled)', async () => {
    const cases: ReadonlyArray<readonly ['min' | 'max' | 'avg', string, string]> = [
      ['avg', 'due', 'datetime field'],
      ['avg', 'meta', 'json field — a structured-JSON value'],
      ['max', 'title', 'text field'],
      ['min', 'status', 'select field'],
    ];
    for (const [fn, field, declared] of cases) {
      const label = `${fn}(${field})`;
      const err = await refusalOf(engine.aggregate(OBJECT, { aggregations: agg(fn, field) }));
      expect(envelopeOf(err), label).toEqual(ENVELOPE);
      expect(err!.message, label).toContain(
        `aggregations[0].field ${DOES[fn]} '${field}', a declared ${declared}, which the engine ${DOES_NOT[fn]}. The query was NOT run.`,
      );
    }
    expect(reads).toHaveLength(0);
  });

  it('refuses sum over a json, text, select, formula, tags, percent and datetime field, and a select with multiple: true — the row the census held, released — with INVALID_FIELD / 400 naming the accepted types — no read', async () => {
    // Flipped from the CONTROL below, where `sum meta` and `sum title` reached
    // the driver while the row was held: in memory they answered `0`.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['meta', 'json field — a structured-JSON value'],
      ['title', 'text field'],
      ['status', 'select field'],
      ['expected', 'formula field'],
      ['labels', 'tags field — a multi-value field'],
      ['pct', 'percent field'],
      ['due', 'datetime field'],
      ['picks', 'select field with multiple: true — a multi-value field'],
    ];
    for (const [field, declared] of cases) {
      const label = `sum(${field})`;
      const err = await refusalOf(engine.aggregate(OBJECT, { aggregations: agg('sum', field) }));
      expect(envelopeOf(err), label).toEqual(ENVELOPE);
      expect({ field: err?.field, fields: err?.fields, object: err?.object, param: err?.param }, label)
        .toEqual({ field, fields: [field], object: OBJECT, param: 'aggregations' });
      expect(err!.message, label).toMatch(new RegExp(
        `^aggregate\\('${OBJECT}'\\): aggregations\\[0\\]\\.field sums '${field}', a declared ${declared}, which the engine does not sum\\. The query was NOT run\\.`,
      ));
      expect(err!.message, label).toContain(`sum ${ACCEPTS_SUM}`);
    }
    expect(reads, 'every refusal precedes the driver').toHaveLength(0);
  });

  it('names the first offending position across functions, and lists every offender', async () => {
    const err = await refusalOf(engine.aggregate(OBJECT, {
      groupBy: ['status'],
      aggregations: [
        { function: 'count', alias: 'n' },
        { function: 'max', field: 'amount', alias: 'top' },
        { function: 'max', field: 'meta', alias: 'a' },
        { function: 'count_distinct', field: 'picks', alias: 'b' },
        { function: 'min', field: 'labels', alias: 'c' },
      ],
    } as EngineAggregateOptions));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err?.fields).toEqual(['meta', 'picks', 'labels']);
    expect(err!.message).toContain("): aggregations[2].field takes the max of 'meta',");
    expect(err!.message).toContain("(also: 'picks', 'labels')");
    expect(reads).toHaveLength(0);
  });

  it('CONTROL a pair the table accepts reaches the driver, never this refusal — sum over a number, a currency and a boolean included', async () => {
    const shapes: ReadonlyArray<readonly [string, EngineAggregateOptions]> = [
      ['max amount', { aggregations: agg('max', 'amount') }],
      ['min due', { aggregations: agg('min', 'due') }],
      ['avg pct', { aggregations: agg('avg', 'pct') }],
      ['max flag', { aggregations: agg('max', 'flag') }],
      ['sum amount', { aggregations: agg('sum', 'amount') }],
      ['sum price', { aggregations: agg('sum', 'price') }],
      ['sum flag', { aggregations: agg('sum', 'flag') }],
      // `count` compares no value, so a JSON-stored column is countable.
      ['count meta', { aggregations: agg('count', 'meta') }],
      ['count picks', { aggregations: agg('count', 'picks') }],
      ['grouped max amount', { groupBy: ['status'], aggregations: agg('max', 'amount') }],
    ];
    for (const [label, query] of shapes) {
      const before = reads.length;
      const out = await engine.aggregate(OBJECT, query).then(() => null, (e: Error) => e.message);
      for (const words of Object.values(DOES_NOT)) expect(out ?? '', label).not.toContain(`which the engine ${words}`);
      expect(reads.length - before, `${label}: the driver was asked`).toBe(1);
    }
  });

  it('the REST door into findData answers the same refusal — no read', async () => {
    const protocol = new ObjectStackProtocolImplementation(engine);
    const err = await refusalOf(protocol.findData({
      object: OBJECT,
      query: { aggregations: agg('max', 'meta') },
    } as any));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err!.message).toContain("aggregations[0].field takes the max of 'meta', a declared json field");
    expect(reads).toHaveLength(0);
  });

  it('GUARD the door asks the spec table for every row × every FieldType, and the declaration half for every flagged multi-capable type — no row held', () => {
    const judged = (fn: string, def: Record<string, unknown>) => {
      try {
        assertAggregationFieldTypesAccepted(OBJECT, { fields: { f: def } }, agg(fn, 'f'));
        return null;
      } catch (e) {
        return envelopeOf(e as Thrown);
      }
    };
    const refusedPerRow: Record<string, number> = {};
    // Every row of the table, read off the table: a row the door skipped would
    // answer null where the table refuses, and turn this red.
    const rows = Object.keys(AGGREGATE_FIELD_TYPE_COMPATIBILITY);
    expect([...rows].sort()).toEqual(['avg', 'count', 'count_distinct', 'max', 'min', 'sum']);
    for (const fn of rows) {
      // A row that refuses any type-level multi-value type refuses the declaration too.
      const rowRefusesMulti = !isAggregateCompatibleWithFieldType(fn, 'tags');
      refusedPerRow[fn] = 0;
      for (const type of FieldType.options) {
        const tableRefuses = !isAggregateCompatibleWithFieldType(fn, type);
        const expected = tableRefuses || (rowRefusesMulti && isMultiValueField({ type }));
        expect(judged(fn, { type }), `${fn} × ${type}`).toEqual(expected ? ENVELOPE : null);
        if (tableRefuses) refusedPerRow[fn] += 1;
      }
      for (const type of MULTI_CAPABLE_TYPES) {
        const tableRefuses = !isAggregateCompatibleWithFieldType(fn, type);
        expect(judged(fn, { type, multiple: true }), `${fn} × ${type} + multiple`)
          .toEqual(tableRefuses || rowRefusesMulti ? ENVELOPE : null);
      }
    }
    // Floors, read off the table, so the equalities above are not vacuous.
    const refusedByTable = (fn: keyof typeof AGGREGATE_FIELD_TYPE_COMPATIBILITY) =>
      FieldType.options.length - AGGREGATE_FIELD_TYPE_COMPATIBILITY[fn].length;
    expect(refusedPerRow).toEqual({
      count: 0,
      count_distinct: refusedByTable('count_distinct'),
      sum: refusedByTable('sum'),
      avg: refusedByTable('avg'),
      min: refusedByTable('min'),
      max: refusedByTable('max'),
    });
    expect(refusedPerRow.max).toBeGreaterThan(30);
    expect(refusedPerRow.sum).toBeGreaterThan(30);
  });

  it('GUARD no verdict without a field map, for an undeclared name or a path, an off-vocabulary type, a fieldless aggregation or an off-vocabulary function', () => {
    const judge = (schema: unknown, aggregations: unknown) => () => assertAggregationFieldTypesAccepted(OBJECT, schema, aggregations);
    for (const fn of ['max', 'min', 'avg', 'sum', 'count_distinct']) {
      expect(judge(undefined, agg(fn, 'meta')), fn).not.toThrow();
      expect(judge({}, agg(fn, 'meta')), fn).not.toThrow();
      expect(judge(PROBE, agg(fn, 'nope')), fn).not.toThrow();
      expect(judge(PROBE, agg(fn, 'owner.meta')), fn).not.toThrow();
      // A driver-internal alias on an introspected object: the table cannot answer, so no block.
      expect(judge({ fields: { f: { type: 'object' } } }, agg(fn, 'f')), fn).not.toThrow();
      expect(judge({ fields: { f: { type: 'string' } } }, agg(fn, 'f')), fn).not.toThrow();
      expect(judge({ fields: { f: {} } }, agg(fn, 'f')), fn).not.toThrow();
      expect(judge(PROBE, [{ function: fn, alias: 'v' }, { function: fn, field: '*' }, null, 7]), fn).not.toThrow();
    }
    expect(judge(PROBE, agg('median', 'meta'))).not.toThrow();
    expect(judge(PROBE, agg('toString', 'meta'))).not.toThrow();
    expect(judge(PROBE, [{ function: ['max'], field: 'meta' }])).not.toThrow();
    expect(judge(PROBE, 'meta')).not.toThrow();
    expect(judge(PROBE, [])).not.toThrow();
  });
});
