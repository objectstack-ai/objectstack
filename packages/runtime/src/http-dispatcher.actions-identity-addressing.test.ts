// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST `/actions/:object/:action` — identity vs addressing (ADR-0110 D1/D2,
 * #3935).
 *
 * The spec separates two fields that the route used to let bleed into each
 * other: `name` is the machine identity (`SnakeCaseIdentifierSchema`), while
 * `target` is a BINDING EXPRESSION — polymorphic per type (URL / script key /
 * flow id / FormView name), `${param.X}`-interpolatable, and legitimately
 * non-unique. The route resolved the DECLARATION from the URL segment as a
 * name, but dispatched the HANDLER using the same segment as a registry key.
 *
 * For a target-bound script action those are different strings, so the two
 * documented callers each worked on exactly the half the other broke:
 *
 *   - the documented curl (`.../todo_task/complete_task`, the NAME) resolved
 *     the declaration — gate + params enforced — then 404ed, because the
 *     handler is registered under `completeTask`;
 *   - the Console (`target || name`, the KEY) dispatched fine, but resolved
 *     NO declaration, so ADR-0066 D4 `requiredPermissions` and the ADR-0104
 *     param contract were silently skipped.
 *
 * These tests pin the D2 fix: identity is always `name`, and the handler key
 * is DERIVED from the resolved declaration (the rotation the MCP bridge has
 * always used), so the documented URL both gates and dispatches.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';

/** app-todo's real shape: declarative name ≠ handler registration key. */
const targetBoundAction = {
    name: 'complete_task',
    label: 'Complete',
    type: 'script',
    target: 'completeTask',
};

/**
 * A dispatcher whose engine registers handlers under `registeredKeys` only —
 * `executeAction` throws the engine's exact "not registered" miss for any
 * other key, so the key rotation is exercised for real rather than mocked.
 */
function makeDispatcher(opts: {
    objectDef?: any;
    registeredKeys?: Record<string, string[]>; // objectKey -> handler keys
    record?: any;
} = {}) {
    const objectDef = opts.objectDef ?? { name: 'todo_task', actions: [targetBoundAction] };
    const registered = opts.registeredKeys ?? { todo_task: ['completeTask'] };
    const calls: Array<{ object: string; key: string }> = [];

    const executeAction = vi.fn(async (object: string, key: string, _ctx: any) => {
        calls.push({ object, key });
        if (!registered[object]?.includes(key)) {
            throw new Error(`Action '${key}' on object '${object}' not found`);
        }
        return { ran: key };
    });

    const ql: any = {
        executeAction,
        getSchema: (name: string) => (name === objectDef.name ? objectDef : undefined),
        registry: {
            getObject: (name: string) => (name === objectDef.name ? objectDef : undefined),
            getItem: () => undefined,
        },
        find: vi.fn(async () => (opts.record ? [opts.record] : [])),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), executeAction, calls };
}

const ctxFor = (executionContext: any = { userId: 'u1', systemPermissions: [] }): any => ({
    request: {},
    environmentId: 'platform',
    executionContext,
});

describe('REST /actions — identity is `name`, the handler key is derived (ADR-0110 D2, #3935)', () => {
    it('dispatches the DOCUMENTED name-addressed curl to a target-registered handler', async () => {
        // `content/docs/ui/actions.mdx` teaches exactly this URL. Before D2 it
        // 404ed: the route used `complete_task` as the registry key, but the
        // handler lives under `completeTask`.
        const { dispatcher, calls } = makeDispatcher();

        const res = await dispatcher.handleActions(
            '/todo_task/complete_task', 'POST', { recordId: 'task_1' }, ctxFor(),
        );

        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toMatchObject({ success: true, data: { ran: 'completeTask' } });
        expect(calls).toContainEqual({ object: 'todo_task', key: 'completeTask' });
    });

    it('enforces the D4 capability gate on the name-addressed URL', async () => {
        const gated = { ...targetBoundAction, requiredPermissions: ['task.manage'] };
        const { dispatcher, executeAction } = makeDispatcher({
            objectDef: { name: 'todo_task', actions: [gated] },
        });

        const res = await dispatcher.handleActions(
            '/todo_task/complete_task', 'POST', { recordId: 'task_1' },
            ctxFor({ userId: 'u1', systemPermissions: [] }),
        );

        expect(res.response.status).toBe(403);
        expect(res.response.body.error.message).toMatch(/task\.manage/);
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('runs the gated action for a caller who holds the capability', async () => {
        const gated = { ...targetBoundAction, requiredPermissions: ['task.manage'] };
        const { dispatcher } = makeDispatcher({
            objectDef: { name: 'todo_task', actions: [gated] },
        });

        const res = await dispatcher.handleActions(
            '/todo_task/complete_task', 'POST', { recordId: 'task_1' },
            ctxFor({ userId: 'u1', systemPermissions: ['task.manage'] }),
        );

        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toMatchObject({ success: true, data: { ran: 'completeTask' } });
    });

    it('prefers `name` when a BODY action declares a target (the AppPlugin registration key)', async () => {
        // A body action is auto-registered under `name` even when it also
        // carries a target, so the derivation must not blindly prefer target.
        const bodyAction = { name: 'archive_task', type: 'script', target: 'someOtherThing', body: 'return 1;' };
        const { dispatcher, calls } = makeDispatcher({
            objectDef: { name: 'todo_task', actions: [bodyAction] },
            registeredKeys: { todo_task: ['archive_task'] },
        });

        const res = await dispatcher.handleActions(
            '/todo_task/archive_task', 'POST', {}, ctxFor(),
        );

        expect(res.response.status).toBe(200);
        expect(calls[0]).toEqual({ object: 'todo_task', key: 'archive_task' });
    });

    it('still resolves a handler registered under the declarative name', async () => {
        const { dispatcher } = makeDispatcher({
            registeredKeys: { todo_task: ['complete_task'] },
        });

        const res = await dispatcher.handleActions(
            '/todo_task/complete_task', 'POST', {}, ctxFor(),
        );

        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toMatchObject({ success: true, data: { ran: 'complete_task' } });
    });

    it('rotates to the object-less registration keys for a global handler', async () => {
        const { dispatcher, calls } = makeDispatcher({
            registeredKeys: { global: ['completeTask'] },
        });

        const res = await dispatcher.handleActions(
            '/todo_task/complete_task', 'POST', {}, ctxFor(),
        );

        expect(res.response.status).toBe(200);
        expect(calls).toContainEqual({ object: 'global', key: 'completeTask' });
    });

    it('404s naming the ROUTED object when no candidate key carries a handler', async () => {
        const { dispatcher } = makeDispatcher({ registeredKeys: {} });

        const res = await dispatcher.handleActions(
            '/todo_task/complete_task', 'POST', {}, ctxFor(),
        );

        expect(res.response.status).toBe(404);
        expect(res.response.body.error.message).toContain("'todo_task'");
    });

    it('propagates a genuine handler failure instead of rotating past it', async () => {
        // The rotation must only advance on the engine's "not registered"
        // miss; a handler that throws its own error is a business outcome.
        const objectDef = { name: 'todo_task', actions: [targetBoundAction] };
        const executeAction = vi.fn(async (_o: string, key: string) => {
            if (key === 'completeTask') throw new Error('task already closed');
            throw new Error(`Action '${key}' on object 'todo_task' not found`);
        });
        const ql: any = {
            executeAction,
            getSchema: () => objectDef,
            registry: { getObject: () => objectDef, getItem: () => undefined },
            find: vi.fn(async () => []), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
        };
        const kernel: any = {
            context: {
                getService: (n: string) =>
                    n === 'objectql' || n === 'data' ? ql
                    : n === 'metadata' ? { load: async () => null, listObjects: async () => [objectDef] }
                    : null,
            },
        };
        const dispatcher = new HttpDispatcher(kernel);

        const res = await dispatcher.handleActions(
            '/todo_task/complete_task', 'POST', {}, ctxFor(),
        );

        // Business failure reports in the payload (the route's long-standing
        // wire contract), NOT as a 404 routing miss.
        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toMatchObject({ success: false, error: 'task already closed' });
    });
});
