// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20546] A plain object with no `$`-operator key where a scalar column's
 * value belongs — `{ amount: { a: 1 } }` over a declared `number` field — is
 * refused `INVALID_FILTER` / 400, naming the field and the path, by the
 * no-operator-object arm of the number-comparand door's walk, at every
 * position the engine judges: `where` (object form and `FilterArray` sugar, on
 * every verb and the judge), `aggregations[i].filter` and `having`.
 *
 * Measured on the base (`origin/main` `fbec216e2d`) through `engine.find` /
 * `engine.aggregate` and `POST /api/v1/data/:object/query`, three rows:
 *
 * | position · filter | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `where` `{ amount: { a: 1 } }`, `{ title: { a: 1 } }` and the other scalar classes | 200, no rows | 400, the driver's words | 400, the driver's words |
 * | `where` `{ $not: { amount: { a: 1 } } }` | 200, every row | 400 | 400 |
 * | `aggregations[1].filter` `{ amount: { a: 1 } }` | count 0 | count 0 | count 0 |
 * | `having` `{ total: { a: 1 } }` | no group | no group | no group |
 *
 * The InMemoryDriver cell is this suite's recording driver by construction:
 * the arm answers before any driver is resolved, so no read runs. The SQL
 * cells — SQLite always, PostgreSQL and MySQL where their URLs are set — and
 * the two controls over a real driver live in `@objectstack/rest`'s
 * `data-no-operator-object-door.test.ts`.
 *
 * The two controls triage named here — a relation field's nested relation
 * filter and a JSON-typed field's object comparand — were judged by the same
 * arm in #20745, in words of their own (`engine-nested-object-door.test.ts`
 * pins them). What stays accepted is a file or media field (the #8371
 * carve-out), which reaches the driver exactly as written.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  FieldType,
  FILE_REFERENCE_TYPES,
  MULTI_OPTION_TYPES,
  REFERENCE_VALUE_TYPES,
  SCALAR_FILTER_HEAD_TYPES,
  STRUCTURED_JSON_TYPES,
  type EngineAggregateOptions,
  type EngineQueryOptions,
  type FilterCondition,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { holdsScalarValues, isNoOperatorObject } from './no-operator-object-door.js';

const OBJECT = 'no_op_object_probe';
const OWNER = 'no_op_object_owner';

const OPTIONS = [{ label: 'X', value: 'x' }, { label: 'Y', value: 'y' }];

const PROBE = {
  name: OBJECT,
  label: 'No-operator object probe',
  fields: {
    amount: { name: 'amount', type: 'number' },
    price: { name: 'price', type: 'currency' },
    title: { name: 'title', type: 'text' },
    kind: { name: 'kind', type: 'select', options: OPTIONS },
    kinds: { name: 'kinds', type: 'select', multiple: true, options: OPTIONS },
    labels: { name: 'labels', type: 'multiselect', options: OPTIONS },
    flag: { name: 'flag', type: 'boolean' },
    placed_on: { name: 'placed_on', type: 'date' },
    seen_at: { name: 'seen_at', type: 'datetime' },
    code: { name: 'code', type: 'autonumber' },
    // Judged by #20745 in their own words (`engine-nested-object-door.test.ts`);
    // only the file field is still the accepted side.
    owner: { name: 'owner', type: 'lookup', reference: OWNER },
    owners: { name: 'owners', type: 'lookup', reference: OWNER, multiple: true },
    boss: { name: 'boss', type: 'master_detail', reference: OWNER },
    meta: { name: 'meta', type: 'json' },
    ship_to: { name: 'ship_to', type: 'address' },
    photo: { name: 'photo', type: 'image' },
  },
};

const OWNER_OBJECT = { name: OWNER, label: 'Owner', fields: { region: { name: 'region', type: 'text' } } };

/** name · a scalar-valued field · its declared type. */
const JUDGED: ReadonlyArray<readonly [string, string]> = [
  ['amount', 'number'],
  ['price', 'currency'],
  ['title', 'text'],
  ['kind', 'select'],
  ['kinds', 'select'],
  ['labels', 'multiselect'],
  ['flag', 'boolean'],
  ['placed_on', 'date'],
  ['seen_at', 'datetime'],
  ['code', 'autonumber'],
];

/** name · a field on the accepted side · the no-operator object it may carry. */
const ACCEPTED: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['photo', { url: 'x' }],
];

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
  return { driver, reads, writes };
}

type Thrown = (Error & { code?: string; status?: number; httpStatus?: number }) | null;

const refusalOf = async (p: Promise<unknown>): Promise<Thrown> =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

const ENVELOPE = { code: 'INVALID_FILTER', status: 400 };

const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status });

describe('[#20546] a no-operator object where a scalar column\'s value belongs, at the engine collection point', () => {
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
    engine.registry.registerObject(OWNER_OBJECT as any, 'test');
    engine.registry.registerObject(PROBE as any, 'test');
    reads.length = 0;
    writes.length = 0;
  });

  // ── where ────────────────────────────────────────────────────────────────

  it('refuses it under every scalar-valued field with the ADR-0112 envelope, naming the field, its type and the path — no read', async () => {
    for (const [field, type] of JUDGED) {
      const err = await refusalOf(engine.find(OBJECT, { where: { [field]: { a: 1 } } as FilterCondition }));
      expect(envelopeOf(err), field).toEqual(ENVELOPE);
      expect(err!.httpStatus, field).toBe(400);
      expect(err!.message, field).toMatch(/^find\('no_op_object_probe'\): /);
      expect(err!.message, field).toContain(`filter on '${field}'`);
      expect(err!.message, field).toContain(`at where.${field},`);
      expect(err!.message, field).toContain(`the declared ${type} field '${field}'`);
      expect(err!.message, field).toContain('keys "a"');
      expect(err!.message, field).toContain('NOT applied');
    }
    expect(reads).toHaveLength(0);
  });

  it('refuses {} and a deeper object too, and names each by its keys, never its values', async () => {
    const empty = await refusalOf(engine.find(OBJECT, { where: { amount: {} } as FilterCondition }));
    expect(envelopeOf(empty)).toEqual(ENVELOPE);
    expect(empty!.message).toContain('puts an empty object {} at where.amount,');
    const deep = await refusalOf(engine.find(OBJECT, { where: { title: { a: { secret: 'value' } } } as FilterCondition }));
    expect(envelopeOf(deep)).toEqual(ENVELOPE);
    expect(deep!.message).toContain('keys "a"');
    expect(deep!.message).not.toContain('value"');
    expect(reads).toHaveLength(0);
  });

  it('covers every engine verb that collects a filter — read and write sides — and the judge', async () => {
    const where = { amount: { a: 1 } } as FilterCondition;
    for (const call of [
      () => engine.find(OBJECT, { where }),
      () => engine.findOne(OBJECT, { where }),
      () => engine.count(OBJECT, { where }),
      () => engine.aggregate(OBJECT, { where, aggregations: [{ function: 'count', alias: 'n' }] } as EngineAggregateOptions),
      () => engine.update(OBJECT, { title: 'x' }, { where, multi: true }),
      () => engine.delete(OBJECT, { where, multi: true }),
    ]) {
      const err = await refusalOf(call());
      expect(envelopeOf(err)).toEqual(ENVELOPE);
      expect(err!.message).toContain('at where.amount,');
    }
    const judged = engine.judgeFilter(OBJECT, where);
    expect(judged).toMatchObject({ ok: false, ...ENVELOPE });
    expect((judged as { message: string }).message).toContain("filter on 'amount'");
    expect(reads).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('reaches inside $and / $or / $not, with the path each arm sits at — structure launders nothing', async () => {
    const cases: ReadonlyArray<readonly [FilterCondition, string]> = [
      [{ $and: [{ title: 'a' }, { amount: { a: 1 } }] }, 'where.$and[1].amount'],
      [{ $or: [{ amount: { a: 1 } }, { amount: 30 }] }, 'where.$or[0].amount'],
      // Memory answered EVERY row for this one on the base.
      [{ $not: { amount: { a: 1 } } }, 'where.$not.amount'],
    ];
    for (const [where, path] of cases) {
      const err = await refusalOf(engine.find(OBJECT, { where }));
      expect(envelopeOf(err), path).toEqual(ENVELOPE);
      expect(err!.message, path).toContain(`at ${path},`);
    }
    expect(reads).toHaveLength(0);
  });

  it('answers the same mistake arriving as FilterArray sugar — one answer per mistake, not per spelling', async () => {
    // The cast names the contract being bypassed: `FilterArray` is INPUT-ONLY
    // sugar `EngineQueryOptions.where` deliberately excludes.
    const err = await refusalOf(
      engine.find(OBJECT, { where: [['amount', '=', { a: 1 }]] } as unknown as EngineQueryOptions),
    );
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err!.message).toContain('at where.amount,');
    expect(reads).toHaveLength(0);
  });

  it('CONTROL the accepted side reaches the driver exactly as written: a file field', async () => {
    for (const [field, spec] of ACCEPTED) {
      reads.length = 0;
      const where = { [field]: spec } as FilterCondition;
      await expect(engine.find(OBJECT, { where }), field).resolves.toBeDefined();
      expect(reads, field).toHaveLength(1);
      expect(reads[0]?.ast?.where, field).toEqual(where);
    }
    expect(engine.judgeFilter(OBJECT, { photo: { url: 'x' } })).toEqual({ ok: true });
  });

  it('CONTROL an operator bag, a { $field } reference and a scalar comparand are not this arm\'s', async () => {
    for (const where of [
      { amount: { $gt: 5 } },
      { amount: 5, title: 'a' },
      { amount: { $gt: { $field: 'price' } } },
      { kinds: { $in: ['x'] } },
      { labels: 'x' },
      { placed_on: { $gte: '2026-01-01' } },
    ] as FilterCondition[]) {
      reads.length = 0;
      await expect(engine.find(OBJECT, { where }), JSON.stringify(where)).resolves.toBeDefined();
      expect(reads, JSON.stringify(where)).toHaveLength(1);
    }
  });

  it('CONTROL a Map is a comparand, not structure — the comparand-type door refuses it in its own words', async () => {
    const err = await refusalOf(engine.find(OBJECT, { where: { title: new Map() } as unknown as FilterCondition }));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err!.message).not.toContain('no operator key');
  });

  it('GUARD an UNKNOWN field keeps the engine\'s registry-less tolerance — no second opinion about a name', async () => {
    await expect(engine.find(OBJECT, { where: { not_a_field: { a: 1 } } as FilterCondition })).resolves.toBeDefined();
    expect(reads).toHaveLength(1);
  });

  // ── the per-aggregation `filter` and `having` ────────────────────────────

  it('refuses it in ONE aggregation\'s own filter, rooted at that position — no read', async () => {
    for (const [field, type] of [['amount', 'number'], ['title', 'text']] as const) {
      reads.length = 0;
      const err = await refusalOf(engine.aggregate(OBJECT, {
        aggregations: [
          { function: 'count', alias: 'all' },
          { function: 'count', alias: 'bad', filter: { [field]: { a: 1 } } },
        ],
      } as EngineAggregateOptions));
      expect(envelopeOf(err), field).toEqual(ENVELOPE);
      expect(err!.message, field).toMatch(/^aggregate\('no_op_object_probe'\): /);
      expect(err!.message, field).toContain(`at aggregations[1].filter.${field},`);
      expect(err!.message, field).toContain(`the declared ${type} field '${field}'`);
      expect(reads, field).toHaveLength(0);
    }
  });

  it('refuses it in having over a column holding scalar values, naming the aggregated column — no read', async () => {
    const cases: ReadonlyArray<readonly [EngineAggregateOptions, string, string]> = [
      [{ groupBy: ['title'], aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }], having: { total: { a: 1 } } }, 'total', 'number'],
      [{ groupBy: ['title'], aggregations: [{ function: 'count', alias: 'n' }], having: { title: { a: 1 } } }, 'title', 'text'],
      [{ groupBy: ['title'], aggregations: [{ function: 'max', field: 'placed_on', alias: 'last' }], having: { last: {} } }, 'last', 'date'],
      [{ groupBy: [{ field: 'placed_on', dateGranularity: 'month', alias: 'month' }], aggregations: [{ function: 'count', alias: 'n' }], having: { month: { a: 1 } } }, 'month', 'text'],
    ] as ReadonlyArray<readonly [EngineAggregateOptions, string, string]>;
    for (const [query, column, type] of cases) {
      reads.length = 0;
      const err = await refusalOf(engine.aggregate(OBJECT, query));
      expect(envelopeOf(err), column).toEqual(ENVELOPE);
      expect(err!.message, column).toContain(`at having.${column},`);
      expect(err!.message, column).toContain(`the aggregated column '${column}', which carries a ${type} value`);
      expect(reads, column).toHaveLength(0);
    }
  });

  it('CONTROL the accepted side stays accepted in the per-aggregation filter and in having', async () => {
    await expect(engine.aggregate(OBJECT, {
      aggregations: [
        { function: 'count', alias: 'all' },
        { function: 'count', alias: 'p', filter: { photo: { url: 'x' } } },
      ],
    } as EngineAggregateOptions)).resolves.toBeDefined();
    await expect(engine.aggregate(OBJECT, {
      groupBy: ['photo'],
      aggregations: [{ function: 'count', alias: 'n' }],
      having: { photo: { url: 'x' } },
    } as EngineAggregateOptions)).resolves.toBeDefined();
  });

  // ── the REST doors that reach findData ──────────────────────────────────

  describe('the REST doors — one answer however the query arrived', () => {
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
      protocol = new ObjectStackProtocolImplementation(engine);
    });

    const DOORS: ReadonlyArray<{ door: string; query: Record<string, unknown> }> = [
      { door: 'where object', query: { where: { amount: { a: 1 } } } },
      { door: '$filter string', query: { $filter: JSON.stringify({ amount: { a: 1 } }) } },
      { door: 'filter AST', query: { filter: [['amount', '=', { a: 1 }]] } },
    ];

    it.each(DOORS)('the $door door refuses it', async ({ query }) => {
      const err = await refusalOf(protocol.findData({ object: OBJECT, query } as any));
      expect(envelopeOf(err)).toEqual(ENVELOPE);
      expect(err!.message).toContain("filter on 'amount'");
      expect(reads).toHaveLength(0);
    });
  });

  // ── the classification ───────────────────────────────────────────────────

  it('GUARD the judged columns are the spec\'s scalar-valued classes, and the accepted side is never judged', () => {
    for (const type of FieldType.options) {
      const expected = SCALAR_FILTER_HEAD_TYPES.has(type) || MULTI_OPTION_TYPES.has(type);
      expect(holdsScalarValues(type), type).toBe(expected);
    }
    for (const type of [...REFERENCE_VALUE_TYPES, ...STRUCTURED_JSON_TYPES, ...FILE_REFERENCE_TYPES, 'formula']) {
      expect(holdsScalarValues(type), type).toBe(false);
    }
    expect(holdsScalarValues('not_a_type')).toBe(false);
  });

  it('GUARD structure is a PLAIN object with no $ key — a Date, an array, a Map, a class instance and an operator bag are not', () => {
    expect(isNoOperatorObject({ a: 1 })).toBe(true);
    expect(isNoOperatorObject({})).toBe(true);
    expect(isNoOperatorObject(Object.create(null))).toBe(true);
    for (const value of [new Date(0), [1], new Map(), new (class Box {})(), { $gt: 1 }, { a: 1, $eq: 2 }, { $field: 'x' }, null, 'a', 1]) {
      expect(isNoOperatorObject(value), String(value)).toBe(false);
    }
  });
});
