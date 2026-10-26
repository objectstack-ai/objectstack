// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25976 — every door that starts or resumes a run refuses non-object input
 * the same way, through the one shared shape check (`objectValueFailure`,
 * `domains/object-value-shape.ts`).
 *
 * Two neighbouring doors still coerced a mis-shaped value silently after the
 * trigger door's `params` was closed (#25821):
 *
 *  - the action door (`POST /actions/:object/:action`) read
 *    `reqBody.params && typeof reqBody.params === 'object' ? reqBody.params : {}`,
 *    so `{"params":"oops"}` ran the action with an EMPTY bag, and an array was
 *    handed on as the bag itself — measured on a showcase boot as `200` and a
 *    started run, the same answer `{"params":{}}` gets;
 *  - the trigger door read its body with `body && typeof body === 'object' ? body : {}`,
 *    so a JSON string body dispatched the flow with an empty bag and an array
 *    body forwarded its indices as params (the flat-body branch).
 *
 * The resume door already refused both shapes on its own body (#9416). All
 * three now answer `400 VALIDATION_FAILED` with one `fields[]` entry naming
 * `params` or `(body)` with `invalid_type` and the received type, before
 * anything is dispatched — the engine is never asked, so no run row exists.
 *
 * BOTH directions are pinned, because a door that refuses everything ships
 * just as green as a correct one: every refused shape answers the envelope
 * with nothing dispatched, AND every accepted body — an absent `params`, an
 * absent body — still reaches the engine with the bag it always did.
 */

import { describe, it, expect, vi } from 'vitest';
import { FieldErrorCode } from '@objectstack/spec/api';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';
import { buildEndpointExecutionContext, executeEndpointTarget } from '../endpoint-executor.js';
import { ApiEndpointSchema } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

const OBJECT = 'showcase_task';
const FLOW = 'showcase_notify_owner';

/** The value shapes the card measured, plus the falsy ones a truthiness guard read as absent. */
const NON_OBJECTS: Array<[string, unknown, string]> = [
    ['a string', 'oops', 'a string'],
    ['an empty string', '', 'a string'],
    ['an array', [1, 2], 'an array'],
    ['an empty array', [], 'an array'],
    ['a number', 42, 'a number'],
    ['zero', 0, 'a number'],
    ['a boolean', true, 'a boolean'],
    ['false', false, 'a boolean'],
];

/** `params` is a key, so an explicit `null` is a sent value and refused; a `null` BODY is the bodyless request. */
const NON_OBJECT_PARAMS: Array<[string, unknown, string]> = [...NON_OBJECTS, ['null', null, 'null']];

// ─────────────────────────────────────────────────────────────────────────────
// The action door
// ─────────────────────────────────────────────────────────────────────────────

const FLOW_ACTION = {
    name: 'showcase_bulk_reassign',
    label: 'Reassign',
    objectName: OBJECT,
    type: 'flow',
    target: FLOW,
    params: [{ name: 'note', type: 'text' }],
};
const SCRIPT_ACTION = {
    name: 'showcase_close',
    label: 'Close',
    objectName: OBJECT,
    type: 'script',
    target: 'showcase_close',
    params: [{ name: 'note', type: 'text' }],
};
/** A flow action with no declared params — the param contract never runs, so only the shape check stands. */
const UNDECLARED_FLOW_ACTION = { ...FLOW_ACTION, name: 'showcase_ping', params: undefined };
const OBJECT_DEF = { name: OBJECT, actions: [FLOW_ACTION, SCRIPT_ACTION, UNDECLARED_FLOW_ACTION] };
const ACTIONS = [FLOW_ACTION, SCRIPT_ACTION, UNDECLARED_FLOW_ACTION];

function actionDoor() {
    const ql: any = {
        executeAction: vi.fn(async (_object: string, _action: string, _ctx: any) => ({ ok: true })),
        getSchema: (n: string) => (n === OBJECT ? OBJECT_DEF : undefined),
        registry: { getObject: (n: string) => (n === OBJECT ? OBJECT_DEF : undefined), getItem: () => undefined },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const automation = {
        execute: vi.fn(async (_flow: string, _context?: any) => ({
            success: true, status: 'paused', runId: 'run_test', durationMs: 1,
        })),
        getFlow: vi.fn(async (name: string) => (name === FLOW ? { name } : null)),
    };
    const metadata = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [OBJECT_DEF]),
        getObject: vi.fn(async (n: string) => (n === OBJECT ? OBJECT_DEF : undefined)),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : n === 'automation' ? automation
        : null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const context: any = {
        request: {},
        environmentId: 'platform',
        executionContext: { userId: 'usr_1', tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] },
    };
    const call = async (action: string, body: unknown) =>
        (await (new HttpDispatcher(kernel) as any).handleActions(`/${OBJECT}/${action}`, 'POST', body, context)).response;
    return { call, ql, automation };
}

describe('#25976 — the action door refuses a non-object `params` before anything runs', () => {
    for (const action of ACTIONS) {
        describe(`${action.type} action \`${action.name}\`${action.params ? '' : ' (no declared params)'}`, () => {
            it.each(NON_OBJECT_PARAMS)('refuses %s — 400 VALIDATION_FAILED naming `params`, nothing dispatched', async (_label, value, received) => {
                const door = actionDoor();
                const res = await door.call(action.name, { params: value });
                expect(res.status, `{"params":${JSON.stringify(value)}} answered ${JSON.stringify(res.body)}`).toBe(VALIDATION_FAILED_STATUS);
                expect(res.body.error.code).toBe('VALIDATION_FAILED');
                expect(res.body.error.details.fields).toMatchObject([{ field: 'params', code: 'invalid_type' }]);
                expect(FieldErrorCode.safeParse(res.body.error.details.fields[0].code).success).toBe(true);
                expect(res.body.error.details.fields[0].message).toBe(`expected an object (a map of names to values), received ${received}`);
                expect(res.body.error.message).toMatch(/`params`/);
                // Before dispatch: neither the flow engine nor the script runner was asked.
                expect(door.automation.execute).not.toHaveBeenCalled();
                expect(door.ql.executeAction).not.toHaveBeenCalled();
            });
        });
    }

    describe('the accepted shapes still run, with the bag they always did', () => {
        const ACCEPTED: Array<[string, unknown, Record<string, unknown>]> = [
            ['an object `params`', { params: { note: 'x' } }, { note: 'x' }],
            ['an empty object `params`', { params: {} }, {}],
            ['no `params` key', {}, {}],
            ['no body at all', undefined, {}],
        ];

        it.each(ACCEPTED)('flow action: %s', async (_label, body, params) => {
            const door = actionDoor();
            const res = await door.call(FLOW_ACTION.name, body);
            expect(res.status, JSON.stringify(res.body)).toBe(200);
            expect(door.automation.execute).toHaveBeenCalledTimes(1);
            expect((door.automation.execute.mock.calls[0] as any)[1].params).toMatchObject(params);
        });

        it.each(ACCEPTED)('script action: %s', async (_label, body, params) => {
            const door = actionDoor();
            const res = await door.call(SCRIPT_ACTION.name, body);
            expect(res.status, JSON.stringify(res.body)).toBe(200);
            expect(door.ql.executeAction).toHaveBeenCalledTimes(1);
            expect((door.ql.executeAction.mock.calls[0] as any)[2].params).toMatchObject(params);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The trigger door's body
// ─────────────────────────────────────────────────────────────────────────────

function triggerDoor() {
    const execute = vi.fn(async () => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) => (name === FLOW ? { name } : null));
    const services: Record<string, unknown> = { automation: { execute, getFlow } };
    const resolve = (name: string) => services[name];
    const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
    return { dispatcher: new HttpDispatcher(kernel), execute };
}

const CALLER = () => ({ request: {}, executionContext: { userId: 'user_1' } } as any);

/** Both spellings of the REST trigger door. */
const TRIGGER_ROUTES: Array<{ label: string; path: string }> = [
    { label: 'POST /:name/trigger', path: `/${FLOW}/trigger` },
    { label: 'legacy POST /trigger/:name', path: `/trigger/${FLOW}` },
];

/**
 * Drive a REST trigger door and report the refusal as the wire would: the
 * status both dispatcher error exits derive for a thrown validation failure
 * carrying no `.status` of its own (#3918).
 */
async function triggerRefusal(path: string, body: unknown) {
    const { dispatcher, execute } = triggerDoor();
    let thrown: unknown;
    let response: unknown;
    try {
        response = (await dispatcher.handleAutomation(path, 'POST', body, CALLER())).response;
    } catch (e) {
        thrown = e;
    }
    expect(thrown, `trigger body ${JSON.stringify(body)} was dispatched (answered ${JSON.stringify(response)}) instead of refused`).toBeDefined();
    const details = validationFailureDetails(thrown);
    const status = typeof (thrown as any)?.status === 'number' ? (thrown as any).status : details ? VALIDATION_FAILED_STATUS : 500;
    return { details, status, message: (thrown as Error).message, execute };
}

describe('#25976 — the trigger door refuses a body that is not a JSON object before dispatch', () => {
    for (const route of TRIGGER_ROUTES) {
        describe(route.label, () => {
            it.each(NON_OBJECTS)('refuses a body that is %s — 400 VALIDATION_FAILED at `(body)`, no run', async (_label, body, received) => {
                const r = await triggerRefusal(route.path, body);
                expect(r.status).toBe(VALIDATION_FAILED_STATUS);
                expect(r.details?.code).toBe('VALIDATION_FAILED');
                // `(body)` is the root-level locator, as on the resume door.
                expect(r.details?.fields).toMatchObject([{ field: '(body)', code: 'invalid_type' }]);
                expect((r.details?.fields[0] as any).message).toBe(`expected an object (a map of names to values), received ${received}`);
                expect(r.message).toMatch(/^Invalid trigger body/);
                expect(r.execute).not.toHaveBeenCalled();
            });
        });
    }

    describe('a bodyless trigger keeps its empty bag', () => {
        for (const route of TRIGGER_ROUTES) {
            it.each([
                ['no body at all', undefined],
                ['a JSON `null` body', null],
                ['an empty object', {}],
            ])(`${route.label}: %s`, async (_label, body) => {
                const { dispatcher, execute } = triggerDoor();
                const result = await dispatcher.handleAutomation(route.path, 'POST', body, CALLER());
                expect(result.response?.status).toBe(200);
                expect(execute).toHaveBeenCalledTimes(1);
                expect((execute.mock.calls[0] as any)[1].params).toEqual({});
            });
        }
    });

    describe('a declared `type: flow` endpoint, which shares the builder, refuses the same way', () => {
        const EC = { userId: 'user-1' } as ExecutionContext;
        const endpoint = ApiEndpointSchema.parse({
            name: 'notify_owner',
            path: '/api/v1/apps/showcase/notify-owner',
            method: 'POST',
            type: 'flow',
            target: FLOW,
        });
        const run = async (body: unknown) => {
            const match: ApiEndpointMatch = { endpoint, params: {} };
            const execute = vi.fn().mockResolvedValue({ success: true });
            const answer = await executeEndpointTarget(buildEndpointExecutionContext({
                request: { method: 'POST', path: endpoint.path, query: {}, headers: {}, body },
                match,
                executionContext: EC,
                environmentId: 'env-7',
                dataDriver: {},
            }), { callData: vi.fn(), automationService: { execute } });
            return { answer, execute };
        };

        it.each(NON_OBJECTS)('refuses a body that is %s', async (_label, body) => {
            const { answer, execute } = await run(body);
            const res: any = answer.body;
            expect(answer.status).toBe(400);
            expect(res.error.code).toBe('VALIDATION_FAILED');
            expect(res.error.details.fields).toMatchObject([{ field: '(body)', code: 'invalid_type' }]);
            expect(execute).not.toHaveBeenCalled();
        });

        it('still dispatches a bodyless request with an empty bag', async () => {
            const { answer, execute } = await run(undefined);
            expect(answer.status).toBe(200);
            expect(execute.mock.calls[0]![1].params).toEqual({});
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// One check, one answer — the three doors side by side
// ─────────────────────────────────────────────────────────────────────────────

describe('#25976 — the action, trigger and resume doors answer one mis-shaped value in the same words', () => {
    async function resumeRefusal(body: unknown) {
        const resume = vi.fn(async () => ({ success: true, runId: 'run_7' }));
        const services: Record<string, unknown> = {
            automation: { resume, getFlow: async () => ({ name: FLOW }), getRun: async () => null },
        };
        const resolve = (name: string) => services[name];
        const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
        try {
            await new HttpDispatcher(kernel).handleAutomation(`/${FLOW}/runs/run_7/resume`, 'POST', body, CALLER());
        } catch (e) {
            return { details: validationFailureDetails(e), message: (e as Error).message, resume };
        }
        throw new Error(`resume body ${JSON.stringify(body)} was not refused`);
    }

    it.each(NON_OBJECTS)('%s', async (_label, value, received) => {
        const action = await actionDoor().call(FLOW_ACTION.name, { params: value });
        const trigger = await triggerRefusal(`/${FLOW}/trigger`, value);
        const resume = await resumeRefusal(value);

        const rows = [
            action.body.error.details.fields[0],
            trigger.details?.fields[0] as any,
            resume.details?.fields[0] as any,
        ];
        for (const row of rows) {
            expect(row.code).toBe('invalid_type');
            expect(row.message).toMatch(new RegExp(`^expected an object .*, received ${received}$`));
        }
        // The resume body names its closed key set as what it expects, and its
        // refusal sentence is the one it has always answered.
        expect(resume.message).toBe(
            `Invalid resume body — expected an object with \`inputs\`, \`variables\`, \`output\`, \`branchLabel\`, received ${received}`,
        );
        expect(resume.resume).not.toHaveBeenCalled();
    });
});
