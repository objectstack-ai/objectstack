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

import { HttpDispatcher } from './http-dispatcher.js';
import { confirmationGatedStarterOf } from './flow-start-admission.js';

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

type Source = 'object' | 'standalone' | 'merged';

interface Harness {
    /** Whether the action that targets {@link FLOW} declares `ai.requiresConfirmation: true`. */
    gated?: boolean;
    /** Where the action is declared: embedded on the object, a standalone item, or the protocol's merged listing. */
    source?: Source;
    /** The gated action targets this flow instead of {@link FLOW}. */
    target?: string;
    /** The listing read throws. */
    listingFails?: boolean;
}

/** One user-run screen flow, the action that targets it, and the trigger routes and action door over them. */
function makeDoors(opts: Harness = {}) {
    const { gated = true, source = 'object', target = FLOW, listingFails = false } = opts;
    const execute = vi.fn(async (_name: string, _context?: unknown) => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) =>
        name === FLOW || name === OTHER_FLOW ? { name, type: 'screen', runAs: 'user' } : null);
    const automation: Record<string, unknown> = { execute, getFlow };

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
    const schemaOf = (n: string) => (n === OBJECT ? objectDef : undefined);
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const listObjects = vi.fn(async () => {
        if (listingFails) throw new Error('metadata listing unavailable');
        return [objectDef];
    });
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects,
        loadMany: vi.fn(async (type: string) => (type === 'action' ? standalone : [])),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
    };
    const getMetaItems = vi.fn(async ({ type }: { type: string }) => ({
        type,
        items: type === 'object' ? [{ ...objectDef, actions: [] }] : type === 'action' ? [action] : [],
    }));
    const protocol = source === 'merged' ? { getMetaItems } : null;
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
            : n === 'metadata' ? metadata
                : n === 'automation' ? automation
                    : n === 'protocol' ? protocol
                        : null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
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

        for (const source of ['standalone', 'merged'] as const) {
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
