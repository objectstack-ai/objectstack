// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21321 — MCP `list_actions` advertises a `script` action only when a handler
 * is registered for it: ONE source for advertising and for running.
 *
 * The run doors (MCP `run_action`, REST `/actions`) dispatch a script action
 * through `executeRegisteredAction`, which rotates the action's handler-key
 * candidates over the engine's handler Map. The listing used to admit a script
 * action on DECLARATION presence (`target || body`), so a declaration nothing
 * had bound — measured: an `os package install`ed package — was advertised by
 * `list_actions` and refused by `run_action` ("No handler registered"), the
 * NEG1 failure of the `ai.mcp-run-action-exposure-gate` checklist item.
 *
 * The listing now asks `registeredActionHandlerProbe`, which reads the engine's
 * public `listRegisteredActions()` and walks the SAME rotation
 * (`actionHandlerObjectKeys` × `resolveActionHandlerKeys`) the run door walks.
 * Each case below pairs the listing with the run door on the same engine, so
 * the pin is the agreement, not either half alone. The engine double keeps ONE
 * Map and answers both `executeAction` and `listRegisteredActions` from it.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';

const exposed = (description: string) => ({ exposed: true, description });

/** Bound by its declarative name (the body shape `AppPlugin` registers). */
const BODY_ACTION = {
    name: 'complete_task', label: 'Complete', objectName: 'tasks_app_task', type: 'script',
    body: { language: 'js', source: 'return { ok: true };' }, ai: exposed('Mark a task complete.'),
};
/** Bound by its `target` (the shape user code registers imperatively). */
const TARGET_ACTION = {
    name: 'reopen_task', label: 'Reopen', objectName: 'tasks_app_task', type: 'script',
    target: 'reopenTask', ai: exposed('Reopen a task.'),
};
/** A flow action — dispatched by the automation service, never the handler Map. */
const FLOW_ACTION = {
    name: 'escalate_task', label: 'Escalate', objectName: 'tasks_app_task', type: 'flow',
    target: 'escalate_flow', ai: exposed('Escalate a task.'),
};

function makeBridge(registered: Array<[object: string, key: string]>, opts: { enumerable?: boolean } = {}) {
    const object = {
        name: 'tasks_app_task', label: 'Task', fields: {},
        actions: [BODY_ACTION, TARGET_ACTION, FLOW_ACTION],
    };
    const handlers = new Map<string, (ctx: any) => unknown>();
    for (const [obj, key] of registered) handlers.set(`${obj}:${key}`, () => ({ ran: `${obj}:${key}` }));
    const ql: any = {
        registry: { getObject: () => object },
        find: vi.fn(async () => [{ id: 'r1' }]),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
        executeAction: vi.fn(async (obj: string, key: string, ctx: any) => {
            const h = handlers.get(`${obj}:${key}`);
            if (!h) throw new Error(`Action '${key}' on object '${obj}' not found`);
            return h(ctx);
        }),
        ...(opts.enumerable === false ? {} : {
            listRegisteredActions: () => [...handlers.keys()].map((k) => ({
                objectName: k.slice(0, k.indexOf(':')), actionName: k.slice(k.indexOf(':') + 1),
            })),
        }),
    };
    const metadata: any = {
        listObjects: vi.fn(async () => [object]),
        getObject: vi.fn(async () => object),
    };
    const automation = { execute: vi.fn(async () => ({ success: true })) };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : n === 'automation' ? automation : null,
        },
    };
    const ctx: any = { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } };
    return (new HttpDispatcher(kernel) as any).buildMcpBridge(ctx);
}

const listedNames = async (bridge: any): Promise<string[]> => (await bridge.listActions()).map((a: any) => a.name);

describe('#21321: list_actions advertises a script action only when run_action can run it', () => {
    it('THE DEFECT — a declared body action with no registered handler is not advertised, and run_action refuses it', async () => {
        const bridge = makeBridge([]);
        expect(await listedNames(bridge), 'advertised an action the run door cannot dispatch').not.toContain('complete_task');
        await expect(bridge.runAction('complete_task', { recordId: 'r1' })).rejects.toThrow(/No handler registered/);
    });

    it('CONTROL — the same action, bound by name, is advertised and runs', async () => {
        const bridge = makeBridge([['tasks_app_task', 'complete_task']]);
        expect(await listedNames(bridge)).toContain('complete_task');
        await expect(bridge.runAction('complete_task', { recordId: 'r1' })).resolves.toMatchObject({ ok: true });
    });

    it('the probe walks the run door’s key candidates — a target-bound handler counts, its bare name does not', async () => {
        expect(await listedNames(makeBridge([['tasks_app_task', 'reopenTask']]))).toContain('reopen_task');
        // Registered under a key no candidate derives: the run door misses it, so the listing must too.
        const stray = makeBridge([['tasks_app_task', 'reopenTaskV2']]);
        expect(await listedNames(stray)).not.toContain('reopen_task');
        await expect(stray.runAction('reopen_task', { recordId: 'r1' })).rejects.toThrow(/No handler registered/);
    });

    it('the probe walks the run door’s OBJECT rotation — a handler on the object-less key counts', async () => {
        const bridge = makeBridge([['global', 'complete_task']]);
        expect(await listedNames(bridge)).toContain('complete_task');
        await expect(bridge.runAction('complete_task', { recordId: 'r1' })).resolves.toMatchObject({ ok: true });
    });

    it('CONTROL — a flow action is not gated on the handler Map (its dispatcher is the automation service)', async () => {
        expect(await listedNames(makeBridge([]))).toContain('escalate_task');
    });

    it('an engine that cannot enumerate its handlers advertises no script action — the listing cannot vouch for one', async () => {
        const names = await listedNames(makeBridge([['tasks_app_task', 'complete_task']], { enumerable: false }));
        expect(names).not.toContain('complete_task');
        expect(names).toContain('escalate_task');
    });
});
