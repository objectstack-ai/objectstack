// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9378 — the two `trigger` doors answer real HTTP status codes.
 *
 * `POST /api/v1/automation/:name/trigger` and the legacy
 * `POST /api/v1/automation/trigger/:name` (the shape
 * `client.automation.trigger()` calls) both ended
 * `return deps.success(result)` unconditionally, so a flow that RAN AND FAILED
 * came back as
 *
 * ```
 * HTTP 200 {"success":true,"data":{"success":false,"error":"Node 'x' failed: …"}}
 * ```
 *
 * — the double envelope #3962 ruled out for `/actions` and #8684 closed on the
 * resume route. A caller that branches on the HTTP status alone read a failed
 * run as a successful one, and this is the door every app dispatches flows
 * through, so the blast radius is the whole SDK surface rather than the screen
 * flow runner.
 *
 * Both routes are exercised for EVERY arm below, from one table: they share
 * one context builder (#4127) and now one response mapper, and a test that
 * covered only the canonical spelling would let the legacy one — the one the
 * SDK actually calls — drift back to 200 unnoticed.
 *
 * The classification asserted here is the maintainer ruling recorded on the
 * card (2026-08-17). Two of its four rows are deliberately NOT implemented yet
 * and are pinned as unchanged, with the reason, at the bottom of this file.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { AutomationResult } from '@objectstack/spec/contracts';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;

/** Both spellings of the same door. `path` takes the flow name. */
const ROUTES: Array<{ label: string; path: (flow: string) => string }> = [
    { label: 'POST /:name/trigger', path: (f) => `/${f}/trigger` },
    { label: 'legacy POST /trigger/:name', path: (f) => `/trigger/${f}` },
];

/**
 * An automation service holding exactly the flows it is given, answering
 * `execute` with a scripted result — the shape the real engine presents:
 * `getFlow` resolves `null` for an unknown name, and `execute` returns an
 * `AutomationResult` rather than throwing.
 */
function makeDispatcher(opts: {
    flows?: string[];
    result?: AutomationResult;
    omitGetFlow?: boolean;
} = {}) {
    const names = opts.flows ?? ['welcome_flow'];
    const flows = new Map(names.map((n) => [n, { name: n }]));
    const execute = vi.fn(async (): Promise<AutomationResult> => opts.result ?? { success: true, output: {} });
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);
    const automation: Record<string, unknown> = opts.omitGetFlow ? { execute } : { execute, getFlow };
    const services: Record<string, unknown> = { automation };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), execute, getFlow };
}

/**
 * The engine's ran-and-failed result, as `execute()` builds it since #9378:
 * `status: 'failed'` is the producer's own verdict — the same one it writes to
 * the run log — and it is the ONLY thing that separates this class from the
 * exits that never dispatched anything.
 */
const RAN_AND_FAILED: AutomationResult = {
    success: false,
    status: 'failed',
    error: "Node 'create_opportunity' failed: Amount must be greater than zero",
    durationMs: 45,
    summary: {
        selected: 0, acted: 0, skipped: 0, unmeasured: 0,
        nodes: [{ nodeId: 'create_opportunity', nodeType: 'create_record', status: 'failure', runs: 1, failures: 1 }],
    } as AutomationResult['summary'],
};

describe('#9378 — a trigger that ran and failed answers 400 FLOW_FAILED, not 200', () => {
    for (const route of ROUTES) {
        it(`${route.label}: answers 400 FLOW_FAILED with no inner envelope`, async () => {
            const { dispatcher } = makeDispatcher({ result: RAN_AND_FAILED });

            const result = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', { amount: 0 }, CTX);

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(400);
            expect(result.response?.body?.error?.code).toBe('FLOW_FAILED');
            expect(result.response?.body?.error?.httpStatus).toBe(400);
            // The node failure stays the human-readable message, verbatim.
            expect(result.response?.body?.error?.message).toMatch(/Node 'create_opportunity' failed/);
            // The double envelope is GONE, not merely re-labelled: there is no
            // inner `data` left for a status-blind caller to misread.
            expect(result.response?.body?.data).toBeUndefined();
            expect(result.response?.body?.success).toBe(false);
        });

        it(`${route.label}: carries the run summary in the 400 details`, async () => {
            const { dispatcher } = makeDispatcher({ result: RAN_AND_FAILED });

            const result = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);

            // WHICH node failed survives the envelope change — it is why a
            // caller reads the body at all, and it rode the 200 body before.
            expect(result.response?.body?.error?.details?.summary?.nodes?.[0]?.status).toBe('failure');
            // `code` is promoted out of `details` into the declared field,
            // never duplicated in both (`error-envelope.ts`).
            expect(result.response?.body?.error?.details?.code).toBeUndefined();
        });

        it(`${route.label}: carries the flow author's errorMessage in details, not folded into the message`, async () => {
            // ⚠️ The single point where the consumer contract can be silently
            // lost. objectui reads the author's own failure text from
            // `error.details.errorMessage` and nowhere else (objectui
            // `flowResponse.ts`, PR #4899); the ADR-0112 envelope has no
            // `data`, so a producer that builds its message out of
            // `result.error` alone drops the author's words while every status
            // assertion stays green.
            const { dispatcher } = makeDispatcher({
                result: {
                    ...RAN_AND_FAILED,
                    errorMessage: 'We could not create the opportunity — check the amount and try again.',
                },
            });

            const result = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);

            expect(result.response?.body?.error?.details?.errorMessage)
                .toBe('We could not create the opportunity — check the amount and try again.');
            expect(result.response?.body?.error?.message).toMatch(/Node 'create_opportunity' failed/);
        });

        it(`${route.label}: a retry-strategy run that exhausted its attempts is the same 400`, async () => {
            // `errorHandling.strategy: 'retry'` returns through
            // `retryExecution`, a different exit with no `summary` — and it is
            // still a run that dispatched and was rejected, so it must not be
            // the one failure shape left riding HTTP 200.
            const { dispatcher } = makeDispatcher({
                result: { success: false, status: 'failed', error: 'Max retries exceeded', durationMs: 300 },
            });

            const result = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);

            expect(result.response?.status).toBe(400);
            expect(result.response?.body?.error?.code).toBe('FLOW_FAILED');
            expect(result.response?.body?.error?.message).toBe('Max retries exceeded');
        });

        it(`${route.label}: an unknown flow is 404, and is never dispatched`, async () => {
            const { dispatcher, execute, getFlow } = makeDispatcher();

            const result = await dispatcher.handleAutomation(route.path('definitely_not_a_flow'), 'POST', {}, CTX);

            expect(result.response?.status).toBe(404);
            expect(result.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
            // Named, so the caller knows WHICH name failed to resolve.
            expect(result.response?.body?.error?.message).toContain('definitely_not_a_flow');
            // The same shared `getFlow` probe `POST /:name/toggle` (#7535) and
            // `GET /:name` use, so no two doors can disagree about which flows
            // exist — and the engine is never asked to run a name it does not
            // hold.
            expect(getFlow).toHaveBeenCalledWith('definitely_not_a_flow');
            expect(execute).not.toHaveBeenCalled();
        });

        it(`${route.label}: a successful run still answers 200 with its result`, async () => {
            const { dispatcher } = makeDispatcher({
                result: { success: true, output: { created: 'opp_1' }, durationMs: 12 },
            });

            const result = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', { a: 1 }, CTX);

            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.success).toBe(true);
            expect(result.response?.body?.data?.output).toEqual({ created: 'opp_1' });
        });

        it(`${route.label}: a run that PAUSED still answers 200 with the screen`, async () => {
            // A pause is not a failure — the screen-flow runner drives the next
            // screen off this 200, and a status flip here would break every
            // multi-screen flow.
            const { dispatcher } = makeDispatcher({
                result: { success: true, status: 'paused', runId: 'run_1', screen: { nodeId: 'collect', fields: [] } },
            });

            const result = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);

            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.runId).toBe('run_1');
            expect(result.response?.body?.data?.screen?.nodeId).toBe('collect');
        });

        it(`${route.label}: an implementation without \`getFlow\` keeps the probe optional`, async () => {
            // `getFlow?` is optional on `IAutomationService`. A service that
            // omits it cannot be asked whether a flow exists, so the trigger
            // proceeds rather than this inventing a 404 — while the
            // ran-and-failed mapping, which needs no probe, still applies.
            const { dispatcher, execute } = makeDispatcher({ omitGetFlow: true, result: RAN_AND_FAILED });

            const result = await dispatcher.handleAutomation(route.path('anything'), 'POST', {}, CTX);

            expect(execute).toHaveBeenCalledTimes(1);
            expect(result.response?.status).toBe(400);
            expect(result.response?.body?.error?.code).toBe('FLOW_FAILED');
        });
    }
});

/**
 * The route reads the ENGINE's classification; it does not infer one.
 *
 * These two exits — a DISABLED flow (the ruling's 409) and one with NO START
 * NODE (the ruling's 422) — never dispatched anything, and the engine cannot
 * yet say which is which: `AutomationResult.code` is a closed union of
 * resume-refusal members with no honest home for either, and the maintainer
 * ruling on #9384 (2026-08-17) keeps it closed, routing any new member to the
 * spec seat.
 *
 * So they keep TODAY's behaviour, pinned here rather than left unexamined —
 * and pinning them is what proves the 400 arm is not a shape heuristic: both
 * carry `success: false` exactly like the ran-and-failed exit, and both stay
 * 200 because they carry no `status: 'failed'`. When the union question is
 * ruled, these two assertions are the ones that flip.
 */
describe('#9378 — the two never-dispatched exits the ruling leaves open stay unchanged', () => {
    for (const route of ROUTES) {
        for (const [label, result] of [
            ['a disabled flow', { success: false, error: "Flow 'welcome_flow' is disabled" }],
            ['a flow with no start node', { success: false, error: 'Flow has no start node' }],
        ] as Array<[string, AutomationResult]>) {
            it(`${route.label}: ${label} is NOT reported as a failed run`, async () => {
                const { dispatcher } = makeDispatcher({ result });

                const r = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);

                expect(r.response?.status).toBe(200);
                expect(r.response?.body?.error?.code).not.toBe('FLOW_FAILED');
                expect(r.response?.body?.data?.success).toBe(false);
            });
        }

        it(`${route.label}: does not classify off \`summary\` or \`durationMs\``, async () => {
            // The tolerant-consumer shape PD #12 forbids, and the one #8684
            // deliberately did not reproduce: a never-dispatched exit carrying
            // the same incidental fields as a failed run must NOT be promoted
            // to 400 by their presence.
            const { dispatcher } = makeDispatcher({
                result: {
                    success: false,
                    error: "Flow 'welcome_flow' is disabled",
                    durationMs: 45,
                    summary: RAN_AND_FAILED.summary,
                },
            });

            const r = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);

            expect(r.response?.status).toBe(200);
        });
    }
});
