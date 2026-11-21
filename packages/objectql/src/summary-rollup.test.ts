// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Roll-up `summary` fields: a parent field whose value is an aggregate over a
// child collection (SUM/COUNT/...). The engine must recompute it whenever a
// child record is inserted / updated / deleted.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { ObjectSchema, isComposedReadableIds } from '@objectstack/spec/data';
import { mapDataError } from '@objectstack/types';
import { ValidationError } from './validation/record-validator.js';

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
  const checkOp = (value: any, cond: any, row?: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
      return value === cond;
    }
    return Object.entries(cond).every(([op, raw]: [string, any]) => {
      // [#34821] A `{ $field }` comparand reads the row's own column.
      const target = raw && typeof raw === 'object' && typeof raw.$field === 'string' ? row?.[raw.$field] : raw;
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$gt': return value > target;
        case '$gte': return value >= target;
        case '$lt': return value < target;
        case '$lte': return value <= target;
        // [#34465] A nested-relation condition reaches a driver declaring `readableIdsLeaf` as a composed semi-join leaf.
        case '$in': return isComposedReadableIds(target)
          ? [...storeFor(target.object).values()].some((r) => r.id === value && matches(r, target.scope))
          : Array.isArray(target) && target.includes(value);
        case '$nin': return Array.isArray(target) && !target.includes(value);
        // [#34465] The engine widens a `$nin` to `{ $or: [{ x: { $null: true } }, { x: { $nin } }] }`.
        case '$null': return target ? value == null : value != null;
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
      return checkOp(row?.[k], v, row);
    });
  };
  let n = 0;
  // [#26950] Every row read and predicate write, in order, so a test can count
  // the reads a write made BEFORE its driver write.
  const log: Array<{ op: 'find' | 'updateMany' | 'deleteMany'; object: string; ast: any }> = [];
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      log.push({ op: 'find', object, ast });
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      log.push({ op: 'updateMany', object, ast });
      const s = storeFor(object);
      let count = 0;
      for (const [id, r] of Array.from(s.entries())) {
        if (matches(r, ast?.where)) { s.set(id, { ...r, ...data, id }); count += 1; }
      }
      return count;
    },
    async deleteMany(object: string, ast: any) {
      log.push({ op: 'deleteMany', object, ast });
      const s = storeFor(object);
      let count = 0;
      for (const [id, r] of Array.from(s.entries())) {
        if (matches(r, ast?.where)) { s.delete(id); count += 1; }
      }
      return count;
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
  return { driver, storeFor, log };
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

// [#27462] `summaryOperations.field` is optional on a `count` (it reads no
// child field). The definitions here go through the spec's own parse first, so
// the shape the engine indexes is the shape the metadata door now accepts.
describe('[#27462] a count roll-up with no summaryOperations.field', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    const parentObject = ObjectSchema.parse({
      name: 'inv',
      fields: {
        name: { type: 'text' },
        line_count: { type: 'summary', summaryOperations: { object: 'inv_line', function: 'count' } },
      },
    });
    expect(parentObject.fields.line_count.summaryOperations).toEqual({ object: 'inv_line', function: 'count' });
    engine.registry.registerObject(parentObject as any);
    engine.registry.registerObject(ObjectSchema.parse({
      name: 'inv_line',
      fields: {
        amount: { type: 'number' },
        inv: { type: 'master_detail', reference: 'inv' },
      },
    }) as any);
  });

  const parent = (id: string) => storeFor('inv').get(id);

  it('counts the children through insert, update and delete', async () => {
    const p = await engine.insert('inv', { name: 'INV-1' });
    expect(parent(p.id).line_count).toBe(0);
    const a = await engine.insert('inv_line', { inv: p.id, amount: 10 });
    await engine.insert('inv_line', { inv: p.id, amount: 32 });
    await engine.insert('inv_line', [{ inv: p.id }, { inv: p.id, amount: 1 }]);
    expect(parent(p.id).line_count).toBe(4);
    await engine.update('inv_line', { id: a.id, amount: 11 });
    expect(parent(p.id).line_count).toBe(4);
    await engine.delete('inv_line', { where: { id: a.id } });
    expect(parent(p.id).line_count).toBe(3);
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

  // [#34672] These two cases kept an ordinary caller's starting value until the
  // create side of the roll-up lock landed. The seed still never overwrites a
  // supplied value, but only the system principal (seed loads, package
  // installs, historical imports) can still supply one; an ordinary caller's
  // is dropped and the seed fills the column.
  it('never overwrites a value a system writer supplied on insert (seed data, a historical import)', async () => {
    const p = await engine.insert('project', { name: 'Imported', task_count: 7, total_estimate: 42 }, { context: { isSystem: true } } as any);
    expect(row(p.id).task_count).toBe(7);
    expect(row(p.id).total_estimate).toBe(42);
  });

  it('an ordinary caller\'s value on insert is dropped, and the seed fills the column', async () => {
    const p = await engine.insert('project', { name: 'Typed', task_count: 7, total_estimate: 42 });
    expect(row(p.id).task_count).toBe(0);
    expect(row(p.id).total_estimate).toBe(0);
  });

  it('seeds every row of a batch insert, and only the unsupplied ones (system writer)', async () => {
    const written = await engine.insert('project', [{ name: 'P1' }, { name: 'P2', task_count: 3 }], { context: { isSystem: true } } as any);
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

describe('[#26950] a predicate update or delete hands recomputeSummaries its matched rows', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let log: ReturnType<typeof makeDriver>['log'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    log = d.log;
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
        grp: { type: 'text' },
        amount: { type: 'number' },
        inv: { type: 'master_detail', reference: 'inv' },
      },
    } as any);
    // No roll-up aggregates it and nothing points at it: the control.
    engine.registry.registerObject({
      name: 'plain',
      fields: { grp: { type: 'text' }, amount: { type: 'number' } },
    } as any);
  });

  const parent = (id: string) => storeFor('inv').get(id);
  /** The row reads of `object` made before the first predicate driver write. */
  const readsBeforeWrite = (object: string) => {
    const at = log.findIndex((e) => e.op !== 'find');
    return log.slice(0, at === -1 ? log.length : at).filter((e) => e.object === object);
  };
  const seed = async () => {
    const a = await engine.insert('inv', { name: 'A' });
    const b = await engine.insert('inv', { name: 'B' });
    await engine.insert('inv_line', { inv: a.id, grp: 'x', amount: 10 });
    await engine.insert('inv_line', { inv: a.id, grp: 'x', amount: 32 });
    await engine.insert('inv_line', { inv: b.id, grp: 'y', amount: 5 });
    log.length = 0;
    return { a: a.id as string, b: b.id as string };
  };

  it('control: a predicate write on an object no roll-up aggregates reads no row', async () => {
    await engine.insert('plain', { grp: 'x', amount: 1 });
    await engine.insert('plain', { grp: 'x', amount: 2 });
    log.length = 0;

    expect(await engine.update('plain', { amount: 9 }, { where: { grp: 'x' }, multi: true })).toBe(2);
    expect(await engine.delete('plain', { where: { grp: 'x' }, multi: true })).toBe(2);
    expect(log.map((e) => `${e.op} ${e.object}`)).toEqual(['updateMany plain', 'deleteMany plain']);
  });

  it('a predicate update reads only the FK columns, once, and recomputes the old and the new parent', async () => {
    const { a, b } = await seed();
    expect(await engine.update('inv_line', { inv: b }, { where: { grp: 'x' }, multi: true })).toBe(2);

    const reads = readsBeforeWrite('inv_line');
    expect(reads).toHaveLength(1);
    expect(reads[0].ast.fields).toEqual(['inv']);
    expect(reads[0].ast.where).toEqual({ grp: 'x' });
    expect(parent(a)).toMatchObject({ line_total: 0, line_count: 0 });
    expect(parent(b)).toMatchObject({ line_total: 47, line_count: 3 });
  });

  it('a predicate delete reads only the FK columns, once, and recomputes the parent its rows named', async () => {
    const { a, b } = await seed();
    expect(await engine.delete('inv_line', { where: { grp: 'x' }, multi: true })).toBe(2);

    const reads = readsBeforeWrite('inv_line');
    expect(reads).toHaveLength(1);
    expect(reads[0].ast.fields).toEqual(['inv']);
    expect(parent(a)).toMatchObject({ line_total: 0, line_count: 0 });
    expect(parent(b)).toMatchObject({ line_total: 5, line_count: 1 });
  });

  it('reuses the matched-row read the per-row hooks already made: no second read', async () => {
    const { a, b } = await seed();
    engine.registerHook('afterUpdate', () => {}, { object: 'inv_line' } as any);
    engine.registerHook('afterDelete', () => {}, { object: 'inv_line' } as any);

    await engine.update('inv_line', { inv: b }, { where: { grp: 'x' }, multi: true });
    expect(readsBeforeWrite('inv_line'), 'update: the hooks\' one read').toHaveLength(1);
    expect(parent(a)).toMatchObject({ line_count: 0 });
    expect(parent(b)).toMatchObject({ line_count: 3 });

    log.length = 0;
    await engine.delete('inv_line', { where: { inv: b }, multi: true });
    expect(readsBeforeWrite('inv_line'), 'delete: the hooks\' one read').toHaveLength(1);
    expect(parent(b)).toMatchObject({ line_total: 0, line_count: 0 });
  });

  it('a delete that runs the referential walk carries the FK columns on the walk\'s own id read', async () => {
    engine.registry.registerObject({
      name: 'inv_note',
      fields: { line: { type: 'lookup', reference: 'inv_line' } },
    } as any);
    const { a } = await seed();
    expect(await engine.delete('inv_line', { where: { grp: 'x' }, multi: true })).toBe(2);

    expect(readsBeforeWrite('inv_line').map((e) => e.ast.fields)).toEqual([['id', 'inv']]);
    expect(parent(a)).toMatchObject({ line_total: 0, line_count: 0 });
  });

  it('a roll-up over its own object does not recompute a parent the same delete removed', async () => {
    // A self roll-up: a node counts the nodes whose `up` names it. Deleting a
    // node and its child in one predicate delete leaves the child naming a
    // parent that is gone; only the surviving root is recomputed, and the
    // delete answers its count instead of a recompute failure.
    engine.registry.registerObject({
      name: 'node',
      fields: {
        grp: { type: 'text' },
        up: { type: 'lookup', reference: 'node' },
        kids: { type: 'summary', summaryOperations: { object: 'node', field: 'grp', function: 'count', relationshipField: 'up' } },
      },
    } as any);
    const root = await engine.insert('node', { grp: 'keep' });
    const mid = await engine.insert('node', { grp: 'x', up: root.id });
    await engine.insert('node', { grp: 'x', up: mid.id });
    expect(storeFor('node').get(root.id).kids).toBe(1);

    expect(await engine.delete('node', { where: { grp: 'x' }, multi: true })).toBe(2);
    expect(storeFor('node').get(root.id).kids).toBe(0);
  });
});

// [#33795] A write recomputes each touched parent with ONE write carrying all
// of its summary fields, and a batch computes each summary field for all of
// its parents in ONE grouped aggregate. The SQL statement counts and the
// per-dialect value parity are pinned on real drivers
// (`packages/qa/dogfood/test/rollup-grouped-recompute-33795.test.ts`); these
// pin what only the engine decides: how many parent writes and hook runs a
// recompute makes, the fallback that keeps a self-referencing roll-up in
// per-parent order, and how a failed write is reported.
describe('[#33795] grouped roll-up recompute', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let log: ReturnType<typeof makeDriver>['log'];
  let driver: any;

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    log = d.log;
    driver = d.driver;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'region',
      fields: {
        name: { type: 'text' },
        // A summary over a summary: the regions total their invoices' totals.
        grand_total: { type: 'summary', summaryOperations: { object: 'inv', field: 'line_total', function: 'sum' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'inv',
      fields: {
        name: { type: 'text' },
        region: { type: 'lookup', reference: 'region' },
        line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
        line_count: { type: 'summary', summaryOperations: { object: 'inv_line', function: 'count' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'inv_line',
      fields: {
        amount: { type: 'number' },
        inv: { type: 'master_detail', reference: 'inv' },
      },
    } as any);
    // A roll-up over its own object: a task counts its direct subtasks.
    engine.registry.registerObject({
      name: 'task',
      fields: {
        name: { type: 'text' },
        parent_task: { type: 'lookup', reference: 'task' },
        subtask_count: { type: 'summary', summaryOperations: { object: 'task', function: 'count' } },
      },
    } as any);
  });

  /** The reads of `object`'s rows the recompute's aggregates made: the in-memory aggregate reads through `find`. */
  const aggregateReads = (object: string, from: number) =>
    log.slice(from).filter((e) => e.op === 'find' && e.object === object).length;

  it('writes each parent once with all its summary fields, and aggregates each field once per batch', async () => {
    const [a, b, c] = await engine.insert('inv', [{ name: 'A' }, { name: 'B' }, { name: 'C' }]) as any[];
    const parentWrites: Array<Record<string, unknown>> = [];
    engine.registerHook('beforeUpdate', async (ctx: any) => { parentWrites.push({ ...ctx.input.data }); }, { object: 'inv' });
    const before = log.length;
    await engine.insert('inv_line', [
      { inv: a.id, amount: 1 }, { inv: b.id, amount: 2 }, { inv: c.id, amount: 3 },
      { inv: a.id, amount: 4 }, { inv: b.id, amount: 5 }, { inv: c.id, amount: 6 },
    ]);
    // One hook run per parent (it was one per parent per field), each
    // carrying both fields.
    expect(parentWrites).toHaveLength(3);
    for (const write of parentWrites) expect(Object.keys(write).sort()).toEqual(['id', 'line_count', 'line_total']);
    // One aggregate per summary field over all three parents (it was one per
    // parent per field: six).
    expect(aggregateReads('inv_line', before)).toBe(2);
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 5, line_count: 2 });
    expect(storeFor('inv').get(b.id)).toMatchObject({ line_total: 7, line_count: 2 });
    expect(storeFor('inv').get(c.id)).toMatchObject({ line_total: 9, line_count: 2 });
  });

  it('a single-row write asks the one-parent aggregate and writes the parent once', async () => {
    const [a] = await engine.insert('inv', [{ name: 'A' }]) as any[];
    let hookRuns = 0;
    engine.registerHook('beforeUpdate', async () => { hookRuns += 1; }, { object: 'inv' });
    const before = log.length;
    await engine.insert('inv_line', { inv: a.id, amount: 10 });
    expect(hookRuns).toBe(1);
    const reads = log.slice(before).filter((e) => e.op === 'find' && e.object === 'inv_line');
    expect(reads).toHaveLength(2);
    // The one-parent aggregate's equality on the id, not a grouped `$in`.
    for (const read of reads) expect(JSON.stringify(read.ast?.where)).toContain(`"inv":"${a.id}"`);
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 10, line_count: 1 });
  });

  it('a summary over a summary still recomputes up the chain', async () => {
    const [r] = await engine.insert('region', [{ name: 'R' }]) as any[];
    const [a, b] = await engine.insert('inv', [{ name: 'A', region: r.id }, { name: 'B', region: r.id }]) as any[];
    await engine.insert('inv_line', [{ inv: a.id, amount: 10 }, { inv: b.id, amount: 32 }, { inv: a.id, amount: 1 }]);
    expect(storeFor('region').get(r.id).grand_total).toBe(43);
    await engine.update('inv_line', { amount: 0 }, { where: { inv: a.id }, multi: true } as any);
    expect(storeFor('region').get(r.id).grand_total).toBe(32);
  });

  it('a roll-up over its own object keeps the per-parent order, and lands the same values', async () => {
    const [root] = await engine.insert('task', [{ name: 'root' }]) as any[];
    const [mid] = await engine.insert('task', [{ name: 'mid', parent_task: root.id }]) as any[];
    const before = log.length;
    // One batch naming two parents, one of them (mid) a child of the other.
    await engine.insert('task', [
      { name: 'leaf 1', parent_task: mid.id }, { name: 'leaf 2', parent_task: mid.id }, { name: 'sibling', parent_task: root.id },
    ]);
    expect(storeFor('task').get(mid.id).subtask_count).toBe(2);
    expect(storeFor('task').get(root.id).subtask_count).toBe(2);
    // Per parent, never grouped: no aggregate in this batch read a `$in`.
    const grouped = log.slice(before).filter((e) => e.op === 'find' && e.object === 'task' && JSON.stringify(e.ast?.where).includes('$in'));
    expect(grouped).toHaveLength(0);
  });

  it('a failed parent write reports every field it carried; the other parents are still written', async () => {
    const [a, b] = await engine.insert('inv', [{ name: 'A' }, { name: 'B' }]) as any[];
    const update = driver.update;
    driver.update = async (object: string, id: string, data: Record<string, unknown>) => {
      if (object === 'inv' && id === a.id) throw new Error('parent write refused');
      return update.call(driver, object, id, data);
    };
    let caught: any;
    try {
      await engine.insert('inv_line', [{ inv: a.id, amount: 1 }, { inv: b.id, amount: 2 }]);
    } catch (e) { caught = e; }
    expect(caught?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(caught.failures.map((f: any) => [f.parentId, f.field]).sort()).toEqual([[a.id, 'line_count'], [a.id, 'line_total']]);
    expect(storeFor('inv').get(b.id)).toMatchObject({ line_total: 2, line_count: 1 });
  });
});

describe('[#33795] deferSummaryRecompute: one roll-up batch', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let log: ReturnType<typeof makeDriver>['log'];
  let driver: any;
  /** Every write to an `inv` parent, in order: the recompute's own writes are the only ones these tests make. */
  let parentWrites: Array<Record<string, unknown>>;

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    log = d.log;
    driver = d.driver;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'region',
      fields: {
        name: { type: 'text' },
        grand_total: { type: 'summary', summaryOperations: { object: 'inv', field: 'line_total', function: 'sum' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'inv',
      fields: {
        name: { type: 'text' },
        region: { type: 'lookup', reference: 'region' },
        line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
        line_count: { type: 'summary', summaryOperations: { object: 'inv_line', function: 'count' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'inv_line',
      fields: {
        amount: { type: 'number' },
        inv: { type: 'master_detail', reference: 'inv' },
      },
    } as any);
    parentWrites = [];
    engine.registerHook('beforeUpdate', async (ctx: any) => { parentWrites.push({ ...ctx.input.data }); }, { object: 'inv' });
  });

  /** Three parents, two lines each: a=5, b=7, c=9. */
  async function seed() {
    const [a, b, c] = await engine.insert('inv', [{ name: 'A' }, { name: 'B' }, { name: 'C' }]) as any[];
    const lines = await engine.insert('inv_line', [
      { inv: a.id, amount: 1 }, { inv: b.id, amount: 2 }, { inv: c.id, amount: 3 },
      { inv: a.id, amount: 4 }, { inv: b.id, amount: 5 }, { inv: c.id, amount: 6 },
    ]) as any[];
    parentWrites.length = 0;
    return { a, b, c, lines };
  }

  const aggregateReads = (from: number) => log.slice(from).filter((e) => e.op === 'find' && e.object === 'inv_line').length;

  it('a loop of single-row updates recomputes once, when the scope ends', async () => {
    const { a, b, c, lines } = await seed();
    const before = log.length;
    const answer = await engine.deferSummaryRecompute(async () => {
      for (const line of lines) await engine.update('inv_line', { amount: line.amount * 10 }, { where: { id: line.id } });
      // Nothing recomputed yet: every parent still holds its pre-batch value.
      expect(parentWrites).toHaveLength(0);
      return 'done';
    });
    expect(answer).toBe('done');
    // One write per parent for the whole batch (outside a scope: one per row),
    // and one grouped aggregate per summary field (outside: one per row per field).
    expect(parentWrites).toHaveLength(3);
    expect(aggregateReads(before)).toBe(2);
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 50, line_count: 2 });
    expect(storeFor('inv').get(b.id)).toMatchObject({ line_total: 70, line_count: 2 });
    expect(storeFor('inv').get(c.id)).toMatchObject({ line_total: 90, line_count: 2 });
  });

  it('control: the same loop outside a scope recomputes after every row', async () => {
    const { lines } = await seed();
    for (const line of lines) await engine.update('inv_line', { amount: line.amount * 10 }, { where: { id: line.id } });
    expect(parentWrites).toHaveLength(6);
  });

  it('a hook reading the parent summary during the batch reads the value from before the batch', async () => {
    const { a, lines } = await seed();
    const seen: unknown[] = [];
    engine.registerHook('beforeUpdate', async () => {
      const parent = await engine.findOne('inv', { where: { id: a.id } });
      seen.push((parent as any)?.line_total);
    }, { object: 'inv_line' });
    const mine = lines.filter((l: any) => l.inv === a.id);
    await engine.deferSummaryRecompute(async () => {
      for (const line of mine) await engine.update('inv_line', { amount: 100 }, { where: { id: line.id } });
    });
    // Both rows read 5, the pre-batch total; one by one, the second read 104.
    expect(seen).toEqual([5, 5]);
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 200 });
  });

  it('a nested call joins the open scope; the outermost one recomputes', async () => {
    const { a, lines } = await seed();
    await engine.deferSummaryRecompute(async () => {
      await engine.deferSummaryRecompute(async () => {
        await engine.update('inv_line', { amount: 0 }, { where: { id: lines[0].id } });
      });
      expect(parentWrites).toHaveLength(0);
      await engine.update('inv_line', { amount: 0 }, { where: { id: lines[3].id } });
    });
    expect(parentWrites).toHaveLength(1);
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 0, line_count: 2 });
  });

  it('a summary over a summary recomputes up the chain when the scope ends', async () => {
    const [r] = await engine.insert('region', [{ name: 'R' }]) as any[];
    const [a, b] = await engine.insert('inv', [{ name: 'A', region: r.id }, { name: 'B', region: r.id }]) as any[];
    const lines = await engine.insert('inv_line', [{ inv: a.id, amount: 10 }, { inv: b.id, amount: 32 }]) as any[];
    expect(storeFor('region').get(r.id).grand_total).toBe(42);
    await engine.deferSummaryRecompute(async () => {
      for (const line of lines) await engine.update('inv_line', { amount: 1 }, { where: { id: line.id } });
      expect(storeFor('region').get(r.id).grand_total).toBe(42);
    });
    expect(storeFor('region').get(r.id).grand_total).toBe(2);
  });

  it('a callback that throws: the rows that landed are recomputed, and its error is rethrown', async () => {
    const { a, b, lines } = await seed();
    const boom = new Error('row 2 refused');
    await expect(engine.deferSummaryRecompute(async () => {
      await engine.update('inv_line', { amount: 0 }, { where: { id: lines[0].id } });
      await engine.update('inv_line', { amount: 0 }, { where: { id: lines[1].id } });
      throw boom;
    })).rejects.toBe(boom);
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 4 });
    expect(storeFor('inv').get(b.id)).toMatchObject({ line_total: 5 });
  });

  it('a recompute that fails after the callback resolved: ERR_SUMMARY_RECOMPUTE, written = the callback result', async () => {
    const { a, b, lines } = await seed();
    const update = driver.update;
    driver.update = async (object: string, id: string, data: Record<string, unknown>) => {
      if (object === 'inv' && id === a.id) throw new Error('parent write refused');
      return update.call(driver, object, id, data);
    };
    let caught: any;
    try {
      await engine.deferSummaryRecompute(async () => {
        for (const line of lines.slice(0, 2)) await engine.update('inv_line', { amount: 0 }, { where: { id: line.id } });
        return { rows: 2 };
      });
    } catch (e) { caught = e; }
    expect(caught?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(caught.written).toEqual({ rows: 2 });
    expect(caught.failures.map((f: any) => [f.parentId, f.field]).sort()).toEqual([[a.id, 'line_count'], [a.id, 'line_total']]);
    // The rows are stored, and the other parent was still recomputed.
    expect(storeFor('inv_line').get(lines[0].id).amount).toBe(0);
    expect(storeFor('inv').get(b.id)).toMatchObject({ line_total: 5 });
  });

  it('inside a transaction the recompute runs before the commit', async () => {
    const { a, lines } = await seed();
    const events: string[] = [];
    engine.registerHook('beforeUpdate', async () => { events.push('parent write'); }, { object: 'inv' });
    driver.commit = async () => { events.push('commit'); };
    await engine.transaction(async (trxCtx: any) => {
      await engine.deferSummaryRecompute(async () => {
        await engine.update('inv_line', { amount: 0 }, { where: { id: lines[0].id }, context: trxCtx });
        await engine.update('inv_line', { amount: 0 }, { where: { id: lines[3].id }, context: trxCtx });
      });
    });
    expect(events).toEqual(['parent write', 'commit']);
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 0 });
  });

  it('a write the callback started and did not await recomputes at once once the scope has ended', async () => {
    const { a, lines } = await seed();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let late!: Promise<unknown>;
    await engine.deferSummaryRecompute(async () => {
      late = (async () => { await gate; await engine.update('inv_line', { amount: 0 }, { where: { id: lines[0].id } }); })();
    });
    expect(parentWrites).toHaveLength(0);
    release();
    await late;
    expect(parentWrites).toHaveLength(1);
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 4 });
  });

  it('the scope is ambient: a hook-issued insert into a second child of the same parent is deferred to the end too', async () => {
    // A second child object of `inv`, counted by a summary the recompute of
    // `inv_line` does not touch, and a hook on each line that inserts a note.
    engine.registry.registerObject({
      name: 'inv',
      fields: {
        name: { type: 'text' },
        region: { type: 'lookup', reference: 'region' },
        line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
        line_count: { type: 'summary', summaryOperations: { object: 'inv_line', function: 'count' } },
        note_count: { type: 'summary', summaryOperations: { object: 'inv_note', function: 'count' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'inv_note',
      fields: { text: { type: 'text' }, inv: { type: 'master_detail', reference: 'inv' } },
    } as any);
    const { a, b, c, lines } = await seed();
    engine.registerHook('afterUpdate', async (ctx: any) => {
      const row = await engine.findOne('inv_line', { where: { id: ctx.id ?? ctx.input?.id } });
      await engine.insert('inv_note', { text: 'changed', inv: (row as any).inv });
    }, { object: 'inv_line' });
    const before = log.length;
    await engine.deferSummaryRecompute(async () => {
      for (const line of lines) await engine.update('inv_line', { amount: line.amount * 10 }, { where: { id: line.id } });
      // Six notes are stored, and no parent was recomputed for them yet.
      expect(storeFor('inv_note').size).toBe(6);
      expect(parentWrites).toHaveLength(0);
      expect(storeFor('inv').get(a.id)).not.toHaveProperty('note_count', 2);
    });
    // One recompute per child object for the batch, each one write per parent:
    // 3 parents x 2 child objects, where a per-row loop pays 6 rows x 2.
    expect(parentWrites).toHaveLength(6);
    expect(log.slice(before).filter((e) => e.op === 'find' && e.object === 'inv_note').length).toBe(1);
    for (const p of [a, b, c]) expect(storeFor('inv').get(p.id)).toMatchObject({ line_count: 2, note_count: 2 });
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 50 });
  });

  it('a write under a transaction a hook opened and committed inside the batch recomputes in that transaction, not on its dead handle at the end', async () => {
    // The sandbox runner's `ctx.api.transaction` is the discrete trio
    // (`beginTransaction` / `commitTransaction`): with no transaction to join
    // (a non-atomic bulk update) it opens and commits its own, before the
    // batch ends. A driver call on a committed handle fails, as on knex.
    driver.commit = async (h: any) => { h.done = true; };
    for (const op of ['find', 'findOne', 'create', 'update', 'delete', 'count', 'aggregate', 'bulkCreate', 'updateMany']) {
      const real = driver[op];
      if (typeof real !== 'function') continue;
      driver[op] = async (...args: any[]) => {
        if (args.some((a) => a?.transaction?.done)) throw new Error('Transaction query already complete');
        return real.apply(driver, args);
      };
    }
    engine.registry.registerObject({
      name: 'inv',
      fields: {
        name: { type: 'text' },
        region: { type: 'lookup', reference: 'region' },
        line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
        line_count: { type: 'summary', summaryOperations: { object: 'inv_line', function: 'count' } },
        note_count: { type: 'summary', summaryOperations: { object: 'inv_note', function: 'count' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'inv_note',
      fields: { text: { type: 'text' }, inv: { type: 'master_detail', reference: 'inv' } },
    } as any);
    const { a, b, c, lines } = await seed();
    const api = engine.createContext({ isSystem: true });
    engine.registerHook('afterUpdate', async (ctx: any) => {
      const row = await engine.findOne('inv_line', { where: { id: ctx.id ?? ctx.input?.id } });
      const unit = (await api.beginTransaction())!;
      expect(unit.owned).toBe(true);
      await unit.ctx.object('inv_note').insert({ text: 'changed', inv: (row as any).inv });
      await api.commitTransaction(unit.handle);
    }, { object: 'inv_line' });
    await engine.deferSummaryRecompute(async () => {
      for (const line of lines) await engine.update('inv_line', { amount: line.amount * 10 }, { where: { id: line.id } });
    });
    for (const p of [a, b, c]) expect(storeFor('inv').get(p.id)).toMatchObject({ line_count: 2, note_count: 2 });
    expect(storeFor('inv').get(a.id)).toMatchObject({ line_total: 50 });
  });

  describe('[ruling 6928862195 B] a roll-up a rule reads is not deferred', () => {
    const lineWith = (extra: Record<string, unknown>) => engine.registry.registerObject({
      name: 'inv_line',
      fields: {
        amount: { type: 'number' },
        inv: { type: 'master_detail', reference: 'inv' },
        ...(extra.fields as object ?? {}),
      },
      ...(extra.validations ? { validations: extra.validations } : {}),
    } as any);
    /** Parent writes made DURING the batch, and after it. */
    async function batchOfSix(): Promise<{ during: number; after: number }> {
      const { lines } = await seed();
      let during = 0;
      await engine.deferSummaryRecompute(async () => {
        for (const line of lines) await engine.update('inv_line', { amount: line.amount * 10 }, { where: { id: line.id } });
        during = parentWrites.length;
      });
      return { during, after: parentWrites.length - during };
    }

    it('(i) a validation rule on the child reading the parent summary one hop: each row recomputes at once', async () => {
      lineWith({ validations: [{ name: 'cap', type: 'script', severity: 'error', message: 'cap', condition: 'record.inv.line_count > 1000' }] });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(i) a validation rule on ANOTHER object reading the parent summary: judged on the field read, not the object written', async () => {
      engine.registry.registerObject({
        name: 'inv_memo',
        fields: { inv: { type: 'lookup', reference: 'inv' } },
        validations: [{ name: 'cap', type: 'script', severity: 'error', message: 'cap', condition: 'record.inv.line_total > 100000' }],
      } as any);
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(ii) a field-level parent. predicate reading the parent summary: each row recomputes at once', async () => {
      lineWith({ fields: { note: { type: 'text', readonlyWhen: 'parent.line_total > 100000' } } });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('a parent. predicate reading a field that is no summary (the showcase invoice line, parent.status) keeps the deferral', async () => {
      lineWith({ fields: { note: { type: 'text', readonlyWhen: "parent.name == 'paid'", requiredWhen: "parent.name == 'x'" } } });
      expect(await batchOfSix()).toEqual({ during: 0, after: 3 });
    });

    it('a rule reading another field of the related row keeps the deferral', async () => {
      lineWith({ validations: [{ name: 'named', type: 'script', severity: 'error', message: 'named', condition: "record.inv.name == 'never'" }] });
      expect(await batchOfSix()).toEqual({ during: 0, after: 3 });
    });

    /** `inv` as registered above, with `extra` fields and validations of its own. */
    const invWith = (extra: { fields?: Record<string, unknown>; validations?: unknown[] }) => engine.registry.registerObject({
      name: 'inv',
      fields: {
        name: { type: 'text' },
        region: { type: 'lookup', reference: 'region' },
        line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
        line_count: { type: 'summary', summaryOperations: { object: 'inv_line', function: 'count' } },
        ...(extra.fields ?? {}),
      },
      ...(extra.validations ? { validations: extra.validations } : {}),
    } as any);

    it('(iii) a validation rule of the parent reading its OWN summary: each row recomputes at once, so the rule judges every step', async () => {
      invWith({ validations: [{ name: 'cap', type: 'script', severity: 'error', message: 'cap', condition: 'record.line_count > 1000' }] });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(iii) the same through `previous`, and through a conditional rule at depth', async () => {
      invWith({ validations: [{ name: 'grow', type: 'conditional', when: "record.name != ''", then: { name: 'g', type: 'script', severity: 'error', message: 'g', condition: 'previous != null && previous.line_total > 100000' } }] });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(iii) a field-level requiredWhen of the parent reading its own summary', async () => {
      invWith({ fields: { memo: { type: 'text', requiredWhen: 'record.line_total > 100000' } } });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(iii) a rule of the parent reading only its own non-summary fields keeps the deferral', async () => {
      invWith({ validations: [{ name: 'named', type: 'script', severity: 'error', message: 'named', condition: "record.name == 'never'" }] });
      expect(await batchOfSix()).toEqual({ during: 0, after: 3 });
    });

    /** `inv` with a formula over its own summary: `headroom = 1000000 - line_total`. */
    const withHeadroom = (extra: { fields?: Record<string, unknown>; validations?: unknown[] } = {}) => invWith({
      fields: { headroom: { type: 'formula', returnType: 'number', expression: '1000000 - record.line_total' }, ...(extra.fields ?? {}) },
      ...(extra.validations ? { validations: extra.validations } : {}),
    });

    it('(i) through a formula: a child rule reading the parent formula computed from its summary', async () => {
      withHeadroom();
      lineWith({ validations: [{ name: 'room', type: 'script', severity: 'error', message: 'room', condition: 'record.inv.headroom < 0' }] });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(ii) through a formula: a parent. predicate reading the header formula computed from its summary', async () => {
      withHeadroom();
      lineWith({ fields: { note: { type: 'text', requiredWhen: 'parent.headroom < 0' } } });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(iii) through a formula: a rule of the parent reading its own formula computed from its summary', async () => {
      withHeadroom({ validations: [{ name: 'room', type: 'script', severity: 'error', message: 'room', condition: 'record.headroom != null && record.headroom < 0' }] });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('through a stored computed field: an expression on a stored field of the parent reading its summary', async () => {
      invWith({ fields: { doubled: { type: 'number', expression: 'record.line_total * 2' } } });
      lineWith({ validations: [{ name: 'dbl', type: 'script', severity: 'error', message: 'dbl', condition: 'record.inv.doubled > 100000000' }] });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(iii) a declared bound on a stored computed field of the parent calculated from its summary', async () => {
      invWith({ fields: { room: { type: 'number', expression: '1000000 - record.line_total', min: -1000000000000 } } });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(iii) a declared bound on the summary itself', async () => {
      invWith({ fields: { line_count: { type: 'summary', max: 1000, summaryOperations: { object: 'inv_line', function: 'count' } } } });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(iii) a declared precision on the summary itself', async () => {
      invWith({ fields: { line_count: { type: 'summary', precision: 9, summaryOperations: { object: 'inv_line', function: 'count' } } } });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('(iii) an object-level unique index naming the summary', async () => {
      engine.registry.registerObject({
        name: 'inv',
        fields: {
          name: { type: 'text' },
          region: { type: 'lookup', reference: 'region' },
          line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
          line_count: { type: 'summary', summaryOperations: { object: 'inv_line', function: 'count' } },
        },
        indexes: [{ name: 'inv_total_once', fields: ['region', 'line_total'], unique: 'organization' }],
      } as any);
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('a declared index naming the summary that is not unique keeps the deferral', async () => {
      engine.registry.registerObject({
        name: 'inv',
        fields: {
          name: { type: 'text' },
          region: { type: 'lookup', reference: 'region' },
          line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
          line_count: { type: 'summary', summaryOperations: { object: 'inv_line', function: 'count' } },
        },
        indexes: [{ name: 'inv_by_total', fields: ['line_total'] }],
      } as any);
      expect(await batchOfSix()).toEqual({ during: 0, after: 3 });
    });

    it('(iii) a stored computed field of the parent calculated from its summary, with no bound and no rule: its write judges it all the same', async () => {
      invWith({ fields: { doubled: { type: 'number', expression: 'record.line_total * 2' } } });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('a stored computed field of the parent that reads no summary keeps the deferral', async () => {
      invWith({ fields: { label: { type: 'text', expression: 'record.name' } } });
      expect(await batchOfSix()).toEqual({ during: 0, after: 3 });
    });

    it('a stored computed field of the CHILD reading the parent summary one hop: each row recomputes at once', async () => {
      lineWith({ fields: { seen: { type: 'number', expression: 'record.inv.line_count' } } });
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });

    it('a formula (not stored) of the child reading the parent summary keeps the deferral: it is computed on read', async () => {
      lineWith({ fields: { seen: { type: 'formula', returnType: 'number', expression: 'record.inv.line_count' } } });
      expect(await batchOfSix()).toEqual({ during: 0, after: 3 });
    });

    it('a rule reading a formula that reads no summary keeps the deferral', async () => {
      invWith({ fields: { shout: { type: 'formula', returnType: 'text', expression: 'record.name.upperAscii()' } } });
      lineWith({ validations: [{ name: 'shout', type: 'script', severity: 'error', message: 'shout', condition: "record.inv.shout == 'NEVER'" }] });
      expect(await batchOfSix()).toEqual({ during: 0, after: 3 });
    });

    it('a chain: a rule on the grandparent reading a summary over the parent summary keeps the parent summary per row', async () => {
      engine.registry.registerObject({
        name: 'region',
        fields: {
          name: { type: 'text' },
          grand_total: { type: 'summary', summaryOperations: { object: 'inv', field: 'line_total', function: 'sum' } },
        },
        validations: [{ name: 'cap', type: 'script', severity: 'error', message: 'cap', condition: 'record.grand_total > 1000000' }],
      } as any);
      expect(await batchOfSix()).toEqual({ during: 6, after: 0 });
    });
  });

  it('a scope with no roll-up write runs nothing', async () => {
    const before = log.length;
    await engine.deferSummaryRecompute(async () => { await engine.insert('region', { name: 'R' }); });
    expect(parentWrites).toHaveLength(0);
    expect(aggregateReads(before)).toBe(0);
  });
});

// [#34466] A multi-row insert under one header answers a field-level
// `parent.<summary>` predicate the way inserting the rows one by one does
// (#25579's 「批量等于逐条」, extended from the related binding a rule reads
// through a reference to the master-detail header a `requiredWhen` reads as
// `parent`). The header is read once for the batch; the rows the rules have
// admitted are accumulated in memory and overlaid on it for each later row.
//
// Reverse verification, predicted before running: drop the header overlay and
// the atomic, partial, and preview cases go red (every row reads `line_count`
// 0, so all three rows are admitted); the one-by-one, the CONTROL predicate
// reading `parent.status`, and the unbound-header cases stay green.
describe('[#34466] a multi-row insert accumulates its earlier rows into the parent summary a field-level parent. predicate reads', () => {
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
        status: { type: 'text' },
        line_count: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'count' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'inv_line',
      fields: {
        amount: { type: 'number' },
        inv: { type: 'master_detail', reference: 'inv' },
        // THE SUBJECT: from the third line on, a line carries a description.
        description: { type: 'text', requiredWhen: 'parent.line_count >= 2' },
        // CONTROL: reads a header field that is no summary.
        note: { type: 'text', requiredWhen: "parent.status == 'sent'" },
      },
    } as any);
  });

  const lines = (inv: string) => [...storeFor('inv_line').values()].filter((r) => r.inv === inv);
  const threeBare = (inv: string) => [{ inv, amount: 1 }, { inv, amount: 2 }, { inv, amount: 3 }];

  /** The refusal the third row earns: `required` on `description`, in the ADR-0112 envelope the data door maps to 400. */
  function expectDescriptionRequired(err: unknown): void {
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
    expect((err as ValidationError).fields.map((f) => ({ field: f.field, code: f.code }))).toEqual([{ field: 'description', code: 'required' }]);
  }

  async function refusalOf(write: Promise<unknown>): Promise<unknown> {
    try { await write; } catch (err) { return err; }
    throw new Error('expected the write to be refused');
  }

  it('one by one (the reference answer): the first two lines are admitted, the third is refused', async () => {
    const p = await engine.insert('inv', { name: 'INV-1', status: 'draft' });
    const [a, b, c] = threeBare(p.id);
    await engine.insert('inv_line', a);
    await engine.insert('inv_line', b);
    expectDescriptionRequired(await refusalOf(engine.insert('inv_line', c)));
    expect(lines(p.id)).toHaveLength(2);
    expect(storeFor('inv').get(p.id).line_count).toBe(2);
  });

  it('insert(array), all or nothing: the third row is refused as one by one refuses it, and nothing is written', async () => {
    const p = await engine.insert('inv', { name: 'INV-1', status: 'draft' });
    expectDescriptionRequired(await refusalOf(engine.insert('inv_line', threeBare(p.id))));
    expect(lines(p.id)).toHaveLength(0);
  });

  it('insertMany, per-row outcome: the first two rows land, the third carries the refusal', async () => {
    const p = await engine.insert('inv', { name: 'INV-1', status: 'draft' });
    const out = await engine.insertMany('inv_line', threeBare(p.id));
    expect(out.map((o) => o.ok)).toEqual([true, true, false]);
    expectDescriptionRequired((out[2] as { ok: false; error: unknown }).error);
    expect(lines(p.id)).toHaveLength(2);
    expect(storeFor('inv').get(p.id).line_count).toBe(2);
  });

  it('a refused row moves nothing: with the second row refused, the third reads one earlier line and is admitted', async () => {
    const p = await engine.insert('inv', { name: 'INV-1', status: 'draft' });
    // The second row is refused on its own (a non-number amount), so the batch
    // counts one admitted row before the third, as one by one would store one.
    const out = await engine.insertMany('inv_line', [{ inv: p.id, amount: 1 }, { inv: p.id, amount: 'x' }, { inv: p.id, amount: 3 }]);
    expect(out.map((o) => o.ok)).toEqual([true, false, true]);
    expect(lines(p.id)).toHaveLength(2);
  });

  it('the rows of the batch count per header: two headers, two lines each, all admitted', async () => {
    const p = await engine.insert('inv', { name: 'P', status: 'draft' });
    const q = await engine.insert('inv', { name: 'Q', status: 'draft' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 1 }, { inv: q.id, amount: 1 }, { inv: p.id, amount: 2 }, { inv: q.id, amount: 2 }]);
    expect(storeFor('inv').get(p.id).line_count).toBe(2);
    expect(storeFor('inv').get(q.id).line_count).toBe(2);
  });

  it('CONTROL: a parent. predicate reading a field that is no summary answers as before — draft admits the batch, sent refuses its first row', async () => {
    const draft = await engine.insert('inv', { name: 'D', status: 'draft' });
    const sent = await engine.insert('inv', { name: 'S', status: 'sent' });
    await engine.insert('inv_line', [{ inv: draft.id, amount: 1, description: 'x' }, { inv: draft.id, amount: 2, description: 'x' }]);
    expect(lines(draft.id)).toHaveLength(2);
    const out = await engine.insertMany('inv_line', [{ inv: sent.id, amount: 1, description: 'x' }, { inv: sent.id, amount: 2, description: 'x', note: 'n' }]);
    expect(out.map((o) => o.ok)).toEqual([false, true]);
    expect((out[0] as { ok: false; error: ValidationError }).error.fields.map((f) => ({ field: f.field, code: f.code }))).toEqual([{ field: 'note', code: 'required' }]);
  });

  it('the multi-row insert preview answers the write: the third row is not valid', async () => {
    const p = await engine.insert('inv', { name: 'INV-1', status: 'draft' });
    const out = await engine.validate('inv_line', threeBare(p.id), { mode: 'insert' });
    expect(out.results!.map((r) => r.valid)).toEqual([true, true, false]);
    expect(out.results![2]!.errors.map((e) => ({ field: e.field, code: e.code }))).toEqual([{ field: 'description', code: 'required' }]);
    expect(lines(p.id)).toHaveLength(0);
  });
});

// [#34465] A predicate update (`multi: true`) whose rules read a parent
// roll-up answers the way consecutive by-id updates of the matched rows do
// (「批量等于逐条」: ruling 6377847361 for inserts, ruling record 6928862195
// for updateMany; this is the third door). The matched rows are all judged
// before the one `updateMany`, and each is judged against the roll-up as the
// rows judged before it move it: a base read in the database (every child as
// stored for count / sum / avg, the children outside the matched set for
// min / max), folded in memory with the matched rows.
//
// Reverse verification, predicted before running: drop the fold from the
// validation loop and every "predicate update" refusal below goes green-to-red
// (each row reads the roll-up as stored, so both rows are admitted); the
// one-by-one references, the single-match case and the CONTROL stay green.
describe('[#34465] a predicate update judges each matched row against the parent roll-ups the rows before it move', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let log: ReturnType<typeof makeDriver>['log'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    log = d.log;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'inv',
      fields: {
        name: { type: 'text' },
        primaries: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'count', filter: { is_primary: true } } },
        line_count: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'count' } },
        total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
        low: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'min' } },
        mean: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'avg' } },
        memo_total: { type: 'summary', summaryOperations: { object: 'memo_line', field: 'amount', function: 'sum' } },
        budget: { type: 'number' },
        // Calculated from a roll-up: on read (a formula) and on write (a stored computed field).
        remaining: { type: 'formula', expression: 'record.budget - record.total', returnType: 'number' },
        // A stored computed field declared BEFORE the stored computed field it reads (`headroom`).
        head_gap: { type: 'number', expression: { dialect: 'cel', source: 'record.headroom' } },
        headroom: { type: 'number', expression: { dialect: 'cel', source: 'record.budget - record.total' } },
        // A formula reading a lookup hop as well as the roll-up, and a stored computed field reading a formula.
        cap_ref: { type: 'lookup', reference: 'inv_cap' },
        cap_left: { type: 'formula', expression: 'record.cap_ref.amount - record.total', returnType: 'number' },
        slack: { type: 'number', expression: { dialect: 'cel', source: 'record.remaining' } },
        // A stored computed field reading its own stored value and the roll-up: a high-water mark.
        peak: { type: 'number', expression: { dialect: 'cel', source: 'record.peak == null || record.total > record.peak ? record.total : record.peak' } },
        // Three stored computed fields chained against declaration order: x reads y, y reads z, z reads the roll-up.
        chain_x: { type: 'number', expression: { dialect: 'cel', source: 'record.chain_y' } },
        chain_y: { type: 'number', expression: { dialect: 'cel', source: 'record.chain_z' } },
        chain_z: { type: 'number', expression: { dialect: 'cel', source: 'record.total' } },
        // A formula over the roll-up that also reads a formula reading no roll-up (`room` over `ceiling`).
        extra: { type: 'number' },
        ceiling: { type: 'formula', expression: 'record.budget + record.extra', returnType: 'number' },
        room: { type: 'formula', expression: 'record.ceiling - record.total', returnType: 'number' },
      },
    } as any);
    engine.registry.registerObject({ name: 'inv_cap', fields: { amount: { type: 'number' } } } as any);
    // Row-level security on the cap object: a caller that is not SYSTEM reads none of it.
    engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      if (ctx.object === 'inv_cap' && ['find', 'findOne'].includes(ctx.operation) && !ctx.context?.isSystem) {
        ctx.ast = { ...(ctx.ast ?? {}), where: { $and: [ctx.ast?.where ?? {}, { id: '__none__' }] } };
      }
      await next();
    });
    engine.registry.registerObject({
      name: 'inv_line',
      fields: {
        amount: { type: 'number' },
        is_primary: { type: 'boolean' },
        tag: { type: 'text' },
        inv: { type: 'master_detail', reference: 'inv' },
        // Class (ii): a field-level predicate reading a roll-up on `parent`.
        note: { type: 'text', requiredWhen: 'parent.line_count >= 3' },
      },
      validations: [
        // Class (i): rules reading roll-ups one hop through the reference.
        { name: 'one_primary', type: 'script', severity: 'error', message: 'one primary per invoice', condition: 'record.is_primary == true && record.inv.primaries > 0' },
        { name: 'total_cap', type: 'script', severity: 'error', message: 'invoice total over 100', condition: "record.tag == 'cap' && record.inv.total > 100" },
        { name: 'mean_cap', type: 'script', severity: 'error', message: 'invoice mean over 50', condition: "record.tag == 'mean' && record.inv.mean != null && record.inv.mean > 50" },
        { name: 'low_floor', type: 'script', severity: 'error', message: 'invoice low at 50 or more', condition: "record.tag == 'low' && record.inv.low != null && record.inv.low >= 50" },
        // Rules reading a field calculated from a roll-up, not the roll-up itself.
        { name: 'remaining_floor', type: 'script', severity: 'error', message: 'invoice remaining below 0', condition: "record.tag == 'rem' && record.inv.remaining < 0" },
        { name: 'headroom_floor', type: 'script', severity: 'error', message: 'invoice headroom below 0', condition: "record.tag == 'head' && record.inv.headroom < 0" },
        { name: 'cap_floor', type: 'script', severity: 'error', message: 'invoice cap left below 0', condition: "record.tag == 'capref' && record.inv.cap_left != null && record.inv.cap_left < 0" },
        // A stored computed field reading a formula: what does the rule read for it?
        { name: 'slack_set', type: 'script', severity: 'error', message: 'invoice slack is set', condition: "record.tag == 'slack' && record.inv.slack != null" },
        { name: 'gap_floor', type: 'script', severity: 'error', message: 'invoice head gap below 0', condition: "record.tag == 'gap' && record.inv.head_gap < 0" },
        { name: 'peak_cap', type: 'script', severity: 'error', message: 'invoice peak at 150 or more', condition: "record.tag == 'peak' && record.inv.peak >= 150" },
        { name: 'chain_cap', type: 'script', severity: 'error', message: 'invoice chain at 150 or more', condition: "record.tag == 'chain' && record.inv.chain_x != null && record.inv.chain_x >= 150" },
        { name: 'room_floor', type: 'script', severity: 'error', message: 'invoice room below 0', condition: "record.tag == 'room' && record.inv.room != null && record.inv.room < 0" },
      ],
    } as any);
    // CONTROL object: a roll-up of it exists, but no rule reads one.
    engine.registry.registerObject({
      name: 'memo_line',
      fields: {
        amount: { type: 'number' },
        inv: { type: 'master_detail', reference: 'inv' },
      },
      validations: [
        { name: 'amount_cap', type: 'script', severity: 'error', message: 'amount over 1000', condition: 'record.amount > 1000' },
      ],
    } as any);
  });

  const inv = (id: string) => storeFor('inv').get(id);
  const rows = (object: string, invId: string) => [...storeFor(object).values()].filter((r) => r.inv === invId);

  async function refusalOf(write: Promise<unknown>): Promise<unknown> {
    try { await write; } catch (err) { return err; }
    throw new Error('expected the write to be refused');
  }

  function expectRuleRefusal(err: unknown, message: string): void {
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
    expect((err as ValidationError).fields.map((f) => f.message).join(' | ')).toContain(message);
  }

  it('one by one (the reference answer): the second line made primary is refused', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    const a = await engine.insert('inv_line', { inv: p.id, amount: 1, is_primary: false });
    const b = await engine.insert('inv_line', { inv: p.id, amount: 2, is_primary: false });
    await engine.update('inv_line', { id: a.id, is_primary: true });
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { id: b.id, is_primary: true })), 'one primary per invoice');
    expect(inv(p.id).primaries).toBe(1);
  });

  it('predicate update (count with a filter): refused as one by one refuses its second row, and nothing is written', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 1, is_primary: false }, { inv: p.id, amount: 2, is_primary: false }]);
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { is_primary: true }, { where: { inv: p.id }, multi: true })), 'one primary per invoice');
    expect(rows('inv_line', p.id).map((r) => r.is_primary)).toEqual([false, false]);
    expect(inv(p.id).primaries).toBe(0);
  });

  it('predicate update matching one row reads the roll-up as stored, as its one by-id update does', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 1, is_primary: false }, { inv: p.id, amount: 2, is_primary: false }]);
    expect(await engine.update('inv_line', { is_primary: true }, { where: { inv: p.id, amount: 1 }, multi: true })).toBe(1);
    expect(inv(p.id).primaries).toBe(1);
  });

  it('predicate update (sum): the second row reads the total the first row moves', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'cap' }, { inv: p.id, amount: 40, tag: 'cap' }]);
    expect(inv(p.id).total).toBe(80);
    // One by one: the first update reads 80 and is admitted (total 110); the second reads 110.
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 70 }, { where: { inv: p.id }, multi: true })), 'invoice total over 100');
    expect(inv(p.id).total).toBe(80);
  });

  it('predicate update, the other direction: a row main refused is admitted when the row before it moves the total under the cap, as one by one admits it', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 60, tag: 'free' }, { inv: p.id, amount: 60, tag: 'cap' }]);
    expect(inv(p.id).total).toBe(120);
    // One by one: the first (no cap) lowers the total to 70; the second reads 70 and is admitted.
    // Read as stored (main), the second read 120 and refused the whole update.
    expect(await engine.update('inv_line', { amount: 10 }, { where: { inv: p.id }, multi: true })).toBe(2);
    expect(inv(p.id).total).toBe(20);
  });

  it('predicate update (avg): the second row reads the mean the first row moves, rows outside the match included', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'mean' }, { inv: p.id, amount: 40, tag: 'mean' }, { inv: p.id, amount: 40, tag: 'other' }]);
    // One by one: the first reads 40 (admitted, mean then 60); the second reads 60.
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 100 }, { where: { inv: p.id, tag: 'mean' }, multi: true })), 'invoice mean over 50');
    expect(inv(p.id).mean).toBe(40);
  });

  it('predicate update (min): a matched row holding the extreme takes it with it', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 5, tag: 'low' }, { inv: p.id, amount: 60, tag: 'low' }, { inv: p.id, amount: 50, tag: 'other' }]);
    expect(inv(p.id).low).toBe(5);
    // One by one: the first reads 5 (admitted; min then 50, the row outside); the second reads 50.
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 70 }, { where: { inv: p.id, tag: 'low' }, multi: true })), 'invoice low at 50 or more');
    expect(inv(p.id).low).toBe(5);
  });

  it('one by one (the reference answer): a rule reading a formula over the roll-up refuses the second line', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 100 });
    const a = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'rem' });
    const b = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'rem' });
    await engine.update('inv_line', { id: a.id, amount: 70 });
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { id: b.id, amount: 70 })), 'invoice remaining below 0');
  });

  it('predicate update, a rule reading a FORMULA calculated from the roll-up: the second row reads it over the total the first row moves', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 100 });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'rem' }, { inv: p.id, amount: 40, tag: 'rem' }]);
    // One by one: the first reads remaining 20 (admitted; total then 110); the second reads -10.
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 70 }, { where: { inv: p.id }, multi: true })), 'invoice remaining below 0');
    expect(inv(p.id).total).toBe(80);
  });

  it('predicate update, a rule reading a STORED computed field calculated from the roll-up: the same', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 100 });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'head' }, { inv: p.id, amount: 40, tag: 'head' }]);
    expect(inv(p.id).headroom).toBe(20);
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 70 }, { where: { inv: p.id }, multi: true })), 'invoice headroom below 0');
    expect(inv(p.id).headroom).toBe(20);
  });

  it('predicate update, a rule reading a formula over the roll-up, under the line: admitted', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 100 });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'rem' }, { inv: p.id, amount: 40, tag: 'rem' }]);
    expect(await engine.update('inv_line', { amount: 50 }, { where: { inv: p.id }, multi: true })).toBe(2);
    expect(inv(p.id).total).toBe(100);
  });

  // A caller that is not SYSTEM: it cannot read the cap object (the middleware above).
  const CALLER = { userId: 'u_caller' } as any;

  it('one by one (the reference answer), as a caller who cannot read the cap: a rule reading a formula over a lookup hop and the roll-up refuses the second line', async () => {
    const cap = await engine.insert('inv_cap', { amount: 100 });
    const p = await engine.insert('inv', { name: 'P', cap_ref: cap.id }, { context: { isSystem: true } });
    const a = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'capref' });
    const b = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'capref' });
    await engine.update('inv_line', { id: a.id, amount: 70 }, { context: CALLER });
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { id: b.id, amount: 70 }, { context: CALLER })), 'invoice cap left below 0');
  });

  it('predicate update, the same caller: the calculated field is computed as the by-id rule reads it (SYSTEM), so the second row is refused', async () => {
    const cap = await engine.insert('inv_cap', { amount: 100 });
    const p = await engine.insert('inv', { name: 'P', cap_ref: cap.id }, { context: { isSystem: true } });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'capref' }, { inv: p.id, amount: 40, tag: 'capref' }]);
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 70 }, { where: { inv: p.id }, multi: true, context: CALLER })), 'invoice cap left below 0');
    expect(inv(p.id).total).toBe(80);
  });

  it('one by one (the reference answer): a stored computed field that reads a formula is computed over the write\'s image, which carries no formula, so it is null and the rule admits both', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 100 });
    const a = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'slack' });
    const b = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'slack' });
    expect(inv(p.id).slack).toBeNull();
    await engine.update('inv_line', { id: a.id, amount: 70 });
    expect(inv(p.id).slack).toBeNull();
    await engine.update('inv_line', { id: b.id, amount: 70 });
    expect(inv(p.id).total).toBe(140);
  });

  it('predicate update: the stored computed field is computed as the write computes it (over the image, before any formula), so both rows are admitted', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 100 });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'slack' }, { inv: p.id, amount: 40, tag: 'slack' }]);
    // Computed over the parent as READ (its formula values on it), the field would carry a value and the rule refuse.
    expect(await engine.update('inv_line', { amount: 70 }, { where: { inv: p.id }, multi: true })).toBe(2);
    expect(inv(p.id).total).toBe(140);
  });

  it('one by one (the reference answer): a rule reading a formula over the roll-up and over a formula that reads no roll-up refuses the second line', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 60, extra: 40 });
    const a = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'room' });
    const b = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'room' });
    // The first reads room 100 - 80 = 20 (admitted; total then 110); the second reads 100 - 110 = -10.
    await engine.update('inv_line', { id: a.id, amount: 70 });
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { id: b.id, amount: 70 })), 'invoice room below 0');
    expect(inv(p.id).total).toBe(110);
  });

  it('predicate update: the formula the plan does not recompute keeps its stored value, so the recomputed formula reading it refuses the second row as one by one does', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 60, extra: 40 });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'room' }, { inv: p.id, amount: 40, tag: 'room' }]);
    // Computed with `ceiling` missing, `room` would read null and the rule admit both rows.
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 70 }, { where: { inv: p.id }, multi: true })), 'invoice room below 0');
    expect(inv(p.id).total).toBe(80);
  });

  it('predicate update: the same, under the line: admitted', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 60, extra: 40 });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'room' }, { inv: p.id, amount: 40, tag: 'room' }]);
    expect(await engine.update('inv_line', { amount: 50 }, { where: { inv: p.id }, multi: true })).toBe(2);
    expect(inv(p.id).total).toBe(100);
  });

  it('one by one (the reference answer): a stored computed field declared before the stored computed field it reads tracks it on every write, and the rule refuses the second line', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 100 });
    const a = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'gap' });
    const b = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'gap' });
    expect(inv(p.id).head_gap).toBe(20);
    // The recompute's write computes the stored fields twice: `head_gap` reads the `headroom` the first pass moved.
    await engine.update('inv_line', { id: a.id, amount: 70 });
    expect(inv(p.id).head_gap).toBe(-10);
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { id: b.id, amount: 70 })), 'invoice head gap below 0');
  });

  it('predicate update: the stored pass runs twice, as the write runs it, so the field declared first reads the moved field and the second row is refused', async () => {
    const p = await engine.insert('inv', { name: 'P', budget: 100 });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'gap' }, { inv: p.id, amount: 40, tag: 'gap' }]);
    // Computed once in declaration order, `head_gap` would read the stored `headroom` (20) and the rule admit both rows.
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 70 }, { where: { inv: p.id }, multi: true })), 'invoice head gap below 0');
    expect(inv(p.id).head_gap).toBe(20);
  });

  it('one by one (the reference answer), three rows: a high-water mark reads every total so far, so the third line reads 160 and is refused', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    const a = await engine.insert('inv_line', { inv: p.id, amount: 0, tag: 'x' });
    const b = await engine.insert('inv_line', { inv: p.id, amount: 100, tag: 'x' });
    const c = await engine.insert('inv_line', { inv: p.id, amount: 0, tag: 'peak' });
    expect(inv(p.id).peak).toBe(100);
    // Totals 100 -> 160 -> 120: the peak climbs to 160 at the first update and stays there.
    await engine.update('inv_line', { id: a.id, amount: 60 });
    await engine.update('inv_line', { id: b.id, amount: 60 });
    expect(inv(p.id).peak).toBe(160);
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { id: c.id, amount: 60 })), 'invoice peak at 150 or more');
  });

  it('predicate update, three rows: each recompute starts from the row the previous one stored, so the third row reads the peak of 160 and is refused', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 0, tag: 'x' }, { inv: p.id, amount: 100, tag: 'x' }, { inv: p.id, amount: 0, tag: 'peak' }]);
    // Restarted from the stored row at every row, the third would read the larger of 100 and 120 and be admitted.
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 60 }, { where: { inv: p.id }, multi: true })), 'invoice peak at 150 or more');
    expect(inv(p.id).peak).toBe(100);
  });

  it('one by one (the reference answer), three rows: a chain declared against its reading order moves one write behind, so the third line reads 150 and is refused', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    const a = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'x' });
    const b = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'x' });
    const c = await engine.insert('inv_line', { inv: p.id, amount: 40, tag: 'chain' });
    // Totals 120 -> 150 -> 180: `chain_x` holds the total from one write before.
    await engine.update('inv_line', { id: a.id, amount: 70 });
    expect(inv(p.id).chain_x).toBe(120);
    await engine.update('inv_line', { id: b.id, amount: 70 });
    expect(inv(p.id).chain_x).toBe(150);
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { id: c.id, amount: 70 })), 'invoice chain at 150 or more');
  });

  it('predicate update, three rows: the chain is carried forward as one by one moves it, so the third row reads 150 and is refused', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 40, tag: 'x' }, { inv: p.id, amount: 40, tag: 'x' }, { inv: p.id, amount: 40, tag: 'chain' }]);
    // Restarted from the stored row at every row, `chain_x` would read 120 at the third row and the rule admit.
    expectRuleRefusal(await refusalOf(engine.update('inv_line', { amount: 70 }, { where: { inv: p.id }, multi: true })), 'invoice chain at 150 or more');
  });

  it('predicate update that reparents: the header a parent. predicate reads counts the rows moved before', async () => {
    const from = await engine.insert('inv', { name: 'FROM' });
    const to = await engine.insert('inv', { name: 'TO' });
    await engine.insert('inv_line', [{ inv: from.id, amount: 1, tag: 'move' }, { inv: from.id, amount: 2, tag: 'move' }, { inv: from.id, amount: 3, tag: 'move' }]);
    await engine.insert('inv_line', [{ inv: to.id, amount: 4 }]);
    expect(inv(to.id).line_count).toBe(1);
    // One by one: the moves land under 1, 2, then 3 lines; the third needs a note.
    const err = await refusalOf(engine.update('inv_line', { inv: to.id }, { where: { tag: 'move' }, multi: true }));
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields.map((f) => ({ field: f.field, code: f.code }))).toEqual([{ field: 'note', code: 'required' }]);
    expect(rows('inv_line', from.id)).toHaveLength(3);
    expect(inv(to.id).line_count).toBe(1);
  });

  it('predicate update that reparents, below the line: two lines move under a header holding none, the second reads 1', async () => {
    const from = await engine.insert('inv', { name: 'FROM' });
    const to = await engine.insert('inv', { name: 'TO' });
    await engine.insert('inv_line', [{ inv: from.id, amount: 1 }, { inv: from.id, amount: 2 }, { inv: from.id, amount: 3 }]);
    expect(inv(from.id).line_count).toBe(3);
    // Each moved row lands under TO (0, then 1, then 2 lines): every one passes.
    expect(await engine.update('inv_line', { inv: to.id }, { where: { inv: from.id }, multi: true })).toBe(3);
    expect(inv(to.id).line_count).toBe(3);
  });

  it('CONTROL: an object whose rules read no roll-up reads nothing more before its write, and admits as before', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('memo_line', [{ inv: p.id, amount: 1 }, { inv: p.id, amount: 2 }]);
    const real = engine.aggregate.bind(engine);
    (engine as any).aggregate = async (object: string, query: any, options?: any) => { log.push({ op: 'find', object: `aggregate:${object}`, ast: query }); return real(object, query, options); };
    const start = log.length;
    expect(await engine.update('memo_line', { amount: 5 }, { where: { inv: p.id }, multi: true })).toBe(2);
    const write = log.findIndex((e, i) => i >= start && e.op === 'updateMany');
    expect(log.slice(start, write).filter((e) => e.object.startsWith('aggregate:'))).toEqual([]);
    expect(inv(p.id).memo_total).toBe(10);
  });

  it('the subject reads its bases before the write: one grouped aggregate per roll-up a rule reads', async () => {
    const p = await engine.insert('inv', { name: 'P' });
    await engine.insert('inv_line', [{ inv: p.id, amount: 1, tag: 'x' }, { inv: p.id, amount: 2, tag: 'x' }]);
    const real = engine.aggregate.bind(engine);
    (engine as any).aggregate = async (object: string, query: any, options?: any) => { log.push({ op: 'find', object: `aggregate:${object}`, ast: query }); return real(object, query, options); };
    const start = log.length;
    expect(await engine.update('inv_line', { amount: 3 }, { where: { inv: p.id }, multi: true })).toBe(2);
    const write = log.findIndex((e, i) => i >= start && e.op === 'updateMany');
    const before = log.slice(start, write).filter((e) => e.object === 'aggregate:inv_line');
    // total, low, mean: every roll-up of inv_line a rule or predicate reads (total twice over:
    // directly, and through remaining and headroom) that the patch can move. [#34821] primaries
    // (a count filtered on is_primary) and line_count (a count) cannot move under an amount patch.
    expect(before).toHaveLength(3);
    expect(before.every((e) => Array.isArray(e.ast.groupBy) && e.ast.groupBy[0] === 'inv')).toBe(true);
  });
});

describe('[#34465] a min / max roll-up whose filter reads through a reference in the nested form keeps its stored value in a predicate update', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    // The nested-relation condition runs as a semi-join on a driver declaring the leaf.
    d.driver.supports = { readableIdsLeaf: true };
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({ name: 'acct', fields: { status: { type: 'text' } } } as any);
    engine.registry.registerObject({
      name: 'ord',
      fields: {
        name: { type: 'text' },
        // The nested one-level form a summary filter reads a related record with (the dotted form is refused for a relation head).
        low_active: { type: 'summary', summaryOperations: { object: 'ord_line', field: 'amount', function: 'min', filter: { acct: { status: 'active' } } } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'ord_line',
      fields: {
        amount: { type: 'number' },
        tag: { type: 'text' },
        acct: { type: 'lookup', reference: 'acct' },
        ord: { type: 'master_detail', reference: 'ord' },
      },
      validations: [
        { name: 'low_floor', type: 'script', severity: 'error', message: 'order active low under 10', condition: "record.tag == 'low' && record.ord.low_active != null && record.ord.low_active < 10" },
      ],
    } as any);
  });

  const ord = (id: string) => storeFor('ord').get(id);

  async function refusalOf(write: Promise<unknown>): Promise<unknown> {
    try { await write; } catch (err) { return err; }
    throw new Error('expected the write to be refused');
  }

  async function seed() {
    const acct = await engine.insert('acct', { status: 'active' });
    const p = await engine.insert('ord', { name: 'O' });
    const m1 = await engine.insert('ord_line', { ord: p.id, acct: acct.id, amount: 5, tag: 'x' });
    const m2 = await engine.insert('ord_line', { ord: p.id, acct: acct.id, amount: 50, tag: 'x' });
    await engine.insert('ord_line', { ord: p.id, acct: acct.id, amount: 80, tag: 'x' });
    expect(ord(p.id).low_active).toBe(5);
    return { p, m1, m2 };
  }

  it('one by one (the reference answer): a patch that moves no roll-up reads the stored minimum, and the first line is refused', async () => {
    const { m1 } = await seed();
    const err = await refusalOf(engine.update('ord_line', { id: m1.id, tag: 'low' }));
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
    expect((err as ValidationError).fields.map((f) => f.message).join(' | ')).toContain('order active low under 10');
  });

  it('predicate update: the roll-up is left out of the fold, so it reads the stored minimum as one by one does and is refused', async () => {
    const { p } = await seed();
    // Folded over the children outside the match (80), with no matched row put back, the rule would admit both rows.
    const err = await refusalOf(engine.update('ord_line', { tag: 'low' }, { where: { ord: p.id, amount: { $lt: 60 } }, multi: true }));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
    expect((err as ValidationError).fields.map((f) => f.message).join(' | ')).toContain('order active low under 10');
    expect([...storeFor('ord_line').values()].map((r) => r.tag)).toEqual(['x', 'x', 'x']);
  });
});

describe('[#34821] a multi-row insert judges a rule reading a parent field calculated from a roll-up as one by one judges it', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let log: ReturnType<typeof makeDriver>['log'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    log = d.log;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'bud',
      fields: {
        name: { type: 'text' },
        budget: { type: 'number' },
        line_count: { type: 'summary', summaryOperations: { object: 'bud_line', field: 'amount', function: 'count' } },
        total: { type: 'summary', summaryOperations: { object: 'bud_line', field: 'amount', function: 'sum' } },
        // Calculated from the roll-up: on read (a formula) and on write (a stored computed field).
        remaining: { type: 'formula', expression: 'record.budget - record.total', returnType: 'number' },
        headroom: { type: 'number', expression: { dialect: 'cel', source: 'record.budget - record.total' } },
        // A stored computed field reading its own stored value and the roll-up: a high-water mark.
        peak: { type: 'number', expression: { dialect: 'cel', source: 'record.peak == null || record.total > record.peak ? record.total : record.peak' } },
        // CONTROL: calculated from a roll-up of an object no rule of which reads this parent.
        memo_total: { type: 'summary', summaryOperations: { object: 'bud_memo', field: 'amount', function: 'sum' } },
        memo_left: { type: 'formula', expression: 'record.budget - record.memo_total', returnType: 'number' },
      },
    } as any);
    engine.registry.registerObject({ name: 'bud_memo', fields: { amount: { type: 'number' }, bud: { type: 'lookup', reference: 'bud' } } } as any);
    engine.registry.registerObject({
      name: 'bud_line',
      fields: {
        amount: { type: 'number' },
        tag: { type: 'text' },
        bud: { type: 'master_detail', reference: 'bud' },
        // A field-level parent. predicate reading the header's calculated field.
        note: { type: 'text', requiredWhen: 'parent.headroom < 50' },
        // Reads the header's formula on `parent`, guarded against a column the reader is not served (`null`).
        memo: { type: 'text', requiredWhen: "record.tag == 'remg' && parent.remaining != null && parent.remaining < 50" },
      },
      validations: [
        { name: 'remaining_cover', type: 'script', severity: 'error', message: 'line over the remaining budget', condition: "record.tag == 'rem' && record.amount > record.bud.remaining" },
        { name: 'headroom_cover', type: 'script', severity: 'error', message: 'line over the budget headroom', condition: "record.tag == 'head' && record.amount > record.bud.headroom" },
        { name: 'peak_cap', type: 'script', severity: 'error', message: 'budget peak at 50 or more', condition: "record.tag == 'peak' && record.bud.peak >= 50" },
        // Reads the roll-up itself: what a predicate update whose patch cannot move it reads.
        { name: 'total_cap', type: 'script', severity: 'error', message: 'budget total over 100', condition: "record.tag == 'cap' && record.bud.total > 100" },
      ],
    } as any);
  });

  const bud = (id: string) => storeFor('bud').get(id);
  const lines = (budId: string) => [...storeFor('bud_line').values()].filter((r) => r.bud === budId);

  async function refusalOf(write: Promise<unknown>): Promise<unknown> {
    try { await write; } catch (err) { return err; }
    throw new Error('expected the write to be refused');
  }

  function expectRuleRefusal(err: unknown, message: string): void {
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
    expect((err as ValidationError).fields.map((f) => f.message).join(' | ')).toContain(message);
  }

  for (const [tag, message] of [['rem', 'line over the remaining budget'], ['head', 'line over the budget headroom']] as const) {
    it(`one by one (the reference answer), ${tag}: the third line reads the field over the total the first two moved, and is refused`, async () => {
      const p = await engine.insert('bud', { name: 'B', budget: 100 });
      await engine.insert('bud_line', { bud: p.id, amount: 40, tag, note: 'n' });
      await engine.insert('bud_line', { bud: p.id, amount: 40, tag, note: 'n' });
      expectRuleRefusal(await refusalOf(engine.insert('bud_line', { bud: p.id, amount: 40, tag, note: 'n' })), message);
      expect(bud(p.id).total).toBe(80);
    });

    it(`multi-row insert, ${tag}: three lines in one call, the third is refused as one by one refuses it, and nothing is written`, async () => {
      const p = await engine.insert('bud', { name: 'B', budget: 100 });
      expectRuleRefusal(await refusalOf(engine.insert('bud_line', [1, 2, 3].map(() => ({ bud: p.id, amount: 40, tag, note: 'n' })))), message);
      expect(lines(p.id)).toHaveLength(0);
      expect(bud(p.id).total).toBe(0);
    });
  }

  it('multi-row insert, under the line: three lines that fit the budget are all admitted, and the roll-up and its calculated fields land as one by one lands them', async () => {
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    const ids = await engine.insert('bud_line', [1, 2, 3].map((n) => ({ bud: p.id, amount: 30, tag: n === 3 ? 'head' : 'rem', note: 'n' })));
    expect(ids).toHaveLength(3);
    expect(bud(p.id)).toMatchObject({ total: 90, headroom: 10, peak: 90 });
  });

  it('multi-row insert preview: three lines of 40 under a budget of 100, the preview refuses the third as the write does', async () => {
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    const batch = [1, 2, 3].map(() => ({ bud: p.id, amount: 40, tag: 'rem', note: 'n' }));
    const preview = await engine.validate('bud_line', batch, { mode: 'insert' });
    expect(preview.valid).toBe(false);
    expect(preview.results!.map((r) => r.valid)).toEqual([true, true, false]);
    expect(preview.results![2]!.errors.map((e) => e.message).join(' | ')).toContain('line over the remaining budget');
    expectRuleRefusal(await refusalOf(engine.insert('bud_line', batch)), 'line over the remaining budget');
    expect(lines(p.id)).toHaveLength(0);
  });

  it('multi-row insert preview, under the line: three lines of 30 are all valid, and the write admits them', async () => {
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    const batch = [1, 2, 3].map(() => ({ bud: p.id, amount: 30, tag: 'rem', note: 'n' }));
    const preview = await engine.validate('bud_line', batch, { mode: 'insert' });
    expect(preview.results!.map((r) => r.valid)).toEqual([true, true, true]);
    expect(await engine.insert('bud_line', batch)).toHaveLength(3);
    expect(bud(p.id).total).toBe(90);
  });

  it('one by one (the reference answer): a field-level parent. predicate reading the header\'s calculated field requires the note on the third line', async () => {
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    await engine.insert('bud_line', { bud: p.id, amount: 40, tag: 'x' });
    await engine.insert('bud_line', { bud: p.id, amount: 40, tag: 'x' });
    const err = await refusalOf(engine.insert('bud_line', { bud: p.id, amount: 1, tag: 'x' }));
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
    expect((err as ValidationError).fields.map((f) => f.field)).toContain('note');
  });

  it('multi-row insert: the header the parent. predicate reads carries the calculated field over the moved total, so the third line needs the note too', async () => {
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    const err = await refusalOf(engine.insert('bud_line', [{ bud: p.id, amount: 40, tag: 'x' }, { bud: p.id, amount: 40, tag: 'x' }, { bud: p.id, amount: 1, tag: 'x' }]));
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
    expect((err as ValidationError).fields.map((f) => f.field)).toContain('note');
    expect(lines(p.id)).toHaveLength(0);
  });

  it('one by one (the reference answer): a high-water mark reads every total so far, so the third line reads 80 and is refused', async () => {
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    await engine.insert('bud_line', { bud: p.id, amount: 80, tag: 'x', note: 'n' });
    await engine.insert('bud_line', { bud: p.id, amount: -60, tag: 'x', note: 'n' });
    expect(bud(p.id)).toMatchObject({ total: 20, peak: 80 });
    expectRuleRefusal(await refusalOf(engine.insert('bud_line', { bud: p.id, amount: 1, tag: 'peak', note: 'n' })), 'budget peak at 50 or more');
  });

  it('multi-row insert: the parent\'s stored image is carried from row to row as each recompute stores it, so the third line reads the peak 80 and is refused', async () => {
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    // Computed once over the stored row with the moved total (20), the peak would read 20 and the rule admit the line.
    expectRuleRefusal(await refusalOf(engine.insert('bud_line', [
      { bud: p.id, amount: 80, tag: 'x', note: 'n' }, { bud: p.id, amount: -60, tag: 'x', note: 'n' }, { bud: p.id, amount: 1, tag: 'peak', note: 'n' },
    ])), 'budget peak at 50 or more');
    expect(lines(p.id)).toHaveLength(0);
  });

  /**
   * A field-level read rule on the header, shaped like the security
   * middleware's result mask (`hide` deletes the key): `userId` is not served
   * `columns`. A system read is not masked.
   */
  function withholdBudColumns(userId: string, columns: string[]) {
    engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      await next();
      if (ctx.object !== 'bud' || ctx.context?.isSystem || ctx.context?.userId !== userId) return;
      if (!['find', 'findOne'].includes(ctx.operation)) return;
      const hide = (r: any) => { if (r && typeof r === 'object') for (const c of columns) delete r[c]; };
      if (Array.isArray(ctx.result)) ctx.result.forEach(hide); else hide(ctx.result);
    });
  }

  const noteless = (budId: string) => [{ bud: budId, amount: 40, tag: 'x' }, { bud: budId, amount: 40, tag: 'x' }, { bud: budId, amount: 1, tag: 'x' }];

  const guarded = (budId: string, amounts: number[]) => amounts.map((amount) => ({ bud: budId, amount, tag: 'remg', note: 'n' }));
  const validOf = async (batch: Record<string, unknown>[], context?: Record<string, unknown>) =>
    (await engine.validate('bud_line', batch, { mode: 'insert', ...(context ? { context: context as any } : {}) })).results!.map((r) => r.valid);

  it('multi-row insert preview, a caller not served the calculated header field: every row judges it as empty, as the first row does, whatever the header holds', async () => {
    withholdBudColumns('carol', ['remaining']);
    const carol = { userId: 'carol' };
    const verdicts: boolean[][] = [];
    for (const budget of [100, 1000]) {
      const p = await engine.insert('bud', { name: 'B', budget });
      // Precondition: the read door serves carol the header and its inputs, without the withheld column.
      const served = await engine.findOne('bud', { where: { id: p.id }, context: carol });
      expect(served).toMatchObject({ id: p.id, budget, total: 0 });
      expect(served).not.toHaveProperty('remaining');
      verdicts.push(await validOf(guarded(p.id, [40, 40, 1]), carol));
    }
    // CONTROL: a reader served the column needs the memo on the third line (remaining 20), as the write does.
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    expect(await validOf(guarded(p.id, [40, 40, 1]))).toEqual([true, true, false]);
    expect((await refusalOf(engine.insert('bud_line', guarded(p.id, [40, 40, 1]))) as ValidationError).fields.map((f) => f.field)).toContain('memo');
    // No row reads a value the first row could not, whatever the withheld column holds:
    // the earlier rows' amounts steer no withheld column.
    expect(verdicts).toEqual([[true, true, true], [true, true, true]]);
  });

  it('multi-row insert preview, a caller not served the roll-up itself: it moves from the stored value, not from the empty column, so the served calculated field reads as one by one serves it', async () => {
    withholdBudColumns('erin', ['total']);
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    await engine.insert('bud_line', { bud: p.id, amount: 40, tag: 'x', note: 'n' });
    // One by one: the first line reads remaining 60, the second 40 and needs the memo.
    // Moved from the empty column instead, the second would read 80.
    const erin = await engine.validate('bud_line', guarded(p.id, [20, 1]), { mode: 'insert', context: { userId: 'erin' } as any });
    expect(erin.results!.map((r) => r.valid)).toEqual([true, false]);
    expect(erin.results![1]!.errors.map((e) => e.field)).toContain('memo');
    expect(await validOf(guarded(p.id, [20, 1]))).toEqual([true, false]);
  });

  it('multi-row insert preview, a caller served the calculated field but not its input: the served field moves as one by one serves it, and the third line needs the note', async () => {
    withholdBudColumns('dave', ['budget']);
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    const preview = await engine.validate('bud_line', noteless(p.id), { mode: 'insert', context: { userId: 'dave' } as any });
    expect(preview.results!.map((r) => r.valid)).toEqual([true, true, false]);
    expect(preview.results![2]!.errors.map((e) => e.field)).toContain('note');
  });

  it('CONTROL: a system preview of the same batch needs the note on the third line, as the write does', async () => {
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    const preview = await engine.validate('bud_line', noteless(p.id), { mode: 'insert' });
    expect(preview.results!.map((r) => r.valid)).toEqual([true, true, false]);
    expect((await refusalOf(engine.insert('bud_line', noteless(p.id))) as ValidationError).fields.map((f) => f.field)).toContain('note');
  });

  it('CONTROL: a multi-row insert no rule of which reads the parent reads no parent row for the calculated fields over its roll-up', async () => {
    const p = await engine.insert('bud', { name: 'B', budget: 100 });
    const parentReads = (from: number) => log.slice(from).filter((e) => e.op === 'find' && e.object === 'bud' && e.ast?.where?.id?.$in);
    let start = log.length;
    await engine.insert('bud_memo', [{ bud: p.id, amount: 1 }, { bud: p.id, amount: 2 }]);
    expect(parentReads(start)).toEqual([]);
    // The probe sees such a read: an insert whose rules read the parent makes them.
    start = log.length;
    await engine.insert('bud_line', [{ bud: p.id, amount: 1, tag: 'x', note: 'n' }, { bud: p.id, amount: 2, tag: 'x', note: 'n' }]);
    expect(parentReads(start).length).toBeGreaterThan(0);
  });
});

describe('[#34821] a predicate update whose patch cannot move a roll-up its rules read reads the stored value, as the by-id update does, and leaves a trace where it stands one down', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let log: ReturnType<typeof makeDriver>['log'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    log = d.log;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'cap_head',
      fields: {
        name: { type: 'text' },
        total: { type: 'summary', summaryOperations: { object: 'cap_line', field: 'amount', function: 'sum' } },
        first_day: { type: 'summary', summaryOperations: { object: 'cap_line', field: 'day', function: 'min' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'cap_line',
      fields: {
        amount: { type: 'number' },
        day: { type: 'date' },
        tag: { type: 'text' },
        head: { type: 'master_detail', reference: 'cap_head' },
      },
      validations: [
        { name: 'total_cap', type: 'script', severity: 'error', message: 'head total over 100', condition: "record.tag == 'cap' && record.head.total > 100" },
        { name: 'day_set', type: 'script', severity: 'error', message: 'head first day is set', condition: "record.tag == 'day' && record.head.first_day == null" },
      ],
    } as any);
  });

  const head = (id: string) => storeFor('cap_head').get(id);

  async function refusalOf(write: Promise<unknown>): Promise<unknown> {
    try { await write; } catch (err) { return err; }
    throw new Error('expected the write to be refused');
  }

  /** Two lines of 40 under one head, the stored total then left stale at 150 (the children sum to 80). */
  async function seedStale() {
    const p = await engine.insert('cap_head', { name: 'H' });
    const [a] = await engine.insert('cap_line', [{ head: p.id, amount: 40, tag: 'x' }, { head: p.id, amount: 40, tag: 'x' }]);
    storeFor('cap_head').set(p.id, { ...head(p.id), total: 150 });
    return { p, a };
  }

  it('the by-id form (the reference answer): a patch that cannot move the total reads the stored 150, and is refused', async () => {
    const { a } = await seedStale();
    const err = await refusalOf(engine.update('cap_line', { id: a.id, tag: 'cap' }));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
  });

  it('predicate update: its first row reads the stored 150 as the by-id form does, not a base aggregated from the children, and nothing is aggregated before the write', async () => {
    const { p } = await seedStale();
    const real = engine.aggregate.bind(engine);
    (engine as any).aggregate = async (object: string, query: any, options?: any) => { log.push({ op: 'find', object: `aggregate:${object}`, ast: query }); return real(object, query, options); };
    const start = log.length;
    // Folded over the base (80), both rows would be admitted.
    const err = await refusalOf(engine.update('cap_line', { tag: 'cap' }, { where: { head: p.id }, multi: true }));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
    expect((err as ValidationError).fields.map((f) => f.message).join(' | ')).toContain('head total over 100');
    expect(log.slice(start).filter((e) => e.object.startsWith('aggregate:'))).toEqual([]);
    expect([...storeFor('cap_line').values()].map((r) => r.tag)).toEqual(['x', 'x']);
  });

  it('CONTROL: a patch that can move the total is still folded', async () => {
    const { p } = await seedStale();
    // Over the base: the first row reads 80 (admitted, total then 90), the second 90.
    expect(await engine.update('cap_line', { tag: 'cap', amount: 45 }, { where: { head: p.id }, multi: true })).toBe(2);
    expect(head(p.id).total).toBe(90);
  });

  it('a roll-up the fold stands down leaves one debug line naming it and why', async () => {
    const p = await engine.insert('cap_head', { name: 'H' });
    await engine.insert('cap_line', [{ head: p.id, amount: 1, day: '2026-01-02', tag: 'x' }, { head: p.id, amount: 2, day: '2026-01-03', tag: 'x' }]);
    const debug: unknown[][] = [];
    const logger = (engine as any).logger;
    const realDebug = logger.debug.bind(logger);
    logger.debug = (...args: unknown[]) => { debug.push(args); return realDebug(...args); };
    expect(await engine.update('cap_line', { tag: 'day', day: '2026-01-01' }, { where: { head: p.id }, multi: true })).toBe(2);
    const traces = debug.filter(([message]) => String(message).startsWith('Roll-up left unfolded'));
    expect(traces).toEqual([[expect.any(String), { object: 'cap_line', parentObject: 'cap_head', field: 'first_day', reason: 'not_a_number' }]]);
  });
});

describe('[#34821] a predicate update whose patch writes only a { $field } comparand of a roll-up\'s filter moves that roll-up, as the by-id update does', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'late_head',
      fields: {
        name: { type: 'text' },
        // Counts the lines closed after their due day: the patched due day is a comparand, never a key.
        late_count: { type: 'summary', summaryOperations: { object: 'late_line', field: 'id', function: 'count', filter: { closed_day: { $gt: { $field: 'due_day' } } } } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'late_line',
      fields: {
        closed_day: { type: 'number' },
        due_day: { type: 'number' },
        tag: { type: 'text' },
        head: { type: 'master_detail', reference: 'late_head' },
      },
      validations: [
        { name: 'one_late', type: 'script', severity: 'error', message: 'head already has a late line', condition: "record.tag == 'late' && record.head.late_count > 0" },
      ],
    } as any);
  });

  const head = (id: string) => storeFor('late_head').get(id);

  async function refusalOf(write: Promise<unknown>): Promise<unknown> {
    try { await write; } catch (err) { return err; }
    throw new Error('expected the write to be refused');
  }

  function expectRuleRefusal(err: unknown): void {
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDataError(err).status).toBe(400);
    expect((err as ValidationError).fields.map((f) => f.message).join(' | ')).toContain('head already has a late line');
  }

  /** Two lines closed on day 5, due on day 10: neither is late. */
  async function seed() {
    const p = await engine.insert('late_head', { name: 'H' });
    const [a, b] = await engine.insert('late_line', [{ head: p.id, closed_day: 5, due_day: 10, tag: 'x' }, { head: p.id, closed_day: 5, due_day: 10, tag: 'x' }]);
    expect(head(p.id).late_count).toBe(0);
    return { p, a, b };
  }

  it('one by one (the reference answer): the first line made late moves the count, so the second reads 1 and is refused', async () => {
    const { p, a, b } = await seed();
    await engine.update('late_line', { id: a.id, due_day: 1, tag: 'late' });
    expect(head(p.id).late_count).toBe(1);
    expectRuleRefusal(await refusalOf(engine.update('late_line', { id: b.id, due_day: 1, tag: 'late' })));
  });

  it('predicate update: the second matched row reads the count the first moved, and the update is refused', async () => {
    const { p } = await seed();
    // Read as stored (0) at every row, both rows would be admitted.
    expectRuleRefusal(await refusalOf(engine.update('late_line', { due_day: 1, tag: 'late' }, { where: { head: p.id }, multi: true })));
    expect([...storeFor('late_line').values()].map((r) => r.tag)).toEqual(['x', 'x']);
    expect(head(p.id).late_count).toBe(0);
  });

  it('CONTROL: a patch writing no field the filter reads, as key or comparand, still reads the stored count', async () => {
    const { p } = await seed();
    // Stale at 1 (the children count 0): the by-id update reads it, and so must the predicate update.
    storeFor('late_head').set(p.id, { ...head(p.id), late_count: 1 });
    expectRuleRefusal(await refusalOf(engine.update('late_line', { tag: 'late' }, { where: { head: p.id }, multi: true })));
  });
});
