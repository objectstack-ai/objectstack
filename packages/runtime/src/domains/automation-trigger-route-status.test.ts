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
 * card (2026-08-17). Two of its four rows landed with #9413 (404, and 400
 * `FLOW_FAILED`); the remaining two — 409 `FLOW_DISABLED` and 422
 * `FLOW_NO_START_NODE` — landed with #9415 once the spec seat widened the
 * closed `AutomationResult.code` union, and are at the bottom of this file.
 * All four rows are implemented and pinned here now.
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
 * ## History — these two assertions were written to flip, and #9415 flipped them
 *
 * When #9378 landed (PR #9413) these same two exits — a DISABLED flow (the
 * ruling's 409) and one with NO START NODE (the ruling's 422) — were pinned as
 * **unchanged at 200**, because the engine could not yet say which was which:
 * `AutomationResult.code` was a closed union of resume-refusal members with no
 * honest home for either, and the maintainer ruling on #9384 (2026-08-17) keeps
 * the union closed, routing any new member to the spec seat rather than letting
 * a call site mint one. The pins carried their own flip condition: *"When the
 * union question is ruled, these two assertions are the ones that flip."*
 *
 * **#9415 is that ruling delivered.** It widened the union with
 * `'FLOW_DISABLED'` and `'FLOW_NO_START_NODE'` — a deliberate widening with
 * measured need — the engine stamps them on the two exits, and the route reads
 * them. So the assertions below now pin **409** and **422**, completing all
 * four rows of the #9378 table.
 *
 * ## What is still load-bearing after the flip
 *
 * The reason these exits were worth pinning in the first place is unchanged and
 * is now asserted more sharply, not less: the route must classify off the
 * PRODUCER's verdict and nothing else. Both exits carry `success: false`
 * exactly like the ran-and-failed one, so
 *
 *  - an exit carrying a `code` is answered by that code — even when it also
 *    carries the incidental `summary` / `durationMs` of a failed run, and
 *  - an exit carrying NO classification at all stays 200, even when it carries
 *    those same incidental fields.
 *
 * Both directions are below. Together they say the arms read `code`, and only
 * `code` — the message text and the shape are never consulted (PD #12).
 */
describe('#9415 — the ruling\'s remaining two rows: never-dispatched exits answer 409 / 422', () => {
    for (const route of ROUTES) {
        for (const [label, result, status, code] of [
            [
                'a disabled flow',
                { success: false, code: 'FLOW_DISABLED', error: "Flow 'welcome_flow' is disabled" },
                409,
                'FLOW_DISABLED',
            ],
            [
                'a flow with no start node',
                { success: false, code: 'FLOW_NO_START_NODE', error: 'Flow has no start node' },
                422,
                'FLOW_NO_START_NODE',
            ],
        ] as Array<[string, AutomationResult, number, string]>) {
            it(`${route.label}: ${label} answers ${status} ${code}`, async () => {
                const { dispatcher } = makeDispatcher({ result });

                const r = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);

                expect(r.response?.status).toBe(status);
                // The ADR-0112 envelope, asserted whole: a rejection test that
                // only checked the status would stay green if the code drifted
                // to a spelling no ledger knows, and the SDK branches on `code`.
                expect(r.response?.body?.error?.code).toBe(code);
                expect(r.response?.body?.error?.httpStatus).toBe(status);
                // The engine's own words survive — an operator needs to know
                // WHICH flow was refused.
                expect(r.response?.body?.error?.message).toBe(result.error);
                // Never a failed RUN: nothing dispatched, so `FLOW_FAILED`
                // would be a false statement about what happened.
                expect(r.response?.body?.error?.code).not.toBe('FLOW_FAILED');
                // The double envelope is GONE, not re-labelled — same bar the
                // 400 arm is held to.
                expect(r.response?.body?.data).toBeUndefined();
                expect(r.response?.body?.success).toBe(false);
            });
        }

        it(`${route.label}: the two refusals are not collapsed into one status`, async () => {
            // The distinction is the whole point of two members: a disabled
            // flow is reversible operational state (flip the switch and the
            // identical request succeeds), a start-node-less flow is an
            // authoring defect no retry fixes. A mapper that answered both the
            // same way would pass every assertion above if they shared a status.
            const { dispatcher } = makeDispatcher({
                result: { success: false, code: 'FLOW_DISABLED', error: 'x' },
            });
            const { dispatcher: other } = makeDispatcher({
                result: { success: false, code: 'FLOW_NO_START_NODE', error: 'x' },
            });

            const a = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);
            const b = await other.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);

            expect(a.response?.status).not.toBe(b.response?.status);
            expect([a.response?.status, b.response?.status]).toEqual([409, 422]);
        });

        it(`${route.label}: classifies off \`code\`, never off \`summary\` / \`durationMs\``, async () => {
            // A refused dispatch carrying the incidental fields of a failed run
            // is still a refused dispatch. If the arms sniffed shape instead of
            // reading the producer's verdict, this would answer 400.
            const { dispatcher } = makeDispatcher({
                result: {
                    success: false,
                    code: 'FLOW_DISABLED',
                    error: "Flow 'welcome_flow' is disabled",
                    durationMs: 45,
                    summary: RAN_AND_FAILED.summary,
                },
            });

            const r = await dispatcher.handleAutomation(route.path('welcome_flow'), 'POST', {}, CTX);

            expect(r.response?.status).toBe(409);
            expect(r.response?.body?.error?.code).toBe('FLOW_DISABLED');
        });

        it(`${route.label}: an UNCLASSIFIED never-dispatched exit still stays 200`, async () => {
            // The other direction, and the half that survives from #9413's
            // original pin: the route never PROMOTES an exit it was not told
            // about. A producer that refuses a dispatch without saying so gets
            // today's 200 — visibly unclassified — rather than a status the
            // transport guessed from `summary` / `durationMs` (PD #12, and the
            // shape #8684 deliberately did not reproduce on the resume route).
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
            expect(r.response?.body?.error?.code).not.toBe('FLOW_FAILED');
            expect(r.response?.body?.data?.success).toBe(false);
        });
    }
});
