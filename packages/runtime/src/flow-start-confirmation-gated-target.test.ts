// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The confirmation an action declares travels with what it starts (ADR-0151
 * D3 rule 3; `flow-start-admission.ts`, rule 2b).
 *
 * An AI service account (`principalKind: 'agent'`, no `onBehalfOf`) does not
 * confirm an action for itself, so the action door refuses it an action that
 * declares `ai.requiresConfirmation: true`, whatever the request carries. The
 * trigger routes start a flow by name; when such an action targets the flow,
 * they refuse the account with the action door's own refusal (`428
 * ACTION_CONFIRMATION_REQUIRED`) through the one flow start admission
 * predicate, before any run exists, whatever the request carries.
 *
 * CONTROLS, each on the same harness: a person and an OAuth-delegated agent
 * start the flow as before; a flow no confirmation-gated action targets is
 * still started by the account; the action door's own gate still answers its
 * 428 to the account. The declared `type: 'flow'` endpoint, the third door that
 * starts a flow by name, admits a session only and refuses an API key before
 * its executor: pinned on a real boot in `endpoint-policy.auth-gate.pin.test.ts`.
 *
 * Driven with a scripted automation service, as the other flow start
 * admission pins are (`flow-start-required-permissions.test.ts`): `getFlow`
 * serves the declaration, and `execute` is a spy, so "nothing ran" is a fact
 * about the engine call rather than an inference from a status code.
 */

import { describe, it, expect, vi } from 'vitest';
// The dispatcher's reach loads `@objectstack/metadata` inside a function body
// (`standalone-stack.ts`); paid here, during collection, so no case's clocked
// window pays that first load (`check:test-source-alias`).
import '@objectstack/metadata';

import { ObjectKernel, ServiceLifecycle } from '@objectstack/core';

import { ACTION_CONFIRMATION_REFUSAL_REASONS } from '@objectstack/spec/contracts';

import { HttpDispatcher } from './http-dispatcher.js';
import { confirmationGatedStartRefusal, confirmationGatedStarterOf, flowStartRefusal } from './flow-start-admission.js';

const OBJECT = 'fcg_invoice';
const FLOW = 'fcg_void_invoice';
const OTHER_FLOW = 'fcg_send_reminder';
const GATED_ACTION = 'void_invoice';

/** An AI service account with zero grants: the agent principal that is its own subject. */
const ACCOUNT_EC = { userId: 'acct_1', principalKind: 'agent', systemPermissions: [] as string[] };
/** A person, signed in, holding nothing. */
const PERSON_EC = { userId: 'u_person', principalKind: 'human', systemPermissions: [] as string[] };
/** An OAuth-delegated agent acting for the person it names. */
const DELEGATED_EC = {
    userId: 'u_person',
    principalKind: 'agent',
    systemPermissions: [] as string[],
    onBehalfOf: { userId: 'u_person', principalKind: 'human' },
};

const ROUTES = {
    'POST /automation/:name/trigger': `/${FLOW}/trigger`,
    'POST /automation/trigger/:name (legacy)': `/trigger/${FLOW}`,
} as const;
type Route = keyof typeof ROUTES;
const ROUTE_NAMES = Object.keys(ROUTES) as Route[];

/** The request bodies an account may send: none of them confirms for it. */
const BODIES = {
    'without confirm': {},
    'with confirm: true': { confirm: true },
    'with confirm: true beside params': { params: {}, confirm: true },
} as const;

interface Answer { status: number; code?: string; details?: Record<string, unknown> }

type Source = 'object' | 'standalone' | 'merged' | 'registry';

interface Harness {
    /** Whether the action that targets {@link FLOW} declares `ai.requiresConfirmation: true`. */
    gated?: boolean;
    /**
     * Where the action is declared: embedded on the object or a standalone item
     * of the metadata service, the protocol's merged listing, or (`registry`) a
     * host with neither listing, whose ObjectQL registry alone serves it.
     */
    source?: Source;
    /** The gated action targets this flow instead of {@link FLOW}. */
    target?: string;
    /** The listing read throws; `declared` throws an error that declares its own status and code. */
    listingFails?: boolean | 'declared';
    /** The metadata service's standalone `action` listing throws. */
    actionListingFails?: boolean;
    /** This service slot is wired and fails to resolve (its factory throws). */
    resolveFails?: 'protocol' | 'metadata' | 'objectql';
    /** The automation service serves no `getFlow`. */
    noGetFlow?: boolean;
}

/** One user-run screen flow, the action that targets it, and the trigger routes and action door over them. */
function makeDoors(opts: Harness = {}) {
    const { gated = true, source = 'object', target = FLOW, listingFails = false, actionListingFails = false, resolveFails, noGetFlow = false } = opts;
    const execute = vi.fn(async (_name: string, _context?: unknown) => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) =>
        name === FLOW || name === OTHER_FLOW ? { name, type: 'screen', runAs: 'user' } : null);
    const automation: Record<string, unknown> = noGetFlow ? { execute } : { execute, getFlow };

    const action = {
        name: GATED_ACTION,
        label: 'Void invoice',
        objectName: OBJECT,
        type: 'flow',
        target,
        ai: {
            exposed: true,
            description: 'Voids the invoice through its flow, for this test.',
            ...(gated ? { requiresConfirmation: true } : {}),
        },
    };
    const objectDef = { name: OBJECT, actions: source === 'object' ? [action] : [] };
    const standalone = source === 'standalone' ? [action] : [];
    const registryItems = (type: string): unknown[] =>
        type === 'object' ? [{ name: OBJECT, actions: [] }] : type === 'action' ? [action] : [];
    const schemaOf = (n: string) => (n === OBJECT ? objectDef : undefined);
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        getSchema: schemaOf,
        registry: {
            getObject: schemaOf,
            getItem: () => undefined,
            ...(source === 'registry' ? { listItems: registryItems } : {}),
        },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const listObjects = vi.fn(async () => {
        if (listingFails === 'declared') throw Object.assign(new Error('not here'), { status: 404, code: 'RESOURCE_NOT_FOUND' });
        if (listingFails) throw new Error('metadata listing unavailable');
        return [objectDef];
    });
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects,
        loadMany: vi.fn(async (type: string) => {
            if (type === 'action' && actionListingFails) throw new Error('standalone action listing unavailable');
            return type === 'action' ? standalone : [];
        }),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
    };
    const getMetaItems = vi.fn(async ({ type }: { type: string }) => ({
        type,
        items: type === 'object' ? [{ ...objectDef, actions: [] }] : type === 'action' ? [action] : [],
    }));
    const protocol = source === 'merged' ? { getMetaItems } : null;
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
            : n === 'metadata' ? (source === 'registry' ? null : metadata)
                : n === 'automation' ? automation
                    : n === 'protocol' ? protocol
                        : null;
    // A wired slot that fails to resolve fails on every accessor the kernel has.
    const resolveOrFail = (n: string) => {
        if (n === resolveFails) throw new Error(`service '${n}' factory failed`);
        return resolve(n);
    };
    const resolveAsync = async (n: string) => resolveOrFail(n);
    const kernel: any = { getService: resolveOrFail, getServiceAsync: resolveAsync, context: { getService: resolveOrFail } };
    const dispatcher = new HttpDispatcher(kernel);

    const trigger = async (route: Route, ec: unknown, body: unknown = {}): Promise<Answer> => {
        const res: any = await dispatcher.handleAutomation(ROUTES[route], 'POST', body, {
            request: {}, executionContext: ec,
        } as any);
        const error = res.response?.body?.error;
        return { status: res.response?.status, code: error?.code, details: error?.details };
    };

    const actionDoor = async (ec: unknown, body: unknown = {}): Promise<Answer> => {
        const res: any = await dispatcher.handleActions(`/${OBJECT}/${GATED_ACTION}`, 'POST', body, {
            request: {}, environmentId: 'platform', executionContext: ec,
        } as any);
        const error = res.response?.body?.error;
        return { status: res.response?.status, code: error?.code, details: error?.details };
    };

    return { trigger, actionDoor, execute, listObjects, getMetaItems };
}

/** The action door's own refusal, as the trigger routes answer it, and nothing ran. */
function expectConfirmationRefusal(answer: Answer, execute: ReturnType<typeof vi.fn>): void {
    expect(answer.status).toBe(428);
    expect(answer.code).toBe('ACTION_CONFIRMATION_REQUIRED');
    expect(answer.details).toMatchObject({ actionName: GATED_ACTION, objectName: OBJECT, confirmationMember: 'confirm' });
    expect(execute).not.toHaveBeenCalled();
}

describe('an AI service account does not start, by name, a flow that a confirmation-gated action targets', () => {
    for (const route of ROUTE_NAMES) {
        for (const [label, body] of Object.entries(BODIES)) {
            it(`${route}: the account is refused 428 ACTION_CONFIRMATION_REQUIRED ${label}, and nothing runs`, async () => {
                const { trigger, execute } = makeDoors();

                expectConfirmationRefusal(await trigger(route, ACCOUNT_EC, body), execute);
            });
        }

        for (const source of ['standalone', 'merged', 'registry'] as const) {
            it(`${route}: the gated action counts wherever it is declared (${source} listing)`, async () => {
                const { trigger, execute } = makeDoors({ source });

                expectConfirmationRefusal(await trigger(route, ACCOUNT_EC, { confirm: true }), execute);
            });
        }

        it(`${route}: an action-declaration read that fails refuses the account's start 503, and nothing runs`, async () => {
            const { trigger, execute } = makeDoors({ listingFails: true });

            const answer = await trigger(route, ACCOUNT_EC);

            expect(answer.status).toBe(503);
            expect(answer.code).toBe('SERVICE_UNAVAILABLE');
            expect(execute).not.toHaveBeenCalled();
        });

        it(`${route}: the failed read is a flat 503 whatever the failure declares, and nothing runs`, async () => {
            const { trigger, execute } = makeDoors({ listingFails: 'declared' });

            const answer = await trigger(route, ACCOUNT_EC);

            expect(answer.status).toBe(503);
            expect(answer.code).toBe('SERVICE_UNAVAILABLE');
            expect(execute).not.toHaveBeenCalled();
        });

        for (const slot of ['protocol', 'objectql', 'metadata'] as const) {
            it(`${route}: a '${slot}' slot that fails to resolve refuses the account's start 503 (failure is not absence), and nothing runs`, async () => {
                const { trigger, execute } = makeDoors({ resolveFails: slot });

                const answer = await trigger(route, ACCOUNT_EC);

                expect(answer.status).toBe(503);
                expect(answer.code).toBe('SERVICE_UNAVAILABLE');
                expect(execute).not.toHaveBeenCalled();
            });
        }

        it(`${route}: a standalone action listing that fails refuses the account's start 503 (failure is not absence), and nothing runs`, async () => {
            const { trigger, execute } = makeDoors({ actionListingFails: true });

            const answer = await trigger(route, ACCOUNT_EC);

            expect(answer.status).toBe(503);
            expect(answer.code).toBe('SERVICE_UNAVAILABLE');
            expect(execute).not.toHaveBeenCalled();
        });

        it(`${route}: the rule is asked without the flow-definition probe (a service with no getFlow)`, async () => {
            const { trigger, execute } = makeDoors({ noGetFlow: true });

            expectConfirmationRefusal(await trigger(route, ACCOUNT_EC, { confirm: true }), execute);
        });
    }
});

describe('CONTROLS — what the confirmation-gated start rule leaves exactly as it was', () => {
    for (const route of ROUTE_NAMES) {
        it(`${route}: a person still starts the flow, and the action declarations are not read for one`, async () => {
            const { trigger, execute, listObjects } = makeDoors();

            const answer = await trigger(route, PERSON_EC);

            expect(answer.status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
            expect(execute.mock.calls[0]?.[0]).toBe(FLOW);
            expect(listObjects).not.toHaveBeenCalled();
        });

        it(`${route}: a person is unchanged on a service with no getFlow, and under a failing listing slot`, async () => {
            for (const opts of [
                { noGetFlow: true },
                { resolveFails: 'metadata' as const },
                { resolveFails: 'objectql' as const },
                { listingFails: true },
                { actionListingFails: true },
            ]) {
                const { trigger, execute } = makeDoors(opts);

                expect((await trigger(route, PERSON_EC)).status, JSON.stringify(opts)).toBe(200);
                expect(execute).toHaveBeenCalledTimes(1);
            }
        });

        it(`${route}: an OAuth-delegated agent is unchanged — it starts the flow`, async () => {
            const { trigger, execute } = makeDoors();

            expect((await trigger(route, DELEGATED_EC)).status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
        });

        it(`${route}: a flow no confirmation-gated action targets is still started by the account`, async () => {
            const { trigger, execute } = makeDoors({ gated: false });

            expect((await trigger(route, ACCOUNT_EC)).status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
        });

        it(`${route}: a confirmation-gated action that targets ANOTHER flow does not gate this one`, async () => {
            const { trigger, execute } = makeDoors({ target: OTHER_FLOW });

            expect((await trigger(route, ACCOUNT_EC)).status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
        });
    }

    it('the action door\'s own gate still answers its 428 to the account, with and without confirm, and nothing runs', async () => {
        for (const body of [{}, { confirm: true }]) {
            const { actionDoor, execute } = makeDoors();

            const answer = await actionDoor(ACCOUNT_EC, body);

            expect(answer.status).toBe(428);
            expect(answer.code).toBe('ACTION_CONFIRMATION_REQUIRED');
            expect(answer.details).toMatchObject({ actionName: GATED_ACTION, confirmationMember: 'confirm' });
            expect(execute).not.toHaveBeenCalled();
        }
    });
});

describe('the refusal names its reason, service_account, exactly as the action door does', () => {
    // The reason an AI service account is refused rides `details.reason`, a
    // member of the contract's closed set, at every door that answers rule 2b's
    // 428 — so a client that branches on the reason treats a flow start the way
    // it treats an action.
    const SERVICE_ACCOUNT = 'service_account';

    it('the reason is a member of the contract\'s closed refusal-reason set', () => {
        expect(ACTION_CONFIRMATION_REFUSAL_REASONS).toContain(SERVICE_ACCOUNT);
    });

    for (const route of ROUTE_NAMES) {
        it(`${route}: the account's refusal is 428 ACTION_CONFIRMATION_REQUIRED with details.reason service_account`, async () => {
            const { trigger, execute } = makeDoors();

            const answer = await trigger(route, ACCOUNT_EC, { confirm: true });

            expect(answer.status).toBe(428);
            expect(answer.code).toBe('ACTION_CONFIRMATION_REQUIRED');
            expect(answer.details?.reason).toBe(SERVICE_ACCOUNT);
            expect(execute).not.toHaveBeenCalled();
        });

        it(`${route}: parity — the action door and the trigger route refuse the same account with the same details`, async () => {
            const doors = makeDoors();

            const action = await doors.actionDoor(ACCOUNT_EC);
            const start = await doors.trigger(route, ACCOUNT_EC);

            expect(start.details?.reason).toBe(action.details?.reason);
            expect(action.details?.reason).toBe(SERVICE_ACCOUNT);
            expect({ status: start.status, code: start.code, details: start.details })
                .toEqual({ status: action.status, code: action.code, details: action.details });
            expect(doors.execute).not.toHaveBeenCalled();
        });
    }

    it('an object-less gated action\'s refusal carries the reason too', () => {
        const refusal = confirmationGatedStartRefusal({ action: { name: GATED_ACTION } });

        expect(refusal).toMatchObject({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
        expect(refusal.details).toEqual({ actionName: GATED_ACTION, confirmationMember: 'confirm', reason: SERVICE_ACCOUNT });
    });
});

describe('confirmationGatedStarterOf — which declaration gates a start', () => {
    const row = (name: string, action: Record<string, unknown>, objectName = OBJECT) => ({ action: { name, ...action }, objectName });

    it('reads the declared flag alone: an action of type flow whose target is the flow and that declares ai.requiresConfirmation: true', () => {
        const gated = row('a', { type: 'flow', target: FLOW, ai: { requiresConfirmation: true } });
        expect(confirmationGatedStarterOf([gated], FLOW)).toBe(gated);
        // Controls: the same row with each of the three facts changed gates nothing.
        expect(confirmationGatedStarterOf([row('a', { type: 'flow', target: FLOW, ai: { requiresConfirmation: false } })], FLOW)).toBeUndefined();
        expect(confirmationGatedStarterOf([row('a', { type: 'flow', target: FLOW, ai: { requiresConfirmation: 'true' } })], FLOW)).toBeUndefined();
        expect(confirmationGatedStarterOf([row('a', { type: 'script', target: FLOW, ai: { requiresConfirmation: true } })], FLOW)).toBeUndefined();
        expect(confirmationGatedStarterOf([row('a', { type: 'flow', target: OTHER_FLOW, ai: { requiresConfirmation: true } })], FLOW)).toBeUndefined();
    });

    it('names the same action on every call when several gate the flow', () => {
        const b = row('b_action', { type: 'flow', target: FLOW, ai: { requiresConfirmation: true } });
        const a = row('a_action', { type: 'flow', target: FLOW, ai: { requiresConfirmation: true } });
        expect(confirmationGatedStarterOf([b, a], FLOW)).toBe(a);
        expect(confirmationGatedStarterOf([a, b], FLOW)).toBe(a);
    });
});

describe('flowStartRefusal — rule 2b reads the name and the declarations, never the definition', () => {
    const gatedRows = async () => [{
        action: { name: GATED_ACTION, type: 'flow', target: FLOW, ai: { requiresConfirmation: true } },
        objectName: OBJECT,
    }];
    const door = { aiExposed: false, actionDeclarations: gatedRows };
    const services = {
        'a service with no getFlow': {},
        'a definition the probe does not return': { getFlow: async () => null },
    } as const;

    for (const [label, automation] of Object.entries(services)) {
        it(`${label}: the account is refused 428; a person and an ungated flow are admitted`, async () => {
            const refused = await flowStartRefusal(automation, FLOW, ACCOUNT_EC, door);
            expect(refused).toMatchObject({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
            // Controls on the same service: nothing else is judged without the definition.
            expect(await flowStartRefusal(automation, FLOW, PERSON_EC, door)).toBeNull();
            expect(await flowStartRefusal(automation, OTHER_FLOW, ACCOUNT_EC, door)).toBeNull();
        });
    }

    it('a failure of the flow read itself is not answered by the declaration-read 503: it travels as before', async () => {
        const failing = { getFlow: async () => { throw new Error('flow read failed'); } };
        await expect(flowStartRefusal(failing, FLOW, PERSON_EC, door)).rejects.toThrow('flow read failed');
        await expect(flowStartRefusal(failing, FLOW, ACCOUNT_EC, door)).rejects.toThrow('flow read failed');
    });
});

describe('the declarations are read from the services the request\'s own /actions door reads, in every host shape', () => {
    const ENV_ID = 'env-fcg';
    /** No graceful-shutdown handlers: one kernel per case would otherwise pile up process listeners. */
    const bareKernel = (): ObjectKernel => new ObjectKernel({ gracefulShutdown: false, skipSystemValidation: true });
    const gatedAction = {
        name: GATED_ACTION, objectName: OBJECT, type: 'flow', target: FLOW,
        ai: { exposed: true, description: 'Voids the invoice through its flow, for this test.', requiresConfirmation: true },
    };
    /** A protocol whose merged listings serve the gated action, or (`gated: false`) none. */
    const protocolServing = (gated: boolean) => ({
        getMetaItems: async ({ type }: { type: string }) => ({
            type,
            items: type === 'object' ? [{ name: OBJECT, actions: [] }] : type === 'action' && gated ? [gatedAction] : [],
        }),
    });
    const automationService = () => {
        const execute = vi.fn(async () => ({ success: true, output: {} }));
        const getFlow = async (name: string) => (name === FLOW ? { name, type: 'screen', runAs: 'user' } : null);
        return { execute, getFlow };
    };
    const start = async (dispatcher: HttpDispatcher, context: Record<string, unknown>): Promise<Answer> => {
        const res: any = await dispatcher.handleAutomation(`/${FLOW}/trigger`, 'POST', {}, {
            request: {}, executionContext: ACCOUNT_EC, ...context,
        } as any);
        const error = res.response?.body?.error;
        return { status: res.response?.status, code: error?.code, details: error?.details };
    };

    it('kernel-resolver host: the gated action declared on the request\'s own kernel refuses the account\'s start', async () => {
        const host = bareKernel();
        host.registerService('protocol', protocolServing(false));
        const env = bareKernel();
        env.registerService('protocol', protocolServing(true));
        const automation = automationService();
        env.registerService('automation', automation);

        expectConfirmationRefusal(await start(new HttpDispatcher(host as never), { kernel: env, environmentId: ENV_ID }), automation.execute);
    });

    // Records today's limitation: this answer changes when per-leg loud resolution lands for every dispatcher door.
    it('kernel-resolver host (records today\'s limitation, changes when per-leg loud resolution lands): where the request\'s own kernel fails to resolve the slot and the host kernel answers it, the start is judged on the host instance, as the /actions door would serve it', async () => {
        const host = bareKernel();
        host.registerService('protocol', protocolServing(true));
        const env = bareKernel();
        const automation = automationService();
        env.registerService('automation', automation);
        env.registerServiceFactory('protocol', () => { throw new Error('environment protocol factory failed'); });
        // The request's own slot is wired and fails, not absent: the case is not vacuous.
        await expect(env.getServiceAsync('protocol')).rejects.toThrow('environment protocol factory failed');

        expectConfirmationRefusal(await start(new HttpDispatcher(host as never), { kernel: env, environmentId: ENV_ID }), automation.execute);
    });

    it('kernel-resolver host: a shape that merely lacks every source gains no 503 — the account starts the flow', async () => {
        const host = bareKernel();
        const env = bareKernel();
        const automation = automationService();
        env.registerService('automation', automation);

        expect((await start(new HttpDispatcher(host as never), { kernel: env, environmentId: ENV_ID })).status).toBe(200);
        expect(automation.execute).toHaveBeenCalledTimes(1);
    });

    it('single-environment host: the gated action declared on the default kernel refuses the account\'s start', async () => {
        const host = bareKernel();
        host.registerService('protocol', protocolServing(true));
        const automation = automationService();
        host.registerService('automation', automation);

        expectConfirmationRefusal(await start(new HttpDispatcher(host as never), {}), automation.execute);
    });

    it('single-environment host: a shape that merely lacks every source gains no 503 — the account starts the flow', async () => {
        const host = bareKernel();
        const automation = automationService();
        host.registerService('automation', automation);

        expect((await start(new HttpDispatcher(host as never), {})).status).toBe(200);
        expect(automation.execute).toHaveBeenCalledTimes(1);
    });

    it('SharedProjectPlugin: the gated action the scoped factory serves for the request\'s scope refuses the account\'s start', async () => {
        const host = bareKernel();
        host.registerServiceFactory('protocol', (_ctx: unknown, scopeId?: string) => protocolServing(scopeId === ENV_ID), ServiceLifecycle.SCOPED);
        const automation = automationService();
        host.registerService('automation', automation);

        expectConfirmationRefusal(await start(new HttpDispatcher(host as never), { environmentId: ENV_ID }), automation.execute);
    });

    it('SharedProjectPlugin: a scoped factory with no instance in this scope is absence, not a 503 — the account starts the flow', async () => {
        const host = bareKernel();
        host.registerServiceFactory('protocol', () => undefined, ServiceLifecycle.SCOPED);
        const automation = automationService();
        host.registerService('automation', automation);

        expect((await start(new HttpDispatcher(host as never), { environmentId: ENV_ID })).status).toBe(200);
        expect(automation.execute).toHaveBeenCalledTimes(1);
    });
});
