// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `delete_record` node with `multi: true` and a filter honours every
 * declared `deleteBehavior` of the rows it matches: a `restrict` refuses the
 * whole delete, a `master_detail` child is cascaded, a `set_null` lookup is
 * cleared.
 *
 * The node forwards the author's bulk intent to `data.delete({ where, multi:
 * true })`. The engine's predicate arm used to go straight to
 * `driver.deleteMany`, so a flow deleting parents by filter skipped the
 * referential walk the by-id delete runs: no restrict refused, master_detail
 * children and lookups were left pointing at deleted rows. The same delete
 * done record by record through the data door refused or cascaded. The arm
 * now resolves the rows it matches and runs the by-id walk for each, in one
 * unit of work.
 *
 * Composition: the real stack the other `*.integration.test.ts` files in this
 * package boot: `ObjectKernel`, `ObjectQLPlugin`, `driver-sql` on
 * better-sqlite3 `:memory:`, and the real `AutomationServicePlugin` running
 * the flow. Rows are counted out of the DRIVER, not through the engine.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin } from '../plugin.js';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const SYS = { isSystem: true } as const;

const PARENT = {
  name: 'pin_bulk_parent',
  label: 'Pin bulk parent',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    grp: { name: 'grp', label: 'Group', type: 'text' },
  },
};
/** A detail: `master_detail` cascades by default. */
const DETAIL = {
  name: 'pin_bulk_detail',
  label: 'Pin bulk detail',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    parent: { name: 'parent', label: 'Parent', type: 'master_detail', reference: 'pin_bulk_parent' },
  },
};
/** An authored `restrict` lookup. */
const GUARD = {
  name: 'pin_bulk_guard',
  label: 'Pin bulk guard',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    parent: { name: 'parent', label: 'Parent', type: 'lookup', reference: 'pin_bulk_parent', deleteBehavior: 'restrict' },
  },
};
/** An optional `lookup`: `set_null` by default. */
const LINK = {
  name: 'pin_bulk_link',
  label: 'Pin bulk link',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    parent: { name: 'parent', label: 'Parent', type: 'lookup', reference: 'pin_bulk_parent' },
  },
};

function makeLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} };
  l.child = () => l;
  return l;
}

type Executor = { execute: (node: any, variables: Map<string, unknown>, context: any) => Promise<any> };

describe('[#26871] a multi delete_record runs the referential walk for every row its filter matches', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let driver: SqlDriver;
  let automation: AutomationEngine;
  let deleteRecord: Executor;

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
    for (const o of [PARENT, DETAIL, GUARD, LINK]) ql.registry.registerObject(o as any, 'pin-bulk-delete', 'pin-bulk-delete');
    await ql.syncSchemas();
    await installDefaultOrganization(ql);

    // The registered executor itself, over the same engine, so the refusal's
    // structured half can be read off the node's own answer.
    const executors = new Map<string, Executor>();
    const capture = new Proxy(new AutomationEngine(makeLogger()), {
      get(target, key, receiver) {
        if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
        return Reflect.get(target, key, receiver);
      },
    });
    registerCrudNodes(capture as AutomationEngine, { logger: makeLogger(), getService: (n: string) => (n === 'data' ? ql : undefined) } as any);
    deleteRecord = executors.get('delete_record')!;
    expect(deleteRecord, 'control: the delete_record executor was registered').toBeDefined();
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* best-effort teardown */ }
  });

  const insert = async (object: string, data: Record<string, unknown>): Promise<string> =>
    ((await ql.insert(object, data, { context: SYS })) as any).id;
  /** Rows of `object`, read from the driver with no engine in between. */
  const rows = async (object: string, where: Record<string, unknown> = {}): Promise<any[]> =>
    (await driver.find(object, { object, where } as any)) as any[];

  function bulkDeleteFlow(name: string, grp: string) {
    return {
      name, label: name, type: 'autolaunched', runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'sweep', type: 'delete_record', label: 'Sweep', config: { objectName: PARENT.name, filter: { grp }, multi: true } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'sweep' },
        { id: 'e2', source: 'sweep', target: 'end' },
      ],
    };
  }

  it('a restrict held on one matched parent refuses the whole delete, and nothing is deleted', async () => {
    const p1 = await insert(PARENT.name, { title: 'h1', grp: 'held' });
    const p2 = await insert(PARENT.name, { title: 'h2', grp: 'held' });
    await insert(DETAIL.name, { title: 'd-h1', parent: p1 });
    await insert(LINK.name, { title: 'l-h1', parent: p1 });
    await insert(GUARD.name, { title: 'g-h2', parent: p2 });

    const flow = bulkDeleteFlow('pin_bulk_delete_held', 'held');
    automation.registerFlow(flow.name, flow as any);
    const res: any = await automation.execute(flow.name, {});
    expect(res.success, 'the run fails on the restrict').toBe(false);

    // The node's own answer carries the engine's refusal.
    const node: any = await deleteRecord.execute(
      { id: 'sweep', type: 'delete_record', config: { objectName: PARENT.name, filter: { grp: 'held' }, multi: true } },
      new Map(),
      { runAs: 'system', flowName: flow.name },
    );
    expect(node.success).toBe(false);
    expect(node.innerRefusal).toMatchObject({ code: 'DELETE_RESTRICTED' });

    // Nothing changed: both parents, the detail the walk reached first, and
    // the lookup it cleared are all as they were.
    expect((await rows(PARENT.name, { grp: 'held' })).map((r) => r.id).sort()).toEqual([p1, p2].sort());
    expect(await rows(DETAIL.name, { parent: p1 })).toHaveLength(1);
    expect(await rows(LINK.name, { parent: p1 })).toHaveLength(1);
    expect(await rows(GUARD.name, { parent: p2 })).toHaveLength(1);
  });

  it('cascades master_detail children and clears set_null lookups of every matched parent', async () => {
    const p1 = await insert(PARENT.name, { title: 'x1', grp: 'doomed' });
    const p2 = await insert(PARENT.name, { title: 'x2', grp: 'doomed' });
    const kept = await insert(PARENT.name, { title: 'k', grp: 'kept' });
    await insert(DETAIL.name, { title: 'd-x1', parent: p1 });
    await insert(DETAIL.name, { title: 'd-x2', parent: p2 });
    const keptDetail = await insert(DETAIL.name, { title: 'd-k', parent: kept });
    const l1 = await insert(LINK.name, { title: 'l-x1', parent: p1 });
    const l2 = await insert(LINK.name, { title: 'l-x2', parent: p2 });
    const keptLink = await insert(LINK.name, { title: 'l-k', parent: kept });

    const flow = bulkDeleteFlow('pin_bulk_delete_doomed', 'doomed');
    automation.registerFlow(flow.name, flow as any);
    const res: any = await automation.execute(flow.name, {});
    expect(res.success, `run failed: ${JSON.stringify(res.error ?? res)}`).toBe(true);

    expect(await rows(PARENT.name, { grp: 'doomed' })).toEqual([]);
    expect((await rows(PARENT.name, { grp: 'kept' })).map((r) => r.id)).toEqual([kept]);
    // master_detail: the matched parents' details are gone, the kept one stays.
    expect(await rows(DETAIL.name, { parent: p1 })).toEqual([]);
    expect(await rows(DETAIL.name, { parent: p2 })).toEqual([]);
    expect((await rows(DETAIL.name, { parent: kept })).map((r) => r.id)).toEqual([keptDetail]);
    // set_null: the matched parents' lookups are cleared, not left dangling.
    const links = new Map((await rows(LINK.name)).map((r) => [r.id, r.parent ?? null]));
    expect(links.get(l1)).toBeNull();
    expect(links.get(l2)).toBeNull();
    expect(links.get(keptLink)).toBe(kept);
  });
});
