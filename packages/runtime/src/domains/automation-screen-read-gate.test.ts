// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7968 — `GET /automation/:name/runs/:runId/screen` is gated to the run's own
 * trigger identity, OR the `sys_automation_run` read grant as an operator
 * override.
 *
 * Maintainer ruling, 2026-08-12 (Option B), acceptance verbatim: *"stranger
 * with valid auth + run id ⇒ denied; triggering user ⇒ screen; holder of
 * `sys_automation_run` read ⇒ screen."*
 *
 * ## What was measured before the gate
 *
 * A real screen flow, run through the real engine
 * (`service-automation`: `registerScreenNodes` → `screen` node with
 * `defaultValue: '{record.email}'` etc., triggered on a `crm_lead` record),
 * suspends with this persisted `ScreenSpec` — record values interpolated into
 * the title, the description and every field default:
 *
 * ```
 * { nodeId: 'collect', title: 'Confirm Acme Health',
 *   description: 'Contact for ceo@acme-health.example',
 *   fields: [ { name: 'email',  defaultValue: 'ceo@acme-health.example' },
 *             { name: 'phone',  defaultValue: '+1-555-0100' },
 *             { name: 'salary', defaultValue: 'L7 / 285000 USD' } ] }
 * ```
 *
 * Fed through this dispatcher, a caller with valid auth, no relationship to the
 * run and NO `sys_automation_run` grant received it under `200 { success:
 * true }` — the whole spec, every value. That payload is {@link REAL_SCREEN}
 * here, verbatim, so the fixture is the observed disclosure rather than a
 * plausible stand-in.
 *
 * ## Why the over-block direction is pinned as hard as the under-block one
 *
 * The obvious gate is the WRONG one, and that is the entire reason this card
 * needed a ruling. Requiring the `sys_automation_run` grant — the mechanism
 * #7900 converged the sibling run-state reads on — passes a naive "the stranger
 * is denied" test **while refusing the end user the flow paused for**, i.e.
 * while breaking the route's only purpose. So every admit case below asserts
 * the screen ARRIVES WITH ITS RECORD-DERIVED VALUES INTACT, not merely that a
 * 200 came back: an emptied or stripped screen is a broken route wearing a
 * passing status code.
 *
 * ## Not in scope (recorded, not built)
 *
 * Option A — a per-run authority read gate derived from the suspension's own
 * `resumeAuthority` / assignee state, the axis `resume` answers on (#3801 /
 * #5561) — stays the recorded coherent end state and is ADR-0019-class design
 * work. B does not preclude it: both refuse the same stranger and admit the
 * same end user, so A can supersede this without re-litigating the acceptance.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { AUTOMATION_RUN_OBJECT } from './automation.js';

/**
 * The disclosure itself, captured from a real engine run (see the file header).
 * Every string in here is derived from the triggering `crm_lead` record.
 */
const REAL_SCREEN = {
    nodeId: 'collect',
    title: 'Confirm Acme Health',
    description: 'Contact for ceo@acme-health.example',
    fields: [
        { name: 'email', label: 'Email', type: 'text', required: false, defaultValue: 'ceo@acme-health.example' },
        { name: 'phone', label: 'Phone', type: 'text', required: false, defaultValue: '+1-555-0100' },
        { name: 'salary', label: 'Band', type: 'text', required: false, defaultValue: 'L7 / 285000 USD' },
    ],
} as const;

/**
 * Every record-derived string the spec above carries. A refusal is checked
 * against this list POSITIVELY — "none of these appears in what the stranger
 * received" — because "the response differs from the granted one" is also true
 * of a 200 that leaked half the fields.
 */
const RECORD_DERIVED_VALUES = [
    'Acme Health',
    'ceo@acme-health.example',
    '+1-555-0100',
    'L7 / 285000 USD',
];

/** The run the screen belongs to, as the engine records it (`buildRunTrigger`, #7533). */
const PAUSED_RUN = {
    id: 'run_1',
    flowName: 'lead_followup',
    status: 'paused',
    trigger: { type: 'record_change', userId: 'user_owner', object: 'crm_lead', recordId: 'lead_1' },
    steps: [{ nodeId: 'collect', nodeType: 'screen', status: 'paused' }],
} as const;

/** One `explain` call, as the gate makes it. */
interface ExplainCall {
    request: { object: string; operation: string; userId?: string };
    context: unknown;
}

interface Harness {
    dispatcher: HttpDispatcher;
    getSuspendedScreen: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    explainCalls: ExplainCall[];
}

interface Options {
    /** The run `getRun` answers with — `null` for "no such run". */
    run?: unknown;
    /** Omit `getRun` entirely: a service that cannot say who triggered a run. */
    withoutGetRun?: boolean;
    /** What `getSuspendedScreen` answers — `null` is the nonexistent-run path. */
    screen?: unknown;
    /** Omit `getSuspendedScreen`: the capability this deployment does not have. */
    withoutScreenLookup?: boolean;
}

/**
 * `security` is the deployment's security posture: `'granting'` / `'refusing'`
 * are a service that answers, `'throwing'` one whose answer cannot be computed,
 * `'partial'` an implementation that omits `explain`, `'absent'` a deployment
 * with no `plugin-security` at all.
 */
function makeDispatcher(
    security: 'granting' | 'refusing' | 'throwing' | 'partial' | 'absent',
    options: Options = {},
): Harness {
    const explainCalls: ExplainCall[] = [];
    const screen = 'screen' in options ? options.screen : REAL_SCREEN;
    const getSuspendedScreen = vi.fn(async () => screen as unknown);
    const getRun = vi.fn(async () => ('run' in options ? options.run : PAUSED_RUN) as unknown);
    const resume = vi.fn(async () => ({ success: true, status: 'completed' }) as unknown);

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
        getFlow: async (name: string) => ({ name, nodes: [] }),
    };
    if (!options.withoutScreenLookup) automation.getSuspendedScreen = getSuspendedScreen;
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
    return {
        dispatcher: new HttpDispatcher(kernel as never),
        getSuspendedScreen,
        getRun,
        resume,
        explainCalls,
    };
}

/** The identity the flow paused for — `PAUSED_RUN.trigger.userId`. */
const TRIGGERING_USER = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'user_owner', positions: ['sales_rep'] } } as HttpProtocolContext);

/** A stranger: valid auth, no relationship to this run. */
const STRANGER = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'user_stranger', positions: ['intern'] } } as HttpProtocolContext);

/** A platform-internal caller. */
const SYSTEM_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'usr_system', isSystem: true } } as HttpProtocolContext);

const SCREEN_PATH = 'lead_followup/runs/run_1/screen';

/** The payload out of the success envelope, whatever the envelope's shape. */
const payloadOf = (response: unknown): any => {
    const r = response as any;
    return r?.data ?? r?.body?.data ?? r;
};

/** The semantic error code, from wherever the envelope parks it. */
const codeOf = (response: unknown): unknown => {
    const r = response as any;
    return r?.body?.error?.code ?? r?.body?.error?.details?.code;
};

/** The whole response as text — for asserting a value is ABSENT from it. */
const textOf = (response: unknown): string => JSON.stringify((response as any)?.body ?? response);

/**
 * The over-block assertion, in one place: the screen ARRIVED, whole, with every
 * record-derived value still on it.
 *
 * Deep-equality against the entire captured spec plus a value-by-value check.
 * A gate that admits the right caller and then hands them an empty `fields`
 * array, or defaults stripped "to be safe", has broken the route while passing
 * any status assertion — and the pause exists precisely so this caller can see
 * these prefills.
 */
function expectScreenServedWhole(response: unknown): void {
    expect((response as any).status).toBe(200);
    const payload = payloadOf(response);
    expect(payload).toEqual({ runId: 'run_1', screen: REAL_SCREEN });
    expect(payload.screen.fields).toHaveLength(3);
    for (const value of RECORD_DERIVED_VALUES) expect(textOf(response)).toContain(value);
}

describe('#7968 — the paused-run screen is gated to its trigger identity, or the run-state grant', () => {
    describe('case 1 — stranger with valid auth + run id ⇒ denied', () => {
        it('refuses with PERMISSION_DENIED AND 403 (ADR-0112, both halves)', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );

            // BOTH halves, on purpose. This route's correct refusal (403) and
            // its pre-existing not-found answer (404) are one status apart, so
            // `status >= 400` cannot tell a working gate from a mistyped run
            // id — and a bare `code` check cannot tell 403 from a 200 carrying
            // a code field.
            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect((response as any).status).toBe(403);
        });

        it('does not disclose the record-derived values — asserted value by value', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );

            // The disclosure this card is about, pinned POSITIVELY: each value
            // the real run interpolated into the spec is absent from what the
            // stranger received. "The response differs from the granted one" is
            // also true of a 200 that leaked two fields out of three.
            const body = textOf(response);
            for (const value of RECORD_DERIVED_VALUES) expect(body).not.toContain(value);
            expect(payloadOf(response)?.screen).toBeUndefined();
        });

        it('answers nothing about the caller\'s authorization topology (#7450)', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );

            const body = textOf(response);
            expect(body).not.toContain('intern');
            expect(body).not.toContain('user_stranger');
            // It DOES name what would admit a caller — both halves, so the end
            // user is not misdirected to ask for an operator grant.
            expect(body).toContain(AUTOMATION_RUN_OBJECT);
            expect(body).toContain('triggered the run');
        });

        it('refuses a run whose trigger carries NO userId rather than matching on absence', async () => {
            // A schedule-triggered run has no `trigger.userId`. An identity
            // check written as `run.trigger?.userId === ec.userId` over two
            // undefineds would admit everyone on exactly these runs — the
            // failure mode this case exists to make impossible.
            const h = makeDispatcher('refusing', {
                run: { ...PAUSED_RUN, trigger: { type: 'schedule' } },
            });
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );

            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect((response as any).status).toBe(403);
            for (const value of RECORD_DERIVED_VALUES) expect(textOf(response)).not.toContain(value);
        });
    });

    describe('case 2 — the triggering user gets the screen (the OVER-BLOCK guard)', () => {
        it('serves it whole to the identity the flow paused for, with NO grant at all', async () => {
            // `'refusing'` is the load-bearing half of this case: this caller is
            // refused the `sys_automation_run` grant, exactly like the stranger
            // above. Gate on the grant — the #7900 mechanism, the obvious and
            // wrong one — and this test goes red while every denial test stays
            // green. That asymmetry is the whole reason the ruling was needed.
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, TRIGGERING_USER(), undefined,
            );

            expectScreenServedWhole(response);
        });

        it('reads the identity off THIS run, and does not consult the grant once it matches', async () => {
            const h = makeDispatcher('refusing');
            await h.dispatcher.handleAutomation(SCREEN_PATH, 'GET', undefined, TRIGGERING_USER(), undefined);

            // The identity is the run's own (`ExecutionLogEntry.trigger.userId`),
            // looked up for the run in the path…
            expect(h.getRun).toHaveBeenCalledWith('run_1');
            // …and it is SUFFICIENT: the end user's access does not depend on
            // the permission subsystem being reachable, or existing.
            expect(h.explainCalls).toHaveLength(0);
        });

        it('still serves the end user when the permission subsystem is DOWN', async () => {
            // `explain` throwing fails closed for the OVERRIDE half only. The
            // person the flow paused for is not locked out of their own form by
            // an operator-side outage.
            const h = makeDispatcher('throwing');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, TRIGGERING_USER(), undefined,
            );

            expectScreenServedWhole(response);
        });

        it('…while the same outage still refuses the stranger', async () => {
            const h = makeDispatcher('throwing');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );

            // The other side of that asymmetry: an unresolvable OVERRIDE is a
            // denial, the stance plugin-security takes on an unresolvable
            // posture (#3545). "Could not evaluate" never reads as "allowed".
            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect((response as any).status).toBe(403);
        });
    });

    describe('case 3 — a holder of the `sys_automation_run` read grant gets the screen', () => {
        it('serves it whole to an operator who did NOT trigger the run', async () => {
            const h = makeDispatcher('granting');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );

            expectScreenServedWhole(response);
        });

        it('asks for `read` on sys_automation_run with the caller\'s own context', async () => {
            const h = makeDispatcher('granting');
            await h.dispatcher.handleAutomation(SCREEN_PATH, 'GET', undefined, STRANGER(), undefined);

            // The SAME question #7900's gate asks, through the same predicate —
            // one grant, not a second permission invented for this route.
            expect(h.explainCalls).toHaveLength(1);
            expect(h.explainCalls[0]!.request.object).toBe(AUTOMATION_RUN_OBJECT);
            expect(h.explainCalls[0]!.request.operation).toBe('read');
            // No `userId` on the request: explaining ANOTHER user is an
            // administrative act. The gate asks about the CALLER.
            expect(h.explainCalls[0]!.request.userId).toBeUndefined();
            expect(h.explainCalls[0]!.context).toMatchObject({ userId: 'user_stranger' });
        });

        it('serves an operator even when the run cannot say who triggered it', async () => {
            // `getRun` is optional on `IAutomationService`. A service that
            // cannot answer the identity question admits nobody on that half —
            // it must not fall open, and it must not lock the operator out.
            const h = makeDispatcher('granting', { withoutGetRun: true });
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );
            expectScreenServedWhole(response);

            const denied = makeDispatcher('refusing', { withoutGetRun: true });
            const refusal = await denied.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );
            expect(codeOf(refusal.response)).toBe('PERMISSION_DENIED');
            expect((refusal.response as any).status).toBe(403);
        });

        it('treats a getRun THROW as unresolved identity, not as a match', async () => {
            const h = makeDispatcher('refusing');
            h.getRun.mockRejectedValueOnce(new Error('run store unreachable'));
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, TRIGGERING_USER(), undefined,
            );

            // Even for the real trigger identity: an identity that could not be
            // read is not an identity that matched.
            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect((response as any).status).toBe(403);
            expect(textOf(response)).not.toContain('ceo@acme-health.example');
        });
    });

    describe('the not-found answer is untouched — for every caller', () => {
        /**
         * Deliberate, and the reason the gate runs AFTER `getSuspendedScreen`:
         * the identity half is derived from the run, so gating first would have
         * to fail closed on an unresolvable run and turn today's 404 into a 403
         * for everyone, honest typos included.
         *
         * The consequence is stated rather than hidden: a stranger can still
         * tell a paused run id (403) from an unknown one (404). That is an
         * existence oracle over run ids — strictly narrower than the record
         * values it replaces — and closing it means answering 404 to the
         * refused caller, a different design that is NOT what was ruled. These
         * cases hold the distinction so a future change to it is deliberate.
         */
        it.each([
            ['a stranger', STRANGER],
            ['the triggering user', TRIGGERING_USER],
        ])('answers 404 (not 403) to %s for a run with no pending screen', async (_label, ctx) => {
            const h = makeDispatcher('refusing', { screen: null });
            const { response } = await h.dispatcher.handleAutomation(
                'lead_followup/runs/run_missing/screen', 'GET', undefined, ctx(), undefined,
            );

            expect((response as any).status).toBe(404);
            expect(codeOf(response)).not.toBe('PERMISSION_DENIED');
            expect(textOf(response)).toContain('No pending screen for run');
        });

        it('does not even ask the permission question when there is nothing to disclose', async () => {
            const h = makeDispatcher('refusing', { screen: null });
            await h.dispatcher.handleAutomation(
                'lead_followup/runs/run_missing/screen', 'GET', undefined, STRANGER(), undefined,
            );

            expect(h.explainCalls).toHaveLength(0);
        });

        it('keeps the 501 for a deployment whose service cannot look screens up', async () => {
            const h = makeDispatcher('refusing', { withoutScreenLookup: true });
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );

            expect((response as any).status).toBe(501);
        });
    });

    describe('the non-denials this gate inherits from the run-state policy', () => {
        it('lets a SYSTEM context through without asking anything', async () => {
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, SYSTEM_CTX(), undefined,
            );

            expectScreenServedWhole(response);
            expect(h.explainCalls).toHaveLength(0);
        });

        it('serves the read where no security service exists at all', async () => {
            // No `plugin-security` ⇒ no object-permission system ⇒
            // `/data/sys_automation_run` is itself ungated. Refusing here would
            // put the two doors in disagreement the other way.
            const h = makeDispatcher('absent');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );
            expectScreenServedWhole(response);
        });

        it('degrades on a security service that omits `explain` rather than throwing', async () => {
            const h = makeDispatcher('partial');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined, STRANGER(), undefined,
            );

            expect((response as any).status).not.toBe(500);
            expectScreenServedWhole(response);
        });

        it('still refuses an ANONYMOUS caller at the #5519 floor, ahead of this gate', async () => {
            const h = makeDispatcher('granting');
            const { response } = await h.dispatcher.handleAutomation(
                SCREEN_PATH, 'GET', undefined,
                { request: {}, executionContext: {} } as HttpProtocolContext, undefined,
            );

            // Authentication is still the first question, still answered as
            // 401/UNAUTHENTICATED — a narrowing must not re-label the anonymous
            // floor as an authorization failure.
            expect(codeOf(response)).toBe('UNAUTHENTICATED');
            expect((response as any).status).toBe(401);
            expect(h.explainCalls).toHaveLength(0);
        });
    });

    describe('scope — what this card does NOT change', () => {
        it('leaves `resume`\'s own authority checks alone (#3801 / #5561)', async () => {
            // The write sibling answers in the ENGINE, on the suspension's
            // declared `resumeAuthority`. A stranger reaching it is the engine's
            // question to answer, not this gate's — and Option A, which would
            // put the READ on that same per-run axis, is explicitly out of scope
            // here.
            const h = makeDispatcher('refusing');
            const { response } = await h.dispatcher.handleAutomation(
                'lead_followup/runs/run_1/resume', 'POST', { inputs: {} }, STRANGER(), undefined,
            );

            expect((response as any).status).not.toBe(403);
            expect(h.resume).toHaveBeenCalled();
            expect(h.explainCalls).toHaveLength(0);
        });
    });
});
