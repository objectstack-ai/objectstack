// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12160] ADR-0126 §8 item 2 — a packaged ACTION switched off for this
// installation is refused AT DISPATCH, on every door that dispatches one.
//
// ## Why this file is organised per DOOR
//
// The flow leg could pin its consult once: `execute()` is "the one seam every
// entry path crosses". Actions have no such seam that can answer the question —
// the two primitives underneath (`ql.executeAction`, `dispatchFlowAction`) are
// addressed by HANDLER KEY and by target flow name, and ADR-0110 D2 is explicit
// that a registration key is not an action's identity. So the consult sits
// where a resolved DECLARATION exists — the REST `/actions` route and the MCP
// `run_action` bridge — and the ADR's own rule for that shape is "a test per
// door". Both doors call ONE function (`disabledActionRefusal`), which is what
// keeps them from drifting; these tests are what prove each one calls it.
//
// ## What each case asserts, and why the negative half is not optional
//
// Every refusal asserts `status` AND `code` (the ADR-0112 envelope) AND that
// nothing dispatched — a gate that refused after the handler ran would satisfy
// a status-only assertion and still be the defect. And the enabled-by-absence
// cases are pinned just as hard: a stock boot has no ledger rows, so a
// projection that defaulted the other way would switch off every action in
// every deployment, which is the one regression this feature could cause.

import { describe, it, expect, vi } from 'vitest';
import type { AutomationResult } from '@objectstack/spec/contracts';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { invokeBusinessAction, disabledActionRefusal } from '../action-execution.js';

const OBJECT = 'crm_lead';
/**
 * A script action the MCP bridge can actually reach: it needs a handler
 * binding (`target` or `body`) to be headless-invokable, and `ai.exposed` to
 * clear the #2849 exposure gate. Both are gates the activation consult sits
 * BEHIND, so a fixture that failed them would test nothing about the ledger —
 * it would only re-test the gates in front of it.
 */
const SCRIPT_ACTION = {
    name: 'convert_lead', label: 'Convert Lead', objectName: OBJECT, type: 'script',
    target: 'convert_lead_impl',
    ai: { exposed: true, description: 'Convert a qualified lead.' },
};
const FLOW_ACTION = {
    name: 'route_lead', label: 'Route Lead', objectName: OBJECT, type: 'flow', target: 'crm_lead_router',
};
const GATED_ACTION = {
    name: 'purge_lead', label: 'Purge Lead', objectName: OBJECT, type: 'script',
    requiredPermissions: ['manage_data'],
};

/**
 * One deployment, both doors — the shape the real composition presents: the
 * engine carries the activation projection (ADR-0110 D5's "the engine plugin is
 * the component unconditionally present wherever actions execute"), and every
 * door reaches it through the `ql` it already holds.
 *
 * `disabled` is the ledger's answer, spelled as the projection's own two
 * members so the doubles cannot be looser than the engine they stand in for.
 * `legacyEngine` drops both members entirely — an older engine, or a host that
 * never attached a store — which must behave exactly like a stock boot.
 */
function boot(opts: { disabled?: string[]; legacyEngine?: boolean; flowResult?: AutomationResult } = {}) {
    const disabled = new Set(opts.disabled ?? []);
    const executeAction = vi.fn(async () => ({ ran: 'script' }));
    const execute = vi.fn(async (): Promise<AutomationResult> => opts.flowResult ?? { success: true, output: {} });

    const objectDef = { name: OBJECT, actions: [SCRIPT_ACTION, FLOW_ACTION, GATED_ACTION] };
    const ql: any = {
        executeAction,
        getSchema: (name: string) => (name === OBJECT ? objectDef : undefined),
        registry: { getObject: (name: string) => (name === OBJECT ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    if (!opts.legacyEngine) {
        ql.isActionEnabled = (name: string) => !disabled.has(name);
        ql.describeDisabledAction = (name: string) =>
            `Action '${name}' is disabled — it is switched off for this installation in the packaged-metadata ` +
            `activation ledger (sys_metadata_activation, ADR-0126 §8). Re-enable the packaged action to arm it again, ` +
            `or author your own action instead.`;
    }

    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const automation: any = { handlerReady: true, execute, getFlow: vi.fn(async () => ({ name: FLOW_ACTION.target })) };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : n === 'automation' ? automation
        : null;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (n: string) => resolve(n),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), ql, executeAction, execute, metadata };
}

const CTX = (systemPermissions: string[] = []): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_member', systemPermissions },
} as unknown as HttpProtocolContext);

const statusOf = (r: any): unknown => r?.response?.status;
const codeOf = (r: any): unknown => r?.response?.body?.error?.code ?? r?.response?.body?.error?.details?.code;
const messageOf = (r: any): string => String(r?.response?.body?.error?.message ?? '');

describe('door 1 — REST `POST /actions/:object/:action`', () => {
    it('refuses a DISABLED packaged action 409 ACTION_DISABLED, and never dispatches it', async () => {
        const { dispatcher, executeAction } = boot({ disabled: [SCRIPT_ACTION.name] });

        const res = await dispatcher.handleActions(`/${OBJECT}/${SCRIPT_ACTION.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(409);
        expect(codeOf(res)).toBe('ACTION_DISABLED');
        // The load-bearing half: refused BEFORE the handler. A body that ran
        // and was then refused would satisfy the two assertions above and still
        // be the defect — action bodies execute TRUSTED (RLS/FLS-bypassing).
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('the refusal names the ledger, the ADR and the remedy — ⛔ and never a clone', async () => {
        const { dispatcher } = boot({ disabled: [SCRIPT_ACTION.name] });

        const message = messageOf(await dispatcher.handleActions(
            `/${OBJECT}/${SCRIPT_ACTION.name}`, 'POST', {}, CTX(),
        ));

        expect(message).toContain('sys_metadata_activation');
        expect(message).toContain('ADR-0126 §8');
        expect(message).toContain('Re-enable the packaged action');
        // Action-clone is NOT chartered (§8 item 2) — the sentence must not
        // advertise machinery that does not exist.
        expect(message).not.toMatch(/clone/i);
    });

    it('an ENABLED action is untouched — a stock boot dispatches exactly as before', async () => {
        const { dispatcher, executeAction } = boot({ disabled: ['some_other_action'] });

        const res = await dispatcher.handleActions(`/${OBJECT}/${SCRIPT_ACTION.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(200);
        expect(executeAction).toHaveBeenCalledTimes(1);
    });

    it('an engine with NO projection behaves as a stock boot (absence means ACTIVE)', async () => {
        const { dispatcher, executeAction } = boot({ legacyEngine: true });

        const res = await dispatcher.handleActions(`/${OBJECT}/${SCRIPT_ACTION.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(200);
        expect(executeAction).toHaveBeenCalledTimes(1);
    });

    it('a disabled `type: flow` action is refused by its OWN switch, and the flow never runs', async () => {
        const { dispatcher, execute } = boot({ disabled: [FLOW_ACTION.name] });

        const res = await dispatcher.handleActions(`/${OBJECT}/${FLOW_ACTION.name}`, 'POST', {}, CTX());

        // Not FLOW_DISABLED: the target flow is armed, the ACTION is not, and
        // answering with the flow's code would send an operator to the wrong
        // artifact entirely.
        expect(statusOf(res)).toBe(409);
        expect(codeOf(res)).toBe('ACTION_DISABLED');
        expect(execute).not.toHaveBeenCalled();
    });

    it('an unentitled caller still gets 403 — the switch is not an oracle', async () => {
        // Ordering pin: the ADR-0066 D4 capability gate runs BEFORE the
        // activation consult, so a caller who may not invoke the action cannot
        // use the response to learn which packaged actions this installation
        // has switched off.
        const { dispatcher, executeAction } = boot({ disabled: [GATED_ACTION.name] });

        const res = await dispatcher.handleActions(`/${OBJECT}/${GATED_ACTION.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(403);
        expect(codeOf(res)).not.toBe('ACTION_DISABLED');
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('an entitled caller gets the activation refusal for the same action', async () => {
        const { dispatcher, executeAction } = boot({ disabled: [GATED_ACTION.name] });

        const res = await dispatcher.handleActions(
            `/${OBJECT}/${GATED_ACTION.name}`, 'POST', {}, CTX(['manage_data']),
        );

        expect(statusOf(res)).toBe(409);
        expect(codeOf(res)).toBe('ACTION_DISABLED');
        expect(executeAction).not.toHaveBeenCalled();
    });
});

describe('door 2 — the MCP `run_action` bridge', () => {
    /**
     * The bridge's own wiring, as `domains/mcp.ts` assembles it: the resolved
     * ObjectQL, the metadata service and the caller's ExecutionContext. Driving
     * `invokeBusinessAction` directly is what pins THIS door rather than the
     * REST one — the two share the guard, not the call path.
     */
    const runViaMcp = async (h: ReturnType<typeof boot>, name: string) => {
        const deps: any = {
            resolveService: async (_ctx: unknown, service: string) =>
                (service === 'metadata' ? h.metadata : service === 'automation' ? null : h.ql),
            getObjectQL: async () => h.ql,
        };
        return invokeBusinessAction(
            deps, CTX() as any, name, {},
            {
                driver: h.ql,
                ec: { userId: 'u_agent', systemPermissions: [] },
                getMeta: () => h.metadata,
                callData: async () => ({}),
            },
        );
    };

    it('refuses a DISABLED packaged action with the ADR-0112 envelope, and never dispatches', async () => {
        const h = boot({ disabled: [SCRIPT_ACTION.name] });

        const thrown = await runViaMcp(h, SCRIPT_ACTION.name).catch((e) => e);

        expect(thrown).toBeInstanceOf(Error);
        // `code` + `status` ride the throw so the bridge answers a clean
        // tool-error and `resolveThrownHttpError` serves the same 409 the REST
        // door serves — one refusal, two transports.
        expect((thrown as any).code).toBe('ACTION_DISABLED');
        expect((thrown as any).status).toBe(409);
        expect(String(thrown.message)).toContain('sys_metadata_activation');
        expect(h.executeAction).not.toHaveBeenCalled();
    });

    it('an ENABLED action still runs through the bridge', async () => {
        const h = boot({ disabled: ['some_other_action'] });

        const result: any = await runViaMcp(h, SCRIPT_ACTION.name);

        expect(result?.ok).toBe(true);
        expect(h.executeAction).toHaveBeenCalledTimes(1);
    });
});

describe('the shared guard itself', () => {
    it('is silent for an engine that cannot answer, and for a nameless declaration', () => {
        const deps: any = {};

        expect(disabledActionRefusal(deps, {}, SCRIPT_ACTION)).toBeUndefined();
        expect(disabledActionRefusal(deps, { isActionEnabled: () => false }, {})).toBeUndefined();
    });

    it('answers 409 ACTION_DISABLED with the ENGINE\'s own sentence', () => {
        const ql = {
            isActionEnabled: () => false,
            describeDisabledAction: (n: string) => `bespoke sentence for ${n}`,
        };

        const refusal = disabledActionRefusal({} as any, ql, SCRIPT_ACTION);

        expect(refusal).toEqual({
            code: 'ACTION_DISABLED',
            status: 409,
            message: `bespoke sentence for ${SCRIPT_ACTION.name}`,
        });
    });
});
