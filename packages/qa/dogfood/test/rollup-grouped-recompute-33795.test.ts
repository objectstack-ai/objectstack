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
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
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

/**
 * [#33795, ruling 6928862195 B] A supplier whose contacts' rules read its
 * roll-ups, one child object per summary function so each rule moves alone:
 * "at most one primary contact" over a filtered `count`, and a bound on a
 * contact's score against the supplier's current `avg`, `min` and `max`.
 */
const RULE_SUPPLIER = 'r33795_rsup';
const RULE_CHILDREN = {
  count: { object: 'r33795_rsup_primary', summary: 'primary_count', op: { function: 'count', filter: { is_primary: true } } },
  avg: { object: 'r33795_rsup_avg', summary: 'score_avg', op: { function: 'avg', field: 'score' } },
  min: { object: 'r33795_rsup_min', summary: 'score_min', op: { function: 'min', field: 'score' } },
  max: { object: 'r33795_rsup_max', summary: 'score_max', op: { function: 'max', field: 'score' } },
} as const;
const RULE_TEXT = {
  count: 'A supplier has at most one primary contact.',
  avg: 'A score may not exceed the supplier average by more than 2.',
  min: 'A score may not fall more than 1 below the supplier minimum.',
  max: 'A score may not rise more than 1 above the supplier maximum.',
} as const;
const RULE_CONDITION = {
  count: 'record.is_primary == true && record.supplier.primary_count > 0',
  avg: 'record.supplier.score_avg != null && record.score > record.supplier.score_avg + 2.0',
  min: 'record.supplier.score_min != null && record.score < record.supplier.score_min - 1.0',
  max: 'record.supplier.score_max != null && record.score > record.supplier.score_max + 1.0',
} as const;
const RULE_OBJECTS = [
  {
    name: RULE_SUPPLIER,
    label: 'Rule supplier',
    fields: {
      name: { type: 'text', label: 'Name' },
      ...Object.fromEntries(Object.values(RULE_CHILDREN).map(({ object, summary, op }) => [
        summary, { type: 'summary', label: summary, summaryOperations: { object, ...op } },
      ])),
    },
  },
  ...(Object.keys(RULE_CHILDREN) as Array<keyof typeof RULE_CHILDREN>).map((fn) => ({
    name: RULE_CHILDREN[fn].object,
    label: `Rule contact (${fn})`,
    fields: {
      name: { type: 'text', label: 'Name' },
      supplier: { type: 'lookup', label: 'Supplier', reference: RULE_SUPPLIER },
      is_primary: { type: 'boolean', label: 'Primary' },
      score: { type: 'number', label: 'Score' },
    },
    validations: [{ name: `rule_${fn}`, type: 'script', severity: 'error', message: RULE_TEXT[fn], condition: RULE_CONDITION[fn] }],
  })),
];

/**
 * [#33795, ruling 6928862195 B, class iii] An invoice whose OWN rule caps its
 * own roll-up: at most two lines. The recompute's write is an update of the
 * invoice, judged by that rule, so one by one it judges every intermediate
 * count.
 */
const CAP_TEXT = 'An invoice holds at most two lines.';
/**
 * The capped invoice and its lines. `rule` caps the count with a validation
 * rule; `computed` caps a stored computed field over it (`room = 2 -
 * line_count`, recomputed on the recompute's own write) with a rule; `bound`
 * declares `min: 0` on that field and has no rule at all; `option` declares
 * nothing: a stored select computed from the count names a value its option
 * list lacks past the cap, which the write refuses as it would any value.
 */
function capObjects(parent: string, line: string, mode: 'rule' | 'computed' | 'bound' | 'option') {
  const viaComputed = mode === 'computed' || mode === 'bound';
  return [
    {
      name: parent,
      label: `Capped invoice (${mode})`,
      fields: {
        name: { type: 'text', label: 'Name' },
        line_count: { type: 'summary', label: 'Lines', summaryOperations: { object: line, function: 'count' } },
        ...(viaComputed ? { room: { type: 'number', label: 'Room', expression: '2 - record.line_count', ...(mode === 'bound' ? { min: 0 } : {}) } } : {}),
        ...(mode === 'option' ? {
          fill: {
            type: 'select', label: 'Fill',
            options: [{ label: 'Open', value: 'open' }, { label: 'Full', value: 'full' }],
            expression: "record.line_count == null || record.line_count < 2 ? 'open' : (record.line_count == 2 ? 'full' : 'over')",
          },
        } : {}),
      },
      validations: mode === 'bound' || mode === 'option' ? [] : [{
        name: 'cap_lines', type: 'script', severity: 'error', message: CAP_TEXT,
        condition: viaComputed ? 'record.room != null && record.room < 0' : 'record.line_count != null && record.line_count > 2',
      }],
    },
    {
      name: line,
      label: `Capped invoice line (${mode})`,
      fields: {
        name: { type: 'text', label: 'Name' },
        invoice: { type: 'lookup', label: 'Invoice', reference: parent },
      },
    },
  ];
}
const CAP = { parent: 'r33795_cap', line: 'r33795_cap_line' };
const CCAP = { parent: 'r33795_ccap', line: 'r33795_ccap_line' };
const BCAP = { parent: 'r33795_bcap', line: 'r33795_bcap_line' };
const OCAP = { parent: 'r33795_ocap', line: 'r33795_ocap_line' };

/**
 * [#33795] A stored computed field of the CHILD that reads the parent's
 * summary one hop: `rank = owner.flagged_count`, stored at the line's own
 * write. One by one the second line stores the first line's recompute.
 */
const SEEN = 'r33795_seen';
const SEEN_LINE = 'r33795_seen_line';
const SEEN_OBJECTS = [
  {
    name: SEEN,
    label: 'Ranked owner',
    fields: {
      name: { type: 'text', label: 'Name' },
      flagged_count: { type: 'summary', label: 'Flagged', summaryOperations: { object: SEEN_LINE, function: 'count', filter: { flag: true } } },
    },
  },
  {
    name: SEEN_LINE,
    label: 'Ranked line',
    fields: {
      name: { type: 'text', label: 'Name' },
      owner: { type: 'lookup', label: 'Owner', reference: SEEN },
      flag: { type: 'boolean', label: 'Flag' },
      rank: { type: 'number', label: 'Rank', expression: 'record.owner.flagged_count' },
    },
  },
];

/**
 * [#33795, ruling 6928862195 B, through a computed field] (i) a contact's rule
 * reads the supplier's formula `slots = 1 - primary_count` one hop (the hop's
 * read computes formulas); (ii) a line's `readonlyWhen` reads the header's
 * stored computed field `room = 1 - flagged_count` on `parent` (the header is
 * read as stored). Neither rule names the summary.
 */
const FSUP = 'r33795_fsup';
const FSUP_CONTACT = 'r33795_fsup_contact';
const FSUP_TEXT = 'No primary slot is left on this supplier.';
const FHDR = 'r33795_fhdr';
const FHDR_LINE = 'r33795_fhdr_line';
const FORMULA_OBJECTS = [
  {
    name: FSUP,
    label: 'Formula supplier',
    fields: {
      name: { type: 'text', label: 'Name' },
      primary_count: { type: 'summary', label: 'Primaries', summaryOperations: { object: FSUP_CONTACT, function: 'count', filter: { is_primary: true } } },
      slots: { type: 'formula', label: 'Slots', returnType: 'number', expression: '1 - record.primary_count' },
    },
  },
  {
    name: FSUP_CONTACT,
    label: 'Formula supplier contact',
    fields: {
      name: { type: 'text', label: 'Name' },
      supplier: { type: 'lookup', label: 'Supplier', reference: FSUP },
      is_primary: { type: 'boolean', label: 'Primary' },
    },
    validations: [{ name: 'slots_left', type: 'script', severity: 'error', message: FSUP_TEXT, condition: 'record.is_primary == true && record.supplier.slots != null && record.supplier.slots < 1' }],
  },
  {
    name: FHDR,
    label: 'Formula header',
    fields: {
      name: { type: 'text', label: 'Name' },
      flagged_count: { type: 'summary', label: 'Flagged', summaryOperations: { object: FHDR_LINE, function: 'count', filter: { flag: true } } },
      room: { type: 'number', label: 'Room', expression: '1 - record.flagged_count' },
    },
  },
  {
    name: FHDR_LINE,
    label: 'Formula header line',
    fields: {
      name: { type: 'text', label: 'Name' },
      header: { type: 'master_detail', label: 'Header', reference: FHDR, deleteBehavior: 'cascade' },
      flag: { type: 'boolean', label: 'Flag' },
      note: { type: 'text', label: 'Note', readonlyWhen: 'parent.room != null && parent.room < 1' },
    },
  },
];

const OBJECTS = [
  ...rollupPair(0), ...rollupPair(1), ...rollupPair(2), ...KIND_OBJECTS, ...RULE_OBJECTS,
  ...capObjects(CAP.parent, CAP.line, 'rule'), ...capObjects(CCAP.parent, CCAP.line, 'computed'), ...capObjects(BCAP.parent, BCAP.line, 'bound'),
  ...capObjects(OCAP.parent, OCAP.line, 'option'),
  ...FORMULA_OBJECTS, ...SEEN_OBJECTS,
];

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

/**
 * [#33795] The second half: a bulk update through the data door
 * (`updateManyData`, and the update arm of `batchData`) runs its per-row loop
 * inside the engine's roll-up batch scope (`deferSummaryRecompute`, ruling
 * 6922040858), so the parents recompute once, when the loop has settled.
 *
 * Pins, per cell: the statement counts of a 50-row `updateManyData` over 10
 * parents with 0, 1 and 2 summary fields, with the member and on the same
 * engine with the member hidden (the per-row recompute a door degrades to);
 * and value parity for every summary kind through the door — non-atomic,
 * atomic, the generic batch door, a batch stopped by a failed row, and an
 * engine without the member.
 */
/** The engine with `deferSummaryRecompute` hidden for `fn`: what a door sees on an engine that lacks the member. */
async function withoutBatchScope<T>(engine: ObjectQL, fn: () => Promise<T>): Promise<T> {
  (engine as unknown as Record<string, unknown>).deferSummaryRecompute = undefined;
  try { return await fn(); } finally { delete (engine as unknown as Record<string, unknown>).deferSummaryRecompute; }
}

describe.each(CELLS)('roll-up batch deferral through the bulk update door (#33795): $name', ({ url, make }) => {
  const skip = !url;

  it.skipIf(skip)('a bulk update costs one aggregate per summary field and one write per parent', async () => {
    const { engine, driver } = await boot(make);
    const protocol = new ObjectStackProtocolImplementation(engine as never);
    const measured: Record<string, Record<number, number>> = { updateMany: {}, updateManyNoScope: {}, updateManyAtomic: {} };
    for (const n of [0, 1, 2] as const) {
      const parent = `r33795_roll${n}`;
      const child = `${parent}_item`;
      const parents = await seedParents(engine, parent, PARENTS);
      const created = await engine.insert(child, Array.from({ length: BATCH }, (_, k) => ({
        name: `c${k}`, parent: parents[k % PARENTS], quantity: 1 + (k % 5),
      })), SYSTEM) as Array<{ id: string }>;
      const records = (q: number) => created.map((row, k) => ({ id: row.id, data: { quantity: q + (k % 7) } }));
      for (const [key, run] of [
        ['updateMany', () => protocol.updateManyData({ object: child, records: records(2), context: SYSTEM.context } as never)],
        ['updateManyNoScope', () => withoutBatchScope(engine, () => protocol.updateManyData({ object: child, records: records(3), context: SYSTEM.context } as never))],
        ['updateManyAtomic', () => protocol.updateManyData({ object: child, records: records(4), options: { atomic: true }, context: SYSTEM.context } as never)],
      ] as const) {
        let answer: any;
        measured[key][n] = await statementsOf(driver, async () => { answer = await run(); });
        expect(answer, `${key} ${n}`).toMatchObject({ success: true, succeeded: BATCH });
      }
    }
    const delta = (key: string, n: number) => measured[key][n] - measured[key][0];
    // In the scope: one aggregate per field, then one write per parent
    // (3 statements: the update and its two reads of the parent row) — what
    // a createMany pays.
    for (const key of ['updateMany', 'updateManyAtomic']) {
      expect(delta(key, 1), `${key} ${JSON.stringify(measured)}`).toBe(1 + PARENTS * 3);
      expect(delta(key, 2), `${key} ${JSON.stringify(measured)}`).toBe(2 + PARENTS * 3);
    }
    // Without the member: today's per-row recompute, one per row.
    expect(delta('updateManyNoScope', 1), JSON.stringify(measured)).toBe(BATCH * (1 + 3));
    expect(delta('updateManyNoScope', 2), JSON.stringify(measured)).toBe(BATCH * (2 + 3));
    // The no-summary control costs the same either way.
    expect(measured.updateManyNoScope[0], JSON.stringify(measured)).toBe(measured.updateMany[0]);
    console.log(`[#33795] door statements ${url === 'sqlite' ? 'sqlite' : 'postgresql'}: ${JSON.stringify(measured)}`);
  });

  it.skipIf(skip)('every summary kind lands the one-parent aggregate through every bulk update door', async () => {
    const { engine } = await boot(make);
    const protocol = new ObjectStackProtocolImplementation(engine as never);
    const parents = await seedParents(engine, KIND_PARENT, 6);
    const rows = await engine.insert(KIND_CHILD, Array.from({ length: 40 }, (_, k) => ({
      name: `k${k}`, parent: parents[k % 5], quantity: k % 4 === 0 ? null : (k * 7) % 11 - 3, status: k % 3 === 0 ? 'open' : 'closed',
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
    // Each batch moves values, moves rows between parents (parent 5 gains
    // its first children) and in and out of the filters.
    const batch = (salt: number, slice: [number, number]) => rows.slice(...slice).map((row, k) => ({
      id: row.id,
      data: { quantity: (k * salt) % 9 - 2, status: (k + salt) % 2 ? 'open' : 'closed', ...(k % 4 === salt % 4 ? { parent: parents[(k + salt) % 6] } : {}) },
    }));

    let answer: any = await protocol.updateManyData({ object: KIND_CHILD, records: batch(1, [0, 20]), context: SYSTEM.context } as never);
    expect(answer).toMatchObject({ success: true, succeeded: 20 });
    await check('after updateManyData');

    answer = await protocol.updateManyData({ object: KIND_CHILD, records: batch(2, [10, 30]), options: { atomic: true }, context: SYSTEM.context } as never);
    expect(answer).toMatchObject({ success: true, succeeded: 20 });
    await check('after an atomic updateManyData');

    answer = await protocol.batchData({ object: KIND_CHILD, request: { operation: 'update', records: batch(3, [20, 40]) }, context: SYSTEM.context } as never);
    expect(answer).toMatchObject({ success: true, succeeded: 20 });
    await check('after batchData update');

    // Stopped by a failed row (an id naming no record, no continueOnError):
    // the rows before it landed, and their parents are recomputed.
    const stopped = batch(5, [0, 12]);
    stopped.splice(6, 0, { id: 'no_such_row_33795', data: { quantity: 1, status: 'open' } });
    answer = await protocol.updateManyData({ object: KIND_CHILD, records: stopped, context: SYSTEM.context } as never);
    expect(answer).toMatchObject({ success: false, succeeded: 6 });
    await check('after a bulk update stopped by a failed row');

    // An engine without the member: the per-row recompute, the same values.
    answer = await withoutBatchScope(engine, () => protocol.updateManyData({ object: KIND_CHILD, records: batch(7, [5, 35]), context: SYSTEM.context } as never));
    expect(answer).toMatchObject({ success: true, succeeded: 30 });
    await check('after updateManyData on an engine without the member');
  });
});

/**
 * [#33795, ruling 6928862195 B] A roll-up a rule reads is not deferred: a
 * bulk update through the real door answers what single updates answer, row
 * for row, for a filtered `count` and for `avg`, `min` and `max`; atomic and
 * `continueOnError`. Each case runs twice on twin data — once as one batch,
 * once as one-record calls of the same door — and the answers, the stored
 * rows and the supplier's roll-ups must match. A roll-up no rule reads (the
 * describe above) keeps its deferred statement counts.
 */
const RULE_CASES: Record<keyof typeof RULE_CHILDREN, { seed: Array<Record<string, unknown>>; batch: Array<Record<string, unknown>> }> = {
  // Two contacts set primary in one edit: one-by-one refuses the second;
  // against the pre-batch count (0) both would pass.
  count: { seed: [{ is_primary: false }, { is_primary: false }], batch: [{ is_primary: true }, { is_primary: true }] },
  // Scores 3, 3, 3 (avg 3): 0 is admitted and moves the avg to 2, so 4.5 is
  // refused (4.5 > 4); against the pre-batch avg it would pass (4.5 > 5 is false).
  avg: { seed: [{ score: 3 }, { score: 3 }, { score: 3 }], batch: [{ score: 0 }, { score: 4.5 }] },
  // Scores 1, 5, 5 (min 1): the 1 becomes 5, so the min is 5 and 3 is refused
  // (3 < 4); against the pre-batch min it would pass (3 < 0 is false).
  min: { seed: [{ score: 1 }, { score: 5 }, { score: 5 }], batch: [{ score: 5 }, { score: 3 }] },
  // Scores 9, 5, 5 (max 9): the 9 becomes 5, so the max is 5 and 7 is refused
  // (7 > 6); against the pre-batch max it would pass (7 > 10 is false).
  max: { seed: [{ score: 9 }, { score: 5 }, { score: 5 }], batch: [{ score: 5 }, { score: 7 }] },
};

describe.each(CELLS)('a roll-up a rule reads is not deferred (#33795 B): $name', ({ url, make }) => {
  const skip = !url;

  async function twin(engine: ObjectQL, fn: keyof typeof RULE_CHILDREN, tag: string) {
    const [supplier] = await engine.insert(RULE_SUPPLIER, [{ name: `${fn}-${tag}` }], SYSTEM) as Array<{ id: string }>;
    const contacts = await engine.insert(RULE_CHILDREN[fn].object, RULE_CASES[fn].seed.map((row, k) => ({
      name: `${tag}${k}`, supplier: supplier.id, ...row,
    })), SYSTEM) as Array<{ id: string }>;
    const records = RULE_CASES[fn].batch.map((data, k) => ({ id: contacts[k].id, data }));
    const state = async () => ({
      summary: num((await engine.findOne(RULE_SUPPLIER, { where: { id: supplier.id } }, SYSTEM) as any)[RULE_CHILDREN[fn].summary]),
      contacts: (await engine.find(RULE_CHILDREN[fn].object, { where: { supplier: supplier.id }, orderBy: [{ field: 'name', order: 'asc' }] }, SYSTEM) as any[])
        .map((c) => ({ is_primary: !!c.is_primary, score: num(c.score) })),
    });
    return { records, state };
  }

  /** The per-row answers a caller reads: success and the first error's code and text. */
  const rows = (answer: any) => (answer.results as any[]).map((r) => ({ success: r.success, code: r.errors?.[0]?.code, message: r.errors?.[0]?.message }));

  for (const fn of Object.keys(RULE_CHILDREN) as Array<keyof typeof RULE_CHILDREN>) {
    it.skipIf(skip)(`${fn}: continueOnError answers what single updates answer`, async () => {
      const { engine } = await boot(make);
      const protocol = new ObjectStackProtocolImplementation(engine as never);
      const object = RULE_CHILDREN[fn].object;
      const one = await twin(engine, fn, 'single');
      const singles: any[] = [];
      for (const record of one.records) {
        singles.push(...rows(await protocol.updateManyData({ object, records: [record], options: { continueOnError: true }, context: SYSTEM.context } as never)));
      }
      const batch = await twin(engine, fn, 'batch');
      const answer = await protocol.updateManyData({ object, records: batch.records, options: { continueOnError: true }, context: SYSTEM.context } as never);
      // One by one, the first row is admitted and the second refused with the rule's own text.
      expect(singles[0]).toMatchObject({ success: true });
      expect(singles[1]).toMatchObject({ success: false, message: expect.stringContaining(RULE_TEXT[fn]) });
      expect(rows(answer)).toEqual(singles);
      expect(await batch.state()).toEqual(await one.state());
    });

    it.skipIf(skip)(`${fn}: an atomic batch refuses the second row with the single update's answer and writes nothing`, async () => {
      const { engine } = await boot(make);
      const protocol = new ObjectStackProtocolImplementation(engine as never);
      const object = RULE_CHILDREN[fn].object;
      const one = await twin(engine, fn, 'single');
      const before = await one.state();
      const second = rows(await protocol.updateManyData({ object, records: [one.records[0]], context: SYSTEM.context } as never)).concat(
        rows(await protocol.updateManyData({ object, records: [one.records[1]], context: SYSTEM.context } as never)),
      )[1];
      expect(second).toMatchObject({ success: false, message: expect.stringContaining(RULE_TEXT[fn]) });
      const batch = await twin(engine, fn, 'batch');
      const answer = await protocol.updateManyData({ object, records: batch.records, options: { atomic: true }, context: SYSTEM.context } as never);
      expect(answer).toMatchObject({ success: false });
      const got = rows(answer);
      expect(got[0]).toMatchObject({ success: false, code: 'ROLLED_BACK' });
      expect(got[1]).toEqual(second);
      expect(await batch.state()).toEqual(before);
    });
  }
});

/** One bulk update a rule judges, set up on twin data: the door's object, its records, and the state to compare. */
type ParityCase = (engine: ObjectQL, tag: string) => Promise<{ object: string; records: Array<{ id: string; data: Record<string, unknown> }>; state: () => Promise<unknown> }>;

/** The capped invoice: A holds one line, B two; the batch moves A's line onto B and one of B's onto A. */
const capCase = ({ parent, line }: { parent: string; line: string }): ParityCase => async (engine, tag) => {
  const [a, b] = await engine.insert(parent, [{ name: `${tag}A` }, { name: `${tag}B` }], SYSTEM) as Array<{ id: string }>;
  const [a1, b1] = await engine.insert(line, [
    { name: `${tag}a1`, invoice: a.id }, { name: `${tag}b1`, invoice: b.id }, { name: `${tag}b2`, invoice: b.id },
  ], SYSTEM) as Array<{ id: string }>;
  return {
    object: line,
    records: [{ id: a1.id, data: { invoice: b.id } }, { id: b1.id, data: { invoice: a.id } }],
    state: async () => ({
      counts: await Promise.all([a, b].map(async (p) => num((await engine.findOne(parent, { where: { id: p.id } }, SYSTEM) as any).line_count))),
      lines: (await engine.find(line, { where: { invoice: { $in: [a.id, b.id] } }, orderBy: [{ field: 'name', order: 'asc' }] }, SYSTEM) as any[])
        .map((l) => ({ name: String(l.name).slice(tag.length), on: l.invoice === a.id ? 'A' : 'B' })),
    }),
  };
};

/** Two contacts of one supplier set primary: the formula `slots` is 1 before the batch, 0 after the first. */
const slotsCase: ParityCase = async (engine, tag) => {
  const [supplier] = await engine.insert(FSUP, [{ name: `${tag}S` }], SYSTEM) as Array<{ id: string }>;
  const contacts = await engine.insert(FSUP_CONTACT, [0, 1].map((k) => ({ name: `${tag}${k}`, supplier: supplier.id, is_primary: false })), SYSTEM) as Array<{ id: string }>;
  return {
    object: FSUP_CONTACT,
    records: contacts.map((c) => ({ id: c.id, data: { is_primary: true } })),
    state: async () => ({
      primaries: num((await engine.findOne(FSUP, { where: { id: supplier.id } }, SYSTEM) as any).primary_count),
      contacts: (await engine.find(FSUP_CONTACT, { where: { supplier: supplier.id }, orderBy: [{ field: 'name', order: 'asc' }] }, SYSTEM) as any[]).map((c) => !!c.is_primary),
    }),
  };
};

/** Two lines of one header flagged, each with a note: the header's computed `room` is 1 before the batch and 0 after the first, so one by one the second note is locked and dropped. */
const roomCase: ParityCase = async (engine, tag) => {
  const [header] = await engine.insert(FHDR, [{ name: `${tag}H` }], SYSTEM) as Array<{ id: string }>;
  const lines = await engine.insert(FHDR_LINE, [0, 1].map((k) => ({ name: `${tag}${k}`, header: header.id, flag: false })), SYSTEM) as Array<{ id: string }>;
  return {
    object: FHDR_LINE,
    records: lines.map((l) => ({ id: l.id, data: { flag: true, note: 'set' } })),
    state: async () => ({
      flagged: num((await engine.findOne(FHDR, { where: { id: header.id } }, SYSTEM) as any).flagged_count),
      lines: (await engine.find(FHDR_LINE, { where: { header: header.id }, orderBy: [{ field: 'name', order: 'asc' }] }, SYSTEM) as any[]).map((l) => ({ flag: !!l.flag, note: l.note ?? null })),
    }),
  };
};

/** Two lines of one owner flagged: each stores `rank` from the owner's count at its own write. */
const rankCase: ParityCase = async (engine, tag) => {
  const [owner] = await engine.insert(SEEN, [{ name: `${tag}O` }], SYSTEM) as Array<{ id: string }>;
  const lines = await engine.insert(SEEN_LINE, [0, 1].map((k) => ({ name: `${tag}${k}`, owner: owner.id, flag: false })), SYSTEM) as Array<{ id: string }>;
  return {
    object: SEEN_LINE,
    records: lines.map((l) => ({ id: l.id, data: { flag: true } })),
    state: async () => ({
      flagged: num((await engine.findOne(SEEN, { where: { id: owner.id } }, SYSTEM) as any).flagged_count),
      ranks: (await engine.find(SEEN_LINE, { where: { owner: owner.id }, orderBy: [{ field: 'name', order: 'asc' }] }, SYSTEM) as any[]).map((l) => num(l.rank)),
    }),
  };
};

/**
 * [#33795, ruling 6928862195 B] The classes a rule reads a roll-up through that
 * the supplier describe above does not cover: (iii) a rule of the parent on its
 * own roll-up, and a rule reading the roll-up through a computed field: a
 * formula one hop (i), a stored computed field on `parent` (ii) and on its own
 * row (iii). Each case's pre-batch value admits
 * the whole batch where one-by-one refuses a step. The oracle is the same door
 * on the same engine with the member hidden: today's per-row recompute, so
 * "rules do not change against today" is pinned as stated, the answer and the
 * stored rows alike, atomic and `continueOnError`.
 */
const refused = (answer: any): boolean => answer.success === false;
/** `live` says the per-row path shows what a deferral would change; `coeLive` says it also does so under `continueOnError` (else that run is a parity pin only). */
const PARITY_CASES: Array<{ name: string; make: ParityCase; live: (answer: any, state: any) => boolean; coeLive?: boolean }> = [
  // Invoice A holds one line, B two (the cap). Moving A's line onto B makes
  // B hold 3, and B's own rule refuses that recompute; moving one of B's
  // lines back leaves B at 2, so deferred the rule would see only B = 2.
  { name: '(iii) the parent caps its own count', make: capCase(CAP), live: refused },
  { name: '(iii) the parent caps a stored computed field over its own count', make: capCase(CCAP), live: refused },
  { name: '(i) a contact rule reads the supplier formula over its count, one hop', make: slotsCase, live: refused, coeLive: true },
  { name: '(ii) a line readonlyWhen reads the header computed field over its count on parent', make: roomCase, live: (_answer, state) => state.lines[1].note === null, coeLive: true },
  // The same cap spelled as a declared bound (`min: 0` on the stored `room`), no rule.
  { name: '(iii) a declared bound on the parent stored computed field over its count', make: capCase(BCAP), live: refused },
  // No declaration at all: a stored select computed from the count, whose option list lacks the value past the cap.
  { name: '(iii) a stored computed field over its count with no bound, refused by its own option list', make: capCase(OCAP), live: refused },
  // Not a rule: a child's stored field computed from the parent's summary.
  { name: 'a child stored computed field reads the owner count one hop', make: rankCase, live: (_answer, state) => state.ranks[0] !== state.ranks[1], coeLive: true },
];

describe.each(CELLS)('a roll-up a rule reads through its own row or a formula is not deferred (#33795 B): $name', ({ url, make }) => {
  const skip = !url;
  const rows = (answer: any) => (answer.results as any[]).map((r) => ({ success: r.success, code: r.errors?.[0]?.code, message: r.errors?.[0]?.message }));

  for (const parity of PARITY_CASES) {
    for (const options of [{ atomic: true }, { continueOnError: true }] as const) {
      const label = 'atomic' in options ? 'atomic' : 'continueOnError';
      it.skipIf(skip)(`${parity.name}, ${label}: answers what today's per-row recompute answers`, async () => {
        const { engine } = await boot(make);
        const protocol = new ObjectStackProtocolImplementation(engine as never);
        const today = await parity.make(engine, 'today');
        const expected = await withoutBatchScope(engine, () => protocol.updateManyData({ object: today.object, records: today.records, options, context: SYSTEM.context } as never)) as any;
        const batch = await parity.make(engine, 'batch');
        const answer = await protocol.updateManyData({ object: batch.object, records: batch.records, options, context: SYSTEM.context } as never) as any;
        // The case is live: one by one the batch is refused, a lock drops the second note, or the
        // second row stores the first row's recompute. Under continueOnError the cap cases end in
        // the same rows either way (the refused recompute is logged), so there they pin parity only.
        if ('atomic' in options || parity.coeLive) expect(parity.live(expected, await today.state())).toBe(true);
        expect({ success: answer.success, rows: rows(answer) }).toEqual({ success: expected.success, rows: rows(expected) });
        expect(await batch.state()).toEqual(await today.state());
      });
    }
  }
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
