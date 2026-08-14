// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0119 D2 (#4617) conformance.
 *
 * The acceptance bar the ADR sets is not "the runner runs": it is that **a
 * migration killed mid-run is either resumable to completion or compensable to
 * clean, with journal rows proving which**. So the fake engine below implements
 * REAL rollback — a failed transaction discards its writes, including the
 * `chunk_done` row written inside it. Without that, every assertion here would
 * pass against a runner that never opened a transaction at all, which is the
 * exact class of bug ADR-0119 D4 was written to kill.
 */

import { describe, it, expect, vi } from 'vitest';
// [#5855] The fake engine's write verbs route through the producer's OWN
// dispatch predicates (#4550 delete / #5480 update), so this double cannot
// accept a call `ObjectQL.<verb>` refuses. Imported from
// `@objectstack/metadata-core` and not from `@objectstack/objectql`: objectql
// depends on this package, so that import would close a dependency cycle turbo
// rejects — which is why both of this file's (file, verb) pairs sat in the
// gate's DEBT ledger until #5619 sank the two predicates into a package that
// depends on neither side. `@objectstack/metadata-core` is a devDependency
// here for exactly this import, and nothing else.
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  type EngineDeleteDispatchInput,
  type EngineUpdateDispatchData,
  type EngineUpdateDispatchInput,
} from '@objectstack/metadata-core';
import {
  runMigrationJournal,
  resumeMigrationJournal,
  findInterruptedRuns,
  readRunJournal,
  engineCanRollBack,
  planChunks,
  hashMigrationPlan,
  MigrationJournalRefusal,
  MigrationPlanRegistry,
  type MigrationPlan,
  type MigrationPlanStep,
} from './migration-journal';

// ── a fake engine with real rollback ──────────────────────────────────────

interface FakeRow { [k: string]: unknown }

class FakeEngine {
  tables = new Map<string, FakeRow[]>();
  /** Set when a transaction is open — writes join it, and are discarded on throw. */
  private txDepth = 0;
  private snapshot: Map<string, FakeRow[]> | null = null;
  /** Every context object handed to `insert`, so tests can prove tx binding. */
  insertContexts: unknown[] = [];
  private driverHasTx: boolean;

  constructor(opts: { driverHasTx?: boolean } = {}) {
    this.driverHasTx = opts.driverHasTx ?? true;
  }

  private rows(name: string): FakeRow[] {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }

  async insert(objectName: string, data: FakeRow, options?: { context?: unknown }): Promise<FakeRow> {
    this.insertContexts.push(options?.context);
    const row = { ...data };
    // The unique (run_id, seq) index is part of the object contract — model it,
    // so a runner that miscomputes its next sequence fails here rather than
    // silently double-recording an event.
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

  // Neither verb is driven by anything this suite runs — the journal writes
  // rows and reads them back. They stay `not used`, but the dispatch assert
  // comes FIRST so the stub can never become the lax double of #4434 the day a
  // test starts writing through it: a call the real engine rejects is rejected
  // here, with the producer's own message, before `not used` is ever reached.
  async update(
    _objectName: string,
    data: EngineUpdateDispatchData,
    options?: EngineUpdateDispatchInput,
  ): Promise<unknown> {
    assertEngineUpdateDispatch(data, options);
    throw new Error('not used');
  }
  async delete(_objectName: string, options?: EngineDeleteDispatchInput): Promise<unknown> {
    assertEngineDeleteDispatch(options);
    throw new Error('not used');
  }
  async count(): Promise<number> { return 0; }
  async aggregate(): Promise<unknown[]> { return []; }
  getObject(name: string): unknown { return { name }; }
  getDefaultDriverName(): string { return 'fake'; }
  getDriverByName(): unknown {
    return this.driverHasTx ? { beginTransaction: () => {}, commit: () => {}, rollback: () => {} } : {};
  }

  async transaction<T>(cb: (trxCtx: unknown) => Promise<T>, baseContext?: unknown): Promise<T> {
    // Nested calls JOIN (ADR-0067 D2) — the outermost owns commit/rollback.
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

/** A step over `n` synthetic rows that records what it wrote, per attempt. */
function makeStep(
  n: number,
  overrides: Partial<MigrationPlanStep<{ i: number }>> = {},
): MigrationPlanStep<{ i: number }> & { written: number[]; undone: number[]; attempts: number[] } {
  const written: number[] = [];
  const undone: number[] = [];
  const attempts: number[] = [];
  return {
    name: 'step',
    written,
    undone,
    attempts,
    async load() { return Array.from({ length: n }, (_, i) => ({ i })); },
    async forward(rows, ctx) {
      attempts.push(ctx.attempt);
      // Idempotency by natural key, exactly as the header prescribes on a
      // re-attempt whose prior outcome is unknown.
      for (const r of rows) if (ctx.attempt === 1 || !written.includes(r.i)) written.push(r.i);
    },
    async compensate(rows) { for (const r of rows) undone.push(r.i); },
    ...overrides,
  };
}

const JOURNAL = 'sys_migration_journal';
const kindsOf = (e: FakeEngine) => (e.tables.get(JOURNAL) ?? []).map((r) => r.kind);

// ── capability gate ───────────────────────────────────────────────────────

describe('capability gate (ADR-0119 D2 item 7 / D4 probe)', () => {
  it('refuses to start when the driver cannot begin a transaction', async () => {
    const engine = new FakeEngine({ driverHasTx: false });
    const plan: MigrationPlan = { id: 'p', steps: [makeStep(3)] };
    await expect(runMigrationJournal(asEngine(engine), plan)).rejects.toThrow(MigrationJournalRefusal);
    // Refused means NOTHING was written — not even a run_started row claiming
    // a run that never legitimately began.
    expect(engine.tables.get(JOURNAL) ?? []).toHaveLength(0);
  });

  it('engineCanRollBack is two-level: engine method AND driver capability', () => {
    expect(engineCanRollBack(new FakeEngine())).toBe(true);
    expect(engineCanRollBack(new FakeEngine({ driverHasTx: false }))).toBe(false);
    expect(engineCanRollBack({})).toBe(false);
    expect(engineCanRollBack(null)).toBe(false);
    // A test double with no driver registry keeps the engine-level answer.
    expect(engineCanRollBack({ transaction: () => {} })).toBe(true);
  });
});

// ── preflight ─────────────────────────────────────────────────────────────

describe('preflight (ADR-0119 D2 item 1)', () => {
  it('runs every validator before any write and refuses on failure', async () => {
    const engine = new FakeEngine();
    const good = makeStep(2, { preflight: vi.fn(async () => {}) });
    const bad = makeStep(2, { preflight: async () => { throw new Error('column missing'); } });
    const plan: MigrationPlan = { id: 'p', steps: [good, bad] };

    await expect(runMigrationJournal(asEngine(engine), plan)).rejects.toThrow(/preflight/i);
    // The point of preflight: step 1 did not write because step 2 would fail.
    expect(good.written).toEqual([]);
    expect(engine.tables.get(JOURNAL) ?? []).toHaveLength(0);
  });

  it("refuses a plan declaring onCrash:'compensate' whose steps cannot compensate", async () => {
    const engine = new FakeEngine();
    const step = makeStep(2, { compensate: undefined });
    const plan: MigrationPlan = { id: 'p', steps: [step], onCrash: 'compensate' };
    await expect(runMigrationJournal(asEngine(engine), plan)).rejects.toThrow(/NOT_COMPENSABLE|compensate/i);
  });
});

// ── the happy path and its journal shape ──────────────────────────────────

describe('forward run', () => {
  it('chunks per plan, commits each, and journals a complete trace', async () => {
    const engine = new FakeEngine();
    const step = makeStep(5);
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2 };

    const result = await runMigrationJournal(asEngine(engine), plan);

    expect(result.status).toBe('completed');
    expect(result.chunksTotal).toBe(3); // ceil(5/2)
    expect(step.written).toEqual([0, 1, 2, 3, 4]);
    expect(kindsOf(engine)).toEqual([
      'run_started',
      'chunk_started', 'chunk_done',
      'chunk_started', 'chunk_done',
      'chunk_started', 'chunk_done',
      'run_done',
    ]);
  });

  it('writes chunk_done INSIDE the chunk transaction and chunk_started outside it', async () => {
    const engine = new FakeEngine();
    const plan: MigrationPlan = { id: 'p', steps: [makeStep(1)], chunkSize: 1 };
    await runMigrationJournal(asEngine(engine), plan);

    // Context carries `__tx` only for writes that joined a transaction. The
    // asymmetry IS the design: chunk_started must survive a crash, chunk_done
    // must not survive a rollback.
    const ctxFor = (kind: string) => {
      const rows = engine.tables.get(JOURNAL)!;
      const idx = rows.findIndex((r) => r.kind === kind);
      return engine.insertContexts[idx] as { __tx?: boolean };
    };
    expect(ctxFor('chunk_started').__tx).toBeUndefined();
    expect(ctxFor('chunk_done').__tx).toBe(true);
    expect(ctxFor('run_started').__tx).toBeUndefined();
  });
});

// ── crash mid-chunk → resume completes exactly once ───────────────────────

describe('crash mid-chunk → resume (ADR-0119 D2 item 5, acceptance case 1)', () => {
  it('rolls the killed chunk back, then resumes it exactly once on restart', async () => {
    const engine = new FakeEngine();
    let boom = true;
    const step = makeStep(4, {
      async forward(rows, ctx) {
        // Chunk 1 dies the first time it is attempted — after writing, so the
        // rollback has something to undo.
        (step as any).attempts.push(ctx.attempt);
        for (const r of rows) if (ctx.attempt === 1 || !(step as any).written.includes(r.i)) (step as any).written.push(r.i);
        if (ctx.chunkIndex === 1 && boom) { boom = false; throw new Error('killed mid-chunk'); }
      },
    });
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2, onCrash: 'resume' };

    // First run: chunk 0 commits, chunk 1 throws → LIFO compensation undoes 0.
    const first = await runMigrationJournal(asEngine(engine), plan);
    expect(first.status).toBe('compensated');

    // The killed chunk left `chunk_started` with NO `chunk_done` — "outcome
    // unknown" — and its own writes were rolled back with the transaction.
    const events = await readRunJournal(asEngine(engine), first.runId);
    const started = events.filter((e) => e.kind === 'chunk_started' && e.chunk_index === 1);
    const done = events.filter((e) => e.kind === 'chunk_done' && e.chunk_index === 1);
    expect(started).toHaveLength(1);
    expect(done).toHaveLength(0);
  });

  it('resumes forward from the first chunk lacking chunk_done, skipping committed ones', async () => {
    const engine = new FakeEngine();
    const step = makeStep(6);
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2, onCrash: 'resume' };

    // Simulate a crash by journalling a run that got through chunk 0 only.
    const runId = 'run-partial';
    await engine.insert(JOURNAL, {
      run_id: runId, seq: 0, kind: 'run_started',
      plan_hash: hashMigrationPlan(plan, planChunks(plan, [6], 2)),
      detail: JSON.stringify({ planId: 'p' }),
    });
    await engine.insert(JOURNAL, { run_id: runId, seq: 1, kind: 'chunk_started', chunk_index: 0, attempt: 1 });
    await engine.insert(JOURNAL, { run_id: runId, seq: 2, kind: 'chunk_done', chunk_index: 0, attempt: 1 });

    const result = await resumeMigrationJournal(asEngine(engine), plan, runId);

    expect(result.status).toBe('completed');
    // Chunk 0 was durable — it is NOT redone. Rows 0,1 are absent from this
    // process's writes precisely because the journal says they already landed.
    expect(step.written).toEqual([2, 3, 4, 5]);
    const events = await readRunJournal(asEngine(engine), runId);
    expect(events.filter((e) => e.kind === 'chunk_done').map((e) => e.chunk_index)).toEqual([0, 1, 2]);
    expect(events.at(-1)!.kind).toBe('run_done');
  });

  it('tells a re-attempted chunk that its prior outcome is unknown (attempt > 1)', async () => {
    const engine = new FakeEngine();
    const step = makeStep(2);
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2, onCrash: 'resume' };
    const runId = 'run-unknown';
    await engine.insert(JOURNAL, {
      run_id: runId, seq: 0, kind: 'run_started',
      plan_hash: hashMigrationPlan(plan, planChunks(plan, [2], 2)),
    });
    // chunk_started with no chunk_done — the crash signature.
    await engine.insert(JOURNAL, { run_id: runId, seq: 1, kind: 'chunk_started', chunk_index: 0, attempt: 1 });

    await resumeMigrationJournal(asEngine(engine), plan, runId);

    // The callback is TOLD it is a re-attempt, which is what lets it recheck
    // by natural key instead of blindly double-writing.
    expect(step.attempts).toEqual([2]);
    expect(step.written).toEqual([0, 1]);
  });
});

// ── plan-hash mismatch → refuse ───────────────────────────────────────────

describe('plan-hash mismatch on resume (acceptance case 3)', () => {
  it('refuses to resume a changed plan against an old journal', async () => {
    const engine = new FakeEngine();
    const plan: MigrationPlan = { id: 'p', steps: [makeStep(4)], chunkSize: 2 };
    const runId = 'run-stale';
    await engine.insert(JOURNAL, {
      run_id: runId, seq: 0, kind: 'run_started', plan_hash: 'a-hash-from-a-different-plan',
    });

    await expect(resumeMigrationJournal(asEngine(engine), plan, runId))
      .rejects.toThrow(/PLAN_CHANGED|plan hash/i);
  });

  it('the hash tracks chunk boundaries, not just step names', () => {
    const plan: MigrationPlan = { id: 'p', steps: [makeStep(4)] };
    const a = hashMigrationPlan(plan, planChunks(plan, [4], 2));
    const b = hashMigrationPlan(plan, planChunks(plan, [4], 4));
    // Same steps, same rows, different chunking — "chunk 1" means something
    // different in each, so resuming across them must not be allowed.
    expect(a).not.toBe(b);
  });
});

// ── LIFO compensation ─────────────────────────────────────────────────────

describe('LIFO compensation (ADR-0119 D2 item 4)', () => {
  it('undoes committed chunks newest-first', async () => {
    const engine = new FakeEngine();
    const order: number[] = [];
    const step = makeStep(6, {
      async forward(rows, ctx) { if (ctx.chunkIndex === 2) throw new Error('fail late'); },
      async compensate(_rows, ctx) { order.push(ctx.chunkIndex); },
    });
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2 };

    const result = await runMigrationJournal(asEngine(engine), plan);

    expect(result.status).toBe('compensated');
    expect(order).toEqual([1, 0]); // newest-first, not commit order
    const events = await readRunJournal(asEngine(engine), result.runId);
    expect(events.filter((e) => e.kind === 'compensated').map((e) => e.chunk_index)).toEqual([1, 0]);
    expect(events.at(-1)!.kind).toBe('run_failed');
  });

  it('halts loudly when a compensation fails — no silent partial (acceptance case 2)', async () => {
    const engine = new FakeEngine();
    const step = makeStep(6, {
      async forward(_rows, ctx) { if (ctx.chunkIndex === 2) throw new Error('fail late'); },
      async compensate(_rows, ctx) { if (ctx.chunkIndex === 1) throw new Error('compensation itself failed'); },
    });
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2 };

    const result = await runMigrationJournal(asEngine(engine), plan);

    // NOT 'compensated' — the database is in a state no clean story covers,
    // and the result says so rather than reporting a tidy rollback.
    expect(result.status).toBe('failed');
    const events = await readRunJournal(asEngine(engine), result.runId);
    const failure = events.filter((e) => e.kind === 'run_failed').at(-1)!;
    expect(JSON.parse(failure.detail!)).toMatchObject({ phase: 'compensate' });
    expect(failure.chunk_index).toBe(1);
    // It STOPPED at the failure: chunk 0 was not compensated behind its back.
    expect(events.filter((e) => e.kind === 'compensated').map((e) => e.chunk_index)).toEqual([]);
  });

  it('halts when a committed chunk belongs to a step with no compensate()', async () => {
    const engine = new FakeEngine();
    const step = makeStep(4, {
      async forward(_rows, ctx) { if (ctx.chunkIndex === 1) throw new Error('boom'); },
      compensate: undefined,
    });
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2 };

    const result = await runMigrationJournal(asEngine(engine), plan);

    expect(result.status).toBe('failed');
    const events = await readRunJournal(asEngine(engine), result.runId);
    expect(JSON.parse(events.at(-1)!.detail!)).toMatchObject({ reason: 'step declares no compensate()' });
  });
});

// ── discovery ─────────────────────────────────────────────────────────────

describe('findInterruptedRuns (the boot scanner input)', () => {
  it('reports a run that started and never concluded, splitting known from unknown', async () => {
    const engine = new FakeEngine();
    await engine.insert(JOURNAL, { run_id: 'r1', seq: 0, kind: 'run_started', plan_hash: 'h', detail: JSON.stringify({ planId: 'backfill' }) });
    await engine.insert(JOURNAL, { run_id: 'r1', seq: 1, kind: 'chunk_started', chunk_index: 0 });
    await engine.insert(JOURNAL, { run_id: 'r1', seq: 2, kind: 'chunk_done', chunk_index: 0 });
    await engine.insert(JOURNAL, { run_id: 'r1', seq: 3, kind: 'chunk_started', chunk_index: 1 });
    // …and the process died here.

    const found = await findInterruptedRuns(asEngine(engine));

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      runId: 'r1', planId: 'backfill',
      committedChunks: [0],
      unknownChunks: [1], // started, no done — the only state recovery reasons about
    });
  });

  it('does not report a completed run, nor a failed one that fully compensated', async () => {
    const engine = new FakeEngine();
    await engine.insert(JOURNAL, { run_id: 'done', seq: 0, kind: 'run_started' });
    await engine.insert(JOURNAL, { run_id: 'done', seq: 1, kind: 'run_done' });

    await engine.insert(JOURNAL, { run_id: 'undone', seq: 0, kind: 'run_started' });
    await engine.insert(JOURNAL, { run_id: 'undone', seq: 1, kind: 'chunk_done', chunk_index: 0 });
    await engine.insert(JOURNAL, { run_id: 'undone', seq: 2, kind: 'compensated', chunk_index: 0 });
    await engine.insert(JOURNAL, { run_id: 'undone', seq: 3, kind: 'run_failed' });

    expect(await findInterruptedRuns(asEngine(engine))).toEqual([]);
  });

  it('reports a failed run whose compensation did NOT finish', async () => {
    const engine = new FakeEngine();
    await engine.insert(JOURNAL, { run_id: 'stuck', seq: 0, kind: 'run_started' });
    await engine.insert(JOURNAL, { run_id: 'stuck', seq: 1, kind: 'chunk_done', chunk_index: 0 });
    await engine.insert(JOURNAL, { run_id: 'stuck', seq: 2, kind: 'chunk_done', chunk_index: 1 });
    await engine.insert(JOURNAL, { run_id: 'stuck', seq: 3, kind: 'compensated', chunk_index: 1 });
    await engine.insert(JOURNAL, { run_id: 'stuck', seq: 4, kind: 'run_failed' });

    const found = await findInterruptedRuns(asEngine(engine));
    expect(found).toHaveLength(1);
    expect(found[0].committedChunks).toEqual([0, 1]);
    expect(found[0].compensatedChunks).toEqual([1]); // chunk 0 still owes an answer
  });
});

// ── onCrash: 'compensate' ─────────────────────────────────────────────────

describe("onCrash: 'compensate' (ADR-0119 D2 item 5)", () => {
  it('unwinds a rediscovered run instead of carrying it forward', async () => {
    const engine = new FakeEngine();
    const step = makeStep(6);
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2, onCrash: 'compensate' };
    const runId = 'run-unwind';
    await engine.insert(JOURNAL, {
      run_id: runId, seq: 0, kind: 'run_started',
      plan_hash: hashMigrationPlan(plan, planChunks(plan, [6], 2)),
    });
    await engine.insert(JOURNAL, { run_id: runId, seq: 1, kind: 'chunk_done', chunk_index: 0 });
    await engine.insert(JOURNAL, { run_id: runId, seq: 2, kind: 'chunk_done', chunk_index: 1 });

    const result = await resumeMigrationJournal(asEngine(engine), plan, runId);

    expect(result.status).toBe('compensated');
    expect(step.written).toEqual([]);       // never went forward
    expect(step.undone).toEqual([2, 3, 0, 1]); // chunk 1's rows, then chunk 0's
  });
});

// ── sequence integrity ────────────────────────────────────────────────────

describe('journal sequence', () => {
  it('continues the sequence across a resume rather than restarting it', async () => {
    const engine = new FakeEngine();
    const plan: MigrationPlan = { id: 'p', steps: [makeStep(4)], chunkSize: 2, onCrash: 'resume' };
    const runId = 'run-seq';
    await engine.insert(JOURNAL, {
      run_id: runId, seq: 0, kind: 'run_started',
      plan_hash: hashMigrationPlan(plan, planChunks(plan, [4], 2)),
    });
    await engine.insert(JOURNAL, { run_id: runId, seq: 1, kind: 'chunk_started', chunk_index: 0 });
    await engine.insert(JOURNAL, { run_id: runId, seq: 2, kind: 'chunk_done', chunk_index: 0 });

    // A restarted sequence would collide with the unique (run_id, seq) index
    // the object declares — which the fake enforces, so this would throw.
    await expect(resumeMigrationJournal(asEngine(engine), plan, runId)).resolves.toMatchObject({ status: 'completed' });

    const events = await readRunJournal(asEngine(engine), runId);
    expect(events.map((e) => e.seq)).toEqual([...events.map((_, i) => i)]);
  });
});

// ── plan registry ─────────────────────────────────────────────────────────

describe('MigrationPlanRegistry (#4617)', () => {
  it('hands a plan back by id, and answers undefined for one it does not have', () => {
    const r = new MigrationPlanRegistry();
    const plan: MigrationPlan = { id: 'backfill', steps: [makeStep(1)] };
    r.register(plan);
    expect(r.get('backfill')).toBe(plan);
    // Undefined, not a throw: an unregistered plan is a REPORTABLE state (the
    // package owning it is not loaded), not an error in the lookup itself.
    expect(r.get('absent')).toBeUndefined();
    expect(r.list()).toEqual([plan]);
  });

  it('lets a later registration replace an earlier one for the same id', () => {
    const r = new MigrationPlanRegistry();
    const v1: MigrationPlan = { id: 'p', steps: [makeStep(1)] };
    const v2: MigrationPlan = { id: 'p', steps: [makeStep(2)] };
    r.register(v1);
    r.register(v2);
    // Last wins, and the list does not grow — a plan reloaded during dev must
    // not leave a stale twin that a resume could pick instead. The journal's
    // plan-hash check is the backstop that catches resuming a CHANGED plan.
    expect(r.get('p')).toBe(v2);
    expect(r.list()).toHaveLength(1);
  });
});
