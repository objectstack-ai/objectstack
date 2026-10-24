// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A flow's own `requiredPermissions` × every door that starts a flow by name
 * (ruling record 6377848497, letter A): the trigger route, an action of
 * `type: 'flow'` through both of its entrances (REST `POST /actions/:object/:action`
 * and the MCP `run_action` bridge), and a declared endpoint of `type: 'flow'`.
 * Each door asks the one check, `flowStartRefusal` (`flow-start-admission.ts`),
 * so a caller refused at one door is refused alike at every other.
 *
 * Driven with a scripted automation service, as the elevated-door pins are
 * (`action-flow-elevated-door.test.ts`, `endpoint-flow-elevated-door.test.ts`):
 * `getFlow` serves the declaration the door reads, and `execute` is a spy, so
 * "never dispatched" is a fact about the engine call rather than an inference
 * from a status code. That a parent flow's `subflow` node is NOT a door, and
 * starts a gated child for a member who holds nothing, is pinned on the real
 * engine: `service-automation`'s `subflow-required-permissions.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { ApiEndpointSchema } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';

import { HttpDispatcher } from './http-dispatcher.js';
import { callData, invokeBusinessAction } from './action-execution.js';
import { buildEndpointExecutionContext, executeEndpointTarget } from './endpoint-executor.js';
import { ELEVATED_START_REFUSAL } from './flow-start-admission.js';

const OBJECT = 'frp_vendor';
const FLOW = 'frp_bank_verify';
const ACTION = 'verify_bank';
const CAP = 'frp_verify_bank_account';
const ACTION_CAP = 'frp_run_actions';

/** A signed-in, non-system caller holding no capability. */
const MEMBER_EC = { userId: 'user_1', systemPermissions: [] as string[] };
const HOLDER_EC = { userId: 'user_2', systemPermissions: [CAP] };
/** The system principal: the in-process caller a job or an internal dispatch is. */
const SYSTEM_EC = { isSystem: true };

interface Declared {
    type: string;
    runAs?: string;
    requiredPermissions?: string[];
}

interface Answer { status: number; code?: string; message?: string }

/** One automation service serving `flow` under {@link FLOW}, and every door over it. */
function makeDoors(flow: Declared, opts: { actionRequiredPermissions?: string[] } = {}) {
    const execute = vi.fn(async (_name: string, _context?: unknown) => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) => (name === FLOW ? { name, ...flow } : null));
    const automation: Record<string, unknown> = { execute, getFlow };

    const action = {
        name: ACTION,
        label: 'Verify bank account',
        objectName: OBJECT,
        type: 'flow',
        target: FLOW,
        ai: { exposed: true, description: 'Starts the bank-account verification flow for this test.' },
        ...(opts.actionRequiredPermissions ? { requiredPermissions: opts.actionRequiredPermissions } : {}),
    };
    const objectDef = { name: OBJECT, actions: [action] };
    const schemaOf = (n: string) => (n === OBJECT ? objectDef : undefined);
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : n === 'automation' ? automation : null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);

    const trigger = async (ec: unknown): Promise<Answer> => {
        const res: any = await dispatcher.handleAutomation(`/${FLOW}/trigger`, 'POST', {}, {
            request: {}, executionContext: ec,
        } as any);
        const error = res.response?.body?.error;
        return { status: res.response?.status, code: error?.code, message: error?.message };
    };

    const rest = async (ec: unknown): Promise<Answer> => {
        const res: any = await dispatcher.handleActions(`/${OBJECT}/${ACTION}`, 'POST', {}, {
            request: {}, environmentId: 'platform', executionContext: ec,
        } as any);
        const error = res.response?.body?.error;
        return { status: res.response?.status, code: error?.code, message: error?.message };
    };

    const mcp = async (ec: unknown): Promise<Answer> => {
        const request: any = { request: {}, environmentId: 'platform', executionContext: ec };
        const deps: any = {
            resolveService: async (_ctx: any, name: string) => (name === 'automation' ? automation : undefined),
            getObjectQL: async () => ql,
        };
        try {
            await invokeBusinessAction(deps, request, ACTION, { objectName: OBJECT } as any, {
                driver: undefined,
                envId: 'platform',
                ec,
                getMeta: () => ({ listObjects: async () => [objectDef] }),
                callData: (a, params, dataDriver, scopeId, execCtx) =>
                    callData(deps, request, a, params, dataDriver, scopeId, execCtx),
            });
            return { status: 200 };
        } catch (err) {
            const thrown = resolveThrownHttpError(err, 500);
            return { status: thrown.status, code: thrown.code, message: thrown.message };
        }
    };

    const endpoint = async (ec: unknown): Promise<Answer> => {
        const match: ApiEndpointMatch = {
            endpoint: ApiEndpointSchema.parse({
                name: 'frp_start', path: '/api/v1/apps/frp/start', method: 'POST', type: 'flow', target: FLOW, authRequired: true,
            }),
            params: {},
        };
        const ctx = buildEndpointExecutionContext({
            request: { method: 'POST', path: '/api/v1/apps/frp/start', query: {}, headers: {}, body: {} },
            match,
            executionContext: ec as any,
            environmentId: 'env-1',
        });
        const answer = await executeEndpointTarget(ctx, { callData: vi.fn().mockResolvedValue({ ok: true }), automationService: automation });
        const error = (answer.body as any)?.error;
        return { status: answer.status, code: error?.code, message: error?.message };
    };

    return { doors: { trigger, 'REST /actions': rest, 'MCP run_action': mcp, endpoint }, execute, getFlow };
}

const DOORS = ['trigger', 'REST /actions', 'MCP run_action', 'endpoint'] as const;
const ACTION_ENTRANCES = ['REST /actions', 'MCP run_action'] as const;
const ENTRY_TYPES = ['screen', 'api'] as const;

describe("a flow's requiredPermissions is checked at every door that starts it by name", () => {
    for (const door of DOORS) {
        for (const type of ENTRY_TYPES) {
            it(`${door}: an elevated '${type}' flow — a member without the capability → 403 PERMISSION_DENIED, never dispatched`, async () => {
                const { doors, execute } = makeDoors({ type, runAs: 'system', requiredPermissions: [CAP] });

                const answer = await doors[door](MEMBER_EC);

                expect(answer.status).toBe(403);
                expect(answer.code).toBe('PERMISSION_DENIED');
                // The remedy is a grant, so the refusal names the capability —
                // and nothing of the flow itself.
                expect(answer.message).toContain(CAP);
                expect(answer.message).not.toContain(FLOW);
                expect(execute).not.toHaveBeenCalled();
            });

            it(`${door}: an elevated '${type}' flow — a member holding the capability starts it`, async () => {
                const { doors, execute } = makeDoors({ type, runAs: 'system', requiredPermissions: [CAP] });

                const answer = await doors[door](HOLDER_EC);

                expect(answer.status).toBe(200);
                expect(execute).toHaveBeenCalledTimes(1);
                expect(execute.mock.calls[0]?.[0]).toBe(FLOW);
            });
        }

        it(`${door}: the declaration binds a flow that runs as the user too — it gates the start, not the elevation`, async () => {
            const { doors, execute } = makeDoors({ type: 'screen', runAs: 'user', requiredPermissions: [CAP] });

            expect((await doors[door](MEMBER_EC)).status).toBe(403);
            expect(execute).not.toHaveBeenCalled();
            expect((await doors[door](HOLDER_EC)).status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
        });

        it(`${door}: EVERY named capability is required — holding one of two is refused`, async () => {
            const { doors, execute } = makeDoors({ type: 'screen', runAs: 'system', requiredPermissions: [CAP, 'frp_second'] });

            const answer = await doors[door](HOLDER_EC);

            expect(answer.status).toBe(403);
            expect(answer.code).toBe('PERMISSION_DENIED');
            expect(answer.message).toContain('frp_second');
            expect(execute).not.toHaveBeenCalled();
        });

        it(`${door}: the system principal starts a gated flow — the action gate's bypass`, async () => {
            const { doors, execute } = makeDoors({ type: 'screen', runAs: 'system', requiredPermissions: [CAP] });

            expect((await doors[door](SYSTEM_EC)).status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
        });

        it(`${door}: a flow declaring none (absent or empty) admits a member, as before`, async () => {
            const absent = makeDoors({ type: 'screen', runAs: 'system' });
            const empty = makeDoors({ type: 'screen', runAs: 'system', requiredPermissions: [] });

            expect((await absent.doors[door](MEMBER_EC)).status).toBe(200);
            expect((await empty.doors[door](MEMBER_EC)).status).toBe(200);
            expect(absent.execute).toHaveBeenCalledTimes(1);
            expect(empty.execute).toHaveBeenCalledTimes(1);
        });

        it(`${door}: holding the capability does not open an elevated self-triggered flow — that rule answers first`, async () => {
            const { doors, execute } = makeDoors({ type: 'autolaunched', runAs: 'system', requiredPermissions: [CAP] });

            const answer = await doors[door](HOLDER_EC);

            expect(answer).toMatchObject({ status: ELEVATED_START_REFUSAL.status, code: ELEVATED_START_REFUSAL.code });
            expect(answer.message).toBe(ELEVATED_START_REFUSAL.message);
            expect(execute).not.toHaveBeenCalled();
        });
    }

    it('one refusal at every door: the same status, code and words for the same declaration and caller', async () => {
        const answers: Answer[] = [];
        for (const door of DOORS) {
            const { doors } = makeDoors({ type: 'screen', runAs: 'system', requiredPermissions: [CAP] });
            answers.push(await doors[door](MEMBER_EC));
        }
        expect(answers[0]).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
        for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0]);
    });
});

describe("the action door inherits the flow's declaration", () => {
    for (const entrance of ACTION_ENTRANCES) {
        it(`${entrance}: an action that declares NO requiredPermissions is gated by its target flow's`, async () => {
            const { doors, execute } = makeDoors({ type: 'screen', runAs: 'system', requiredPermissions: [CAP] });

            const refused = await doors[entrance](MEMBER_EC);
            expect(refused).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
            expect(execute).not.toHaveBeenCalled();

            expect((await doors[entrance](HOLDER_EC)).status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
        });

        describe(`${entrance}: when the action AND the flow both declare, the caller needs both lists`, () => {
            const both = () => makeDoors(
                { type: 'screen', runAs: 'system', requiredPermissions: [CAP] },
                { actionRequiredPermissions: [ACTION_CAP] },
            );

            it("holding only the action's capability → refused by the flow's check, never dispatched", async () => {
                const { doors, execute, getFlow } = both();

                const answer = await doors[entrance]({ userId: 'u', systemPermissions: [ACTION_CAP] });

                expect(answer).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
                expect(answer.message).toContain(CAP);
                // The action gate admitted; the flow's declaration was read.
                expect(getFlow).toHaveBeenCalled();
                expect(execute).not.toHaveBeenCalled();
            });

            it("holding only the flow's capability → refused by the action's own gate first, the flow never read", async () => {
                const { doors, execute, getFlow } = both();

                const answer = await doors[entrance](HOLDER_EC);

                // The action gate's refusal (ADR-0066 D4) answers upstream, as
                // it did before the flow check existed: REST answers it 403,
                // the MCP bridge throws its sentence bare.
                if (entrance === 'REST /actions') expect(answer.status).toBe(403);
                expect(answer.status).not.toBe(200);
                expect(answer.message).toContain(ACTION_CAP);
                expect(getFlow).not.toHaveBeenCalled();
                expect(execute).not.toHaveBeenCalled();
            });

            it('holding both → starts', async () => {
                const { doors, execute } = both();

                const answer = await doors[entrance]({ userId: 'u', systemPermissions: [ACTION_CAP, CAP] });

                expect(answer.status).toBe(200);
                expect(execute).toHaveBeenCalledTimes(1);
            });
        });
    }
});
