// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19987 — `POST /automation/:name/runs/:runId/resume` is gated to the run's
 * own trigger identity, OR the `sys_automation_run` read grant as an operator
 * override: the shape the maintainer ruled for the READ twin
 * (`GET /:name/runs/:runId/screen`, Option B), applied to the write.
 *
 * ## What was measured before the gate
 *
 * The arm validated the body's shape and closed key set and then called
 * `automationService.resume(runId, signal)`. It read no identity at all. So a
 * caller with valid auth and another user's run id — `u2` on a run whose
 * `getRun().trigger.userId` is `u1` — was answered 200 and `resume` ran. The
 * resumed run then continues under the context STORED on the run, so a
 * `runAs: 'user'` flow's downstream data nodes run as the user who started it,
 * with values the stranger submitted. The read twin on the same pause already
 * refused that stranger: one pause, two doors, two answers.
 *
 * ## The four rows the ruling names, plus the non-denials
 *
 *  1. stranger with valid auth + run id ⇒ denied (403 `PERMISSION_DENIED`,
 *     the read twin's code and status), and `resume` is NOT called;
 *  2. the triggering user ⇒ admitted, with NO grant at all (the over-block
 *     guard: gating on the grant alone refuses the user the flow paused for);
 *  3. a holder of `sys_automation_run` read ⇒ admitted (the operator override);
 *  4. a node-authorized non-starter ⇒ never refused by this gate. Measured:
 *     `resumeAuthority` is the closed enum `'any' | 'service'` and names no
 *     person. `'any'` (`screen`, `wait`, `map`, `subflow`) authorizes no
 *     specific caller, so the gate applies. `'service'` (`approval`,
 *     `approval_revise`, and every undeclared type) is refused by the ENGINE
 *     to every caller of this door, because the service marker is a symbol a
 *     JSON body cannot carry; an approver decides through `ApprovalService`,
 *     which resumes in process and never enters this handler. So no caller
 *     this door admitted before is a caller the node names, and the rows
 *     below pin that the node gate still answers, unchanged, behind this one.
 *
 * ## One predicate, two doors
 *
 * The read twin and this door ask ONE question (`automation.ts`,
 * `isRunStarterOrRunStateReader`). The parity table at the foot of this file
 * drives both doors with the same caller, run and security posture and
 * requires the same verdict from each.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { AUTOMATION_RUN_OBJECT } from './automation.js';

/** The run as the engine records it (`buildRunTrigger`): started by `u1`. */
const PAUSED_RUN = {
    id: 'run_1',
    flowName: 'flow_a',
    status: 'paused',
    trigger: { type: 'manual', userId: 'u1' },
    steps: [{ nodeId: 'ask', nodeType: 'screen', status: 'paused' }],
} as const;

/** The screen the run is parked on, for the read-twin parity rows. */
const SCREEN = { nodeId: 'ask', title: 'Confirm', fields: [{ name: 'note', type: 'text', required: false }] };

const RESUME_PATH = 'flow_a/runs/run_1/resume';
const SCREEN_PATH = 'flow_a/runs/run_1/screen';

/** The requirement both refusals state, word for word. */
const REQUIREMENT = `requires being the identity that triggered the run, or read access to '${AUTOMATION_RUN_OBJECT}'.`;

/** One `explain` call, as the gate makes it. */
interface ExplainCall {
    request: { object: string; operation: string; userId?: string };
    context: unknown;
}

interface Harness {
    dispatcher: HttpDispatcher;
    getRun: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    explainCalls: ExplainCall[];
}

interface Options {
    /** What `getRun` answers — `null` is "no such run". */
    run?: unknown;
    /** Omit `getRun`: a service that cannot say who triggered a run. */
    withoutGetRun?: boolean;
    /** What `resume` answers. */
    result?: unknown;
}

/**
 * `security` is the deployment's security posture: `'granting'` / `'refusing'`
 * are a service that answers, `'throwing'` one whose answer cannot be
 * computed, `'partial'` one that omits `explain`, `'absent'` a deployment with
 * no `plugin-security` at all.
 */
function makeDispatcher(
    security: 'granting' | 'refusing' | 'throwing' | 'partial' | 'absent',
    options: Options = {},
): Harness {
    const explainCalls: ExplainCall[] = [];
    const getRun = vi.fn(async () => ('run' in options ? options.run : PAUSED_RUN) as unknown);
    const resume = vi.fn(async () => ('result' in options ? options.result : { success: true, status: 'completed' }) as unknown);

    const explain = async (
        request: ExplainCall['request'],
        context: unknown,
    ): Promise<{ allowed: boolean; object: string; operation: string }> => {
        explainCalls.push({ request, context });
        if (security === 'throwing') throw new Error('permission subsystem unavailable');
        return { allowed: security === 'granting', object: request.object, operation: request.operation };
    };

    const automation: Record<string, unknown> = {
        handlerReady: true,
        resume,
        getSuspendedScreen: async () => SCREEN,
        getFlow: async (name: string) => ({ name, nodes: [] }),
    };
    if (!options.withoutGetRun) automation.getRun = getRun;

    const services: Record<string, unknown> = { automation };
    if (security === 'partial') {
        services.security = { getReadableFields: async () => undefined };
    } else if (security !== 'absent') {
        services.security = { explain };
    }

    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), getRun, resume, explainCalls };
}

/** The run's own starter — `PAUSED_RUN.trigger.userId`. */
const STARTER = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'u1', positions: ['sales_rep'] } } as HttpProtocolContext);

/** The card's caller: valid auth, another user's run id. */
const STRANGER = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'u2', positions: ['intern'] } } as HttpProtocolContext);

/** A platform-internal caller. */
const SYSTEM_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'usr_system', isSystem: true } } as HttpProtocolContext);

/** The semantic error code, from wherever the envelope parks it. */
const codeOf = (response: unknown): unknown => {
    const r = response as any;
    return r?.body?.error?.code ?? r?.body?.error?.details?.code;
};
const statusOf = (response: unknown): unknown => (response as any)?.status;
const messageOf = (response: unknown): unknown => (response as any)?.body?.error?.message;
const textOf = (response: unknown): string => JSON.stringify((response as any)?.body ?? response);

const resumeAs = (h: Harness, ctx: HttpProtocolContext, body: unknown = { inputs: { note: 'from caller' } }, path = RESUME_PATH) =>
    h.dispatcher.handleAutomation(path, 'POST', body, ctx, undefined);

describe('#19987 — the resume door admits the run\'s starter, or the run-state grant', () => {
    describe('row 1 — stranger with valid auth + run id ⇒ denied', () => {
        it('refuses with PERMISSION_DENIED AND 403 (ADR-0112, both halves), and resume is NOT called', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await resumeAs(h, STRANGER());

            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect(statusOf(response)).toBe(403);
            // The half that makes it a security fix: nothing reached the
            // engine, so the pause is not consumed and no data node ran under
            // the starter's stored context.
            expect(h.resume).not.toHaveBeenCalled();
        });

        it('states the read twin\'s requirement word for word, under this door\'s own verb', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await resumeAs(h, STRANGER());

            expect(messageOf(response)).toBe(`Resuming a paused run ${REQUIREMENT}`);
        });

        it('answers nothing about the caller\'s authorization topology (#7450)', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await resumeAs(h, STRANGER());

            const body = textOf(response);
            expect(body).not.toContain('intern');
            expect(body).not.toContain('u2');
            // It names what would admit a caller, both halves, and not whose
            // run it is.
            expect(body).not.toContain('u1');
            expect(body).toContain(AUTOMATION_RUN_OBJECT);
            expect(body).toContain('triggered the run');
        });

        it('refuses a run whose trigger carries NO userId rather than matching on absence', async () => {
            // A schedule-triggered run records no `trigger.userId`. A check
            // written as `run.trigger?.userId === ec.userId` over two
            // undefineds would admit everyone on exactly these runs.
            const h = makeDispatcher('refusing', { run: { ...PAUSED_RUN, trigger: { type: 'schedule' } } });
            const { response } = await resumeAs(h, STRANGER());

            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect(statusOf(response)).toBe(403);
            expect(h.resume).not.toHaveBeenCalled();
        });

        it('fails CLOSED on a run the service cannot resolve — an unresolved identity is not a match', async () => {
            // `getRun` answers null for an unknown id, and ALSO for a run that
            // is parked and resumable when its durable read degrades (the
            // engine logs that and returns null) or when the in-memory ring
            // evicted its entry with no store configured. A gate that let a
            // null through to `resume` would be open in exactly those states.
            const h = makeDispatcher('refusing', { run: null });
            const { response } = await resumeAs(h, STRANGER());

            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect(statusOf(response)).toBe(403);
            expect(h.resume).not.toHaveBeenCalled();
        });

        it('treats a getRun THROW as unresolved, even for the real starter', async () => {
            const h = makeDispatcher('refusing');
            h.getRun.mockRejectedValueOnce(new Error('run store unreachable'));
            const { response } = await resumeAs(h, STARTER());

            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect(statusOf(response)).toBe(403);
            expect(h.resume).not.toHaveBeenCalled();
        });

        it('refuses on a service that cannot say who triggered a run, unless the grant admits', async () => {
            const denied = makeDispatcher('refusing', { withoutGetRun: true });
            const refusal = await resumeAs(denied, STARTER());
            expect(codeOf(refusal.response)).toBe('PERMISSION_DENIED');
            expect(statusOf(refusal.response)).toBe(403);
            expect(denied.resume).not.toHaveBeenCalled();

            const granted = makeDispatcher('granting', { withoutGetRun: true });
            const admitted = await resumeAs(granted, STRANGER());
            expect(statusOf(admitted.response)).toBe(200);
            expect(granted.resume).toHaveBeenCalledTimes(1);
        });

        it('still refuses the stranger while the permission subsystem is DOWN', async () => {
            const h = makeDispatcher('throwing');
            const { response } = await resumeAs(h, STRANGER());

            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect(statusOf(response)).toBe(403);
            expect(h.resume).not.toHaveBeenCalled();
        });
    });

    describe('row 2 — the triggering user is admitted (the OVER-BLOCK guard)', () => {
        it('resumes for the starter with NO grant at all, forwarding the signal field by field', async () => {
            // `'refusing'` is load-bearing: this caller is refused the grant
            // exactly like the stranger. Gate on the grant alone and this case
            // goes red while every denial case stays green.
            const h = makeDispatcher('refusing');
            const { response } = await resumeAs(h, STARTER());

            expect(statusOf(response)).toBe(200);
            expect(h.resume).toHaveBeenCalledTimes(1);
            expect(h.resume).toHaveBeenCalledWith('run_1', { variables: { note: 'from caller' } });
        });

        it('reads the identity off THIS run, and does not consult the grant once it matches', async () => {
            const h = makeDispatcher('refusing');
            await resumeAs(h, STARTER());

            expect(h.getRun).toHaveBeenCalledWith('run_1');
            expect(h.explainCalls).toHaveLength(0);
        });

        it('still admits the starter when the permission subsystem is DOWN', async () => {
            const h = makeDispatcher('throwing');
            const { response } = await resumeAs(h, STARTER());

            expect(statusOf(response)).toBe(200);
            expect(h.resume).toHaveBeenCalledTimes(1);
        });
    });

    describe('row 3 — a holder of the `sys_automation_run` read grant is admitted', () => {
        it('resumes for an operator who did NOT start the run', async () => {
            const h = makeDispatcher('granting');
            const { response } = await resumeAs(h, STRANGER());

            expect(statusOf(response)).toBe(200);
            expect(h.resume).toHaveBeenCalledTimes(1);
        });

        it('asks for `read` on sys_automation_run with the caller\'s own context — the #7900 question', async () => {
            const h = makeDispatcher('granting');
            await resumeAs(h, STRANGER());

            expect(h.explainCalls).toHaveLength(1);
            expect(h.explainCalls[0]!.request.object).toBe(AUTOMATION_RUN_OBJECT);
            expect(h.explainCalls[0]!.request.operation).toBe('read');
            expect(h.explainCalls[0]!.request.userId).toBeUndefined();
            expect(h.explainCalls[0]!.context).toMatchObject({ userId: 'u2' });
        });
    });

    describe('row 4 — the node gate still answers behind this one, unchanged', () => {
        it('an admitted starter on a service-owned pause still gets the ENGINE\'s own 403, word for word', async () => {
            // `resumeAuthority: 'service'` (an approval) is the engine's
            // refusal, not this gate's: the starter passes this gate and the
            // engine answers exactly what it answered before.
            const engineRefusal = "Run 'run_1' is paused at an 'approval' node, which only its owning service may resume";
            const h = makeDispatcher('refusing', {
                result: { success: false, code: 'PERMISSION_DENIED', error: engineRefusal },
            });
            const { response } = await resumeAs(h, STARTER(), { branchLabel: 'approve' });

            expect(h.resume).toHaveBeenCalledTimes(1);
            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect(statusOf(response)).toBe(403);
            expect(messageOf(response)).toBe(engineRefusal);
        });

        it('lets a SYSTEM context through without asking anything', async () => {
            const h = makeDispatcher('refusing', { run: null });
            const { response } = await resumeAs(h, SYSTEM_CTX());

            expect(statusOf(response)).toBe(200);
            expect(h.resume).toHaveBeenCalledTimes(1);
            expect(h.getRun).not.toHaveBeenCalled();
            expect(h.explainCalls).toHaveLength(0);
        });
    });

    describe('the answers that do not move for a caller the gate admits', () => {
        it('the starter on a FINISHED run still gets the engine\'s own 404 RUN_NOT_FOUND answer', async () => {
            const notFound = "No suspended run 'run_1'";
            const h = makeDispatcher('refusing', {
                run: { ...PAUSED_RUN, status: 'completed' },
                result: { success: false, code: 'RUN_NOT_FOUND', error: notFound },
            });
            const { response } = await resumeAs(h, STARTER());

            expect(h.resume).toHaveBeenCalledTimes(1);
            expect(statusOf(response)).toBe(404);
            expect(messageOf(response)).toBe(notFound);
        });

        it('a grant holder on an UNKNOWN run id still gets the engine\'s own 404', async () => {
            const notFound = "No suspended run 'run_missing'";
            const h = makeDispatcher('granting', {
                run: null,
                result: { success: false, code: 'RUN_NOT_FOUND', error: notFound },
            });
            const { response } = await resumeAs(h, STRANGER(), { inputs: {} }, 'flow_a/runs/run_missing/resume');

            expect(h.resume).toHaveBeenCalledWith('run_missing', { variables: {} });
            expect(statusOf(response)).toBe(404);
            expect(messageOf(response)).toBe(notFound);
        });

        it('a malformed body is still refused VALIDATION_FAILED before the gate, for every caller', async () => {
            // The body checks read nothing about the run, so they stay first:
            // every 400 is byte-identical to before, and the gate's lookup is
            // spent only on a request the engine would otherwise receive. The
            // refusal is THROWN as the duck-typed validation failure both
            // dispatcher error exits map to 400 (#3918), as it always was.
            for (const ctx of [STRANGER, STARTER]) {
                const h = makeDispatcher('refusing');
                await expect(resumeAs(h, ctx(), { values: { note: 'x' } }))
                    .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

                expect(h.getRun).not.toHaveBeenCalled();
                expect(h.explainCalls).toHaveLength(0);
                expect(h.resume).not.toHaveBeenCalled();
            }
        });

        it('still refuses an ANONYMOUS caller at the #5519 floor, ahead of this gate', async () => {
            const h = makeDispatcher('granting');
            const { response } = await resumeAs(h, { request: {}, executionContext: {} } as HttpProtocolContext);

            expect(codeOf(response)).toBe('UNAUTHENTICATED');
            expect(statusOf(response)).toBe(401);
            expect(h.explainCalls).toHaveLength(0);
            expect(h.resume).not.toHaveBeenCalled();
        });

        it('serves the resume where no security service exists at all, or one omits `explain`', async () => {
            // No `plugin-security` ⇒ `/data/sys_automation_run` is itself
            // ungated, so the override half admits, exactly as on the read twin.
            for (const posture of ['absent', 'partial'] as const) {
                const h = makeDispatcher(posture);
                const { response } = await resumeAs(h, STRANGER());

                expect(statusOf(response), posture).toBe(200);
                expect(h.resume, posture).toHaveBeenCalledTimes(1);
            }
        });
    });

    describe('one predicate, two doors — the read twin and this door agree', () => {
        const CALLERS = [
            ['the starter', STARTER],
            ['a stranger', STRANGER],
            ['a system context', SYSTEM_CTX],
        ] as const;
        const POSTURES = ['granting', 'refusing', 'throwing', 'partial', 'absent'] as const;
        const RUNS = [
            ['a run started by u1', PAUSED_RUN],
            ['a run with no trigger identity', { ...PAUSED_RUN, trigger: { type: 'schedule' } }],
        ] as const;

        for (const [callerLabel, ctx] of CALLERS) {
            for (const posture of POSTURES) {
                for (const [runLabel, run] of RUNS) {
                    it(`${callerLabel} · security ${posture} · ${runLabel}`, async () => {
                        const read = makeDispatcher(posture, { run });
                        const screen = await read.dispatcher.handleAutomation(SCREEN_PATH, 'GET', undefined, ctx(), undefined);

                        const write = makeDispatcher(posture, { run });
                        const resumed = await resumeAs(write, ctx());

                        const readAdmitted = statusOf(screen.response) === 200;
                        const writeAdmitted = statusOf(resumed.response) === 200;
                        expect(writeAdmitted).toBe(readAdmitted);
                        expect(write.resume).toHaveBeenCalledTimes(writeAdmitted ? 1 : 0);
                        if (!readAdmitted) {
                            // One envelope: the same code and status on both doors,
                            // and the same requirement sentence after each verb.
                            expect(codeOf(resumed.response)).toBe(codeOf(screen.response));
                            expect(statusOf(resumed.response)).toBe(statusOf(screen.response));
                            expect(String(messageOf(screen.response)).endsWith(REQUIREMENT)).toBe(true);
                            expect(String(messageOf(resumed.response)).endsWith(REQUIREMENT)).toBe(true);
                        }
                    });
                }
            }
        }
    });
});
