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
// The dispatcher's reach loads `@objectstack/metadata` inside a function body
// (`standalone-stack.ts`); paid here, during collection, so no case's clocked
// window pays that first load (`check:test-source-alias`).
import '@objectstack/metadata';
import { resolveThrownHttpError } from '@objectstack/types';
import { ApiEndpointSchema } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';

import { HttpDispatcher } from './http-dispatcher.js';
import { callData, invokeBusinessAction } from './action-execution.js';
import { buildEndpointExecutionContext, executeEndpointTarget } from './endpoint-executor.js';
import { AI_ACCOUNT_ELEVATED_START_REFUSAL, ELEVATED_START_REFUSAL } from './flow-start-admission.js';

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

/**
 * One automation service serving `flow` under {@link FLOW}, and every door over it.
 * The action that starts the flow carries its author's AI opt-in unless
 * `actionAiExposed: false` asks for one that does not.
 */
function makeDoors(flow: Declared, opts: { actionRequiredPermissions?: string[]; actionAiExposed?: boolean } = {}) {
    const execute = vi.fn(async (_name: string, _context?: unknown) => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) => (name === FLOW ? { name, ...flow } : null));
    const automation: Record<string, unknown> = { execute, getFlow };

    const action = {
        name: ACTION,
        label: 'Verify bank account',
        objectName: OBJECT,
        type: 'flow',
        target: FLOW,
        ...(opts.actionAiExposed === false
            ? {}
            : { ai: { exposed: true, description: 'Starts the bank-account verification flow for this test.' } }),
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

/**
 * [ADR-0151 Non-goals; ruling record 6812617393, letter C] Rule 2 of the flow
 * start admission, pinned at every door that starts a flow by name: an AI
 * service account starts a flow declared `runAs: 'system'` only through an
 * action whose author opted it into AI (`ai.exposed: true`), the opt-in the
 * MCP `run_action` door asks of every action. The trigger route and a declared
 * endpoint start a flow by name with no action in hand, so nothing there
 * carries the opt-in and the account is refused.
 */
describe('an AI service account starts an elevated flow only through an action its author opted into AI', () => {
    /** ADR-0151 D3: the agent principal that is its own subject. */
    const ACCOUNT_EC = { userId: 'acct_1', principalKind: 'agent', systemPermissions: [] as string[] };
    const ACCOUNT_HOLDER_EC = { ...ACCOUNT_EC, systemPermissions: [CAP] };
    /** An OAuth-delegated agent names the person it acts for: not an account. */
    const DELEGATED_EC = {
        userId: 'user_1', principalKind: 'agent', systemPermissions: [] as string[],
        onBehalfOf: { userId: 'user_1', principalKind: 'human' },
    };
    const PERSON_EC = { ...MEMBER_EC, principalKind: 'human' };
    const BY_NAME_DOORS = ['trigger', 'endpoint'] as const;
    const UNEXPOSED = { actionAiExposed: false } as const;

    const expectAccountRefusal = (answer: Answer) => {
        expect(answer).toMatchObject({
            status: AI_ACCOUNT_ELEVATED_START_REFUSAL.status,
            code: AI_ACCOUNT_ELEVATED_START_REFUSAL.code,
        });
        expect(answer.status).toBe(403);
        expect(answer.code).toBe('PERMISSION_DENIED');
        expect(answer.message).toBe(AI_ACCOUNT_ELEVATED_START_REFUSAL.message);
    };

    for (const type of ENTRY_TYPES) {
        for (const door of BY_NAME_DOORS) {
            it(`${door}: an elevated '${type}' flow — the account is refused 403 PERMISSION_DENIED, never dispatched`, async () => {
                // The action that targets the flow IS exposed: a by-name door
                // has no action in hand, so that opt-in does not stand here.
                const { doors, execute } = makeDoors({ type, runAs: 'system' });

                expectAccountRefusal(await doors[door](ACCOUNT_EC));
                expect(execute).not.toHaveBeenCalled();
            });
        }

        it(`REST /actions: an elevated '${type}' flow behind an action WITHOUT the opt-in — the account is refused, never dispatched`, async () => {
            const { doors, execute } = makeDoors({ type, runAs: 'system' }, UNEXPOSED);

            expectAccountRefusal(await doors['REST /actions'](ACCOUNT_EC));
            expect(execute).not.toHaveBeenCalled();
        });

        for (const entrance of ACTION_ENTRANCES) {
            it(`${entrance}: an elevated '${type}' flow behind an action WITH the opt-in — the account starts it, and the run carries its kind`, async () => {
                const { doors, execute } = makeDoors({ type, runAs: 'system' });

                expect((await doors[entrance](ACCOUNT_EC)).status).toBe(200);
                expect(execute).toHaveBeenCalledTimes(1);
                expect(execute.mock.calls[0]?.[0]).toBe(FLOW);
                expect(execute.mock.calls[0]?.[1]).toMatchObject({ userId: 'acct_1', principalKind: 'agent' });
            });
        }
    }

    it('the refusal names the opt-in the author adds, and nothing of the flow', async () => {
        const { doors } = makeDoors({ type: 'screen', runAs: 'system' }, UNEXPOSED);

        const answer = await doors['REST /actions'](ACCOUNT_EC);

        expect(answer.message).toContain('ai: { exposed: true');
        expect(answer.message).toContain('run_action');
        expect(answer.message).not.toContain(FLOW);
        expect(answer.message).not.toContain(ACTION);
    });

    it('one refusal at every door that can answer it: the same status, code and words', async () => {
        const answers: Answer[] = [];
        for (const door of ['trigger', 'REST /actions', 'endpoint'] as const) {
            const { doors } = makeDoors({ type: 'screen', runAs: 'system' }, UNEXPOSED);
            answers.push(await doors[door](ACCOUNT_EC));
        }
        expectAccountRefusal(answers[0]!);
        for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0]);
    });

    it('MCP run_action asks the opt-in of every action, upstream of this rule: unexposed, nobody starts the flow there', async () => {
        for (const ec of [ACCOUNT_EC, PERSON_EC]) {
            const { doors, execute, getFlow } = makeDoors({ type: 'screen', runAs: 'system' }, UNEXPOSED);

            const answer = await doors['MCP run_action'](ec);

            expect(answer.status).not.toBe(200);
            expect(answer.message).toContain('is not exposed to AI');
            // The exposure gate answered: the flow's declaration was never read.
            expect(getFlow).not.toHaveBeenCalled();
            expect(execute).not.toHaveBeenCalled();
        }
    });

    describe('the order of the rules', () => {
        for (const door of ['trigger', 'REST /actions', 'endpoint'] as const) {
            it(`${door}: an elevated self-triggered flow — rule 1 answers the account first`, async () => {
                const { doors, execute } = makeDoors({ type: 'autolaunched', runAs: 'system' }, UNEXPOSED);

                const answer = await doors[door](ACCOUNT_EC);

                expect(answer.message).toBe(ELEVATED_START_REFUSAL.message);
                expect(execute).not.toHaveBeenCalled();
            });

            it(`${door}: holding the flow's capability does not open it — the account rule answers before requiredPermissions`, async () => {
                const { doors, execute } = makeDoors({ type: 'screen', runAs: 'system', requiredPermissions: [CAP] }, UNEXPOSED);

                expectAccountRefusal(await doors[door](ACCOUNT_HOLDER_EC));
                expectAccountRefusal(await doors[door](ACCOUNT_EC));
                expect(execute).not.toHaveBeenCalled();
            });
        }

        for (const entrance of ACTION_ENTRANCES) {
            it(`${entrance}: the opt-in admits the account to the flow's own requiredPermissions, which still answers`, async () => {
                const { doors, execute } = makeDoors({ type: 'screen', runAs: 'system', requiredPermissions: [CAP] });

                const refused = await doors[entrance](ACCOUNT_EC);
                expect(refused).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
                expect(refused.message).toContain(CAP);
                expect(execute).not.toHaveBeenCalled();

                expect((await doors[entrance](ACCOUNT_HOLDER_EC)).status).toBe(200);
                expect(execute).toHaveBeenCalledTimes(1);
            });
        }
    });

    describe('CONTROLS — who and what the rule does not judge', () => {
        for (const door of ['trigger', 'REST /actions', 'endpoint'] as const) {
            it(`${door}: a person starts the elevated flow with no opt-in anywhere, as before`, async () => {
                const { doors, execute } = makeDoors({ type: 'screen', runAs: 'system' }, UNEXPOSED);

                expect((await doors[door](PERSON_EC)).status).toBe(200);
                expect((await doors[door](MEMBER_EC)).status).toBe(200);
                expect(execute).toHaveBeenCalledTimes(2);
            });

            it(`${door}: an OAuth-delegated agent is not an account — not judged by this rule`, async () => {
                const { doors, execute } = makeDoors({ type: 'screen', runAs: 'system' }, UNEXPOSED);

                expect((await doors[door](DELEGATED_EC)).status).toBe(200);
                expect(execute).toHaveBeenCalledTimes(1);
            });

            it(`${door}: the system principal starts it`, async () => {
                const { doors, execute } = makeDoors({ type: 'screen', runAs: 'system' }, UNEXPOSED);

                expect((await doors[door](SYSTEM_EC)).status).toBe(200);
                expect(execute).toHaveBeenCalledTimes(1);
            });

            for (const runAs of ['user', undefined] as const) {
                it(`${door}: a flow that runs as the user (runAs ${runAs ?? 'undeclared'}) — the account starts it with no opt-in, as before`, async () => {
                    const { doors, execute } = makeDoors({ type: 'screen', ...(runAs ? { runAs } : {}) }, UNEXPOSED);

                    expect((await doors[door](ACCOUNT_EC)).status).toBe(200);
                    expect(execute).toHaveBeenCalledTimes(1);
                    expect(execute.mock.calls[0]?.[1]).toMatchObject({ userId: 'acct_1', principalKind: 'agent' });
                });
            }
        }
    });
});
