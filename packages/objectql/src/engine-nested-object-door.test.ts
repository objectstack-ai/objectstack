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
 *
 * [#20802] The relation rows at `where` are SERVED now (maintainer ruling,
 * letter A): the engine lowers the nested-relation form by reading the related
 * object, and `engine-nested-relation-lowering.test.ts` pins it. What stays
 * here is what still refuses: the structured-JSON and provisioned-`id` rows,
 * `{}` beneath a relation (it names no field of the related object), and the
 * relation rows at an aggregation's own `filter` and at `having`, whose words
 * now say the form is served in `where`.
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
    for (const [where, empty, words] of [
      // [#20802] Served at `where` otherwise — `{}` names no field of the related object.
      [{ owner: {} }, '(no keys)', 'names no field of the related object'],
      [{ meta: {} }, 'an empty object {}', 'whole-value match'],
    ] as const) {
      const err = await refusalOf(engine.find(OBJECT, { where: where as FilterCondition }));
      expect(envelopeOf(err), JSON.stringify(where)).toEqual(ENVELOPE);
      expect(err!.message, JSON.stringify(where)).toContain(empty);
      expect(err!.message, JSON.stringify(where)).toContain(words);
    }
    expect(reads).toHaveLength(0);
  });

  it('covers every engine verb that collects a filter — read and write sides — and the judge', async () => {
    // [#20802] The relation row is served at `where` on every verb now:
    // `engine-nested-relation-lowering.test.ts`.
    for (const where of [{ ship_to: { city: 'Paris' } }, { meta: { a: 1 } }] as FilterCondition[]) {
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
      [{ $and: [{ title: 'a' }, { ship_to: { city: 'Paris' } }] }, 'where.$and[1].ship_to'],
      [{ $or: [{ meta: { a: 1 } }, { amount: 30 }] }, 'where.$or[0].meta'],
      [{ $not: { spec: { k: 1 } } }, 'where.$not.spec'],
    ];
    for (const [where, path] of cases) {
      const err = await refusalOf(engine.find(OBJECT, { where }));
      expect(envelopeOf(err), path).toEqual(ENVELOPE);
      expect(err!.message, path).toContain(`at ${path},`);
    }
    const sugar = await refusalOf(
      engine.find(OBJECT, { where: [['meta', '=', { a: 1 }]] } as unknown as EngineQueryOptions),
    );
    expect(envelopeOf(sugar)).toEqual(ENVELOPE);
    expect(sugar!.message).toContain('at where.meta,');
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

  it('[#20914] a max over a relation or JSON field never reaches having: the aggregate door refuses the pair one door earlier — no read', async () => {
    // These two queries used to reach `having` with an aggregated column that
    // carries a master_detail / json value. The aggregate × field-type table
    // refuses `max` over both types, and the engine's aggregate door asks it
    // before any filter door runs — as a json GROUPBY is refused one door
    // earlier (`engine-group-by-json-door.test.ts`).
    const cases: ReadonlyArray<readonly [EngineAggregateOptions, string, string]> = [
      [{ groupBy: ['title'], aggregations: [{ function: 'max', field: 'boss', alias: 'top' }], having: { top: { region: 'NA' } } }, 'boss', 'master_detail field'],
      [{ groupBy: ['title'], aggregations: [{ function: 'max', field: 'meta', alias: 'top_meta' }], having: { top_meta: { a: 1 } } }, 'meta', 'json field — a structured-JSON value'],
    ] as ReadonlyArray<readonly [EngineAggregateOptions, string, string]>;
    for (const [query, field, declared] of cases) {
      reads.length = 0;
      const err = await refusalOf(engine.aggregate(OBJECT, query));
      expect(envelopeOf(err), field).toEqual({ code: 'INVALID_FIELD', status: 400 });
      expect(err!.message, field).toContain(
        `aggregations[0].field takes the max of '${field}', a declared ${declared}, which the engine does not take the max of. The query was NOT run.`,
      );
      expect(err!.message, field).not.toContain('at having.');
      expect(reads, field).toHaveLength(0);
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
      { door: 'where object', query: { where: { ship_to: { city: 'Paris' } } } },
      { door: '$filter string', query: { $filter: JSON.stringify({ meta: { a: 1 } }) } },
      { door: 'filter AST', query: { filter: [['meta', '=', { a: 1 }]] } },
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
