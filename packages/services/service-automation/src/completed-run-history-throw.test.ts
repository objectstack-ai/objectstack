// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15944 — a run whose nodes ALL succeeded must never be journalled, reported
 * `stranded`, or re-armed because its terminal HISTORY write threw.
 *
 * ## The reported defect, in one sentence
 *
 * `resumeInternal`'s completion path called `this.recordLog({ status:
 * 'completed' })` from INSIDE the same `try` whose `catch` exists for node
 * failures, so a throw out of a history write on a run that finished
 * successfully was handled as though a node had thrown: the arm journalled a
 * repair snapshot, stamped `status: 'stranded'`, answered `success: false` —
 * and `restoreConsumedSuspension` then honoured that snapshot and re-armed the
 * pause, so the NEXT resume ran the downstream nodes a second time.
 *
 * ⚠️ The direction is the opposite of #15555's, which is the same window read
 * from the failure side. That card is a false `false` (an operator told not to
 * repair a run that is repairable). This is a false `true`: an operator told
 * to repair a run that already finished, where the repair RE-RUNS it. It
 * therefore crosses the #13937 shape-4 invariant outright — *"a re-armed run
 * must never become double-runnable"* — and the defence
 * `stranded-run-status.test.ts` pins for that invariant cannot fire here,
 * because it reads the durable terminal row first and the durable terminal row
 * is precisely what failed to land.
 *
 * ## What can throw out of `recordLog`, and why a `catch` there is needed
 *
 * `recordLog`'s own doc comment states the invariant this broke: *"Best-effort
 * + fire-and-forget: a history write must NEVER block or break the run that
 * produced it."* Two statements on its terminal path break it:
 *
 *  1. `this.store.recordTerminal(record)` — the `void write.catch(...)`
 *     beneath that call only ever sees a RETURNED PROMISE's rejection, so a
 *     store that throws SYNCHRONOUSLY, before returning a promise, escapes
 *     `recordLog` entirely. (A store returning a non-thenable escapes the same
 *     way: `write.catch` is then itself a synchronous `TypeError`.)
 *  2. The run-summary line `this.logger.info(line, meta)` — on by default
 *     (`runSummaryLog: 'info'`) and calling a HOST-INJECTED `Logger`, so it
 *     needs no store at all.
 *
 * Both are driven below; neither is modelled.
 *
 * ## What this file pins
 *
 *  1. **The completed run stays completed.** `resume` answers `success: true`
 *     with NO `status` discriminator, no repair snapshot exists for it, and
 *     `restoreConsumedSuspension` refuses with `RUN_COMPLETED` — the truthful
 *     refusal, and the one that proves no journal was written (a journalled
 *     run would have been re-armed instead of refused).
 *  2. **The sharp one: the downstream node runs exactly ONCE across two
 *     resumes**, with an attempted repair in between. This is the assertion
 *     the defect actually fails; every other pin here can be read as
 *     bookkeeping.
 *  3. **The swallowed failure stays loud.** The guard must not trade a phantom
 *     strand for silence: AGENTS.md "Degradation log levels" — the terminal
 *     history row claims to persist and did not while the caller reads a clean
 *     success — so `error`, with the consequence and the fix in the first line.
 *  4. **Controls, so the pins are readings and not constants** — a GENUINE
 *     node failure on the very same throwing store still journals, still
 *     reports `stranded`, and is still repairable; and a completed run on a
 *     HEALTHY store logs no error at all.
 *
 * ## Deliberately NOT here
 *
 * ⛔ `restoreConsumedSuspension` is not weakened, and nothing here asserts a
 * change to it: the verb judges correctly on the evidence it is handed, and
 * the evidence is what was wrong. Its refusal is asserted, never its logic.
 *
 * ⛔ `inspectStrandedRequests` (#15358) is the adjacent over-reporting surface
 * one level up and is untouched by this file.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/** The history failure. Distinct text from the node's, so neither can stand in for the other. */
const TERMINAL_WRITE_FAILURE = 'run-history driver refused the terminal row';
const SUMMARY_LOG_FAILURE = 'log transport rejected the run-summary line';
/** The node failure used ONLY by the control, where a strand is correct. */
const NODE_FAILURE = 'tail blew up';

const holdDescriptor = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'hold',
    supportsPause: true, resumeAuthority: 'any',
});
const plain = (type: string) => defineActionDescriptor({ type, version: '1.0.0', name: type });

/** start → hold (pauses) → tail → end. `tail` SUCCEEDS unless a knob says otherwise. */
const RESUME_FLOW = {
    name: 'resume_flow', label: 'Resume', type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'hold', label: 'Hold' },
        { id: 'tail', type: 'tail', label: 'Tail' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'tail' },
        { id: 'e3', source: 'tail', target: 'end' },
    ],
};

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
            // writes for the COMPLETED terminal run, which is the statement
            // inside the window. The engine also logs `info` while registering
            // executors and while running; throwing from those would measure a
            // different seam entirely.
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

function engineOver(store: InMemorySuspendedRunStore | undefined, logger: never) {
    const led = { tail: 0 };
    const knobs = { throws: false };
    const engine = new AutomationEngine(logger, store);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: holdDescriptor,
        async execute() { return { success: true, suspend: true, correlation: 'approval:req_1' }; },
    } as never);
    engine.registerNodeExecutor({
        type: 'tail',
        descriptor: plain('tail'),
        async execute() {
            led.tail++;
            if (knobs.throws) throw new Error(NODE_FAILURE);
            return { success: true, output: { done: true } };
        },
    } as never);
    engine.registerFlow('resume_flow', RESUME_FLOW as never);
    return { engine, led, knobs };
}

/**
 * Resume, recording WHICH WAY the call ended. On the pre-guard tree the
 * completion path could also make `resume` THROW outright (both statements are
 * reachable and the catch arm's own `recordLog` throws again), so a plain
 * `await` would fail with a stack trace instead of producing a reading.
 */
async function resumeOutcome(engine: AutomationEngine, runId: string) {
    return engine.resume(runId).then(
        result => ({ kind: 'returned' as const, result, thrown: undefined }),
        (err: unknown) => ({ kind: 'threw' as const, result: undefined, thrown: err }),
    );
}

async function park(engine: AutomationEngine) {
    const started = await engine.execute('resume_flow', ctx);
    expect(started.status).toBe('paused');
    return started.runId as string;
}

describe('#15944 — a completed run must not be stranded, journalled or re-armed by its history write', () => {
    it('PIN 1 — the terminal write throws synchronously on a run whose nodes ALL succeeded: resume answers SUCCESS', async () => {
        const store = new SyncThrowTerminalStore();
        const { logger } = recorder();
        const { engine, led } = engineOver(store, logger);
        const runId = await park(engine);

        const outcome = await resumeOutcome(engine, runId);

        // ── The reproduction. Before the guard this returned
        // `{ success: false, status: 'stranded' }`, carrying the history
        // driver's text as the run's own error.
        expect(outcome.kind, 'a history write must never break the run that produced it').toBe('returned');
        expect(outcome.result?.success, 'every node succeeded').toBe(true);
        expect(outcome.result?.status, 'a completed run is never stranded').toBeUndefined();
        expect(outcome.result?.error, 'the run did not fail').toBeUndefined();
        // The run's real answer survives the lost bookkeeping: the output the
        // flow produced, and the summary `recordLog` folds. The summary is
        // recomputed by the same pure function `recordLog` runs first, so the
        // two spellings cannot disagree.
        expect(outcome.result?.summary, 'the run summary survives the lost history row').toBeDefined();
        expect(led.tail).toBe(1);

        // ── No repair snapshot exists for it. `RUN_COMPLETED` is what proves
        // that: a journalled run is RE-ARMED by this verb, not refused, so
        // this refusal and `restored: false` are one reading of "nothing was
        // journalled" — and it is the truthful refusal besides.
        const restored = await engine.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
        expect(restored.restored, 'a finished run has no unresumable state to exit').toBe(false);
        expect(restored.refusal).toBe('RUN_COMPLETED');
        expect(await engine.hasSuspendedRun(runId), 'nothing was re-armed').toBe(false);

        // ── THE SHARP ONE. Across two resumes with an attempted repair
        // between them, the downstream node ran exactly ONCE. On the defective
        // tree the repair above answered `restored: true` and this second
        // resume drove `tail` a second time (#13937 shape 4: a re-armed run
        // must never become double-runnable).
        const second = await resumeOutcome(engine, runId);
        expect(second.kind).toBe('returned');
        expect(second.result?.success).toBe(false);
        expect(second.result?.code, 'the run is terminal — there is nothing to resume').toBe('RUN_NOT_FOUND');
        expect(led.tail, 'the downstream node ran EXACTLY once across two resumes').toBe(1);

        // ── The secondary failure was REAL, not simulated away: no durable
        // history row landed. That is the loss PIN 3 reports.
        expect(await store.loadTerminal(runId), 'the history row genuinely did not land').toBeFalsy();
    });

    it('PIN 2 — the run-summary log line throws, with NO store attached: same answer, same single run', async () => {
        // The second reachable statement in the same window, and one that
        // needs no store at all — the host-injected `Logger`'s `info`, on by
        // default. So this also shows the defect is not a store problem.
        const { errors, logger } = recorder({ infoThrows: SUMMARY_LOG_FAILURE });
        const { engine, led } = engineOver(undefined, logger);
        const runId = await park(engine);

        const outcome = await resumeOutcome(engine, runId);

        expect(outcome.kind).toBe('returned');
        expect(outcome.result?.success).toBe(true);
        expect(outcome.result?.status).toBeUndefined();
        expect(led.tail).toBe(1);

        const restored = await engine.restoreConsumedSuspension(runId);
        expect(restored.restored).toBe(false);
        expect(restored.refusal).toBe('RUN_COMPLETED');

        const second = await resumeOutcome(engine, runId);
        expect(second.result?.code).toBe('RUN_NOT_FOUND');
        expect(led.tail, 'exactly once across two resumes').toBe(1);

        expect(errors.length, 'the swallowed throw is still reported').toBe(1);
        expect(errors[0]?.message).toContain(runId);
    });

    it('PIN 3 — the swallowed history failure is loud: `error`, naming the run, the loss and the fix', async () => {
        // ⛔ The guard must not trade a phantom strand for a silent failure.
        // AGENTS.md "Degradation log levels": the terminal history row claims
        // to persist and did not, while every caller reads a healthy completed
        // run — the judgment question answers YES, so `error`, with the
        // consequence and the fix in the first line.
        const { errors, logger } = recorder();
        const { engine } = engineOver(new SyncThrowTerminalStore(), logger);
        const runId = await park(engine);

        await resumeOutcome(engine, runId);

        expect(errors.length, 'said ONCE per run, not once per failed write').toBe(1);
        const line = errors[0]!;
        expect(line.message).toContain(runId);
        expect(line.message, 'the consequence: the run COMPLETED and its history row did not land')
            .toMatch(/completed/i);
        expect(line.message, 'the fix is the store failure in the meta').toMatch(/history/i);
        // THIRD argument per `error(message, error?, meta?)` — the driver text
        // goes to the structured slot, never into the message (#6499), and the
        // `Error` slot stays empty on purpose (#5575).
        expect(line.errorSlot).toBeUndefined();
        expect(JSON.stringify(line.meta)).toContain(TERMINAL_WRITE_FAILURE);
        expect(line.message).not.toContain(TERMINAL_WRITE_FAILURE);
    });

    it('CONTROL — a GENUINE node failure on the same throwing store still journals and still reports `stranded`', async () => {
        // ⛔ The guard must narrow nothing. This is the #15555 exit, driven on
        // the identical store: the node itself threw, so the run really did
        // strand and really is repairable, and both facts must survive.
        const { engine, led, knobs } = engineOver(new SyncThrowTerminalStore(), recorder().logger);
        knobs.throws = true;
        const runId = await park(engine);

        const outcome = await resumeOutcome(engine, runId);

        expect(outcome.kind).toBe('returned');
        expect(outcome.result?.success).toBe(false);
        expect(outcome.result?.status, "the producer's discriminator, #13937 shape 4").toBe('stranded');
        expect(outcome.result?.error).toContain(NODE_FAILURE);
        expect(led.tail).toBe(1);

        // The journal is there and the repair verb honours it — the exact
        // opposite of PIN 1, on the same store, distinguished only by whether
        // the NODE threw.
        const restored = await engine.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
        expect(restored.restored, 'a real strand is still repairable').toBe(true);
        expect(restored.refusal).toBeUndefined();
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
    });

    it('CONTROL — a completed run on a HEALTHY store logs no error and lands its history row', async () => {
        // The reverse control for PIN 3. If this logged too, PIN 3 would be
        // measuring "the engine logs on every completed run", not "the guard
        // fired".
        const store = new InMemorySuspendedRunStore();
        const { errors, logger } = recorder();
        const { engine, led } = engineOver(store, logger);
        const runId = await park(engine);

        const outcome = await resumeOutcome(engine, runId);

        expect(outcome.result?.success).toBe(true);
        expect(outcome.result?.status).toBeUndefined();
        expect(led.tail).toBe(1);
        expect(errors, 'no secondary failure ⇒ nothing to report').toEqual([]);

        // `recordTerminal` is fire-and-forget — let the microtask land.
        await new Promise((r) => setTimeout(r, 0));
        expect((await store.loadTerminal(runId))?.status, 'the healthy path still persists').toBe('completed');
        expect((await engine.restoreConsumedSuspension(runId)).refusal).toBe('RUN_COMPLETED');
    });
});
