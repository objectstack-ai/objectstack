// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11666] A refused `POST /automation/:name/toggle` is told what IT attempted.
 *
 * ## The defect, exactly
 *
 * #10243's ruling put the enablement door into the `manage_metadata` authoring
 * write set, and #11660 landed it by adding one arm to `isFlowAuthoringWrite`.
 * The refusal that arm reached was the shared one:
 *
 *   > `Authoring automation flows requires the \`manage_metadata\` capability.`
 *
 * A caller DISABLING a shipped flow was not authoring one. The sentence is
 * accurate about the policy — the ruling classified toggle as an authoring
 * write — and it names a verb the caller did not use.
 *
 * ## Why a pin on the SENTENCE, and why it could not be a pin on the envelope
 *
 * ⭐ The defect ships a 403 today. Every status- and code-only assertion in
 * `automation-write-capability-gate.test.ts` passes over it, in both the
 * before and the after state, which is precisely why this file exists and
 * asserts the prose. Those assertions are not weakened here; they are the
 * envelope half, and this is the copy half.
 *
 * ⛔ `code` and `status` do NOT move — `PERMISSION_DENIED` / 403 is what
 * #11660's pins and the ADR-0112 vocabulary assert — and they are re-asserted
 * on every case below so that a future edit to the copy cannot drag the
 * envelope with it.
 *
 * ⛔ The POLICY is untouched. The accept set is bit-identical: the same callers
 * are refused on the same four routes. Nothing here is allowed to become newly
 * accepted or newly rejected, and the `still refused / still admitted` cases at
 * the foot of this file are that guard, not decoration.
 *
 * ## Both directions, or the change is unpinned where it matters
 *
 * A one-sided pin ("toggle says the new thing") would sit green if someone
 * later reworded the SHARED constant to match — option C, which was considered
 * and declined because it degrades the sentence for the three definition writes
 * that read correctly today. So each arm asserts its own sentence AND the
 * absence of the other's.
 *
 * ## Driven through the registered route, not the shortcut
 *
 * Every case goes through `dispatcher.dispatch('POST', '/automation/…')`, which
 * resolves the domain out of the registry `createAutomationDomain` registers —
 * the path a real request takes, including the prefix slicing. Identity is
 * supplied by stubbing `timedResolveExecutionContext`, the seam `dispatch`
 * itself writes `context.executionContext` from
 * (`automation-resume-envelope.test.ts` drives the same seam the same way).
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const FLOW = 'lead_auto_assignment';
const CAPABILITY = 'manage_metadata';

/** A legal flow definition — so nothing below is refused for its shape. */
const DEFINITION = { name: FLOW, label: 'Lead Auto Assignment', type: 'autolaunched', nodes: [], edges: [] };

/** The two sentences, spelled out here rather than imported — a pin that reads
 *  its expectation from the module under test cannot see the module change. */
const AUTHORING_SENTENCE = 'Authoring automation flows requires the `manage_metadata` capability.';
const ENABLEMENT_SENTENCE = 'Enabling or disabling an automation flow requires the `manage_metadata` capability.';

/** The filer's principal: authenticated, an org owner, and NOT an author. */
const UNENTITLED = {
    userId: 'u_northwind_owner',
    positions: ['organization_admin'],
    permissions: ['org_admin'],
    systemPermissions: [] as string[],
};

/** A metadata author — the positive control. */
const AUTHOR = { userId: 'u_author', systemPermissions: [CAPABILITY] };

interface Harness {
    dispatch: (method: string, path: string, body?: unknown) => Promise<any>;
    registerFlow: ReturnType<typeof vi.fn>;
    unregisterFlow: ReturnType<typeof vi.fn>;
    toggleFlow: ReturnType<typeof vi.fn>;
    seed: (name: string) => void;
}

function boot(principal: Record<string, unknown> = UNENTITLED): Harness {
    const flows = new Map<string, unknown>([[FLOW, { ...DEFINITION }]]);

    const registerFlow = vi.fn((name: string, definition: unknown) => { flows.set(name, definition); });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const toggleFlow = vi.fn(async () => undefined);
    const getFlow = vi.fn(async (name: string) => flows.get(name));
    const listFlows = vi.fn(async () => [...flows.keys()]);
    const execute = vi.fn(async () => ({ success: true, runId: 'run_1', status: 'completed' }));

    const services: Record<string, unknown> = {
        automation: { handlerReady: true, registerFlow, unregisterFlow, toggleFlow, getFlow, listFlows, execute },
    };
    const resolve = (name: string): unknown => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };

    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch` resolves identity through; a context handed in is
    // overwritten by it, so the principal is supplied here.
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...principal });

    return {
        dispatch: (method: string, path: string, body?: unknown) =>
            dispatcher.dispatch(method, path, body, {}, { request: {} } as HttpProtocolContext),
        registerFlow, unregisterFlow, toggleFlow,
        seed: (name: string) => { flows.set(name, { ...DEFINITION, name }); },
    };
}

const statusOf = (r: any): unknown => r?.response?.status;
const codeOf = (r: any): unknown => r?.response?.body?.error?.code ?? r?.response?.body?.error?.details?.code;
const messageOf = (r: any): string => String(r?.response?.body?.error?.message ?? '');

/** The three DEFINITION writes — the arm whose sentence must NOT move. */
const DEFINITION_WRITES = [
    {
        name: 'POST /automation (createFlow)',
        drive: (h: Harness) => h.dispatch('POST', '/automation', { ...DEFINITION, name: 'probe_flow_x' }),
        spy: (h: Harness) => h.registerFlow,
    },
    {
        name: 'PUT /automation/:name (updateFlow)',
        drive: (h: Harness) => h.dispatch('PUT', `/automation/${FLOW}`, { ...DEFINITION, label: 'clobbered' }),
        spy: (h: Harness) => h.registerFlow,
    },
    {
        name: 'DELETE /automation/:name (deleteFlow)',
        drive: (h: Harness) => h.dispatch('DELETE', `/automation/${FLOW}`),
        spy: (h: Harness) => h.unregisterFlow,
    },
] as const;

describe('#11666 — the enablement door refuses in its own words', () => {
    describe('the arm that was refused: POST /:name/toggle', () => {
        it('names enabling/disabling, not authoring', async () => {
            const h = boot();
            const result = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enabled: false });

            // THE POINT of this file.
            expect(messageOf(result)).toBe(ENABLEMENT_SENTENCE);
            // ⛔ The defect's sentence, gone from this arm — asserted rather
            // than implied, because `toBe` above would also pass if the shared
            // constant had merely been reworded in place (option C).
            expect(messageOf(result)).not.toContain('Authoring');
            expect(messageOf(result)).not.toBe(AUTHORING_SENTENCE);
        });

        it('⛔ carries the same envelope it always did — 403 PERMISSION_DENIED', async () => {
            const h = boot();
            const result = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enabled: false });

            expect(statusOf(result)).toBe(403);
            expect(codeOf(result)).toBe('PERMISSION_DENIED');
        });

        it('⛔ still refuses — the copy change admits nobody new', async () => {
            const h = boot();
            const result = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enabled: false });

            expect(statusOf(result)).toBe(403);
            expect(h.toggleFlow).not.toHaveBeenCalled();
        });

        it('says the same thing in both directions — enabling and disabling', async () => {
            // #10243's measurement was symmetric, and a caller switching a flow
            // ON is no more "authoring" than one switching it off.
            const h = boot();

            const off = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enabled: false });
            const on = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enabled: true });

            expect(messageOf(off)).toBe(ENABLEMENT_SENTENCE);
            expect(messageOf(on)).toBe(ENABLEMENT_SENTENCE);
        });

        it('answers before the body is read, in its own words', async () => {
            // The gate is ahead of #3899's body checks, so `{ enable: false }`
            // is a 403 rather than the 400 that names the key — and the 403 it
            // gets is still the enablement sentence, not the shared one.
            const h = boot();
            const result = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enable: false });

            expect(statusOf(result)).toBe(403);
            expect(messageOf(result)).toBe(ENABLEMENT_SENTENCE);
            expect(h.toggleFlow).not.toHaveBeenCalled();
        });

        it('a deeper spelling is gated AND told the same thing — `/:name/toggle/anything`', async () => {
            // The router's toggle arm has no depth bound, so this path still
            // reaches `toggleFlow`; the gate matches it, and the sentence must
            // follow the gate rather than a narrower reading of the path.
            const h = boot();
            const result = await h.dispatch('POST', `/automation/${FLOW}/toggle/x`, { enabled: false });

            expect(statusOf(result)).toBe(403);
            expect(messageOf(result)).toBe(ENABLEMENT_SENTENCE);
            expect(h.toggleFlow).not.toHaveBeenCalled();
        });
    });

    describe('the arms that were NOT refused here keep the sentence they read correctly with', () => {
        for (const route of DEFINITION_WRITES) {
            it(`${route.name}: still "Authoring automation flows …"`, async () => {
                const h = boot();
                const result = await route.drive(h);

                expect(messageOf(result)).toBe(AUTHORING_SENTENCE);
                // The other direction of the same pin: the enablement wording
                // must not bleed onto a definition write.
                expect(messageOf(result)).not.toContain('Enabling or disabling');
                expect(statusOf(result)).toBe(403);
                expect(codeOf(result)).toBe('PERMISSION_DENIED');
                expect(route.spy(h)).not.toHaveBeenCalled();
            });
        }

        it('a flow literally NAMED `toggle` is still a definition write on PUT /automation/toggle', async () => {
            // The sentence is chosen by the OPERATION, never by a substring of
            // the flow name: `parts[1]` is what the enablement arm reads, and a
            // one-segment PUT has no `parts[1]` at all.
            const h = boot();
            h.seed('toggle');
            const result = await h.dispatch('PUT', '/automation/toggle', { ...DEFINITION, name: 'toggle' });

            expect(statusOf(result)).toBe(403);
            expect(messageOf(result)).toBe(AUTHORING_SENTENCE);
            expect(h.registerFlow).not.toHaveBeenCalled();
        });
    });

    describe('what both sentences must go on doing (#7450)', () => {
        it('each names the capability that would admit ANY caller', async () => {
            const h = boot();

            const toggle = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enabled: false });
            const write = await h.dispatch('DELETE', `/automation/${FLOW}`);

            expect(messageOf(toggle)).toContain(CAPABILITY);
            expect(messageOf(write)).toContain(CAPABILITY);
        });

        it('neither answers the caller\'s own authorization topology', async () => {
            const h = boot();
            const result = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enabled: false });

            const serialized = JSON.stringify(result?.response?.body);
            expect(serialized).not.toContain('organization_admin');
            expect(serialized).not.toContain('u_northwind_owner');
            expect(serialized).not.toContain('org_admin');
        });
    });

    describe('⛔ the policy classification is untouched — the accept set is bit-identical', () => {
        it('an entitled caller still toggles, in both directions', async () => {
            const h = boot(AUTHOR);

            const off = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enabled: false });
            expect(statusOf(off)).toBe(200);
            expect(h.toggleFlow).toHaveBeenLastCalledWith(FLOW, false);

            const on = await h.dispatch('POST', `/automation/${FLOW}/toggle`, { enabled: true });
            expect(statusOf(on)).toBe(200);
            expect(h.toggleFlow).toHaveBeenLastCalledWith(FLOW, true);
        });

        it('an entitled caller still writes definitions', async () => {
            const h = boot(AUTHOR);
            const result = await h.dispatch('DELETE', `/automation/${FLOW}`);

            expect(statusOf(result)).toBe(200);
            expect(h.unregisterFlow).toHaveBeenCalledWith(FLOW);
        });

        it('the legacy EXECUTION door stays out of the gate — even for a flow named `toggle`', async () => {
            // `POST /automation/trigger/:name` is the run door. The enablement
            // helper excludes `parts[0] === 'trigger'` for exactly this path,
            // and extracting that helper must not have moved the exclusion.
            const h = boot();
            h.seed('toggle');
            const result = await h.dispatch('POST', '/automation/trigger/toggle', {});

            expect(statusOf(result)).not.toBe(403);
            expect(h.toggleFlow).not.toHaveBeenCalled();
        });
    });
});
