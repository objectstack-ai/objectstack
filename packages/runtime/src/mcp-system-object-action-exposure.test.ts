// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27681] An action on a `sys_*` object is reachable over MCP only when the
 * action itself declares `ai: { exposed: true, description }` (ADR-0011).
 *
 * Maintainer ruling 6513869839 (letter B). Before it, the runtime refused
 * EVERY action on a `sys_*` object by name, ahead of the exposure check, at
 * the three MCP sites — `run_action` (`invokeBusinessAction`), the
 * `list_actions` bridge and the `resume_run` admission — so no declaration
 * could open one, while the REST `/actions` door served the same action to the
 * same principal. The name refusal now yields to the author's opt-in and to
 * nothing else, and every gate behind it still runs.
 *
 * What each block pins, all through the bridge `domains/mcp.ts` builds (the
 * one production `McpActionBridge`):
 *
 *   - UNFLAGGED `sys_*` action: not listed, refused by `run_action` with the
 *     system-object refusal, nothing dispatched — the fail-closed default holds;
 *   - FLAGGED (test-only declaration) `sys_*` action: listed with `aiExposed`,
 *     and run through EVERY gate behind the flag — the ADR-0066 D4 capability
 *     gate, the ADR-0126 §8 activation consult, the `ai.requiresConfirmation`
 *     gate — before it dispatches;
 *   - the listing and the run door agree, action by action.
 *
 * No platform `sys_*` action declares an `ai` block (ruling parameter 2,
 * amended: the declarations follow their own decision card). The objects here
 * are test doubles, never the platform identity objects.
 */

import { describe, it, expect, vi } from 'vitest';

import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';

import { HttpDispatcher } from './http-dispatcher.js';
import {
    systemObjectActionExposureError,
    ACTION_CONFIRMATION_REQUIRED_CODE,
    ACTION_CONFIRMATION_REQUIRED_STATUS,
    type ActionExecutionDeps,
} from './action-execution.js';

const SYS_OBJECT = 'sys_probe_account';
const APP_OBJECT = 'probe_app_task';

/** Flagged: the author opted it into the AI surface. Test-only declaration. */
const FLAGGED = {
    name: 'probe_suspend', label: 'Suspend', type: 'script', target: 'probe_suspend',
    ai: { exposed: true, description: 'Suspend a probe account.' },
};
/** Flagged AND author-gated for confirmation (the destructive shape). */
const FLAGGED_GATED = {
    name: 'probe_purge', label: 'Purge', type: 'script', target: 'probe_purge', mode: 'delete',
    ai: { exposed: true, description: 'Purge a probe account.', requiresConfirmation: true },
};
/** Flagged, capability-gated: the ADR-0066 D4 gate must still run behind the flag. */
const FLAGGED_CAPPED = {
    name: 'probe_reset', label: 'Reset', type: 'script', target: 'probe_reset',
    requiredPermissions: ['probe.reset'],
    ai: { exposed: true, description: 'Reset a probe account.' },
};
/** UNFLAGGED: no `ai` block — the platform identity actions' shape today. */
const UNFLAGGED = { name: 'probe_lock', label: 'Lock', type: 'script', target: 'probe_lock' };
/** Control: an exposed action on an ordinary object, unaffected by this change. */
const APP_ACTION = {
    name: 'probe_complete', label: 'Complete', type: 'script', target: 'probe_complete',
    ai: { exposed: true, description: 'Complete a task.' },
};

const SYS_ACTIONS = [FLAGGED, FLAGGED_GATED, FLAGGED_CAPPED, UNFLAGGED];

function harness(opts: { disabled?: readonly string[]; permissions?: readonly string[] } = {}) {
    const objects = [
        { name: SYS_OBJECT, label: 'Probe Account', fields: {}, actions: SYS_ACTIONS },
        { name: APP_OBJECT, label: 'Probe Task', fields: {}, actions: [APP_ACTION] },
    ];
    const byName = (n: string) => objects.find((o) => o.name === n);
    const handlers = new Set<string>([
        ...SYS_ACTIONS.map((a) => `${SYS_OBJECT}:${a.target}`),
        `${APP_OBJECT}:${APP_ACTION.target}`,
    ]);
    const executeAction = vi.fn(async (obj: string, key: string) => {
        if (!handlers.has(`${obj}:${key}`)) throw new Error(`Action '${key}' on object '${obj}' not found`);
        return { ran: `${obj}:${key}` };
    });
    const disabled = new Set(opts.disabled ?? []);
    const ql: any = {
        executeAction,
        listRegisteredActions: () => [...handlers].map((k) => ({
            objectName: k.slice(0, k.indexOf(':')), actionName: k.slice(k.indexOf(':') + 1),
        })),
        isActionEnabled: (name: string) => !disabled.has(name),
        describeDisabledAction: (name: string) => `Action '${name}' is switched off for this installation.`,
        getSchema: byName,
        registry: { getObject: byName, getItem: () => undefined },
        find: vi.fn(async () => [{ id: 'acct_1' }]),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => objects),
        getObject: vi.fn(async (n: string) => byName(n)),
    };
    const kernel: any = {
        context: {
            getService: (n: string) => (n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null),
        },
    };
    const ctx: any = {
        request: {},
        environmentId: 'platform',
        executionContext: { userId: 'u_agent', permissions: [], systemPermissions: [...(opts.permissions ?? [])] },
    };
    const bridge = (new HttpDispatcher(kernel) as any).buildMcpBridge(ctx);
    return { bridge, executeAction };
}

/** A refusal is asserted on its envelope, never on the throw alone. */
async function refusalOf(p: Promise<unknown>): Promise<any> {
    try {
        await p;
    } catch (e) {
        return e;
    }
    throw new Error('expected a refusal, the call ran');
}

describe('[#27681] the per-action predicate', () => {
    const deps = { resolveService: (async () => undefined) as any, getObjectQL: async () => null } as ActionExecutionDeps;

    it('refuses an unflagged action on a sys_* object, and only there', () => {
        expect(systemObjectActionExposureError(deps, UNFLAGGED, SYS_OBJECT)).toMatch(/system object/);
        expect(systemObjectActionExposureError(deps, UNFLAGGED, APP_OBJECT)).toBeNull();
    });

    it('yields to `ai.exposed: true` and to nothing else — a truthy non-boolean is not the opt-in', () => {
        expect(systemObjectActionExposureError(deps, FLAGGED, SYS_OBJECT)).toBeNull();
        const stringly = { ...UNFLAGGED, ai: { exposed: 'true', description: 'x' } };
        expect(systemObjectActionExposureError(deps, stringly, SYS_OBJECT)).toMatch(/system object/);
    });
});

describe('[#27681] list_actions: a sys_* action is listed exactly when its author exposed it', () => {
    it('lists the flagged sys_* actions (attested `aiExposed`) and hides the unflagged one', async () => {
        const { bridge } = harness({ permissions: ['probe.reset'] });
        const listed: any[] = await bridge.listActions();
        const sys = listed.filter((a) => a.objectName === SYS_OBJECT).map((a) => a.name).sort();
        expect(sys).toEqual(['probe_purge', 'probe_reset', 'probe_suspend']);
        for (const a of listed) expect(a.aiExposed, `${a.name} listed without the attestation`).toBe(true);
        // Control: the ordinary object's exposed action is listed as before.
        expect(listed.map((a) => a.name)).toContain('probe_complete');
    });

    it('a flagged sys_* action the caller lacks the capability for is NOT listed (D4 still filters behind the flag)', async () => {
        const { bridge } = harness();
        const names = (await bridge.listActions()).map((a: any) => a.name);
        expect(names).toContain('probe_suspend');
        expect(names).not.toContain('probe_reset');
    });
});

describe('[#27681] run_action: the unflagged sys_* action stays refused', () => {
    it('refuses with the system-object refusal and dispatches nothing', async () => {
        const { bridge, executeAction } = harness();
        const err = await refusalOf(bridge.runAction('probe_lock', { objectName: SYS_OBJECT, recordId: 'acct_1' }));
        expect(String(err?.message)).toMatch(/is on a system object \('sys_probe_account'\) and is not exposed via MCP/);
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('refuses it when resolved by name alone, too (no objectName to pre-screen on)', async () => {
        const { bridge, executeAction } = harness();
        const err = await refusalOf(bridge.runAction('probe_lock', { recordId: 'acct_1' }));
        expect(String(err?.message)).toMatch(/system object/);
        expect(executeAction).not.toHaveBeenCalled();
    });
});

describe('[#27681] run_action: the flagged sys_* action runs through every gate behind the flag', () => {
    it('runs when every gate admits it', async () => {
        const { bridge, executeAction } = harness();
        await expect(bridge.runAction('probe_suspend', { objectName: SYS_OBJECT, recordId: 'acct_1' }))
            .resolves.toMatchObject({ ok: true, action: 'probe_suspend', objectName: SYS_OBJECT });
        expect(executeAction).toHaveBeenCalledTimes(1);
    });

    it('the ADR-0066 D4 capability gate still refuses a caller without the capability', async () => {
        const { bridge, executeAction } = harness();
        const err = await refusalOf(bridge.runAction('probe_reset', { objectName: SYS_OBJECT, recordId: 'acct_1' }));
        expect(String(err?.message)).toMatch(/requires capability \[probe\.reset\]/);
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('the ADR-0126 §8 activation consult still refuses a switched-off action (409 ACTION_DISABLED)', async () => {
        const { bridge, executeAction } = harness({ disabled: ['probe_suspend'] });
        const err = await refusalOf(bridge.runAction('probe_suspend', { objectName: SYS_OBJECT, recordId: 'acct_1' }));
        expect(err).toMatchObject({ code: 'ACTION_DISABLED', status: 409 });
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('the HITL confirmation gate refuses an unconfirmed destructive call (428), and runs the confirmed one', async () => {
        const { bridge, executeAction } = harness();
        const err = await refusalOf(bridge.runAction('probe_purge', { objectName: SYS_OBJECT, recordId: 'acct_1' }));
        expect(err).toMatchObject({
            code: ACTION_CONFIRMATION_REQUIRED_CODE,
            status: ACTION_CONFIRMATION_REQUIRED_STATUS,
            details: { actionName: 'probe_purge', objectName: SYS_OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER },
        });
        expect(executeAction).not.toHaveBeenCalled();

        await expect(bridge.runAction('probe_purge', {
            objectName: SYS_OBJECT, recordId: 'acct_1', [AI_ACTION_CONFIRMATION_MEMBER]: true,
        })).resolves.toMatchObject({ ok: true, action: 'probe_purge' });
        expect(executeAction).toHaveBeenCalledTimes(1);
    });
});
