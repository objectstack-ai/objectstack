// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4556 — the `'system'` → `NULL` conversion, under the ADR-0119 D2 journal.
 *
 * The bar is not "rows changed". It is:
 *
 *  1. only sentinel rows are touched (a real user id is never nulled);
 *  2. the run leaves a journal that says what it did;
 *  3. **re-running is a no-op** — the operator who is unsure whether it ran
 *     must be able to just run it again, which is the property a data
 *     migration is most often trusted with and least often given;
 *  4. writes carry the chunk's transaction context, which is also what
 *     carries `isSystem` — without it ObjectQL strips the write to
 *     `recorded_by` (a `readonly` field) and the migration silently does
 *     nothing while reporting success.
 *
 * The fake engine implements REAL rollback for the same reason the runner's
 * own suite does: without it, every assertion here would also pass against a
 * plan that never opened a transaction.
 */

import { describe, it, expect } from 'vitest';
import { runMigrationJournal, readRunJournal } from '@objectstack/core';
// [#5619] The producer's OWN write-verb dispatch decisions. Imported from
// `@objectstack/metadata-core` rather than `@objectstack/objectql` because
// objectql depends on THIS package — the import that would pin these doubles to
// objectql closes a cycle turbo refuses. #5619 sank the two predicates into a
// package both sides already depend on, which is what makes this line legal.
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import {
  createRecordedBySentinelPlan,
  findSentinelHistoryRows,
  METADATA_HISTORY_OBJECT,
  RECORDED_BY_SENTINEL,
  RECORDED_BY_SENTINEL_PLAN_ID,
} from './recorded-by-sentinel.js';

interface FakeRow { [k: string]: unknown }

class FakeEngine {
  tables = new Map<string, FakeRow[]>();
  /** Every context handed to `update`, so a test can prove transaction binding. */
  updateContexts: unknown[] = [];
  private txDepth = 0;
  private snapshot: Map<string, FakeRow[]> | null = null;
  /** Set to a chunk index to make that chunk's first write throw. */
  failOnUpdateOfId: string | null = null;

  private rows(name: string): FakeRow[] {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }

  seedHistory(rows: FakeRow[]): void {
    this.tables.set(METADATA_HISTORY_OBJECT, rows.map((r) => ({ ...r })));
  }

  history(): FakeRow[] { return this.rows(METADATA_HISTORY_OBJECT); }

  async insert(objectName: string, data: FakeRow): Promise<FakeRow> {
    const row = { ...data };
    if (objectName === 'sys_migration_journal') {
      const dup = this.rows(objectName).find((r) => r.run_id === row.run_id && r.seq === row.seq);
      if (dup) throw new Error(`duplicate journal key (${String(row.run_id)}, ${String(row.seq)})`);
    }
    this.rows(objectName).push(row);
    return row;
  }

  async find(objectName: string, query?: { where?: Record<string, unknown> }): Promise<FakeRow[]> {
    const where = query?.where ?? {};
    return this.rows(objectName).filter((r) => Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
  }

  async findOne(objectName: string, query?: { where?: Record<string, unknown> }): Promise<FakeRow | null> {
    return (await this.find(objectName, query))[0] ?? null;
  }

  async update(
    objectName: string,
    data: FakeRow,
    options?: { where?: Record<string, unknown>; context?: unknown },
  ): Promise<unknown> {
    assertEngineUpdateDispatch(data, options);
    this.updateContexts.push(options?.context);
    const id = options?.where?.id;
    if (this.failOnUpdateOfId !== null && id === this.failOnUpdateOfId) {
      throw new Error(`simulated driver failure on ${String(id)}`);
    }
    const row = this.rows(objectName).find((r) => r.id === id);
    if (!row) throw new Error(`not found: ${objectName}/${String(id)}`);
    Object.assign(row, data);
    return row;
  }

  async delete(_objectName: string, options?: { where?: Record<string, unknown>; multi?: unknown }): Promise<unknown> {
    assertEngineDeleteDispatch(options);
    return { deleted: 0 };
  }
  async count(): Promise<number> { return 0; }
  async aggregate(): Promise<unknown[]> { return []; }
  getObject(name: string): unknown { return { name }; }
  getDefaultDriverName(): string { return 'fake'; }
  getDriverByName(): unknown { return { beginTransaction: () => {}, commit: () => {}, rollback: () => {} }; }

  async transaction<T>(cb: (trxCtx: unknown) => Promise<T>, baseContext?: unknown): Promise<T> {
    if (this.txDepth > 0) return cb({ ...(baseContext as object), __tx: true });
    this.txDepth++;
    this.snapshot = new Map([...this.tables].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
    try {
      const out = await cb({ ...(baseContext as object), __tx: true });
      this.snapshot = null;
      return out;
    } catch (err) {
      this.tables = this.snapshot!; // real rollback
      this.snapshot = null;
      throw err;
    } finally {
      this.txDepth--;
    }
  }
}

const asEngine = (e: FakeEngine) => e as unknown as Parameters<typeof runMigrationJournal>[0];

/** Three sentinel rows, one real-actor row, one already-null row. */
function seedMixed(engine: FakeEngine): void {
  engine.seedHistory([
    { id: 'h1', recorded_by: RECORDED_BY_SENTINEL, operation_type: 'create' },
    { id: 'h2', recorded_by: 'usr_alice', operation_type: 'update' },
    { id: 'h3', recorded_by: RECORDED_BY_SENTINEL, operation_type: 'update' },
    { id: 'h4', recorded_by: null, operation_type: 'delete' },
    { id: 'h5', recorded_by: RECORDED_BY_SENTINEL, operation_type: 'publish' },
  ]);
}

const byId = (engine: FakeEngine, id: string) => engine.history().find((r) => r.id === id)!;

describe('#4556 migration — sentinel → NULL', () => {
  it('rewrites every sentinel row to NULL and leaves real actors alone', async () => {
    const engine = new FakeEngine();
    seedMixed(engine);

    const result = await runMigrationJournal(asEngine(engine), createRecordedBySentinelPlan());

    expect(result.status).toBe('completed');
    expect(result.chunksTotal).toBe(1);
    expect(result.chunksCommitted).toBe(1);

    expect(byId(engine, 'h1').recorded_by).toBeNull();
    expect(byId(engine, 'h3').recorded_by).toBeNull();
    expect(byId(engine, 'h5').recorded_by).toBeNull();
    // Untouched: a real user id is data, not a sentinel.
    expect(byId(engine, 'h2').recorded_by).toBe('usr_alice');
    expect(byId(engine, 'h4').recorded_by).toBeNull();
  });

  it('writes to sys_metadata_history join the chunk transaction (and so carry isSystem)', async () => {
    const engine = new FakeEngine();
    seedMixed(engine);

    await runMigrationJournal(asEngine(engine), createRecordedBySentinelPlan());

    expect(engine.updateContexts.length).toBe(3);
    for (const ctx of engine.updateContexts) {
      // `__tx` proves the write ran inside the chunk's transaction; `isSystem`
      // is what the runner seeds the base context with, and is what stops
      // ObjectQL stripping the write to this `readonly` column.
      expect(ctx).toMatchObject({ __tx: true, isSystem: true });
    }
  });

  it('leaves a journal that names the run: started → chunk_started → chunk_done → done', async () => {
    const engine = new FakeEngine();
    seedMixed(engine);

    const result = await runMigrationJournal(asEngine(engine), createRecordedBySentinelPlan());
    const events = await readRunJournal(asEngine(engine), result.runId);

    expect(events.map((e) => e.kind)).toEqual(['run_started', 'chunk_started', 'chunk_done', 'run_done']);
    const started = events[0]!;
    expect(String(started.detail)).toContain(RECORDED_BY_SENTINEL_PLAN_ID);
  });

  it('is idempotent — a second run finds nothing, commits nothing, changes nothing', async () => {
    const engine = new FakeEngine();
    seedMixed(engine);

    const first = await runMigrationJournal(asEngine(engine), createRecordedBySentinelPlan());
    expect(first.chunksCommitted).toBe(1);
    const afterFirst = engine.history().map((r) => ({ id: r.id, recorded_by: r.recorded_by }));

    // Nothing left to select — the plan's load() is the idempotence guard.
    expect(await findSentinelHistoryRows(asEngine(engine))).toEqual([]);

    const second = await runMigrationJournal(asEngine(engine), createRecordedBySentinelPlan());
    expect(second.status).toBe('completed');
    expect(second.chunksTotal).toBe(0);
    expect(second.chunksCommitted).toBe(0);
    expect(second.runId).not.toBe(first.runId);

    expect(engine.history().map((r) => ({ id: r.id, recorded_by: r.recorded_by }))).toEqual(afterFirst);
  });

  it('chunks the work — a chunkSize of 2 over 3 sentinel rows runs two chunks', async () => {
    const engine = new FakeEngine();
    seedMixed(engine);

    const result = await runMigrationJournal(asEngine(engine), createRecordedBySentinelPlan({ chunkSize: 2 }));

    expect(result.chunksTotal).toBe(2);
    expect(result.chunksCommitted).toBe(2);
    expect(engine.history().filter((r) => r.recorded_by === RECORDED_BY_SENTINEL)).toEqual([]);
  });

  it('a failing chunk unwinds the committed ones — no half-converted audit log', async () => {
    const engine = new FakeEngine();
    seedMixed(engine);
    // Chunk 0 converts h1+h3; chunk 1 blows up on h5.
    engine.failOnUpdateOfId = 'h5';

    const result = await runMigrationJournal(asEngine(engine), createRecordedBySentinelPlan({ chunkSize: 2 }));

    expect(result.status).toBe('compensated');
    expect(result.chunksCompensated).toBe(1);
    // Compensation restored the sentinel the first chunk had removed: the log
    // is back to exactly one pre-run state, not a mixture of two.
    expect(byId(engine, 'h1').recorded_by).toBe(RECORDED_BY_SENTINEL);
    expect(byId(engine, 'h3').recorded_by).toBe(RECORDED_BY_SENTINEL);
    expect(byId(engine, 'h5').recorded_by).toBe(RECORDED_BY_SENTINEL);
    expect(byId(engine, 'h2').recorded_by).toBe('usr_alice');
  });

  it('findSentinelHistoryRows selects only sentinel rows, by id', async () => {
    const engine = new FakeEngine();
    seedMixed(engine);
    expect(await findSentinelHistoryRows(asEngine(engine))).toEqual([{ id: 'h1' }, { id: 'h3' }, { id: 'h5' }]);
  });
});
