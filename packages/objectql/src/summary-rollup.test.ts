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
    engine.registry.registerObject({ name: 'note', fields: { body: { type: 'text' } } });
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

describe('roll-up summary seeding on the PARENT insert (#5749)', () => {
  // The bug: `recomputeSummaries` only ever visits parents named by a CHILD
  // write (`recs`/`prevs` → `desc.fkField`), so a parent that has never had a
  // child is never visited and its summary column keeps insert's `null`. Delete
  // the last child and the parent IS visited (via `previous`) and lands on 0 —
  // so "never had a child" and "had one, deleted it" are the same logical state
  // read back as two different values, and a `= 0` filter silently drops the
  // first kind. Seeding at parent-insert time is the producer-side fix: `count`
  // and `sum` start at the empty-collection value they will always have.
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'project',
      fields: {
        name: { type: 'text' },
        task_count: { type: 'summary', summaryOperations: { object: 'task', field: 'id', function: 'count' } },
        total_estimate: { type: 'summary', summaryOperations: { object: 'task', field: 'estimate', function: 'sum' } },
        // No empty-set value — these must stay `null`, same list the recompute
        // fallback uses.
        avg_estimate: { type: 'summary', summaryOperations: { object: 'task', field: 'estimate', function: 'avg' } },
        max_estimate: { type: 'summary', summaryOperations: { object: 'task', field: 'estimate', function: 'max' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'task',
      fields: {
        title: { type: 'text' },
        estimate: { type: 'number' },
        project: { type: 'master_detail', reference: 'project' },
      },
    } as any);
  });

  const row = (id: string) => storeFor('project').get(id);

  it('reads the SAME value for "never had a child" (A) and "had one, deleted it" (C)', async () => {
    // A — created, never had a child. The issue measured `null` here.
    const a = await engine.insert('project', { name: 'Legacy Sunset' });
    expect(a.task_count).toBe(0);          // the record handed back to the caller
    expect(row(a.id).task_count).toBe(0);  // and what was actually stored
    expect(row(a.id).total_estimate).toBe(0);

    // B — one child.
    const b = await engine.insert('project', { name: 'Apollo' });
    const t = await engine.insert('task', { title: 't1', estimate: 8, project: b.id });
    expect(row(b.id).task_count).toBe(1);
    expect(row(b.id).total_estimate).toBe(8);

    // C — that child deleted again.
    await engine.delete('task', { where: { id: t.id } });
    expect(row(b.id).task_count).toBe(0);
    expect(row(b.id).total_estimate).toBe(0);

    // The point of the whole change: A and C are one logical state, one value.
    expect(row(a.id).task_count).toBe(row(b.id).task_count);
    expect(row(a.id).total_estimate).toBe(row(b.id).total_estimate);
  });

  it('`= 0` and `< 1` filters no longer drop the parent that never had a child', async () => {
    // Exactly the showcase repro: `Legacy Sunset` (never had a task) used to be
    // missing from both result sets while `ROLLUP PROBE` (had one, deleted it)
    // was returned — the same query, two answers for one state, and the miss is
    // a silently absent ROW, not an error.
    const never = await engine.insert('project', { name: 'Legacy Sunset' });
    const probe = await engine.insert('project', { name: 'ROLLUP PROBE' });
    const seeded = await engine.insert('task', { title: 'seed', estimate: 3, project: probe.id });
    await engine.delete('task', { where: { id: seeded.id } });
    const busy = await engine.insert('project', { name: 'Apollo' });
    await engine.insert('task', { title: 'live', estimate: 5, project: busy.id });

    const eqZero = await engine.find('project', { where: [['task_count', '=', 0]] });
    expect(eqZero.map((r: any) => r.name).sort()).toEqual(['Legacy Sunset', 'ROLLUP PROBE']);
    expect(eqZero.map((r: any) => r.id)).toContain(never.id);

    const ltOne = await engine.find('project', { where: [['task_count', '<', 1]] });
    expect(ltOne.map((r: any) => r.name).sort()).toEqual(['Legacy Sunset', 'ROLLUP PROBE']);

    // And the parent that DOES have a task is still excluded by both.
    expect(eqZero.map((r: any) => r.id)).not.toContain(busy.id);
    expect(ltOne.map((r: any) => r.id)).not.toContain(busy.id);
  });

  it('leaves avg/max null — undefined on an empty set, before AND after children', async () => {
    const p = await engine.insert('project', { name: 'No tasks yet' });
    expect(row(p.id).avg_estimate ?? null).toBeNull();
    expect(row(p.id).max_estimate ?? null).toBeNull();

    const t = await engine.insert('task', { title: 't', estimate: 6, project: p.id });
    expect(row(p.id).avg_estimate).toBe(6);
    expect(row(p.id).max_estimate).toBe(6);

    // Back to the empty collection: the recompute fallback puts them back to
    // null. Seeding reads the same list, so A and C agree here too.
    await engine.delete('task', { where: { id: t.id } });
    expect(row(p.id).avg_estimate ?? null).toBeNull();
    expect(row(p.id).max_estimate ?? null).toBeNull();
  });

  it('never overwrites a value the author supplied on insert', async () => {
    const p = await engine.insert('project', { name: 'Imported', task_count: 7, total_estimate: 42 });
    expect(row(p.id).task_count).toBe(7);
    expect(row(p.id).total_estimate).toBe(42);
  });

  it('seeds every row of a batch insert, and only the unsupplied ones', async () => {
    const written = await engine.insert('project', [{ name: 'P1' }, { name: 'P2', task_count: 3 }]);
    expect(row(written[0].id).task_count).toBe(0);
    expect(row(written[0].id).total_estimate).toBe(0);
    expect(row(written[1].id).task_count).toBe(3);
  });

  it('lets a beforeInsert hook still have the final say', async () => {
    engine.registerHook('beforeInsert', async (ctx: any) => {
      ctx.input.data.task_count = 99;
    }, { object: 'project' });
    const p = await engine.insert('project', { name: 'Hooked' });
    expect(row(p.id).task_count).toBe(99);
  });

  it('does NOT seed a roll-up whose relationship cannot be resolved', async () => {
    // Seeded ⇔ maintained: `buildSummaryIndex` skips a descriptor whose child→
    // parent FK it cannot resolve, so the recompute would never maintain this
    // field. A 0 nothing ever updates would be a worse lie than the null.
    engine.registry.registerObject({
      name: 'orphan_parent',
      fields: {
        name: { type: 'text' },
        ghost_count: { type: 'summary', summaryOperations: { object: 'ghost', field: 'id', function: 'count' } },
      },
    } as any);
    engine.registry.registerObject({ name: 'ghost', fields: { label: { type: 'text' } } });

    const p = await engine.insert('orphan_parent', { name: 'x' });
    expect(storeFor('orphan_parent').get(p.id).ghost_count ?? null).toBeNull();
  });

  it('seeds a parent published AFTER the summary index was already warmed', async () => {
    // The parent-side index must share the child-side staleness rule (cloud#970):
    // a runtime publish registers straight into the registry, so an index warmed
    // by an earlier write must still see the new roll-up.
    await engine.insert('project', { name: 'warms the index' });

    engine.registry.registerObject({
      name: 'sprint',
      fields: {
        name: { type: 'text' },
        story_count: { type: 'summary', summaryOperations: { object: 'story', field: 'id', function: 'count' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'story',
      fields: { title: { type: 'text' }, sprint: { type: 'master_detail', reference: 'sprint' } },
    } as any);

    const s = await engine.insert('sprint', { name: 'S1' });
    expect(storeFor('sprint').get(s.id).story_count).toBe(0);
  });
});
