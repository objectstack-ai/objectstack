// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A declared script action with no handler bound (a "ghost" action): MCP
 * `run_action` answers it as the routing miss REST `/api/v1/actions` answers.
 *
 * Both doors dispatch a script action through `executeRegisteredAction`, and
 * both see the same miss (`dispatched: false`). REST answers it from its
 * routing-miss branch (`domains/actions.ts`): `404`, the closed code the
 * status derives (`RESOURCE_NOT_FOUND`), `Action 'X' on object 'Y' not
 * found`. The MCP bridge (`invokeBusinessAction`) threw a plain uncoded
 * `Error('No handler registered …')`, which `run_action` answers through the
 * `/actions` door's reader (`actionsDoorAnswerOf`, `@objectstack/types`) as
 * that door's bare-`Error` arm, `400 VALIDATION_ERROR`: it told an agent its
 * input was bad when the action has no route. The bridge now throws the
 * coded miss, so the reader gives back the door's own answer.
 *
 * One kernel serves both doors here, so each pin is the agreement between
 * them, not either half alone. The invocation row each door writes for the
 * miss is pinned too: the MCP row used to record the uncoded throw as a `500`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { actionsDoorAnswerOf } from '@objectstack/types';

import { HttpDispatcher } from './http-dispatcher.js';

const OBJECT = 'tasks_app_task';
const ACTION = {
    name: 'complete_task', label: 'Complete', objectName: OBJECT, type: 'script',
    body: { language: 'js', source: 'return { ok: true };' },
    ai: { exposed: true, description: 'Mark a task complete.' },
};
const MISS_SENTENCE = `Action 'complete_task' on object '${OBJECT}' not found`;

function makeKernel(handler?: (ctx: any) => unknown) {
    const object = { name: OBJECT, label: 'Task', fields: {}, actions: [ACTION] };
    const handlers = new Map<string, (ctx: any) => unknown>();
    if (handler) handlers.set(`${OBJECT}:complete_task`, handler);
    const ql: any = {
        getSchema: (name: string) => (name === OBJECT ? object : undefined),
        registry: { getObject: (name: string) => (name === OBJECT ? object : undefined), getItem: () => undefined },
        find: vi.fn(async () => [{ id: 'r1' }]),
        findOne: vi.fn(async () => ({ id: 'r1' })),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
        executeAction: vi.fn(async (obj: string, key: string, ctx: any) => {
            const h = handlers.get(`${obj}:${key}`);
            if (!h) throw new Error(`Action '${key}' on object '${obj}' not found`);
            return h(ctx);
        }),
        listRegisteredActions: () => [...handlers.keys()].map((k) => ({
            objectName: k.slice(0, k.indexOf(':')), actionName: k.slice(k.indexOf(':') + 1),
        })),
    };
    const metadata: any = {
        listObjects: vi.fn(async () => [object]),
        getObject: vi.fn(async () => object),
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
    };
    const rows: any[] = [];
    const audit = { recordActionInvocation: vi.fn(async (row: any) => { rows.push(row); }) };
    const auth: any = { api: { getSession: async () => ({ user: { id: 'u1' } }) } };
    const automation = { execute: vi.fn(async () => ({ success: true })) };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql
                    : n === 'metadata' ? metadata
                        : n === 'audit' ? audit
                            : n === 'auth' ? auth
                                : n === 'automation' ? automation
                                    : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel) as any, rows };
}

const ctx = (): any => ({ request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } });

async function restAnswer(dispatcher: any) {
    const res = await dispatcher.handleActions(`/${OBJECT}/complete_task/r1`, 'POST', {}, ctx());
    return res.response;
}

async function mcpThrow(dispatcher: any): Promise<unknown> {
    const bridge = dispatcher.buildMcpBridge(ctx());
    try {
        await bridge.runAction('complete_task', { objectName: OBJECT, recordId: 'r1' });
    } catch (err) {
        return err;
    }
    throw new Error('run_action did not throw');
}

describe('a declared action with no handler: run_action answers the routing miss /actions answers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('REST /actions answers 404 RESOURCE_NOT_FOUND, naming the routed object (the measured door answer)', async () => {
        const { dispatcher } = makeKernel();
        const response = await restAnswer(dispatcher);
        expect(response.status).toBe(404);
        expect(response.body.error).toEqual({ code: 'RESOURCE_NOT_FOUND', message: MISS_SENTENCE, httpStatus: 404 });
    });

    it('the MCP bridge throws the same miss coded: code, status and sentence equal the REST body', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const { dispatcher } = makeKernel();
        const rest = (await restAnswer(dispatcher)).body.error;
        const thrown = await mcpThrow(dispatcher) as { code?: unknown; status?: unknown; message?: unknown };
        expect({ code: thrown.code, status: thrown.status, message: thrown.message }).toEqual({
            code: 'RESOURCE_NOT_FOUND', status: 404, message: MISS_SENTENCE,
        });
        expect([thrown.code, thrown.status, thrown.message]).toEqual([rest.code, rest.httpStatus, rest.message]);
    });

    it('run_action reads it through the /actions reader as that door answers it, never 400 VALIDATION_ERROR', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const { dispatcher } = makeKernel();
        const rest = (await restAnswer(dispatcher)).body.error;
        const answer = actionsDoorAnswerOf(await mcpThrow(dispatcher));
        expect({ code: answer.code, status: answer.status, message: answer.message }).toEqual({
            code: 'RESOURCE_NOT_FOUND', status: 404, message: MISS_SENTENCE,
        });
        expect({ code: answer.code, status: answer.status, message: answer.message })
            .toEqual({ code: rest.code, status: rest.httpStatus, message: rest.message });
        expect(answer.declaredCode).toBeUndefined();
    });

    it('each door writes one failed invocation row for the miss, with the same status and code', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const { dispatcher, rows } = makeKernel();
        await restAnswer(dispatcher);
        await mcpThrow(dispatcher);
        expect(rows.map((r) => ({ surface: r.context?.surface, outcome: r.outcome, status: r.status, errorCode: r.errorCode }))).toEqual([
            { surface: 'rest', outcome: 'failed', status: 404, errorCode: 'RESOURCE_NOT_FOUND' },
            { surface: 'mcp', outcome: 'failed', status: 404, errorCode: 'RESOURCE_NOT_FOUND' },
        ]);
    });

    it('CONTROL: the same action with a handler bound runs on both doors', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const { dispatcher } = makeKernel(() => ({ done: true }));
        const response = await restAnswer(dispatcher);
        expect(response.status).toBe(200);
        const bridge = dispatcher.buildMcpBridge(ctx());
        await expect(bridge.runAction('complete_task', { objectName: OBJECT, recordId: 'r1' }))
            .resolves.toMatchObject({ ok: true, result: { done: true } });
    });

    it('CONTROL: a coded refusal from the handler keeps its code and status on both doors', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const refuse = () => {
            throw Object.assign(new Error('Record is locked.'), { code: 'RECORD_LOCKED', status: 409 });
        };
        const { dispatcher } = makeKernel(refuse);
        const rest = await restAnswer(dispatcher);
        expect(rest.status).toBe(409);
        expect(rest.body.error).toMatchObject({ code: 'RECORD_LOCKED', message: 'Record is locked.', httpStatus: 409 });
        const answer = actionsDoorAnswerOf(await mcpThrow(dispatcher));
        expect({ code: answer.code, status: answer.status, message: answer.message })
            .toEqual({ code: 'RECORD_LOCKED', status: 409, message: 'Record is locked.' });
    });
});
