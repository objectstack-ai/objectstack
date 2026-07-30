// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST `/actions/:object/:action` — action TYPE dispatch (#3915).
 *
 * The spec dispatches every non-`script` action on `target`
 * (`packages/spec/src/ui/action.zod.ts`), and the MCP `run_action` bridge has
 * implemented the `flow` branch since #2849. The REST route had NO type
 * branching at all: every action, whatever its declared type, went to
 * `ql.executeAction` — the script-handler registry — so a spec-faithful
 * REST/SDK caller invoking a `type: 'flow'` action got
 * `Action '' on object '*' not found` and had to know to call
 * `POST /api/v1/automation/:target/trigger` itself.
 *
 * These tests pin the ported dispatch: `flow` → the automation service with
 * the caller's identity forwarded, `script` → the registry (unchanged), and
 * the client-side types → an actionable 400 instead of a registry miss.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';

const flowAction = {
    name: 'convert_lead',
    label: 'Convert Lead',
    objectName: 'crm_lead',
    type: 'flow',
    target: 'crm_convert_lead_wizard',
};

/**
 * A dispatcher whose ObjectQL carries `objectDef` as the routed object's
 * schema. `standaloneAction` (when given) is served from the metadata
 * service's `load('action', …)` — the Studio-authored shape that never
 * appears inside any object definition.
 */
function makeDispatcher(opts: {
    objectDef?: any;
    automation?: any;
    standaloneAction?: any;
    registryAction?: any;
    record?: any;
    /** Simulate a metadata plane that cannot answer (ADR-0110 D3). */
    metadataDegraded?: string;
} = {}) {
    const executeAction = vi.fn(async () => ({ ran: 'script' }));
    const objectDef = opts.objectDef ?? { name: 'crm_lead', actions: [] };
    const ql: any = {
        executeAction,
        getSchema: (name: string) => (name === objectDef.name ? objectDef : undefined),
        registry: {
            getObject: (name: string) => (name === objectDef.name ? objectDef : undefined),
            getItem: (type: string, name: string) =>
                type === 'action' && opts.registryAction?.name === name ? opts.registryAction : undefined,
        },
        find: vi.fn(async () => (opts.record ? [opts.record] : [])),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async (type: string, name: string) =>
            type === 'action' && opts.standaloneAction?.name === name ? opts.standaloneAction : null),
        // The real MetadataManager reports whether a `null` is a clean miss or
        // an unanswerable one (every loader threw) — the D3 trichotomy needs
        // that distinction, so the double carries it too.
        loadDiagnosed: vi.fn(async (type: string, name: string) => ({
            data: type === 'action' && opts.standaloneAction?.name === name ? opts.standaloneAction : null,
            degraded: Boolean(opts.metadataDegraded),
            errors: opts.metadataDegraded ? [opts.metadataDegraded] : [],
        })),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql
                : n === 'metadata' ? metadata
                : n === 'automation' ? (opts.automation ?? null)
                : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), executeAction, ql };
}

const ctxFor = (executionContext: any = { userId: 'u1', systemPermissions: [] }): any => ({
    request: {},
    environmentId: 'platform',
    executionContext,
});

describe('REST /actions — flow dispatch (#3915)', () => {
    it('dispatches a `type: flow` action to the automation service instead of the script registry', async () => {
        const execute = vi.fn(async () => ({ success: true, output: { converted: true } }));
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [flowAction] },
            automation: { execute },
            record: { id: 'lead_1', status: 'open' },
        });

        const res = await dispatcher.handleActions(
            '/crm_lead/convert_lead/lead_1',
            'POST',
            { params: { reason: 'qualified' } },
            ctxFor(),
        );

        expect(executeAction).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalledWith(
            'crm_convert_lead_wizard',
            expect.objectContaining({
                object: 'crm_lead',
                record: expect.objectContaining({ id: 'lead_1' }),
                // Record fields seed the flow's named `isInput` variables;
                // explicit action params win on clash (parity with MCP).
                params: expect.objectContaining({ reason: 'qualified', id: 'lead_1' }),
            }),
        );
        expect(res.response.status).toBe(200);
        // Single wrap (#3962): `data` is the automation engine's own result.
        expect(res.response.body.data).toEqual({ success: true, output: { converted: true } });
    });

    // ── params seeding ── the half a mocked automation service could not
    // catch. Found by invoking the CRM's real `crm_convert_lead` against a
    // running server: the bag carried the record's `id` but never `recordId`,
    // so the flow's `get_lead` node died on `{recordId}` resolving to nothing
    // while `/automation/crm_convert_lead_wizard/trigger` ran the same flow
    // fine. Invoking the ACTION and triggering its FLOW must land the same run.
    it('seeds the row id under `recordId` and the `<objectName>Id` alias, like the trigger route', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [flowAction] },
            automation: { execute },
            record: { id: 'lead_1', company: 'Radium Labs' },
        });

        await dispatcher.handleActions('/crm_lead/convert_lead/lead_1', 'POST', {}, ctxFor());

        expect(execute.mock.calls[0]?.[1]).toMatchObject({
            params: { id: 'lead_1', recordId: 'lead_1', crmLeadId: 'lead_1', company: 'Radium Labs' },
        });
    });

    it('honours a declared `recordIdParam` naming a key of its own', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher } = makeDispatcher({
            objectDef: {
                name: 'crm_lead',
                actions: [{ ...flowAction, recordIdParam: 'leadToConvert' }],
            },
            automation: { execute },
            record: { id: 'lead_1' },
        });

        await dispatcher.handleActions('/crm_lead/convert_lead/lead_1', 'POST', {}, ctxFor());

        expect((execute.mock.calls[0]?.[1] as any).params).toMatchObject({
            leadToConvert: 'lead_1',
            recordId: 'lead_1',
        });
    });

    it('seeds from `recordIdField` when the declaration wants a non-id value', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher } = makeDispatcher({
            objectDef: {
                name: 'crm_lead',
                actions: [{ ...flowAction, recordIdParam: 'token', recordIdField: 'session_token' }],
            },
            automation: { execute },
            record: { id: 'lead_1', session_token: 'tok_abc' },
        });

        await dispatcher.handleActions('/crm_lead/convert_lead/lead_1', 'POST', {}, ctxFor());

        expect((execute.mock.calls[0]?.[1] as any).params.token).toBe('tok_abc');
    });

    it('lets an explicit param win over every seeded key', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [flowAction] },
            automation: { execute },
            record: { id: 'lead_1' },
        });

        await dispatcher.handleActions(
            '/crm_lead/convert_lead/lead_1',
            'POST',
            { params: { recordId: 'explicit_override' } },
            ctxFor(),
        );

        expect((execute.mock.calls[0]?.[1] as any).params.recordId).toBe('explicit_override');
    });

    it('seeds `recordId` from the URL even when the record never loaded', async () => {
        // New-record / unreadable-record invocations pass an empty record; the
        // flow still needs the id the caller named.
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [flowAction] },
            automation: { execute },
            // no `record` → the best-effort load returns nothing
        });

        await dispatcher.handleActions('/crm_lead/convert_lead/lead_404', 'POST', {}, ctxFor());

        expect((execute.mock.calls[0]?.[1] as any).params.recordId).toBe('lead_404');
    });

    it('forwards the caller identity so a `runAs: user` flow enforces RLS as the invoker', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [flowAction] },
            automation: { execute },
        });

        await dispatcher.handleActions('/crm_lead/convert_lead', 'POST', {}, ctxFor({
            userId: 'user_42',
            positions: ['sales_rep'],
            permissions: ['convert_lead'],
            tenantId: 'org_acme',
            systemPermissions: [],
        }));

        expect(execute).toHaveBeenCalledWith(
            'crm_convert_lead_wizard',
            expect.objectContaining({
                userId: 'user_42',
                positions: ['sales_rep'],
                permissions: ['convert_lead'],
                tenantId: 'org_acme',
            }),
        );
    });

    it('omits `object` for a wildcard (`/actions/global/:action`) flow action', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const globalFlow = { name: 'nightly_sync', type: 'flow', target: 'sync_flow' };
        const { dispatcher } = makeDispatcher({
            objectDef: { name: 'global', actions: [globalFlow] },
            automation: { execute },
        });

        await dispatcher.handleActions('/global/nightly_sync', 'POST', {}, ctxFor());

        const passed = execute.mock.calls[0]?.[1] as any;
        expect(passed).not.toHaveProperty('object');
    });

    it('surfaces a flow failure through the action error envelope', async () => {
        const execute = vi.fn(async () => ({ success: false, error: 'lead already converted' }));
        const { dispatcher } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [flowAction] },
            automation: { execute },
        });

        const res = await dispatcher.handleActions('/crm_lead/convert_lead', 'POST', {}, ctxFor());

        // A rejected flow is a 400 with the semantic code (#3962).
        expect(res.response.status).toBe(400);
        expect(res.response.body.error.message).toMatch(/crm_convert_lead_wizard.*lead already converted/i);
        expect(res.response.body.error.code).toBe('FLOW_FAILED');
    });

    it('reports a missing automation service as 503, not as a business failure', async () => {
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [flowAction] },
            automation: null,
        });

        const res = await dispatcher.handleActions('/crm_lead/convert_lead', 'POST', {}, ctxFor());

        expect(res.response.status).toBe(503);
        expect(res.response.body.error.message).toMatch(/no automation service/i);
        expect(executeAction).not.toHaveBeenCalled();
    });
});

describe('REST /actions — client-side action types (#3915)', () => {
    const cases: Array<[string, any, RegExp]> = [
        ['modal', { name: 'quick_view', type: 'modal', target: 'lead_gallery' }, /type: 'modal'/],
        ['url', { name: 'open_docs', type: 'url', target: 'https://docs.example' }, /type: 'url'/],
        ['form', { name: 'log_time', type: 'form', target: 'crm_lead.edit' }, /type: 'form'/],
    ];

    for (const [type, action, expected] of cases) {
        it(`rejects a \`type: ${type}\` action with an actionable 400 instead of a registry miss`, async () => {
            const { dispatcher, executeAction } = makeDispatcher({
                objectDef: { name: 'crm_lead', actions: [action] },
            });

            const res = await dispatcher.handleActions(`/crm_lead/${action.name}`, 'POST', {}, ctxFor());

            expect(res.response.status).toBe(400);
            expect(res.response.body.error.message).toMatch(expected);
            expect(res.response.body.error.message).not.toMatch(/not found/i);
            expect(executeAction).not.toHaveBeenCalled();
        });
    }

    it('keeps the ADR-0066 D4 gate AHEAD of the type check (403 wins over 400)', async () => {
        // An unauthorized caller must not learn how an action dispatches.
        const { dispatcher } = makeDispatcher({
            objectDef: {
                name: 'crm_lead',
                actions: [{
                    name: 'quick_view',
                    type: 'modal',
                    target: 'lead_gallery',
                    requiredPermissions: ['manage_platform_settings'],
                }],
            },
        });

        const res = await dispatcher.handleActions('/crm_lead/quick_view', 'POST', {}, ctxFor());

        expect(res.response.status).toBe(403);
    });

    it('points a `type: api` action at the endpoint it actually dispatches on', async () => {
        const apiAction = {
            name: 'create_team',
            type: 'api',
            target: '/api/v1/auth/organization/create-team',
            method: 'POST',
        };
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: { name: 'sys_team', actions: [apiAction] },
        });

        const res = await dispatcher.handleActions('/sys_team/create_team', 'POST', {}, ctxFor());

        expect(res.response.status).toBe(400);
        expect(res.response.body.error.message).toContain('/api/v1/auth/organization/create-team');
        expect(executeAction).not.toHaveBeenCalled();
    });
});

describe('REST /actions — script dispatch is unchanged (#3915 regression guard)', () => {
    it('still runs a declared `type: script` action through the handler registry', async () => {
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: {
                name: 'crm_lead',
                actions: [{ name: 'mark_done', type: 'script', target: 'markDone' }],
            },
        });

        const res = await dispatcher.handleActions('/crm_lead/mark_done', 'POST', {}, ctxFor());

        expect(executeAction).toHaveBeenCalledTimes(1);
        expect(res.response.body.data).toEqual({ ran: 'script' });
    });

    // [ADR-0110 D3] An UNDECLARED action used to run here, ungated — this test
    // asserted exactly that. A handler with no declaration has no
    // `requiredPermissions` to enforce, no param contract, and materialises no
    // `action_<name>` tool, yet it executes TRUSTED; it now refuses.
    it('refuses an UNDECLARED action with a prescriptive error instead of running it ungated', async () => {
        const { dispatcher, executeAction } = makeDispatcher({ objectDef: { name: 'crm_lead', actions: [] } });

        const res = await dispatcher.handleActions('/crm_lead/handler_only', 'POST', {}, ctxFor());

        expect(res.response.status).toBe(404);
        expect(res.response.body.error.message).toMatch(/has no declaration/i);
        expect(res.response.body.error.message).toMatch(/defineAction\(\{ name: 'handler_only'/);
        // The way out is the boot inventory, not a flag.
        expect(res.response.body.error.message).toMatch(/\[action-governance\]/);
        expect(executeAction).not.toHaveBeenCalled();
    });

    // The refusal has NO opt-out. A draft of ADR-0110 shipped
    // `OS_ALLOW_UNDECLARED_ACTIONS` as a migration valve; it was dropped before
    // 17 went out, because a flag that runs an ungoverned handler IS the
    // fail-open the ruling closes. This pins that no environment variable
    // resurrects the old behaviour — the failure a stale deployment script
    // would otherwise produce is silent re-opening, not a loud error.
    it('refuses regardless of the retired OS_ALLOW_UNDECLARED_ACTIONS flag', async () => {
        const prev = process.env.OS_ALLOW_UNDECLARED_ACTIONS;
        process.env.OS_ALLOW_UNDECLARED_ACTIONS = '1';
        try {
            const { dispatcher, executeAction } = makeDispatcher({ objectDef: { name: 'crm_lead', actions: [] } });

            const res = await dispatcher.handleActions('/crm_lead/handler_only', 'POST', {}, ctxFor());

            expect(res.response.status).toBe(404);
            expect(executeAction).not.toHaveBeenCalled();
        } finally {
            if (prev === undefined) delete process.env.OS_ALLOW_UNDECLARED_ACTIONS;
            else process.env.OS_ALLOW_UNDECLARED_ACTIONS = prev;
        }
    });

    // [ADR-0110 D3] An unreachable metadata plane must not read as "no
    // declaration, hence no gate" — an availability failure would silently
    // widen access. Same posture as v17's datasource-that-cannot-connect.
    it('503s rather than running ungated when the metadata plane cannot answer', async () => {
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [] },
            metadataDegraded: 'database-loader: ECONNREFUSED',
        });

        const res = await dispatcher.handleActions('/crm_lead/mark_done', 'POST', {}, ctxFor());

        expect(res.response.status).toBe(503);
        expect(res.response.body.error.message).toMatch(/metadata plane is unavailable/i);
        expect(res.response.body.error.message).toContain('ECONNREFUSED');
        expect(executeAction).not.toHaveBeenCalled();
    });
});

describe('REST /actions — standalone declarations (#3915)', () => {
    // A `defineAction` artifact / Studio-authored `action` row never appears in
    // any object's `actions[]`, and `resyncAuthoredActions` registers NO handler
    // for a flow-typed one ("no body (target/flow/url action)") — so before the
    // fix these were exactly the reported symptom: dispatch fell to the registry
    // and 'not found' came back.
    it('dispatches a flow action declared as a standalone ObjectQL registry artifact', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [] },
            registryAction: flowAction,
            automation: { execute },
        });

        await dispatcher.handleActions('/crm_lead/convert_lead', 'POST', {}, ctxFor());

        expect(execute).toHaveBeenCalledWith('crm_convert_lead_wizard', expect.anything());
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('dispatches a flow action declared as a Studio-authored `action` metadata row', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [] },
            standaloneAction: flowAction,
            automation: { execute },
        });

        await dispatcher.handleActions('/crm_lead/convert_lead', 'POST', {}, ctxFor());

        expect(execute).toHaveBeenCalledWith('crm_convert_lead_wizard', expect.anything());
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('ignores a standalone declaration owned by a DIFFERENT object', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: { name: 'crm_contact', actions: [] },
            standaloneAction: flowAction, // objectName: 'crm_lead'
            automation: { execute },
        });

        const res = await dispatcher.handleActions('/crm_contact/convert_lead', 'POST', {}, ctxFor());

        // Another object's declaration must not gate or dispatch this route.
        expect(execute).not.toHaveBeenCalled();
        // [ADR-0110 D3] It used to fall through to the registry and run
        // ungated; with no declaration OWNED BY THIS ROUTE there is nothing to
        // enforce, so it refuses.
        expect(res.response.status).toBe(404);
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('enforces the ADR-0066 D4 capability gate on a standalone declaration too', async () => {
        // The gate read only `object.actions[]` before, so a standalone
        // declaration's `requiredPermissions` was declared-but-unenforced on
        // REST while MCP honoured it.
        const execute = vi.fn(async () => ({ success: true }));
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [] },
            standaloneAction: { ...flowAction, requiredPermissions: ['manage_platform_settings'] },
            automation: { execute },
        });

        const res = await dispatcher.handleActions('/crm_lead/convert_lead', 'POST', {}, ctxFor({
            userId: 'u1',
            systemPermissions: [],
        }));

        expect(res.response.status).toBe(403);
        expect(execute).not.toHaveBeenCalled();
        expect(executeAction).not.toHaveBeenCalled();
    });
});
