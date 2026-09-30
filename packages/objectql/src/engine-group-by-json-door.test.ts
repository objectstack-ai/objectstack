// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20783] A `groupBy` entry naming a STRUCTURED-JSON field (`json`,
 * `composite`, `repeater`, `record`, `location`, `address`, `vector`) is
 * refused `INVALID_FIELD` / 400 by `engine.aggregate`, naming the field, its
 * declared type and the position, before any driver is asked
 * (`group-by-structured-json-door.ts`).
 *
 * Measured on the base (`origin/main` `7a09eee1b1`) through
 * `POST /api/v1/data/:object/query`, `{ groupBy: [FIELD], aggregations:
 * [{ function: 'count', alias: 'n' }] }` over three rows:
 *
 * | `groupBy` | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `text` (the control) | 200, one group per value | same | same |
 * | `json`, and its `composite`, `repeater`, `record`, `location`, `address` twins | 200, one group holding every row | 200, one group per serialized document | 500 `DATABASE_ERROR` |
 * | `vector` | 200, one group per array | 200, one group per serialized array | 500 |
 * | `{ field: 'meta', dateGranularity: 'month' }` (json) | 200, one `null` bucket | 200, one `null` bucket | 500 |
 *
 * The InMemoryDriver cell is this suite's recording driver by construction:
 * the door answers before a driver is resolved, so no read runs. The SQL cells
 * over a real driver live in `@objectstack/rest`'s
 * `data-group-by-json-door.test.ts`; that driver's test consumers are a ruled,
 * closed census (`check:driver-memory-census`), so no new suite of it here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { FieldType, STRUCTURED_JSON_TYPES, type EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { assertGroupByNamesNoStructuredJsonField } from './group-by-structured-json-door.js';

const OBJECT = 'group_by_json_probe';

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
  label: 'Group-by JSON probe',
  fields: {
    title: { name: 'title', type: 'text' },
    amount: { name: 'amount', type: 'number' },
    tags: { name: 'tags', type: 'select', multiple: true, options: [{ label: 'A', value: 'a' }] },
    photo: { name: 'photo', type: 'image' },
    ...Object.fromEntries(JSONS.map(([name, type]) => [name, { name, type }])),
  },
};

const COUNT = [{ function: 'count', alias: 'n' }] as EngineAggregateOptions['aggregations'];

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

/** The door's own words, in every refusal it raises — a control must never be answered in them. */
const DOOR_WORDS = 'which the engine does not group by';

describe('[#20783] a groupBy on a structured-JSON field, at the engine\'s aggregate door', () => {
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

  it('refuses a groupBy on every structured-JSON type with INVALID_FIELD / 400, naming the field, its type and the position — no read', async () => {
    for (const [field, type] of JSONS) {
      const err = await refusalOf(engine.aggregate(OBJECT, { groupBy: [field], aggregations: COUNT }));
      expect(envelopeOf(err), field).toEqual(ENVELOPE);
      expect({ field: err?.field, fields: err?.fields, object: err?.object, param: err?.param }, field)
        .toEqual({ field, fields: [field], object: OBJECT, param: 'groupBy' });
      expect(err!.message, field).toMatch(
        new RegExp(`^aggregate\\('${OBJECT}'\\): groupBy\\[0\\] names '${field}', a declared ${type} field `),
      );
      expect(err!.message, field).toContain('The query was NOT run.');
    }
    expect(reads, 'every refusal precedes the driver').toHaveLength(0);
  });

  it('refuses the { field } object form, a date bucket over it, and an entry after a scalar one, at the entry\'s own position — no read', async () => {
    const cases: ReadonlyArray<readonly [EngineAggregateOptions['groupBy'], string, string[]]> = [
      [[{ field: 'meta' }], 'groupBy[0].field', ['meta']],
      [[{ field: 'meta', dateGranularity: 'month' }], 'groupBy[0].field', ['meta']],
      [['title', 'ship_to'], 'groupBy[1]', ['ship_to']],
      [['meta', 'title', { field: 'loc' }], 'groupBy[0]', ['meta', 'loc']],
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

  it('CONTROL a text, number, multi-value select, file or undeclared groupBy reaches the driver, never this refusal', async () => {
    for (const field of ['title', 'amount', 'tags', 'photo', 'not_declared']) {
      const before = reads.length;
      const out = await engine.aggregate(OBJECT, { groupBy: [field], aggregations: COUNT }).then(
        () => null,
        (e: Error) => e.message,
      );
      expect(out ?? '', field).not.toContain(DOOR_WORDS);
      expect(reads.length - before, `${field}: the driver was asked`).toBe(1);
    }
    // A structured-JSON field as an AGGREGATED column is not this door's.
    await expect(engine.aggregate(OBJECT, {
      groupBy: ['title'],
      aggregations: [{ function: 'count', field: 'meta', alias: 'n' }],
    } as EngineAggregateOptions)).resolves.toBeDefined();
  });

  it('the REST door into findData answers the same refusal — no read', async () => {
    const protocol = new ObjectStackProtocolImplementation(engine);
    const err = await refusalOf(protocol.findData({
      object: OBJECT,
      query: { groupBy: ['meta'], aggregations: COUNT },
    } as any));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err!.message).toContain(`groupBy[0] names 'meta', a declared json field`);
    expect(reads).toHaveLength(0);
  });

  it('GUARD the judged types are exactly the spec\'s STRUCTURED_JSON_TYPES, over every FieldType', () => {
    for (const type of FieldType.options) {
      const thrown = (() => {
        try {
          assertGroupByNamesNoStructuredJsonField(OBJECT, { fields: { f: { type } } }, ['f']);
          return null;
        } catch (e) {
          return e as Thrown;
        }
      })();
      expect(thrown === null ? null : envelopeOf(thrown), type)
        .toEqual(STRUCTURED_JSON_TYPES.has(type) ? ENVELOPE : null);
    }
  });

  it('GUARD no verdict without a field map, for an undeclared name, or for an entry that names no field', () => {
    const judge = (schema: unknown, groupBy: unknown) => () => assertGroupByNamesNoStructuredJsonField(OBJECT, schema, groupBy);
    expect(judge(undefined, ['meta'])).not.toThrow();
    expect(judge({}, ['meta'])).not.toThrow();
    expect(judge(PROBE, ['nope', { field: 'nope' }, { dateGranularity: 'month' }, 7, null])).not.toThrow();
    expect(judge(PROBE, 'meta')).not.toThrow();
    expect(judge(PROBE, [])).not.toThrow();
  });
});
