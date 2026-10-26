// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25821 — the trigger door refuses a `params` that is not a JSON object.
 *
 * `buildAutomationContext` read `params` with
 * `ctxBody.params && typeof ctxBody.params === 'object' ? { ...ctxBody.params } : {}`,
 * so a mis-shaped value never reached the flow and never reached the caller
 * either:
 *
 *  - a string (`{"params":"oops"}`) became an EMPTY bag and the flow ran with
 *    no inputs — measured on a stock showcase boot as `400 FLOW_FAILED`
 *    "Unknown variable: ownerId", and as `200` for a flow that needs none;
 *  - an array passed the `typeof` guard and was spread into an index-keyed
 *    bag (`{ "0": 1, "1": 2 }`);
 *  - a falsy value (`null`, `0`, `false`, `""`) fell into the flat-body
 *    back-compat branch, which forwarded the body's OTHER keys as params.
 *
 * The resume door already refuses the same value-shape class on its own
 * object-valued keys (#9416), so the two doors of one engine disagreed. The
 * trigger door now asks the resume door's question through the same function
 * (`objectValueFailure`, `object-value-shape.ts`) and answers the same
 * refusal: `400 VALIDATION_FAILED`, one `fields[]` entry naming `params` with
 * `invalid_type`, before dispatch — `execute()` is never called, so no run row
 * exists. `null` is refused too, as the resume door refuses `{"inputs":null}`.
 *
 * Three doors share the builder and all three are driven here: both spellings
 * of the REST trigger route, and a declared `type: 'flow'` endpoint
 * (`endpoint-executor.ts`, #5040 E5). BOTH directions are pinned, because a
 * door that refuses everything ships just as green as a correct one: every
 * refused shape answers the envelope with `execute` never called, AND every
 * accepted body still reaches `execute` with the params bag it always did.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';
import { buildEndpointExecutionContext, executeEndpointTarget } from '../endpoint-executor.js';
import { ApiEndpointSchema } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

const FLOW = 'showcase_notify_owner';

function makeDispatcher() {
    const execute = vi.fn(async () => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) => (name === FLOW ? { name } : null));
    const services: Record<string, unknown> = { automation: { execute, getFlow } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), execute };
}

const CTX = () => ({ request: {}, executionContext: { userId: 'user_1' } } as any);

/** Both spellings of the REST trigger door. */
const ROUTES: Array<{ label: string; path: string }> = [
    { label: 'POST /:name/trigger', path: `/${FLOW}/trigger` },
    { label: 'legacy POST /trigger/:name', path: `/trigger/${FLOW}` },
];

/** The value shapes the card measured, plus the falsy ones that took the flat-body branch. */
const NON_OBJECTS: Array<[string, unknown, string]> = [
    ['a string', 'oops', 'a string'],
    ['an empty string', '', 'a string'],
    ['an array', [1, 2], 'an array'],
    ['an empty array', [], 'an array'],
    ['a number', 42, 'a number'],
    ['zero', 0, 'a number'],
    ['a boolean', true, 'a boolean'],
    ['false', false, 'a boolean'],
    ['null', null, 'null'],
];

/**
 * Drive a REST trigger door and report the refusal as the wire would: the
 * status both dispatcher error exits derive for a thrown validation failure
 * carrying no `.status` of its own (#3918) — the derivation the resume door's
 * value-shape suite reads the same way.
 */
async function refusalFor(path: string, body: unknown) {
    const { dispatcher, execute } = makeDispatcher();
    let thrown: unknown;
    let response: unknown;
    try {
        response = (await dispatcher.handleAutomation(path, 'POST', body, CTX())).response;
    } catch (e) {
        thrown = e;
    }
    expect(
        thrown,
        `trigger body ${JSON.stringify(body)} was dispatched (answered ${JSON.stringify(response)}) instead of refused`,
    ).toBeDefined();
    const details = validationFailureDetails(thrown);
    const status =
        typeof (thrown as any)?.status === 'number' ? (thrown as any).status
        : details ? VALIDATION_FAILED_STATUS
        : 500;
    return { details, status, message: (thrown as Error).message, execute };
}

describe('#25821 — the REST trigger door refuses a non-object `params` before dispatch', () => {
    for (const route of ROUTES) {
        describe(route.label, () => {
            it.each(NON_OBJECTS)('refuses %s — 400 VALIDATION_FAILED naming `params`, no run', async (_label, value, received) => {
                const r = await refusalFor(route.path, { params: value });
                expect(r.status).toBe(VALIDATION_FAILED_STATUS);
                expect(r.details?.code).toBe('VALIDATION_FAILED');
                // Located: `params` is named with the ADR-0114 catalog code, and
                // the expected and received types are both stated.
                expect(r.details?.fields).toMatchObject([{ field: 'params', code: 'invalid_type' }]);
                expect((r.details?.fields[0] as any).message).toMatch(/expected an object/);
                expect((r.details?.fields[0] as any).message).toContain(`received ${received}`);
                expect(r.message).toMatch(/`params`/);
                // Before dispatch: the engine was never asked, so no run row exists.
                expect(r.execute).not.toHaveBeenCalled();
            });

            it('refuses a non-object `params` even when the body carries flat keys the old branch forwarded', async () => {
                // `{"params":null,"ownerId":"u1"}` used to run with `{ ownerId: 'u1' }`
                // — the flat-body branch read the falsy `params` as absent.
                const r = await refusalFor(route.path, { params: null, ownerId: 'u1' });
                expect(r.details?.fields).toMatchObject([{ field: 'params', code: 'invalid_type' }]);
                expect(r.execute).not.toHaveBeenCalled();
            });
        });
    }
});

describe('#25821 — the accepted shapes still reach the engine unchanged', () => {
    const ACCEPTED: Array<[string, unknown, Record<string, unknown>]> = [
        ['an object `params`', { params: { ownerId: 'u1' } }, { ownerId: 'u1' }],
        ['an empty object `params`', { params: {} }, {}],
        ['no `params` key — the flat body is forwarded', { ownerId: 'u1' }, { ownerId: 'u1' }],
        ['an empty body', {}, {}],
        ['no body at all', undefined, {}],
        ['a record launch', { recordId: 'r1', objectName: 'crm_lead', params: { note: 'x' } },
            { note: 'x', recordId: 'r1', crmLeadId: 'r1' }],
    ];

    for (const route of ROUTES) {
        it.each(ACCEPTED)(`${route.label}: %s`, async (_label, body, params) => {
            const { dispatcher, execute } = makeDispatcher();
            const result = await dispatcher.handleAutomation(route.path, 'POST', body, CTX());
            expect(result.response?.status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
            expect((execute.mock.calls[0] as any)[1].params).toEqual(params);
        });
    }
});

describe('#25821 — a declared `type: flow` endpoint, which shares the builder, refuses the same way', () => {
    const EC = { userId: 'user-1' } as ExecutionContext;
    const endpoint = ApiEndpointSchema.parse({
        name: 'notify_owner',
        path: '/api/v1/apps/showcase/notify-owner',
        method: 'POST',
        type: 'flow',
        target: FLOW,
    });

    function contextFor(body: unknown) {
        const match: ApiEndpointMatch = { endpoint, params: {} };
        return buildEndpointExecutionContext({
            request: { method: 'POST', path: endpoint.path, query: {}, headers: {}, body },
            match,
            executionContext: EC,
            environmentId: 'env-7',
            dataDriver: {},
        });
    }

    it.each(NON_OBJECTS)('refuses %s — 400 VALIDATION_FAILED naming `params`, no run', async (_label, value) => {
        const execute = vi.fn().mockResolvedValue({ success: true });
        const answer = await executeEndpointTarget(contextFor({ params: value }), {
            callData: vi.fn(),
            automationService: { execute },
        });
        const body: any = answer.body;
        expect(answer.status).toBe(400);
        expect(body.error.code).toBe('VALIDATION_FAILED');
        expect(body.error.details.fields).toMatchObject([{ field: 'params', code: 'invalid_type' }]);
        expect(execute).not.toHaveBeenCalled();
    });

    it('still dispatches an object `params` with the bag it always built', async () => {
        const execute = vi.fn().mockResolvedValue({ success: true });
        const answer = await executeEndpointTarget(contextFor({ params: { ownerId: 'u1' } }), {
            callData: vi.fn(),
            automationService: { execute },
        });
        expect(answer.status).toBe(200);
        expect(execute.mock.calls[0]![1].params).toEqual({ ownerId: 'u1' });
    });
});
