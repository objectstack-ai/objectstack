// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13953 — the two operator run-lifecycle verbs get a door, and the door is
 * fail-closed on every axis the contract cannot close on its own.
 *
 * `AutomationEngine` has carried `cancelRun` (ADR-0044) and
 * `restoreConsumedSuspension` (#13909) for as long as either has existed, and
 * until #16563 declared them on `IAutomationService` neither was reachable by
 * an operator at all: no REST route, no CLI command, not on the contract. A
 * deployment operator holding only HTTP could not cancel a suspended run, and
 * could not repair a run a failed resume had stranded — the verb the platform's
 * own `'stranded'` status names as the exit.
 *
 * Maintainer ruling, 2026-09-05 (option A): both are *"platform-operator verbs
 * gated on the existing `platform_admin` position (no new permission type, no
 * per-run ownership — a run belongs to the environment, not a user)"*.
 *
 * This file pins the five claims the door rests on. Each is a decision recorded
 * on `domains/automation.ts`, and an untested decision is a comment.
 *
 *  1. **THE GATE** — the ADR-0095 posture RUNG, unconditionally, on both doors.
 *     Including the #15981 direction: a `positions[]` entry SPELLING the
 *     built-in is not the authority, because `sys_user_position` is `apiEnabled`
 *     with unconstrained values and a tenant can mint that row.
 *  2. **AT LEAST AS STRICT AS `resume`** — the card's hard floor. The same
 *     caller `resume` lets through to the service is refused here, and nothing
 *     existing was relaxed to make the door usable.
 *  3. **ABSENT-MEMBER FAIL-CLOSED** — both members are OPTIONAL on the
 *     contract, so probing for presence is this half's job: a service not
 *     declaring the verb must produce the refusal envelope, ⛔ never a 200 and
 *     ⛔ never the `{ handled: false }` fall-through. The whole fail-closed
 *     promise rests on this one.
 *  4. **UNKNOWN REFUSAL CODES FAIL CLOSED** — the contract types the restore
 *     refusal as `refusal?: string`, a covariant widening of the engine's
 *     closed eight-member union, so the status mapping is a NON-EXHAUSTIVE
 *     string switch. An unrecognised code answers 500, ⛔ not a 409 (which
 *     would claim a diagnosis this door did not make) and ⛔ not a 200.
 *  5. **NO ONCE-ONLY SIDE EFFECT KEYS OFF `cancelRun`'s RETURN** — the engine
 *     has no cancel-side compare-and-set, so two overlapping cancels each
 *     answer `true` and each record the terminal log. A notification or audit
 *     entry fired on `true` would fire twice; this door fires none, and says so
 *     on the wire.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

/** A refusal the engine's own vocabulary names, as the contract shapes it. */
interface RestoreResult {
    restored: boolean;
    runId: string;
    refusal?: string;
    reason: string;
}

interface Harness {
    dispatcher: HttpDispatcher;
    cancelRun: ReturnType<typeof vi.fn>;
    restoreConsumedSuspension: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    /** Every kernel event the request fired — the side-effect channel `deps.announceKernelEvent` uses. */
    kernelEvents: Array<{ event: string; payload: unknown }>;
}

interface HarnessOptions {
    /** What `cancelRun` answers; omit the member entirely with `'absent'`. */
    cancel?: boolean | 'absent';
    /** What `restoreConsumedSuspension` answers; omit the member with `'absent'`. */
    restore?: RestoreResult | 'absent';
}

function makeDispatcher(options: HarnessOptions = {}): Harness {
    const kernelEvents: Array<{ event: string; payload: unknown }> = [];
    const cancelRun = vi.fn(async () => (options.cancel === 'absent' ? false : options.cancel ?? true));
    const restoreConsumedSuspension = vi.fn(async () => (
        options.restore === 'absent' || options.restore === undefined
            ? { restored: true, runId: 'run_7', reason: 'Suspension restored.' }
            : options.restore
    ));
    const resume = vi.fn(async () => ({ success: true, runId: 'run_7' }));
    const execute = vi.fn(async () => ({ success: true, runId: 'run_9' }));

    const automation: Record<string, unknown> = {
        handlerReady: true,
        resume,
        execute,
        listFlows: async () => ['approval_flow'],
        getFlow: async (name: string) => ({ name, nodes: [] }),
    };
    if (options.cancel !== 'absent') automation.cancelRun = cancelRun;
    if (options.restore !== 'absent') automation.restoreConsumedSuspension = restoreConsumedSuspension;

    const services: Record<string, unknown> = { automation };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: {
            getService: resolve,
            trigger: async (event: string, payload: unknown) => { kernelEvents.push({ event, payload }); },
        },
    };
    return {
        dispatcher: new HttpDispatcher(kernel as never),
        cancelRun,
        restoreConsumedSuspension,
        resume,
        execute,
        kernelEvents,
    };
}

/** The platform operator — the ADR-0095 D2/D3 rung, derived from the unscoped `admin_full_access` grant. */
const OPERATOR_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'usr_operator', posture: 'PLATFORM_ADMIN' } } as HttpProtocolContext);

/** An ordinary authenticated caller. */
const USER_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'user_1', positions: ['sales_rep'] } } as HttpProtocolContext);

/** A tenant administrator — a rung, and the wrong one. */
const TENANT_ADMIN_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'user_2', posture: 'TENANT_ADMIN' } } as HttpProtocolContext);

/**
 * #15981's caller: a tenant that MINTED a `sys_user_position` row spelling the
 * built-in. `positions[]` carries it; the rung does not.
 */
const MINTED_POSITION_CTX = (): HttpProtocolContext =>
    ({
        request: {},
        executionContext: { userId: 'user_3', positions: ['platform_admin'], posture: 'TENANT_ADMIN' },
    } as HttpProtocolContext);

/** Platform-internal invocation — the bypass every gate in this family carries. */
const SYSTEM_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'usr_system', isSystem: true } } as HttpProtocolContext);

const CANCEL_PATH = 'approval_flow/runs/run_7/cancel';
const RESTORE_PATH = 'approval_flow/runs/run_7/restore-suspension';

const statusOf = (response: unknown): unknown => (response as any)?.status;
const payloadOf = (response: unknown): any => {
    const r = response as any;
    return r?.data ?? r?.body?.data ?? r;
};
const codeOf = (response: unknown): unknown => {
    const r = response as any;
    return r?.body?.error?.code ?? r?.body?.error?.details?.code;
};
const messageOf = (response: unknown): string => String((response as any)?.body?.error?.message ?? '');
const detailsOf = (response: unknown): any => (response as any)?.body?.error?.details;

describe('#13953 — the run-lifecycle doors require the platform operator', () => {
    describe('the gate', () => {
        for (const [label, ctx] of [
            ['an ordinary authenticated caller', USER_CTX],
            ['a tenant administrator', TENANT_ADMIN_CTX],
            ['a caller holding a MINTED `platform_admin` position but not the rung (#15981)', MINTED_POSITION_CTX],
        ] as const) {
            it(`refuses cancel for ${label} with PERMISSION_DENIED + 403, and never calls the verb`, async () => {
                const h = makeDispatcher();
                const { response } = await h.dispatcher.handleAutomation(
                    CANCEL_PATH, 'POST', undefined, ctx(), undefined,
                );

                // ADR-0112 asserts BOTH halves: a 403 carrying a derived code,
                // or a PERMISSION_DENIED riding a 200, each satisfy half.
                expect(codeOf(response)).toBe('PERMISSION_DENIED');
                expect(statusOf(response)).toBe(403);
                // The gate fires ahead of the service, so nothing was cancelled
                // before the refusal — "cancel first, refuse second" is the
                // worst shape a run-lifecycle door can have.
                expect(h.cancelRun).not.toHaveBeenCalled();
            });

            it(`refuses restore-suspension for ${label} the same way`, async () => {
                const h = makeDispatcher();
                const { response } = await h.dispatcher.handleAutomation(
                    RESTORE_PATH, 'POST', undefined, ctx(), undefined,
                );

                expect(codeOf(response)).toBe('PERMISSION_DENIED');
                expect(statusOf(response)).toBe(403);
                expect(h.restoreConsumedSuspension).not.toHaveBeenCalled();
            });
        }

        it('admits the ADR-0095 PLATFORM_ADMIN rung on both doors', async () => {
            const h = makeDispatcher();
            const cancel = await h.dispatcher.handleAutomation(CANCEL_PATH, 'POST', undefined, OPERATOR_CTX(), undefined);
            const restore = await h.dispatcher.handleAutomation(RESTORE_PATH, 'POST', undefined, OPERATOR_CTX(), undefined);

            expect(statusOf(cancel.response)).toBe(200);
            expect(statusOf(restore.response)).toBe(200);
            expect(h.cancelRun).toHaveBeenCalledTimes(1);
            expect(h.restoreConsumedSuspension).toHaveBeenCalledTimes(1);
        });

        it('admits engine self-invocation (`isSystem`) — plugin-approvals\' in-process recall keeps working', async () => {
            const h = makeDispatcher();
            const { response } = await h.dispatcher.handleAutomation(
                CANCEL_PATH, 'POST', undefined, SYSTEM_CTX(), undefined,
            );
            expect(statusOf(response)).toBe(200);
            expect(h.cancelRun).toHaveBeenCalledTimes(1);
        });

        it('is UNCONDITIONAL — an authenticated caller with no posture at all is refused, not admitted', async () => {
            // ⛔ The direction that matters. The ADR-0126 §5 activation gate
            // falls open when it cannot read a posture, correctly, because a
            // `manage_metadata` tier still stands in front of it. This door has
            // no tier in front of it, so falling open would leave an operator
            // verb open to any authenticated caller.
            const h = makeDispatcher();
            const noPosture = { request: {}, executionContext: { userId: 'user_4' } } as HttpProtocolContext;
            const { response } = await h.dispatcher.handleAutomation(CANCEL_PATH, 'POST', undefined, noPosture, undefined);

            expect(statusOf(response)).toBe(403);
            expect(h.cancelRun).not.toHaveBeenCalled();
        });

        it('does not answer the caller\'s authorization topology in the refusal (#7450)', async () => {
            const h = makeDispatcher();
            const { response } = await h.dispatcher.handleAutomation(
                CANCEL_PATH, 'POST', undefined, MINTED_POSITION_CTX(), undefined,
            );
            const message = messageOf(response);

            // It names the standing that would admit ANY caller, and the
            // sanctioned path a refused one does have.
            expect(message).toMatch(/platform-operator standing/);
            expect(message).toMatch(/resume/);
            // …and nothing about THIS caller.
            expect(message).not.toMatch(/user_3/);
            expect(message).not.toMatch(/sales_rep/);
            expect(message).not.toMatch(/TENANT_ADMIN/);
        });

        it('leaves the legacy execution door alone — `POST /automation/trigger/:name` for a flow named `runs`', async () => {
            // The gate excludes `parts[0] === 'trigger'`, exactly as the toggle
            // (#10243) and clone (#12156) arms do, and BOTH route arms repeat
            // the exclusion so gate and route cannot drift. Over-blocking an
            // execution door is the one thing the #10243 ruling did not do.
            const h = makeDispatcher();
            const { response } = await h.dispatcher.handleAutomation(
                'trigger/runs/run_7/cancel', 'POST', undefined, USER_CTX(), undefined,
            );

            expect(statusOf(response)).not.toBe(403);
            expect(h.execute).toHaveBeenCalledTimes(1);
            expect(h.cancelRun).not.toHaveBeenCalled();
        });
    });

    describe('at least as strict as `resume` — the card\'s hard floor', () => {
        it('the same caller `resume` forwards to the service is refused at both lifecycle doors', async () => {
            // `resume` has no route-level gate: it is fail-closed in the ENGINE
            // on the suspended node's declared `resumeAuthority` (#3801/#5561),
            // so an ordinary caller reaches the service and the engine decides.
            // These doors refuse the same caller before the service is even
            // resolved — strictly narrower, and nothing existing was relaxed to
            // build them.
            const h = makeDispatcher();
            const resumed = await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7/resume', 'POST', undefined, USER_CTX(), undefined,
            );
            expect(h.resume).toHaveBeenCalledTimes(1);
            expect(statusOf(resumed.response)).toBe(200);

            for (const path of [CANCEL_PATH, RESTORE_PATH]) {
                const { response } = await h.dispatcher.handleAutomation(path, 'POST', undefined, USER_CTX(), undefined);
                expect(statusOf(response), path).toBe(403);
            }
            expect(h.cancelRun).not.toHaveBeenCalled();
            expect(h.restoreConsumedSuspension).not.toHaveBeenCalled();
        });
    });

    describe('absent member — fail-closed, ⛔ never a 200', () => {
        it('a service not declaring `cancelRun` answers 501 NOT_IMPLEMENTED, and cancels nothing', async () => {
            const h = makeDispatcher({ cancel: 'absent' });
            const { handled, response } = await h.dispatcher.handleAutomation(
                CANCEL_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
            );

            expect(statusOf(response)).toBe(501);
            expect(codeOf(response)).toBe('NOT_IMPLEMENTED');
            // ⛔ Never the `{ handled: false }` fall-through, which the
            // dispatcher renders as 404 ROUTE_NOT_FOUND with a discovery hint —
            // both halves false here, and an operator reads a routing bug that
            // does not exist.
            expect(handled).toBe(true);
            // ⛔ And never a success envelope carrying a lifecycle verdict for a
            // verb that was never dispatched.
            expect(statusOf(response)).not.toBe(200);
            expect(payloadOf(response)?.cancelled).toBeUndefined();
            expect(messageOf(response)).toMatch(/cancelRun/);
        });

        it('a service not declaring `restoreConsumedSuspension` answers 501 the same way', async () => {
            const h = makeDispatcher({ restore: 'absent' });
            const { handled, response } = await h.dispatcher.handleAutomation(
                RESTORE_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
            );

            expect(statusOf(response)).toBe(501);
            expect(codeOf(response)).toBe('NOT_IMPLEMENTED');
            expect(handled).toBe(true);
            expect(statusOf(response)).not.toBe(200);
            expect(payloadOf(response)?.restored).toBeUndefined();
            expect(messageOf(response)).toMatch(/restoreConsumedSuspension/);
        });

        it('the absent-member refusal is reached only AFTER the permission gate', async () => {
            // A caller without the rung must not be able to fingerprint which
            // members this deployment's automation service implements.
            const h = makeDispatcher({ cancel: 'absent', restore: 'absent' });
            for (const path of [CANCEL_PATH, RESTORE_PATH]) {
                const { response } = await h.dispatcher.handleAutomation(path, 'POST', undefined, USER_CTX(), undefined);
                expect(statusOf(response), path).toBe(403);
            }
        });
    });

    describe('restore refusals — every code answered as a refusal, unknown ones fail closed', () => {
        const KNOWN: ReadonlyArray<readonly [string, number]> = [
            ['RUN_NOT_FOUND', 404],
            ['STORE_UNAVAILABLE', 503],
            ['RESUME_IN_PROGRESS', 409],
            ['RESTORE_IN_PROGRESS', 409],
            ['RUN_SUSPENDED', 409],
            ['RUN_COMPLETED', 409],
            ['RUN_CANCELLED', 409],
            ['NO_CONSUMED_SUSPENSION', 409],
        ];

        for (const [refusal, status] of KNOWN) {
            it(`maps ${refusal} → ${status}, relaying the engine's own sentence`, async () => {
                const h = makeDispatcher({
                    restore: { restored: false, runId: 'run_7', refusal, reason: `Observed: ${refusal}.` },
                });
                const { response } = await h.dispatcher.handleAutomation(
                    RESTORE_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
                );

                expect(statusOf(response)).toBe(status);
                expect(messageOf(response)).toBe(`Observed: ${refusal}.`);
                expect(detailsOf(response)?.refusal).toBe(refusal);
                expect(detailsOf(response)?.restored).toBe(false);
                // ⛔ Never a 200 carrying `restored: false`, which reads as
                // "your repair ran and the run did not come back".
                expect(statusOf(response)).not.toBe(200);
            });
        }

        it('an UNRECOGNISED refusal code answers 500 — ⛔ not a 409, ⛔ not a 200', async () => {
            // The contract types `refusal` as `string`, a covariant widening of
            // the engine's closed union, so this switch is non-exhaustive BY
            // CONSTRUCTION. A 409 would claim a diagnosis this door did not
            // make ("the run's state refuses this; retrying will not help").
            const h = makeDispatcher({
                restore: {
                    restored: false,
                    runId: 'run_7',
                    refusal: 'SOME_FUTURE_REFUSAL',
                    reason: 'A newer implementation refused for a reason of its own.',
                },
            });
            const { response } = await h.dispatcher.handleAutomation(
                RESTORE_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
            );

            expect(statusOf(response)).toBe(500);
            expect(statusOf(response)).not.toBe(409);
            expect(detailsOf(response)?.refusal).toBe('SOME_FUTURE_REFUSAL');
        });

        it('a `restored: false` carrying NO refusal code fails closed too', async () => {
            const h = makeDispatcher({
                restore: { restored: false, runId: 'run_7', reason: 'Refused.' } as RestoreResult,
            });
            const { response } = await h.dispatcher.handleAutomation(
                RESTORE_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
            );
            expect(statusOf(response)).toBe(500);
        });

        it('a malformed result — not an object at all — fails closed rather than reading as success', async () => {
            const h = makeDispatcher({ restore: undefined as unknown as RestoreResult });
            h.restoreConsumedSuspension.mockResolvedValue(undefined as never);
            const { response } = await h.dispatcher.handleAutomation(
                RESTORE_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
            );
            expect(statusOf(response)).toBe(500);
            expect(messageOf(response)).toMatch(/Nothing has been established/);
        });

        it('⛔ never promotes an engine refusal code into ADR-0112\'s closed `error.code`', async () => {
            // `details.code` is PROMOTED into `error.code`, which ADR-0112
            // closes to `StandardErrorCode` ∪ the registered ledger — and none
            // of the engine's eight are members. The code rides
            // `details.refusal` instead and `error.code` derives from the
            // status.
            const h = makeDispatcher({
                restore: { restored: false, runId: 'run_7', refusal: 'RUN_COMPLETED', reason: 'The run finished.' },
            });
            const { response } = await h.dispatcher.handleAutomation(
                RESTORE_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
            );
            expect(codeOf(response)).not.toBe('RUN_COMPLETED');
            expect(codeOf(response)).toBe('RESOURCE_CONFLICT');
        });

        it('a successful restore answers 200 with the run id this door was ASKED about', async () => {
            const h = makeDispatcher({
                restore: { restored: true, runId: 'a-different-id', reason: 'Suspension restored at node `stage1`.' },
            });
            const { response } = await h.dispatcher.handleAutomation(
                RESTORE_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
            );

            expect(statusOf(response)).toBe(200);
            expect(payloadOf(response)).toEqual({
                runId: 'run_7',
                restored: true,
                reason: 'Suspension restored at node `stage1`.',
            });
        });
    });

    describe('who asked, and why', () => {
        it('fills `requestedBy` from the AUTHENTICATED CALLER, never from the body', async () => {
            const h = makeDispatcher();
            await h.dispatcher.handleAutomation(
                RESTORE_PATH, 'POST', { reason: 'Storage outage recovered; re-arming.' }, OPERATOR_CTX(), undefined,
            );

            expect(h.restoreConsumedSuspension).toHaveBeenCalledWith('run_7', {
                requestedBy: 'usr_operator',
                reason: 'Storage outage recovered; re-arming.',
            });
        });

        it('refuses a wire-supplied `requestedBy` BY NAME rather than dropping it silently', async () => {
            const h = makeDispatcher();
            const { response } = await h.dispatcher.handleAutomation(
                RESTORE_PATH, 'POST', { requestedBy: 'somebody_else' }, OPERATOR_CTX(), undefined,
            );

            expect(statusOf(response)).not.toBe(200);
            expect(messageOf(response)).toMatch(/requestedBy/);
            expect(messageOf(response)).toMatch(/not settable from the wire/);
            expect(h.restoreConsumedSuspension).not.toHaveBeenCalled();
        });

        it('omits `requestedBy` entirely when the caller carries no user id', async () => {
            const h = makeDispatcher();
            await h.dispatcher.handleAutomation(
                RESTORE_PATH, 'POST', { reason: 'boot repair' },
                { request: {}, executionContext: { isSystem: true } } as HttpProtocolContext, undefined,
            );
            expect(h.restoreConsumedSuspension).toHaveBeenCalledWith('run_7', { reason: 'boot repair' });
        });

        it('relays the cancel `reason` VERBATIM — the contract calls it the operator\'s own words', async () => {
            const h = makeDispatcher();
            await h.dispatcher.handleAutomation(
                CANCEL_PATH, 'POST', { reason: 'Submitter withdrew the request.' }, OPERATOR_CTX(), undefined,
            );
            expect(h.cancelRun).toHaveBeenCalledWith('run_7', 'Submitter withdrew the request.');
        });

        it('closes the body envelope on both doors', async () => {
            const h = makeDispatcher();
            for (const path of [CANCEL_PATH, RESTORE_PATH]) {
                const unknownKey = await h.dispatcher.handleAutomation(
                    path, 'POST', { resaon: 'typo' }, OPERATOR_CTX(), undefined,
                );
                expect(statusOf(unknownKey.response), path).not.toBe(200);
                expect(messageOf(unknownKey.response), path).toMatch(/resaon/);

                const wrongType = await h.dispatcher.handleAutomation(
                    path, 'POST', { reason: 42 }, OPERATOR_CTX(), undefined,
                );
                expect(statusOf(wrongType.response), path).not.toBe(200);

                const notAnObject = await h.dispatcher.handleAutomation(
                    path, 'POST', 'just a string', OPERATOR_CTX(), undefined,
                );
                expect(statusOf(notAnObject.response), path).not.toBe(200);
            }
            expect(h.cancelRun).not.toHaveBeenCalled();
            expect(h.restoreConsumedSuspension).not.toHaveBeenCalled();
        });

        it('accepts a bodyless call on both doors', async () => {
            const h = makeDispatcher();
            const cancel = await h.dispatcher.handleAutomation(CANCEL_PATH, 'POST', undefined, OPERATOR_CTX(), undefined);
            const restore = await h.dispatcher.handleAutomation(RESTORE_PATH, 'POST', undefined, OPERATOR_CTX(), undefined);
            expect(statusOf(cancel.response)).toBe(200);
            expect(statusOf(restore.response)).toBe(200);
            expect(h.cancelRun).toHaveBeenCalledWith('run_7', undefined);
            expect(h.restoreConsumedSuspension).toHaveBeenCalledWith('run_7', { requestedBy: 'usr_operator' });
        });
    });

    describe('⛔ no once-only side effect keys off `cancelRun`\'s return value', () => {
        it('two overlapping cancels each answering `true` produce two identical answers and NO side effect', async () => {
            // The engine has no cancel-side compare-and-set: `cancelRun` does a
            // `loadSuspendedRunStrict` then an unconditional delete-by-id, and
            // only `resume` passes the `claimAdvance` compare-and-set through
            // `forgetSuspendedRun`. So both cancels answer `true` and both
            // record the terminal log. A notification or audit entry fired on
            // `true` would fire TWICE — this door fires none.
            const h = makeDispatcher({ cancel: true });
            const first = await h.dispatcher.handleAutomation(CANCEL_PATH, 'POST', undefined, OPERATOR_CTX(), undefined);
            const second = await h.dispatcher.handleAutomation(CANCEL_PATH, 'POST', undefined, OPERATOR_CTX(), undefined);

            expect(h.cancelRun).toHaveBeenCalledTimes(2);
            // Byte-identical answers: nothing accumulated, nothing was
            // "already done".
            expect(payloadOf(second.response)).toEqual(payloadOf(first.response));
            // The side-effect channel this domain has — `deps.announceKernelEvent`,
            // which the packages domain uses to announce `metadata:reloaded` —
            // was never touched.
            expect(h.kernelEvents).toEqual([]);
        });

        it('the `true` answer SAYS it is not exclusive, so a caller does not build the side effect one tier up', async () => {
            const h = makeDispatcher({ cancel: true });
            const { response } = await h.dispatcher.handleAutomation(
                CANCEL_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
            );

            expect(statusOf(response)).toBe(200);
            expect(payloadOf(response).cancelled).toBe(true);
            expect(payloadOf(response).notice).toMatch(/not exclusive/);
            expect(payloadOf(response).notice).toMatch(/idempotency token/);
        });
    });

    describe('⛔ never a success that hides the condition (#13909\'s posture)', () => {
        it('`cancelled: false` is a 200 per the contract, but names BOTH readings', async () => {
            // The contract's `false` is "no suspended run under the id —
            // idempotent success". An UNREADABLE durable store lands on the
            // same `false`, and then the run may still be parked. Nothing above
            // the engine can tell them apart, so the door says so instead of
            // letting a bare `cancelled: false` read as a clean no-op.
            const h = makeDispatcher({ cancel: false });
            const { response } = await h.dispatcher.handleAutomation(
                CANCEL_PATH, 'POST', undefined, OPERATOR_CTX(), undefined,
            );

            expect(statusOf(response)).toBe(200);
            expect(payloadOf(response).cancelled).toBe(false);
            expect(payloadOf(response).notice).toMatch(/already terminal or unknown/);
            expect(payloadOf(response).notice).toMatch(/could not be\s+read/);
            expect(payloadOf(response).notice).toMatch(/may still be parked/);
        });

        it('the two `cancelled` arms carry DIFFERENT notices — the condition is never collapsed', async () => {
            const yes = makeDispatcher({ cancel: true });
            const no = makeDispatcher({ cancel: false });
            const a = await yes.dispatcher.handleAutomation(CANCEL_PATH, 'POST', undefined, OPERATOR_CTX(), undefined);
            const b = await no.dispatcher.handleAutomation(CANCEL_PATH, 'POST', undefined, OPERATOR_CTX(), undefined);
            expect(payloadOf(a.response).notice).not.toBe(payloadOf(b.response).notice);
        });
    });
});
