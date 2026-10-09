// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declared endpoint door × a flow declared `runAs: 'system'`: a caller
 * that is not the system principal may not start, through an endpoint of
 * `type: 'flow'`, one whose `type` is self-triggered (`autolaunched`,
 * `record_change`, `schedule`) — the same type × caller rule the trigger door
 * and the action door apply (the maintainer's ruling, letter A, extending
 * letter B to every door that starts a flow by name).
 *
 * Driven through `executeEndpointTarget` with a scripted automation service, so
 * each pin isolates the door's decision: `getFlow` serves the declaration the
 * door reads, and `execute` is a spy, so "never dispatched" is a fact about the
 * engine call. The policy chain (`authRequired`, `rateLimit`) runs upstream of
 * this function and is untouched: an anonymous caller at an
 * `authRequired: true` endpoint is still `401` before any of this runs, and an
 * `authRequired: false` endpoint's anonymous caller arrives here as the guest
 * principal, never the system one. The wire half, on a real boot, is the
 * dogfood `flow-door-elevated-start.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiEndpointSchema, ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import {
    buildEndpointExecutionContext,
    executeEndpointTarget,
    type EndpointExecutionAnswer,
} from './endpoint-executor.js';
import { HttpDispatcher } from './http-dispatcher.js';

const FLOW = 'fde_target_flow';

const FLOW_ENDPOINT = () =>
    ApiEndpointSchema.parse({
        name: 'fde_start',
        path: '/api/v1/apps/fde/start',
        method: 'POST',
        type: 'flow',
        target: FLOW,
        authRequired: true,
    });

/** A signed-in, non-system caller. */
const MEMBER_EC = { userId: 'user-1', positions: ['member'], permissions: [], tenantId: 'org-1' } as unknown as ExecutionContext;
/** The guest principal an `authRequired: false` endpoint's anonymous caller executes as (#22147). */
const GUEST_EC = { principalKind: 'guest', positions: ['guest'], isSystem: false } as unknown as ExecutionContext;
/** The system principal. */
const SYSTEM_EC = { isSystem: true } as unknown as ExecutionContext;

const REFUSED_TYPES = ['autolaunched', 'record_change', 'schedule'] as const;
const DOOR_TYPES = ['screen', 'api'] as const;

function automationServiceWith(flow: { type: string; runAs?: string } | null, opts: { omitGetFlow?: boolean } = {}) {
    const execute = vi.fn(async (_name: string, _context?: unknown) => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) => (name === FLOW && flow ? { name, ...flow } : null));
    const service: Record<string, unknown> = opts.omitGetFlow ? { execute } : { execute, getFlow };
    return { service, execute, getFlow };
}

async function viaEndpoint(service: unknown, executionContext: ExecutionContext): Promise<EndpointExecutionAnswer> {
    const match: ApiEndpointMatch = { endpoint: FLOW_ENDPOINT(), params: {} };
    const ctx = buildEndpointExecutionContext({
        request: { method: 'POST', path: '/api/v1/apps/fde/start', query: {}, headers: {}, body: {} },
        match,
        executionContext,
        environmentId: 'env-1',
    });
    return executeEndpointTarget(ctx, { callData: vi.fn().mockResolvedValue({ ok: true }), automationService: service });
}

/** The trigger door's refusal for the same declaration — the envelope every door shares. */
async function triggerDoorRefusal(type: string) {
    const { service } = automationServiceWith({ type, runAs: 'system' });
    const resolve = (n: string) => (n === 'automation' ? service : null);
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const res: any = await new HttpDispatcher(kernel).handleAutomation(`/${FLOW}/trigger`, 'POST', {}, {
        request: {}, executionContext: MEMBER_EC,
    } as any);
    return { status: res.response?.status, code: res.response?.body?.error?.code, message: res.response?.body?.error?.message };
}

function errorOf(answer: EndpointExecutionAnswer) {
    const body: any = answer.body;
    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(ApiErrorSchema.safeParse(body.error).success).toBe(true);
    expect(body.error.httpStatus).toBe(answer.status);
    return body.error;
}

describe('a non-system caller is refused an elevated self-triggered flow at a declared flow endpoint', () => {
    for (const [label, ec] of [['a signed-in member', MEMBER_EC], ['the guest principal', GUEST_EC]] as const) {
        for (const type of REFUSED_TYPES) {
            it(`${label}: target type '${type}', runAs 'system' → 403 PERMISSION_DENIED, never dispatched`, async () => {
                const { service, execute } = automationServiceWith({ type, runAs: 'system' });

                const answer = await viaEndpoint(service, ec);

                expect(answer.status).toBe(403);
                expect(errorOf(answer).code).toBe('PERMISSION_DENIED');
                expect(execute).not.toHaveBeenCalled();
            });
        }
    }

    it('the refusal discloses nothing of the flow, and is the trigger door\'s own envelope', async () => {
        const messages: string[] = [];
        for (const type of REFUSED_TYPES) {
            const { service } = automationServiceWith({ type, runAs: 'system' });
            const answer = await viaEndpoint(service, MEMBER_EC);
            expect(answer.status).toBe(403);
            const error = errorOf(answer);
            const message = String(error.message ?? '');
            expect(message.length).toBeGreaterThan(0);
            expect(message).not.toContain(FLOW);
            expect(message).not.toContain(type);
            expect(message).not.toMatch(/runAs|'system'/);
            expect(error.details).toBeUndefined();
            expect({ status: answer.status, code: error.code, message }).toEqual(await triggerDoorRefusal(type));
            messages.push(message);
        }
        expect(new Set(messages).size).toBe(1);
    });
});

describe('what stays exactly as it was at a declared flow endpoint', () => {
    for (const type of REFUSED_TYPES) {
        it(`the system principal still starts a '${type}' flow declared runAs 'system'`, async () => {
            const { service, execute } = automationServiceWith({ type, runAs: 'system' });

            const answer = await viaEndpoint(service, SYSTEM_EC);

            expect(answer.status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
            expect(execute.mock.calls[0]?.[0]).toBe(FLOW);
        });

        it(`a member still starts a '${type}' flow that does not declare runAs 'system'`, async () => {
            const asUser = automationServiceWith({ type, runAs: 'user' });
            const bare = automationServiceWith({ type });

            expect((await viaEndpoint(asUser.service, MEMBER_EC)).status).toBe(200);
            expect((await viaEndpoint(bare.service, MEMBER_EC)).status).toBe(200);
            expect(asUser.execute).toHaveBeenCalledTimes(1);
            expect(bare.execute).toHaveBeenCalledTimes(1);
        });
    }

    for (const type of DOOR_TYPES) {
        it(`a member still starts a '${type}' flow declared runAs 'system' — an entry its author designed`, async () => {
            const { service, execute } = automationServiceWith({ type, runAs: 'system' });

            const answer = await viaEndpoint(service, MEMBER_EC);

            expect(answer.status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
        });
    }

    it('an unknown target still answers 404 — existence is asked first', async () => {
        const { service, execute } = automationServiceWith(null);

        const answer = await viaEndpoint(service, MEMBER_EC);

        expect(answer.status).toBe(404);
        expect(execute).not.toHaveBeenCalled();
    });

    it('a service that cannot be asked for the declaration dispatches as before', async () => {
        const { service, execute } = automationServiceWith(null, { omitGetFlow: true });

        const answer = await viaEndpoint(service, MEMBER_EC);

        expect(answer.status).toBe(200);
        expect(execute).toHaveBeenCalledTimes(1);
    });
});
