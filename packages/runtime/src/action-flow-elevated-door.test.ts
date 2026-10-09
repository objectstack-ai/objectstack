// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The action door × a flow declared `runAs: 'system'`: a caller that is not
 * the system principal may not start, through an action of `type: 'flow'`, one
 * whose `type` is self-triggered (`autolaunched`, `record_change`,
 * `schedule`) — the same type × caller rule the trigger door applies (the
 * maintainer's ruling, letter A, extending letter B to every door that starts
 * a flow by name).
 *
 * Both entrances to the door run every case: REST `POST /actions/:object/:action`
 * (`HttpDispatcher.handleActions`) and the MCP `run_action` bridge
 * (`invokeBusinessAction`). They reach one `dispatchFlowAction`, and a pin
 * that covered only one of them would let the other drift unnoticed.
 *
 * These are the DOOR-side pins, driven with a scripted automation service so
 * each one isolates the door's decision: `getFlow` serves the declaration the
 * door reads, and `execute` is a spy, so "never dispatched" is a fact about the
 * engine call rather than an inference from a status code. The wire half — the
 * real kernel, a real member, a real engine, the elevated write that did or did
 * not land — is `@objectstack/verify`'s `action-flow-elevated-door.test.ts`
 * and the dogfood `flow-door-elevated-start.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';

import { HttpDispatcher } from './http-dispatcher.js';
import { callData, invokeBusinessAction } from './action-execution.js';

const OBJECT = 'fda_watch';
const FLOW = 'fda_target_flow';
const ACTION = 'run_target';

/** A signed-in, non-system caller holding no capability. */
const MEMBER_EC = { userId: 'user_1', systemPermissions: [] as string[] };
/** The system principal: the in-process caller a job or an internal dispatch is. */
const SYSTEM_EC = { isSystem: true };

const REFUSED_TYPES = ['autolaunched', 'record_change', 'schedule'] as const;
const DOOR_TYPES = ['screen', 'api'] as const;

interface Declared {
    type: string;
    runAs?: string;
}

/**
 * One automation service, one object carrying one flow action, and both
 * entrances to the door over them. `flow` is the declaration `getFlow` serves
 * for the action's target (`null` = the service holds no such flow).
 */
function makeDoor(opts: {
    flow: Declared | null;
    omitGetFlow?: boolean;
    requiredPermissions?: string[];
}) {
    const execute = vi.fn(async (_name: string, _context?: unknown) => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) => (name === FLOW && opts.flow ? { name, ...opts.flow } : null));
    const automation: Record<string, unknown> = opts.omitGetFlow ? { execute } : { execute, getFlow };

    const action = {
        name: ACTION,
        label: 'Run target',
        objectName: OBJECT,
        type: 'flow',
        target: FLOW,
        ai: { exposed: true, description: 'Starts the target flow on the watched object for this test.' },
        ...(opts.requiredPermissions ? { requiredPermissions: opts.requiredPermissions } : {}),
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

    /** REST `POST /actions/:object/:action`, answered as the route answers. */
    const viaRest = async (ec: unknown): Promise<{ status: number; code?: string; message?: string; body: any }> => {
        const res: any = await dispatcher.handleActions(`/${OBJECT}/${ACTION}`, 'POST', {}, {
            request: {}, environmentId: 'platform', executionContext: ec,
        } as any);
        const body = res.response?.body;
        return { status: res.response?.status, code: body?.error?.code, message: body?.error?.message, body };
    };

    /** MCP `run_action`, its throw resolved exactly as the MCP tool surface and REST resolve one. */
    const viaMcp = async (ec: unknown): Promise<{ status: number; code?: string; message?: string }> => {
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

    return { viaRest, viaMcp, execute, getFlow };
}

const ENTRANCES = ['REST /actions', 'MCP run_action'] as const;
type Entrance = (typeof ENTRANCES)[number];
const knock = (door: ReturnType<typeof makeDoor>, entrance: Entrance, ec: unknown) =>
    entrance === 'REST /actions' ? door.viaRest(ec) : door.viaMcp(ec);

/** The trigger door's refusal for the same declaration — the envelope every door shares. */
async function triggerDoorRefusal(type: string): Promise<{ status: number; code?: string; message?: string }> {
    const automation = {
        execute: vi.fn(async () => ({ success: true, output: {} })),
        getFlow: vi.fn(async (name: string) => ({ name, type, runAs: 'system' })),
    };
    const resolve = (n: string) => (n === 'automation' ? automation : null);
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const res: any = await new HttpDispatcher(kernel).handleAutomation(`/${FLOW}/trigger`, 'POST', {}, {
        request: {}, executionContext: MEMBER_EC,
    } as any);
    return { status: res.response?.status, code: res.response?.body?.error?.code, message: res.response?.body?.error?.message };
}

describe('a non-system caller is refused an elevated self-triggered flow at the action door', () => {
    for (const entrance of ENTRANCES) {
        for (const type of REFUSED_TYPES) {
            it(`${entrance}: target type '${type}', runAs 'system' → 403 PERMISSION_DENIED, never dispatched`, async () => {
                const door = makeDoor({ flow: { type, runAs: 'system' } });

                const answer = await knock(door, entrance, MEMBER_EC);

                expect(answer.status).toBe(403);
                expect(answer.code).toBe('PERMISSION_DENIED');
                // The refusal happens BEFORE dispatch: the engine was never
                // asked, so no run record and no node ran.
                expect(door.execute).not.toHaveBeenCalled();
            });
        }

        it(`${entrance}: the refusal discloses nothing of the flow, and is the trigger door's own envelope`, async () => {
            const messages: string[] = [];
            for (const type of REFUSED_TYPES) {
                const door = makeDoor({ flow: { type, runAs: 'system' } });
                const answer = await knock(door, entrance, MEMBER_EC);
                // A refusal first — so the absence checks below cannot pass
                // over an answer that carries no message at all.
                expect(answer.status).toBe(403);
                const message = String(answer.message ?? '');
                expect(message.length).toBeGreaterThan(0);
                // Neither the flow's name, its type nor its run-as declaration.
                expect(message).not.toContain(FLOW);
                expect(message).not.toContain(type);
                expect(message).not.toMatch(/runAs|'system'/);
                // One rule at every door: the same code, status and words the
                // trigger door answers for the same declaration.
                expect(answer).toMatchObject(await triggerDoorRefusal(type));
                messages.push(message);
            }
            expect(new Set(messages).size).toBe(1);
        });
    }

    it('REST /actions: the refusal carries no inner data and the ADR-0112 httpStatus', async () => {
        const door = makeDoor({ flow: { type: 'autolaunched', runAs: 'system' } });

        const answer = await door.viaRest(MEMBER_EC);

        expect(answer.body?.success).toBe(false);
        expect(answer.body?.error?.httpStatus).toBe(403);
        expect(answer.body?.data).toBeUndefined();
    });
});

describe('what stays exactly as it was at the action door', () => {
    for (const entrance of ENTRANCES) {
        for (const type of REFUSED_TYPES) {
            it(`${entrance}: the system principal still starts a '${type}' flow declared runAs 'system'`, async () => {
                const door = makeDoor({ flow: { type, runAs: 'system' } });

                const answer = await knock(door, entrance, SYSTEM_EC);

                expect(answer.status).toBe(200);
                expect(door.execute).toHaveBeenCalledTimes(1);
                expect(door.execute.mock.calls[0]?.[0]).toBe(FLOW);
            });

            it(`${entrance}: a member still starts a '${type}' flow that does not declare runAs 'system'`, async () => {
                const asUser = makeDoor({ flow: { type, runAs: 'user' } });
                // A declaration with no `runAs` at all (the parsed default is 'user').
                const bare = makeDoor({ flow: { type } });

                expect((await knock(asUser, entrance, MEMBER_EC)).status).toBe(200);
                expect((await knock(bare, entrance, MEMBER_EC)).status).toBe(200);
                expect(asUser.execute).toHaveBeenCalledTimes(1);
                expect(bare.execute).toHaveBeenCalledTimes(1);
            });
        }

        for (const type of DOOR_TYPES) {
            it(`${entrance}: a member still starts a '${type}' flow declared runAs 'system' — an entry its author designed`, async () => {
                const door = makeDoor({ flow: { type, runAs: 'system' } });

                const answer = await knock(door, entrance, MEMBER_EC);

                expect(answer.status).toBe(200);
                expect(door.execute).toHaveBeenCalledTimes(1);
            });
        }

        it(`${entrance}: an unknown target still answers 404 — existence is asked first`, async () => {
            const door = makeDoor({ flow: null });

            const answer = await knock(door, entrance, MEMBER_EC);

            expect(answer.status).toBe(404);
            expect(door.execute).not.toHaveBeenCalled();
        });

        it(`${entrance}: a service that cannot be asked for the declaration dispatches as before`, async () => {
            const door = makeDoor({ flow: null, omitGetFlow: true });

            const answer = await knock(door, entrance, MEMBER_EC);

            expect(answer.status).toBe(200);
            expect(door.execute).toHaveBeenCalledTimes(1);
        });
    }
});

describe("the action's own requiredPermissions gate (ADR-0066 D4) keeps its place", () => {
    const GATED = ['fda_run_elevated'];

    for (const entrance of ENTRANCES) {
        it(`${entrance}: a member lacking the declared capability is refused by the action's gate first — the flow is never read`, async () => {
            const door = makeDoor({ flow: { type: 'autolaunched', runAs: 'system' }, requiredPermissions: GATED });

            const answer = await knock(door, entrance, MEMBER_EC);

            // The gate's refusal names the missing capability; the flow check
            // never ran (it reads the declaration through `getFlow`, which the
            // existence probe asks first — neither was reached). REST answers
            // the gate 403; the MCP bridge throws the gate's sentence bare, as
            // it did before this check existed.
            if (entrance === 'REST /actions') expect(answer.status).toBe(403);
            expect(answer.status).not.toBe(200);
            expect(answer.message).toContain('fda_run_elevated');
            expect(door.getFlow).not.toHaveBeenCalled();
            expect(door.execute).not.toHaveBeenCalled();
        });

        it(`${entrance}: holding the declared capability does not open a self-triggered elevated target`, async () => {
            const door = makeDoor({ flow: { type: 'autolaunched', runAs: 'system' }, requiredPermissions: GATED });

            const answer = await knock(door, entrance, { ...MEMBER_EC, systemPermissions: GATED });

            expect(answer.status).toBe(403);
            expect(answer.code).toBe('PERMISSION_DENIED');
            expect(answer.message).not.toContain('fda_run_elevated');
            expect(door.getFlow).toHaveBeenCalled();
            expect(door.execute).not.toHaveBeenCalled();
        });

        it(`${entrance}: holding the declared capability starts an elevated entry ('screen') — the route the ruling names`, async () => {
            const door = makeDoor({ flow: { type: 'screen', runAs: 'system' }, requiredPermissions: GATED });

            const answer = await knock(door, entrance, { ...MEMBER_EC, systemPermissions: GATED });

            expect(answer.status).toBe(200);
            expect(door.execute).toHaveBeenCalledTimes(1);
        });
    }
});
