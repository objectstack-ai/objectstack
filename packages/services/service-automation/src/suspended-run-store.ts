// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Logger } from '@objectstack/spec/contracts';
// [#10101] The SHARED platform-row organization resolver — the cloud#1395
// ruling ("A platform row's organization is the SUBJECT record's organization;
// actor context is the fallback, never the primary"), implemented once in
// `@objectstack/metadata-core` and consumed by all three sanctioned writers
// (audit stamping, the approval-row writer, this automation-run recorder). A
// recorder-local re-derivation here was rejected by name (Option B): it would
// be a third answer to a question the codebase already answered two ways.
import { createRecordOrganizationResolver, type RecordOrganizationResolver } from '@objectstack/metadata-core';
import type {
  ConsumedSuspensionDropNotice,
  RunRecord,
  SuspendedRun,
  SuspendedRunStore,
  SuspensionClaimOutcome,
  SuspensionParkedAt,
} from './engine.js';

/**
 * Durable persistence for suspended flow runs (ADR-0019).
 *
 * The engine keeps an in-memory map of paused runs; that map is lost on a
 * process restart (e.g. a hibernating Cloudflare Worker), so a run that paused
 * at an `approval` / `wait` / `screen` node can never be resumed afterwards.
 * A {@link SuspendedRunStore} backs the in-memory map with durable storage so a
 * cold-booted kernel can rehydrate and continue.
 *
 * Two implementations ship here:
 *   - {@link InMemorySuspendedRunStore} — a Map (the default behaviour, for
 *     tests / dev). It JSON round-trips on save/load so it faithfully exercises
 *     the serialization boundary a DB store imposes.
 *   - {@link ObjectStoreSuspendedRunStore} — persists to the `sys_automation_run`
 *     object via the ObjectQL engine, for production / serverless hosts.
 */

const TABLE = 'sys_automation_run';
/** Prefix for terminal run-history row ids, keeping them disjoint from live
 *  suspended runs (which use the raw `runId`). */
const HISTORY_PREFIX = 'run_';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * [#15832] The sentinel the counted-multi-delete capability probe addresses —
 * see {@link ObjectStoreSuspendedRunStore.probeCountedMultiDelete}.
 *
 * It is written into `id`, `node_id` AND `correlation` at once, so a row would
 * have to carry this exact string in all three columns to match. No producer
 * writes it into any of them: `id` is the engine's minted `runId` (or a
 * {@link HISTORY_PREFIX}-prefixed terminal id), `node_id` is an authored flow
 * node id, and `correlation` is minted by the pausing executor.
 *
 * ⛔ The zero-match property is NOT bought with an empty `$in` or any other
 * "matches nothing by construction" operator. `{ id: { $in: [] } }` reads as
 * the safer spelling and is the more dangerous one: it is a driver-by-driver
 * question whether an empty `IN` compiles at all, and the failure direction of
 * a builder that drops an empty clause is a `DELETE` over the whole table.
 * Three ANDed equalities compile the same way everywhere and fail closed.
 */
const CLAIM_CAPABILITY_PROBE_SENTINEL = '__objectstack_suspended_run_claim_capability_probe__';

/**
 * [#15832] What the one-time probe learned about this engine's counted
 * multi-delete route — `ObjectQL.delete` declares `Promise<any>`, so this is
 * the only place the answer exists.
 */
type CountedMultiDeleteCapability =
  /** The route resolved a number: the compare-and-set verdict is readable. */
  | { readonly counted: true }
  /** It resolved something else; `observed` is that value's `typeof`. */
  | { readonly counted: false; readonly observed: string };

/**
 * Default per-flow cap on terminal run-history rows (#2585). A busy
 * per-record-change flow otherwise persists one row per execution forever —
 * exactly the unbounded self-telemetry growth ADR-0057 exists to prevent.
 * 100 newest terminal runs per flow keeps the Runs surface useful while
 * bounding the table. `0` disables the cap.
 *
 * This write-time COUNT bound is the only retention this store enforces.
 * AGE retention is declarative (#2834): `sys_automation_run` declares
 * `retention: { maxAge, onlyWhen: { status: { $in: [...] } } }` and the
 * platform Reaper sweeps it — suspended (`paused`) rows are live resumable
 * state and never match the predicate.
 */
export const DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW = 100;

/** Max deletes one write-time overflow prune may issue — bounds the write
 *  amplification a single `recordTerminal` can incur on a legacy oversized
 *  table (the periodic age sweep handles bulk convergence). */
const OVERFLOW_PRUNE_BATCH = 50;

/** Byte cap for a terminal row's persisted `steps_json`. When over, the step
 *  tail is halved until it fits — the newest steps carry the failure. */
const MAX_STEPS_JSON_BYTES = 64 * 1024;

/**
 * [#13909] Byte cap for the consumed-suspension snapshot a terminal row
 * carries (`variables_json` + `context_json` + `screen_json` together).
 *
 * ⛔ Over budget the snapshot is DROPPED, never truncated — and that asymmetry
 * with `steps_json` above is the whole point. A halved step tail is still an
 * honest, smaller observation; half a variable map is a run that would resume
 * from state it was never in. The drop is RECORDED in the row (#13937,
 * {@link CONSUMED_SUSPENSION_DROPPED_KEY}): `restoreConsumedSuspension` then
 * restores from the hot copy in the process that stranded the run, and from
 * any other replica answers `NO_CONSUMED_SUSPENSION` naming this budget —
 * both true — instead of restoring a corrupt pause that looks perfectly
 * healthy, or reading the missing snapshot as a run that moved on.
 */
const MAX_CONSUMED_SUSPENSION_JSON_BYTES = 256 * 1024;

/**
 * [#13937] The ONE key a terminal row's `variables_json` holds when the
 * consumed-suspension snapshot was dropped over
 * {@link MAX_CONSUMED_SUSPENSION_JSON_BYTES}. It rides the discriminator
 * column on purpose — "this failed run had a pause and no longer has one"
 * stays true of the row — and it can never collide with a real variable map:
 * `$`-prefixed names are the engine's own, and a map holding exactly this one
 * key is not a state any flow was ever in.
 */
const CONSUMED_SUSPENSION_DROPPED_KEY = '$consumedSuspensionDropped';

/** Byte cap for a terminal row's persisted `summary_json` (#4354). Generous
 *  relative to the shape it holds — one entry per node that ran, one per gate
 *  that closed — so only a pathological flow ever trips it. */
const MAX_SUMMARY_JSON_BYTES = 16 * 1024;

function isTerminalStatus(status: unknown): boolean {
    return status === 'completed' || status === 'failed';
}

/** Deep clone via JSON so a stored snapshot can't alias live engine state. */
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Parse a JSON column that may already be an object (some drivers auto-parse). */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

/**
 * In-memory {@link SuspendedRunStore}. Snapshots are JSON-cloned on the way in
 * and out, matching the serialize/deserialize boundary of a DB-backed store —
 * so a unit test can share one instance across two engine instances to simulate
 * a process restart (suspend on engine A, resume on engine B).
 */
export class InMemorySuspendedRunStore implements SuspendedRunStore {
  private readonly runs = new Map<string, SuspendedRun>();
  private readonly history = new Map<string, RunRecord>();
  private readonly maxTerminalRunsPerFlow: number;

  constructor(options?: { maxTerminalRunsPerFlow?: number }) {
    this.maxTerminalRunsPerFlow =
      options?.maxTerminalRunsPerFlow ?? DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW;
  }

  async save(run: SuspendedRun): Promise<void> {
    this.runs.set(run.runId, jsonClone(run));
  }

  async load(runId: string): Promise<SuspendedRun | null> {
    const run = this.runs.get(runId);
    return run ? jsonClone(run) : null;
  }

  async delete(runId: string): Promise<void> {
    this.runs.delete(runId);
  }

  /**
   * [#14333] Conditional consume. The test and the removal sit between the
   * same two `await` points — there is none between them — so on a single
   * JavaScript thread they ARE one atomic operation against `this.runs`, which
   * is what lets two engines sharing one instance of this store produce
   * exactly one winner. Spelling it as `load()` then `delete()` would put a
   * microtask boundary in the middle and reopen the window.
   */
  async claimSuspension(runId: string, parkedAt: SuspensionParkedAt): Promise<SuspensionClaimOutcome> {
    const run = this.runs.get(runId);
    if (!run) return 'lost';
    if (run.nodeId !== parkedAt.nodeId) return 'lost';
    // Compared only when the caller has one, per the contract: a row persisted
    // without a correlation has nothing to compare and the node test stands.
    if (parkedAt.correlation !== undefined && run.correlation !== parkedAt.correlation) return 'lost';
    this.runs.delete(runId);
    return 'claimed';
  }

  async list(): Promise<SuspendedRun[]> {
    return [...this.runs.values()].map(jsonClone);
  }

  async recordTerminal(record: RunRecord): Promise<void> {
    this.history.set(record.runId, jsonClone(record));
    // Per-flow cap (#2585 retention): evict the oldest terminal runs beyond
    // the cap, mirroring the DB-backed store's write-time prune.
    if (this.maxTerminalRunsPerFlow > 0) {
      const flowRuns = [...this.history.values()]
        .filter((r) => r.flowName === record.flowName)
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
      for (const evicted of flowRuns.slice(this.maxTerminalRunsPerFlow)) {
        this.history.delete(evicted.runId);
      }
    }
  }

  async listHistory(flowName: string, limit: number): Promise<RunRecord[]> {
    return [...this.history.values()]
      .filter((r) => r.flowName === flowName)
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
      .slice(0, limit)
      .map(jsonClone);
  }

  async loadTerminal(runId: string): Promise<RunRecord | null> {
    const record = this.history.get(runId);
    return record ? jsonClone(record) : null;
  }
}

/**
 * Minimal ObjectQL engine surface the {@link ObjectStoreSuspendedRunStore} uses.
 * Matches the find/insert/update/delete shape exposed by the `objectql` service
 * (and mirrors `ApprovalEngine` in plugin-approvals).
 */
export interface SuspendedRunStoreEngine {
  find(object: string, options?: any): Promise<any[]>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, data: any, options?: any): Promise<any>;
  delete?(object: string, options?: any): Promise<any>;
  /**
   * [#10101] Registered object definition for a name — what the shared
   * platform-row organization resolver (`@objectstack/metadata-core`) reads to
   * answer "which column carries the TRIGGERING object's own organization".
   * Optional so an in-memory test double without it degrades to the
   * acting-context fallback rather than failing the write (the same
   * best-effort posture the resolver itself takes).
   */
  getSchema?(objectName: string): unknown;
}

interface MinimalLogger {
  warn?: Logger['warn'];
  debug?: Logger['debug'];
}

/** Tuning knobs for the DB-backed store's run-history retention (#2585). */
export interface ObjectStoreSuspendedRunStoreOptions {
  /**
   * Per-flow cap on terminal history rows, enforced at write time in
   * {@link ObjectStoreSuspendedRunStore.recordTerminal}. Defaults to
   * {@link DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW}; `0` disables the cap.
   */
  maxTerminalRunsPerFlow?: number;
}

/**
 * Durable {@link SuspendedRunStore} backed by the `sys_automation_run` object.
 *
 * Persists the resumable run state (`variables` / `steps` / `context` / `screen`)
 * JSON-serialized, so the engine's `Map`-based variable context round-trips. A
 * live pause is keyed by `runId` and removed on terminal completion; terminal
 * runs are kept as `run_`-prefixed history rows (bounded by the per-flow cap
 * and the age sweep, #2585). All access uses a system context — these are
 * infrastructure rows, not tenant data subject to RLS (the tenant is captured
 * in `organization_id` for scoping/observability).
 */
export class ObjectStoreSuspendedRunStore implements SuspendedRunStore {
  private readonly maxTerminalRunsPerFlow: number;
  /**
   * [#14333] Whether this store has already said it cannot express the
   * conditional advance — see {@link claimSuspension}'s docblock.
   */
  private claimUnsupportedWarned = false;
  /**
   * [#15832] The in-flight or settled one-time capability probe — memoized as
   * the PROMISE, not as its value, so two resumes arriving in the same tick
   * take one probe between them rather than one each.
   *
   * ⛔ A REJECTED probe is deliberately un-memoized (see
   * {@link probeCountedMultiDelete}): a store that was unreachable for one
   * second must not answer for the life of the process.
   */
  private countedMultiDelete?: Promise<CountedMultiDeleteCapability>;
  /**
   * [#10101] Memoized shared platform-row organization resolver over the same
   * engine the rows are written through — answers "which column carries the
   * TRIGGERING object's own organization, and what does the trigger record
   * hold there". One instance for the store's lifetime: object schemas are
   * static after registration, and the audit and approval writers memoize the
   * same way.
   */
  private readonly recordOrgResolver: RecordOrganizationResolver;

  constructor(
    private readonly engine: SuspendedRunStoreEngine,
    private readonly logger?: MinimalLogger,
    options?: ObjectStoreSuspendedRunStoreOptions,
  ) {
    this.maxTerminalRunsPerFlow =
      options?.maxTerminalRunsPerFlow ?? DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW;
    this.recordOrgResolver = createRecordOrganizationResolver(engine);
  }

  async save(run: SuspendedRun): Promise<void> {
    const now = new Date().toISOString();
    const row = this.serialize(run);
    // Upsert: a re-suspend (the run paused again at a downstream node) updates
    // the existing row rather than inserting a duplicate.
    const existing = await this.engine.find(TABLE, {
      where: { id: run.runId }, limit: 1, context: SYSTEM_CTX,
    });
    if (Array.isArray(existing) && existing[0]) {
      await this.engine.update(
        TABLE,
        { ...row, updated_at: now },
        { where: { id: run.runId }, context: SYSTEM_CTX },
      );
    } else {
      await this.engine.insert(
        TABLE,
        { ...row, created_at: now, updated_at: now },
        { context: SYSTEM_CTX },
      );
    }
  }

  /**
   * Read the backing table once so a misconfiguration surfaces at BOOT rather
   * than as a per-suspend write failure nobody reads. Throws the driver error
   * verbatim — `no such table: sys_automation_run` means the object was never
   * registered (or its schema never synced), which is #4420: a durable store
   * that silently persists nothing and zombifies every pause on restart.
   */
  async probe(): Promise<void> {
    await this.engine.find(TABLE, { where: {}, limit: 1, context: SYSTEM_CTX });
  }

  async load(runId: string): Promise<SuspendedRun | null> {
    const rows = await this.engine.find(TABLE, {
      where: { id: runId }, limit: 1, context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? this.deserialize(row) : null;
  }

  async delete(runId: string): Promise<void> {
    if (typeof this.engine.delete !== 'function') {
      this.logger?.warn?.(
        `[automation] ObjectStoreSuspendedRunStore: engine has no delete(); suspended run '${runId}' row not removed`,
      );
      return;
    }
    await this.engine.delete(TABLE, { where: { id: runId }, context: SYSTEM_CTX });
  }

  /**
   * [#14333] Conditional consume against `sys_automation_run`, as ONE
   * statement: `DELETE ... WHERE id = ? AND node_id = ?` (plus `correlation`
   * when the caller has one), whose affected-row count names the winner.
   *
   * ⛔ No schema change, and none is needed: `node_id` and `correlation` are
   * columns {@link serialize} has always written, so the condition is
   * expressible against the row exactly as it stands. (A version column on
   * `sys_automation_run` was the other candidate remedy and is deliberately
   * NOT taken — a platform-object schema change is the maintainer's floor.)
   *
   * The spelling is `multi: true` with a full `where`: `ObjectQL.delete`
   * dispatches a `where` carrying keys BESIDES `id` to `driver.deleteMany`
   * with the composed AST — the engine's own compare-and-set route, documented
   * as such in `engine-delete-dispatch.ts` — and `IDataDriver.deleteMany` is
   * contracted to resolve an affected COUNT. A pure-`id` `where` would take
   * the by-id route instead and silently discard the condition, which is the
   * one shape that must never happen here. ⛔ Dropping `multi: true` does not
   * degrade to the by-id route either: with unhonoured keys in the `where` and
   * no `multi`, the dispatch verdict is `reject` and `ObjectQL.delete` THROWS
   * `ENGINE_DELETE_REJECT_MESSAGE`. That is pinned in
   * `suspended-run-store.test.ts` through the producer's own predicate rather
   * than by asserting the token, so a double can never be looser than the
   * engine here.
   *
   * THREE ways a composition can leave this store unable to offer the
   * guarantee, and only the first two are an `'unsupported'` ANSWER:
   *
   *  1. an engine with no `delete()` at all — the same composition
   *     {@link delete} already degrades on;
   *  2. a multi-row result that is not a count, where "did I win?" has no
   *     answer to read — settled BEFORE the compare-and-set since #15832, by
   *     {@link probeCountedMultiDelete}; see the section below;
   *  3. ⚠️ a DRIVER with no `deleteMany` — which this method never sees as an
   *     answer at all. `ObjectQL.delete` resolves the predicate route and then
   *     finds no `deleteMany` to call, so it throws
   *     `ENGINE_DELETE_REJECT_MESSAGE` rather than returning anything; the
   *     engine's `claimAdvance` maps that throw to `STORE_UNAVAILABLE`, so such
   *     a composition REFUSES every resume instead of degrading to an
   *     unguarded one. All five shipped drivers implement `deleteMany` (memory,
   *     sql, mongodb, turso; sqlite-wasm inherits it from `SqlDriver`), so this
   *     is third-party exposure only — recorded here because a host wiring its
   *     own driver is the one reader who can hit it, and the symptom (every
   *     resume 503) does not name its cause.
   *
   * The two answers it CAN give are said once per store instance, not once per
   * call: a composition that cannot express the condition cannot express it for
   * the rest of the process, so a line per resume would be pure repetition of a
   * permanent fact — the same call {@link AutomationEngine.claim}'s
   * missing-ledger branch makes, and what the engine's own degradation line
   * already promises. ⛔ Deliberately NOT extended to {@link delete}'s warn one
   * screen up: that line predates this card, fires once per CONSUMPTION rather
   * than once per resume attempt, and is not this change's to re-shape.
   *
   * ## [#15832] Reason 2 is settled BEFORE the row is touched, and `'unsupported'`
   * is no longer an answer this method can give AFTER it
   *
   * Until #15832 the shape test lived where the count arrives — i.e. one line
   * after the compare-and-set had gone out. On an engine whose multi-delete
   * does not resolve a count that made the refusal a LIE about its own effect:
   * the conditional delete had been performed against the shared row and its
   * verdict discarded, so a replica that ACTUALLY LOST (0 rows affected) was
   * told `'unsupported'`, which {@link AutomationEngine.claimAdvance} reads as
   * `unguarded`, and it resumed. That is the doubled side effect #14333 exists
   * to prevent, occurring on the one composition that declares itself unable
   * to prevent it. (The extra round-trip `forgetSuspendedRun` then issues is
   * real too, and ⛔ it is not why this changed.)
   *
   * So the question is asked of a call that touches no suspension:
   * {@link probeCountedMultiDelete}, once per store instance, down the very
   * route the claim takes, against a predicate that matches no row.
   *
   * ⚠️ **What that probe cannot do, stated plainly.** It cannot promise what
   * the NEXT call resolves to. `ObjectQL.delete` declares `Promise<any>`
   * (`packages/objectql/src/engine.ts`) and what surfaces is `opCtx.result`,
   * which any middleware may rewrite per call — so "the engine returns a
   * count" is not a fact the probe can establish, only a fact it can OBSERVE
   * once. There is no read-only way to establish it either: the shape is
   * undeclared at this boundary, and the only instrument that answers is a
   * call down the same route. Closing THAT gap is #16033's — the count is
   * contracted one layer down (`IDataDriver.deleteMany`,
   * `packages/spec/src/contracts/data-driver.ts`, `Promise<number>`) and
   * erased to `any` at the engine boundary this store talks to.
   *
   * ⇒ The probe alone would therefore be exactly the "looks like it decides in
   * advance" change it must not be. It is half of the fix, and the half it
   * buys is the DECLARATION: an engine that cannot count is refused with
   * nothing consumed, which is what makes `claimAdvance`'s `unguarded`
   * reading true when it is taken. The other half is the residual, below.
   *
   * ⭐ **The residual is closed by RETIRING `'unsupported'` after the write.**
   * If a probed-counting engine still resolves a non-count for a real claim,
   * the compare-and-set is committed and its verdict is unrecoverable — a
   * winner and a loser both see the row gone, so no follow-up read can tell
   * them apart. That is not "no guarantee was offered"; it is UNKNOWN, which
   * this store says the way every other unknown is said here: it THROWS.
   * {@link AutomationEngine.claimAdvance} already catches exactly that and
   * answers `STORE_UNAVAILABLE`, whose text is already written for this fact
   * ("a failure can arrive after a committed delete"), and the resume is
   * REFUSED rather than continued. ⇒ A replica that lost is never told it is
   * unguarded once the row has been touched, whatever the probe concluded.
   *
   * ⛔ Refusing is not free and is not pretended to be: a claim that in fact
   * WON is then stranded (the row is gone and this resume does not continue
   * it) until an operator retries. That is the deliberate direction — #14333's
   * whole premise is that a doubled side effect is the worse outcome — and it
   * is reachable only on an engine that answers inconsistently between the
   * probe and the claim, which no shipped composition does.
   */
  async claimSuspension(runId: string, parkedAt: SuspensionParkedAt): Promise<SuspensionClaimOutcome> {
    if (typeof this.engine.delete !== 'function') {
      this.warnClaimUnsupported(
        `engine has no delete(); the conditional advance for suspended run '${runId}' cannot be expressed`,
      );
      return 'unsupported';
    }
    // [#15832] BEFORE the row is touched. A rejection propagates: it means the
    // question could not be asked at all, which `claimAdvance` already maps to
    // STORE_UNAVAILABLE — the same answer the claim itself produced when it
    // was the call that threw, and the same one a driver with no `deleteMany`
    // produces (reason 3 above).
    const capability = await this.countedMultiDeleteCapability();
    if (!capability.counted) {
      this.warnClaimUnsupported(
        `the data engine's multi-row delete resolved ${capability.observed}, not an affected-row count, so the ` +
          `conditional advance for suspended run '${runId}' cannot be decided — NO delete was issued, so no ` +
          `suspension was consumed and no claim verdict was discarded`,
      );
      return 'unsupported';
    }
    const where: Record<string, unknown> = { id: runId, node_id: parkedAt.nodeId };
    if (parkedAt.correlation !== undefined) where.correlation = parkedAt.correlation;
    const affected = await this.engine.delete(TABLE, { where, multi: true, context: SYSTEM_CTX });
    if (typeof affected !== 'number') {
      // ⛔ NOT `'unsupported'`, and this is the whole of #15832. The
      // compare-and-set is COMMITTED; its verdict is unreadable and
      // unrecoverable. Answering "no guarantee is offered" here would hand a
      // losing replica an `unguarded` resume having just consumed — or failed
      // to consume — the row it is racing for.
      throw new Error(
        `the data engine's multi-row delete resolved ${typeof affected}, not an affected-row count, AFTER the ` +
          `compare-and-set for suspended run '${runId}' had already been issued. This engine answered a count ` +
          `for the capability probe, so the shape is inconsistent between calls and this claim's verdict is ` +
          `UNRECOVERABLE — a winner and a loser both find the row gone. Refusing the resume rather than ` +
          `guessing: retry once the engine answers consistently.`,
      );
    }
    return affected > 0 ? 'claimed' : 'lost';
  }

  /**
   * [#15832] Ask, ONCE per store instance, whether this engine's counted
   * multi-delete route resolves a count — before anything is claimed on it.
   *
   * See {@link claimSuspension}'s docblock for why the question is asked at
   * all, and for the boundary of what an answer here is worth.
   *
   * ## The probe is a mutation-SHAPED call that mutates nothing
   *
   * The route is the decision, not the statement: `ObjectQL.delete` sends a
   * `where` carrying keys besides `id` together with `multi: true` to
   * `driver.deleteMany`, and that is the only route whose result is a count.
   * So the probe must be a delete — a `find` would answer about a different
   * method. What it must NOT be is a delete that can consume anything, and it
   * is not: the predicate is {@link CLAIM_CAPABILITY_PROBE_SENTINEL} in all
   * three condition columns at once.
   *
   * What a zero-match multi-delete costs on the real engine, read off
   * `ObjectQL.delete` rather than assumed:
   *
   *  - **no row changes** — the predicate matches none;
   *  - **no hook dispatch** — the caller's `where` is present, so the
   *    unscoped-multi-write dispatch does not fire; the per-row before phase
   *    is explicitly "zero matched rows is zero dispatches"; and the per-row
   *    after phase iterates the same empty set;
   *  - **no realtime event** — `publishBulkDataEvent` returns at `matched === 0`
   *    with a `debug` line, precisely so an idle sweep is not a webhook
   *    delivery saying "0 records";
   *  - **no summary recompute** — that is the by-id arm's, keyed on a pre-image
   *    this path never reads.
   *
   * ⇒ one `DELETE … WHERE` that matches nothing, once per process. It also
   * happens to remove the redundant round-trip the old shape bought on every
   * resume of an uncounted engine, but ⛔ that is a side benefit, not the
   * reason.
   *
   * ⛔ A THROWN probe is not memoized. "The store was unreachable" is a
   * transient fact and must not become this store's permanent answer; the
   * rejection reaches {@link claimSuspension}'s caller, and the next resume
   * asks again. A SETTLED probe — counted or not — is memoized either way,
   * because that one is a property of the composition.
   *
   * ⛔ And a throwaway ROW is deliberately not inserted to make the probe
   * match something. It would answer a strictly stronger question (that the
   * count counts, not merely that it is a number), and `typeof affected !==
   * 'number'` is the whole of the condition this store branches on — while
   * buying an INSERT on a platform object and a stranded row whenever a
   * process dies between the two statements.
   */
  private countedMultiDeleteCapability(): Promise<CountedMultiDeleteCapability> {
    return this.countedMultiDelete ?? this.probeCountedMultiDelete();
  }

  private probeCountedMultiDelete(): Promise<CountedMultiDeleteCapability> {
    const pending = (async (): Promise<CountedMultiDeleteCapability> => {
      const affected = await this.engine.delete!(TABLE, {
        where: {
          id: CLAIM_CAPABILITY_PROBE_SENTINEL,
          node_id: CLAIM_CAPABILITY_PROBE_SENTINEL,
          correlation: CLAIM_CAPABILITY_PROBE_SENTINEL,
        },
        multi: true,
        context: SYSTEM_CTX,
      });
      return typeof affected === 'number' ? { counted: true } : { counted: false, observed: typeof affected };
    })();
    // Memoized BEFORE it settles, so concurrent resumes share one probe.
    this.countedMultiDelete = pending;
    // Forget a REJECTED probe so the next resume re-asks. The `catch` is on a
    // derived promise purely to keep the memoized rejection from surfacing as
    // an unhandled one; `pending` itself is what callers await, so they still
    // see the failure.
    pending.catch(() => {
      if (this.countedMultiDelete === pending) this.countedMultiDelete = undefined;
    });
    return pending;
  }

  /**
   * [#14333] Say ONCE, per store instance, that this composition cannot
   * express the conditional advance. See {@link claimSuspension}'s docblock
   * for why once and not per call.
   */
  private warnClaimUnsupported(cause: string): void {
    if (this.claimUnsupportedWarned) return;
    this.claimUnsupportedWarned = true;
    this.logger?.warn?.(
      `[automation] ObjectStoreSuspendedRunStore: ${cause} — no cross-replica advance guarantee is offered ` +
        `by this store for the life of this process.`,
    );
  }

  async list(): Promise<SuspendedRun[]> {
    const rows = await this.engine.find(TABLE, {
      where: { status: 'paused' }, limit: 1000, context: SYSTEM_CTX,
    });
    return (Array.isArray(rows) ? rows : []).map(r => this.deserialize(r));
  }

  /**
   * Persist a TERMINAL run (completed / failed) as durable history. Keyed by a
   * `run_`-prefixed id so it NEVER collides with a live suspended run's row
   * (id = raw `runId`, status `paused`) — the suspend save/load/delete/list
   * path (which only touches raw ids and `status:'paused'` rows) is untouched.
   * Upsert so a re-emitted terminal (e.g. a resumed run) updates in place.
   */
  async recordTerminal(record: RunRecord): Promise<void> {
    const now = new Date().toISOString();
    const id = HISTORY_PREFIX + record.runId;
    const row = {
      id,
      // [#10101, the cloud#1395 Option A ruling] SUBJECT first, actor second:
      // the organization of the record this run is ABOUT (resolved from the
      // trigger-record snapshot through the shared platform-row resolver —
      // `sys_api_key`'s divergent `active_organization_id` included), falling
      // back to the acting context's tenant (`record.organizationId`) when the
      // trigger carries no record or the object has no organization of its
      // own. A plain scheduled sweep has neither and keeps NULL — fabricating
      // an acting organization stays vetoed (Option C). Same inputs and same
      // precedence as `serialize()` below, so a run's paused row and its
      // terminal row agree by construction.
      organization_id:
        this.recordOrgResolver.organizationOf(record.triggerObject ?? '', record.triggerRecord) ??
        record.organizationId ??
        null,
      flow_name: record.flowName,
      flow_version: record.flowVersion ?? null,
      node_id: record.nodeId ?? null,
      status: record.status,
      user_id: record.userId ?? null,
      // #7533 — trigger attribution. Terminal rows never carried any: the
      // in-memory run knew its kind and this mapping dropped it, so a restart
      // turned every history row into "a run happened" with no "why".
      trigger_type: record.triggerType ?? null,
      trigger_object: record.triggerObject ?? null,
      trigger_record_id: record.triggerRecordId ?? null,
      started_at: record.startedAt,
      start_time: record.startTime ?? null,
      finished_at: record.finishedAt ?? now,
      duration_ms: record.durationMs ?? null,
      error: record.error ?? null,
      steps_json: serializeStepsBounded(record.steps),
      // #4354 — the totals land in COLUMNS so an operator can alert on
      // `selected_count > 0 AND acted_count = 0`; the per-node / per-gate detail
      // rides in the JSON blob. Null (not 0) when the engine computed no
      // summary: "not measured" and "measured zero" are different answers, and
      // only one of them should trip an alarm.
      selected_count: record.summary?.selected ?? null,
      acted_count: record.summary?.acted ?? null,
      skipped_count: record.summary?.skipped ?? null,
      unmeasured_count: record.summary?.unmeasured ?? null,
      summary_json: record.summary ? serializeSummaryBounded(record.summary) : null,
      // [#13909] The suspension this run's resume consumed before the
      // downstream node threw, in the columns that already exist for exactly
      // this state and were simply never written on terminal rows.
      //
      // ALWAYS all four keys, `null` when there is no snapshot: this is an
      // UPSERT, and a restored run that later finishes must CLEAR what it
      // carried. Omitting the keys would leave a stale snapshot behind on the
      // updated row, which an operator could restore a second time — the run
      // would go back to a pause it has already left.
      //
      // `node_type` rides along because the resume authority gate (#3801) keys
      // on it: a suspension restored without it is one a `resumeAuthority`
      // check can only fall back on the live flow for.
      ...serializeConsumedSuspension(record.consumedSuspension, this.logger),
    };
    const existing = await this.engine.find(TABLE, {
      where: { id }, limit: 1, context: SYSTEM_CTX,
    });
    if (Array.isArray(existing) && existing[0]) {
      await this.engine.update(TABLE, { ...row, updated_at: now }, { where: { id }, context: SYSTEM_CTX });
    } else {
      await this.engine.insert(TABLE, { ...row, created_at: now, updated_at: now }, { context: SYSTEM_CTX });
      // Write-time retention (#2585): keep only the newest N terminal rows per
      // flow. Best-effort — a prune failure never fails the history write.
      try {
        await this.pruneFlowOverflow(record.flowName);
      } catch (err) {
        this.logger?.warn?.(
          `[automation] run-history overflow prune failed for '${record.flowName}': ${(err as Error)?.message}`,
        );
      }
    }
  }

  /**
   * Enforce the per-flow terminal-history cap: fetch the flow's rows, keep the
   * newest {@link ObjectStoreSuspendedRunStoreOptions.maxTerminalRunsPerFlow}
   * terminal ones, delete the overflow (bounded per call by
   * {@link OVERFLOW_PRUNE_BATCH}). Paused rows are live resumable state and are
   * never touched. Steady state deletes at most one row per terminal write.
   */
  private async pruneFlowOverflow(flowName: string): Promise<void> {
    const max = this.maxTerminalRunsPerFlow;
    if (!(max > 0) || typeof this.engine.delete !== 'function') return;
    const rows = await this.engine.find(TABLE, {
      where: { flow_name: flowName },
      limit: max * 2 + OVERFLOW_PRUNE_BATCH,
      context: SYSTEM_CTX,
    });
    const overflow = (Array.isArray(rows) ? rows : [])
      .filter((r) => isTerminalStatus(r?.status))
      .sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')))
      .slice(max, max + OVERFLOW_PRUNE_BATCH);
    for (const row of overflow) {
      await this.engine.delete(TABLE, { where: { id: row.id }, context: SYSTEM_CTX });
    }
    if (overflow.length > 0) {
      this.logger?.debug?.(
        `[automation] run-history cap: pruned ${overflow.length} terminal run(s) of '${flowName}' beyond newest ${max}`,
      );
    }
  }

  /** Load one terminal history row by raw `runId` (durable `getRun` fallback). */
  async loadTerminal(runId: string): Promise<RunRecord | null> {
    const rows = await this.engine.find(TABLE, {
      where: { id: HISTORY_PREFIX + runId }, limit: 1, context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !isTerminalStatus(row.status)) return null;
    return this.deserializeTerminal(row);
  }

  /** Newest terminal (`completed` / `failed`) run-history rows for one flow. */
  async listHistory(flowName: string, limit: number): Promise<RunRecord[]> {
    // Fetch the flow's rows and filter terminal in memory — avoids depending on
    // IN-clause support in the driver's `where`. Paused rows are excluded.
    const rows = await this.engine.find(TABLE, {
      where: { flow_name: flowName }, limit: Math.max(limit * 4, 200), context: SYSTEM_CTX,
    });
    return (Array.isArray(rows) ? rows : [])
      .filter(r => r?.status === 'completed' || r?.status === 'failed')
      .map(r => this.deserializeTerminal(r))
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
      .slice(0, limit);
  }

  /** Rebuild a {@link RunRecord} from a terminal `sys_automation_run` row. */
  private deserializeTerminal(row: any): RunRecord {
    const rawId = String(row.id ?? '');
    return {
      runId: rawId.startsWith(HISTORY_PREFIX) ? rawId.slice(HISTORY_PREFIX.length) : rawId,
      flowName: String(row.flow_name ?? ''),
      flowVersion: typeof row.flow_version === 'number' ? row.flow_version : undefined,
      status: row.status === 'failed' ? 'failed' : 'completed',
      startedAt: row.started_at ?? row.created_at ?? '',
      startTime: typeof row.start_time === 'number' ? row.start_time : undefined,
      finishedAt: row.finished_at ?? undefined,
      durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : undefined,
      error: row.error ?? undefined,
      nodeId: row.node_id ?? undefined,
      organizationId: row.organization_id ?? null,
      userId: row.user_id ?? undefined,
      // #7533 — read the trigger columns back. `?? undefined` (not `?? ''`):
      // a pre-#7533 row genuinely has no recorded trigger, and the engine's
      // `runRecordToLogEntry` is the single place that decides how an absent
      // one renders.
      triggerType: row.trigger_type ?? undefined,
      triggerObject: row.trigger_object ?? undefined,
      triggerRecordId: row.trigger_record_id ?? undefined,
      steps: parseJson<RunRecord['steps']>(row.steps_json, undefined),
      // #4354 — rehydrate from `summary_json`, never re-fold `steps_json`: those
      // steps are compacted (200 max), so recomputing would report a
      // 5000-iteration sweep as having acted a couple of hundred times.
      summary: parseJson<RunRecord['summary']>(row.summary_json, undefined),
      // [#13909] Rebuilt only when the row actually carries the resumable
      // state. `variables_json` is the discriminator: it is written on a
      // terminal row by nothing but the consumed-suspension path, so its
      // presence IS the statement "this failed run had a pause and no longer
      // has one". A pre-#13909 row has none and rebuilds to `undefined`, which
      // `restoreConsumedSuspension` reports honestly rather than as a run that
      // never suspended.
      consumedSuspension: deserializeConsumedSuspension(row),
      // [#13937] …and when the column holds the drop notice instead of the
      // snapshot, the pause existed and was too large to keep: said as such,
      // so the engine does not read this row as the run having moved on.
      consumedSuspensionDropped: readConsumedSuspensionDropNotice(row),
    };
  }

  /** Flatten a run into a `sys_automation_run` row (state columns JSON-encoded). */
  private serialize(run: SuspendedRun): Record<string, unknown> {
    const ctx = (run.context ?? {}) as Record<string, unknown>;
    // [cloud#1395] `tenantId` is the ONLY spelling — it is the field
    // `AutomationContext` declares for the triggering identity's organization,
    // and the only one any producer writes: `RecordChangeTrigger.buildContext`
    // maps the hook session's `organizationId` onto it, and the runtime's
    // automation domain sets it directly. A `ctx.organizationId` limb used to
    // sit ahead of this read with ZERO producers behind it (PD #12 — the
    // consumer-side alias that fossilizes a second de-facto contract), and it
    // was not harmless: the ONE test asserting this column fed the phantom key,
    // so the only coverage `organization_id` had proved the dead limb worked
    // and said nothing about the live one. Removed rather than kept "for
    // safety"; a producer that wants this row attributed sets the declared
    // `tenantId`.
    //
    // [#10101, the cloud#1395 Option A ruling] SUBJECT first, actor second:
    // the paused row's organization is the organization of the record this run
    // is ABOUT — resolved from the trigger-record snapshot through the SHARED
    // platform-row resolver (`resolveRecordOrganizationField`,
    // `@objectstack/metadata-core`; `sys_api_key`'s divergent
    // `active_organization_id` included, via `tenancy.organizationField`) —
    // and the acting tenant above is the ruled FALLBACK, never the primary.
    //
    // This closes the measured half of cloud#1395: the schedule, time-relative
    // and api triggers carry no acting tenant at all, by construction, so
    // before this every run they produced persisted `organization_id = NULL`
    // while `trigger_object` / `trigger_record_id` on the very same row named
    // a record that DOES belong to a customer. It is the same subject-first
    // precedence `sys_audit_log`'s writer already stamped with (#8707
    // honouring #8287's ruling) — three platform side tables, one answer now.
    //
    // The fallback still stands, and still matters: an object with no
    // organization of its own (single-tenant stacks, ADR-0066 platform-global
    // objects), a trigger with no record (a plain scheduled sweep has no ONE
    // subject — fabricating an acting organization stays vetoed, Option C),
    // and an engine double with no `getSchema` all resolve `null` here and
    // keep the acting context's answer.
    const org = this.recordOrgResolver.organizationOf(String(ctx.object ?? ''), ctx.record) ?? ctx.tenantId ?? null;
    // #7533 — the same three trigger columns the terminal path writes. A paused
    // row is a `sys_automation_run` row too, and leaving them null here would
    // make "which runs did this record provoke?" answer for finished runs while
    // silently omitting the ones still in flight — the worst shape for that
    // query, because a partial answer reads as a complete one. `context_json`
    // does carry this for paused rows, but a JSON blob is not a filter.
    const rawRecordId = (ctx.record as Record<string, unknown> | undefined)?.id;
    return {
      id: run.runId,
      organization_id: org,
      flow_name: run.flowName,
      flow_version: run.flowVersion ?? null,
      node_id: run.nodeId,
      // Node TYPE, not just id — the resume gate (#3801) keys on what produced
      // the pause, and it has to survive the restart the pause itself survives.
      node_type: run.nodeType ?? null,
      status: 'paused',
      correlation: run.correlation ?? null,
      user_id: ctx.userId ?? null,
      trigger_type: ctx.event ?? null,
      trigger_object: ctx.object ?? null,
      trigger_record_id:
        typeof rawRecordId === 'string'
          ? rawRecordId || null
          : typeof rawRecordId === 'number'
            ? String(rawRecordId)
            : null,
      variables_json: JSON.stringify(run.variables ?? {}),
      steps_json: JSON.stringify(run.steps ?? []),
      context_json: JSON.stringify(run.context ?? {}),
      screen_json: run.screen ? JSON.stringify(run.screen) : null,
      started_at: run.startedAt,
      start_time: run.startTime ?? null,
    };
  }

  /** Rebuild a run from a `sys_automation_run` row. */
  private deserialize(row: any): SuspendedRun {
    const startedAt = row.started_at ?? new Date().toISOString();
    return {
      runId: String(row.id),
      flowName: String(row.flow_name ?? ''),
      flowVersion: row.flow_version ?? undefined,
      nodeId: String(row.node_id ?? ''),
      nodeType: row.node_type ?? undefined,
      variables: parseJson<Record<string, unknown>>(row.variables_json, {}),
      steps: parseJson<SuspendedRun['steps']>(row.steps_json, []),
      context: parseJson<SuspendedRun['context']>(row.context_json, {}),
      startedAt,
      startTime: typeof row.start_time === 'number' ? row.start_time : (Date.parse(startedAt) || Date.now()),
      correlation: row.correlation ?? undefined,
      screen: parseJson<SuspendedRun['screen']>(row.screen_json, undefined as any),
    };
  }
}

/**
 * [#13909] The `sys_automation_run` columns that carry a terminal row's
 * consumed-suspension snapshot — or explicit `null`s for all of them.
 *
 * Refuses rather than truncates when the snapshot is over
 * {@link MAX_CONSUMED_SUSPENSION_JSON_BYTES}: a partial variable map would
 * restore a run into a state it was never in, and would do it silently. The
 * drop is logged with the size so an operator who finds the run unrestorable
 * learns WHY instead of concluding it never suspended.
 */
function serializeConsumedSuspension(
  run: SuspendedRun | undefined,
  logger?: MinimalLogger,
): Record<string, unknown> {
  const empty = {
    variables_json: null,
    context_json: null,
    screen_json: null,
    node_type: null,
    correlation: null,
  };
  if (!run) return empty;
  const variables_json = JSON.stringify(run.variables ?? {});
  const context_json = JSON.stringify(run.context ?? {});
  const screen_json = run.screen ? JSON.stringify(run.screen) : null;
  const bytes = variables_json.length + context_json.length + (screen_json?.length ?? 0);
  if (bytes > MAX_CONSUMED_SUSPENSION_JSON_BYTES) {
    logger?.warn?.(
      `[automation] run '${run.runId}': the suspension its resume consumed is ${bytes} bytes, over the ` +
        `${MAX_CONSUMED_SUSPENSION_JSON_BYTES}-byte row budget, so it was NOT persisted — this run can be ` +
        `restored only by the process that stranded it, while that process is running, never after a restart ` +
        `or from another replica. It was dropped rather than truncated on purpose — half a variable map would ` +
        `restore the run into a state it was never in. The row records the drop.`,
    );
    // [#13937] Say so IN THE ROW, with the pause the snapshot belonged to:
    // a bare NULL here is indistinguishable from a run that completed or was
    // cancelled after a restore, and the engine — rightly — reads that as
    // "moved on" and discards its own hot copy. This notice is what keeps
    // the hot copy honoured on the replica that has it, and the refusal
    // honest everywhere else.
    return {
      ...empty,
      variables_json: JSON.stringify({
        [CONSUMED_SUSPENSION_DROPPED_KEY]: {
          bytes,
          budget: MAX_CONSUMED_SUSPENSION_JSON_BYTES,
          nodeId: run.nodeId,
          correlation: run.correlation,
        },
      }),
    };
  }
  // `correlation` is part of the resumable state, not decoration: a run parked
  // at a `subflow:`/`map:` node resumes down a DIFFERENT path on it, and a
  // pausing plugin finds its external row through it. A snapshot restored
  // without it is a different pause.
  return {
    variables_json,
    context_json,
    screen_json,
    node_type: run.nodeType ?? null,
    correlation: run.correlation ?? null,
  };
}

/**
 * [#13909] Rebuild a terminal row's consumed-suspension snapshot, or
 * `undefined` when the row carries none.
 *
 * Keyed off `variables_json`, which no other terminal-row writer populates —
 * see the call site. `correlation` and `node_type` come back from their own
 * columns, written by the same helper. `steps` come from the row's own `steps_json`: they are the
 * step log AS OF THE PAUSE (the engine trims the failed attempt's steps off the
 * snapshot before recording), bounded by the same cap every terminal row's
 * steps are.
 */
function deserializeConsumedSuspension(row: any): SuspendedRun | undefined {
  if (row.variables_json == null || row.variables_json === '') return undefined;
  // [#13937] The column holds the drop notice, not a snapshot: nothing to
  // rebuild — `readConsumedSuspensionDropNotice` reports it separately.
  if (readConsumedSuspensionDropNotice(row)) return undefined;
  const startedAt = row.started_at ?? row.created_at ?? '';
  const rawId = String(row.id ?? '');
  return {
    runId: rawId.startsWith(HISTORY_PREFIX) ? rawId.slice(HISTORY_PREFIX.length) : rawId,
    flowName: String(row.flow_name ?? ''),
    flowVersion: typeof row.flow_version === 'number' ? row.flow_version : undefined,
    nodeId: String(row.node_id ?? ''),
    nodeType: row.node_type ?? undefined,
    variables: parseJson<Record<string, unknown>>(row.variables_json, {}),
    steps: parseJson<SuspendedRun['steps']>(row.steps_json, []),
    context: parseJson<SuspendedRun['context']>(row.context_json, {}),
    startedAt,
    startTime: typeof row.start_time === 'number' ? row.start_time : (Date.parse(startedAt) || Date.now()),
    correlation: row.correlation ?? undefined,
    screen: parseJson<SuspendedRun['screen']>(row.screen_json, undefined as any),
  };
}

/**
 * [#13937] The drop notice a terminal row's `variables_json` carries when the
 * snapshot was over budget, or `undefined` when the column holds a snapshot
 * (or nothing). Strict about the shape — exactly one key, the reserved one —
 * so a real variable map can never be read as a notice.
 */
function readConsumedSuspensionDropNotice(row: any): ConsumedSuspensionDropNotice | undefined {
  const parsed = parseJson<unknown>(row.variables_json, undefined);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const keys = Object.keys(parsed as object);
  if (keys.length !== 1 || keys[0] !== CONSUMED_SUSPENSION_DROPPED_KEY) return undefined;
  const notice = (parsed as Record<string, unknown>)[CONSUMED_SUSPENSION_DROPPED_KEY] as Record<string, unknown> | null;
  if (!notice || typeof notice !== 'object') return undefined;
  return {
    bytes: typeof notice.bytes === 'number' ? notice.bytes : 0,
    budget: typeof notice.budget === 'number' ? notice.budget : MAX_CONSUMED_SUSPENSION_JSON_BYTES,
    nodeId: typeof notice.nodeId === 'string' ? notice.nodeId : undefined,
    correlation: typeof notice.correlation === 'string' ? notice.correlation : undefined,
  };
}

/**
 * JSON-encode a terminal run's step log under the {@link MAX_STEPS_JSON_BYTES}
 * cap. The engine already bounds step COUNT (and strips stacks); this bounds
 * BYTES — a few huge step errors can still blow up a row. When over, the step
 * tail is halved until it fits (the newest steps carry the failure); an empty
 * result stores `null`.
 */
function serializeStepsBounded(steps: RunRecord['steps']): string | null {
  let tail = steps ?? [];
  while (tail.length > 0) {
    const json = JSON.stringify(tail);
    if (json.length <= MAX_STEPS_JSON_BYTES) return json;
    tail = tail.slice(Math.ceil(tail.length / 2));
  }
  return null;
}

/**
 * JSON-encode a run summary under {@link MAX_SUMMARY_JSON_BYTES} (#4354).
 *
 * The detail arrays are bounded by the flow's STATIC shape — one entry per node
 * that ran, one per gate that closed — not by iteration count, so a 5000-row
 * sweep over a 6-node flow serializes six entries. A pathological flow with
 * thousands of nodes is the only way over the cap; there the detail is dropped
 * and the TOTALS are kept, because the totals are what the broken-sweep alert
 * queries and losing them to a size limit would be the one unacceptable outcome.
 * The dropped detail stays visible as `detailOmitted`, never silently absent.
 */
function serializeSummaryBounded(summary: NonNullable<RunRecord['summary']>): string {
  const json = JSON.stringify(summary);
  if (json.length <= MAX_SUMMARY_JSON_BYTES) return json;
  return JSON.stringify({
    selected: summary.selected,
    acted: summary.acted,
    skipped: summary.skipped,
    unmeasured: summary.unmeasured,
    // #14456 — a TOTAL, so it survives the detail drop with the others. It is
    // also the one this branch would hurt most by losing: the per-node
    // `failures` it folds are exactly what gets dropped here, so a summary
    // over the cap would otherwise go from "two rows failed" to silence.
    // `undefined` (an older summary that never tracked it) stringifies away,
    // which keeps absent meaning "not tracked" on the compacted row too.
    failed: summary.failed,
    nodes: [],
    gates: [],
    detailOmitted: true,
  });
}
