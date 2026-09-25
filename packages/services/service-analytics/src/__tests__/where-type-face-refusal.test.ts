// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20035] The analytics `where` door runs the shared comparand-TYPE face on the
 * object spelling, after the comparand-shape face and before any node is built.
 *
 * `normalizeFilterComparandTypes` (`@objectstack/spec/data`) is the #7872 door.
 * The maintainer's ruling there (2026-08-12) defines the accepted comparand
 * types as `string | number | bigint | boolean | null | Date` and 「refuses
 * everything else loudly at the compile face」; a `bigint` within 2^53 is
 * accepted and NARROWED to its number, copy-on-write. `parseFilterAST` runs it
 * on everything it returns, and the engine seam on every object-form `where`,
 * so this door's `FilterArray` spelling and the ObjectQL engine path always
 * met it. The object spelling did not. Measured on a real engine before this
 * change (recorded on the branch, `4e1cd13aac`):
 *
 *   | object `where`                         | before                                              |
 *   |---|---|
 *   | `{ stage: { $ne: { a: 1 } } }`         | native bound `'{"a":1}'` and served EVERY row; the `/analytics/sql` echo answered 500; the draft preview served every row |
 *   | `{ amt: { $between: [{ a: 1 }, 5] } }` | `amt >= '{"a":1}' AND amt <= 5`; the engine path refused it as a `$gte` |
 *   | `{ stage: { $in: [Uint8Array] } }`     | native bound the JSON text `'{"0":1,"1":2}'`: no row                   |
 *   | `{ stage: Uint8Array }`                | flattened to `stage.0 = 1 AND stage.1 = 2`: native 500                   |
 *   | `{ stage: new Map(…) }`                | refused as #5240's zero-operator wrapper; the draft preview served every row |
 *   | `{ amt: { $gt: 2n ** 60n } }`          | bound as-is: no row; the engine path refused it                        |
 *   | `{ amt: { $gt: undefined } }`          | refused in #6386's sentence; the draft preview answered NO row          |
 *   | `{ amt: { $gt: 2n } }`                 | the right rows, except the draft preview, which ordered it as text and lost `amt = 10` |
 *
 * while the `FilterArray` spelling and the engine seam refused every one of the
 * refusal rows `INVALID_FILTER` / 400 in the face's words, and narrowed the
 * last one.
 *
 * Blocks: one condition, one wording (object = `FilterArray` = the face, byte
 * for byte); what is diagnosed first; what the face does not judge (the door's
 * own sentences, unchanged); the narrowing, copy-on-write; the four faces over
 * a real engine, refusals and controls; a stored dataset through the service
 * doors.
 *
 * Every refusal asserts the ADR-0112 envelope (`code` + `status`); a bare
 * `toThrow()` would be satisfied by any uncoded error.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQL } from '@objectstack/objectql';
import { normalizeFilterComparandTypes, type Cube } from '@objectstack/spec/data';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { lowerAnalyticsWhere, normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';
import { AnalyticsService } from '../analytics-service.js';

interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

const tree = (where: unknown) => normalizeAnalyticsFilterTree({ where } as never);

function refusalOf(run: () => unknown): Refusal {
  let out: unknown;
  try {
    out = run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, but it answered ${String(out)}`);
}

function expectEnvelope(err: Refusal): void {
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
}

/** The face's own refusal of `node`, read straight from `@objectstack/spec`. */
function faceSays(node: unknown): string {
  return refusalOf(() => normalizeFilterComparandTypes(node)).message;
}

/** The face's opening sentence for each refusal kind. */
const TYPE = (path: string, kind: string) => `Filter comparand at ${path} is ${kind} (`;
const UNDEFINED = (path: string) => `Filter comparand at ${path} is undefined.`;
const BIGINT = (path: string) => `Filter comparand at ${path} is the bigint `;

const bin = () => new Uint8Array([1, 2]);
const map = () => new Map([['a', 1]]);
class Money {
  constructor(readonly amount: number) {}
}
const BIG = 2n ** 60n;

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20035] one condition, one wording — the object spelling, the FilterArray spelling and the face agree byte for byte', () => {
  // [label, object spelling, FilterArray spelling, opening sentence]
  const PAIRS: Array<[string, () => unknown, () => unknown, string]> = [
    ['a plain object under $ne', () => ({ stage: { $ne: { a: 1 } } }), () => ['stage', '!=', { a: 1 }], TYPE('where.stage.$ne', 'a plain object')],
    ['a plain object under $gt', () => ({ amt: { $gt: { a: 1 } } }), () => ['amt', '>', { a: 1 }], TYPE('where.amt.$gt', 'a plain object')],
    ['a plain object under $lte', () => ({ amt: { $lte: { a: 1 } } }), () => ['amt', '<=', { a: 1 }], TYPE('where.amt.$lte', 'a plain object')],
    ['a plain-object $between endpoint', () => ({ amt: { $between: [{ a: 1 }, 5] } }), () => ['amt', 'between', [{ a: 1 }, 5]], TYPE('where.amt.$between[0]', 'a plain object')],
    ['a plain-object $in member', () => ({ stage: { $in: ['won', { a: 1 }] } }), () => ['stage', 'in', ['won', { a: 1 }]], TYPE('where.stage.$in[1]', 'a plain object')],
    ['a plain-object $nin member', () => ({ stage: { $nin: [{ a: 1 }] } }), () => ['stage', 'nin', [{ a: 1 }]], TYPE('where.stage.$nin[0]', 'a plain object')],
    ['a plain object under $contains', () => ({ stage: { $contains: { a: 1 } } }), () => ['stage', 'contains', { a: 1 }], TYPE('where.stage.$contains', 'a plain object')],
    ['a plain object under $icontains', () => ({ stage: { $icontains: { a: 1 } } }), () => ['stage', 'icontains', { a: 1 }], TYPE('where.stage.$icontains', 'a plain object')],
    ['a non-string { $field } (not a reference)', () => ({ amt: { $gt: { $field: 5 } } }), () => ['amt', '>', { $field: 5 }], TYPE('where.amt.$gt', 'a plain object')],
    ['a binary under $ne', () => ({ stage: { $ne: bin() } }), () => ['stage', '!=', bin()], TYPE('where.stage.$ne', 'a Uint8Array instance')],
    ['a binary $in member', () => ({ stage: { $in: [bin()] } }), () => ['stage', 'in', [bin()]], TYPE('where.stage.$in[0]', 'a Uint8Array instance')],
    ['a binary implicit comparand', () => ({ stage: bin() }), () => ['stage', '=', bin()], TYPE('where.stage', 'a Uint8Array instance')],
    ['a Map implicit comparand', () => ({ stage: map() }), () => ['stage', '=', map()], TYPE('where.stage', 'a Map instance')],
    ['a class instance implicit comparand', () => ({ amt: new Money(5) }), () => ['amt', '=', new Money(5)], TYPE('where.amt', 'a Money instance')],
    ['a bigint beyond 2^53 under $gt', () => ({ amt: { $gt: BIG } }), () => ['amt', '>', BIG], BIGINT('where.amt.$gt')],
    ['a bigint beyond 2^53 as a $in member', () => ({ amt: { $in: [1, BIG] } }), () => ['amt', 'in', [1, BIG]], BIGINT('where.amt.$in[1]')],
    ['a bigint beyond -2^53 implicit', () => ({ amt: -BIG }), () => ['amt', '=', -BIG], BIGINT('where.amt')],
    ['an undefined implicit comparand', () => ({ stage: undefined }), () => ['stage', '=', undefined], UNDEFINED('where.stage')],
    ['an undefined under $gt', () => ({ amt: { $gt: undefined } }), () => ['amt', '>', undefined], UNDEFINED('where.amt.$gt')],
    ['an undefined under $ne', () => ({ stage: { $ne: undefined } }), () => ['stage', '!=', undefined], UNDEFINED('where.stage.$ne')],
    ['an undefined $in member', () => ({ stage: { $in: ['won', undefined] } }), () => ['stage', 'in', ['won', undefined]], UNDEFINED('where.stage.$in[1]')],
    ['under $and', () => ({ $and: [{ id: 'd3' }, { stage: { $ne: { a: 1 } } }] }), () => ['and', ['id', '=', 'd3'], ['stage', '!=', { a: 1 }]], TYPE('where.$and[1].stage.$ne', 'a plain object')],
    ['under $or', () => ({ $or: [{ id: 'd3' }, { amt: { $gt: BIG } }] }), () => ['or', ['id', '=', 'd3'], ['amt', '>', BIG]], BIGINT('where.$or[1].amt.$gt')],
    ['a flat conjunction', () => ({ $and: [{ id: 'd3' }, { stage: bin() }] }), () => [['id', '=', 'd3'], ['stage', '=', bin()]], TYPE('where.$and[1].stage', 'a Uint8Array instance')],
  ];

  for (const [name, object, array, opening] of PAIRS) {
    it(name, () => {
      const face = faceSays(object());
      const objectErr = refusalOf(() => tree(object()));
      const arrayErr = refusalOf(() => tree(array()));
      expectEnvelope(objectErr);
      expectEnvelope(arrayErr);
      expect(face.startsWith(opening), face).toBe(true);
      expect(objectErr.message).toBe(face);
      expect(arrayErr.message).toBe(face);
      expect(objectErr.message).toContain('The filter was NOT applied');
    });
  }

  // The positions with no `FilterArray` spelling: `'='` lowers to the implicit
  // slot, `$not` has no array keyword, and the null predicates ignore their
  // value. The object spelling is held to the face's own answer.
  const OBJECT_ONLY: Array<[string, unknown, string]> = [
    ['a plain object under $eq', { stage: { $eq: { a: 1 } } }, TYPE('where.stage.$eq', 'a plain object')],
    ['a binary under $eq', { stage: { $eq: bin() } }, TYPE('where.stage.$eq', 'a Uint8Array instance')],
    ['a Map under $eq', { stage: { $eq: map() } }, TYPE('where.stage.$eq', 'a Map instance')],
    ['an undefined under $eq', { stage: { $eq: undefined } }, UNDEFINED('where.stage.$eq')],
    ['an undefined $null flag', { stage: { $null: undefined } }, UNDEFINED('where.stage.$null')],
    ['a plain-object $null flag', { stage: { $null: { a: 1 } } }, TYPE('where.stage.$null', 'a plain object')],
    ['an undefined $exists flag', { stage: { $exists: undefined } }, UNDEFINED('where.stage.$exists')],
    ['under $not', { $not: { stage: { $ne: { a: 1 } } } }, TYPE('where.$not.stage.$ne', 'a plain object')],
    ['under $not over $or', { $not: { $or: [{ id: 'd3' }, { amt: { $lt: BIG } }] } }, BIGINT('where.$not.$or[1].amt.$lt')],
  ];

  for (const [name, where, opening] of OBJECT_ONLY) {
    it(`${name} (no FilterArray spelling: held to the face)`, () => {
      const face = faceSays(where);
      const objectErr = refusalOf(() => tree(where));
      expectEnvelope(objectErr);
      expect(face.startsWith(opening), face).toBe(true);
      expect(objectErr.message).toBe(face);
    });
  }

  it('a nested relation is judged on its dotted member, byte-identical to the dotted spelling', () => {
    // The face leaves a nested-relation object alone as filter STRUCTURE; this
    // compiler flattens it to `acct.amt`, so the door hands its entries over.
    const dotted = { 'acct.amt': { $gt: { a: 1 } } };
    const face = faceSays(dotted);
    expect(face.startsWith(TYPE('where.acct.amt.$gt', 'a plain object'))).toBe(true);
    expect(refusalOf(() => tree({ acct: { amt: { $gt: { a: 1 } } } })).message).toBe(face);
    expect(refusalOf(() => tree(dotted)).message).toBe(face);
    expect(refusalOf(() => tree(['acct.amt', '>', { a: 1 }])).message).toBe(face);
    // …at any depth, and under a combinator.
    expect(refusalOf(() => tree({ $or: [{ id: 'd3' }, { acct: { owner: { amt: undefined } } }] })).message)
      .toBe(faceSays({ $or: [{ id: 'd3' }, { 'acct.owner.amt': undefined }] }));
  });
});

describe('[#20035] what is diagnosed first', () => {
  it('the shape face before the type face, over the WHOLE condition — parseFilterAST\'s order', () => {
    // A type defect in the first entry, a shape defect in the second: the
    // shape face judges the whole condition first, on both spellings.
    const object = { amt: { $gt: { a: 1 } }, stage: { $in: 'won' } };
    const array = [['amt', '>', { a: 1 }], ['stage', 'in', 'won']];
    const objectErr = refusalOf(() => tree(object));
    expectEnvelope(objectErr);
    expect(objectErr.message.startsWith('Operator "$in" on field "stage" requires an ARRAY of values')).toBe(true);
    expect(refusalOf(() => tree(array)).message.replace('where.$and[1]', 'where')).toBe(objectErr.message);
    // Inside one list: the null member (shape) before the plain object (type).
    const member = refusalOf(() => tree({ stage: { $in: [{ a: 1 }, null] } }));
    expect(member.message.startsWith('Operator "$in" on field "stage" does not accept null as a list member')).toBe(true);
  });

  it('the equality-slot list before either (#19888)', () => {
    const err = refusalOf(() => tree({ stage: [1, { a: 1 }] }));
    expectEnvelope(err);
    expect(err.message.startsWith('The implicit-equality comparand on field "stage" requires a single comparable value')).toBe(true);
  });

  it('the type face before this door\'s own gates: #6444\'s mixed wrapper, #3948\'s operator vocabulary', () => {
    const mixed = refusalOf(() => tree({ amt: { $gt: { a: 1 }, nested: 'x' } }));
    expect(mixed.message.startsWith(TYPE('where.amt.$gt', 'a plain object'))).toBe(true);
    expect(mixed.message).not.toContain('mixes $-operator keys');
    // `$like` is in the face's vocabulary, so its comparand is judged first;
    // this door's unsupported-operator refusal answers an accepted comparand.
    expect(refusalOf(() => tree({ stage: { $like: bin() } })).message.startsWith(TYPE('where.stage.$like', 'a Uint8Array instance'))).toBe(true);
    expect(refusalOf(() => tree({ stage: { $like: 'w%' } })).message).toContain('Unsupported filter operator "$like"');
  });
});

describe('[#20035] what the type face does not judge keeps this door\'s own sentence', () => {
  // The face steps around arrays outside the list operators, `{ $field }`
  // references and unknown operators, so those positions reach the door's own
  // gates (#6386's `undefined` sweep, #5234's member and LIKE checks) exactly
  // as before.
  it('an undefined inside an ARRAY comparand, or under an unknown operator — #6386', () => {
    for (const [where, path] of [
      [{ d: { $contains: ['a', undefined] } }, '"d".$contains[1]'],
      [{ d: { $wat: undefined } }, '"d".$wat'],
    ] as const) {
      const err = refusalOf(() => tree(where));
      expectEnvelope(err);
      expect(err.message).toContain(`[analytics] comparand at ${path} is undefined`);
    }
  });

  it('an ARRAY or a { $field } member of $in, and the same as a LIKE comparand — #5234 / #7598', () => {
    expect(refusalOf(() => tree({ s: { $in: ['a', [1, 2]] } })).message).toContain('cannot be bound as a SQL parameter');
    expect(refusalOf(() => tree({ s: { $in: [{ $field: 'other' }] } })).message).toContain('cannot be bound as a SQL parameter');
    expect(refusalOf(() => tree({ s: { $contains: ['a', 'b'] } })).message).toContain('StringOperatorSchema');
    expect(refusalOf(() => tree({ s: { $contains: { $field: 'other' } } })).message).toContain('StringOperatorSchema');
  });
});

describe('[#20035] a bigint within 2^53 is NARROWED, copy-on-write — and every other accepted comparand is untouched', () => {
  const leaf = (member: string, operator: string, values: unknown[]) => ({ kind: 'leaf', member, operator, values });

  it('the tree carries the number, the same tree the FilterArray spelling compiles', () => {
    for (const [object, array, expected] of [
      [{ amt: { $gt: 2n } }, ['amt', '>', 2n], leaf('amt', 'gt', [2])],
      [{ amt: 5n }, ['amt', '=', 5n], leaf('amt', 'equals', [5])],
      [{ amt: { $in: [5n, 10n] } }, ['amt', 'in', [5n, 10n]], leaf('amt', 'in', [5, 10])],
      [{ amt: { $gte: 2n ** 53n } }, ['amt', '>=', 2n ** 53n], leaf('amt', 'gte', [2 ** 53])],
    ] as const) {
      expect(tree(object)).toEqual(expected);
      expect(tree(array)).toEqual(expected);
      expect(typeof (tree(object) as { values: unknown[] }).values[0]).toBe('number');
    }
    // A $between keeps its two bounds, narrowed.
    expect(tree({ amt: { $between: [2n, 5n] } })).toEqual({
      kind: 'and',
      children: [leaf('amt', 'gte', [2]), leaf('amt', 'lte', [5])],
    });
    // A nested relation's bigint is narrowed on its dotted member.
    expect(tree({ acct: { amt: 7n } })).toEqual(leaf('acct.amt', 'equals', [7]));
  });

  it('the caller\'s condition is never edited, and nothing is copied when nothing narrowed', () => {
    const inner = { amt: { $gt: 2n } };
    const where = { $and: [{ stage: 'won' }, inner] };
    const lowered = lowerAnalyticsWhere({ where }) as { $and: Array<Record<string, unknown>> };
    expect(lowered).not.toBe(where);
    expect(lowered.$and[0]).toBe(where.$and[0]);
    expect(lowered.$and[1]).toEqual({ amt: { $gt: 2 } });
    expect(inner.amt.$gt).toBe(2n);

    const untouched = { $and: [{ stage: 'won' }, { amt: { $gt: 2, $lt: new Date(0) } }], $not: { acct: { region: 'emea' } } };
    expect(lowerAnalyticsWhere({ where: untouched })).toBe(untouched);
  });

  it('CONTROL: the accepted comparands compile exactly as before', () => {
    const when = new Date('2026-03-04T05:06:07.000Z');
    const ACCEPTED: Array<[unknown, unknown]> = [
      [{ stage: 'won' }, leaf('stage', 'equals', ['won'])],
      [{ amt: { $gt: 2 } }, leaf('amt', 'gt', [2])],
      [{ flag: true }, leaf('flag', 'equals', [true])],
      [{ stage: null }, leaf('stage', 'notSet', [])],
      [{ stage: { $eq: null } }, leaf('stage', 'notSet', [])],
      [{ stage: { $ne: null } }, leaf('stage', 'set', [])],
      [{ stage: { $null: true } }, leaf('stage', 'notSet', [])],
      [{ stage: { $contains: null } }, leaf('stage', 'contains', [null])],
      [{ amt: { $gt: { $field: 'id' } } }, leaf('amt', 'gt', [{ $field: 'id' }])],
      [{ acct: { region: 'emea' } }, leaf('acct.region', 'equals', ['emea'])],
    ];
    for (const [where, expected] of ACCEPTED) {
      expect(tree(where), JSON.stringify(where)).toEqual(expected);
    }
    // A Date is a comparand, not structure, and is not copied.
    expect((tree({ closed: { $gte: when } }) as { values: unknown[] }).values[0]).toBe(when);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const OBJECT = 'deal';
const ROWS = [
  { id: 'd1', amt: 1, stage: 'won' },
  { id: 'd2', amt: 5, stage: 'lost' },
  { id: 'd3', amt: 10, stage: 'open' },
  { id: 'd4', amt: null, stage: null },
  { id: 'd5', amt: 3, stage: '' },
];
const FIELDS = {
  id: { type: 'text', name: 'id' },
  amt: { type: 'number', name: 'amt' },
  stage: { type: 'text', name: 'stage' },
};
const CUBE: Cube = {
  name: 'deals',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    [['id', 'string'], ['amt', 'number'], ['stage', 'string']].map(([n, t]) => [n, { name: n, label: n, type: t, sql: n }]),
  ),
  public: false,
} as unknown as Cube;
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } } as never;

function carriesBigint(value: unknown): boolean {
  if (typeof value === 'bigint') return true;
  if (Array.isArray(value)) return value.some(carriesBigint);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.values(value).some(carriesBigint);
  return false;
}

describe('[#20035] every analytics face refuses before anything runs, and narrows what it accepts (real engine)', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let statements = 0;
  let aggregates = 0;
  let bound: unknown[][] = [];
  let received: unknown[] = [];

  const runRawSql = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    statements++;
    bound.push(params);
    const result = await driver.execute(sql.replace(/\$\d+/g, '?'), params);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
      return (result as { rows: Record<string, unknown>[] }).rows;
    }
    return [];
  };

  const ctxFor = (nativeSql: boolean): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql, objectqlAggregate: !nativeSql, inMemory: false }),
      getReadScope: () => undefined,
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
      // The engine path: a REAL ObjectQL engine over the same sql.js database,
      // with the auto-bridge's own mapping (`plugin.ts`).
      executeAggregate: async (objectName: string, options: Record<string, any>) => {
        aggregates++;
        received.push(options.filter);
        return (await engine.aggregate(objectName, {
          where: options.filter,
          groupBy: options.groupBy,
          aggregations: options.aggregations?.map((a: any) => ({ function: a.method, field: a.field, alias: a.alias })),
        } as never)) as Record<string, unknown>[];
      },
      sqlDialect: () => 'sqlite',
    }) as unknown as StrategyContext;

  const q = (where: unknown) => ({ cube: 'deals', dimensions: ['id'], measures: ['n'], where }) as unknown as AnalyticsQuery;
  const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

  const FACES: Array<[string, (where: unknown) => Promise<string[]>]> = [
    ['native execute', async (where) => ids((await new NativeSQLStrategy().execute(q(where), ctxFor(true))).rows)],
    ['/analytics/sql echo', async (where) => {
      const { sql, params } = await new ObjectQLStrategy().generateSql(q(where), ctxFor(false));
      return ids(await runRawSql(sql, params));
    }],
    ['ObjectQL engine path', async (where) => ids((await new ObjectQLStrategy().execute(q(where), ctxFor(false))).rows)],
    ['draft preview', async (where) => ids(evaluateAnalyticsQueryOverRows(q(where), CUBE, ROWS.map((r) => ({ ...r }))).rows)],
  ];

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([{ name: OBJECT, fields: FIELDS } as never]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: OBJECT, label: 'Deal', fields: FIELDS } as never);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('CONTROL: no where serves every row, and scalars and null serve the same rows on every face', async () => {
    // Without this, the refusals below could pass on a harness that serves nothing.
    for (const [face, run] of FACES) {
      expect(await run(undefined), `${face}: no where`).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
      expect(await run({ stage: 'won' }), `${face}: scalar`).toEqual(['d1']);
      expect(await run({ amt: { $gt: 2 } }), `${face}: $gt 2`).toEqual(['d2', 'd3', 'd5']);
      expect(await run({ stage: null }), `${face}: null`).toEqual(['d4']);
      expect(await run({ stage: { $ne: 'won' } }), `${face}: $ne`).toEqual(['d2', 'd3', 'd4', 'd5']);
    }
  });

  it('CONTROL: a bigint within 2^53 serves the same rows as its number on every face, and reaches none of them as a bigint', async () => {
    for (const [face, run] of FACES) {
      bound = [];
      received = [];
      expect(await run({ amt: { $gt: 2n } }), `${face}: $gt 2n`).toEqual(['d2', 'd3', 'd5']);
      expect(await run({ amt: 5n }), `${face}: 5n`).toEqual(['d2']);
      expect(await run({ amt: { $in: [5n, 10n] } }), `${face}: $in`).toEqual(['d2', 'd3']);
      expect(await run({ amt: { $between: [2n, 5n] } }), `${face}: $between`).toEqual(['d2', 'd5']);
      expect(bound.some(carriesBigint), `${face}: a bigint was bound`).toBe(false);
      expect(received.some(carriesBigint), `${face}: the engine received a bigint`).toBe(false);
    }
  });

  const REFUSED: Array<[string, unknown, string]> = [
    ['a plain object under $ne (served EVERY row natively before)', { stage: { $ne: { a: 1 } } }, TYPE('where.stage.$ne', 'a plain object')],
    ['a plain object under $gt', { amt: { $gt: { a: 1 } } }, TYPE('where.amt.$gt', 'a plain object')],
    ['a plain object under $eq', { stage: { $eq: { a: 1 } } }, TYPE('where.stage.$eq', 'a plain object')],
    ['a plain-object $between endpoint', { amt: { $between: [{ a: 1 }, 5] } }, TYPE('where.amt.$between[0]', 'a plain object')],
    ['a binary $in member', { stage: { $in: [bin()] } }, TYPE('where.stage.$in[0]', 'a Uint8Array instance')],
    ['a binary under $ne', { stage: { $ne: bin() } }, TYPE('where.stage.$ne', 'a Uint8Array instance')],
    ['a binary implicit comparand', { stage: bin() }, TYPE('where.stage', 'a Uint8Array instance')],
    ['a Map implicit comparand', { stage: map() }, TYPE('where.stage', 'a Map instance')],
    ['a bigint beyond 2^53', { amt: { $gt: BIG } }, BIGINT('where.amt.$gt')],
    ['an undefined under $gt (the preview answered no row)', { amt: { $gt: undefined } }, UNDEFINED('where.amt.$gt')],
    ['an undefined implicit comparand', { stage: undefined }, UNDEFINED('where.stage')],
    ['an undefined $in member', { stage: { $in: [undefined] } }, UNDEFINED('where.stage.$in[0]')],
    ['an undefined $null flag', { stage: { $null: undefined } }, UNDEFINED('where.stage.$null')],
    ['under $or (served EVERY row natively before)', { $or: [{ id: 'd3' }, { stage: { $ne: { a: 1 } } }] }, TYPE('where.$or[1].stage.$ne', 'a plain object')],
  ];

  for (const [name, where, opening] of REFUSED) {
    for (const [face, run] of FACES) {
      it(`${face}: ${name} is refused, and nothing reaches the database or the engine`, async () => {
        statements = 0;
        aggregates = 0;
        let err: Refusal | undefined;
        let served: string[] | undefined;
        try {
          served = await run(where);
        } catch (e) {
          err = e as Refusal;
        }
        expect(served, `${face}: expected a refusal, got rows`).toBeUndefined();
        expectEnvelope(err as Refusal);
        expect((err as Refusal).message.startsWith(opening), (err as Refusal).message).toBe(true);
        expect(statements).toBe(0);
        expect(aggregates).toBe(0);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20035] a STORED dataset carrying an off-set comparand is refused on every service door', () => {
  // A plain object is the off-set comparand a stored (JSON) dataset can carry.
  const BASE = DatasetSchema.parse({
    name: 'deal_metrics',
    label: 'Deal Metrics',
    object: OBJECT,
    dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'deal_count', label: 'Deals', aggregate: 'count' }],
  }) as Dataset;
  const withScope = (filter: unknown): Dataset => ({ ...BASE, filter } as Dataset);
  const withMeasureFilter = (filter: unknown): Dataset =>
    ({ ...BASE, measures: [{ ...BASE.measures[0], filter }] } as Dataset);

  function service(preview: boolean) {
    const calls = { aggregate: 0, raw: 0 };
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => {
        calls.aggregate++;
        return [{ stage: 'won', deal_count: 1 }];
      },
      executeRawSql: async () => {
        calls.raw++;
        return [];
      },
      ...(preview ? { draftRowsResolver: async () => ROWS.map((r) => ({ ...r })) } : {}),
    });
    return { svc, calls };
  }

  const DOORS: Array<[string, (ds: Dataset) => Promise<unknown>]> = [
    ['queryDataset (the dashboard door)', (ds) => service(false).svc.queryDataset!(ds, { measures: ['deal_count'], dimensions: ['stage'] })],
    ['queryDataset over a pending seed draft (the draft preview)', (ds) => service(true).svc.queryDataset!(ds, { measures: ['deal_count'], dimensions: ['stage'] }, undefined, { previewDrafts: true })],
  ];

  // The path prefix depends on how each door composes the stored filter into
  // the condition it lowers, so the position is asserted from the field on.
  const STORED: Array<[string, (f: unknown) => Dataset, unknown, string]> = [
    ['the dataset scope filter, a plain object under $ne', withScope, { stage: { $ne: { a: 1 } } }, '.stage.$ne is a plain object ({"a":1})'],
    ['a measure filter, a plain-object $in member', withMeasureFilter, { stage: { $in: [{ a: 1 }] } }, '.stage.$in[0] is a plain object ({"a":1})'],
  ];

  for (const [label, filterOf, where, position] of STORED) {
    for (const [door, run] of DOORS) {
      it(`${door}: ${label} → INVALID_FILTER / 400`, async () => {
        let err: Refusal | undefined;
        try {
          await run(filterOf(where));
        } catch (e) {
          err = e as Refusal;
        }
        expectEnvelope(err as Refusal);
        expect((err as Refusal).message.startsWith('Filter comparand at where'), (err as Refusal).message).toBe(true);
        expect((err as Refusal).message).toContain(position);
      });
    }
  }

  it('the registered cube on the ObjectQL door refuses before engine.aggregate runs', async () => {
    const { svc, calls } = service(false);
    svc.registerDataset(withScope({ stage: { $ne: { a: 1 } } }));
    let err: Refusal | undefined;
    try {
      await svc.query({ cube: 'deal_metrics', measures: ['deal_count'] } as AnalyticsQuery);
    } catch (e) {
      err = e as Refusal;
    }
    expectEnvelope(err as Refusal);
    expect(calls.aggregate).toBe(0);
  });

  it('CONTROL: the same dataset with an accepted comparand answers on the dashboard door', async () => {
    const { svc, calls } = service(false);
    const result = (await svc.queryDataset!(
      withScope({ stage: { $ne: 'lost' } }),
      { measures: ['deal_count'], dimensions: ['stage'] },
    )) as { rows: unknown[] };
    expect(result.rows.length).toBeGreaterThan(0);
    expect(calls.aggregate).toBeGreaterThan(0);
  });
});
