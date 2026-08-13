// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7900 — the `/automation` run-state read surface converges on the
 * `sys_automation_run` object-read grant.
 *
 * Maintainer ruling, 2026-08-12: *"the `/automation` read surface requires the
 * same permission the `sys_automation_run` object read answers with; per-field
 * filtering of the variables map is rejected as the mechanism."*
 *
 * What was measured before this gate: `GET /automation/:name/runs/:runId`
 * answered `deps.success(run)` — the `ExecutionLogEntry` verbatim, no
 * projection, no redaction, no masking — behind the #5519 anonymous baseline
 * and nothing else. So the only question the surface asked was "are you
 * authenticated?", and any authenticated caller who knew a run id read the
 * triggering record's fields with that record's own FLS never applying. The
 * SAME snapshot's second door (`sys_automation_run.variables_json`) has always
 * gone through the system object's permissions — one platform, two answers.
 *
 * This file pins the four claims the convergence rests on:
 *
 *  1. **REFUSAL** — a caller the security service says may not read
 *     `sys_automation_run` is refused, with `code` AND `status` (ADR-0112), on
 *     BOTH run-state reads, and the automation service is never consulted.
 *  2. **POSITIVE CONTROL** — a caller WITH the grant reads exactly what they
 *     read today, byte for byte. This is the pin that says the change narrowed
 *     the gate rather than broke the route; it deep-equals the same fixture
 *     `automation-run-detail-passthrough.test.ts` asserts on.
 *  3. **ONE QUESTION** — the gate asks for `read` on `sys_automation_run` and
 *     forwards the caller's own execution context, i.e. it consults the grant
 *     the ruling names and not some second permission invented here.
 *  4. **THE AUDIT** — the routes that stay authenticated-only stay
 *     authenticated-only, and ask the security service nothing. A future change
 *     to any of those verdicts has to come through this file. (#7968 is that
 *     change, for one row: the paused-run `screen` read left this table when
 *     the maintainer gated it on the run's trigger identity instead — see the
 *     note in the table.)
 *
 * The three non-denials (system context, no security service, partial service)
 * are pinned too: each is a decision recorded on `refuseUngrantedRunRead`, and
 * an untested decision is a comment.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { AUTOMATION_RUN_OBJECT } from './automation.js';

/**
 * A paused run as the engine records it since #7639 — the exposure in one
 * object: `variables.record` is the triggering record's fields, and this
 * surface handed the whole entry back verbatim.
 */
const PAUSED_RUN = {
    id: 'run_7',
    flowName: 'approval_flow',
    status: 'paused',
    steps: [{ nodeId: 'stage1', nodeType: 'approval', status: 'success' }],
    variables: {
        'stage1.decision': { route: 'dual', note: null },
        record: { id: 'ord_1', amount: 90_000, margin_pct: 4.5 },
        $runId: 'run_7',
    },
} as const;

/** One explain call, as the gate makes it. */
interface ExplainCall {
    request: { object: string; operation: string; userId?: string; recordId?: string };
    context: unknown;
}

interface Harness {
    dispatcher: HttpDispatcher;
    getRun: ReturnType<typeof vi.fn>;
    listRuns: ReturnType<typeof vi.fn>;
    listFlows: ReturnType<typeof vi.fn>;
    getFlowRuntimeStates: ReturnType<typeof vi.fn>;
    getSuspendedScreen: ReturnType<typeof vi.fn>;
    explainCalls: ExplainCall[];
}

/**
 * Build a dispatcher over a stub automation service and a stub `security` slot.
 *
 * `security` is what the deployment's security posture is expressed as here:
 * `'granting'` / `'refusing'` are a service that answers, `'throwing'` is one
 * whose resolution fails, `'partial'` is an implementation that omits `explain`
 * (the contract's feature-detection case), `'absent'` is a deployment with no
 * `plugin-security` at all.
 */
function makeDispatcher(
    security: 'granting' | 'refusing' | 'throwing' | 'partial' | 'absent',
): Harness {
    const explainCalls: ExplainCall[] = [];
    const getRun = vi.fn(async () => PAUSED_RUN as unknown);
    const listRuns = vi.fn(async () => [PAUSED_RUN] as unknown[]);
    const listFlows = vi.fn(async () => ['approval_flow']);
    const getFlowRuntimeStates = vi.fn(() => [{ name: 'approval_flow', enabled: true, bound: true }]);
    const getSuspendedScreen = vi.fn(async () => ({ nodeId: 'collect', fields: [] } as unknown));

    const explain = async (
        request: ExplainCall['request'],
        context: unknown,
    ): Promise<{ allowed: boolean; object: string; operation: string }> => {
        explainCalls.push({ request, context });
        if (security === 'throwing') throw new Error('permission subsystem unavailable');
        return { allowed: security === 'granting', object: request.object, operation: request.operation };
    };

    const services: Record<string, unknown> = {
        automation: {
            handlerReady: true,
            getRun,
            listRuns,
            listFlows,
            getFlowRuntimeStates,
            getSuspendedScreen,
            getFlow: async (name: string) => ({ name, nodes: [] }),
            getActionDescriptors: () => [{ type: 'notify', source: 'builtin' }],
        },
    };
    if (security === 'partial') {
        // A security service that predates / omits `explain` — resolvable, but
        // unable to answer. Feature detection must degrade, not throw.
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
    return {
        dispatcher: new HttpDispatcher(kernel as never),
        getRun,
        listRuns,
        listFlows,
        getFlowRuntimeStates,
        getSuspendedScreen,
        explainCalls,
    };
}

/** An ordinary authenticated caller. */
const USER_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'user_1', positions: ['sales_rep'] } } as HttpProtocolContext);

/** A platform-internal caller — the middleware's own first bypass. */
const SYSTEM_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'usr_system', isSystem: true } } as HttpProtocolContext);

/** The run payload out of the success envelope, whatever the envelope's shape. */
const payloadOf = (response: unknown): any => {
    const r = response as any;
    return r?.data ?? r?.body?.data ?? r;
};

/** The semantic error code, from wherever the envelope parks it. */
const codeOf = (response: unknown): unknown => {
    const r = response as any;
    return r?.body?.error?.code ?? r?.body?.error?.details?.code;
};

describe('#7900 — /automation run-state reads require the sys_automation_run read grant', () => {
    describe('refusal', () => {
        it('refuses run-detail with PERMISSION_DENIED + 403, and never reads the run', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7', 'GET', undefined, USER_CTX(), undefined,
            );

            // ADR-0112: the refusal asserts BOTH halves. One is not enough — a
            // 403 carrying a derived code, or a PERMISSION_DENIED on a 200,
            // would each satisfy exactly half of the contract.
            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect((response as any).status).toBe(403);

            // The gate fires ahead of the service, so the snapshot is not even
            // read — a refusal that fetched first would still have loaded the
            // record's fields into the process serving the refused caller.
            expect(h.getRun).not.toHaveBeenCalled();
        });

        it('refuses the runs LIST on the same policy — it serves the same entries', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs', 'GET', undefined, USER_CTX(), undefined,
            );

            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect((response as any).status).toBe(403);
            expect(h.listRuns).not.toHaveBeenCalled();
        });

        it('does not answer the caller\'s authorization topology in the refusal (#7450)', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7', 'GET', undefined, USER_CTX(), undefined,
            );

            const serialized = JSON.stringify((response as any).body);
            expect(serialized).not.toContain('sales_rep');
            expect(serialized).not.toContain('user_1');
        });

        it('fails CLOSED when the permission answer cannot be computed', async () => {
            const h = makeDispatcher('throwing');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7', 'GET', undefined, USER_CTX(), undefined,
            );

            // An access-NARROWING answer that could not be resolved is a denial,
            // the stance plugin-security itself takes on an unresolvable object
            // posture (#3545). "Could not evaluate" must never read as "allowed".
            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect((response as any).status).toBe(403);
            expect(h.getRun).not.toHaveBeenCalled();
        });
    });

    describe('positive control — a caller WITH the grant reads exactly what they read today', () => {
        it('serves run-detail byte-for-byte, snapshot included', async () => {
            const h = makeDispatcher('granting');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7', 'GET', undefined, USER_CTX(), undefined,
            );
            const run = payloadOf(response);

            // Deep-equal against the WHOLE fixture: this is the pin that proves
            // a narrowing rather than a breakage. The ruling explicitly rejects
            // per-field filtering of `variables`, so a granted caller must still
            // receive the map untouched — nested objects, numbers and a null.
            expect(run).toEqual(PAUSED_RUN);
            expect(run.variables).toEqual(PAUSED_RUN.variables);
            expect(run.variables.record).toEqual(PAUSED_RUN.variables.record);
            expect(h.getRun).toHaveBeenCalledWith('run_7');
        });

        it('serves the runs list unchanged', async () => {
            const h = makeDispatcher('granting');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs', 'GET', undefined, USER_CTX(), undefined,
            );

            expect(payloadOf(response)).toEqual({ runs: [PAUSED_RUN], hasMore: false });
            expect(h.listRuns).toHaveBeenCalled();
        });
    });

    describe('one question, asked of the grant the ruling names', () => {
        it('asks for `read` on sys_automation_run, with the caller\'s own context', async () => {
            const h = makeDispatcher('granting');
            await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7', 'GET', undefined, USER_CTX(), undefined,
            );

            expect(h.explainCalls).toHaveLength(1);
            expect(h.explainCalls[0]!.request.object).toBe('sys_automation_run');
            expect(h.explainCalls[0]!.request.operation).toBe('read');
            // No `userId` on the request: explaining ANOTHER user is an
            // administrative act plugin-security gates on `manage_users`. The
            // gate asks about the CALLER, so it must not name a target.
            expect(h.explainCalls[0]!.request.userId).toBeUndefined();
            expect(h.explainCalls[0]!.context).toMatchObject({ userId: 'user_1' });
        });

        it('names the object the other door answers with', () => {
            // The two doors are one policy only if they are pointed at the same
            // object. `sys_automation_run.variables_json` is where the identical
            // snapshot is persisted.
            expect(AUTOMATION_RUN_OBJECT).toBe('sys_automation_run');
        });
    });

    describe('the three non-denials, each a recorded decision', () => {
        it('lets a SYSTEM context through without asking', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7', 'GET', undefined, SYSTEM_CTX(), undefined,
            );

            // The middleware's very first act is `if (isSystem) return next()`.
            // A gate stricter than the object read is not convergence either.
            expect(payloadOf(response)).toEqual(PAUSED_RUN);
            expect(h.explainCalls).toHaveLength(0);
        });

        it('serves the read where no security service exists — both doors say "authenticated is enough"', async () => {
            const h = makeDispatcher('absent');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7', 'GET', undefined, USER_CTX(), undefined,
            );

            // A deployment without plugin-security has no object-permission
            // system at all, so `/data/sys_automation_run` is ungated too.
            // Refusing here would put the doors in disagreement the OTHER way.
            expect(payloadOf(response)).toEqual(PAUSED_RUN);
        });

        it('degrades on a security service that omits `explain` rather than throwing', async () => {
            const h = makeDispatcher('partial');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7', 'GET', undefined, USER_CTX(), undefined,
            );

            // The contract mandates feature detection: a partial implementation
            // degrades to the pre-gate behaviour, it does not 500.
            expect((response as any).status).not.toBe(500);
            expect(payloadOf(response)).toEqual(PAUSED_RUN);
        });
    });

    describe('the audit — routes that stay authenticated-only, and why', () => {
        /**
         * Each row is a route the audit examined and left on the #5519
         * anonymous baseline alone. The reason is on the route in
         * `automation.ts`; what this table pins is that the verdict is a
         * DECISION — changing any of these has to change this file too.
         */
        const AUTHENTICATED_ONLY: Array<{ path: string; why: string }> = [
            { path: '', why: 'listFlows — flow names, not run state' },
            { path: 'approval_flow', why: 'getFlow — a flow definition, metadata-plane data' },
            { path: 'actions', why: 'getActionDescriptors — the deployment action catalog' },
            { path: '_status', why: 'getFlowRuntimeStates — per-flow enabled/bound state' },
            // [#7968] `approval_flow/runs/run_7/screen` USED to be this table's
            // fifth row. The audit's reason for leaving it here was right — the
            // grant alone would refuse the end user the flow paused for — but
            // "no grant" was not the same as "no gate": the route disclosed
            // record-derived screen defaults to any authenticated caller with a
            // run id. The 2026-08-12 ruling gates it on the run's own trigger
            // identity, with this grant as an operator override, so it is no
            // longer authenticated-only and no longer answers `explainCalls ===
            // 0` for a caller who is not the trigger identity. Its own file
            // owns it now: `automation-screen-read-gate.test.ts`.
        ];

        it.each(AUTHENTICATED_ONLY)('$path stays authenticated-only ($why)', async ({ path }) => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                path, 'GET', undefined, USER_CTX(), undefined,
            );

            // Not refused…
            expect((response as any).status).not.toBe(403);
            // …and the run-state grant was never consulted for it, so no cost
            // and no accidental coupling to a permission this route does not use.
            expect(h.explainCalls).toHaveLength(0);
        });

        it('gates neither the trigger nor any other write — the ruling is about the READ surface', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                'approval_flow/runs/run_7/resume', 'POST', { inputs: {} }, USER_CTX(), undefined,
            );

            // `resume` answers on the engine's per-run `resumeAuthority` axis
            // (#3801 / #5561), which this card does not touch.
            expect((response as any).status).not.toBe(403);
            expect(h.explainCalls).toHaveLength(0);
        });
    });

    it('still refuses an ANONYMOUS caller at the #5519 floor, ahead of the new gate', async () => {
        const h = makeDispatcher('granting');
        const { response } = await h.dispatcher.handleAutomation(
            'approval_flow/runs/run_7', 'GET', undefined,
            { request: {}, executionContext: {} } as HttpProtocolContext, undefined,
        );

        // Authentication is still the first question, and it is still answered
        // as 401/UNAUTHENTICATED — a narrowing must not accidentally re-label
        // the anonymous floor as an authorization failure.
        expect(codeOf(response)).toBe('UNAUTHENTICATED');
        expect((response as any).status).toBe(401);
        expect(h.explainCalls).toHaveLength(0);
    });
});
