// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10145] The `/automation` AUTHORING writes demand the `manage_metadata`
 * capability (ADR-0066 D1) — the same gate the sibling `/meta` and `/packages`
 * writes already carry.
 *
 * ## What was measured before this gate
 *
 * On a walled hosted-SaaS deployment (`OS_TENANCY_POSTURE=isolated`), a plain
 * tenant org owner holding `organization_admin` and demonstrably NOT
 * `manage_metadata` — the same session is answered **403** by
 * `PUT /api/v1/meta/:type/:name`, `POST /api/v1/ai/tools/:tool/execute` and
 * `POST /api/v1/packages/*` — could `POST` / `PUT` / `DELETE`
 * `/api/v1/automation` and be answered 200. A flow is authored metadata
 * registered at ENVIRONMENT scope, not organization scope, so the write landed
 * on the layer every organization runs on: the filer deleted a shipped flow and
 * read it back **404 as the actor, as an unrelated tenant, and as the platform
 * admin**; an injected flow read 200 for all three. Privilege escalation and a
 * cross-tenant one at once.
 *
 * The domain's own `GET /` audit note already said where this belongs: *"Flow
 * definitions are metadata and are governed on the metadata plane"*. The write
 * half is that plane's authoring capability, applied at this door.
 *
 * ## The scope line this file pins in BOTH directions
 *
 * AUTHORING is gated; EXECUTION is not. `POST /:name/trigger`,
 * `POST /trigger/:name` and `POST /:name/runs/:runId/resume` run a flow rather
 * than author one — `resume` is additionally fail-closed through the suspended
 * node's `resumeAuthority` (#3801 / #5561) — and `POST /:name/toggle` mutates
 * engine enablement. None of them writes a flow DEFINITION, so none of them is
 * swept into a metadata gate here; the `stays ungated` block below is the audit
 * that makes any future change to those four verdicts come through this file.
 *
 * ## What the refusal cases assert
 *
 * `status` AND `code` (the ADR-0112 envelope), plus — the point — that
 * `registerFlow` / `unregisterFlow` were **never entered**. A gate that refused
 * after the registry was already mutated would still be the defect and would
 * still satisfy a status-only assertion, so the spy is the load-bearing
 * assertion, not decoration.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const FLOW = 'lead_auto_assignment';

/** A legal flow definition — so nothing below is refused for its shape. */
const DEFINITION = { name: FLOW, label: 'Lead Auto Assignment', type: 'autolaunched', nodes: [], edges: [] };

interface Harness {
    dispatcher: HttpDispatcher;
    registerFlow: ReturnType<typeof vi.fn>;
    unregisterFlow: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    toggleFlow: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    listFlows: ReturnType<typeof vi.fn>;
    getFlow: ReturnType<typeof vi.fn>;
    /** Flow names the registry currently holds — read from the STORE, not a response. */
    registered: () => string[];
}

/**
 * A dispatcher over a stub automation service backed by a REAL in-memory
 * registry, so a refused write can be checked against the registry rather than
 * only against the answer.
 *
 * `automation: false` is a deployment that mounts no automation service at all
 * — the 501 case the gate must not be distinguishable from.
 */
function boot({ automation = true }: { automation?: boolean } = {}): Harness {
    const flows = new Map<string, unknown>([[FLOW, { ...DEFINITION }]]);

    const registerFlow = vi.fn((name: string, definition: unknown) => { flows.set(name, definition); });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const getFlow = vi.fn(async (name: string) => flows.get(name));
    const execute = vi.fn(async () => ({ success: true, runId: 'run_1', status: 'completed' }));
    const toggleFlow = vi.fn(async () => undefined);
    const resume = vi.fn(async () => ({ success: true, status: 'completed' }));
    const listFlows = vi.fn(async () => [...flows.keys()]);

    const services: Record<string, unknown> = {};
    if (automation) {
        services.automation = {
            handlerReady: true,
            registerFlow, unregisterFlow, getFlow, execute, toggleFlow, resume, listFlows,
        };
    }

    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };

    return {
        dispatcher: new HttpDispatcher(kernel as never),
        registerFlow, unregisterFlow, execute, toggleFlow, resume, listFlows, getFlow,
        registered: () => [...flows.keys()].sort(),
    };
}

/**
 * The filer's principal: a tenant org owner, authenticated, holding
 * `organization_admin` and NO authoring capability.
 */
const UNENTITLED = (): HttpProtocolContext => ({
    request: {},
    executionContext: {
        userId: 'u_northwind_owner',
        positions: ['organization_admin'],
        permissions: ['org_admin'],
        systemPermissions: [],
    },
} as HttpProtocolContext);

/** Authoring-adjacent capabilities that are NOT this gate's key. */
const NEAR_MISS = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'u_setup', systemPermissions: ['studio.access', 'setup.access'] },
} as HttpProtocolContext);

/** A metadata author. */
const AUTHOR = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
} as HttpProtocolContext);

/** Engine self-invocation — never settable from the wire. */
const SYSTEM = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'usr_system', isSystem: true },
} as HttpProtocolContext);

/** No resolved identity at all. */
const ANON = (): HttpProtocolContext => ({ request: {}, executionContext: {} } as HttpProtocolContext);

const statusOf = (response: unknown): unknown => (response as any)?.status;
const codeOf = (response: unknown): unknown => {
    const r = response as any;
    return r?.body?.error?.code ?? r?.body?.error?.details?.code;
};

/** The three AUTHORING writes, each with the service method it must never reach. */
const AUTHORING_WRITES = [
    {
        name: 'POST /automation (createFlow)',
        drive: (h: Harness, ctx: HttpProtocolContext) =>
            h.dispatcher.handleAutomation('', 'POST', { ...DEFINITION, name: 'probe_flow_x' }, ctx, undefined),
        spy: (h: Harness) => h.registerFlow,
    },
    {
        name: 'PUT /automation/:name (updateFlow)',
        drive: (h: Harness, ctx: HttpProtocolContext) =>
            h.dispatcher.handleAutomation(`/${FLOW}`, 'PUT', { ...DEFINITION, label: 'clobbered' }, ctx, undefined),
        spy: (h: Harness) => h.registerFlow,
    },
    {
        name: 'DELETE /automation/:name (deleteFlow)',
        drive: (h: Harness, ctx: HttpProtocolContext) =>
            h.dispatcher.handleAutomation(`/${FLOW}`, 'DELETE', undefined, ctx, undefined),
        spy: (h: Harness) => h.unregisterFlow,
    },
] as const;

describe('#10145 — /automation authoring writes require `manage_metadata`', () => {
    describe('refusal — the unentitled tenant principal from the report', () => {
        for (const route of AUTHORING_WRITES) {
            it(`${route.name}: 403 PERMISSION_DENIED, and the registry is untouched`, async () => {
                const h = boot();
                const { response } = await route.drive(h, UNENTITLED());

                // ADR-0112 wants both halves: a 403 carrying no code, or the code
                // on a 200, each satisfies exactly half of the contract.
                expect(statusOf(response)).toBe(403);
                expect(codeOf(response)).toBe('PERMISSION_DENIED');

                // THE POINT. "Delete first, refuse second" would pass the two
                // assertions above and still be the cross-tenant defect.
                expect(route.spy(h)).not.toHaveBeenCalled();
                expect(h.registered()).toEqual([FLOW]);
            });
        }

        it('refuses BEFORE the body is validated — a malformed definition is still not a 422', async () => {
            // The gate sits ahead of #3899's body checks, so an unentitled caller
            // learns nothing about the definition contract by probing it, and
            // nothing reaches the registry on any body.
            const h = boot();
            const { response } = await h.dispatcher.handleAutomation('', 'POST', { label: 'no name' }, UNENTITLED(), undefined);

            expect(statusOf(response)).toBe(403);
            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            expect(h.registerFlow).not.toHaveBeenCalled();
        });

        it('an unrelated authoring-adjacent capability is not enough', async () => {
            // `studio.access` / `setup.access` are the ADR-0106 D4 READ set; the
            // write key is `manage_metadata`, exactly as `/packages` splits them.
            const h = boot();
            const { response } = await h.dispatcher.handleAutomation(`/${FLOW}`, 'DELETE', undefined, NEAR_MISS(), undefined);

            expect(statusOf(response)).toBe(403);
            expect(h.unregisterFlow).not.toHaveBeenCalled();
        });

        it('does not answer the caller\'s authorization topology in the refusal (#7450)', async () => {
            const h = boot();
            const { response } = await h.dispatcher.handleAutomation(`/${FLOW}`, 'DELETE', undefined, UNENTITLED(), undefined);

            const serialized = JSON.stringify((response as any).body);
            expect(serialized).not.toContain('organization_admin');
            expect(serialized).not.toContain('u_northwind_owner');
            expect(serialized).not.toContain('org_admin');
        });

        it('fires BEFORE the service probe, so 403-vs-501 leaks no deployment capability', async () => {
            // A deployment with no automation service answers 501 to an entitled
            // caller. An unentitled one must not be able to tell the two
            // deployments apart — the posture the anonymous floor and the
            // run-state gate in this domain already take.
            const bare = boot({ automation: false });

            const refused = await bare.dispatcher.handleAutomation('', 'POST', { ...DEFINITION }, UNENTITLED(), undefined);
            expect(statusOf(refused.response)).toBe(403);
            expect(codeOf(refused.response)).toBe('PERMISSION_DENIED');

            const entitled = await bare.dispatcher.handleAutomation('', 'POST', { ...DEFINITION }, AUTHOR(), undefined);
            expect(statusOf(entitled.response)).toBe(501);
        });
    });

    describe('positive control — an entitled principal writes exactly what it wrote before', () => {
        it('POST /automation registers the definition verbatim', async () => {
            const h = boot();
            const body = { ...DEFINITION, name: 'probe_flow_x' };
            const { response } = await h.dispatcher.handleAutomation('', 'POST', body, AUTHOR(), undefined);

            expect(statusOf(response)).toBe(200);
            expect(h.registerFlow).toHaveBeenCalledWith('probe_flow_x', body);
            expect(h.registered()).toEqual([FLOW, 'probe_flow_x'].sort());
        });

        it('PUT /automation/:name updates through the same one argument shape', async () => {
            const h = boot();
            const definition = { ...DEFINITION, label: 'Renamed' };
            const { response } = await h.dispatcher.handleAutomation(`/${FLOW}`, 'PUT', definition, AUTHOR(), undefined);

            expect(statusOf(response)).toBe(200);
            expect(h.registerFlow).toHaveBeenCalledWith(FLOW, definition);
        });

        it('DELETE /automation/:name deregisters', async () => {
            const h = boot();
            const { response } = await h.dispatcher.handleAutomation(`/${FLOW}`, 'DELETE', undefined, AUTHOR(), undefined);

            expect(statusOf(response)).toBe(200);
            expect((response as any).body?.data?.deleted).toBe(true);
            expect(h.unregisterFlow).toHaveBeenCalledWith(FLOW);
            expect(h.registered()).toEqual([]);
        });

        it('engine self-invocation (`isSystem`) bypasses, matching every other capability gate', async () => {
            const h = boot();
            const { response } = await h.dispatcher.handleAutomation(`/${FLOW}`, 'DELETE', undefined, SYSTEM(), undefined);

            expect(statusOf(response)).toBe(200);
            expect(h.unregisterFlow).toHaveBeenCalledWith(FLOW);
        });
    });

    describe('the anonymous floor still answers first — this gate is the second layer', () => {
        for (const route of AUTHORING_WRITES) {
            it(`${route.name}: anonymous is 401, not 403`, async () => {
                // #5519's domain-wide floor. Preserved verbatim: an anonymous
                // caller must not learn from a 401-vs-403 which capability the
                // route wants.
                const h = boot();
                const { response } = await route.drive(h, ANON());

                expect(statusOf(response)).toBe(401);
                expect(route.spy(h)).not.toHaveBeenCalled();
            });
        }
    });

    describe('the audit — EXECUTION and READ routes stay ungated by this capability', () => {
        it('POST /:name/trigger runs for a caller with no authoring capability', async () => {
            const h = boot();
            const { response } = await h.dispatcher.handleAutomation(`/${FLOW}/trigger`, 'POST', {}, UNENTITLED(), undefined);

            expect(statusOf(response)).not.toBe(403);
            expect(h.execute).toHaveBeenCalled();
        });

        it('POST /trigger/:name (the legacy SDK shape) runs too', async () => {
            const h = boot();
            const { response } = await h.dispatcher.handleAutomation(`/trigger/${FLOW}`, 'POST', {}, UNENTITLED(), undefined);

            expect(statusOf(response)).not.toBe(403);
            expect(h.execute).toHaveBeenCalled();
        });

        it('POST /:name/toggle stays ungated — enablement is engine state, not a definition write', async () => {
            // Deliberately OUT of this card's write set. Toggling is arguably an
            // authoring write and is filed separately rather than folded in; if
            // that verdict changes it changes here, in the open.
            const h = boot();
            const { response } = await h.dispatcher.handleAutomation(`/${FLOW}/toggle`, 'POST', { enabled: false }, UNENTITLED(), undefined);

            expect(statusOf(response)).not.toBe(403);
            expect(h.toggleFlow).toHaveBeenCalledWith(FLOW, false);
        });

        it('POST /:name/runs/:runId/resume stays ungated — it is fail-closed on `resumeAuthority` (#3801/#5561)', async () => {
            const h = boot();
            const { response } = await h.dispatcher.handleAutomation(
                `/${FLOW}/runs/run_1/resume`, 'POST', { inputs: {} }, UNENTITLED(), undefined,
            );

            expect(statusOf(response)).not.toBe(403);
            expect(h.resume).toHaveBeenCalled();
        });

        it('the reads are untouched — GET / and GET /:name', async () => {
            const h = boot();

            const list = await h.dispatcher.handleAutomation('', 'GET', undefined, UNENTITLED(), undefined);
            expect(statusOf(list.response)).toBe(200);

            const detail = await h.dispatcher.handleAutomation(`/${FLOW}`, 'GET', undefined, UNENTITLED(), undefined);
            expect(statusOf(detail.response)).toBe(200);
        });
    });
});
