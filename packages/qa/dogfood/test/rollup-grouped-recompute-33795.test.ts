// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33795 — a batch write recomputes its parents' roll-up `summary` fields with
 * ONE grouped aggregate per summary field and ONE write per parent, and the
 * values are the ones the per-parent recompute wrote.
 *
 * The real engine over a real `SqlDriver`, so a statement here is a statement
 * the database ran (knex's `query` event), never a driver call standing in for
 * one. Two cells: embedded SQLite always, and PostgreSQL when
 * `OS_TEST_POSTGRES_URL` names a server (a named skip otherwise).
 *
 * Two pins per cell:
 *
 *   1. Statement counts for a 50-row `createMany` over 10 parents and for a
 *      50-row engine `update` loop over 10 parents (the per-row writes the
 *      bulk data door issues), each with 0, 1 and 2 summary fields on the
 *      parent. Before #33795 each summary field cost 4 statements per parent
 *      the batch named (an aggregate, two parent reads, one parent write),
 *      once per field; after it, a batch costs one aggregate per field plus
 *      one write per parent carrying every field.
 *   2. Value parity across every summary kind — count, sum, min, max, avg, and
 *      a filtered count and sum — after inserts, a re-parent, an update loop,
 *      a predicate update and a predicate delete: every parent's stored value
 *      equals the one-parent aggregate `aggregateSummaryValue` (the computation
 *      the per-parent recompute ran, unchanged) and a hand count of the rows.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL, aggregateSummaryValue } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { installDefaultOrganization } from './default-organization.testkit.js';

const PG_URL = process.env.OS_TEST_POSTGRES_URL;

const CELLS = [
  {
    name: 'sqlite (better-sqlite3 :memory:)',
    url: 'sqlite',
    make: () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
  },
  {
    name: 'postgresql (OS_TEST_POSTGRES_URL)',
    url: PG_URL,
    make: () => new SqlDriver({ client: 'pg', connection: PG_URL as string }),
  },
] as const;

const SYSTEM = { context: { userId: 'u_33795', isSystem: true } };

/** A parent with `n` summary fields over its master-detail child, the bench's `rollupPair` shape. */
function rollupPair(n: 0 | 1 | 2) {
  const parent = `r33795_roll${n}`;
  const child = `${parent}_item`;
  const summaries: Record<string, unknown> = {};
  if (n >= 1) summaries.total_quantity = { type: 'summary', label: 'Total quantity', summaryOperations: { object: child, field: 'quantity', function: 'sum' } };
  if (n >= 2) summaries.item_count = { type: 'summary', label: 'Item count', summaryOperations: { object: child, function: 'count' } };
  return [
    { name: parent, label: `Roll-up parent (${n})`, fields: { name: { type: 'text', label: 'Name' }, ...summaries } },
    {
      name: child,
      label: `Roll-up item (${n})`,
      fields: {
        name: { type: 'text', label: 'Name' },
        parent: { type: 'master_detail', label: 'Parent', reference: parent, deleteBehavior: 'cascade' },
        quantity: { type: 'number', label: 'Quantity' },
      },
    },
  ];
}

/** Every summary kind over one child, filtered ones included. */
const KIND_PARENT = 'r33795_kinds';
const KIND_CHILD = 'r33795_kinds_item';
const KIND_FIELDS = {
  n_count: { function: 'count' },
  q_sum: { function: 'sum', field: 'quantity' },
  q_min: { function: 'min', field: 'quantity' },
  q_max: { function: 'max', field: 'quantity' },
  q_avg: { function: 'avg', field: 'quantity' },
  open_count: { function: 'count', filter: { status: 'open' } },
  open_sum: { function: 'sum', field: 'quantity', filter: { status: 'open' } },
} as const;
const KIND_OBJECTS = [
  {
    name: KIND_PARENT,
    label: 'Kinds parent',
    fields: {
      name: { type: 'text', label: 'Name' },
      ...Object.fromEntries(Object.entries(KIND_FIELDS).map(([key, op]) => [
        key, { type: 'summary', label: key, summaryOperations: { object: KIND_CHILD, ...op } },
      ])),
    },
  },
  {
    name: KIND_CHILD,
    label: 'Kinds item',
    fields: {
      name: { type: 'text', label: 'Name' },
      parent: { type: 'master_detail', label: 'Parent', reference: KIND_PARENT, deleteBehavior: 'cascade' },
      quantity: { type: 'number', label: 'Quantity' },
      status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }] },
    },
  },
];

const OBJECTS = [...rollupPair(0), ...rollupPair(1), ...rollupPair(2), ...KIND_OBJECTS];

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(make: () => SqlDriver): Promise<{ engine: ObjectQL; driver: SqlDriver }> {
  const driver = make();
  await driver.connect();
  for (const def of [...OBJECTS].reverse()) await driver.getKnex().schema.dropTableIfExists(def.name);
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();
  for (const def of OBJECTS) engine.registry.registerObject(def as never, '@objectstack/dogfood', 'r33795');
  await engine.syncSchemas();
  await installDefaultOrganization(engine as never);
  return { engine, driver };
}

/** Run `fn` and count the statements the database ran meanwhile. */
async function statementsOf(driver: SqlDriver, fn: () => Promise<unknown>): Promise<number> {
  let n = 0;
  const knex = driver.getKnex();
  const listen = () => { n += 1; };
  knex.on('query', listen);
  try { await fn(); } finally { knex.removeListener('query', listen); }
  return n;
}

async function seedParents(engine: ObjectQL, object: string, count: number): Promise<string[]> {
  const rows = await engine.insert(object, Array.from({ length: count }, (_, i) => ({ name: `p${i}` })), SYSTEM) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

const BATCH = 50;
const PARENTS = 10;

describe.each(CELLS)('roll-up grouped recompute (#33795): $name', ({ url, make }) => {
  const skip = !url;

  it.skipIf(skip)('a batch costs one aggregate per summary field and one write per parent', async () => {
    const { engine, driver } = await boot(make);
    const measured: Record<string, Record<number, number>> = { createMany: {}, updateLoop: {} };
    for (const n of [0, 1, 2] as const) {
      const parent = `r33795_roll${n}`;
      const child = `${parent}_item`;
      const parents = await seedParents(engine, parent, PARENTS);
      let created: Array<{ id: string }> = [];
      measured.createMany[n] = await statementsOf(driver, async () => {
        created = await engine.insert(child, Array.from({ length: BATCH }, (_, k) => ({
          name: `c${k}`, parent: parents[k % PARENTS], quantity: 1 + (k % 5),
        })), SYSTEM) as Array<{ id: string }>;
      });
      measured.updateLoop[n] = await statementsOf(driver, async () => {
        for (const [k, row] of created.entries()) {
          await engine.update(child, { quantity: 2 + (k % 7) }, { where: { id: row.id }, ...SYSTEM });
        }
      });
    }
    // The control: no summary field, no recompute — the base the others add to.
    const base = { createMany: measured.createMany[0], updateLoop: measured.updateLoop[0] };
    // createMany: one aggregate per field, then one write per parent
    // (3 statements: the update and its two reads of the parent row).
    expect(measured.createMany[1] - base.createMany, JSON.stringify(measured)).toBe(1 + PARENTS * 3);
    expect(measured.createMany[2] - base.createMany, JSON.stringify(measured)).toBe(2 + PARENTS * 3);
    // The per-row update loop names one parent per row: per row, one
    // aggregate per field and one write carrying every field.
    expect(measured.updateLoop[1] - base.updateLoop, JSON.stringify(measured)).toBe(BATCH * (1 + 3));
    expect(measured.updateLoop[2] - base.updateLoop, JSON.stringify(measured)).toBe(BATCH * (2 + 3));
    console.log(`[#33795] statements ${url === 'sqlite' ? 'sqlite' : 'postgresql'}: ${JSON.stringify(measured)}`);
  });

  it.skipIf(skip)('every summary kind lands the value the one-parent aggregate computes', async () => {
    const { engine } = await boot(make);
    const parents = await seedParents(engine, KIND_PARENT, 6);
    const rows = await engine.insert(KIND_CHILD, Array.from({ length: 40 }, (_, k) => ({
      name: `k${k}`,
      // Parent 5 never gets a child: its min/max/avg stay null, count/sum 0.
      parent: parents[k % 5],
      quantity: k % 4 === 0 ? null : (k * 7) % 11 - 3,
      status: k % 3 === 0 ? 'open' : 'closed',
    })), SYSTEM) as Array<{ id: string }>;

    const check = async (stage: string) => {
      const children = await engine.find(KIND_CHILD, { where: {}, limit: 1000 }, SYSTEM) as Array<Record<string, any>>;
      for (const id of parents) {
        const stored = await engine.findOne(KIND_PARENT, { where: { id } }, SYSTEM) as Record<string, any>;
        for (const [field, op] of Object.entries(KIND_FIELDS)) {
          const desc = {
            parentObject: KIND_PARENT, summaryField: field, childObject: KIND_CHILD, fkField: 'parent',
            fn: op.function, sourceField: 'field' in op ? op.field : undefined, filter: 'filter' in op ? op.filter : undefined,
          } as const;
          const oneParent = await aggregateSummaryValue(engine as never, desc as never, id, SYSTEM.context);
          const at = `${stage}: ${field} of parent ${parents.indexOf(id)}`;
          expect(num(stored[field]), at).toEqual(num(oneParent));
          expect(num(stored[field]), `${at} (hand count)`).toEqual(handValue(children, id, op));
        }
      }
    };
    await check('after createMany');

    // A re-parent moves rows between parents: both sides recompute.
    await engine.update(KIND_CHILD, { parent: parents[1] }, { where: { id: rows[0].id }, ...SYSTEM });
    await check('after a re-parent');

    // The bulk door's loop: one engine update per row.
    for (const [k, row] of rows.slice(0, 20).entries()) {
      await engine.update(KIND_CHILD, { quantity: k - 5, status: k % 2 ? 'open' : 'closed' }, { where: { id: row.id }, ...SYSTEM });
    }
    await check('after an update loop');

    // A predicate update and a predicate delete name many parents in one call.
    await engine.update(KIND_CHILD, { status: 'open' }, { where: { quantity: { $gt: 2 } }, multi: true, ...SYSTEM } as never);
    await check('after a predicate update');
    await engine.delete(KIND_CHILD, { where: { status: 'closed' }, multi: true, ...SYSTEM } as never);
    await check('after a predicate delete');
  });
});

/** A stored number as a number: PostgreSQL may answer a numeric aggregate as text. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1e9) / 1e9 : NaN;
}

function handValue(children: Array<Record<string, any>>, parentId: string, op: { function: string; field?: string; filter?: { status: string } }): number | null {
  const mine = children.filter((c) => c.parent === parentId && (!op.filter || c.status === op.filter.status));
  if (op.function === 'count') return mine.length;
  const values = mine.map((c) => c[op.field as string]).filter((v) => v != null).map(Number);
  if (op.function === 'sum') return values.reduce((a, b) => a + b, 0);
  if (values.length === 0) return null;
  if (op.function === 'min') return Math.min(...values);
  if (op.function === 'max') return Math.max(...values);
  return num(values.reduce((a, b) => a + b, 0) / values.length);
}
