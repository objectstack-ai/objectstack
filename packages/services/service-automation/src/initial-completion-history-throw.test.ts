// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16274 — a run whose nodes ALL succeeded must not be answered `failed`, and
 * above all must not be RE-EXECUTED, because its terminal HISTORY write threw.
 *
 * The initial-execution half of the pattern #15944 reported on the resume path.
 * `execute()` and `executeWithoutRetry()` each called `this.recordLog({ status:
 * 'completed' })` from INSIDE the same `try` whose `catch` exists for node
 * failures, so a throw out of a history write on a run that finished
 * successfully was handled as though a node had thrown.
 *
 * ## ⚠️ The consequence, MEASURED on the unpatched tree rather than assumed
 *
 * The card filed this as the milder half of #15944 — "a completed run answered
 * `failed`" — and flagged ONE question as worth driving first: whether the
 * retry path can then re-attempt a run that already completed. It can, and
 * that makes this the same DOUBLE RUN #15944 was graded sharp for:
 *
 *  - `execute()`'s node-failure arm ends at a strategy branch that hands a
 *    `failed` result to {@link AutomationEngine.retryExecution};
 *  - that loop reads `result.success`, so it re-enters
 *    `executeWithoutRetry()` — the whole flow, every node, again;
 *  - each attempt completes, throws in the same history write, is read as one
 *    more failure, and the loop burns the whole budget.
 *
 * Driven on `origin/main` with `maxRetries: 2`: the node ran **three** times
 * for one logical success, and three `failed` rows were written. The controls
 * below are what make that a reading — the same flow on healthy sinks runs the
 * node ONCE, and a genuine node failure runs it three times (retry working
 * correctly). Nothing external is needed to reach it: no store at all, just a
 * host-injected `Logger` whose `info` throws on the run-summary line that is on
 * by default (`runSummaryLog: 'info'`).
 *
 * On the store variant the unpatched code did not even answer `failed`: the
 * catch arm's own `recordLog({ status: 'failed' })` threw again out of the same
 * store and escaped `execute()` entirely — a REJECTED promise where
 * `AutomationResult` is declared, and the reason that variant's node count is
 * 1 (the strategy branch is never reached), which is not safety.
 *
 * ## What can throw out of `recordLog`
 *
 * Neither statement is an in-repo surface, which is why this cannot be
 * reproduced without doubles and why it must be fixed — the package promises
 * hosts it will not do this, in `recordLog`'s own doc comment: *"Best-effort +
 * fire-and-forget: a history write must NEVER block or break the run that
 * produced it."*
 *
 *  1. `store.recordTerminal(record)` throwing SYNCHRONOUSLY — the
 *     `void write.catch(...)` beneath that call only ever sees a RETURNED
 *     PROMISE's rejection. Both shipped stores are `async` and cannot;
 *     `SuspendedRunStore` is an exported interface whose `recordTerminal` is
 *     optional, so a host store is unconstrained. (A store returning a
 *     non-thenable escapes identically: `write.catch` is then itself a
 *     synchronous `TypeError`.)
 *  2. The run-summary line `this.logger.info(line, meta)` — default-on and
 *     calling a HOST-INJECTED `Logger`.
 *
 * ## What this file pins
 *
 *  1. Both initial-execution paths answer the TRUTH for a completed run:
 *     `success: true`, no `status` discriminator, the author's
 *     `successMessage`, and a `summary` recomputed by the same pure function
 *     `recordLog` runs first.
 *  2. **The sharp one: the node runs EXACTLY ONCE under
 *     `errorHandling.strategy: 'retry'`** — the assertion the defect actually
 *     fails, and the one the `maxRetries` control grades.
 *  3. The store variant RETURNS rather than rejecting.
 *  4. The swallowed failure stays loud: `error`, once per run, consequence and
 *     fix in the first line, the driver's text in the structured slot.
 *  5. Controls, so every pin is a reading and not a constant: retry still
 *     retries a GENUINE node failure the full `1 + maxRetries` times; a
 *     genuine node failure is still answered `status: 'failed'` with the
 *     node's own text; and a completed run on healthy sinks logs no `error`
 *     and lands its row.
 *
 * ## Deliberately NOT here
 *
 * ⛔ `resumeInternal`'s completion site is PR #16273's and is untouched —
 * `completed-run-history-throw.test.ts` owns it. ⛔ Nothing here widens a
 * `catch` arm's meaning, and ⛔ nothing here bears on
 * `restoreConsumedSuspension` or `inspectStrandedRequests` (#15358).
 *
 * ⛔ The FAILURE-arm `recordLog` on these two paths is a different site with a
 * different consequence (a genuine node failure plus a throwing store makes
 * `execute()` reject) and is NOT pinned here — it is reported separately rather
 * than fixed or frozen under this card.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext, AutomationResult } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/** The history failures. Distinct text from the node's, so neither can stand in for the other. */
const TERMINAL_WRITE_FAILURE = 'run-history driver refused the terminal row';
const SUMMARY_LOG_FAILURE = 'log transport rejected the run-summary line';
/** The node failure used ONLY by the controls, where a `failed` answer is correct. */
const NODE_FAILURE = 'work blew up';

const MAX_RETRIES = 2;

const plain = (type: string) => defineActionDescriptor({ type, version: '1.0.0', name: type });
const ctx = { event: 'test', record: { id: 'rec_1' } } as unknown as AutomationContext;

interface LoggedError { message: string; errorSlot: unknown; meta: unknown }

/**
 * Records `error` calls positionally (the `Logger` contract is
 * `error(message, error?, meta?)`) and can be armed to throw from `info`.
 */
function recorder(opts: { infoThrows?: string } = {}) {
    const errors: LoggedError[] = [];
    return {
        errors,
        logger: {
            // Armed at exactly ONE call: the run-summary line `recordLog`
            // writes for a COMPLETED terminal run, the statement inside the
            // window. The engine also logs `info` while registering executors
            // and while running, and the FAILED row's own summary line is an
            // `info` too — throwing from those would measure other seams.
            info(_msg: string, meta?: { status?: string }) {
                if (opts.infoThrows && meta?.status === 'completed') throw new Error(opts.infoThrows);
            },
            warn() {},
            debug() {},
            error(message: string, errorSlot?: unknown, meta?: unknown) {
                errors.push({ message, errorSlot, meta });
            },
        } as never,
    };
}

/** A durable store whose terminal write throws SYNCHRONOUSLY, before any promise exists. */
class SyncThrowTerminalStore extends InMemorySuspendedRunStore {
    override recordTerminal(): Promise<void> {
        throw new Error(TERMINAL_WRITE_FAILURE);
    }
}

/** start → work → end. `work` SUCCEEDS unless the harness is told otherwise. */
function flowDefinition(retry: boolean) {
    return {
        name: retry ? 'retry_flow' : 'plain_flow',
        label: 'F',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'work', type: 'work', label: 'Work' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'work' },
            { id: 'e2', source: 'work', target: 'end' },
        ],
        ...(retry ? { errorHandling: { strategy: 'retry', maxRetries: MAX_RETRIES, backoffMs: 0 } } : {}),
        successMessage: 'author success text',
        errorMessage: 'author failure text',
    };
}

function boot(opts: {
    retry: boolean;
    store?: InMemorySuspendedRunStore;
    infoThrows?: string;
    nodeThrows?: boolean;
}) {
    const { errors, logger } = recorder({ infoThrows: opts.infoThrows });
    const engine = new AutomationEngine(logger, opts.store);
    /** How many times the node's executor actually ran — the double-run instrument. */
    const calls = { work: 0 };
    engine.registerNodeExecutor({
        type: 'work',
        descriptor: plain('work'),
        async execute() {
            calls.work++;
            if (opts.nodeThrows) throw new Error(NODE_FAILURE);
            return { success: true, output: { ok: true } };
        },
    } as never);
    const definition = flowDefinition(opts.retry);
    engine.registerFlow(definition.name, definition as never);
    return { engine, calls, errors, flowName: definition.name };
}

/**
 * Execute, recording WHICH WAY the call ended. On the pre-guard tree the
 * completion path could make `execute()` REJECT outright (the catch arm's own
 * `recordLog` throws again out of the same store), so a plain `await` would
 * fail with a stack trace instead of producing a reading.
 */
async function executeOutcome(engine: AutomationEngine, flowName: string) {
    return engine.execute(flowName, ctx).then(
        (result: AutomationResult) => ({ kind: 'returned' as const, result, thrown: undefined as unknown }),
        (err: unknown) => ({ kind: 'threw' as const, result: undefined, thrown: err }),
    );
}

describe('#16274 — a completed run must not be failed, and never re-run, by its own history write', () => {
    it('PIN 1 — `execute()`, terminal write throws SYNCHRONOUSLY, every node succeeded: the run is answered SUCCESS', async () => {
        const store = new SyncThrowTerminalStore();
        const { engine, calls, errors, flowName } = boot({ retry: false, store });

        const outcome = await executeOutcome(engine, flowName);

        // ── The reproduction. Before the guard this REJECTED: the completion
        // write threw, the node-failure arm took it, and the arm's own
        // `recordLog({ status: 'failed' })` threw again out of the same store.
        expect(outcome.kind, 'a history write must never break the run that produced it').toBe('returned');
        expect(outcome.result?.success, 'every node succeeded').toBe(true);
        expect(outcome.result?.status, 'a completed run is not `failed`').toBeUndefined();
        expect(outcome.result?.error, 'the run did not fail').toBeUndefined();
        // The run's real answer survives the lost bookkeeping.
        expect(outcome.result?.successMessage).toBe('author success text');
        expect(outcome.result?.summary, 'the summary survives the lost history row').toBeDefined();
        expect(calls.work).toBe(1);

        // The in-memory run history tells the truth too: one `completed` row,
        // not a `failed` one carrying the driver's text as the run's error.
        const rows = await engine.listRuns(flowName, { limit: 10 });
        expect(rows.map(r => r.status)).toEqual(['completed']);

        // ── The secondary failure was REAL, not simulated away: no durable
        // history row landed. That is the loss PIN 5 reports.
        expect(await store.loadTerminal(rows[0]!.id), 'the history row genuinely did not land').toBeFalsy();
        expect(errors.length, 'and it was reported, once').toBe(1);
    });

    it('PIN 2 — `execute()`, the run-summary log line throws with NO store attached: same answer', async () => {
        // The second reachable statement in the same window, and the one that
        // needs no store at all — the host-injected `Logger`'s `info`, default-on.
        const { engine, calls, errors, flowName } = boot({ retry: false, infoThrows: SUMMARY_LOG_FAILURE });

        const outcome = await executeOutcome(engine, flowName);

        expect(outcome.kind).toBe('returned');
        expect(outcome.result?.success).toBe(true);
        expect(outcome.result?.status).toBeUndefined();
        expect(outcome.result?.error).toBeUndefined();
        expect(outcome.result?.summary).toBeDefined();
        expect(calls.work).toBe(1);
        expect((await engine.listRuns(flowName, { limit: 10 })).map(r => r.status)).toEqual(['completed']);
        expect(errors.length).toBe(1);
        expect(errors[0]?.message).toContain(rowIdOf(await engine.listRuns(flowName, { limit: 10 })));
    });

    it('PIN 3 — THE SHARP ONE: under `strategy: retry`, the node runs EXACTLY ONCE', async () => {
        // Unpatched, with `maxRetries: 2`: three executions of a flow that had
        // already finished, three `failed` rows, and the node's side effects
        // three times — unattended, inside this one call. `execute()`'s arm
        // hands the false `failed` to `retryExecution`, whose loop reads
        // `result.success`.
        const { engine, calls, errors, flowName } = boot({ retry: true, infoThrows: SUMMARY_LOG_FAILURE });

        const outcome = await executeOutcome(engine, flowName);

        expect(calls.work, 'a completed run is NEVER re-attempted').toBe(1);
        expect(outcome.kind).toBe('returned');
        expect(outcome.result?.success, 'the attempt that completed is the answer').toBe(true);
        expect(outcome.result?.status).toBeUndefined();
        expect(outcome.result?.successMessage).toBe('author success text');
        expect(outcome.result?.summary).toBeDefined();
        // One row for one run — not 1 + maxRetries rows for one logical success.
        expect((await engine.listRuns(flowName, { limit: 10 })).map(r => r.status)).toEqual(['completed']);
        expect(errors.length, 'one run, one report').toBe(1);
    });

    it('PIN 4 — `strategy: retry` + a synchronously throwing store: RETURNS, does not reject, runs once', async () => {
        const store = new SyncThrowTerminalStore();
        const { engine, calls, errors, flowName } = boot({ retry: true, store });

        const outcome = await executeOutcome(engine, flowName);

        expect(outcome.kind, 'the declared contract is a result, not an exception').toBe('returned');
        expect(outcome.result?.success).toBe(true);
        expect(calls.work).toBe(1);
        expect(errors.length).toBe(1);
    });

    it('PIN 5 — the swallowed history failure is loud: `error`, naming the run, the loss and the fix', async () => {
        // ⛔ The guard must not trade a false `failed` for a silent failure.
        // AGENTS.md "Degradation log levels": the terminal history row claims
        // to persist and did not while every caller reads a healthy completed
        // run — the judgment question answers YES, so `error`, with the
        // consequence and the fix in the first line.
        //
        // ⚠️ And NOT a #13398-class raise: `Logger` from
        // `@objectstack/spec/contracts` declares `error` as a REQUIRED member,
        // so nothing is grown onto a published sink that lacks it.
        const { engine, errors, flowName } = boot({ retry: false, store: new SyncThrowTerminalStore() });

        await executeOutcome(engine, flowName);
        const runId = rowIdOf(await engine.listRuns(flowName, { limit: 10 }));

        expect(errors.length, 'said ONCE per run, not once per failed write').toBe(1);
        const line = errors[0]!;
        expect(line.message).toContain(runId);
        expect(line.message, 'the consequence: the run COMPLETED and its history row did not land')
            .toMatch(/completed/i);
        expect(line.message, 'and that it must not be re-run — the harm this card measured')
            .toMatch(/must NOT be re-run/);
        expect(line.message, 'the fix is the history failure in the meta').toMatch(/history/i);
        // THIRD argument per `error(message, error?, meta?)` — the driver text
        // goes to the structured slot, never into the message (#6499), and the
        // `Error` slot stays empty on purpose (#5575).
        expect(line.errorSlot).toBeUndefined();
        expect(JSON.stringify(line.meta)).toContain(TERMINAL_WRITE_FAILURE);
        expect(line.message).not.toContain(TERMINAL_WRITE_FAILURE);
    });

    it('CONTROL — retry still retries a GENUINE node failure the full `1 + maxRetries` times', async () => {
        // ⛔ The guard must narrow nothing, and this is what grades PIN 3: the
        // same flow, the same policy, the same counter — a node that really
        // fails still burns the whole budget. Without this control PIN 3's `1`
        // could be a broken retry loop rather than a guarded history write.
        const { engine, calls, errors, flowName } = boot({
            retry: true,
            store: new InMemorySuspendedRunStore(),
            nodeThrows: true,
        });

        const outcome = await executeOutcome(engine, flowName);

        expect(calls.work, 'attempt 1 plus every retry').toBe(1 + MAX_RETRIES);
        expect(outcome.result?.success).toBe(false);
        expect(outcome.result?.status, "the producer's lifecycle verdict (#9378)").toBe('failed');
        expect(outcome.result?.error).toContain(NODE_FAILURE);
        expect(outcome.result?.errorMessage).toBe('author failure text');
        expect(errors, 'no history write failed ⇒ nothing to report').toEqual([]);
    });

    it('CONTROL — a GENUINE node failure is still answered `failed` with the NODE\'s own text', async () => {
        // The completion-side sink is broken in exactly the way PIN 2 breaks
        // it, and the node fails anyway: the node-failure arm must still be
        // reached and must still say so. This is the arm the guard is often
        // mistaken for widening.
        const { engine, calls, errors, flowName } = boot({
            retry: false,
            infoThrows: SUMMARY_LOG_FAILURE,
            nodeThrows: true,
        });

        const outcome = await executeOutcome(engine, flowName);

        expect(outcome.kind).toBe('returned');
        expect(outcome.result?.success).toBe(false);
        expect(outcome.result?.status).toBe('failed');
        expect(outcome.result?.error, "the NODE's text, never the history sink's").toContain(NODE_FAILURE);
        expect(calls.work).toBe(1);
        expect((await engine.listRuns(flowName, { limit: 10 })).map(r => r.status)).toEqual(['failed']);
        expect(errors, 'the completed-path guard never fired — the run never completed').toEqual([]);
    });

    it('CONTROL — a completed run on HEALTHY sinks logs no error and lands its history row', async () => {
        // The reverse control for PIN 5. If this logged too, PIN 5 would be
        // measuring "the engine logs on every completed run".
        const store = new InMemorySuspendedRunStore();
        const { engine, calls, errors, flowName } = boot({ retry: true, store });

        const outcome = await executeOutcome(engine, flowName);

        expect(outcome.result?.success).toBe(true);
        expect(outcome.result?.summary).toBeDefined();
        expect(calls.work).toBe(1);
        expect(errors, 'no secondary failure ⇒ nothing to report').toEqual([]);

        // `recordTerminal` is fire-and-forget — let the microtask land.
        await new Promise(r => setTimeout(r, 0));
        const runId = rowIdOf(await engine.listRuns(flowName, { limit: 10 }));
        expect((await store.loadTerminal(runId))?.status, 'the healthy path still persists').toBe('completed');
    });
});

/** The single run's id, asserted to be single so a pin can never read the wrong row. */
function rowIdOf(rows: Array<{ id: string }>): string {
    expect(rows.length, 'exactly one run').toBe(1);
    return rows[0]!.id;
}
