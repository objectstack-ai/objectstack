// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21066] On a field DECLARED JSON-stored — a `multiple: true` field, an
 * inherently multi-value option type (`tags`) or a structured-JSON type
 * (`json`) — this driver REFUSES the scalar-comparison family `driver-sql`'s
 * `where` refuses (#7398) and the engine's per-aggregation `filter` refuses
 * (#21007): `INVALID_FILTER` / 400, in the same words, read from the one set
 * and sentence `@objectstack/core` holds. `$contains` / `$notContains`
 * (membership), the null predicates and `$empty` keep answering.
 *
 * ## The defect, measured through `engine.find` before the change
 *
 * `origin/main` `670680e93`, a real `ObjectQL` over this driver, the six rows
 * below (#21004's fixture). The SQL family refuses every one of these 400
 * `INVALID_FILTER`; this driver answered each PER ELEMENT, through mingo's array
 * semantics:
 *
 * | `where` | before | now |
 * |:--|:--|:--|
 * | `owners` `$eq 'u1'` | `d1`, `d3` | 400 |
 * | `owners` `$in ['u1','u9']` | `d1`, `d3` | 400 |
 * | `owners` `$nin ['u1','u9']` | `d2`, `d4`, `d5`, `d6` | 400 |
 * | `owners` `$gt 'u1'` | `d1`, `d2`, `d3`, `d5` | 400 |
 * | `tags` `$gt 'red'` | `d3` | 400 |
 * | `owners` `$contains 'u1'` (the prescription, the control) | `d1`, `d3` | `d1`, `d3` |
 *
 * The analytics (cube) face answered the same rows, and its SQL echo rendered
 * `owners = 'u1'` — a statement that, run over the JSON text the SQL family
 * stores, returns none. The engine's run was a one-off: this package may not
 * import the engine (`check:driver-memory-census`), so what is pinned here is
 * the `where` the engine hands the driver, recorded in that run — the card's
 * operators as written, and `$ne` / `$nin` inside the spec's null-safe lowering
 * (`{ $and: [{ $or: [{ f: { $null: true } }, { f: { $nin: [...] } }] }] }`).
 *
 * ## Why the words are compared, not just the code
 *
 * The refusal is ONE refusal across backends, so a caller swapping this driver
 * for SQL must see the same body. The message is asserted equal to
 * `jsonColumnOperatorRefusalText`'s — imported, so the sentence has no copy
 * here — on top of `code` and `status`.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, jsonColumnOperatorRefusalText } from '@objectstack/core';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import {
  assertFilterConditionShape,
  DRIVER_FILTER_CAPABILITIES,
  SUPPORTED_FIELD_OPERATORS,
} from './filter-refusal.js';

const OBJECT = 'mem21066_doc';

const FIELDS = {
  title: { type: 'text' },
  owners: { type: 'lookup', reference: 'mem21066_user', multiple: true },
  tags: { type: 'tags' },
  meta: { type: 'json' },
} as const;

/** #21004's six rows, plus a `json` column. */
const ROWS = [
  { id: 'd1', title: 'u1 memo', owners: ['u1', 'u2'], tags: ['red', 'blue'], meta: ['a'] },
  { id: 'd2', title: 'none', owners: ['u2'], tags: ['blue'], meta: { k: 'a' } },
  { id: 'd3', title: 'about u10', owners: ['u3', 'u1'], tags: ['redwood'], meta: 'a' },
  { id: 'd4', title: 'x', owners: [], tags: [], meta: [] },
  { id: 'd5', title: 'u1', owners: ['u10'], tags: ['red'], meta: null },
  { id: 'd6', title: null, owners: null, tags: null, meta: null },
] as const;

const byId = (a: string, b: string) => a.localeCompare(b);

interface Refusal {
  code?: string;
  status?: number;
  message?: string;
}

async function refusalOf(run: () => unknown): Promise<Refusal | 'answered'> {
  try {
    await run();
    return 'answered';
  } catch (err) {
    const e = err as Refusal;
    return { code: e.code, status: e.status, message: e.message };
  }
}

/** What the SQL family answers for the same filter — the shared text, never a copy. */
function sharedRefusal(field: string, op: string, bare: boolean): Refusal {
  return { code: 'INVALID_FILTER', status: 400, message: jsonColumnOperatorRefusalText(field, op, bare).message };
}

async function seed({ declare = true } = {}): Promise<{ driver: InMemoryDriver; warn: ReturnType<typeof vi.spyOn> }> {
  const driver = new InMemoryDriver({ persistence: false });
  await driver.connect();
  if (declare) await driver.syncSchema(OBJECT, { name: OBJECT, fields: FIELDS } as never);
  for (const row of ROWS) await driver.create(OBJECT, structuredClone({ ...row }) as never);
  const warn = vi.spyOn((driver as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger, 'warn')
    .mockImplementation(() => undefined);
  return { driver, warn };
}

const findIds = async (driver: InMemoryDriver, where: unknown): Promise<string[]> =>
  ((await driver.find(OBJECT, { where } as never)) as Array<Record<string, unknown>>).map((r) => String(r.id)).sort(byId);

/** A comparand an author could write for `op` on `field` — a list for the list operators, a pair for `$between`. */
function comparandFor(op: string, field: string): unknown {
  const [a, b] = field === 'owners' ? ['u1', 'u9'] : field === 'tags' ? ['red', 'green'] : ['a', 'b'];
  if (op === '$in' || op === '$nin') return [a, b];
  if (op === '$between') return [a, b];
  return a;
}

/**
 * The family as THIS driver's FilterCondition vocabulary spells it: every
 * member of the shared set the shape gate admits as an operator. The bare infix
 * spellings (`=`, `in`, …) are not FilterCondition operators here and are
 * refused by the vocabulary gate before this one; they are the AST door's.
 */
const FAMILY = [...JSON_COLUMN_INCOMPATIBLE_OPERATORS].filter((op) => SUPPORTED_FIELD_OPERATORS.has(op));

/** The card's table: [name, where, field, operator the refusal names, bare?]. */
const CARD: ReadonlyArray<readonly [string, Record<string, unknown>, string, string, boolean]> = [
  ["owners $eq 'u1'", { owners: { $eq: 'u1' } }, 'owners', '$eq', false],
  ["owners $in ['u1','u9']", { owners: { $in: ['u1', 'u9'] } }, 'owners', '$in', false],
  ["owners $nin ['u1','u9'] (as the engine lowers it)", { $and: [{ $or: [{ owners: { $null: true } }, { owners: { $nin: ['u1', 'u9'] } }] }] }, 'owners', '$nin', false],
  ["owners $gt 'u1'", { owners: { $gt: 'u1' } }, 'owners', '$gt', false],
  ["tags $gt 'red'", { tags: { $gt: 'red' } }, 'tags', '$gt', false],
];

/** Shapes of the family beyond one operator — every one refused, as `driver-sql`'s `where` refuses it. */
function shapes(field: string): ReadonlyArray<readonly [string, Record<string, unknown>, string, boolean]> {
  const a = comparandFor('$eq', field);
  return [
    ['implicit equality', { [field]: a }, '=', true],
    ['implicit equality with null', { [field]: null }, '=', true],
    ['$eq null', { [field]: { $eq: null } }, '$eq', false],
    ['$ne null', { [field]: { $ne: null } }, '$ne', false],
    ['$ne, as the engine lowers it', { $and: [{ $or: [{ [field]: { $null: true } }, { [field]: { $ne: a } }] }] }, '$ne', false],
    ['$in []', { [field]: { $in: [] } }, '$in', false],
    ['$nin []', { [field]: { $nin: [] } }, '$nin', false],
    ['$in under $not', { $not: { [field]: { $in: [a] } } }, '$in', false],
    ['$nin in an $or branch after one that holds', { $or: [{ title: 'x' }, { [field]: { $nin: [a] } }] }, '$nin', false],
    ['$eq beside $contains on the same field', { [field]: { $contains: a, $eq: a } }, '$eq', false],
  ];
}

describe('[#21066] InMemoryDriver refuses the scalar-comparison family on a declared JSON-stored field', () => {
  let driver: InMemoryDriver;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    ({ driver, warn } = await seed());
  });

  it('the fixture holds all six rows, and the family it iterates is the shared set, at least the nine $-spellings', async () => {
    expect(await findIds(driver, {})).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);
    // A floor, not an equality: a member the shared set gains (a later card
    // widening it) is pinned here by the loops below without editing this file.
    expect(FAMILY).toEqual(expect.arrayContaining(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$between', '$in', '$nin']));
  });

  for (const [name, where, field, op, bare] of CARD) {
    it(`the card: ${name} → 400 INVALID_FILTER in the SQL family's words`, async () => {
      expect(await refusalOf(() => driver.find(OBJECT, { where } as never))).toEqual(sharedRefusal(field, op, bare));
    });
  }

  for (const field of ['owners', 'tags', 'meta']) {
    for (const op of FAMILY) {
      it(`${field} ${op} → refused`, async () => {
        const where = { [field]: { [op]: comparandFor(op, field) } };
        expect(await refusalOf(() => driver.find(OBJECT, { where } as never))).toEqual(sharedRefusal(field, op, false));
      });
    }
    for (const [name, where, op, bare] of shapes(field)) {
      it(`${field}: ${name} → refused`, async () => {
        expect(await refusalOf(() => driver.find(OBJECT, { where } as never))).toEqual(sharedRefusal(field, op, bare));
      });
    }
  }

  it('every filter door of the query path refuses — count, findOne, updateMany and deleteMany — and a write leaves the table untouched', async () => {
    const where = { owners: { $nin: ['u1'] } };
    const expected = sharedRefusal('owners', '$nin', false);
    expect(await refusalOf(() => driver.count(OBJECT, { where } as never))).toEqual(expected);
    expect(await refusalOf(() => driver.findOne(OBJECT, { where } as never))).toEqual(expected);
    expect(await refusalOf(() => driver.updateMany(OBJECT, { where } as never, { title: 'clobbered' }))).toEqual(expected);
    expect(await refusalOf(() => driver.deleteMany(OBJECT, { where } as never))).toEqual(expected);
    const rows = (await driver.find(OBJECT, {} as never)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id).sort()).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);
    expect(rows.some((r) => r.title === 'clobbered')).toBe(false);
  });

  it('the message withholds the field and the operator; the diagnostic, with its position, goes to the server log', async () => {
    warn.mockClear();
    const got = await refusalOf(() => driver.find(OBJECT, { where: { $or: [{ title: 'x' }, { owners: { $gte: 'u1' } }] } } as never));
    expect(got).toEqual(sharedRefusal('owners', '$gte', false));
    const message = (got as Refusal).message!;
    expect(message).not.toContain('owners');
    expect(message).not.toContain('$gte');
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain('At filter.$or[1].owners.$gte: ');
    expect(line).toContain(jsonColumnOperatorRefusalText('owners', '$gte', false).diagnostic);
  });

  it('a comparand the gate already refuses is still told about its COMPARAND first — driver-sql\'s order', async () => {
    // An array under a single-value operator, and a one-element `$between`:
    // both `INVALID_FILTER` / 400 already, in their own words.
    const array = await refusalOf(() => driver.find(OBJECT, { where: { owners: { $eq: ['u1'] } } } as never));
    expect(array).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    expect((array as Refusal).message).toContain('requires a single comparable value');
    const between = await refusalOf(() => driver.find(OBJECT, { where: { owners: { $between: ['u1'] } } } as never));
    expect(between).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    expect((between as Refusal).message).toContain('requires a [min, max] value array');
  });

  // The other half of the contract: what still answers on the same fields.
  const ANSWERED: ReadonlyArray<readonly [string, Record<string, unknown>, readonly string[]]> = [
    ["owners $contains 'u1' — the prescription", { owners: { $contains: 'u1' } }, ['d1', 'd3']],
    ['an $or of $contains — the any-of prescription', { $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u10' } }] }, ['d1', 'd3', 'd5']],
    ["owners $notContains 'u1', as the engine lowers it", { $and: [{ $or: [{ owners: { $null: true } }, { owners: { $notContains: 'u1' } }] }] }, ['d2', 'd4', 'd5', 'd6']],
    ["tags $contains 'red'", { tags: { $contains: 'red' } }, ['d1', 'd5']],
    ['owners $null: true', { owners: { $null: true } }, ['d6']],
    ['owners $exists: false', { owners: { $exists: false } }, ['d6']],
    ['owners $empty: true', { owners: { $empty: true } }, ['d4', 'd6']],
    ['meta $null: false', { meta: { $null: false } }, ['d1', 'd2', 'd3', 'd4']],
    ['title $in — a scalar column, untouched', { title: { $in: ['u1', 'none'] } }, ['d2', 'd5']],
    ["title implicit equality — a scalar column, untouched", { title: 'x' }, ['d4']],
    ["title $gt — a scalar column, untouched", { title: { $gt: 'u1' } }, ['d1', 'd4']],
  ];
  for (const [name, where, expected] of ANSWERED) {
    it(`still answered: ${name}`, async () => {
      expect(await findIds(driver, where)).toEqual([...expected]);
    });
  }
});

describe('[#21066] the population is the DECLARATION', () => {
  it('an object never passed through syncSchema is not judged — the per-element answer it always had, as driver-sql answers a table it was never told about', async () => {
    const { driver } = await seed({ declare: false });
    expect(await findIds(driver, { owners: { $eq: 'u1' } })).toEqual(['d1', 'd3']);
    expect(await findIds(driver, { tags: { $gt: 'red' } })).toEqual(['d3']);
  });

  it('a declared SCALAR field is not judged by the row it holds: a text column holding an array still answers', async () => {
    const driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema('mem21066_scalar', { fields: { label: { type: 'text' } } } as never);
    await driver.create('mem21066_scalar', { id: 's1', label: ['a', 'b'] } as never);
    const rows = (await driver.find('mem21066_scalar', { where: { label: { $eq: 'a' } } } as never)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual(['s1']);
  });

  it('the shared shape gate refuses only when it is handed the declarations, and reports before it throws', () => {
    const reported: string[] = [];
    const declarations = {
      isJsonStoredField: (field: string) => field === 'owners',
      reportWithheld: (diagnostic: string) => { reported.push(diagnostic); },
    };
    const where = { $not: { owners: { $in: ['u1'] } } };
    expect(() => assertFilterConditionShape(where, 'filter')).not.toThrow();
    expect(() => assertFilterConditionShape({ title: { $in: ['u1'] } }, 'filter', DRIVER_FILTER_CAPABILITIES, declarations)).not.toThrow();
    let thrown: Refusal | undefined;
    try {
      assertFilterConditionShape(where, 'filter', DRIVER_FILTER_CAPABILITIES, declarations);
    } catch (err) {
      thrown = err as Refusal;
    }
    expect({ code: thrown?.code, status: thrown?.status, message: thrown?.message }).toEqual(sharedRefusal('owners', '$in', false));
    expect(reported).toEqual([`At filter.$not.owners.$in: ${jsonColumnOperatorRefusalText('owners', '$in', false).diagnostic}`]);
  });
});

describe('[#21066] the analytics (cube) face refuses the same filters, and its SQL echo with it', () => {
  let service: MemoryAnalyticsService;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    const { driver } = await seed();
    const dimensions: Record<string, unknown> = { id: { label: 'Id', type: 'string', sql: 'id' } };
    for (const field of Object.keys(FIELDS)) dimensions[field] = { label: field, type: 'string', sql: field };
    const cube = {
      name: 'docs',
      title: 'Docs',
      sql: OBJECT,
      measures: { count: { label: 'Count', type: 'count', sql: 'id' } },
      dimensions,
    } as unknown as Cube;
    service = new MemoryAnalyticsService({ driver, cubes: [cube] });
    warn = vi.spyOn((service as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  const query = (where: unknown) => ({ cube: 'docs', measures: ['docs.count'], dimensions: ['docs.id'], where }) as never;

  for (const [name, where, field, op, bare] of [
    ...CARD.filter(([name]) => !name.includes('as the engine lowers it')),
    ["owners $nin ['u1','u9'] — the face lowers it itself", { owners: { $nin: ['u1', 'u9'] } }, 'owners', '$nin', false] as const,
    ["owners implicit equality 'u1'", { owners: 'u1' }, 'owners', '=', true] as const,
    ["the member spelled cube.member — docs.owners $in", { 'docs.owners': { $in: ['u1'] } }, 'docs.owners', '$in', false] as const,
  ]) {
    it(`${name} → refused by query() and by generateSql()`, async () => {
      const expected = sharedRefusal(field, op, bare);
      expect(await refusalOf(() => service.query(query(where)))).toEqual(expected);
      expect(await refusalOf(() => service.generateSql(query(where)))).toEqual(expected);
    });
  }

  it('the withheld half goes to the face\'s own log', async () => {
    warn.mockClear();
    await refusalOf(() => service.query(query({ tags: { $gt: 'red' } })));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(`At where.tags.$gt: ${jsonColumnOperatorRefusalText('tags', '$gt', false).diagnostic}`);
  });

  it("$contains still answers on the face — find()'s rows", async () => {
    const result = await service.query(query({ owners: { $contains: 'u1' } }));
    expect(result.rows.map((r: Record<string, unknown>) => String(r['docs.id'])).sort(byId)).toEqual(['d1', 'd3']);
  });
});
