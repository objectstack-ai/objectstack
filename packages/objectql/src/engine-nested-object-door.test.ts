// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20745] A plain object with no `$`-operator key beneath a RELATION field
 * (`lookup`, `master_detail`, `user`, `tree`, single or multiple) or a
 * STRUCTURED-JSON field (`json`, `composite`, `address`, …), or beneath a
 * platform-provisioned column the declared map omits (`id`), is refused
 * `INVALID_FILTER` / 400 in the engine's words by the no-operator-object arm
 * of the number-comparand door's walk — the arm #20546 opened for scalar
 * columns, extended — at every position the engine judges: `where` (object
 * form and `FilterArray` sugar, on every verb and the judge),
 * `aggregations[i].filter` and `having`.
 *
 * Measured on the base (`origin/main` `a51920f5fb`) through
 * `POST /api/v1/data/:object/query`, three rows (owner `u1`, region NA, on
 * `d1` and `d3`):
 *
 * | position · filter | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `where` `{ owner: { region: 'NA' } }` (lookup; master-detail, multiple lookup, user, tree alike) | 200, no rows | 400, the driver's words | 400, the driver's words |
 * | `where` `{ meta: { a: 1 } }` (json; address, composite alike) | 200, the deep-equal rows | 400 | 400 |
 * | `where` `{ id: { a: 1 } }` | 200, no rows | 400 | 400 |
 * | `aggregations[1].filter` `{ owner: { region: 'NA' } }` | count 0 | count 0 | count 0 |
 * | `having` `{ owner: { region: 'NA' } }` over a lookup groupBy | no group | no group | no group |
 *
 * The InMemoryDriver cell is this suite's recording driver by construction:
 * the arm answers before any driver is resolved, so no read runs. The SQL
 * cells and the named routes over a real driver live in `@objectstack/rest`'s
 * `data-nested-object-door.test.ts`. The routes on InMemoryDriver were
 * measured (`d1`, `d3` for `$in` on a lookup and `$contains` on a multiple
 * lookup) and are not pinned in a new suite: that driver's test consumers are
 * a ruled, closed census (`check:driver-memory-census`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  FieldType,
  FILE_REFERENCE_TYPES,
  REFERENCE_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
  type EngineAggregateOptions,
  type EngineQueryOptions,
  type FilterCondition,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import {
  holdsScalarValues,
  noOperatorObjectColumnKind,
  provisionedNoOperatorObjectColumn,
} from './no-operator-object-door.js';

const OBJECT = 'nested_object_probe';
const OWNER = 'nested_object_owner';

const PROBE = {
  name: OBJECT,
  label: 'Nested object probe',
  fields: {
    title: { name: 'title', type: 'text' },
    amount: { name: 'amount', type: 'number' },
    owner: { name: 'owner', type: 'lookup', reference: OWNER },
    owners: { name: 'owners', type: 'lookup', reference: OWNER, multiple: true },
    boss: { name: 'boss', type: 'master_detail', reference: OWNER },
    assignee: { name: 'assignee', type: 'user' },
    parent: { name: 'parent', type: 'tree', reference: OBJECT },
    meta: { name: 'meta', type: 'json' },
    ship_to: { name: 'ship_to', type: 'address' },
    spec: { name: 'spec', type: 'composite' },
    // Never judged: the #8371 file carve-out.
    photo: { name: 'photo', type: 'image' },
  },
};

const OWNER_OBJECT = { name: OWNER, label: 'Owner', fields: { region: { name: 'region', type: 'text' } } };

/** field · declared type · the related object the words name · whether the route is `$contains`. */
const RELATIONS: ReadonlyArray<readonly [string, string, string, boolean]> = [
  ['owner', 'lookup', OWNER, false],
  ['owners', 'lookup', OWNER, true],
  ['boss', 'master_detail', OWNER, false],
  ['assignee', 'user', 'sys_user', false],
  ['parent', 'tree', OBJECT, false],
];

/** field · declared type — structured-JSON columns. */
const JSONS: ReadonlyArray<readonly [string, string]> = [
  ['meta', 'json'],
  ['ship_to', 'address'],
  ['spec', 'composite'],
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

describe('[#20745] a no-operator object beneath a relation, structured-JSON or provisioned column, at the engine collection point', () => {
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

  it('refuses the nested-relation form beneath every relation type, single or multiple, naming the route that works — no read', async () => {
    for (const [field, type, related, multiple] of RELATIONS) {
      const err = await refusalOf(engine.find(OBJECT, { where: { [field]: { region: 'NA' } } as FilterCondition }));
      expect(envelopeOf(err), field).toEqual(ENVELOPE);
      expect(err!.httpStatus, field).toBe(400);
      expect(err!.message, field).toMatch(/^find\('nested_object_probe'\): /);
      expect(err!.message, field).toContain(`filter on '${field}'`);
      expect(err!.message, field).toContain(`at where.${field},`);
      expect(err!.message, field).toContain(`beneath the declared ${type} field '${field}'`);
      expect(err!.message, field).toContain('nested-relation form');
      expect(err!.message, field).toContain('NOT applied');
      expect(err!.message, field).toContain(`Filter the related object '${related}' first`);
      expect(err!.message, field).toContain(
        multiple ? `{ "${field}": { "$contains": ID } }` : `{ "${field}": { "$in": [ID, …] } }`,
      );
    }
    expect(reads).toHaveLength(0);
  });

  it('refuses a whole-value object beneath every structured-JSON type, naming what every driver answers alike — no read', async () => {
    for (const [field, type] of JSONS) {
      const err = await refusalOf(engine.find(OBJECT, { where: { [field]: { a: 1 } } as FilterCondition }));
      expect(envelopeOf(err), field).toEqual(ENVELOPE);
      expect(err!.message, field).toContain(`at where.${field},`);
      expect(err!.message, field).toContain(`as the value of the declared ${type} field '${field}'`);
      expect(err!.message, field).toContain('whole-value match');
      expect(err!.message, field).toContain(`{ "${field}": { "$null": false } }`);
      expect(err!.message, field).not.toContain('$contains');
    }
    expect(reads).toHaveLength(0);
  });

  it('refuses it beneath the platform-provisioned id column the declared map omits, in the scalar words', async () => {
    const err = await refusalOf(engine.find(OBJECT, { where: { id: { a: 1 } } as FilterCondition }));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err!.message).toContain('at where.id,');
    expect(err!.message).toContain("the platform-provisioned text column 'id'");
    expect(err!.message).toContain('holds scalar values');
    expect(reads).toHaveLength(0);
  });

  it('refuses {} beneath a relation and a JSON column too, in the engine\'s words rather than each driver\'s', async () => {
    for (const [where, words] of [
      [{ owner: {} }, 'nested-relation form'],
      [{ meta: {} }, 'whole-value match'],
    ] as const) {
      const err = await refusalOf(engine.find(OBJECT, { where: where as FilterCondition }));
      expect(envelopeOf(err), JSON.stringify(where)).toEqual(ENVELOPE);
      expect(err!.message, JSON.stringify(where)).toContain('an empty object {}');
      expect(err!.message, JSON.stringify(where)).toContain(words);
    }
    expect(reads).toHaveLength(0);
  });

  it('covers every engine verb that collects a filter — read and write sides — and the judge', async () => {
    for (const where of [{ owner: { region: 'NA' } }, { meta: { a: 1 } }] as FilterCondition[]) {
      const path = `at where.${Object.keys(where)[0]},`;
      for (const call of [
        () => engine.find(OBJECT, { where }),
        () => engine.findOne(OBJECT, { where }),
        () => engine.count(OBJECT, { where }),
        () => engine.aggregate(OBJECT, { where, aggregations: [{ function: 'count', alias: 'n' }] } as EngineAggregateOptions),
        () => engine.update(OBJECT, { title: 'x' }, { where, multi: true }),
        () => engine.delete(OBJECT, { where, multi: true }),
      ]) {
        const err = await refusalOf(call());
        expect(envelopeOf(err), path).toEqual(ENVELOPE);
        expect(err!.message, path).toContain(path);
      }
      expect(engine.judgeFilter(OBJECT, where)).toMatchObject({ ok: false, ...ENVELOPE });
    }
    expect(reads).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('reaches inside $and / $or / $not, and answers the FilterArray sugar alike', async () => {
    const cases: ReadonlyArray<readonly [FilterCondition, string]> = [
      [{ $and: [{ title: 'a' }, { owner: { region: 'NA' } }] }, 'where.$and[1].owner'],
      [{ $or: [{ meta: { a: 1 } }, { amount: 30 }] }, 'where.$or[0].meta'],
      [{ $not: { boss: { region: 'NA' } } }, 'where.$not.boss'],
    ];
    for (const [where, path] of cases) {
      const err = await refusalOf(engine.find(OBJECT, { where }));
      expect(envelopeOf(err), path).toEqual(ENVELOPE);
      expect(err!.message, path).toContain(`at ${path},`);
    }
    const sugar = await refusalOf(
      engine.find(OBJECT, { where: [['owner', '=', { region: 'NA' }]] } as unknown as EngineQueryOptions),
    );
    expect(envelopeOf(sugar)).toEqual(ENVELOPE);
    expect(sugar!.message).toContain('at where.owner,');
    expect(reads).toHaveLength(0);
  });

  it('CONTROL the named routes, a file field and an unknown key reach the driver exactly as written', async () => {
    for (const where of [
      { owner: { $in: ['u1'] } },
      { owners: { $contains: 'u1' } },
      { $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u2' } }] },
      { owner: 'u1' },
      { meta: { $null: false } },
      { id: 'd1' },
      { id: { $in: ['d1', 'd3'] } },
      // The #8371 carve-out: a legacy stored file value is an inline object.
      { photo: { url: 'x' } },
      // The registry-less tolerance: no second opinion about a name.
      { not_a_field: { a: 1 } },
    ] as FilterCondition[]) {
      reads.length = 0;
      await expect(engine.find(OBJECT, { where }), JSON.stringify(where)).resolves.toBeDefined();
      expect(reads, JSON.stringify(where)).toHaveLength(1);
      expect(reads[0]?.ast?.where, JSON.stringify(where)).toEqual(where);
    }
  });

  // ── the per-aggregation `filter` and `having` ────────────────────────────

  it('refuses it in ONE aggregation\'s own filter, rooted at that position — no read', async () => {
    for (const [field, spec, words] of [
      ['owner', { region: 'NA' }, 'nested-relation form'],
      ['meta', { a: 1 }, 'whole-value match'],
    ] as const) {
      reads.length = 0;
      const err = await refusalOf(engine.aggregate(OBJECT, {
        aggregations: [
          { function: 'count', alias: 'all' },
          { function: 'count', alias: 'bad', filter: { [field]: spec } },
        ],
      } as EngineAggregateOptions));
      expect(envelopeOf(err), field).toEqual(ENVELOPE);
      expect(err!.message, field).toMatch(/^aggregate\('nested_object_probe'\): /);
      expect(err!.message, field).toContain(`at aggregations[1].filter.${field},`);
      expect(err!.message, field).toContain(words);
      expect(reads, field).toHaveLength(0);
    }
  });

  it('refuses it in having over a relation or JSON column, naming the aggregated column — no read', async () => {
    const cases: ReadonlyArray<readonly [EngineAggregateOptions, string, string, string]> = [
      [{ groupBy: ['owner'], aggregations: [{ function: 'count', alias: 'n' }], having: { owner: { region: 'NA' } } }, 'owner', 'lookup', 'nested-relation form'],
      [{ groupBy: ['title'], aggregations: [{ function: 'max', field: 'boss', alias: 'top' }], having: { top: { region: 'NA' } } }, 'top', 'master_detail', 'nested-relation form'],
      // [#20783] A JSON column reaches `having` as a `max` of a json field: a
      // json GROUPBY is refused one door earlier (`engine-group-by-json-door.test.ts`).
      [{ groupBy: ['title'], aggregations: [{ function: 'max', field: 'meta', alias: 'top_meta' }], having: { top_meta: { a: 1 } } }, 'top_meta', 'json', 'whole-value match'],
    ] as ReadonlyArray<readonly [EngineAggregateOptions, string, string, string]>;
    for (const [query, column, type, words] of cases) {
      reads.length = 0;
      const err = await refusalOf(engine.aggregate(OBJECT, query));
      expect(envelopeOf(err), column).toEqual(ENVELOPE);
      expect(err!.message, column).toContain(`at having.${column},`);
      expect(err!.message, column).toContain(`the aggregated column '${column}', which carries a ${type} value`);
      expect(err!.message, column).toContain(words);
      expect(reads, column).toHaveLength(0);
    }
  });

  it('CONTROL a file field stays unjudged in the per-aggregation filter and in having', async () => {
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
      { door: 'where object', query: { where: { owner: { region: 'NA' } } } },
      { door: '$filter string', query: { $filter: JSON.stringify({ meta: { a: 1 } }) } },
      { door: 'filter AST', query: { filter: [['owner', '=', { region: 'NA' }]] } },
    ];

    it.each(DOORS)('the $door door refuses it', async ({ query }) => {
      const err = await refusalOf(protocol.findData({ object: OBJECT, query } as any));
      expect(envelopeOf(err)).toEqual(ENVELOPE);
      expect(err!.message).toContain('is filter structure, not a value');
      expect(reads).toHaveLength(0);
    });
  });

  // ── the classification ───────────────────────────────────────────────────

  it('GUARD the three judged kinds are the spec\'s classes, and file and media types, formula and unknown types are never judged', () => {
    for (const type of FieldType.options) {
      const expected = holdsScalarValues(type)
        ? 'scalar'
        : REFERENCE_VALUE_TYPES.has(type) ? 'relation' : STRUCTURED_JSON_TYPES.has(type) ? 'json' : null;
      expect(noOperatorObjectColumnKind(type), type).toBe(expected);
    }
    for (const type of [...FILE_REFERENCE_TYPES, 'formula', 'not_a_type']) {
      expect(noOperatorObjectColumnKind(type), type).toBeNull();
    }
  });

  it('GUARD only the three platform-provisioned columns are judged when the declared map omits them', () => {
    expect(provisionedNoOperatorObjectColumn('id')).toMatchObject({ kind: 'scalar', type: 'text', provisioned: true });
    expect(provisionedNoOperatorObjectColumn('created_at')).toMatchObject({ kind: 'scalar', type: 'datetime' });
    expect(provisionedNoOperatorObjectColumn('updated_at')).toMatchObject({ kind: 'scalar', type: 'datetime' });
    for (const key of ['owner_id', 'organization_id', 'not_a_field', '_id']) {
      expect(provisionedNoOperatorObjectColumn(key), key).toBeNull();
    }
  });
});
