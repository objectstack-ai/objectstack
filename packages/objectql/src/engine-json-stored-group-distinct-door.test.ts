// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20808] Two more JSON-stored keys are refused `INVALID_FIELD` / 400 by
 * `engine.aggregate`, naming the field, its declared type and the position,
 * before any driver is asked:
 *
 * - a `groupBy` entry naming a MULTI-VALUE field (`isMultiValueField`: the
 *   inherently-multi option types, and a multi-capable type flagged
 *   `multiple: true`) — `group-by-structured-json-door.ts`, its second class;
 * - a `count_distinct` over a field the spec table's `count_distinct` row
 *   refuses (the structured-JSON class and the multi-option types), or over a
 *   multi-value field — `aggregate-field-type-door.ts` (the door that asks
 *   the whole table since #20914; its other rows are pinned in
 *   `engine-aggregate-field-type-door.test.ts`).
 *
 * Measured on the base (`origin/main` `42d78b97fe`) through
 * `POST /api/v1/data/:object/query` over three rows:
 *
 * | query | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `groupBy` a single-value `select` (the control) | 200, one group per value | same | same |
 * | `groupBy` any multi-value field (8 declarations) | 200, one group per array | 200, one group per serialized array | 500 `DATABASE_ERROR` |
 * | `count_distinct` a `text` (the control) | 2 | 2 | 2 |
 * | `count_distinct` any structured-JSON or multi-value field | 3 | 2 | 500 `DATABASE_ERROR` |
 *
 * The InMemoryDriver cell is this suite's recording driver by construction:
 * the doors answer before a driver is resolved, so no read runs. The SQL cells
 * over a real driver live in `@objectstack/rest`'s
 * `data-json-stored-group-distinct-door.test.ts`; that driver's test consumers
 * are a ruled, closed census (`check:driver-memory-census`), so no new suite
 * of it here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  FieldType,
  MULTI_CAPABLE_TYPES,
  isAggregateCompatibleWithFieldType,
  isMultiValueField,
  type EngineAggregateOptions,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { assertAggregationFieldTypesAccepted } from './aggregate-field-type-door.js';

const OBJECT = 'json_stored_key_probe';

const OPTIONS = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }];

/** field · declared type · `multiple: true` — every multi-value declaration the spec admits. */
const MULTIS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['tags', 'select', true],
  ['labels', 'tags', false],
  ['ms', 'multiselect', false],
  ['cb', 'checkboxes', false],
  ['refs', 'lookup', true],
  ['watchers', 'user', true],
  ['files', 'file', true],
  ['imgs', 'image', true],
];

/** field · declared type — one field of every structured-JSON type. */
const JSONS: ReadonlyArray<readonly [string, string]> = [
  ['meta', 'json'],
  ['spec', 'composite'],
  ['rep', 'repeater'],
  ['rec', 'record'],
  ['loc', 'location'],
  ['ship_to', 'address'],
  ['vec', 'vector'],
];

const PROBE = {
  name: OBJECT,
  label: 'JSON-stored key probe',
  fields: {
    title: { name: 'title', type: 'text' },
    amount: { name: 'amount', type: 'number' },
    status: { name: 'status', type: 'select', options: OPTIONS },
    owner: { name: 'owner', type: 'lookup', reference: 'json_stored_key_target' },
    photo: { name: 'photo', type: 'image' },
    ...Object.fromEntries(MULTIS.map(([name, type, multiple]) => [
      name,
      {
        name,
        type,
        ...(multiple ? { multiple: true } : {}),
        ...(type === 'select' || type === 'multiselect' || type === 'checkboxes' ? { options: OPTIONS } : {}),
        ...(type === 'lookup' ? { reference: 'json_stored_key_target' } : {}),
      },
    ])),
    ...Object.fromEntries(JSONS.map(([name, type]) => [name, { name, type }])),
  },
};

const COUNT = [{ function: 'count', alias: 'n' }] as EngineAggregateOptions['aggregations'];
const distinct = (field: string) =>
  [{ function: 'count_distinct', field, alias: 'n' }] as EngineAggregateOptions['aggregations'];

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

/** Each door's own words — a control must never be answered in them. */
const GROUP_WORDS = 'which the engine does not group by';
const DISTINCT_WORDS = 'which the engine does not count distinct';

const declaredOf = (type: string, multiple: boolean) => (multiple ? `${type} field with multiple: true` : `${type} field`);

describe('[#20808] a groupBy on a multi-value field, and a count_distinct on a JSON-stored field, at the engine\'s aggregate door', () => {
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

  it('refuses a groupBy on every multi-value declaration with INVALID_FIELD / 400, naming the field, its declaration, the position and the $contains route — no read', async () => {
    for (const [field, type, multiple] of MULTIS) {
      const err = await refusalOf(engine.aggregate(OBJECT, { groupBy: [field], aggregations: COUNT }));
      expect(envelopeOf(err), field).toEqual(ENVELOPE);
      expect({ field: err?.field, fields: err?.fields, object: err?.object, param: err?.param }, field)
        .toEqual({ field, fields: [field], object: OBJECT, param: 'groupBy' });
      expect(err!.message, field).toMatch(
        new RegExp(`^aggregate\\('${OBJECT}'\\): groupBy\\[0\\] names '${field}', a declared ${declaredOf(type, multiple)} — a multi-value field, ${GROUP_WORDS}`),
      );
      expect(err!.message, field).toContain('The query was NOT run.');
      expect(err!.message, field).toContain(`where { "${field}": { "$contains": VALUE } }`);
    }
    expect(reads, 'every refusal precedes the driver').toHaveLength(0);
  });

  it('judges the { field } object form, and names the first offending position across both classes', async () => {
    const cases: ReadonlyArray<readonly [EngineAggregateOptions['groupBy'], string, string[]]> = [
      [[{ field: 'tags' }], 'groupBy[0].field', ['tags']],
      [['title', 'labels'], 'groupBy[1]', ['labels']],
      [['refs', 'meta'], 'groupBy[0]', ['refs', 'meta']],
      [['meta', 'refs'], 'groupBy[0]', ['meta', 'refs']],
    ] as ReadonlyArray<readonly [EngineAggregateOptions['groupBy'], string, string[]]>;
    for (const [groupBy, position, fields] of cases) {
      const label = JSON.stringify(groupBy);
      const err = await refusalOf(engine.aggregate(OBJECT, { groupBy, aggregations: COUNT }));
      expect(envelopeOf(err), label).toEqual(ENVELOPE);
      expect(err?.fields, label).toEqual(fields);
      expect(err!.message, label).toContain(`): ${position} names '${fields[0]}',`);
    }
    expect(reads).toHaveLength(0);
  });

  it('refuses a count_distinct on every structured-JSON type and every multi-value declaration, at aggregations[i].field — no read', async () => {
    const all: ReadonlyArray<readonly [string, string, boolean, boolean]> = [
      ...JSONS.map(([f, t]) => [f, t, false, false] as const),
      ...MULTIS.map(([f, t, m]) => [f, t, m, true] as const),
    ];
    for (const [field, type, multiple, multiValue] of all) {
      const err = await refusalOf(engine.aggregate(OBJECT, { aggregations: distinct(field) }));
      expect(envelopeOf(err), field).toEqual(ENVELOPE);
      expect({ field: err?.field, fields: err?.fields, object: err?.object, param: err?.param }, field)
        .toEqual({ field, fields: [field], object: OBJECT, param: 'aggregations' });
      const kind = multiValue ? 'a multi-value field' : 'a structured-JSON value';
      expect(err!.message, field).toMatch(
        new RegExp(`^aggregate\\('${OBJECT}'\\): aggregations\\[0\\]\\.field counts distinct '${field}', a declared ${declaredOf(type, multiple)} — ${kind}, ${DISTINCT_WORDS}`),
      );
      expect(err!.message, field).toContain('The query was NOT run.');
    }
    // A later aggregation, and two offenders: the first position is named.
    const err = await refusalOf(engine.aggregate(OBJECT, {
      groupBy: ['status'],
      aggregations: [
        { function: 'count', alias: 'n' },
        { function: 'count_distinct', field: 'title', alias: 'titles' },
        { function: 'count_distinct', field: 'ship_to', alias: 'a' },
        { function: 'count_distinct', field: 'tags', alias: 'b' },
      ],
    } as EngineAggregateOptions));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err?.fields).toEqual(['ship_to', 'tags']);
    expect(err!.message).toContain("): aggregations[2].field counts distinct 'ship_to',");
    expect(reads, 'every refusal precedes the driver').toHaveLength(0);
  });

  it('CONTROL scalar group keys and scalar distinct counts reach the driver, never these refusals', async () => {
    const shapes: ReadonlyArray<readonly [string, EngineAggregateOptions]> = [
      ...['title', 'amount', 'status', 'owner', 'photo', 'not_declared'].map((f) =>
        [`groupBy ${f}`, { groupBy: [f], aggregations: COUNT }] as const),
      ...['title', 'amount', 'status', 'owner', 'photo', 'not_declared'].map((f) =>
        [`count_distinct ${f}`, { aggregations: distinct(f) }] as const),
      // `count` compares no value, so a JSON-stored column is countable.
      ...['meta', 'tags', 'labels'].map((f) =>
        [`count ${f}`, { aggregations: [{ function: 'count', field: f, alias: 'n' }] }] as const),
      // The route the multi-value refusal names: filter by one member.
      ['count where tags $contains', { where: { tags: { $contains: 'a' } }, aggregations: COUNT }],
    ] as ReadonlyArray<readonly [string, EngineAggregateOptions]>;
    for (const [label, query] of shapes) {
      const before = reads.length;
      const out = await engine.aggregate(OBJECT, query).then(() => null, (e: Error) => e.message);
      expect(out ?? '', label).not.toContain(GROUP_WORDS);
      expect(out ?? '', label).not.toContain(DISTINCT_WORDS);
      expect(reads.length - before, `${label}: the driver was asked`).toBe(1);
    }
  });

  it('the REST door into findData answers the same refusals — no read', async () => {
    const protocol = new ObjectStackProtocolImplementation(engine);
    const grouped = await refusalOf(protocol.findData({
      object: OBJECT,
      query: { groupBy: ['tags'], aggregations: COUNT },
    } as any));
    expect(envelopeOf(grouped)).toEqual(ENVELOPE);
    expect(grouped!.message).toContain(`groupBy[0] names 'tags', a declared select field with multiple: true`);
    const counted = await refusalOf(protocol.findData({
      object: OBJECT,
      query: { aggregations: distinct('meta') },
    } as any));
    expect(envelopeOf(counted)).toEqual(ENVELOPE);
    expect(counted!.message).toContain(`aggregations[0].field counts distinct 'meta', a declared json field`);
    expect(reads).toHaveLength(0);
  });

  it('GUARD the count_distinct door asks the spec table for every FieldType, and isMultiValueField for every flagged multi-capable type', () => {
    const judged = (def: Record<string, unknown>) => {
      try {
        assertAggregationFieldTypesAccepted(OBJECT, { fields: { f: def } }, distinct('f'));
        return null;
      } catch (e) {
        return envelopeOf(e as Thrown);
      }
    };
    let refused = 0;
    for (const type of FieldType.options) {
      const tableRefuses = !isAggregateCompatibleWithFieldType('count_distinct', type);
      expect(judged({ type }), type).toEqual(tableRefuses || isMultiValueField({ type }) ? ENVELOPE : null);
      if (tableRefuses) refused += 1;
    }
    // Floor: the row refuses the JSON-stored ten, so the equality above is not vacuous.
    expect(refused).toBe(10);
    for (const type of MULTI_CAPABLE_TYPES) {
      expect(judged({ type, multiple: true }), `${type} + multiple`).toEqual(ENVELOPE);
    }
  });

  it('GUARD no verdict without a field map, for an undeclared name, an off-vocabulary type, or a row that accepts the pair', () => {
    const judge = (schema: unknown, aggregations: unknown) => () => assertAggregationFieldTypesAccepted(OBJECT, schema, aggregations);
    expect(judge(undefined, distinct('meta'))).not.toThrow();
    expect(judge({}, distinct('meta'))).not.toThrow();
    expect(judge(PROBE, distinct('nope'))).not.toThrow();
    // A driver-internal alias on an introspected object: the table cannot answer, so no block.
    expect(judge({ fields: { f: { type: 'object' } } }, distinct('f'))).not.toThrow();
    expect(judge({ fields: { f: { type: 'integer' } } }, distinct('f'))).not.toThrow();
    // `count` compares no value, so its row accepts a JSON-stored field; `sum`
    // is the row the #20914 census held back for triage.
    for (const fn of ['count', 'sum']) {
      expect(judge(PROBE, [{ function: fn, field: 'meta', alias: 'n' }]), fn).not.toThrow();
    }
    // [#20914] Flipped: the door asks every row now, and the `avg`, `min` and
    // `max` rows refuse a `json` field — the same envelope, at the same position.
    for (const fn of ['avg', 'min', 'max']) {
      let thrown: Thrown = null;
      try { judge(PROBE, [{ function: fn, field: 'meta', alias: 'n' }])(); } catch (e) { thrown = e as Thrown; }
      expect(envelopeOf(thrown), fn).toEqual(ENVELOPE);
      expect(thrown?.message, fn).toContain(`aggregations[0].field `);
      expect(thrown?.message, fn).toContain(`'meta', a declared json field — a structured-JSON value, which the engine does not `);
    }
    expect(judge(PROBE, [{ function: 'count_distinct', alias: 'n' }, { function: 'count_distinct', field: '*' }, null, 7])).not.toThrow();
    expect(judge(PROBE, 'meta')).not.toThrow();
    expect(judge(PROBE, [])).not.toThrow();
  });
});
