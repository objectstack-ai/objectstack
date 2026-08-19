// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9510 — a retry attempt that PAUSES is a durable pause, not a failed attempt.
 *
 * `execute()`'s catch tests the suspend signal FIRST, and that arm is what makes
 * ADR-0019's durable pause work: it snapshots the live variables, calls
 * `persistSuspendedRun`, records a `paused` log entry and returns
 * `{ success: true, status: 'paused', runId }`.
 *
 * `executeWithoutRetry()` — the method `retryExecution` re-runs the flow through
 * on every retry attempt — had no such arm, so a `FlowSuspendSignal` thrown on a
 * retry attempt fell into the generic failure path and four things were lost at
 * once:
 *
 *  1. `persistSuspendedRun` never ran, so THE CONTINUATION WAS NEVER STORED and
 *     the run could not be resumed by anyone, ever — the headline harm, and the
 *     reason the pins below are written against the STORE and a real `resume()`
 *     rather than against the status string. A repair that flipped `status` to
 *     `'paused'` and still dropped the continuation would satisfy a
 *     status-only assertion and leave the defect exactly where it was.
 *  2. the run log recorded `failed` for a run that asked to pause;
 *  3. the caller got `status: 'failed'` — with the signal stringified into
 *     `error`, since `FlowSuspendSignal` is not an `Error`;
 *  4. `retryExecution` reads `result.success`, so the pause counted as one more
 *     failed attempt: the loop burned the rest of the budget, and every further
 *     attempt re-entered the pausing node and orphaned another suspension.
 *
 * ## Reachability, and why the fixture is shaped the way it is
 *
 * Only a LATER attempt is exposed — `execute()` handles the first one correctly,
 * and a flow reaches `retryExecution` only after a failure. So the fixture is
 * the ordinary shape the card names: a flaky call (`flaky`) followed by a
 * pausing node (`gate`). `failFirstAttempts` decides which attempt reaches the
 * gate, and that single knob is what makes the defect DETERMINISTIC rather than
 * timing-dependent: `failFirstAttempts: 1` forces the pause onto attempt 2 every
 * run, `failFirstAttempts: 0` puts the identical pause on attempt 1, through
 * `execute()`'s own arm. The two are the same user-visible situation reached by
 * two routes, which is why they are pinned AGAINST EACH OTHER below rather than
 * each in isolation.
 *
 * The wire half — that both routes reach the trigger door as one answer — is
 * pinned end-to-end in `@objectstack/verify`'s
 * `automation-trigger-paused-run.test.ts`; the door's own reading of the third
 * state is pinned in `@objectstack/runtime`'s
 * `automation-trigger-paused-run.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext, AutomationResult } from '@objectstack/spec/contracts';

const silent = { info() {}, warn() {}, error() {}, debug() {}, child: () => silent } as never;

/**
 * `resumeAuthority: 'any'` is required of a pausing fixture since #5561 — these
 * tests continue their pause through the public `resume` door. Nothing here is
 * about the resume gate (`resume-authority-gate.test.ts` owns that).
 */
const pauser = defineActionDescriptor({
    type: 'gate',
    version: '1.0.0',
    name: 'gate',
    supportsPause: true,
    resumeAuthority: 'any',
});

interface Harness {
    engine: AutomationEngine;
    store: InMemorySuspendedRunStore;
    /** How many times each node's executor actually ran. */
    calls: { flaky: number; gate: number; after: number };
    trigger(): Promise<AutomationResult>;
}

/**
 * start -> flaky -> gate (pauses) -> after -> end, under
 * `errorHandling.strategy: 'retry'`.
 *
 * `failFirstAttempts` fails `flaky` on exactly that many leading attempts, so
 * the attempt the `gate` is reached on is chosen by the caller, not by timing.
 * `afterFails` fails the node BEHIND the pause, which is only ever reached
 * through `resume()` — it is how the retry-budget question is measured.
 */
function bootFlow(opts: {
    failFirstAttempts: number;
    afterFails?: boolean;
    maxRetries?: number;
}): Harness {
    const store = new InMemorySuspendedRunStore();
    const engine = new AutomationEngine(silent, store);
    const calls = { flaky: 0, gate: 0, after: 0 };

    engine.registerNodeExecutor({
        type: 'flaky',
        async execute() {
            calls.flaky++;
            return calls.flaky <= opts.failFirstAttempts
                ? { success: false, error: 'connector 503' }
                : { success: true, output: { ok: true } };
        },
    } as never);

    engine.registerNodeExecutor({
        type: 'gate',
        descriptor: pauser,
        async execute() {
            calls.gate++;
            return { success: true, suspend: true, correlation: 'approval:req-1' };
        },
    } as never);

    engine.registerNodeExecutor({
        type: 'after',
        async execute() {
            calls.after++;
            return opts.afterFails
                ? { success: false, error: 'post-approval write rejected' }
                : { success: true, output: { done: true } };
        },
    } as never);

    engine.registerFlow('flaky_approval', {
        name: 'flaky_approval',
        label: 'flaky_approval',
        type: 'autolaunched',
        errorHandling: { strategy: 'retry', maxRetries: opts.maxRetries ?? 2, backoffMs: 0 },
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'flaky', type: 'flaky', label: 'Flaky call' },
            { id: 'gate', type: 'gate', label: 'Approval' },
            { id: 'after', type: 'after', label: 'After approval' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'flaky' },
            { id: 'e1', source: 'flaky', target: 'gate' },
            { id: 'e2', source: 'gate', target: 'after' },
            { id: 'e3', source: 'after', target: 'end' },
        ],
    } as never);

    return {
        engine,
        store,
        calls,
        trigger: () => engine.execute('flaky_approval', {
            event: 'test',
            object: 'crm_order',
            record: { id: 'ord_9510', amount: 500 },
        } as unknown as AutomationContext),
    };
}

describe('#9510 — a pause on a RETRY attempt is durable, not a burned attempt', () => {
    it('stores the continuation and the run is genuinely resumable — the durable half', async () => {
        const h = bootFlow({ failFirstAttempts: 1 });

        const res = await h.trigger();

        // Attempt 1 failed at `flaky`; attempt 2 got past it and paused at `gate`.
        expect(h.calls.flaky).toBe(2);
        expect(h.calls.gate).toBe(1);
        expect(res.status).toBe('paused');
        expect(res.runId).toBeDefined();

        // ⭐ THE assertion this card is about: the continuation EXISTS. Before
        // the repair nothing was written here at all, so the run was
        // unresumable for good — no status string, message or duration says
        // that, which is why the pin is on the store.
        const stored = await h.store.load(res.runId as string);
        expect(stored).not.toBeNull();
        expect(stored?.runId).toBe(res.runId);
        expect(stored?.flowName).toBe('flaky_approval');
        expect(stored?.nodeId).toBe('gate');
        // The resume gate's key (#3801) — a continuation without it is resumable
        // only by falling back to the live flow definition.
        expect(stored?.nodeType).toBe('gate');
        expect(stored?.correlation).toBe('approval:req-1');
        // The snapshot is the RUN's own state, not an empty husk: what the
        // pre-pause node actually produced is in it, under `<nodeId>.<key>`.
        expect(stored?.variables?.['flaky.ok']).toBe(true);
        expect(stored?.variables?.$record).toEqual({ id: 'ord_9510', amount: 500 });

        // …and "resumable" asserted by DOING it, not by inspecting a row: the
        // run continues from `gate`'s out-edge and reaches `end`.
        const resumed = await h.engine.resume(res.runId as string, { output: { verdict: 'approved' } } as never);
        expect(resumed.success).toBe(true);
        expect(resumed.status).not.toBe('paused');
        expect(h.calls.after).toBe(1);
        // The suspension is consumed, exactly as a first-attempt pause's is.
        expect(await h.store.load(res.runId as string)).toBeNull();
    });

    it('records the run log as paused, never failed', async () => {
        const h = bootFlow({ failFirstAttempts: 1 });

        const res = await h.trigger();

        // A run log that says a paused run failed is a second lie on the same
        // event: the run is alive, parked and waiting for a human.
        const run = await h.engine.getRun(res.runId as string);
        expect(run?.status).toBe('paused');
        expect(run?.status).not.toBe('failed');
        // #7639 — ONE snapshot expression feeds both consumers, on this path
        // too: what an operator reads on run-detail is by construction the
        // state the continuation will resume from, never a second capture.
        const stored = await h.store.load(res.runId as string);
        expect(run?.variables).toEqual(stored?.variables);
    });

    it('stops the retry loop as a CONSEQUENCE of the pause — the accounting is untouched', async () => {
        const h = bootFlow({ failFirstAttempts: 1, maxRetries: 2 });

        const res = await h.trigger();

        expect(res.status).toBe('paused');
        // The budget allowed 1 initial attempt + 2 retries = 3 runs of `flaky`.
        // Only 2 happened, and the pausing node was entered exactly ONCE: the
        // loop stopped because the attempt did not fail, not because anything
        // stopped counting. Re-running the flow here would have started the
        // approval a second time while the first continuation was still live —
        // the pre-repair behaviour, which orphaned one suspension per attempt.
        expect(h.calls.flaky).toBe(2);
        expect(h.calls.gate).toBe(1);
    });

    it('still burns the full budget when attempts genuinely FAIL — the loop was not weakened', async () => {
        // The guard against "make the loop stop" being implemented by deleting
        // retry accounting: with the gate never reached, the count is the #4247
        // contract exactly — maxRetries + 1 attempts.
        const h = bootFlow({ failFirstAttempts: 99, maxRetries: 2 });

        const res = await h.trigger();

        expect(res.success).toBe(false);
        expect(res.status).toBe('failed');
        expect(h.calls.flaky).toBe(3);
        expect(h.calls.gate).toBe(0);
    });

    it('answers a pause on attempt 2 exactly as it answers one on attempt 1 — the two producers pinned against each other', async () => {
        // Same flow, same pausing node, same trigger. The ONLY difference is
        // which attempt reaches the gate — i.e. which engine arm produced the
        // pause: `execute()`'s catch, or the one restored to
        // `executeWithoutRetry`. One user-visible situation must not have two
        // answers, so the two results are compared to EACH OTHER rather than
        // each to a hand-written expectation.
        const first = bootFlow({ failFirstAttempts: 0 });
        const retry = bootFlow({ failFirstAttempts: 1 });

        const viaExecute = await first.trigger();
        const viaRetry = await retry.trigger();

        // Same producer arm reached by two routes: same keys, in the same shape.
        expect(Object.keys(viaRetry).sort()).toEqual(Object.keys(viaExecute).sort());
        // …and the same values, except the two that are per-run by nature.
        const shape = (r: AutomationResult) => ({ ...r, runId: '<runId>', durationMs: 0 });
        expect(shape(viaRetry)).toEqual(shape(viaExecute));
        expect(viaRetry.success).toBe(true);
        expect(viaRetry.status).toBe('paused');

        // The stored continuations match too — a matching return value over a
        // missing continuation is the failure this card is about.
        const storedViaExecute = await first.store.load(viaExecute.runId as string);
        const storedViaRetry = await retry.store.load(viaRetry.runId as string);
        expect(storedViaRetry).not.toBeNull();
        expect(Object.keys(storedViaRetry ?? {}).sort()).toEqual(Object.keys(storedViaExecute ?? {}).sort());
        expect(storedViaRetry?.nodeId).toBe(storedViaExecute?.nodeId);
        expect(storedViaRetry?.nodeType).toBe(storedViaExecute?.nodeType);
        expect(storedViaRetry?.correlation).toBe(storedViaExecute?.correlation);

        // ⚠️ The one thing that does NOT match, asserted rather than skirted.
        // `executeWithoutRetry` seeds none of the engine-owned variables
        // `execute()` binds (`$runId`, `$flowName`, `$flowLabel`, `record` and
        // its flattened fields, `previous`), so a retry attempt has always run
        // in a smaller environment than the first — filed as #9704, a divergent
        // run environment rather than a lost pause, and out of scope here: it
        // afflicts every retry attempt, pausing or not, and predates this card.
        //
        // It is pinned as TODAY's measured behaviour, deliberately, so #9704
        // cannot be repaired silently. When it is repaired these three
        // assertions are the ones that go red, and the correct edit is to
        // delete them and add `variables` to the parity block above.
        const engineOwned = ['$runId', '$flowName', '$flowLabel', 'previous', 'record'];
        for (const name of engineOwned) {
            expect(Object.keys(storedViaExecute?.variables ?? {})).toContain(name);
            expect(Object.keys(storedViaRetry?.variables ?? {})).not.toContain(name);
        }
        // What the two DO share: the run's own work. Both snapshots carry the
        // pausing node's inputs, so the continuation is a real continuation on
        // either route — the half this card is about.
        expect(storedViaRetry?.variables?.['flaky.ok']).toEqual(storedViaExecute?.variables?.['flaky.ok']);
        expect(storedViaRetry?.variables?.$record).toEqual(storedViaExecute?.variables?.$record);

        // The run LOG agrees on both routes as well.
        expect((await retry.engine.getRun(viaRetry.runId as string))?.status)
            .toBe((await first.engine.getRun(viaExecute.runId as string))?.status);
    });

    /**
     * ⭐ The retry-budget question the ruling required to be ANSWERED rather
     * than assumed, measured rather than reasoned:
     *
     *   **A resumed run gets NO retries — on either route.**
     *
     * Two independent facts produce that answer, both read off `origin/main`:
     *
     *  - `SuspendedRun` (engine.ts) declares no attempt/retry field of any kind,
     *    so the continuation CANNOT carry attempt state; and
     *  - `resumeInternal` never reads `flow.errorHandling` and never enters
     *    `retryExecution`, so a resumed run that fails is terminal.
     *
     * So the answer is neither "inherits the remaining attempts" nor "starts
     * fresh": the retry budget does not survive a pause at all. This is
     * PRE-EXISTING behaviour of every paused run, not something this card
     * introduces — which is exactly why lifting the arm is safe here: the
     * retry-path pause inherits the same answer the execute-path pause has
     * always had, and the two stay consistent.
     *
     * That the resume path ignores a flow's declared retry policy is a real
     * gap, but a DIFFERENT one, on a different method; it is filed as #9705
     * rather than absorbed here. What is pinned below is today's measured
     * answer, so whatever that card decides is a deliberate change and not an
     * accident.
     */
    it('answers the retry-budget question: a resumed run does not retry, on either route', async () => {
        for (const failFirstAttempts of [0, 1]) {
            const h = bootFlow({ failFirstAttempts, afterFails: true, maxRetries: 2 });

            const paused = await h.trigger();
            expect(paused.status).toBe('paused');

            const resumed = await h.engine.resume(paused.runId as string, { output: { verdict: 'approved' } } as never);

            // The post-pause node rejected. The run is terminally failed and
            // the node ran ONCE: no attempt was inherited and none was granted
            // fresh, because `resumeInternal` has no retry path at all.
            expect(resumed.success).toBe(false);
            expect(h.calls.after).toBe(1);
        }
    });
});
