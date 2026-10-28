// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A predicate write on a child object (`multi: true` with a filter) recomputes
 * the parent roll-up `summary` fields its matched rows name, as the same write
 * done record by record does.
 *
 * `recomputeSummaries` finds the parents to recompute from the child rows'
 * foreign keys. The by-id arms hand it the row they read before the write; the
 * predicate arms handed it nothing (an update's affected-row count, a delete's
 * unbound pre-image), so a bulk flow step that deleted or reparented line
 * items left the order's count and total at their old values, with no error.
 * The predicate arms now hand it the matched rows' foreign keys: the old ones
 * for a delete, the old and the new ones for an update, so a reparent
 * recomputes both parents.
 *
 * Composition: the real stack the other `*.integration.test.ts` files in this
 * package boot: `ObjectKernel`, `ObjectQLPlugin`, `driver-sql` on
 * better-sqlite3 `:memory:`, and the real `AutomationServicePlugin` for the
 * flow cases. Parent roll-ups are read out of the DRIVER, not through the
 * engine.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin } from '../plugin.js';
import type { AutomationEngine } from '../engine.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const SYS = { isSystem: true } as const;

/** The parent: a `count` and a `sum` roll-up over its lines. */
const ORDER = {
  name: 'pin_rollup_order',
  label: 'Pin roll-up order',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    line_count: { name: 'line_count', label: 'Line count', type: 'summary', summaryOperations: { object: 'pin_rollup_line', field: 'amount', function: 'count' } },
    line_total: { name: 'line_total', label: 'Line total', type: 'summary', summaryOperations: { object: 'pin_rollup_line', field: 'amount', function: 'sum' } },
    item_count: { name: 'item_count', label: 'Item count', type: 'summary', summaryOperations: { object: 'pin_rollup_item', field: 'title', function: 'count' } },
  },
};
/** The child: a `master_detail` to the order. */
const LINE = {
  name: 'pin_rollup_line',
  label: 'Pin roll-up line',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    grp: { name: 'grp', label: 'Group', type: 'text' },
    amount: { name: 'amount', label: 'Amount', type: 'number' },
    order: { name: 'order', label: 'Order', type: 'master_detail', reference: 'pin_rollup_order' },
  },
};
/**
 * A second child, which a `set_null` lookup points at: a predicate delete of
 * it takes the referential walk's arm (#26871), not the single `deleteMany`.
 */
const ITEM = {
  name: 'pin_rollup_item',
  label: 'Pin roll-up item',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    grp: { name: 'grp', label: 'Group', type: 'text' },
    order: { name: 'order', label: 'Order', type: 'master_detail', reference: 'pin_rollup_order' },
  },
};
const NOTE = {
  name: 'pin_rollup_note',
  label: 'Pin roll-up note',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    item: { name: 'item', label: 'Item', type: 'lookup', reference: 'pin_rollup_item' },
  },
};

describe('[#26950] a predicate update or delete recomputes the roll-ups of every parent its matched rows name', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let driver: SqlDriver;
  let automation: AutomationEngine;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    for (const o of [ORDER, LINE, ITEM, NOTE]) ql.registry.registerObject(o as any, 'pin-rollup', 'pin-rollup');
    await ql.syncSchemas();
    await installDefaultOrganization(ql);
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* best-effort teardown */ }
  });

  const insert = async (object: string, data: Record<string, unknown>): Promise<string> =>
    ((await ql.insert(object, data, { context: SYS })) as any).id;
  /** The order's two roll-ups, read from the driver with no engine in between. */
  const rollup = async (id: string): Promise<{ count: number; total: number }> => {
    const [row] = (await driver.find(ORDER.name, { where: { id } as FilterCondition })) as any[];
    return { count: Number(row.line_count), total: Number(row.line_total) };
  };
  /** Two orders, `a` with two lines in `grp`, `b` with one line elsewhere. */
  const seed = async (grp: string) => {
    const a = await insert(ORDER.name, { title: `a-${grp}` });
    const b = await insert(ORDER.name, { title: `b-${grp}` });
    await insert(LINE.name, { title: 'a1', grp, amount: 10, order: a });
    await insert(LINE.name, { title: 'a2', grp, amount: 32, order: a });
    await insert(LINE.name, { title: 'b1', grp: `${grp}-other`, amount: 5, order: b });
    // Control: the by-id inserts maintained both roll-ups.
    expect(await rollup(a)).toEqual({ count: 2, total: 42 });
    expect(await rollup(b)).toEqual({ count: 1, total: 5 });
    return { a, b };
  };

  it('a predicate delete that runs the referential walk recomputes the parent from the rows it walked', async () => {
    const { a, b } = await seed('walk');
    const i1 = await insert(ITEM.name, { title: 'i1', grp: 'walk', order: a });
    await insert(ITEM.name, { title: 'i2', grp: 'walk', order: a });
    await insert(ITEM.name, { title: 'i3', grp: 'walk-other', order: b });
    const note = await insert(NOTE.name, { title: 'n1', item: i1 });
    const items = async (id: string) =>
      Number(((await driver.find(ORDER.name, { where: { id } as FilterCondition })) as any[])[0].item_count);
    expect(await items(a)).toBe(2);

    const removed = await ql.delete(ITEM.name, { where: { grp: 'walk' }, multi: true, context: SYS });
    expect(removed).toBe(2);
    expect(await items(a)).toBe(0);
    expect(await items(b)).toBe(1);
    // The walk ran: the note's lookup to a deleted item is cleared.
    const [noteRow] = (await driver.find(NOTE.name, { where: { id: note } as FilterCondition })) as any[];
    expect(noteRow.item ?? null).toBeNull();
  });

  function bulkFlow(name: string, node: Record<string, unknown>) {
    return {
      name, label: name, type: 'autolaunched', runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'bulk', label: 'Bulk', ...node },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'bulk' },
        { id: 'e2', source: 'bulk', target: 'end' },
      ],
    };
  }

  it('a predicate delete of both of one order\'s lines brings its count and total to 0', async () => {
    const { a, b } = await seed('del');
    const removed = await ql.delete(LINE.name, { where: { grp: 'del' }, multi: true, context: SYS });
    expect(removed).toBe(2);
    expect(await rollup(a)).toEqual({ count: 0, total: 0 });
    expect(await rollup(b), 'an order no matched line names is untouched').toEqual({ count: 1, total: 5 });
  });

  it('a predicate update that moves both lines to the other order recomputes both orders', async () => {
    const { a, b } = await seed('move');
    const affected = await ql.update(LINE.name, { order: b }, { where: { grp: 'move' }, multi: true, context: SYS });
    expect(affected).toBe(2);
    expect(await rollup(a), 'the old parent').toEqual({ count: 0, total: 0 });
    expect(await rollup(b), 'the new parent').toEqual({ count: 3, total: 47 });
  });

  it('a predicate update of the summed field recomputes the parent it stays under', async () => {
    const { a, b } = await seed('amt');
    await ql.update(LINE.name, { amount: 1 }, { where: { grp: 'amt' }, multi: true, context: SYS });
    expect(await rollup(a)).toEqual({ count: 2, total: 2 });
    expect(await rollup(b)).toEqual({ count: 1, total: 5 });
  });

  it('a flow delete_record with multi: true recomputes the order its lines named', async () => {
    const { a, b } = await seed('flowdel');
    const flow = bulkFlow('pin_rollup_flow_delete', {
      type: 'delete_record', config: { objectName: LINE.name, filter: { grp: 'flowdel' }, multi: true },
    });
    automation.registerFlow(flow.name, flow as any);
    const res: any = await automation.execute(flow.name, {});
    expect(res.success, `run failed: ${JSON.stringify(res.error ?? res)}`).toBe(true);
    expect(await rollup(a)).toEqual({ count: 0, total: 0 });
    expect(await rollup(b)).toEqual({ count: 1, total: 5 });
  });

  it('a flow update_record with multi: true that reparents the lines recomputes both orders', async () => {
    const { a, b } = await seed('flowmove');
    const flow = bulkFlow('pin_rollup_flow_update', {
      type: 'update_record', config: { objectName: LINE.name, filter: { grp: 'flowmove' }, fields: { order: b }, multi: true },
    });
    automation.registerFlow(flow.name, flow as any);
    const res: any = await automation.execute(flow.name, {});
    expect(res.success, `run failed: ${JSON.stringify(res.error ?? res)}`).toBe(true);
    expect(await rollup(a)).toEqual({ count: 0, total: 0 });
    expect(await rollup(b)).toEqual({ count: 3, total: 47 });
  });
});
