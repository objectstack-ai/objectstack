// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25818] `engine.aggregate` refuses, before any driver is asked:
 *
 * - a `dateGranularity` over a field declared neither a date nor a datetime
 *   (`INVALID_FIELD` / 400, `path: groupBy.N.dateGranularity`);
 * - two columns of the aggregated row under one name — a repeated aggregation
 *   alias, an alias equal to a group column, two group entries projecting one
 *   column (`INVALID_QUERY` / 400, `path` at the second position).
 *
 * The measured base answers are in `aggregate-query-shape-door.ts`'s header.
 * The recording driver holds three rows and has no `aggregate`, so a served
 * query runs the engine's in-memory aggregation over them: the controls below
 * read real buckets, and a refusal is proven to precede every read.
 *
 * [#25819] The REST door's empty-list refusal is the protocol's own
 * (`protocol.empty-aggregate-axis.test.ts`); the wire half below runs it over
 * the real engine, which is what turned it into `404 OBJECT_NOT_FOUND`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { mapDataError } from '@objectstack/types';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const OBJECT = 'agg_shape_probe';

const PROBE = {
  name: OBJECT,
  label: 'Aggregate shape probe',
  fields: {
    name: { name: 'name', type: 'text' },
    status: { name: 'status', type: 'select', options: [{ label: 'Open', value: 'open' }, { label: 'Won', value: 'won' }] },
    amount: { name: 'amount', type: 'number' },
    active: { name: 'active', type: 'boolean' },
    at_time: { name: 'at_time', type: 'time' },
    opened_on: { name: 'opened_on', type: 'date' },
    seen_at: { name: 'seen_at', type: 'datetime' },
    doubled: { name: 'doubled', type: 'formula', expression: 'amount * 2' },
  },
};

const ROWS = [
  { id: '1', name: 'a', status: 'open', amount: 10, opened_on: '2026-01-05', seen_at: '2026-01-05T10:00:00Z' },
  { id: '2', name: 'b', status: 'open', amount: 20, opened_on: '2026-02-05', seen_at: '2026-02-05T10:00:00Z' },
  { id: '3', name: 'c', status: 'won', amount: 30, opened_on: '2026-02-07', seen_at: '2026-02-07T10:00:00Z' },
];

const COUNT = { function: 'count', alias: 'n' } as const;

/** A recording driver with no `aggregate`: the engine aggregates its `find` rows in memory. */
function makeRecordingDriver() {
  const reads: unknown[] = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: unknown) { reads.push(ast); return ROWS.map((r) => ({ ...r })); },
    async findOne(_o: string, ast: unknown) { reads.push(ast); return { ...ROWS[0] }; },
    async count(_o: string, ast: unknown) { reads.push(ast); return ROWS.length; },
    async create(_o: string, data: Record<string, unknown>) { return data; },
    async update(_o: string, _id: string, data: Record<string, unknown>) { return data; },
    async delete() { return true; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads };
}

type Thrown = (Error & {
  code?: string; status?: number; httpStatus?: number;
  field?: string; fields?: string[]; object?: string; param?: string; path?: string;
}) | null;

const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status, httpStatus: err?.httpStatus });

describe('[#25818] the aggregate query shapes that answered a plausible wrong table', () => {
  let engine: ObjectQL;
  let reads: unknown[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    reads = rec.reads;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(PROBE as any, 'test');
    reads.length = 0;
  });

  const aggregate = (q: Record<string, unknown>) => engine.aggregate(OBJECT, q as EngineAggregateOptions);

  it('refuses a dateGranularity over a text, select, number, boolean or time field: INVALID_FIELD / 400 at groupBy.N.dateGranularity — no read', async () => {
    for (const [field, type] of [['name', 'text'], ['status', 'select'], ['amount', 'number'], ['active', 'boolean'], ['at_time', 'time']]) {
      const err = await refusalOf(aggregate({
        groupBy: ['status', { field, dateGranularity: 'month' }],
        aggregations: [COUNT],
      }));
      expect(envelopeOf(err), field).toEqual({ code: 'INVALID_FIELD', status: 400, httpStatus: 400 });
      expect({ path: err?.path, param: err?.param, field: err?.field, object: err?.object }, field)
        .toEqual({ path: 'groupBy.1.dateGranularity', param: 'groupBy', field, object: OBJECT });
      expect(err!.message, field).toContain(`groupBy.1.dateGranularity buckets '${field}' by 'month', but '${field}' is a declared ${type} field`);
    }
    expect(reads, 'every refusal precedes the driver').toHaveLength(0);
  });

  it('refuses a repeated aggregation alias: INVALID_QUERY / 400 at the second aggregations.N.alias — no read', async () => {
    const err = await refusalOf(aggregate({
      aggregations: [COUNT, { function: 'sum', field: 'amount', alias: 'n' }],
    }));
    expect(envelopeOf(err)).toEqual({ code: 'INVALID_QUERY', status: 400, httpStatus: 400 });
    expect({ path: err?.path, param: err?.param, fields: err?.fields, object: err?.object })
      .toEqual({ path: 'aggregations.1.alias', param: 'aggregations', fields: ['n'], object: OBJECT });
    expect(err!.message).toContain("aggregations.1.alias names the column 'n', which aggregations.0.alias already names");
    expect(reads).toHaveLength(0);
  });

  it('refuses an aggregation alias equal to a group column — the field name, or the entry\'s own alias — no read', async () => {
    const cases: ReadonlyArray<readonly [unknown[], string, string]> = [
      [['status'], 'status', 'groupBy.0'],
      [[{ field: 'status' }], 'status', 'groupBy.0.field'],
      [[{ field: 'status', alias: 's' }], 's', 'groupBy.0.alias'],
      [['name', { field: 'opened_on', dateGranularity: 'month' }], 'opened_on', 'groupBy.1.field'],
    ];
    for (const [groupBy, alias, first] of cases) {
      const label = JSON.stringify(groupBy);
      const err = await refusalOf(aggregate({ groupBy, aggregations: [{ function: 'count', alias }] }));
      expect(envelopeOf(err), label).toEqual({ code: 'INVALID_QUERY', status: 400, httpStatus: 400 });
      expect({ path: err?.path, param: err?.param }, label).toEqual({ path: 'aggregations.0.alias', param: 'aggregations' });
      expect(err!.message, label).toContain(`aggregations.0.alias names the column '${alias}', which ${first} already names`);
    }
    expect(reads).toHaveLength(0);
  });

  it('refuses two group entries projecting one column, at the second entry — no read', async () => {
    const err = await refusalOf(aggregate({
      groupBy: [{ field: 'opened_on', dateGranularity: 'month' }, { field: 'opened_on', dateGranularity: 'year' }],
      aggregations: [COUNT],
    }));
    expect(envelopeOf(err)).toEqual({ code: 'INVALID_QUERY', status: 400, httpStatus: 400 });
    expect({ path: err?.path, param: err?.param }).toEqual({ path: 'groupBy.1.field', param: 'groupBy' });
    expect(reads).toHaveLength(0);
  });

  it('CONTROL a date or datetime bucket, a formula or undeclared bucket, and distinct columns are served', async () => {
    await expect(aggregate({ groupBy: [{ field: 'opened_on', dateGranularity: 'month' }], aggregations: [COUNT] }))
      .resolves.toEqual([{ opened_on: '2026-01', n: 1 }, { opened_on: '2026-02', n: 2 }]);
    await expect(aggregate({ groupBy: [{ field: 'seen_at', dateGranularity: 'month' }], aggregations: [COUNT] }))
      .resolves.toEqual([{ seen_at: '2026-01', n: 1 }, { seen_at: '2026-02', n: 2 }]);
    // The declaration cannot type a formula or an undeclared column: no verdict.
    await expect(aggregate({ groupBy: [{ field: 'doubled', dateGranularity: 'month' }], aggregations: [COUNT] })).resolves.toBeDefined();
    await expect(aggregate({ groupBy: [{ field: 'created_at', dateGranularity: 'month' }], aggregations: [COUNT] })).resolves.toBeDefined();
    // An alias moves the group column, so the field's own name is free.
    await expect(aggregate({ groupBy: [{ field: 'status', alias: 's' }], aggregations: [{ function: 'count', alias: 'status' }] }))
      .resolves.toEqual([{ s: 'open', status: 2 }, { s: 'won', status: 1 }]);
    // Two buckets of one field, each under its own alias.
    await expect(aggregate({
      groupBy: [{ field: 'opened_on', dateGranularity: 'year', alias: 'y' }, { field: 'opened_on', dateGranularity: 'month', alias: 'm' }],
      aggregations: [COUNT, { function: 'sum', field: 'amount', alias: 'total' }],
    })).resolves.toEqual([{ y: '2026', m: '2026-01', n: 1, total: 10 }, { y: '2026', m: '2026-02', n: 2, total: 50 }]);
    expect(reads, "each served query read once").toHaveLength(6);
  });

  it('the REST door answers the engine\'s refusal, not a 200 — through findData and the wire mapping', async () => {
    const protocol = new ObjectStackProtocolImplementation(engine);
    const bodies: ReadonlyArray<readonly [Record<string, unknown>, string, string]> = [
      [{ groupBy: [{ field: 'name', dateGranularity: 'month' }], aggregations: [COUNT] }, 'INVALID_FIELD', 'groupBy.0.dateGranularity'],
      [{ aggregations: [COUNT, { function: 'sum', field: 'amount', alias: 'n' }] }, 'INVALID_QUERY', 'aggregations.1.alias'],
      [{ groupBy: ['status'], aggregations: [{ function: 'count', alias: 'status' }] }, 'INVALID_QUERY', 'aggregations.0.alias'],
    ];
    for (const [query, code, path] of bodies) {
      const label = JSON.stringify(query);
      const err = await refusalOf(protocol.findData({ object: OBJECT, query } as any));
      expect({ code: err?.code, status: err?.status, path: err?.path }, label).toEqual({ code, status: 400, path });
      const wire = mapDataError(err, OBJECT);
      expect({ status: wire.status, code: wire.body.code }, label).toEqual({ status: 400, code });
      expect(String(wire.body.error), label).toContain(path);
    }
    expect(reads).toHaveLength(0);
  });

  it('[#25819] an empty aggregations list answers 400 INVALID_QUERY on the wire, never 404 OBJECT_NOT_FOUND for a registered object', async () => {
    const protocol = new ObjectStackProtocolImplementation(engine);
    for (const query of [{ aggregations: [] }, { aggregations: [], where: { status: 'open' } }]) {
      const err = await refusalOf(protocol.findData({ object: OBJECT, query } as any));
      const wire = mapDataError(err, OBJECT);
      expect({ status: wire.status, code: wire.body.code }, JSON.stringify(query)).toEqual({ status: 400, code: 'INVALID_QUERY' });
      expect(String(wire.body.error)).toContain("'query.aggregations' is an empty list");
    }
    expect(reads).toHaveLength(0);
  });
});
