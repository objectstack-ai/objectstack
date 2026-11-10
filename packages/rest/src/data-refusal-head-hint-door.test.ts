// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32279] The data door answers a long spec refusal as a one-line head, with
 * the whole prescription beside it as a hint — over the real routes, a real
 * `SqlDriver`, the real engine and protocol.
 *
 * Before this card the retired-key, retired-aggregation and filter-comparand
 * refusals reached a caller at 300–1,300 characters (#32169 item 2b, measured
 * on a live showcase): the spec's author-facing prescription, which a toast
 * cannot show.
 *
 * - `POST /api/v1/data/:object/query`: `400 VALIDATION_FAILED`, each
 *   `fields[]` entry's `message` is the head and `hint` the prescription
 *   (`FieldErrorSchema.hint`).
 * - `GET /api/v1/data/:object?filter=`: `400 INVALID_FILTER`, `error` is the
 *   head and `details.hint` the text the door answered before.
 *
 * Status and code are what they were; the same requests are refused. A
 * refusal with no head (retired `windowFunctions`, outside the card's list;
 * the comparand-type face's object comparand) answers exactly as before, with
 * no hint (CONTROL).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { QUERY_CURSOR_REMOVED, QUERY_DISTINCT_REMOVED } from '@objectstack/spec/data';
import { REFUSAL_HEAD_MAX } from '@objectstack/spec/api';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_refusal_head_32279';

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

describe('[#32279] long data-door refusals answer a head and a hint — sqlite', () => {
  let engine: ObjectQL;
  let driver: any;
  const reads = { n: 0 };
  let query: (body: unknown) => Promise<{ status: number; body: any }>;
  let list: (q: Record<string, string>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Refusal head 32279',
      fields: {
        title: { name: 'title', type: 'text' as const },
        amount: { name: 'amount', type: 'number' as const },
      },
    } as any);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    await engine.insert(OBJECT, { id: 'r1', title: 'a', amount: 1 } as any);

    for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const real = driver[verb].bind(driver);
      driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
    }

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const routes = rest.getRoutes();
    const queryRoute = routes.find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
    const getRoute = routes.find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object');
    expect(queryRoute, 'POST /api/v1/data/:object/query').toBeDefined();
    expect(getRoute, 'GET /api/v1/data/:object').toBeDefined();
    query = async (body) => {
      const res = makeRes();
      await queryRoute!.handler({ params: { object: OBJECT }, body, query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
    list = async (q) => {
      const res = makeRes();
      await getRoute!.handler({ params: { object: OBJECT }, query: q, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  /**
   * Each listed `POST /query` refusal: the request, the `fields[]` entry it
   * answers (field and code, byte-equal to before this card), the refused key
   * or shape the head must name, and a sentence of the prescription the hint
   * must still carry. The prescription lengths are the #32169 measurements.
   */
  const QUERY_CASES: ReadonlyArray<{
    name: string;
    body: Record<string, unknown>;
    field: string;
    code: string;
    names: string;
    prescription: string;
    hintLength?: number;
  }> = [
    {
      name: 'aggregations[].function: array_agg',
      body: { aggregations: [{ function: 'array_agg', field: 'title', alias: 'a' }] },
      field: 'query.aggregations.0.function', code: 'invalid_option', names: '`array_agg`',
      prescription: 'Delete the aggregation, or the dataset measure that declared it.', hintLength: 1021,
    },
    {
      name: 'aggregations[].function: string_agg',
      body: { aggregations: [{ function: 'string_agg', field: 'title', alias: 'a' }] },
      field: 'query.aggregations.0.function', code: 'invalid_option', names: '`string_agg`',
      prescription: 'Its dialect divergence is the widest of the family', hintLength: 1249,
    },
    {
      name: 'aggregations[].distinct',
      body: { aggregations: [{ function: 'sum', field: 'amount', alias: 'a', distinct: true }] },
      field: 'query.aggregations.0.distinct', code: 'invalid_type', names: '`query.aggregations[].distinct`',
      prescription: 'exactly ONE of the six faces that read an aggregation honoured it', hintLength: 1078,
    },
    {
      name: 'joins',
      body: { joins: [{ object: 'x' }] },
      field: 'query.joins', code: 'invalid_type', names: '`query.joins`',
      prescription: 'Related records are read through `expand`', hintLength: 763,
    },
    {
      name: 'cursor',
      body: { cursor: { id: 'r1' } },
      field: 'query.cursor', code: 'invalid_type', names: '`query.cursor`',
      prescription: 'a caller looping "until hasMore is false" never terminates', hintLength: 623,
    },
    {
      name: 'distinct',
      body: { distinct: true },
      field: 'query.distinct', code: 'invalid_type', names: '`query.distinct`',
      prescription: 'silently degraded', hintLength: 644,
    },
    {
      name: 'where.title.$in: a scalar',
      body: { where: { title: { $in: 'x' } } },
      field: 'query.where.title.$in', code: 'invalid_value', names: 'Operator "$in" on field "title"',
      prescription: 'Authoring spellings: in.', hintLength: 314,
    },
    {
      name: 'where.title.$eq: an array',
      body: { where: { title: { $eq: ['a', 'b'] } } },
      field: 'query.where.title.$eq', code: 'invalid_value', names: 'Operator "$eq" on field "title"',
      prescription: 'requires a single comparable value, but received an array', hintLength: 391,
    },
  ];

  for (const c of QUERY_CASES) {
    it(`POST /query ${c.name}: fields[].message is the head, fields[].hint the prescription`, async () => {
      const before = reads.n;
      const res = await query(c.body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.fields).toHaveLength(1);
      const [entry] = res.body.fields;
      expect({ field: entry.field, code: entry.code }).toEqual({ field: c.field, code: c.code });
      expect(entry.message.length, entry.message).toBeLessThanOrEqual(REFUSAL_HEAD_MAX);
      expect(entry.message).not.toContain('\n');
      expect(entry.message).toContain(c.names);
      expect(entry.hint).toContain(c.prescription);
      if (c.hintLength !== undefined) expect(entry.hint).toHaveLength(c.hintLength);
      expect(reads.n - before, 'refused before any read').toBe(0);
    });
  }

  it('POST /query: the hint is the prescription the spec declares, byte for byte', async () => {
    const cursor = await query({ cursor: { id: 'r1' } });
    expect(cursor.body.fields[0].hint).toBe(QUERY_CURSOR_REMOVED);
    const distinct = await query({ distinct: true });
    expect(distinct.body.fields[0].hint).toBe(QUERY_DISTINCT_REMOVED);
  });

  it('CONTROL — a refusal outside the card\'s list (retired `windowFunctions`) answers its whole prescription as before, with no hint', async () => {
    const res = await query({ windowFunctions: [] });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.fields).toHaveLength(1);
    expect(res.body.fields[0].message).toContain('`query.windowFunctions` was removed');
    expect(res.body.fields[0].message.length).toBeGreaterThan(REFUSAL_HEAD_MAX);
    expect(res.body.fields[0]).not.toHaveProperty('hint');
  });

  /**
   * The `GET ?filter=` refusals: the head the door answers in `error` (led by
   * the engine's `find('…'):` context, which fits the bound here), and a
   * sentence of the prescription `details.hint` must still carry.
   */
  const FILTER_CASES: ReadonlyArray<{ name: string; filter: unknown; names: string; prescription: string }> = [
    {
      name: '$in: a scalar', filter: { title: { $in: 'x' } },
      names: 'Operator "$in" on field "title"', prescription: 'at where.title.$in',
    },
    {
      name: '$gt: an array', filter: { amount: { $gt: [1, 2] } },
      names: 'Operator "$gt" on field "amount"', prescription: 'requires a single comparable value, but received an array',
    },
    {
      name: '$between: one bound', filter: { amount: { $between: [1] } },
      names: 'Operator "$between" on field "amount"', prescription: 'A range needs exactly two bounds',
    },
    {
      name: '$eq: an array', filter: { title: { $eq: ['a', 'b'] } },
      names: 'Operator "$eq" on field "title"', prescription: 'For "one of these values" use {"$in": […]}',
    },
  ];

  for (const c of FILTER_CASES) {
    it(`GET ?filter= ${c.name}: error is the head, details.hint the prescription`, async () => {
      const before = reads.n;
      const res = await list({ filter: JSON.stringify(c.filter) });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.code).toBe('INVALID_FILTER');
      expect(res.body.error.length, res.body.error).toBeLessThanOrEqual(REFUSAL_HEAD_MAX);
      expect(res.body.error).not.toContain('\n');
      expect(res.body.error).toContain(c.names);
      expect(res.body.error.startsWith(`find('${OBJECT}'): `), res.body.error).toBe(true);
      expect(res.body.details?.hint).toContain(c.prescription);
      expect(res.body.details.hint).toContain('The filter was NOT applied');
      expect(reads.n - before, 'refused before any read').toBe(0);
    });
  }

  it('CONTROL — a filter refusal with no head (the comparand-type face) answers as before, with no hint', async () => {
    const res = await list({ filter: JSON.stringify({ title: { $eq: { a: 1 } } }) });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('INVALID_FILTER');
    expect(res.body).not.toHaveProperty('details');
  });
});
