// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22300] A `formula` field in a `fields` projection widens the DRIVER read to
 * every stored column (`planFormulaProjection`: CEL's `record.<field>` must see
 * the whole row), and the rows are cut back to the caller's projection once
 * the read is done. The formula still sees the full row; the caller does not.
 *
 * The table: {a projection naming a formula, one naming none, no projection}
 * × {`find`, `findOne`}, each asserting the EXACT key set a row leaves with.
 * The driver honours a projection the way driver-sql does — exactly the named
 * columns, nothing it was not asked for — so the projection WITHOUT a formula
 * is the reference: the row with a formula equals that row plus the formula's
 * value, key for key and value for value.
 *
 * The rows the driver stores carry the columns the registry provisions on
 * every business object (tenant, owner, owning unit, the audit actors and
 * timestamps); none of them is requested, so none may leave a projected read.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

import '@objectstack/spec';
import '@objectstack/formula';

type Row = Record<string, unknown>;

const OBJECT = 'fpt_line_item';

/** The stored row: two requested inputs, the formula's inputs, and the provisioned columns. */
const STORED: Row = {
  id: 'li_1',
  name: 'Widget',
  quantity: 3,
  unit_price: 7,
  note: 'not requested',
  parent_id: 'opp_1',
  organization_id: 'org_1',
  owner_id: 'usr_1',
  owning_business_unit_id: 'bu_1',
  created_by: 'usr_1',
  updated_by: 'usr_1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

/**
 * A driver that answers a projection the way driver-sql does — exactly the
 * named columns, a stored NULL as `null` — and records every projection it was
 * handed, so a case can see what the formula was evaluated against. Shallow
 * copies only: the formula pass writes onto the rows a driver returns.
 */
function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  storeFor(OBJECT).set(String(STORED.id), { ...STORED });
  const projections: Array<string[] | undefined> = [];
  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where as Row).every(([k, v]) => {
      if (k === '$and') return (v as unknown[]).every((w) => matches(row, w));
      if (k === '$or') return (v as unknown[]).some((w) => matches(row, w));
      // Any other combinator is REFUSED, never read as a field name
      // (`check:where-matcher`).
      if (k.startsWith('$')) throw new Error(`test driver: unsupported combinator ${k}`);
      const cond = v as Row | null;
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$in' in cond) return Array.isArray(cond.$in) && cond.$in.includes(row[k]);
        if ('$eq' in cond) return row[k] === cond.$eq;
        throw new Error(`test driver: unsupported condition on ${k}`);
      }
      return row[k] === cond;
    });
  };
  const project = (row: Row, fields: unknown): Row => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    return Object.fromEntries((fields as string[]).map((f) => [f, row[f] ?? null]));
  };
  const driver: any = {
    name: 'sql-shaped', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const matched = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // Hold the caller's bound (`check:objectql-double-limit`).
      const bounded = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
      projections.push(Array.isArray(ast?.fields) ? [...ast.fields] : undefined);
      return bounded.map((r) => project(r, ast?.fields));
    },
    async findOne(object: string, ast: any) {
      const hit = Array.from(storeFor(object).values()).find((r) => matches(r, ast?.where));
      projections.push(Array.isArray(ast?.fields) ? [...ast.fields] : undefined);
      return hit ? project(hit, ast?.fields) : null;
    },
    async create() { throw new Error('test driver: reads only'); },
    async update() { throw new Error('test driver: reads only'); },
    async delete() { throw new Error('test driver: reads only'); },
    async count(object: string) { return storeFor(object).size; },
  };
  return { driver, projections };
}

async function boot() {
  const engine = new ObjectQL();
  const { driver, projections } = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: OBJECT,
    label: 'Line Item',
    fields: {
      name: { name: 'name', type: 'text' },
      quantity: { name: 'quantity', type: 'number' },
      unit_price: { name: 'unit_price', type: 'number' },
      note: { name: 'note', type: 'text' },
      parent_id: { name: 'parent_id', type: 'text' },
      // Reads two columns the projections below never name.
      total_price: { name: 'total_price', type: 'formula', expression: { dialect: 'cel', source: 'record.quantity * record.unit_price' } },
    },
  } as never, 'test');
  return { engine, projections };
}

type Verb = 'find' | 'findOne';
const SYS = { isSystem: true } as const;

async function readOne(engine: ObjectQL, verb: Verb, fields?: string[]): Promise<Row> {
  const query = { where: { id: STORED.id }, ...(fields ? { fields } : {}), context: SYS };
  if (verb === 'findOne') {
    const row = await engine.findOne(OBJECT, query as never);
    expect(row, 'findOne found no row').not.toBeNull();
    return row as Row;
  }
  const rows = await engine.find(OBJECT, query as never);
  expect(rows).toHaveLength(1);
  return rows[0] as Row;
}

const PROVISIONED = [
  'organization_id', 'owner_id', 'owning_business_unit_id',
  'created_by', 'updated_by', 'created_at', 'updated_at',
];

describe.each<Verb>(['find', 'findOne'])('#22300 — %s: a formula in the projection widens the read, never the answer', (verb) => {
  it('a projection naming a formula field returns exactly the named fields, the formula computed from the full row', async () => {
    const { engine, projections } = await boot();
    const row = await readOne(engine, verb, ['name', 'total_price']);

    expect(Object.keys(row).sort()).toEqual(['name', 'total_price']);
    // 3 × 7: the formula read `quantity` and `unit_price`, neither of them named.
    expect(row.total_price).toBe(21);
    for (const col of [...PROVISIONED, 'id', 'quantity', 'unit_price', 'note', 'parent_id']) {
      expect(row, `'${col}' was not requested and left the read`).not.toHaveProperty(col);
    }
    // …and the driver WAS asked for the full row: the widening is intact, only
    // the answer is cut back.
    const asked = projections.at(-1);
    expect(asked).toEqual(expect.arrayContaining(['name', 'quantity', 'unit_price', 'id', ...PROVISIONED]));
    expect(asked).not.toContain('total_price');
  });

  it('the row equals the same projection without the formula, plus the formula value', async () => {
    const { engine } = await boot();
    const without = await readOne(engine, verb, ['name']);
    const withFormula = await readOne(engine, verb, ['name', 'total_price']);
    expect(withFormula).toStrictEqual({ ...without, total_price: 21 });
    expect(JSON.stringify(withFormula)).toBe(JSON.stringify({ ...without, total_price: 21 }));
  });

  it('a column the caller names is kept — `id` and a provisioned column included', async () => {
    const { engine } = await boot();
    const row = await readOne(engine, verb, ['id', 'owner_id', 'total_price']);
    expect(row).toStrictEqual({ id: 'li_1', owner_id: 'usr_1', total_price: 21 });
  });

  it('CONTROL: a projection naming no formula field is unchanged', async () => {
    const { engine, projections } = await boot();
    const row = await readOne(engine, verb, ['name', 'quantity']);
    expect(row).toStrictEqual({ name: 'Widget', quantity: 3 });
    expect(projections.at(-1)).toEqual(['name', 'quantity']);
  });

  it('CONTROL: a read with no projection is unchanged — every declared column, the formula computed', async () => {
    const { engine, projections } = await boot();
    const row = await readOne(engine, verb);
    expect(row).toStrictEqual({ ...STORED, total_price: 21 });
    expect(projections.at(-1)).toBeUndefined();
  });

  it('a key an afterFind hook derives is the hook\'s, and survives the cut', async () => {
    const { engine } = await boot();
    engine.registerHook('afterFind', (ctx: any) => {
      const list = Array.isArray(ctx.result) ? ctx.result : [ctx.result];
      for (const r of list) if (r) r.line_label = `${r.name} x${r.quantity}`;
    }, { object: OBJECT } as never);
    const row = await readOne(engine, verb, ['name', 'total_price']);
    // The hook ran on the widened row (it read `quantity`, unrequested); its
    // own key survives, the column it read does not.
    expect(row).toStrictEqual({ name: 'Widget', total_price: 21, line_label: 'Widget x3' });
  });
});
