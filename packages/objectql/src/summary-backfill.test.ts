// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os migrate summary-nulls` — the one-off backfill of roll-up `count`/`sum`
// columns left `NULL` by inserts predating PR #6013 (#6063, second half of
// #5749).
//
// Every fixture here builds the state the migration exists for: rows written
// STRAIGHT INTO THE DRIVER STORE, bypassing the engine's insert path, which is
// exactly what a database upgraded in place holds — parents stored before the
// insert-time seed existed, never revisited because no child of theirs was
// ever written. Inserting them through the engine would seed them to 0 and
// there would be nothing left to test.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { backfillSummaryNulls, formatSummaryBackfillReport } from './summary-backfill.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const writes: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  // Minimal FilterCondition matcher — implicit equality, the comparison
  // operators the keyset walk emits (`$gt` on `id`), and the `$and`/`$or`/`$not`
  // the engine emits when a summary carries a filter.
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
  /** Set by a test to make ONE parent's update fail, pinning failure isolation. */
  let failUpdateFor: string | null = null;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
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
      if (failUpdateFor && id === failUpdateFor) throw new Error('driver refused this row');
      writes.push({ object, id, data });
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
  return {
    driver,
    storeFor,
    writes,
    failUpdateFor: (id: string | null) => { failUpdateFor = id; },
  };
}

const quietLogger = { info: () => {}, warn: () => {} };

describe('backfillSummaryNulls — pre-#6013 NULL roll-ups (#6063)', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;

  /** A parent row as an IN-PLACE UPGRADED database holds it: no summary values
   *  at all, because the insert that wrote it predates the seed. */
  const legacyParent = (id: string, extra: Record<string, unknown> = {}) => {
    d.storeFor('project').set(id, { id, name: id, ...extra });
  };
  /** A child row written the same way — so no recompute ever ran for it. */
  const legacyTask = (id: string, project: string, extra: Record<string, unknown> = {}) => {
    d.storeFor('task').set(id, { id, title: id, project, ...extra });
  };
  const project = (id: string) => d.storeFor('project').get(id);

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'project',
      fields: {
        name: { type: 'text' },
        task_count: { type: 'summary', summaryOperations: { object: 'task', field: 'id', function: 'count' } },
        total_estimate: { type: 'summary', summaryOperations: { object: 'task', field: 'estimate', function: 'sum' } },
        done_count: {
          type: 'summary',
          summaryOperations: { object: 'task', field: 'id', function: 'count', filter: { status: 'done' } },
        },
        // No empty-set value — a stored null here means "no child rows" and is
        // NOT a defect. Deliberately out of this migration's scope.
        avg_estimate: { type: 'summary', summaryOperations: { object: 'task', field: 'estimate', function: 'avg' } },
        max_estimate: { type: 'summary', summaryOperations: { object: 'task', field: 'estimate', function: 'max' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'task',
      fields: {
        title: { type: 'text' },
        status: { type: 'text' },
        estimate: { type: 'number' },
        project: { type: 'master_detail', reference: 'project' },
      },
    } as any);
  });

  it('gives a NULL parent WITH children its real aggregate — not 0', async () => {
    // The case the cheap `UPDATE … SET col = 0 WHERE col IS NULL` answers
    // wrongly: nothing ever recomputed this parent, so it is NULL, but it has
    // children and its correct value is the aggregate over them.
    legacyParent('p_busy');
    legacyTask('t1', 'p_busy', { estimate: 10, status: 'done' });
    legacyTask('t2', 'p_busy', { estimate: 32, status: 'todo' });

    const report = await backfillSummaryNulls(engine, quietLogger, { apply: true });

    expect(project('p_busy').task_count).toBe(2);
    expect(project('p_busy').total_estimate).toBe(42);
    expect(project('p_busy').done_count).toBe(1); // the per-summary filter is honoured
    expect(report.filled).toBe(3);
    expect(report.nullRows).toBe(3);
    // Every one of the three columns held real child data — the report says so,
    // which is the evidence that 0 would have been wrong here.
    expect(report.fields.every((f) => f.nonEmpty === 1)).toBe(true);
  });

  it('gives a NULL parent with NO children the empty-set value 0', async () => {
    legacyParent('p_quiet');

    await backfillSummaryNulls(engine, quietLogger, { apply: true });

    expect(project('p_quiet').task_count).toBe(0);
    expect(project('p_quiet').total_estimate).toBe(0);
    expect(project('p_quiet').done_count).toBe(0);
  });

  it('leaves min/max/avg NULL exactly as they are, and reports them as out of scope', async () => {
    legacyParent('p_busy');
    legacyTask('t1', 'p_busy', { estimate: 10 });

    const report = await backfillSummaryNulls(engine, quietLogger, { apply: true });

    // Undefined on an empty set — and undefined is what the column keeps here:
    // this migration does not decide anything about them either way.
    expect(project('p_busy').avg_estimate ?? null).toBeNull();
    expect(project('p_busy').max_estimate ?? null).toBeNull();
    expect(report.skippedUndefinedOnEmpty).toEqual(
      expect.arrayContaining(['project.avg_estimate (avg)', 'project.max_estimate (max)']),
    );
    // …and no write ever named them.
    expect(d.writes.every((w) => !('avg_estimate' in w.data) && !('max_estimate' in w.data))).toBe(true);
  });

  it('is idempotent — the second run finds nothing and writes nothing', async () => {
    legacyParent('p_busy');
    legacyTask('t1', 'p_busy', { estimate: 10 });
    legacyParent('p_quiet');

    const first = await backfillSummaryNulls(engine, quietLogger, { apply: true });
    expect(first.filled).toBeGreaterThan(0);
    const writesAfterFirst = d.writes.length;

    const second = await backfillSummaryNulls(engine, quietLogger, { apply: true });

    expect(second.nullRows).toBe(0);
    expect(second.filled).toBe(0);
    expect(second.fields).toEqual([]);
    expect(d.writes.length).toBe(writesAfterFirst); // not one further write
  });

  it('is a no-op on a database whose rows were all created with the seed (a fresh install)', async () => {
    // Nothing legacy at all: every parent went through the engine's insert
    // path, so #6013 already gave it 0.
    const p = await engine.insert('project', { name: 'Apollo' });
    await engine.insert('task', { title: 't', estimate: 5, project: p.id });
    const writesBefore = d.writes.length;

    const report = await backfillSummaryNulls(engine, quietLogger, { apply: true });

    expect(report.nullRows).toBe(0);
    expect(report.filled).toBe(0);
    expect(report.failures).toEqual([]);
    expect(report.truncated).toBe(false);
    expect(d.writes.length).toBe(writesBefore);
    expect(formatSummaryBackfillReport(report)).toEqual(
      expect.arrayContaining([expect.stringContaining('No NULL count/sum roll-up values found')]),
    );
  });

  it('dry run reports the same rows and writes nothing', async () => {
    legacyParent('p_busy');
    legacyTask('t1', 'p_busy', { estimate: 10 });

    const dry = await backfillSummaryNulls(engine, quietLogger, {});

    expect(dry.applied).toBe(false);
    expect(dry.nullRows).toBe(3);
    expect(dry.filled).toBe(0);
    expect(d.writes).toEqual([]);
    expect(project('p_busy').task_count ?? null).toBeNull();

    const applied = await backfillSummaryNulls(engine, quietLogger, { apply: true });
    // What the dry run said it would do is what the apply run did.
    expect(applied.nullRows).toBe(dry.nullRows);
    expect(applied.filled).toBe(dry.nullRows);
  });

  it('never overwrites a value already stored — including a deliberate 0', async () => {
    legacyParent('p_imported', { task_count: 7, total_estimate: 0, done_count: 3 });
    legacyTask('t1', 'p_imported', { estimate: 10, status: 'done' });

    const report = await backfillSummaryNulls(engine, quietLogger, { apply: true });

    expect(project('p_imported').task_count).toBe(7);
    expect(project('p_imported').total_estimate).toBe(0);
    expect(project('p_imported').done_count).toBe(3);
    expect(report.nullRows).toBe(0);
  });

  it('writes the SAME value the engine\'s own child-write recompute would', async () => {
    // The point of sharing `aggregateSummaryValue`: after the backfill, the very
    // next child write must not move the column. A second implementation that
    // merged the summary filter differently, or fell back differently on an
    // empty aggregate, would show up here as a column that changes under a user
    // who changed nothing.
    legacyParent('p_busy');
    legacyTask('t1', 'p_busy', { estimate: 10, status: 'done' });
    legacyTask('t2', 'p_busy', { estimate: 32, status: 'todo' });

    await backfillSummaryNulls(engine, quietLogger, { apply: true });
    const backfilled = {
      task_count: project('p_busy').task_count,
      total_estimate: project('p_busy').total_estimate,
      done_count: project('p_busy').done_count,
    };

    // A child write of a zero-valued, non-matching task: the recompute runs and
    // must land on exactly the same numbers except the one it really changes.
    await engine.insert('task', { title: 't3', estimate: 0, status: 'todo', project: 'p_busy' });

    expect(project('p_busy').total_estimate).toBe(backfilled.total_estimate);
    expect(project('p_busy').done_count).toBe(backfilled.done_count);
    expect(project('p_busy').task_count).toBe(backfilled.task_count! + 1);
  });

  it('restricts to the objects it is given', async () => {
    legacyParent('p_quiet');

    const report = await backfillSummaryNulls(engine, quietLogger, { apply: true, objects: ['task'] });

    expect(report.scannedObjects).toEqual([]); // `task` owns no roll-up
    expect(report.nullRows).toBe(0);
    expect(project('p_quiet').task_count ?? null).toBeNull();
  });

  it('records a row it cannot write and carries on with the rest', async () => {
    legacyParent('p_bad');
    legacyParent('p_good');
    d.failUpdateFor('p_bad');

    const report = await backfillSummaryNulls(engine, quietLogger, {
      apply: true,
      // One attempt, no sleeping — this failure is deterministic, not transient.
      retry: { maxRetries: 1, sleep: async () => {} },
    });

    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures.every((f) => f.recordId === 'p_bad')).toBe(true);
    // The healthy parent is still backfilled — one row's failure is not the
    // run's failure.
    expect(project('p_good').task_count).toBe(0);
    expect(formatSummaryBackfillReport(report)).toEqual(
      expect.arrayContaining([expect.stringContaining('could not be recomputed')]),
    );
  });
});
