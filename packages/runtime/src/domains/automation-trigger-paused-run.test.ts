// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9510 — the trigger door answers a PAUSED run as the third state, deliberately.
 *
 * The engine repair that lifted `execute()`'s ADR-0019 suspend arm into
 * `executeWithoutRetry` gave `retryExecution` a NON-TERMINAL result to return: a
 * retry attempt that reaches a pausing node now comes back as
 * `{ success: true, status: 'paused', runId }` instead of being reported as a
 * failed attempt with its continuation dropped. This door is one of the two
 * readers that had only ever seen terminal results out of that path.
 *
 * What is pinned here is the door's READING, driven with scripted
 * `AutomationResult`s so every arm is reachable without a real engine (the
 * end-to-end sentence — that a real engine's two producers reach this door as
 * ONE answer — is `@objectstack/verify`'s
 * `automation-trigger-paused-run.test.ts`, and the engine-side equality is
 * `service-automation`'s `retry-attempt-pause.test.ts`).
 *
 * Both spellings of the door are exercised for every arm, from one table, for
 * the reason #9378's suite states: they share one context builder and one
 * response mapper, and a test covering only the canonical spelling would let the
 * legacy one — the one the SDK actually calls — drift unnoticed.
 *
 * ⚠️ The paused answer is deliberately IDENTICAL to the terminal-success one on
 * the wire, so these assertions cannot be satisfied by "some 200". They pin the
 * payload a caller resumes with: `status`, `runId`, `screen`, and the absence of
 * any refusal envelope.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { classifyFlowRefusal, isPausedRun } from '../flow-dispatch-status.js';
import type { AutomationResult } from '@objectstack/spec/contracts';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;

/** Both spellings of the same door. `path` takes the flow name. */
const ROUTES: Array<{ label: string; path: (flow: string) => string }> = [
    { label: 'POST /:name/trigger', path: (f) => `/${f}/trigger` },
    { label: 'legacy POST /trigger/:name', path: (f) => `/trigger/${f}` },
];

function makeDispatcher(result: AutomationResult) {
    const flows = new Map([['flaky_approval', { name: 'flaky_approval' }]]);
    const execute = vi.fn(async (): Promise<AutomationResult> => result);
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);
    const services: Record<string, unknown> = { automation: { execute, getFlow } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return new HttpDispatcher(kernel);
}

/**
 * The engine's paused result, in the shape BOTH producers build it — the arm in
 * `execute()`'s catch and the one restored to `executeWithoutRetry`. The two are
 * byte-identical apart from the ids, which is the point: this door must not be
 * able to tell which attempt paused.
 */
const PAUSED: AutomationResult = {
    success: true,
    status: 'paused',
    runId: 'run_7f0a',
    durationMs: 12,
    screen: {
        title: 'Approve the order',
        fields: [{ name: 'verdict', type: 'text', label: 'Verdict' }],
    } as AutomationResult['screen'],
};

describe('#9510 — a triggered run that PAUSED is answered as the third state', () => {
    for (const route of ROUTES) {
        it(`${route.label}: answers 200 carrying the runId the caller resumes with`, async () => {
            const dispatcher = makeDispatcher(PAUSED);

            const result = await dispatcher.handleAutomation(route.path('flaky_approval'), 'POST', {}, CTX);

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.success).toBe(true);
            // The run is ALIVE and parked. Without these two the caller has no
            // way to continue it, which is the harm #9510 is about — a 200 that
            // merely "looks fine" is not the contract.
            expect(result.response?.body?.data?.status).toBe('paused');
            expect(result.response?.body?.data?.runId).toBe('run_7f0a');
            // The screen a screen-flow runner renders travels with it.
            expect(result.response?.body?.data?.screen?.title).toBe('Approve the order');
            // …and it is NOT dressed as a refusal: a paused run has no error
            // envelope, no code, and nothing for a status-blind caller to read
            // as a failure.
            expect(result.response?.body?.error).toBeUndefined();
        });

        it(`${route.label}: a pause with no screen (approval, wait) is still the paused answer`, async () => {
            // `screen` is a screen-flow field; an `approval` or `wait` node
            // pauses without one, and the body a caller resumes with must be
            // the same either way.
            //
            // ⚠️ Honest about its own reach: this door answers a pause and a
            // terminal success IDENTICALLY on the wire — deliberately, since
            // both are `200` plus the engine result — so no route-level
            // assertion can tell which arm produced the response. What it pins
            // is the PAYLOAD (`status`, `runId`, no refusal envelope); that the
            // arm reads the lifecycle verdict rather than sniffing `screen` is
            // pinned on `isPausedRun` itself, below.
            const dispatcher = makeDispatcher({ success: true, status: 'paused', runId: 'run_b21', durationMs: 3 });

            const result = await dispatcher.handleAutomation(route.path('flaky_approval'), 'POST', {}, CTX);

            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.status).toBe('paused');
            expect(result.response?.body?.data?.runId).toBe('run_b21');
            expect(result.response?.body?.error).toBeUndefined();
        });
    }
});

describe('#9510 — the shared dispatch table names the non-terminal state', () => {
    it('classifies a paused run as no refusal at all', () => {
        expect(classifyFlowRefusal('flaky_approval', PAUSED)).toBeUndefined();
    });

    it('reads the producer\'s lifecycle verdict, never the incidental fields', () => {
        // `runId` and `screen` ride along on a pause; neither DEFINES it.
        expect(isPausedRun(PAUSED)).toBe(true);
        expect(isPausedRun({ success: true, runId: 'run_x' })).toBe(false);
        expect(isPausedRun({ success: false, status: 'failed', error: 'boom' })).toBe(false);
        expect(isPausedRun(undefined)).toBe(false);
        expect(isPausedRun(null)).toBe(false);

        // ⭐ The two cases that actually SEPARATE reading the verdict from
        // sniffing a companion field — and the reason they are spelled out:
        // every assertion above is satisfied by a predicate that returns
        // `!!result.screen`, because a screen happens to accompany the paused
        // fixture and to be absent from all the negatives. A pin that cannot
        // fail against the tolerant-consumer shape PD #12 forbids is not
        // pinning anything, so these two carry the sentence:
        //
        //  - an `approval` or `wait` pause has NO screen and is still a pause;
        expect(isPausedRun({ success: true, status: 'paused', runId: 'run_b21' })).toBe(true);
        //  - a screen on a result that is not parked does NOT make it one.
        expect(isPausedRun({ success: true, status: 'completed', screen: PAUSED.screen })).toBe(false);
    });

    it('never promotes a paused run into the FLOW_FAILED row, even against the grain', () => {
        // Defensive rather than reachable: no producer stamps this pair today.
        // It states which field decides when they disagree — a LIVE suspended
        // run, continuation persisted and waiting for a `resume()`, must not be
        // reported to its caller as a run that failed. That is #9510's defect
        // wearing transport clothing.
        const contradictory = { success: false, status: 'paused', runId: 'run_c3' } as AutomationResult;

        expect(classifyFlowRefusal('flaky_approval', contradictory)).toBeUndefined();
    });

    it('still classifies the terminal refusal rows — the new arm narrows nothing', () => {
        expect(classifyFlowRefusal('f', { success: false, status: 'failed', error: 'boom' })?.code)
            .toBe('FLOW_FAILED');
        expect(classifyFlowRefusal('f', { success: false, code: 'FLOW_DISABLED' })?.status).toBe(409);
        expect(classifyFlowRefusal('f', { success: false, code: 'FLOW_NO_START_NODE' })?.status).toBe(422);
    });
});
