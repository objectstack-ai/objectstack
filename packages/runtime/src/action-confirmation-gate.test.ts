// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#15942 / #16293 / ADR-0049] `ai.requiresConfirmation` is ENFORCED at the
// AI-facing action door — the gate half of the confirmation contract.
//
// ## What was wrong
//
// The flag was read in exactly one place and consumed in exactly one place:
// `actionLooksDestructive` → the `list_actions` summary. `run_action` never
// consulted it. An author read the spec sentence promising a pause, set the
// flag, saw it accepted, saw it echoed truthfully in the listing, and shipped
// believing a human was in the loop — every intermediate signal green, only
// the last thing not happening. That is the class ADR-0049 retired
// `tool.requiresConfirmation` for, reappearing on the very key the
// retirement's own ledger entry pointed authors at.
//
// ## What every case here owes
//
// A refusal asserts the ADR-0112 envelope — `code` AND `status` — AND that
// NOTHING dispatched AND that no record was read. A gate that refused after
// the subject load, or after the handler ran, satisfies a code-only assertion
// and is still the defect. `expect(...).toThrow()` alone would be satisfied by
// any unrelated failure and is not used.
//
// And the acceptance half is pinned just as hard: an action that declares
// nothing, or declares `false`, must keep running exactly as it does today.
// This change NARROWS a published accept set, so the one regression it could
// cause is refusing calls no author ever asked to gate — which is what the
// heuristic cases below exist to catch.

import { describe, it, expect, vi } from 'vitest';

import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';

import type { HttpProtocolContext } from './http-dispatcher.js';
import {
    invokeBusinessAction,
    actionConfirmationRefusal,
    actionLooksDestructive,
    ACTION_CONFIRMATION_REQUIRED_CODE,
    ACTION_CONFIRMATION_REQUIRED_STATUS,
} from './action-execution.js';

const OBJECT = 'crm_lead';

/** Author-gated: `ai.requiresConfirmation: true`, declared on purpose. */
const GATED = {
    name: 'archive_lead', label: 'Archive Lead', objectName: OBJECT, type: 'script',
    target: 'archive_lead_impl',
    ai: { exposed: true, description: 'Archive a lead.', requiresConfirmation: true },
};
/** Ungated, and DESTRUCTIVE-LOOKING — the heuristic must not gate it. */
const LOOKS_DESTRUCTIVE = {
    name: 'delete_lead', label: 'Delete Lead', objectName: OBJECT, type: 'script',
    target: 'delete_lead_impl', mode: 'delete',
    ai: { exposed: true, description: 'Delete a lead.' },
};
/** The author's explicit `false` — "safe unattended", and it overrides the heuristic. */
const DECLARED_SAFE = {
    name: 'purge_lead', label: 'Purge Lead', objectName: OBJECT, type: 'script',
    target: 'purge_lead_impl', variant: 'danger',
    ai: { exposed: true, description: 'Purge a lead.', requiresConfirmation: false },
};
/** A gated FLOW action — the gate must sit ahead of `dispatchFlowAction` too. */
const GATED_FLOW = {
    name: 'route_lead', label: 'Route Lead', objectName: OBJECT, type: 'flow', target: 'crm_lead_router',
    ai: { exposed: true, description: 'Route a lead.', requiresConfirmation: true },
};

function boot() {
    const executeAction = vi.fn(async () => ({ ran: 'script' }));
    const execute = vi.fn(async () => ({ success: true, output: {} }));
    // The subject-record read. Its call count is the proof that a refusal
    // touched no data — "no record is read or written" is the contract's own
    // sentence about this gate.
    // The protocol's own shape: a found row arrives wrapped in `record`.
    const callData = vi.fn(async () => ({ record: { id: 'lead_1', name: 'Acme' } }));

    const objectDef = { name: OBJECT, actions: [GATED, LOOKS_DESTRUCTIVE, DECLARED_SAFE, GATED_FLOW] };
    const ql: any = {
        executeAction,
        getSchema: (n: string) => (n === OBJECT ? objectDef : undefined),
        registry: { getObject: (n: string) => (n === OBJECT ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => []), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const automation: any = { handlerReady: true, execute, getFlow: vi.fn(async () => ({ name: GATED_FLOW.target })) };
    return { ql, metadata, automation, executeAction, execute, callData };
}

const CTX = { request: {}, environmentId: 'platform', executionContext: { userId: 'u_agent' } } as unknown as HttpProtocolContext;

/** The MCP door, wired as `domains/mcp.ts` assembles it. */
const runViaMcp = (h: ReturnType<typeof boot>, name: string, input: Record<string, unknown> = {}) => {
    const deps: any = {
        resolveService: async (_c: unknown, service: string) =>
            (service === 'metadata' ? h.metadata : service === 'automation' ? h.automation : h.ql),
        getObjectQL: async () => h.ql,
    };
    return invokeBusinessAction(deps, CTX as any, name, input as any, {
        driver: h.ql,
        ec: { userId: 'u_agent', systemPermissions: [] },
        getMeta: () => h.metadata,
        callData: h.callData,
    });
};

describe('the AI-facing door refuses an unconfirmed call on a gated action (#15942)', () => {
    it('refuses with the ADR-0112 envelope, dispatches nothing, and reads no record', async () => {
        const h = boot();

        const thrown: any = await runViaMcp(h, GATED.name, { recordId: 'lead_1' }).catch((e) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.code).toBe(ACTION_CONFIRMATION_REQUIRED_CODE);
        expect(thrown.code).toBe('ACTION_CONFIRMATION_REQUIRED');
        expect(thrown.status).toBe(428);
        // The machine-readable retry, so a refused agent never re-parses prose.
        expect(thrown.details).toEqual({
            actionName: GATED.name,
            objectName: OBJECT,
            confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
        });
        // The prose still names both, for the human reading a transcript.
        expect(String(thrown.message)).toContain(GATED.name);
        expect(String(thrown.message)).toContain(AI_ACTION_CONFIRMATION_MEMBER);
        // Nothing ran, and nothing was read: the gate sits ahead of both.
        expect(h.executeAction).not.toHaveBeenCalled();
        expect(h.callData).not.toHaveBeenCalled();
    });

    it('runs the SAME call once the member rides on the request', async () => {
        const h = boot();

        const result: any = await runViaMcp(h, GATED.name, {
            recordId: 'lead_1',
            [AI_ACTION_CONFIRMATION_MEMBER]: true,
        });

        expect(result?.ok).toBe(true);
        expect(h.executeAction).toHaveBeenCalledTimes(1);
    });

    it('gates a FLOW action too — ahead of the type branch, so no run is created', async () => {
        const h = boot();

        const thrown: any = await runViaMcp(h, GATED_FLOW.name, {}).catch((e) => e);

        expect(thrown.code).toBe('ACTION_CONFIRMATION_REQUIRED');
        expect(thrown.status).toBe(428);
        expect(h.execute).not.toHaveBeenCalled();
        // Control: the same action DOES dispatch once confirmed, so the
        // assertion above is about the gate and not about a flow that never
        // could have run in this harness.
        await runViaMcp(h, GATED_FLOW.name, { [AI_ACTION_CONFIRMATION_MEMBER]: true });
        expect(h.execute).toHaveBeenCalledTimes(1);
    });

    it('admits ONLY the boolean `true` — a truthy string and `false` are not attestations', async () => {
        for (const value of ['true', 1, {}, false, null]) {
            const h = boot();
            const thrown: any = await runViaMcp(h, GATED.name, {
                [AI_ACTION_CONFIRMATION_MEMBER]: value,
            }).catch((e) => e);
            expect(thrown.code, `\`${JSON.stringify(value)}\` must not confirm`).toBe(
                'ACTION_CONFIRMATION_REQUIRED',
            );
            expect(h.executeAction).not.toHaveBeenCalled();
        }
    });
});

describe('the gate reads the DECLARED flag and never the listing heuristic (#15942)', () => {
    it('does NOT refuse an undeclared action the listing calls destructive', async () => {
        const h = boot();

        // Control, and the whole reason this case exists: the LISTING predicate
        // answers `true` for this action. If the two predicates were collapsed,
        // the call below would be refused — a call that works today, broken on
        // a guess its author never made.
        expect(actionLooksDestructive({} as any, LOOKS_DESTRUCTIVE)).toBe(true);

        const result: any = await runViaMcp(h, LOOKS_DESTRUCTIVE.name, { recordId: 'lead_1' });

        expect(result?.ok).toBe(true);
        expect(h.executeAction).toHaveBeenCalledTimes(1);
    });

    it('honours an explicit `false` on a danger-variant action', async () => {
        const h = boot();

        expect(actionLooksDestructive({} as any, DECLARED_SAFE)).toBe(false);
        const result: any = await runViaMcp(h, DECLARED_SAFE.name, { recordId: 'lead_1' });

        expect(result?.ok).toBe(true);
        expect(h.executeAction).toHaveBeenCalledTimes(1);
    });
});

describe('the shared refusal producer itself (#15942)', () => {
    const deps: any = {};

    it('is silent unless the author declared the flag as `true`', () => {
        expect(actionConfirmationRefusal(deps, LOOKS_DESTRUCTIVE, {}, OBJECT)).toBeUndefined();
        expect(actionConfirmationRefusal(deps, DECLARED_SAFE, {}, OBJECT)).toBeUndefined();
        expect(actionConfirmationRefusal(deps, {}, {}, OBJECT)).toBeUndefined();
        // Lit control on the same call: the one shape that DOES refuse.
        expect(actionConfirmationRefusal(deps, GATED, {}, OBJECT)?.code).toBe(
            ACTION_CONFIRMATION_REQUIRED_CODE,
        );
    });

    it('echoes the member off the CONTRACT constant, not a hand-spelled string', () => {
        const refusal = actionConfirmationRefusal(deps, GATED, undefined, OBJECT);

        expect(refusal).toMatchObject({
            code: ACTION_CONFIRMATION_REQUIRED_CODE,
            status: ACTION_CONFIRMATION_REQUIRED_STATUS,
            details: {
                actionName: GATED.name,
                objectName: OBJECT,
                confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
            },
        });
        // The status is the registered one, and the code is not a synonym the
        // door invented locally.
        expect(ACTION_CONFIRMATION_REQUIRED_STATUS).toBe(428);
    });

    it('omits `objectName` for an object-less action rather than emitting an empty one', () => {
        const refusal = actionConfirmationRefusal(deps, GATED, {}, undefined);

        expect(refusal?.details).toEqual({
            actionName: GATED.name,
            confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
        });
        expect('objectName' in (refusal?.details ?? {})).toBe(false);
    });
});
