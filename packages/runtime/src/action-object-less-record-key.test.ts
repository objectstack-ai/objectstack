// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An action not bound to an object accepts no record.
 *
 * ## The rule
 *
 * A call to an object-less action declaration that carries a record key — a
 * `recordId`, or a selection in `params._selectedIds` — is refused `400`
 * naming that key, before any record is read and before its body runs. The
 * rule is judged on the DECLARATION the call resolved to, so it holds however
 * the call is routed: with no object, and under a real object's name alike.
 *
 * ## What is pinned, through every door that runs the one admitted sequence
 *
 * Doors: REST `POST /actions/:object/:action` (`HttpDispatcher.handleActions`),
 * a host's door (`dispatchAction`) and the MCP `run_action` bridge
 * (`invokeBusinessAction`, read as the MCP tool reads its throw).
 *
 *  1. an object-less declaration called with `_selectedIds` → `400`, the key
 *     named, the body never ran, no record read;
 *  2. the same with `recordId`;
 *  3. both, routed under a real object's name;
 *  4. preservation: the object-less action called with neither still runs; an
 *     object-bound action with a selection still runs, and its selection is
 *     still read first (one unreadable id refuses the whole call `404`).
 *
 * Every service is scripted, so "never ran" is a fact about a spy.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/metadata';
import { describe, it, expect, vi } from 'vitest';
import { actionsDoorAnswerOf } from '@objectstack/types';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';

import { HttpDispatcher } from './http-dispatcher.js';
import { callData, invokeBusinessAction } from './action-execution.js';
import { dispatchAction } from './action-dispatch.js';

const PACKAGE = 'com.qa.olrk';
const NAMESPACE = 'olrk';
/** A real object that declares no action of its own. */
const NOTE = 'olrk_note';
/** A real object that declares a bulk action in its own `actions`. */
const TICKET = 'olrk_ticket';
const OBJECT_LESS = 'olrk_broadcast';
const BOUND = 'olrk_close_selected';
const MEMBER_EC = { userId: 'user_olrk', systemPermissions: [] as string[] };
const EXPOSED = { exposed: true, description: 'An action the record-key pins call through every door.' };

const objectLessAction = { name: OBJECT_LESS, label: 'Broadcast', type: 'script', target: OBJECT_LESS, ai: EXPOSED, _packageId: PACKAGE };
const boundAction = { name: BOUND, label: 'Close selected', type: 'script', target: BOUND, execution: 'aggregate', ai: EXPOSED };

/** The ids the caller's own scope reads on each object. */
const READABLE: Record<string, readonly string[]> = {
    [NOTE]: ['note_1'],
    [TICKET]: ['tkt_1', 'tkt_2'],
};

function makeRig() {
    const executeAction = vi.fn(async () => ({ ran: 'script' }));
    const objects: Record<string, any> = {
        [NOTE]: { name: NOTE, label: 'Note', actions: [], _packageId: PACKAGE },
        [TICKET]: { name: TICKET, label: 'Ticket', actions: [boundAction], _packageId: PACKAGE },
    };
    const schemaOf = (n: string) => objects[n];
    const ql: any = {
        executeAction,
        getSchema: schemaOf,
        registry: {
            getObject: schemaOf,
            getItem: (type: string, name: string) => (type === 'action' && name === OBJECT_LESS ? objectLessAction : undefined),
            getNamespaceOwners: (ns: string) => (ns === NAMESPACE ? [PACKAGE] : []),
        },
        isActionEnabled: () => true,
        describeDisabledAction: (name: string) => `The action '${name}' is turned off for this deployment.`,
        listRegisteredActions: () => [
            { objectName: 'global', actionName: OBJECT_LESS },
            { objectName: TICKET, actionName: BOUND },
        ],
        find: vi.fn(async (object: string, query: any) => {
            const id = query?.where?.id;
            return typeof id === 'string' && (READABLE[object] ?? []).includes(id) ? [{ id, name: id }] : [];
        }),
        findOne: vi.fn(async (object: string, query: any) => { assertEngineFindOnePredicate(object, query); return null; }),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async (type: string) => (type === 'action' ? [objectLessAction] : [])),
        listObjects: vi.fn(async () => Object.values(objects)),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
    };
    const audit = { recordActionInvocation: vi.fn(async () => undefined) };
    const resolve = (n: string): any =>
        n === 'objectql' || n === 'data' ? ql
            : n === 'metadata' ? metadata
                : n === 'audit' ? audit
                    : null;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (n: string) => resolve(n),
        context: { getService: resolve },
    };
    const dispatcher = new HttpDispatcher(kernel);

    /** Data reads of a routed row (the subject load and the selection read). */
    const rowReads = () => ql.find.mock.calls.filter(([object]: [string]) => object === NOTE || object === TICKET).length;

    return { kernel, dispatcher, metadata, ql, executeAction, rowReads };
}

type Rig = ReturnType<typeof makeRig>;

interface Call {
    /** The object the call is routed under; omitted, the call names none. */
    object?: string;
    action: string;
    /** Addressed by the package's namespace (ADR-0150 D5). */
    addressed?: boolean;
    recordId?: string;
    params?: Record<string, unknown>;
}

interface Answer { status: number; code?: unknown; field?: unknown }

type Door = 'REST' | 'dispatchAction' | 'MCP';
const DOORS: readonly Door[] = ['REST', 'dispatchAction', 'MCP'];

async function viaDoor(rig: Rig, door: Door, call: Call): Promise<Answer> {
    const body = {
        ...(call.recordId !== undefined ? { recordId: call.recordId } : {}),
        ...(call.params !== undefined ? { params: call.params } : {}),
    };
    if (door === 'REST') {
        const path = `${call.addressed ? `/${NAMESPACE}` : ''}/${call.object ?? 'global'}/${call.action}`;
        const res: any = await rig.dispatcher.handleActions(path, 'POST', body, {
            request: {}, environmentId: 'platform', executionContext: MEMBER_EC,
        } as any);
        const error = res.response.body?.error;
        return { status: res.response.status, code: error?.code, field: error?.details?.fields?.[0]?.field };
    }
    if (door === 'dispatchAction') {
        const res: any = await dispatchAction(rig.kernel, {
            executionContext: MEMBER_EC as any,
            environmentId: 'platform',
            ...(call.object !== undefined ? { objectName: call.object } : {}),
            ...(call.addressed ? { namespace: NAMESPACE } : {}),
            actionName: call.action,
            ...body,
        } as any);
        const error = res.body?.error;
        return { status: res.status, code: error?.code, field: error?.details?.fields?.[0]?.field };
    }
    const request: any = { request: {}, environmentId: 'platform', executionContext: MEMBER_EC };
    const deps: any = {
        resolveService: async (_ctx: any, name: string) => (name === 'audit' ? rig.kernel.getService('audit') : undefined),
        getObjectQL: async () => rig.ql,
    };
    try {
        await invokeBusinessAction(deps, request, call.action, {
            ...(call.object !== undefined ? { objectName: call.object } : {}),
            ...(call.addressed ? { namespace: NAMESPACE } : {}),
            ...body,
        } as any, {
            driver: undefined, envId: 'platform', ec: MEMBER_EC as any,
            getMeta: () => rig.metadata,
            callData: (a, p, d, s, e) => callData(deps, request, a, p, d, s, e),
        });
        return { status: 200 };
    } catch (err) {
        const read = actionsDoorAnswerOf(err, call.object ?? 'global');
        const details = (err as { details?: any }).details;
        return { status: read.status, code: read.code, field: details?.fields?.[0]?.field };
    }
}

/**
 * The routes an object-less declaration is reached by at each door: with no
 * object, and under a real object's name. The MCP bridge reaches an
 * object-less declaration under an object's name by its address only (its
 * bare call on an object reads that object's own actions).
 */
function objectLessRoutes(door: Door): Array<{ label: string; call: Omit<Call, 'action'> }> {
    return [
        { label: 'with no object', call: {} },
        door === 'MCP'
            ? { label: "under a real object's name", call: { object: NOTE, addressed: true } }
            : { label: "under a real object's name", call: { object: NOTE } },
        ...(door === 'MCP' ? [] : [{ label: "under a real object's name, addressed", call: { object: NOTE, addressed: true } }]),
    ];
}

const RECORD_KEYS: ReadonlyArray<{ key: string; carry: Pick<Call, 'recordId' | 'params'> }> = [
    { key: '_selectedIds', carry: { params: { _selectedIds: ['note_1'] } } },
    { key: 'recordId', carry: { recordId: 'note_1' } },
];

describe('an action not bound to an object accepts no record', () => {
    for (const door of DOORS) {
        for (const { label, call } of objectLessRoutes(door)) {
            for (const { key, carry } of RECORD_KEYS) {
                it(`${door}: called ${label} with \`${key}\`, it is refused 400 naming the key, and its body never runs`, async () => {
                    const rig = makeRig();
                    const answer = await viaDoor(rig, door, { ...call, ...carry, action: OBJECT_LESS });
                    expect(answer).toEqual({ status: 400, code: 'VALIDATION_FAILED', field: key });
                    expect(rig.executeAction).not.toHaveBeenCalled();
                    expect(rig.rowReads()).toBe(0);
                });
            }
        }
    }
});

describe('preservation', () => {
    for (const door of DOORS) {
        for (const { label, call } of objectLessRoutes(door)) {
            it(`${door}: an object-less action called ${label} with neither record key still runs`, async () => {
                const rig = makeRig();
                const answer = await viaDoor(rig, door, { ...call, action: OBJECT_LESS, params: { note: 'hi' } });
                expect(answer.status).toBe(200);
                expect(rig.executeAction).toHaveBeenCalledTimes(1);
            });
        }

        it(`${door}: an object-bound action with a readable selection still runs`, async () => {
            const rig = makeRig();
            const answer = await viaDoor(rig, door, { object: TICKET, action: BOUND, params: { _selectedIds: ['tkt_1', 'tkt_2'] } });
            expect(answer.status).toBe(200);
            expect(rig.executeAction).toHaveBeenCalledTimes(1);
            expect(rig.rowReads()).toBe(2);
        });

        it(`${door}: an object-bound action's selection is still read first: one unreadable id refuses the whole call 404`, async () => {
            const rig = makeRig();
            const answer = await viaDoor(rig, door, { object: TICKET, action: BOUND, params: { _selectedIds: ['tkt_1', 'tkt_hidden'] } });
            expect({ status: answer.status, code: answer.code }).toEqual({ status: 404, code: 'RECORD_NOT_FOUND' });
            expect(rig.executeAction).not.toHaveBeenCalled();
        });
    }
});
