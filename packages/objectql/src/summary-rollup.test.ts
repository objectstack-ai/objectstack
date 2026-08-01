// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Roll-up `summary` fields: a parent field whose value is an aggregate over a
// child collection (SUM/COUNT/...). The engine must recompute it whenever a
// child record is inserted / updated / deleted.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  // Minimal FilterCondition matcher: implicit equality, a few operators, and the
  // logical `$and`/`$or`/`$not` the engine emits when a summary carries a filter
  // (`{ $and: [{ fk: parentId }, <filter> }] }`). Enough to exercise the merge.
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
      return value === cond;
    }
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$gt': return value > target;
        case '$gte': return value >= target;
        case '$lt': return value < target;
        case '$lte': return value <= target;
        case '$in': return Array.isArray(target) && target.includes(value);
        case '$nin': return Array.isArray(target) && !target.includes(value);
        default: return true;
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k === '$not') return !matches(row, v);
      return checkOp(row?.[k], v);
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    findStream() { throw new Error('ni'); },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

describe('roll-up summary fields', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'inv',
      fields: {
        name: { type: 'text' },
        line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
        line_count: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'count' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'inv_line',
      fields: {
        amount: { type: 'number' },
        inv: { type: 'master_detail', reference: 'inv' },
      },
    } as any);
  });

  const parent = (id: string) => storeFor('inv').get(id);

  it('computes SUM and COUNT on the parent as children are inserted', async () => {
    const p = await engine.insert('inv', { name: 'INV-1' });
    await engine.insert('inv_line', { inv: p.id, amount: 10 });
    await engine.insert('inv_line', { inv: p.id, amount: 32 });

    expect(parent(p.id).line_total).toBe(42);
    expect(parent(p.id).line_count).toBe(2);
  });

  it('recomputes when a child amount is updated', async () => {
    const p = await engine.insert('inv', { name: 'INV-2' });
    const l1 = await engine.insert('inv_line', { inv: p.id, amount: 10 });
    await engine.insert('inv_line', { inv: p.id, amount: 5 });
    expect(parent(p.id).line_total).toBe(15);

    await engine.update('inv_line', { id: l1.id, amount: 100 });
    expect(parent(p.id).line_total).toBe(105);
  });

  it('recomputes when a child is deleted (down to 0 with no children)', async () => {
    const p = await engine.insert('inv', { name: 'INV-3' });
    const l1 = await engine.insert('inv_line', { inv: p.id, amount: 10 });
    expect(parent(p.id).line_total).toBe(10);

    await engine.delete('inv_line', { where: { id: l1.id } });
    expect(parent(p.id).line_total).toBe(0);
    expect(parent(p.id).line_count).toBe(0);
  });

  it('only recomputes the affected parent', async () => {
    const a = await engine.insert('inv', { name: 'A' });
    const b = await engine.insert('inv', { name: 'B' });
    await engine.insert('inv_line', { inv: a.id, amount: 7 });
    await engine.insert('inv_line', { inv: b.id, amount: 3 });

    expect(parent(a.id).line_total).toBe(7);
    expect(parent(b.id).line_total).toBe(3);
  });
});

describe('roll-up summary fields with a filter predicate', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    // A publication rolls up ONE child object (`engagement`) into several totals,
    // each differentiated only by a `filter` — the shape the issue's
    // content_publication.total_views/clicks/signups fields need.
    engine.registry.registerObject({
      name: 'publication',
      fields: {
        name: { type: 'text' },
        total_events: { type: 'summary', summaryOperations: { object: 'engagement', field: 'id', function: 'count' } },
        total_signups: { type: 'summary', summaryOperations: { object: 'engagement', field: 'id', function: 'count', filter: { type: 'signup' } } },
        total_revenue: { type: 'summary', summaryOperations: { object: 'engagement', field: 'amount', function: 'sum', filter: { type: 'signup' } } },
        premium_signups: { type: 'summary', summaryOperations: { object: 'engagement', field: 'id', function: 'count', filter: { type: { $in: ['signup', 'trial'] }, amount: { $gte: 100 } } } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'engagement',
      fields: {
        type: { type: 'text' },
        amount: { type: 'number' },
        publication: { type: 'master_detail', reference: 'publication' },
      },
    } as any);
  });

  const pub = (id: string) => storeFor('publication').get(id);

  it('aggregates only the child rows matching the filter', async () => {
    const p = await engine.insert('publication', { name: 'POST-1' });
    await engine.insert('engagement', { publication: p.id, type: 'view', amount: 0 });
    await engine.insert('engagement', { publication: p.id, type: 'view', amount: 0 });
    await engine.insert('engagement', { publication: p.id, type: 'signup', amount: 30 });
    await engine.insert('engagement', { publication: p.id, type: 'signup', amount: 50 });

    expect(pub(p.id).total_events).toBe(4);     // unfiltered
    expect(pub(p.id).total_signups).toBe(2);    // filter: type == signup
    expect(pub(p.id).total_revenue).toBe(80);   // sum(amount) where type == signup
  });

  it('honours operator/compound filters ($in + $gte)', async () => {
    const p = await engine.insert('publication', { name: 'POST-2' });
    await engine.insert('engagement', { publication: p.id, type: 'signup', amount: 40 });   // amount < 100
    await engine.insert('engagement', { publication: p.id, type: 'signup', amount: 150 });  // matches
    await engine.insert('engagement', { publication: p.id, type: 'trial', amount: 200 });   // matches
    await engine.insert('engagement', { publication: p.id, type: 'view', amount: 999 });    // wrong type

    expect(pub(p.id).premium_signups).toBe(2);
  });

  it('recomputes when a child moves in/out of the filter via an update', async () => {
    const p = await engine.insert('publication', { name: 'POST-3' });
    const e = await engine.insert('engagement', { publication: p.id, type: 'view', amount: 25 });
    expect(pub(p.id).total_signups).toBe(0);
    expect(pub(p.id).total_revenue).toBe(0);

    // Reclassify the same row as a signup — it now enters the filtered rollups.
    await engine.update('engagement', { id: e.id, type: 'signup' });
    expect(pub(p.id).total_signups).toBe(1);
    expect(pub(p.id).total_revenue).toBe(25);

    // And back out again.
    await engine.update('engagement', { id: e.id, type: 'view' });
    expect(pub(p.id).total_signups).toBe(0);
    expect(pub(p.id).total_revenue).toBe(0);
  });

  it('recomputes the filtered rollup when a matching child is deleted', async () => {
    const p = await engine.insert('publication', { name: 'POST-4' });
    const e = await engine.insert('engagement', { publication: p.id, type: 'signup', amount: 60 });
    await engine.insert('engagement', { publication: p.id, type: 'view', amount: 0 });
    expect(pub(p.id).total_signups).toBe(1);
    expect(pub(p.id).total_revenue).toBe(60);

    await engine.delete('engagement', { where: { id: e.id } });
    expect(pub(p.id).total_signups).toBe(0);
    expect(pub(p.id).total_revenue).toBe(0);
    expect(pub(p.id).total_events).toBe(1); // the unfiltered count still sees the view
  });
});

describe('roll-up summary index — a roll-up registered at RUNTIME still computes', () => {
  it('picks up an object registered after the index was already built', async () => {
    // The runtime publish path registers straight into the registry
    // (`protocol.saveMetaItem` → `registry.registerObject`), never through
    // `engine.registerApp` — the sole site that used to invalidate the engine's
    // summary index. Any kernel that had already written a row (publishing
    // itself writes `sys_metadata`) held an index built before the new object,
    // so a freshly published roll-up silently never recomputed until restart:
    // an AI-built "已完成任务数" over correct metadata, permanently empty
    // (cloud#970).
    const engine = new ObjectQL();
    const d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();

    // A write BEFORE the roll-up exists — this is what warmed the stale cache.
    engine.registry.registerObject({ name: 'note', fields: { body: { type: 'text' } } } as any);
    await engine.insert('note', { body: 'warm the summary index' });

    // Now publish the parent + child, the way a runtime publish does.
    engine.registry.registerObject({
      name: 'project',
      fields: {
        name: { type: 'text' },
        task_count: { type: 'summary', summaryOperations: { object: 'task', field: 'id', function: 'count' } },
        completed_task_count: {
          type: 'summary',
          summaryOperations: { object: 'task', field: 'id', function: 'count', filter: { status: 'completed' } },
        },
      },
    } as any);
    engine.registry.registerObject({
      name: 'task',
      fields: { title: { type: 'text' }, status: { type: 'text' }, project: { type: 'master_detail', reference: 'project' } },
    } as any);

    const p = await engine.insert('project', { name: 'Apollo' });
    await engine.insert('task', { title: 'a', status: 'completed', project: p.id });
    await engine.insert('task', { title: 'b', status: 'todo', project: p.id });

    const parent = d.storeFor('project').get(p.id);
    expect(parent.task_count).toBe(2);
    expect(parent.completed_task_count).toBe(1);
  });
});

// Sibling cases to the one above (#4427). That one pins the headline path: an
// object registered after the index was built. These pin three neighbours the
// same revision counter is responsible for, none of which it exercises —
// re-registering an EXISTING object, unregistering one, and the guarantee that
// the child's own insert was already correct (rather than a later write
// quietly repairing it, which is what made the original bug so slippery).
describe('roll-up summary index — neighbours of the runtime-registration path', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
  });

  /** A write against an unrelated object, so the index is built and cached
   *  BEFORE the objects under test are registered. */
  const warmSummaryIndex = async () => {
    engine.registry.registerObject({ name: 'unrelated', fields: { name: { type: 'text' } } } as any);
    await engine.insert('unrelated', { name: 'warms the index' });
  };

  const project = (id: string) => storeFor('project').get(id);

  it('does not need a second write to the child to catch up', async () => {
    await warmSummaryIndex();
    engine.registry.registerObject({
      name: 'project',
      fields: {
        name: { type: 'text' },
        estimated_total_hours: { type: 'summary', summaryOperations: { object: 'task', field: 'hours', function: 'sum' } },
      },
    } as any, 'sys_metadata');
    engine.registry.registerObject({
      name: 'task',
      fields: { hours: { type: 'number' }, project: { type: 'master_detail', reference: 'project' } },
    } as any, 'sys_metadata');

    const p = await engine.insert('project', { name: '新品发布' });
    const t = await engine.insert('task', { project: p.id, hours: 4 });
    const afterInsert = { ...project(p.id) };

    // The pre-fix workaround was a no-op PATCH on the child, which recomputed
    // against a by-then-rebuilt index. The insert alone must already be right,
    // so touching the child must not CHANGE anything.
    await engine.update('task', { id: t.id, hours: 4 });

    expect(afterInsert.estimated_total_hours).toBe(4);
    expect(project(p.id).estimated_total_hours).toBe(afterInsert.estimated_total_hours);
  });

  it('picks up a summary field added to an ALREADY-registered parent', async () => {
    // Incremental authoring: the object is already live, then `update_metadata`
    // re-registers it carrying a new roll-up field. Re-registration replaces an
    // existing contributor rather than adding a new object.
    engine.registry.registerObject({ name: 'project', fields: { name: { type: 'text' } } } as any, 'sys_metadata');
    engine.registry.registerObject({
      name: 'task',
      fields: { hours: { type: 'number' }, project: { type: 'master_detail', reference: 'project' } },
    } as any, 'sys_metadata');

    const p = await engine.insert('project', { name: '迁移' });
    await engine.insert('task', { project: p.id, hours: 3 }); // index built here, no summaries yet

    engine.registry.registerObject({
      name: 'project',
      fields: {
        name: { type: 'text' },
        estimated_total_hours: { type: 'summary', summaryOperations: { object: 'task', field: 'hours', function: 'sum' } },
      },
    } as any, 'sys_metadata');

    await engine.insert('task', { project: p.id, hours: 5 });
    expect(project(p.id).estimated_total_hours).toBe(8);
  });

  it('stops recomputing a roll-up whose parent was unregistered', async () => {
    await warmSummaryIndex();
    engine.registry.registerObject({
      name: 'project',
      fields: {
        name: { type: 'text' },
        estimated_total_hours: { type: 'summary', summaryOperations: { object: 'task', field: 'hours', function: 'sum' } },
      },
    } as any, 'sys_metadata');
    engine.registry.registerObject({
      name: 'task',
      fields: { hours: { type: 'number' }, project: { type: 'master_detail', reference: 'project' } },
    } as any, 'sys_metadata');

    const p = await engine.insert('project', { name: '待卸载' });
    await engine.insert('task', { project: p.id, hours: 2 });
    expect(project(p.id).estimated_total_hours).toBe(2);

    // Uninstalling the package must drop its descriptors too — the mirror of
    // the bug: a stale index would keep writing to a parent that is gone.
    engine.registry.unregisterObjectsByPackage('sys_metadata', true);
    engine.registry.registerObject({
      name: 'task',
      fields: { hours: { type: 'number' }, project: { type: 'lookup', reference: 'project' } },
    } as any, 'other_package');

    await expect(engine.insert('task', { project: p.id, hours: 100 })).resolves.toBeTruthy();
    expect(project(p.id).estimated_total_hours).toBe(2); // untouched
  });
});
