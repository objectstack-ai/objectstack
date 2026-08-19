// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9510 — a run that pauses on a RETRY attempt reaches the wire as a live,
 * resumable pause, and as the SAME answer a first-attempt pause gets.
 *
 * This is the end-to-end half, and it lives here because `@objectstack/verify`
 * is the one package depending on BOTH `@objectstack/runtime` (the trigger and
 * resume doors) and `@objectstack/service-automation` (the engine that produces
 * the result) — the same reason #9414's `automation-trigger-terminal-messages`
 * suite sits beside it. The engine-side pins are in
 * `packages/services/service-automation/src/retry-attempt-pause.test.ts`; the
 * door-side pins, driven with scripted results, are in
 * `packages/runtime/src/domains/automation-trigger-paused-run.test.ts`. Neither
 * of those, alone or together, can make the sentence this file makes: the two
 * ENGINE PRODUCERS reach the door as one wire answer, and the run a caller is
 * handed can actually be continued.
 *
 * **The requirement is an equality, so it is written as one.** The ruling on
 * this card is explicit that the trigger route's answer for a paused retry must
 * match what `execute()`'s paused return already produces, *pinned against it
 * rather than verified in isolation* — because two paths answering differently
 * for one user-visible situation would replace a LOST pause with an inconsistent
 * one. So the two responses below are compared to EACH OTHER, and the only
 * fields normalised away are the two that are per-run by nature.
 *
 * **And a matching answer is not the whole contract.** The headline harm was
 * that `persistSuspendedRun` never ran, so the continuation was never stored and
 * the run could not be resumed by anyone. A repair that returned the right JSON
 * over a missing continuation would satisfy an equality and leave that intact —
 * so the paused-on-retry run is also CONTINUED here, through the real
 * `POST /:name/runs/:runId/resume` door, and the run log is read back through
 * the real run-detail door.
 *
 * ⚠️ This suite resolves both packages through their BUILT `dist/`, as every
 * dependent of theirs in this workspace does. Rebuild
 * `@objectstack/service-automation` and `@objectstack/runtime` before trusting a
 * run of this file — and especially before trusting an ABLATED one, where a
 * stale `dist` would run the pre-mutation code and report green over a mutation
 * that never reached the artifact.
 */

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from '@objectstack/runtime';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
import { defineActionDescriptor } from '@objectstack/spec/automation';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as never;

function createTestLogger(): never {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    return logger as never;
}

/**
 * `resumeAuthority: 'any'` because this suite continues its pause through the
 * PUBLIC resume door; since #5561 a node type declaring none is gated shut.
 */
const gate = defineActionDescriptor({
    type: 'gate',
    version: '1.0.0',
    name: 'gate',
    supportsPause: true,
    resumeAuthority: 'any',
});

/**
 * start -> flaky -> gate (pauses) -> after -> end, under
 * `errorHandling.strategy: 'retry'` — the ordinary shape the card names: a
 * flaky connector call followed by an approval.
 *
 * `failFirstAttempts` alone decides WHICH engine arm produces the pause, which
 * is what makes the comparison below an apples-to-apples one: `0` pauses on
 * attempt 1 through `execute()`'s own catch, `1` pauses on attempt 2 through the
 * arm restored to `executeWithoutRetry`. Nothing else differs.
 */
function boot(failFirstAttempts: number): HttpDispatcher {
    const engine = new AutomationEngine(createTestLogger(), new InMemorySuspendedRunStore());
    let flakyCalls = 0;

    engine.registerNodeExecutor({
        type: 'flaky',
        async execute() {
            flakyCalls++;
            return flakyCalls <= failFirstAttempts
                ? { success: false, error: 'connector 503' }
                : { success: true, output: { ok: true } };
        },
    } as never);
    engine.registerNodeExecutor({
        type: 'gate',
        descriptor: gate,
        async execute() {
            return { success: true, suspend: true, correlation: 'approval:req-1' };
        },
    } as never);
    engine.registerNodeExecutor({
        type: 'after',
        async execute() {
            return { success: true, output: { booked: true } };
        },
    } as never);

    engine.registerFlow('flaky_approval', {
        name: 'flaky_approval',
        label: 'flaky_approval',
        type: 'autolaunched',
        errorHandling: { strategy: 'retry', maxRetries: 2, backoffMs: 0 },
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

    const services: Record<string, unknown> = { automation: engine };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string): Promise<unknown> => resolve(name),
        context: { getService: resolve },
    };
    return new HttpDispatcher(kernel as never);
}

const trigger = (d: HttpDispatcher) => d.handleAutomation('/flaky_approval/trigger', 'POST', {}, CTX);

/** The two fields that are per-run by nature and cannot be compared literally. */
function normalise(body: any) {
    return { ...body, data: { ...body?.data, runId: '<runId>', durationMs: 0 } };
}

describe('#9510 — a paused retry attempt reaches the wire as a live, resumable pause', () => {
    it('answers 200 with the runId a caller resumes with, when the pause lands on attempt 2', async () => {
        const dispatcher = boot(1);

        const res = await trigger(dispatcher);

        expect(res.response?.status).toBe(200);
        expect(res.response?.body?.success).toBe(true);
        // Before the repair this same dispatch answered 400 FLOW_FAILED with
        // the suspend signal stringified into the message, and no run id at
        // all — the pause, and the run, were simply gone.
        expect(res.response?.body?.data?.status).toBe('paused');
        expect(typeof res.response?.body?.data?.runId).toBe('string');
        expect(res.response?.body?.error).toBeUndefined();
    });

    it('answers a pause on attempt 2 EXACTLY as it answers one on attempt 1', async () => {
        const viaExecute = await trigger(boot(0));
        const viaRetry = await trigger(boot(1));

        expect(viaRetry.response?.status).toBe(viaExecute.response?.status);
        // The whole body, compared to the other path's body rather than to a
        // hand-written expectation: one user-visible situation, one answer, and
        // no way for a caller to tell which attempt paused.
        expect(normalise(viaRetry.response?.body)).toEqual(normalise(viaExecute.response?.body));
    });

    it('hands back a run that can really be CONTINUED — the durable half, at the wire', async () => {
        const dispatcher = boot(1);
        const paused = await trigger(dispatcher);
        const runId = paused.response?.body?.data?.runId as string;

        // The real resume door, exactly as a console or the SDK reaches it.
        // This is the assertion a status-string-only repair could not pass:
        // with no continuation stored, the engine answers RUN_NOT_FOUND and
        // this door returns 404.
        const resumed = await dispatcher.handleAutomation(
            `/flaky_approval/runs/${runId}/resume`,
            'POST',
            { output: { verdict: 'approved' } },
            CTX,
        );

        expect(resumed.response?.status).toBe(200);
        expect(resumed.response?.body?.success).toBe(true);
        // The run continued past the gate and finished, rather than re-pausing
        // or reporting a stale suspension.
        expect(resumed.response?.body?.data?.status).not.toBe('paused');
        expect(resumed.response?.body?.data?.success).toBe(true);
    });

    it('serves the run log as paused, not failed, on run-detail', async () => {
        const dispatcher = boot(1);
        const paused = await trigger(dispatcher);
        const runId = paused.response?.body?.data?.runId as string;

        const detail = await dispatcher.handleAutomation(`/flaky_approval/runs/${runId}`, 'GET', undefined, CTX);

        expect(detail.response?.status).toBe(200);
        // A run log that says a paused run failed is a second lie on the same
        // event — the operator surface would show a dead run that is in fact
        // parked and waiting for a human.
        expect(detail.response?.body?.data?.status).toBe('paused');
    });
});
