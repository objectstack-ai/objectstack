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
  type EngineUpdateDispatchInput, assertEngineFindOnePredicate,
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
  type MigrationChunkContext,
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
  /**
   * [#18063] What the transport DECLARES about a handle it would issue, held
   * apart from whether it publishes `beginTransaction` at all.
   *
   * `undefined` — the default and every pre-existing case — means the driver
   * carries no opinion, which is the shape this double could ONLY produce
   * before: its driver had no `supports` record, so a gate reading method
   * presence and a gate reading the declaration were indistinguishable here and
   * the pin below was green against both.
   */
  private driverDeclaresUnsupported: boolean | undefined;

  constructor(opts: { driverHasTx?: boolean; driverDeclaresUnsupported?: boolean } = {}) {
    this.driverHasTx = opts.driverHasTx ?? true;
    this.driverDeclaresUnsupported = opts.driverDeclaresUnsupported;
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
    assertEngineFindOnePredicate(objectName, query);
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
    if (!this.driverHasTx) return {};
    // [#18063] `beginTransaction` is published on every column — the inherited
    // door. Only `supports` differs.
    return {
      beginTransaction: () => {},
      commit: () => {},
      rollback: () => {},
      supports: this.driverDeclaresUnsupported === undefined
        ? {}
        : { transactionsUnsupported: this.driverDeclaresUnsupported },
    };
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

  it('[#18063] the driver clause reads the DECLARATION, not method presence', () => {
    // The shape neither column above can produce: `beginTransaction` present —
    // INHERITED from a base class whose transport has transactions — on a
    // transport that declared it cannot honour the handle. The engine takes its
    // declared non-transactional path for exactly this driver, so a gate
    // answering `true` here hands both callers a runtime that runs their
    // callback with NO transaction: `batchData`'s atomic arm then reports a
    // rollback that undid nothing, and the runner writes `chunk_done` rows its
    // own header says would not mean committed.
    expect(engineCanRollBack(new FakeEngine({ driverDeclaresUnsupported: true }))).toBe(false);
    // LIT controls — same double, same published `beginTransaction`, the bit
    // absent and the bit explicitly `false`. Both keep the transactional
    // answer, so the `false` above is the declaration and not a double that
    // stopped answering.
    expect(engineCanRollBack(new FakeEngine({ driverDeclaresUnsupported: false }))).toBe(true);
    expect(engineCanRollBack(new FakeEngine())).toBe(true);
  });

  it('[#18063] refuses to start when the transport DECLARED it cannot honour a handle', async () => {
    const engine = new FakeEngine({ driverDeclaresUnsupported: true });
    const plan: MigrationPlan = { id: 'p', steps: [makeStep(3)] };
    const refusal = await runMigrationJournal(asEngine(engine), plan).then(
      () => null,
      (err: unknown) => err,
    );
    expect(refusal).toBeInstanceOf(MigrationJournalRefusal);
    expect((refusal as MigrationJournalRefusal).code).toBe('NOT_IMPLEMENTED');
    // Refused means NOTHING was written — the same bar the missing-method
    // column above is held to.
    expect(engine.tables.get(JOURNAL) ?? []).toHaveLength(0);

    // LIT control: the same double with the bit removed runs to completion, so
    // the refusal is the declaration rather than an inert fixture.
    const control = new FakeEngine();
    await expect(
      runMigrationJournal(asEngine(control), { id: 'p', steps: [makeStep(3)] }),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(kindsOf(control)).toContain('run_done');
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

// ── a resume compares what the run started over (#21528) ─────────────────

/**
 * Run `plan` until a forward reaches run-global chunk `killAt`, and hand back
 * the database as a process killed there leaves it: the runner's own
 * `run_started` and every committed chunk, `chunk_started(killAt)` with no
 * `chunk_done`. The killed forward writes nothing before it stops, so the
 * tables at that moment ARE the post-crash state; a second engine gets a
 * copy, because the first one is still inside the dead chunk's transaction.
 */
async function crashAt(
  engine: FakeEngine,
  plan: MigrationPlan,
  killAt: number,
  options: { chunkSize?: number } = {},
): Promise<{ restarted: FakeEngine; runId: string }> {
  let runId = '';
  let reached: () => void = () => {};
  const atKill = new Promise<void>((resolve) => { reached = resolve; });
  const crashing: MigrationPlan = {
    ...plan,
    steps: plan.steps.map((s) => ({
      ...s,
      async forward(rows: unknown[], ctx: MigrationChunkContext, e: Parameters<typeof runMigrationJournal>[0]) {
        if (ctx.chunkIndex !== killAt) return s.forward(rows, ctx, e);
        runId = ctx.runId;
        reached();
        return new Promise<void>(() => {});
      },
    })),
  };
  void runMigrationJournal(asEngine(engine), crashing, options);
  await atKill;
  const restarted = new FakeEngine();
  restarted.tables = new Map([...engine.tables].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  return { restarted, runId };
}

const ITEMS = 'items';
const ITEMS_DONE = 'items_done';

/**
 * A step whose `load()` selects only the work still to do — `items` rows
 * without an `items_done` row — so it shrinks as the run commits chunks, the
 * shape `recorded-by`'s plan has. Its forward writes through the engine, so a
 * rolled-back chunk takes its writes with it.
 */
function makeShrinkingStep(
  engine: FakeEngine,
  n: number,
  overrides: Partial<MigrationPlanStep<{ id: string }>> = {},
): MigrationPlanStep<{ id: string }> & { forwarded: string[][]; compensated: string[][] } {
  engine.tables.set(ITEMS, Array.from({ length: n }, (_, i) => ({ id: `i${i}` })));
  const forwarded: string[][] = [];
  const compensated: string[][] = [];
  return {
    name: 'shrinking',
    forwarded,
    compensated,
    async load(e) {
      const done = new Set((await e.find(ITEMS_DONE, {})).map((r: { id: string }) => r.id));
      return (await e.find(ITEMS, {}))
        .filter((r: { id: string }) => !done.has(r.id))
        .map((r: { id: string }) => ({ id: r.id }));
    },
    async forward(rows, ctx, e) {
      forwarded.push(rows.map((r) => r.id));
      for (const r of rows) await e.insert(ITEMS_DONE, { id: r.id }, { context: ctx.context as never });
    },
    async compensate(rows) { compensated.push(rows.map((r) => r.id)); },
    ...overrides,
  };
}

const doneIds = (e: FakeEngine) => (e.tables.get(ITEMS_DONE) ?? []).map((r) => r.id);
const chunkEvents = async (e: FakeEngine, runId: string, kind: string) =>
  (await readRunJournal(asEngine(e), runId)).filter((ev) => ev.kind === kind).map((ev) => ev.chunk_index);

describe('a resume compares what the run started over, not what load() returns now (#21528)', () => {
  it('resumes a run killed after a committed chunk when load() selects only the remaining work', async () => {
    const engine = new FakeEngine();
    const step = makeShrinkingStep(engine, 5);
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2, onCrash: 'resume' };
    const { restarted, runId } = await crashAt(engine, plan, 1);
    expect(doneIds(restarted)).toEqual(['i0', 'i1']); // chunk 0 committed

    const result = await resumeMigrationJournal(asEngine(restarted), plan, runId);

    expect(result).toMatchObject({ status: 'completed', chunksTotal: 3, chunksCommitted: 3 });
    // The rows load() returns now belong, in order, to chunks 1 and 2; chunk 0
    // is not run again.
    expect(step.forwarded).toEqual([['i0', 'i1'], ['i2', 'i3'], ['i4']]);
    expect(doneIds(restarted)).toEqual(['i0', 'i1', 'i2', 'i3', 'i4']);
    expect(await chunkEvents(restarted, runId, 'chunk_started')).toEqual([0, 1, 1, 2]);
    expect(await chunkEvents(restarted, runId, 'chunk_done')).toEqual([0, 1, 2]);
  });

  it('resumes a run whose load() does not shrink with each chunk\'s rows where the journal put them', async () => {
    const engine = new FakeEngine();
    const step = makeStep(6);
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2, onCrash: 'resume' };
    const { restarted, runId } = await crashAt(engine, plan, 1);

    const result = await resumeMigrationJournal(asEngine(restarted), plan, runId);

    expect(result).toMatchObject({ status: 'completed', chunksTotal: 3, chunksCommitted: 3 });
    expect(step.written).toEqual([0, 1, 2, 3, 4, 5]); // each row once; chunk 0 not redone
  });

  it('resumes a run with the chunk size it started with, from the journal — not the plan\'s current one', async () => {
    const engine = new FakeEngine();
    const step = makeShrinkingStep(engine, 5);
    // Started at 2, the way `--chunk-size 2` starts one; the plan handed back
    // for the resume declares no size, so its own would be the default 200.
    const { restarted, runId } = await crashAt(engine, { id: 'p', steps: [step] }, 0, { chunkSize: 2 });

    const result = await resumeMigrationJournal(asEngine(restarted), { id: 'p', steps: [step] }, runId);

    expect(result).toMatchObject({ status: 'completed', chunksTotal: 3, chunksCommitted: 3 });
    expect(step.forwarded).toEqual([['i0', 'i1'], ['i2', 'i3'], ['i4']]);
  });

  it('still refuses PLAN_CHANGED a plan whose declared identity changed (the control), and writes nothing', async () => {
    for (const changed of [
      (s: MigrationPlanStep<{ id: string }>): MigrationPlan => ({ id: 'p', steps: [{ ...s, name: 'shrinking, v2' }], chunkSize: 2 }),
      (s: MigrationPlanStep<{ id: string }>): MigrationPlan => ({ id: 'p.v2', steps: [s], chunkSize: 2 }),
      (s: MigrationPlanStep<{ id: string }>): MigrationPlan => ({ id: 'p', steps: [s, { ...s, name: 'added' }], chunkSize: 2 }),
    ]) {
      const engine = new FakeEngine();
      const step = makeShrinkingStep(engine, 5);
      const { restarted, runId } = await crashAt(engine, { id: 'p', steps: [step], chunkSize: 2 }, 1);
      const before = (restarted.tables.get(JOURNAL) ?? []).length;

      await expect(resumeMigrationJournal(asEngine(restarted), changed(step), runId))
        .rejects.toMatchObject({ name: 'MigrationJournalRefusal', code: 'PLAN_CHANGED' });
      expect((restarted.tables.get(JOURNAL) ?? []).length).toBe(before);
      expect(doneIds(restarted)).toEqual(['i0', 'i1']);
    }
  });

  it('refuses PLAN_CHANGED when load() returns neither every row the run started over nor exactly the rows it had left', async () => {
    const engine = new FakeEngine();
    const step = makeShrinkingStep(engine, 5);
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2 };
    const { restarted, runId } = await crashAt(engine, plan, 1);
    // A row appeared under the run: it started over 5 rows and had 3 left,
    // and load() now returns 4.
    restarted.tables.get(ITEMS)!.push({ id: 'i5' });
    const before = (restarted.tables.get(JOURNAL) ?? []).length;

    const refusal = await resumeMigrationJournal(asEngine(restarted), plan, runId).catch((e: unknown) => e);

    expect(refusal).toBeInstanceOf(MigrationJournalRefusal);
    expect(refusal).toMatchObject({ code: 'PLAN_CHANGED' });
    expect((refusal as Error).message).toContain("step 'shrinking'"); // the binding refusal names its step
    expect((restarted.tables.get(JOURNAL) ?? []).length).toBe(before);
  });

  it('halts the unwind at a chunk an earlier process committed, rather than compensating other rows', async () => {
    const engine = new FakeEngine();
    const step = makeShrinkingStep(engine, 5);
    const plan: MigrationPlan = { id: 'p', steps: [step], chunkSize: 2, onCrash: 'resume' };
    const { restarted, runId } = await crashAt(engine, plan, 1);
    const failing: MigrationPlan = {
      ...plan,
      steps: [{
        ...step,
        async forward(rows, ctx, e) {
          if (ctx.chunkIndex === 2) throw new Error('chunk 2 fails on the resume');
          return step.forward(rows, ctx, e);
        },
      }],
    };

    const result = await resumeMigrationJournal(asEngine(restarted), failing, runId);

    // Chunk 1, committed by this process, is compensated with its own rows.
    // Chunk 0's rows left load() when it committed, so nothing here knows
    // them: the run halts `failed` instead of compensating some other rows
    // and journalling a clean unwind.
    expect(result.status).toBe('failed');
    expect(step.compensated).toEqual([['i2', 'i3']]);
    expect(await chunkEvents(restarted, runId, 'compensated')).toEqual([1]);
    const failure = (await readRunJournal(asEngine(restarted), runId)).at(-1)!;
    expect(failure).toMatchObject({ kind: 'run_failed', chunk_index: 0 });
    const detail = JSON.parse(failure.detail!);
    expect(detail).toMatchObject({ phase: 'compensate', step: 'shrinking' });
    // A halt that says why — not a compensate() that was handed no rows and threw.
    expect(detail).toHaveProperty('reason');
    expect(detail).not.toHaveProperty('error');
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
