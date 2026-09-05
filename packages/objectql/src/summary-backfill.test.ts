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
        min_estimate: { type: 'summary', summaryOperations: { object: 'task', field: 'estimate', function: 'min' } },
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

  describe('a roll-up column declared AFTER its parent rows existed (#15064)', () => {
    // The card's own repro. Every row below is stored WITHOUT the min/max/avg
    // columns — exactly what the database holds the moment a summary field is
    // added to an object that already has rows: nothing has ever computed it,
    // children or not (`initializeSummaryFields` is create-time and seeds
    // nothing for these functions anyway; the recompute runs on a child
    // write; the unscoped backfill skips the function).
    const busyAndQuiet = () => {
      legacyParent('p_busy');
      legacyTask('t1', 'p_busy', { estimate: 10, status: 'done' });
      legacyTask('t2', 'p_busy', { estimate: 32, status: 'todo' });
      legacyParent('p_quiet');
    };
    const maxOutcome = (report: Awaited<ReturnType<typeof backfillSummaryNulls>>) =>
      report.fields.find((f) => f.field === 'max_estimate');

    // What the UNSCOPED run produced for `busyAndQuiet()` on `origin/main`
    // 791a0cbe6, captured BEFORE this option existed (one throw-away test that
    // printed `JSON.stringify` of the report and the formatter lines). The
    // ruling this option lands under is 「Without the scope the run behaves
    // exactly as today」, so the unscoped pins below compare against these
    // literals whole — the one delta a reader should find is the additive
    // `recomputedUndefinedOnEmpty: []`, appended at the end of each report.
    const BASE_DRY_LINES = [
      'Scanned 2 parent row(s) across 1 object(s) for count/sum roll-up columns still stored as NULL.',
      'Would backfill 6 value(s) in 3 column(s):',
      '  • project.task_count (count over task) — 2 NULL row(s), 1 with real child data\n      e.g. p_busy, p_quiet',
      '  • project.total_estimate (sum over task) — 2 NULL row(s), 1 with real child data\n      e.g. p_busy, p_quiet',
      '  • project.done_count (count over task) — 2 NULL row(s), 1 with real child data\n      e.g. p_busy, p_quiet',
      'Rows "with real child data" are why this run recomputes instead of writing 0:',
      'their correct value is the aggregate over their children, not the empty-set value.',
      '· Untouched by design (no empty-set value — a null there means "no child rows"): project.avg_estimate (avg), project.max_estimate (max), project.min_estimate (min)',
      'Dry run — nothing was written. Re-run with --apply to backfill.',
    ];
    const BASE_APPLY_LINES = [
      'Scanned 2 parent row(s) across 1 object(s) for count/sum roll-up columns still stored as NULL.',
      'Backfilled 6 value(s) in 3 column(s):',
      '  • project.task_count (count over task) — 2 NULL row(s), 1 with real child data\n      e.g. p_busy, p_quiet',
      '  • project.total_estimate (sum over task) — 2 NULL row(s), 1 with real child data\n      e.g. p_busy, p_quiet',
      '  • project.done_count (count over task) — 2 NULL row(s), 1 with real child data\n      e.g. p_busy, p_quiet',
      'Rows "with real child data" are why this run recomputes instead of writing 0:',
      'their correct value is the aggregate over their children, not the empty-set value.',
      '· Untouched by design (no empty-set value — a null there means "no child rows"): project.avg_estimate (avg), project.max_estimate (max), project.min_estimate (min)',
    ];
    const BASE_APPLY_REPORT = {
      scannedObjects: ['project'],
      scannedRecords: 2,
      fields: [
        { object: 'project', field: 'task_count', fn: 'count', childObject: 'task', nullRows: 2, nonEmpty: 1, filled: 2, sampleRecordIds: ['p_busy', 'p_quiet'] },
        { object: 'project', field: 'total_estimate', fn: 'sum', childObject: 'task', nullRows: 2, nonEmpty: 1, filled: 2, sampleRecordIds: ['p_busy', 'p_quiet'] },
        { object: 'project', field: 'done_count', fn: 'count', childObject: 'task', nullRows: 2, nonEmpty: 1, filled: 2, sampleRecordIds: ['p_busy', 'p_quiet'] },
      ],
      nullRows: 6,
      filled: 6,
      skippedUndefinedOnEmpty: ['project.avg_estimate (avg)', 'project.max_estimate (max)', 'project.min_estimate (min)'],
      applied: true,
      truncated: false,
      unreadableObjects: [],
      failures: [],
      recomputedUndefinedOnEmpty: [], // the one additive key
    };

    it('UNSCOPED: the run is what it always was — report and wording byte-for-byte, the max still NULL and still listed as skipped', async () => {
      busyAndQuiet();

      const dry = await backfillSummaryNulls(engine, quietLogger, {});
      expect(formatSummaryBackfillReport(dry)).toEqual(BASE_DRY_LINES);
      expect(d.writes).toEqual([]);

      const report = await backfillSummaryNulls(engine, quietLogger, { apply: true });

      expect(report).toEqual(BASE_APPLY_REPORT);
      expect(formatSummaryBackfillReport(report)).toEqual(BASE_APPLY_LINES);
      // The card's measured symptom, unchanged by design: the just-declared
      // max stays NULL on the parent that has children, reported under
      // `skippedUndefinedOnEmpty` — and NOT under `fields`, so `filled` does
      // not count it.
      expect(project('p_busy')).toEqual({ id: 'p_busy', name: 'p_busy', task_count: 2, total_estimate: 42, done_count: 1 });
      expect(project('p_quiet')).toEqual({ id: 'p_quiet', name: 'p_quiet', task_count: 0, total_estimate: 0, done_count: 0 });
      expect(maxOutcome(report)).toBeUndefined();
      expect(d.writes.every((w) => !('max_estimate' in w.data))).toBe(true);
    });

    it('SCOPED: naming the max fills every parent that has children — through the aggregate the engine itself writes', async () => {
      busyAndQuiet();

      const report = await backfillSummaryNulls(engine, quietLogger, {
        apply: true,
        objects: ['project'],
        recomputeUndefinedOnEmpty: ['project.max_estimate'],
      });

      expect(project('p_busy').max_estimate).toBe(32);
      expect(report.recomputedUndefinedOnEmpty).toEqual(['project.max_estimate (max)']);
      // The scope is per column: the sibling avg/min stay out, and stay listed.
      expect(report.skippedUndefinedOnEmpty).toEqual(['project.avg_estimate (avg)', 'project.min_estimate (min)']);
      expect(maxOutcome(report)).toEqual({
        object: 'project', field: 'max_estimate', fn: 'max', childObject: 'task',
        nullRows: 1, nonEmpty: 1, filled: 1, sampleRecordIds: ['p_busy'],
      });
      expect(report.filled).toBe(BASE_APPLY_REPORT.filled + 1);
      expect(d.writes.filter((w) => 'max_estimate' in w.data)).toEqual([
        { object: 'project', id: 'p_busy', data: expect.objectContaining({ max_estimate: 32 }) },
      ]);
      // One definition of "what does this roll-up equal": the next child write
      // moves the column exactly as the engine's own recompute would, from the
      // value the backfill left there.
      await engine.insert('task', { title: 't3', estimate: 40, status: 'todo', project: 'p_busy' });
      expect(project('p_busy').max_estimate).toBe(40);
    });

    it('SCOPED: a parent with no child rows keeps NULL — the aggregate\'s own reading, not a hole — neither counted nor written', async () => {
      busyAndQuiet();

      const report = await backfillSummaryNulls(engine, quietLogger, {
        apply: true,
        recomputeUndefinedOnEmpty: ['project.max_estimate'],
      });

      expect(project('p_quiet')).not.toHaveProperty('max_estimate'); // no write ever named it
      expect(d.writes.filter((w) => w.id === 'p_quiet' && 'max_estimate' in w.data)).toEqual([]);
      // Both parents were examined (the recompute ran for p_quiet and came back
      // as the empty-set reading); only p_busy was a hole.
      expect(report.scannedRecords).toBe(2);
      expect(maxOutcome(report)).toMatchObject({ nullRows: 1, nonEmpty: 1, filled: 1, sampleRecordIds: ['p_busy'] });
    });

    it('SCOPED: count control — a count fills identically with or without the scope, and naming one is accepted as a no-op', async () => {
      busyAndQuiet();

      const report = await backfillSummaryNulls(engine, quietLogger, {
        apply: true,
        // A publish path passes every column it just declared, function unknown.
        recomputeUndefinedOnEmpty: ['project.task_count', 'project.max_estimate', 'project.max_estimate'],
      });

      expect(project('p_busy').task_count).toBe(2);
      expect(project('p_quiet').task_count).toBe(0);
      // The count column's outcome is byte-identical to the unscoped run's.
      expect(report.fields.find((f) => f.field === 'task_count')).toEqual(
        BASE_APPLY_REPORT.fields.find((f) => f.field === 'task_count'),
      );
      // A count was never skipped, so it is not "recomputed on request" either;
      // the duplicate entry resolves once.
      expect(report.recomputedUndefinedOnEmpty).toEqual(['project.max_estimate (max)']);
    });

    it('SCOPED: min, max and avg all compute through aggregateSummaryValue', async () => {
      busyAndQuiet();

      await backfillSummaryNulls(engine, quietLogger, {
        apply: true,
        recomputeUndefinedOnEmpty: ['project.min_estimate', 'project.max_estimate', 'project.avg_estimate'],
      });

      expect(project('p_busy')).toMatchObject({ min_estimate: 10, max_estimate: 32, avg_estimate: 21 });
      for (const field of ['min_estimate', 'max_estimate', 'avg_estimate']) {
        expect(project('p_quiet')).not.toHaveProperty(field);
      }
    });

    it('SCOPED: dry run reports what apply then writes, and writes nothing', async () => {
      busyAndQuiet();

      const dry = await backfillSummaryNulls(engine, quietLogger, { recomputeUndefinedOnEmpty: ['project.max_estimate'] });

      expect(dry.applied).toBe(false);
      expect(d.writes).toEqual([]);
      expect(maxOutcome(dry)).toMatchObject({ nullRows: 1, nonEmpty: 1, filled: 0 });
      expect(project('p_busy')).not.toHaveProperty('max_estimate');

      const applied = await backfillSummaryNulls(engine, quietLogger, { apply: true, recomputeUndefinedOnEmpty: ['project.max_estimate'] });
      expect(applied.nullRows).toBe(dry.nullRows);
      expect(applied.filled).toBe(dry.nullRows);
      expect(maxOutcome(applied)!.filled).toBe(maxOutcome(dry)!.nullRows);
    });

    it('SCOPED: idempotent — the second scoped run finds nothing and writes nothing', async () => {
      busyAndQuiet();
      const scope = { apply: true, recomputeUndefinedOnEmpty: ['project.max_estimate'] };

      const first = await backfillSummaryNulls(engine, quietLogger, scope);
      expect(maxOutcome(first)!.filled).toBe(1);
      const writesAfterFirst = d.writes.length;

      const second = await backfillSummaryNulls(engine, quietLogger, scope);

      // p_quiet's max is still NULL and is re-confirmed, not re-counted.
      expect(second.nullRows).toBe(0);
      expect(second.filled).toBe(0);
      expect(second.fields).toEqual([]);
      expect(second.recomputedUndefinedOnEmpty).toEqual(['project.max_estimate (max)']);
      expect(d.writes.length).toBe(writesAfterFirst);
      expect(formatSummaryBackfillReport(second)).toEqual(
        expect.arrayContaining([expect.stringContaining('No NULL roll-up values found')]),
      );
    });

    it('SCOPED: never overwrites a max already stored', async () => {
      legacyParent('p_imported', { max_estimate: 99 });
      legacyTask('t1', 'p_imported', { estimate: 10 });

      const report = await backfillSummaryNulls(engine, quietLogger, { apply: true, recomputeUndefinedOnEmpty: ['project.max_estimate'] });

      expect(project('p_imported').max_estimate).toBe(99);
      expect(maxOutcome(report)).toBeUndefined();
    });

    it('REFUSES a name it cannot resolve — FIELD_NOT_FOUND, 404 — before any row is read, on a dry run as on apply', async () => {
      busyAndQuiet();

      const refusals: Array<[string[], Record<string, unknown>]> = [
        [['project.nope'], { apply: true }],              // no such field
        [['max_estimate'], { apply: true }],              // not spelled object.field
        [['project.name'], { apply: true }],              // a field, not a roll-up
        [['task.max_estimate'], { apply: true }],         // the child owns no roll-up
        [['project.max_estimate'], { apply: true, objects: ['task'] }], // object left out of this run
        [['project.max_estimate', 'project.nope'], {}],   // one good, one bad, dry run: refused whole
      ];
      for (const [named, rest] of refusals) {
        const err = await backfillSummaryNulls(engine, quietLogger, { ...rest, recomputeUndefinedOnEmpty: named }).catch((e) => e);
        expect(err, named.join(',')).toBeInstanceOf(Error);
        expect(err.code, named.join(',')).toBe('FIELD_NOT_FOUND');
        expect(err.status, named.join(',')).toBe(404);
        expect(err.message, named.join(',')).toContain(named[named.length - 1]);
      }
      // Refused BEFORE the walk: no write at all, and even the count/sum holes
      // this run would otherwise have filled are still holes.
      expect(d.writes).toEqual([]);
      expect(project('p_busy').task_count ?? null).toBeNull();
      expect(project('p_busy')).not.toHaveProperty('max_estimate');
    });

    it('the formatter names the scoped columns and explains a NULL that remains', async () => {
      busyAndQuiet();

      const report = await backfillSummaryNulls(engine, quietLogger, { apply: true, recomputeUndefinedOnEmpty: ['project.max_estimate'] });
      const lines = formatSummaryBackfillReport(report);

      expect(lines[0]).toBe(
        'Scanned 2 parent row(s) across 1 object(s) for count/sum roll-up columns (plus 1 named min/max/avg column(s)) still stored as NULL.',
      );
      expect(lines).toEqual(expect.arrayContaining([
        expect.stringContaining('  • project.max_estimate (max over task) — 1 NULL row(s), 1 with real child data'),
        expect.stringContaining('· Recomputed on request'),
        expect.stringContaining('A parent with no child rows keeps NULL there'),
      ]));
      expect(lines.find((l) => l.startsWith('· Recomputed on request'))).toContain('project.max_estimate (max)');
      expect(lines.find((l) => l.startsWith('· Untouched by design'))).not.toContain('max_estimate');
    });
  });
});
