// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `runMigrationJournal` — the framework-owned runner for data migrations that
 * are too big, too long, or too multi-step to live in one transaction
 * (ADR-0119 D2, #4617).
 *
 * ## Why this is framework-owned rather than four hand-rolled copies
 *
 * Four migration-class consumers independently converged on the same four
 * moves — dry-run preflight, an undo journal, LIFO compensation, re-entrant
 * forward recovery: ADR-0105 D13 promotion, ADR-0117 D8's ownership backfill,
 * the org lifecycle transitions, and ADR-0119 D10's master-data distribution
 * (#4585). One copy is engineering. Four is platform debt, and the fourth
 * author would have had to rediscover the `chunk_done`-inside-the-transaction
 * subtlety below from scratch — or, far more likely, not rediscover it.
 *
 * ## Why a journal at all, given ADR-0034 gave us transactions
 *
 * ADR-0119 D1 made `engine.transaction()` reachable through the contract, but
 * a transaction cannot be the whole answer here:
 *
 *  - a million-row backfill cannot hold one write-lock for its duration;
 *  - `driver-memory`'s `beginTransaction` deep-clones the entire database, so
 *    "just wrap the whole thing" is O(db) per begin;
 *  - `ObjectQL.transaction()` binds the DEFAULT driver only, so a migration
 *    spanning datasources silently commits part of its work outside it;
 *  - a process KILLED — as distinct from a thrown error — defeats in-process
 *    rollback entirely, and that is the case operators actually hit.
 *
 * So the unit of atomicity is the CHUNK, and durability across chunks is the
 * journal. Everything else in this file follows from that one sentence.
 *
 * ## The invariant that carries the whole design
 *
 * `chunk_done(i)` is written INSIDE the chunk's own transaction, so
 * `done ⇔ committed` holds by construction rather than by luck.
 * `chunk_started(i)` is written autonomously BEFORE it. A reader who "tidies"
 * that asymmetry destroys recovery: it is what gives `started ∧ ¬done` exactly
 * one meaning — **the outcome is unknown** — which is the only state a crash
 * can leave and the only state recovery has to reason about.
 *
 * ## Delivery semantics: at-least-once, idempotency is the caller's job
 *
 * Inherited verbatim from `./bulk-write.ts` rather than re-derived, because a
 * second delivery-semantics story in the same codebase is a second thing to
 * get subtly wrong. Forward and compensate callbacks receive an `attempt`
 * counter; `attempt > 1` means the previous outcome is UNKNOWN — the write may
 * or may not have committed — and the callback must recheck by natural key
 * before re-writing. That is the same contract the seed loader and import
 * runner already honour on `attempt > 1`.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import {
  MIGRATION_JOURNAL_OBJECT,
  type MigrationJournalEvent,
  type MigrationJournalKind,
  type MigrationOnCrashPolicy,
} from '@objectstack/spec/system';

/** Journal writes and recovery reads run as the platform, never as a user. */
const SYSTEM_CTX = { isSystem: true } as const;

/** Rows per chunk when a plan does not choose. Matches `bulk-write.ts`. */
const DEFAULT_CHUNK_SIZE = 200;

/**
 * Can this runtime actually roll back? — the ADR-0119 D4 gate, shared.
 *
 * Exported from `@objectstack/core` and consumed by
 * `@objectstack/metadata-protocol`'s `batchData` (which depends on core, so
 * the direction is legal) so the two cannot drift. They were the same two-line
 * condition written twice, which is precisely the shape that drifts by one
 * clause and leaves one caller believing it has atomicity it does not have.
 *
 * TWO levels, both necessary. `engine.transaction()` exists but runs the
 * callback with NO transaction and NO rollback when the default driver lacks
 * `beginTransaction` — a declared caveat of the contract member (ADR-0119 D1),
 * and one that turns "atomic" back into a lie precisely where it matters. So
 * where the driver registry is inspectable the driver is checked too; where it
 * is not (test doubles), the engine-level probe is all there is.
 *
 * A type predicate, not a bare boolean: every caller's next move is to CALL
 * `transaction`, and on the host surfaces that declare it optionally
 * (`MetadataHostEngine`) a boolean would leave each one re-narrowing by hand —
 * which is the same restatement this helper exists to remove.
 */
export function engineCanRollBack<T>(engine: T): engine is T & EngineWithTransaction {
  const e = engine as {
    transaction?: unknown;
    getDefaultDriverName?: () => string | undefined;
    getDriverByName?: (name: string) => unknown;
  } | null | undefined;
  if (typeof e?.transaction !== 'function') return false;
  const defaultDriverName = e.getDefaultDriverName?.();
  const defaultDriver = defaultDriverName ? e.getDriverByName?.(defaultDriverName) : undefined;
  return !defaultDriver || typeof (defaultDriver as { beginTransaction?: unknown }).beginTransaction === 'function';
}

/**
 * What {@link engineCanRollBack} proves is present.
 *
 * Typed FROM the contract rather than transcribed from it (#5696): a hand-copy
 * mirrors the signature only until the contract moves, and this one had already
 * started to — it predates `opts.require` and the callback's `owned` argument.
 * ADR-0119 D1 blessed exactly this shape for the narrow host surfaces
 * (`transaction?: IObjectQLEngine['transaction']`); a *narrow* surface may stay
 * narrow, but it may not drift from the real signature.
 */
export interface EngineWithTransaction {
  transaction: IObjectQLEngine['transaction'];
}

/** What a forward/compensate callback is told about the chunk it is running. */
export interface MigrationChunkContext {
  readonly runId: string;
  /** Run-global chunk index — the LIFO ordering key, stable across a resume. */
  readonly chunkIndex: number;
  /**
   * 1 on the first try. `> 1` means a previous attempt's outcome is UNKNOWN:
   * recheck by natural key before re-writing (see this file's header).
   */
  readonly attempt: number;
  /**
   * The transaction-bound execution context. Thread it to every engine call
   * this callback makes — `engine.insert(obj, row, { context })` — so the
   * write joins the chunk's transaction instead of committing beside it.
   */
  readonly context: unknown;
}

/** One step of a plan. Steps run in declaration order; each is chunked. */
export interface MigrationPlanStep<TRow = unknown> {
  readonly name: string;
  /**
   * Read-only preflight. Throw to refuse the run. Runs for EVERY step before
   * any step writes — a plan that would fail at step 3 must not have written
   * step 1 (ADR-0117 D8's fail-closed enable gate, generalized).
   */
  preflight?(engine: IObjectQLEngine): Promise<void>;
  /** The rows this step processes. Called once, before chunking. */
  load(engine: IObjectQLEngine): Promise<TRow[]>;
  /** Forward work for one chunk. Runs INSIDE the chunk's transaction. */
  forward(rows: TRow[], ctx: MigrationChunkContext, engine: IObjectQLEngine): Promise<void>;
  /**
   * Undo one previously-committed chunk. Runs in its OWN transaction.
   * A step without one makes the plan non-compensable — which the runner
   * refuses up front rather than discovering at the worst possible moment
   * (see {@link runMigrationJournal}'s preflight).
   */
  compensate?(rows: TRow[], ctx: MigrationChunkContext, engine: IObjectQLEngine): Promise<void>;
}

export interface MigrationPlan {
  /** Stable plan id. Part of the plan hash; identifies the plan across runs. */
  readonly id: string;
  /** Optional join to `sys_migration.id` when this plan implements a named migration. */
  readonly migrationId?: string;
  readonly steps: ReadonlyArray<MigrationPlanStep<any>>;
  readonly chunkSize?: number;
  /**
   * What a REDISCOVERED (crashed) run should do. Note this governs restart
   * only — an in-run failure always compensates, because the runner is still
   * alive to do it and a half-applied plan is nobody's intent.
   */
  readonly onCrash?: MigrationOnCrashPolicy;
}

/** One chunk in the run-global chunk plan. */
export interface MigrationChunk {
  /** Run-global index, 0-based, stable for a given plan hash. */
  readonly index: number;
  readonly stepIndex: number;
  readonly stepName: string;
  readonly offset: number;
  readonly length: number;
}

export interface MigrationRunResult {
  readonly runId: string;
  /**
   * `completed` — every chunk committed.
   * `compensated` — a chunk failed and every committed chunk was undone.
   * `failed` — a chunk failed AND compensation could not finish. The database
   *   is in a partial state that needs a human; the journal says exactly where.
   */
  readonly status: 'completed' | 'compensated' | 'failed';
  readonly chunksTotal: number;
  readonly chunksCommitted: number;
  readonly chunksCompensated: number;
  readonly planHash: string;
  /** The failure that ended a non-`completed` run. */
  readonly error?: unknown;
}

/**
 * Where a resume finds the plan it has to re-run (#4617).
 *
 * A journal cannot hold a plan. `forward` and `compensate` are FUNCTIONS, and
 * the rows a chunk covers are produced by `load()` against the live database —
 * none of it survives a process boundary, which is why the journal records the
 * plan HASH rather than the plan. So recovery needs the plan handed back to it
 * by whoever owns the code, and that is what this registry is: the seam between
 * "the journal knows a run stopped at chunk 7" and "something in this process
 * knows what chunk 7 was supposed to do".
 *
 * Registered as the `migration-plans` kernel service. An interrupted run whose
 * plan no loaded plugin registers is REPORTED, never silently skipped — the
 * operator is told which plan id is missing, because "nothing to resume" and
 * "the code that owns this run is not loaded" are different facts and only one
 * of them is safe to ignore.
 */
export interface MigrationPlanProvider {
  register(plan: MigrationPlan): void;
  get(planId: string): MigrationPlan | undefined;
  list(): MigrationPlan[];
}

/** The default {@link MigrationPlanProvider}. Last registration for an id wins. */
export class MigrationPlanRegistry implements MigrationPlanProvider {
  private readonly plans = new Map<string, MigrationPlan>();

  register(plan: MigrationPlan): void {
    this.plans.set(plan.id, plan);
  }

  get(planId: string): MigrationPlan | undefined {
    return this.plans.get(planId);
  }

  list(): MigrationPlan[] {
    return [...this.plans.values()];
  }
}

/** A run found by {@link findInterruptedRuns} — started, never concluded. */
export interface InterruptedRun {
  readonly runId: string;
  readonly planId: string;
  readonly planHash: string;
  readonly migrationId?: string;
  readonly startedAt?: string;
  /** Chunks whose `chunk_done` is present — known committed. */
  readonly committedChunks: number[];
  /** Chunks with `chunk_started` and no `chunk_done` — outcome UNKNOWN. */
  readonly unknownChunks: number[];
  readonly compensatedChunks: number[];
}

/** Raised when the runner refuses to start or to resume. Never a partial run. */
export class MigrationJournalRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MigrationJournalRefusal';
    this.code = code;
  }
}

// ── plan shape ────────────────────────────────────────────────────────────

/** Flatten steps × rows into the run-global chunk list. */
export function planChunks(
  plan: MigrationPlan,
  rowCounts: readonly number[],
  chunkSize = plan.chunkSize ?? DEFAULT_CHUNK_SIZE,
): MigrationChunk[] {
  const size = Math.max(1, chunkSize);
  const chunks: MigrationChunk[] = [];
  plan.steps.forEach((step, stepIndex) => {
    const total = rowCounts[stepIndex] ?? 0;
    for (let offset = 0; offset < total; offset += size) {
      chunks.push({
        index: chunks.length,
        stepIndex,
        stepName: step.name,
        offset,
        length: Math.min(size, total - offset),
      });
    }
  });
  return chunks;
}

/**
 * Hash the plan SHAPE — id, step names, and the chunk boundaries.
 *
 * Resuming a changed plan against an old journal would apply chunk boundaries
 * the journal never described: "chunk 7 done" would name a different range of
 * different rows, and the resume would skip work it never did. So the hash
 * covers exactly what a chunk index means, and a mismatch REFUSES.
 */
export function hashMigrationPlan(plan: MigrationPlan, chunks: readonly MigrationChunk[]): string {
  const shape = JSON.stringify({
    id: plan.id,
    steps: plan.steps.map((s) => s.name),
    chunks: chunks.map((c) => [c.stepIndex, c.offset, c.length]),
  });
  return createHash('sha256').update(shape, 'utf8').digest('hex').slice(0, 32);
}

// ── journal I/O ───────────────────────────────────────────────────────────

/**
 * Append one event.
 *
 * `execContext` is the transaction-bound context when the event must share a
 * chunk's fate (`chunk_done`, `compensated`) and undefined when it must NOT
 * (`chunk_started`, and every run-level event). Passing the wrong one is the
 * single most consequential mistake available in this file — see the header.
 */
async function appendEvent(
  engine: IObjectQLEngine,
  event: MigrationJournalEvent,
  execContext?: unknown,
): Promise<void> {
  await engine.insert(
    MIGRATION_JOURNAL_OBJECT,
    { ...event, created_at: event.created_at ?? new Date().toISOString() },
    { context: execContext ?? { ...SYSTEM_CTX } },
  );
}

/**
 * Every event for a run, ordered by `seq`.
 *
 * Sorted in memory, deliberately. `seq` is the ordering authority (wall-clock
 * stamps tie at coarse resolution and skew), and a run's journal is bounded by
 * its chunk count, so this costs nothing and removes recovery's dependence on
 * driver-side sort behaviour — which is not something a recovery path should
 * be discovering the edges of.
 */
export async function readRunJournal(
  engine: IObjectQLEngine,
  runId: string,
): Promise<MigrationJournalEvent[]> {
  const rows = (await engine.find(
    MIGRATION_JOURNAL_OBJECT,
    { where: { run_id: runId } },
    { context: { ...SYSTEM_CTX } },
  )) as MigrationJournalEvent[];
  return [...(rows ?? [])].sort((a, b) => Number(a.seq) - Number(b.seq));
}

/** Chunk indices carrying `kind`, as a set. */
function chunkSetOf(events: readonly MigrationJournalEvent[], kind: MigrationJournalKind): Set<number> {
  const out = new Set<number>();
  for (const e of events) {
    if (e.kind === kind && typeof e.chunk_index === 'number') out.add(e.chunk_index);
  }
  return out;
}

/**
 * Runs that started and never concluded — the boot scanner's input.
 *
 * "Concluded" means `run_done` (finished forward) or `run_failed` with every
 * committed chunk compensated (finished backward). Anything else is a run that
 * stopped mid-flight and still owes the operator an answer.
 */
export async function findInterruptedRuns(engine: IObjectQLEngine): Promise<InterruptedRun[]> {
  const started = (await engine.find(
    MIGRATION_JOURNAL_OBJECT,
    { where: { kind: 'run_started' } },
    { context: { ...SYSTEM_CTX } },
  )) as MigrationJournalEvent[];

  const out: InterruptedRun[] = [];
  for (const start of started ?? []) {
    const events = await readRunJournal(engine, start.run_id);
    if (events.some((e) => e.kind === 'run_done')) continue;

    const committed = chunkSetOf(events, 'chunk_done');
    const compensated = chunkSetOf(events, 'compensated');
    const outstanding = [...committed].filter((i) => !compensated.has(i));
    // A failed run whose committed chunks were all undone is settled: it ended
    // backward, on purpose, and its rows prove it.
    if (events.some((e) => e.kind === 'run_failed') && outstanding.length === 0) continue;

    const unknown = [...chunkSetOf(events, 'chunk_started')].filter((i) => !committed.has(i));
    let planId = start.run_id;
    try {
      planId = start.detail ? (JSON.parse(start.detail).planId ?? start.run_id) : start.run_id;
    } catch {
      // A malformed detail payload must not hide an interrupted run — the run
      // is still reported, just without its friendly plan id.
    }
    out.push({
      runId: start.run_id,
      planId,
      planHash: start.plan_hash ?? '',
      migrationId: start.migration_id,
      startedAt: start.created_at,
      committedChunks: [...committed].sort((a, b) => a - b),
      unknownChunks: unknown.sort((a, b) => a - b),
      compensatedChunks: [...compensated].sort((a, b) => a - b),
    });
  }
  return out;
}

// ── the runner ────────────────────────────────────────────────────────────

export interface RunMigrationJournalOptions {
  /** Supply to resume an existing run; omit to start a new one. */
  readonly runId?: string;
  readonly chunkSize?: number;
  /** Injectable for deterministic tests. */
  readonly now?: () => string;
}

interface LoadedPlan {
  readonly chunks: MigrationChunk[];
  readonly planHash: string;
  readonly rowsByStep: unknown[][];
}

/** Load every step's rows, derive the chunk plan, hash it. */
async function loadPlan(
  engine: IObjectQLEngine,
  plan: MigrationPlan,
  chunkSize?: number,
): Promise<LoadedPlan> {
  const rowsByStep: unknown[][] = [];
  for (const step of plan.steps) rowsByStep.push((await step.load(engine)) ?? []);
  const chunks = planChunks(plan, rowsByStep.map((r) => r.length), chunkSize ?? plan.chunkSize);
  return { chunks, planHash: hashMigrationPlan(plan, chunks), rowsByStep };
}

/**
 * Run `plan` under the journal, or resume a run left behind by a crash.
 *
 * Refuses (never partially runs) when: the runtime cannot roll back; any
 * step's preflight fails; the plan declares `onCrash: 'compensate'` but some
 * step cannot compensate; or a resume's plan hash disagrees with the journal.
 */
export async function runMigrationJournal(
  engine: IObjectQLEngine,
  plan: MigrationPlan,
  options: RunMigrationJournalOptions = {},
): Promise<MigrationRunResult> {
  const now = options.now ?? (() => new Date().toISOString());

  // ── capability gate ───────────────────────────────────────────────────
  // Refuse rather than degrade. A runner whose chunks are not actually
  // atomic writes `chunk_done` rows that mean nothing, and a journal that
  // cannot be trusted is worse than no journal — it will be believed.
  if (!engineCanRollBack(engine)) {
    throw new MigrationJournalRefusal(
      'NOT_IMPLEMENTED',
      `Migration plan '${plan.id}' requires engine transaction support; this runtime cannot roll back. ` +
        `The journal's chunk_done markers would not mean "committed", so the run is refused rather than started.`,
    );
  }

  const { chunks, planHash, rowsByStep } = await loadPlan(engine, plan, options.chunkSize);

  // ── resume bookkeeping ────────────────────────────────────────────────
  const resuming = Boolean(options.runId);
  const runId = options.runId ?? randomUUID();
  let events: MigrationJournalEvent[] = [];
  let seq = 0;
  let committed = new Set<number>();
  let compensated = new Set<number>();
  const attemptsByChunk = new Map<number, number>();

  if (resuming) {
    events = await readRunJournal(engine, runId);
    if (events.length === 0) {
      throw new MigrationJournalRefusal('NO_SUCH_RUN', `No journal rows for run '${runId}'.`);
    }
    const start = events.find((e) => e.kind === 'run_started');
    if (start?.plan_hash && start.plan_hash !== planHash) {
      // The plan changed under a journal that describes the old one. Chunk 7
      // in the journal and chunk 7 in this plan are different rows; resuming
      // would skip work that was never done.
      throw new MigrationJournalRefusal(
        'PLAN_CHANGED',
        `Refusing to resume run '${runId}': plan hash ${planHash} does not match the journal's ${start.plan_hash}. ` +
          `The chunk boundaries recorded in the journal describe a different plan.`,
      );
    }
    if (events.some((e) => e.kind === 'run_done')) {
      return {
        runId, status: 'completed', chunksTotal: chunks.length,
        chunksCommitted: chunkSetOf(events, 'chunk_done').size,
        chunksCompensated: chunkSetOf(events, 'compensated').size, planHash,
      };
    }
    seq = events.reduce((m, e) => Math.max(m, Number(e.seq) + 1), 0);
    committed = chunkSetOf(events, 'chunk_done');
    compensated = chunkSetOf(events, 'compensated');
    for (const e of events) {
      if (e.kind === 'chunk_started' && typeof e.chunk_index === 'number') {
        attemptsByChunk.set(e.chunk_index, (attemptsByChunk.get(e.chunk_index) ?? 0) + 1);
      }
    }
  }

  // ── preflight ─────────────────────────────────────────────────────────
  // Every validator runs before any write, so a plan that would fail at step 3
  // has not written step 1. On a resume this re-runs too: the world moved
  // while the process was dead, and the reason to refuse may have appeared
  // since.
  for (const step of plan.steps) {
    if (!step.preflight) continue;
    try {
      await step.preflight(engine);
    } catch (err) {
      throw new MigrationJournalRefusal(
        'PREFLIGHT_FAILED',
        `Migration plan '${plan.id}' refused: preflight for step '${step.name}' failed: ${errText(err)}`,
      );
    }
  }

  // A plan that says "undo me on crash" must be able to. Discovering that it
  // cannot at compensation time means discovering it with rows already
  // written and no way back.
  if (plan.onCrash === 'compensate') {
    const missing = plan.steps.filter((s) => !s.compensate).map((s) => s.name);
    if (missing.length > 0) {
      throw new MigrationJournalRefusal(
        'NOT_COMPENSABLE',
        `Migration plan '${plan.id}' declares onCrash: 'compensate' but step(s) ${missing.join(', ')} declare no compensate().`,
      );
    }
  }

  const rowsOf = (c: MigrationChunk): unknown[] => rowsByStep[c.stepIndex].slice(c.offset, c.offset + c.length);
  const next = (): number => seq++;

  if (!resuming) {
    await appendEvent(engine, {
      run_id: runId, seq: next(), kind: 'run_started', plan_hash: planHash,
      migration_id: plan.migrationId, created_at: now(),
      detail: JSON.stringify({
        planId: plan.id,
        onCrash: plan.onCrash ?? 'resume',
        chunks: chunks.map((c) => ({ i: c.index, step: c.stepName, offset: c.offset, length: c.length })),
      }),
    });
  }

  // A rediscovered run whose policy is 'compensate' does not go forward at
  // all — it unwinds what it already did and stops.
  if (resuming && plan.onCrash === 'compensate') {
    return await unwind(engine, plan, {
      runId, planHash, chunks, rowsOf, next, now,
      committed, compensated, chunksTotal: chunks.length,
      cause: new Error(`run '${runId}' rediscovered after interruption; plan policy is compensate`),
    });
  }

  // ── forward ───────────────────────────────────────────────────────────
  for (const chunk of chunks) {
    if (committed.has(chunk.index)) continue; // already durable — skip, do not redo
    const attempt = (attemptsByChunk.get(chunk.index) ?? 0) + 1;
    attemptsByChunk.set(chunk.index, attempt);
    const step = plan.steps[chunk.stepIndex];
    const rows = rowsOf(chunk);

    // Autonomous, BEFORE the transaction: this is what makes an interrupted
    // chunk visible as "started, outcome unknown" rather than invisible.
    await appendEvent(engine, {
      run_id: runId, seq: next(), kind: 'chunk_started',
      chunk_index: chunk.index, attempt, migration_id: plan.migrationId, created_at: now(),
    });

    try {
      await engine.transaction(async (trxCtx: unknown) => {
        await step.forward(rows, { runId, chunkIndex: chunk.index, attempt, context: trxCtx }, engine);
        // INSIDE the transaction — `done ⇔ committed`, not a race.
        await appendEvent(
          engine,
          {
            run_id: runId, seq: next(), kind: 'chunk_done',
            chunk_index: chunk.index, attempt, migration_id: plan.migrationId, created_at: now(),
          },
          trxCtx,
        );
      }, { ...SYSTEM_CTX });
      committed.add(chunk.index);
    } catch (err) {
      // The chunk rolled back, so nothing of it is on disk — including its
      // `chunk_done`. Unwind what earlier chunks committed.
      return await unwind(engine, plan, {
        runId, planHash, chunks, rowsOf, next, now,
        committed, compensated, chunksTotal: chunks.length, cause: err,
      });
    }
  }

  await appendEvent(engine, {
    run_id: runId, seq: next(), kind: 'run_done', migration_id: plan.migrationId, created_at: now(),
  });
  return {
    runId, status: 'completed', chunksTotal: chunks.length,
    chunksCommitted: committed.size, chunksCompensated: compensated.size, planHash,
  };
}

interface UnwindArgs {
  runId: string;
  planHash: string;
  chunks: readonly MigrationChunk[];
  rowsOf: (c: MigrationChunk) => unknown[];
  next: () => number;
  now: () => string;
  committed: Set<number>;
  compensated: Set<number>;
  chunksTotal: number;
  cause: unknown;
}

/**
 * LIFO compensation over committed chunks.
 *
 * Newest-first because later chunks may depend on earlier ones; undoing in
 * commit order can hit a state the compensator was never written for.
 *
 * A compensation failure HALTS and is journalled — never swallowed, never
 * "best effort, carry on". Continuing past it would produce a database whose
 * state no journal describes, which is the one outcome this whole file exists
 * to prevent. The run ends `failed`, and the rows say exactly which chunk
 * resisted.
 */
async function unwind(
  engine: IObjectQLEngine,
  plan: MigrationPlan,
  a: UnwindArgs,
): Promise<MigrationRunResult> {
  const order = [...a.committed].sort((x, y) => y - x); // newest-first
  for (const index of order) {
    if (a.compensated.has(index)) continue;
    const chunk = a.chunks[index];
    const step = plan.steps[chunk.stepIndex];

    if (!step.compensate) {
      // Nothing to undo this with. Say so loudly and stop — a silent skip
      // would leave the row written and the journal claiming a clean unwind.
      await appendEvent(engine, {
        run_id: a.runId, seq: a.next(), kind: 'run_failed',
        chunk_index: index, migration_id: plan.migrationId, created_at: a.now(),
        detail: JSON.stringify({
          phase: 'compensate', reason: 'step declares no compensate()',
          step: step.name, cause: errText(a.cause),
        }),
      });
      return {
        runId: a.runId, status: 'failed', chunksTotal: a.chunksTotal,
        chunksCommitted: a.committed.size, chunksCompensated: a.compensated.size,
        planHash: a.planHash, error: a.cause,
      };
    }

    const attempt = 1;
    try {
      await engine.transaction(async (trxCtx: unknown) => {
        await step.compensate!(a.rowsOf(chunk), { runId: a.runId, chunkIndex: index, attempt, context: trxCtx }, engine);
        await appendEvent(
          engine,
          {
            run_id: a.runId, seq: a.next(), kind: 'compensated',
            chunk_index: index, attempt, migration_id: plan.migrationId, created_at: a.now(),
          },
          trxCtx,
        );
      }, { ...SYSTEM_CTX });
      a.compensated.add(index);
    } catch (err) {
      await appendEvent(engine, {
        run_id: a.runId, seq: a.next(), kind: 'run_failed',
        chunk_index: index, migration_id: plan.migrationId, created_at: a.now(),
        detail: JSON.stringify({
          phase: 'compensate', step: step.name,
          error: errText(err), cause: errText(a.cause),
        }),
      });
      return {
        runId: a.runId, status: 'failed', chunksTotal: a.chunksTotal,
        chunksCommitted: a.committed.size, chunksCompensated: a.compensated.size,
        planHash: a.planHash, error: err,
      };
    }
  }

  await appendEvent(engine, {
    run_id: a.runId, seq: a.next(), kind: 'run_failed',
    migration_id: plan.migrationId, created_at: a.now(),
    detail: JSON.stringify({ phase: 'forward', error: errText(a.cause), compensated: [...a.compensated].sort((x, y) => x - y) }),
  });
  return {
    runId: a.runId, status: 'compensated', chunksTotal: a.chunksTotal,
    chunksCommitted: a.committed.size, chunksCompensated: a.compensated.size,
    planHash: a.planHash, error: a.cause,
  };
}

/** Resume a run the journal says was interrupted. Thin alias for intent at call sites. */
export async function resumeMigrationJournal(
  engine: IObjectQLEngine,
  plan: MigrationPlan,
  runId: string,
  options: Omit<RunMigrationJournalOptions, 'runId'> = {},
): Promise<MigrationRunResult> {
  return runMigrationJournal(engine, plan, { ...options, runId });
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return '<unprintable error>';
  }
}
