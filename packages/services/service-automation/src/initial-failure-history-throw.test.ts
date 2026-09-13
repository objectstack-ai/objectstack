// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17562 — a run that GENUINELY FAILED must still be ANSWERED, in the declared
 * shape, when its own terminal history write throws.
 *
 * The FAILURE-arm half of #16274. Both initial-execution paths ended their
 * node-failure `catch` with an unguarded `this.recordLog({ status: 'failed' })`:
 *
 *  - `execute()`'s arm — the write whose `logged.summary` feeds the envelope;
 *  - `executeWithoutRetry()`'s arm — the same statement, one per retry attempt.
 *
 * That `catch` IS the handler for node failures, and there is no outer one. So a
 * throw out of the history write escaped the method entirely and left
 * `execute()` a REJECTED PROMISE, where its declared contract is an
 * `AutomationResult`.
 *
 * ## What is lost is the SHAPE, which is why this is not #16274's card
 *
 * The run really did fail, so nothing misleads an operator: there is no false
 * `failed`, no double run. What the caller loses is the declared envelope —
 * the transport's `status` arm (#9378) is bypassed, and `errorMessage` (#9414)
 * and `summary` (#4354) never arrive. A REST route or SDK caller sees a
 * 500-class throw for a run that had a perfectly good failure envelope waiting,
 * and the node's own failure text — the one thing the caller needed — is
 * replaced by the history driver's.
 *
 * Reproduced on `origin/main` with the guard of PR #17565 already landed (that
 * PR guards the COMPLETION arms, so after it the window is reached by a GENUINE
 * node failure rather than by a history throw on a successful run):
 *
 * ```
 * store = SYNC-THROW        -> {"kind":"threw","error":"run-history driver refused the terminal row"}
 * store = HEALTHY (control) -> {"kind":"returned","status":"failed","error":"work blew up"}
 * ```
 *
 * The control is what makes that a reading: the identical flow and the
 * identical node failure against a healthy store return the declared envelope
 * carrying the NODE's own text. Only the store differs.
 *
 * ## What can throw out of `recordLog`
 *
 * Neither statement is an in-repo surface — which is why this needs doubles, and
 * why it must be fixed anyway: the package promises hosts it will not do this,
 * in `recordLog`'s own doc comment — *"Best-effort + fire-and-forget: a history
 * write must NEVER block or break the run that produced it."*
 *
 *  1. `store.recordTerminal(record)` throwing SYNCHRONOUSLY — the
 *     `void write.catch(...)` beneath that call only ever sees a RETURNED
 *     PROMISE's rejection. Both shipped stores are `async` and cannot;
 *     `SuspendedRunStore` is an exported interface whose `recordTerminal` is
 *     OPTIONAL, so a host store is unconstrained. (A store returning a
 *     non-thenable escapes identically: `write.catch` is then itself a
 *     synchronous `TypeError`.)
 *  2. The run-summary line `this.logger.info(line, meta)` — on by default
 *     (`runSummaryLog: 'info'`) and calling a HOST-INJECTED `Logger`, so it
 *     needs no store at all.
 *
 * ## What this file pins
 *
 *  1. `execute()`'s failure arm ANSWERS: `success: false`, `status: 'failed'`,
 *     the NODE's text in `error`, the author's `errorMessage`, and a `summary`
 *     recomputed by the same pure function `recordLog` runs first.
 *  2. The same for the log-transport vector, with no store attached at all.
 *  3. `executeWithoutRetry()`'s own arm — reached on a RETRY attempt, where the
 *     throw rejected out through `retryExecution` and `execute()` both.
 *  4. The swallowed failure stays loud: `error`, once per arm, consequence and
 *     fix in the first line, the driver's text in the structured slot.
 *  5. Controls, so every pin is a reading and not a constant: a healthy store
 *     answers the SAME envelope (only the durable row differs); retry still
 *     burns the full `1 + maxRetries` budget on a genuine node failure; and a
 *     COMPLETED run on the same throwing store is still PR #17565's case, not
 *     this one.
 *
 * ## Deliberately NOT here
 *
 * ⛔ No `catch` arm's meaning is widened: the suspend arm, the
 * `InputSchemaViolationError` arm and the `strategy: 'retry'` branch are
 * untouched, and a genuine node failure still records `failed` and still
 * retries. ⛔ `resumeInternal`'s sites (#16273 / #15555), the COMPLETION arms
 * (#16274, `initial-completion-history-throw.test.ts`),
 * `restoreConsumedSuspension` and `inspectStrandedRequests` (#15358) are all
 * out of scope and untouched.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine } from './engine.js';
import type { RunRecord } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext, AutomationResult } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/** The history failures. Distinct text from the node's, so neither can stand in for the other. */
const TERMINAL_WRITE_FAILURE = 'run-history driver refused the terminal row';
const SUMMARY_LOG_FAILURE = 'log transport rejected the run-summary line';
/** The node failure — the run's REAL cause, and the text the caller must keep. */
const NODE_FAILURE = 'work blew up';

const MAX_RETRIES = 2;

const plain = (type: string) => defineActionDescriptor({ type, version: '1.0.0', name: type });
const ctx = { event: 'test', record: { id: 'rec_1' } } as unknown as AutomationContext;

interface LoggedError { message: string; errorSlot: unknown; meta: unknown }

/**
 * Records `error` calls positionally (the `Logger` contract is
 * `error(message, error?, meta?)`) and can be armed to throw from `info`.
 */
function recorder(opts: { infoThrowsOn?: { status: string; text: string } } = {}) {
    const errors: LoggedError[] = [];
    return {
        errors,
        logger: {
            // Armed at exactly ONE call: the run-summary line `recordLog` writes
            // for the terminal row of the named status — the statement inside
            // the window. The engine also logs `info` while registering
            // executors and while running, and the COMPLETED row's summary line
            // is an `info` too; throwing from those would measure other seams.
            info(_msg: string, meta?: { status?: string }) {
                const armed = opts.infoThrowsOn;
                if (armed && meta?.status === armed.status) throw new Error(armed.text);
            },
            warn() {},
            debug() {},
            error(message: string, errorSlot?: unknown, meta?: unknown) {
                errors.push({ message, errorSlot, meta });
            },
        } as never,
    };
}

/**
 * A durable store whose terminal write throws SYNCHRONOUSLY, before any promise
 * exists. `throwFromCall` lets a pin reach the SECOND path's arm: on a retrying
 * flow the first terminal write is `execute()`'s own, so a store that only
 * starts refusing afterwards (a driver whose connection drops mid-run) puts the
 * throw inside `executeWithoutRetry()`'s arm and nowhere else.
 */
class SyncThrowTerminalStore extends InMemorySuspendedRunStore {
    calls = 0;
    constructor(private readonly throwFromCall = 1) {
        super();
    }
    override recordTerminal(record: RunRecord): Promise<void> {
        this.calls++;
        if (this.calls >= this.throwFromCall) throw new Error(TERMINAL_WRITE_FAILURE);
        return super.recordTerminal(record);
    }
}

/** start → work → end. `work` THROWS unless the harness is told otherwise. */
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
    infoThrowsOn?: { status: string; text: string };
    nodeSucceeds?: boolean;
}) {
    const { errors, logger } = recorder({ infoThrowsOn: opts.infoThrowsOn });
    const engine = new AutomationEngine(logger, opts.store);
    /** How many times the node's executor actually ran — the retry-budget instrument. */
    const calls = { work: 0 };
    engine.registerNodeExecutor({
        type: 'work',
        descriptor: plain('work'),
        async execute() {
            calls.work++;
            if (opts.nodeSucceeds) return { success: true, output: { ok: true } };
            throw new Error(NODE_FAILURE);
        },
    } as never);
    const definition = flowDefinition(opts.retry);
    engine.registerFlow(definition.name, definition as never);
    return { engine, calls, errors, flowName: definition.name };
}

/**
 * Execute, recording WHICH WAY the call ended. That is the whole measurement
 * here: the defect is an `execute()` that REJECTS where `AutomationResult` is
 * declared, so a plain `await` would report it as a stack trace instead of
 * producing a reading.
 */
async function executeOutcome(engine: AutomationEngine, flowName: string) {
    return engine.execute(flowName, ctx).then(
        (result: AutomationResult) => ({ kind: 'returned' as const, result, thrown: undefined as unknown }),
        (err: unknown) => ({ kind: 'threw' as const, result: undefined, thrown: err }),
    );
}

describe('#17562 — a failed run is still ANSWERED when its own history write throws', () => {
    it('PIN 1 — `execute()`, node fails and the terminal write throws SYNCHRONOUSLY: the declared envelope arrives', async () => {
        const store = new SyncThrowTerminalStore();
        const { engine, calls, errors, flowName } = boot({ retry: false, store });

        const outcome = await executeOutcome(engine, flowName);

        // ── The reproduction. Before the guard this REJECTED: the node-failure
        // arm's own `recordLog({ status: 'failed' })` threw out of the store and
        // escaped `execute()`, there being no outer handler.
        expect(outcome.kind, 'a history write must never break the run that produced it').toBe('returned');
        expect(outcome.result?.success, 'the run really did fail').toBe(false);
        // The three fields the thrown shape cost the caller.
        expect(outcome.result?.status, "the producer's lifecycle verdict (#9378)").toBe('failed');
        expect(outcome.result?.error, "the NODE's own text, never the history sink's").toContain(NODE_FAILURE);
        expect(outcome.result?.error, 'the history failure is not the run failure').not.toContain(TERMINAL_WRITE_FAILURE);
        expect(outcome.result?.errorMessage, "the author's failure text (#9414)").toBe('author failure text');
        expect(outcome.result?.summary, 'how far the run got before dying (#4354)').toBeDefined();
        expect(calls.work, 'no strategy, so exactly one attempt').toBe(1);

        // The in-memory run history tells the same truth: one `failed` row.
        const rows = await engine.listRuns(flowName, { limit: 10 });
        expect(rows.map(r => r.status)).toEqual(['failed']);

        // ── The secondary failure was REAL, not simulated away: no durable row
        // landed. That is the loss PIN 4 reports.
        expect(await store.loadTerminal(rows[0]!.id), 'the history row genuinely did not land').toBeFalsy();
        expect(errors.length, 'and it was reported, once').toBe(1);
    });

    it('PIN 2 — `execute()`, the run-summary log line throws with NO store attached: same answer', async () => {
        // The second reachable statement in the same window, and the one that
        // needs no store at all — the host-injected `Logger`'s `info`, default-on.
        const { engine, calls, errors, flowName } = boot({
            retry: false,
            infoThrowsOn: { status: 'failed', text: SUMMARY_LOG_FAILURE },
        });

        const outcome = await executeOutcome(engine, flowName);

        expect(outcome.kind).toBe('returned');
        expect(outcome.result?.success).toBe(false);
        expect(outcome.result?.status).toBe('failed');
        expect(outcome.result?.error).toContain(NODE_FAILURE);
        expect(outcome.result?.error).not.toContain(SUMMARY_LOG_FAILURE);
        expect(outcome.result?.errorMessage).toBe('author failure text');
        expect(outcome.result?.summary).toBeDefined();
        expect(calls.work).toBe(1);
        expect((await engine.listRuns(flowName, { limit: 10 })).map(r => r.status)).toEqual(['failed']);
        expect(errors.length).toBe(1);
    });

    it('PIN 3 — `executeWithoutRetry()`, the RETRY attempt\'s own arm: the loop\'s terminal envelope arrives', async () => {
        // The second site, reached on its own terms. `executeWithoutRetry` is
        // only ever entered from `retryExecution`, which `execute()`'s catch
        // reaches AFTER its own failed row — so the store is armed to refuse
        // from the second write on, putting the throw in THIS arm and nowhere
        // else. Unpatched, it rejected out through `retryExecution` and
        // `execute()` both, and the budget died with it: two node runs, not
        // three.
        const store = new SyncThrowTerminalStore(2);
        const { engine, calls, errors, flowName } = boot({ retry: true, store });

        const outcome = await executeOutcome(engine, flowName);

        expect(outcome.kind, 'the declared contract is a result, not an exception').toBe('returned');
        expect(outcome.result?.success).toBe(false);
        expect(outcome.result?.status, 'every attempt dispatched and was rejected (#9378)').toBe('failed');
        expect(outcome.result?.error, "the NODE's text, carried out by the retry loop").toContain(NODE_FAILURE);
        expect(outcome.result?.errorMessage).toBe('author failure text');
        expect(calls.work, 'attempt 1 plus every retry — the budget survives the lost rows').toBe(1 + MAX_RETRIES);
        // Attempt 1's row landed (the store was still healthy); the two retry
        // attempts' rows did not, and each was reported once.
        expect(store.calls, 'one terminal write per attempt').toBe(1 + MAX_RETRIES);
        expect(errors.length, 'once per abandoned write, not once per run').toBe(MAX_RETRIES);
    });

    it('PIN 4 — the swallowed history failure is loud: `error`, naming the run, the loss and the fix', async () => {
        // ⛔ The guard must not trade a thrown promise for a silent loss.
        // AGENTS.md "Degradation log levels": the terminal `failed` row claims
        // to persist and did not, while the envelope, the HTTP arm and every
        // counter read clean — the judgment question answers YES, so `error`,
        // with the consequence and the fix in the first line.
        //
        // ⚠️ This is NOT the rule's third answer ("a failure handed to the
        // CALLER is not a degradation"): what the caller is handed is the NODE's
        // failure. The bookkeeping failure is handed to nobody.
        //
        // ⚠️ And NOT a #13398-class raise: `Logger` from
        // `@objectstack/spec/contracts` declares `error(message, error?, meta?)`
        // as a REQUIRED member, so nothing is grown onto a sink that lacks it.
        const store = new SyncThrowTerminalStore();
        const { engine, errors, flowName } = boot({ retry: false, store });

        await executeOutcome(engine, flowName);
        const runId = rowIdOf(await engine.listRuns(flowName, { limit: 10 }));

        expect(errors.length, 'said ONCE per abandoned write').toBe(1);
        const line = errors[0]!;
        expect(line.message, 'the run an operator has to go looking for').toContain(runId);
        expect(line.message, 'the consequence: the run FAILED and its history row did not land')
            .toMatch(/failed/i);
        expect(line.message, 'and that the caller WAS told — so nothing needs re-driving')
            .toMatch(/caller/i);
        expect(line.message, 'the fix is the history failure in the meta').toMatch(/history/i);
        // THIRD argument per `error(message, error?, meta?)` — the driver text
        // goes to the structured slot, never into the message (#6499), and the
        // `Error` slot stays empty on purpose (#5575).
        expect(line.errorSlot).toBeUndefined();
        expect(JSON.stringify(line.meta)).toContain(TERMINAL_WRITE_FAILURE);
        expect(line.message).not.toContain(TERMINAL_WRITE_FAILURE);
    });

    it('CONTROL — the throwing store and a HEALTHY one answer the SAME envelope, field for field', async () => {
        // The card's own control, and what makes PIN 1 a reading rather than a
        // constant: the identical flow and the identical node failure, differing
        // only in the store. Both legs in ONE test so the comparison is an
        // assertion rather than a claim about two other tests.
        //
        //   store = SYNC-THROW        -> {"kind":"threw", ...}   (before the guard)
        //   store = HEALTHY (control) -> {"kind":"returned","status":"failed","error":"work blew up"}
        const healthyStore = new InMemorySuspendedRunStore();
        const healthy = boot({ retry: false, store: healthyStore });
        const throwing = boot({ retry: false, store: new SyncThrowTerminalStore() });

        const healthyOutcome = await executeOutcome(healthy.engine, healthy.flowName);
        const throwingOutcome = await executeOutcome(throwing.engine, throwing.flowName);

        /** Everything the caller branches on. `durationMs` is wall clock and is excluded. */
        const envelope = (r: AutomationResult | undefined) => ({
            success: r?.success,
            status: r?.status,
            error: r?.error,
            errorMessage: r?.errorMessage,
            summary: r?.summary,
        });

        expect(healthyOutcome.kind, 'the control leg').toBe('returned');
        expect(throwingOutcome.kind, 'the defect leg').toBe('returned');
        expect(envelope(throwingOutcome.result), 'the lost history row costs the caller nothing')
            .toEqual(envelope(healthyOutcome.result));
        // And the control leg is not vacuous: it really did carry the node's
        // failure and a counted summary.
        expect(envelope(healthyOutcome.result).status).toBe('failed');
        expect(envelope(healthyOutcome.result).error).toContain(NODE_FAILURE);
        expect(envelope(healthyOutcome.result).summary).toBeDefined();

        expect(healthy.errors, 'no history write failed ⇒ nothing to report').toEqual([]);
        expect(throwing.errors.length, 'the defect leg reports its loss once').toBe(1);

        // `recordTerminal` is fire-and-forget — let the microtask land.
        await new Promise(r => setTimeout(r, 0));
        const healthyRunId = rowIdOf(await healthy.engine.listRuns(healthy.flowName, { limit: 10 }));
        expect((await healthyStore.loadTerminal(healthyRunId))?.status, 'the healthy path still persists')
            .toBe('failed');
    });

    it('CONTROL — retry still burns the full `1 + maxRetries` budget on healthy sinks', async () => {
        // ⛔ The guard must narrow nothing, and this is what grades PIN 3's
        // count: the same flow and the same policy against a healthy store
        // already run the node three times, so PIN 3's `3` is a preserved budget
        // rather than a coincidence.
        const { engine, calls, errors, flowName } = boot({
            retry: true,
            store: new InMemorySuspendedRunStore(),
        });

        const outcome = await executeOutcome(engine, flowName);

        expect(calls.work).toBe(1 + MAX_RETRIES);
        expect(outcome.result?.status).toBe('failed');
        expect(outcome.result?.error).toContain(NODE_FAILURE);
        expect(errors).toEqual([]);
        expect((await engine.listRuns(flowName, { limit: 10 })).map(r => r.status))
            .toEqual(['failed', 'failed', 'failed']);
    });

    it('CONTROL — a COMPLETED run on the same throwing store is still PR #17565\'s case, not this one', async () => {
        // The arm next door. If this reddened, the new guard would have been
        // placed where it changes the COMPLETION answer — the one thing #17565
        // owns and this card must leave exactly as it found it.
        const { engine, calls, errors, flowName } = boot({
            retry: false,
            store: new SyncThrowTerminalStore(),
            nodeSucceeds: true,
        });

        const outcome = await executeOutcome(engine, flowName);

        expect(outcome.kind).toBe('returned');
        expect(outcome.result?.success, 'every node succeeded').toBe(true);
        expect(outcome.result?.status, 'a completed run is not `failed`').toBeUndefined();
        expect(outcome.result?.successMessage).toBe('author success text');
        expect(calls.work).toBe(1);
        expect((await engine.listRuns(flowName, { limit: 10 })).map(r => r.status)).toEqual(['completed']);
        expect(errors.length, "#17565's guard, reporting its own case").toBe(1);
        expect(errors[0]?.message, 'the COMPLETED wording, not this arm\'s').toMatch(/COMPLETED/);
    });
});

/** The single run's id, asserted to be single so a pin can never read the wrong row. */
function rowIdOf(rows: Array<{ id: string }>): string {
    expect(rows.length, 'exactly one run').toBe(1);
    return rows[0]!.id;
}
