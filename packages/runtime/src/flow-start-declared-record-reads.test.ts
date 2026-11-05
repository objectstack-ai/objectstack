// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Flow start admission's third question, asked of the object the FLOW reads
 * (`flow-start-admission.ts`, `flowDeclaredRecordReads`, and
 * `action-execution.ts`, `refuseUnreadableFlowStartRecords`): every start
 * input a flow's own definition reads as the id of a row of a fixed object is
 * an id (or a list of ids, where it is read as one), and is loaded in the
 * CALLER's own scope from THAT object before the run exists.
 *
 * What is pinned:
 *
 *  1. **The reading** (`flowDeclaredRecordReads`): which places in a
 *     definition declare a read, through which regions and callee flows, and
 *     which do not.
 *  2. **The trigger routes**: an input judged against the object the flow
 *     reads it from, whatever object the start names or none; a value that is
 *     not an id refused `400` naming the input, nothing loaded, no run.
 *  3. **A declared `type: 'flow'` endpoint**: the same refusal.
 *  4. **The action door's flow branch**, REST and MCP: the routed id and the
 *     caller's own params are judged against the object the flow reads.
 *  5. **The REST action door's routed record**: one id, or `400` naming
 *     `recordId` before anything is loaded or dispatched.
 *  6. **What stays as it was**: a readable id starts the run (the firing
 *     control for every zero above), a read the definition does not declare,
 *     the system principal.
 *  7. **An input the author declares a record id** (`objectName` on the
 *     variable): loaded from the declared object at every door, read in plain
 *     sight or not, beside any visible read of another object, followed into a
 *     callee; the same input undeclared keeps today's rule (the control).
 *
 * The data double is ROW-SCOPED per object: each row is visible to its owner
 * and to nobody else, and no other id exists, so the real
 * `callData('get', …)` answers the real `RECORD_NOT_FOUND`. One id names a row
 * in both objects, owned by different users, so "the caller reads this id"
 * depends on which object it is read from.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext } from './http-dispatcher.js';
import { callData, invokeBusinessAction } from './action-execution.js';
import { buildEndpointExecutionContext, executeEndpointTarget } from './endpoint-executor.js';
import { flowDeclaredRecordReads } from './flow-start-admission.js';
import { ApiEndpointSchema } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';

const CASE = 'crm_case';
const CONTRACT = 'crm_contract';
const MEMBER = 'usr_member';
const OTHER = 'usr_other';

/** The member's row in both objects. */
const BOTH = 'id_both';
/** The member's row in `crm_case`; the same id in `crm_contract` is the other user's. */
const CASE_ONLY = 'id_case_only';
/** The other user's row in `crm_contract`, and nothing in `crm_case`. */
const CONTRACT_OTHER = 'id_contract_other';
/** An id that names nothing anywhere. */
const GHOST = 'id_ghost';

const cel = (source: string) => ({ dialect: 'cel', source });

type FlowDef = Record<string, unknown> & { name: string };

function flow(name: string, inputs: string[], nodes: unknown[], extra: Record<string, unknown> = {}): FlowDef {
    return {
        name,
        label: name,
        type: 'screen',
        status: 'active',
        variables: inputs.map((input) => ({ name: input, type: 'text', isInput: true })),
        nodes: [{ id: 'start', type: 'start', label: 'Start' }, ...nodes, { id: 'end', type: 'end', label: 'End' }],
        edges: [],
        ...extra,
    };
}

const getRow = (object: string, filter: unknown, type = 'get_record') => ({
    id: `n_${type}_${object}`, type, label: 'Row', config: { objectName: object, filter, outputVariable: 'row' },
});

const BY_RECORD = 'contract_by_record';
const BY_CUSTOM = 'contract_by_custom';
const BY_LIST = 'contract_by_list';
const BY_COMPUTED = 'contract_by_computed';
const SCREEN_EDIT = 'contract_screen_edit';
const SUBFLOW_PARENT = 'contract_subflow_parent';
const MAP_PARENT = 'contract_map_parent';
const DECLARED = 'contract_declared';
const UNDECLARED = 'contract_undeclared';
const DECLARED_AND_READ = 'case_declared_contract_read';
const DECLARED_CALLEE_PARENT = 'contract_declared_callee_parent';

/** A flow whose start input `name` the author declares a record id of `object` (`objectName`). */
function declaring(def: FlowDef, input: string, object: string): FlowDef {
    return {
        ...def,
        variables: (def.variables as Array<Record<string, unknown>>).map((v) => (v.name === input ? { ...v, objectName: object } : v)),
    };
}

const FLOWS: Record<string, FlowDef> = {
    [BY_RECORD]: flow(BY_RECORD, ['recordId'], [getRow(CONTRACT, { id: cel('recordId') })], { runAs: 'system' }),
    [BY_CUSTOM]: flow(BY_CUSTOM, ['contractId'], [getRow(CONTRACT, { id: cel('contractId') })], { runAs: 'system' }),
    [BY_LIST]: flow(BY_LIST, ['contractIds'], [getRow(CONTRACT, { id: { $in: cel('contractIds') } })], { runAs: 'system' }),
    [BY_COMPUTED]: flow(BY_COMPUTED, ['contractId'], [getRow(CONTRACT, { id: cel("contractId + ''") })], { runAs: 'system' }),
    [SCREEN_EDIT]: flow(SCREEN_EDIT, ['contractId'], [
        { id: 'form', type: 'screen', label: 'Edit', config: { objectName: CONTRACT, mode: 'edit', recordId: cel('contractId') } },
    ], { runAs: 'system' }),
    [SUBFLOW_PARENT]: flow(SUBFLOW_PARENT, ['target'], [
        { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: BY_CUSTOM, input: { contractId: cel('vars.target') } } },
    ]),
    [MAP_PARENT]: flow(MAP_PARENT, ['contractIds'], [
        { id: 'each', type: 'map', label: 'Each', config: { collection: cel('contractIds'), flowName: BY_CUSTOM, input: { contractId: cel('item') } } },
    ]),
    // The declared input is read by no node: only the declaration says it is a record id.
    [DECLARED]: declaring(flow(DECLARED, ['contractId'], [], { runAs: 'system' }), 'contractId', CONTRACT),
    // The control: the same flow without the declaration.
    [UNDECLARED]: flow(UNDECLARED, ['contractId'], [], { runAs: 'system' }),
    // Declared an id of `crm_case`, and read in plain sight as an id of `crm_contract`.
    [DECLARED_AND_READ]: declaring(
        flow(DECLARED_AND_READ, ['subjectId'], [getRow(CONTRACT, { id: cel('subjectId') })], { runAs: 'system' }),
        'subjectId', CASE,
    ),
    // Hands its own undeclared input to the declared input of a callee.
    [DECLARED_CALLEE_PARENT]: flow(DECLARED_CALLEE_PARENT, ['target'], [
        { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: DECLARED, input: { contractId: cel('target') } } },
    ]),
};

/** The acting principal, as `resolveExecutionContext` builds one. */
function ec(userId: string) {
    return { userId, tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] };
}

const CONTRACT_ACTION = {
    name: 'open_contract', label: 'Open contract', objectName: CASE, type: 'flow', target: BY_RECORD,
    ai: { exposed: true, description: 'Open the contract.' },
};
const CUSTOM_ACTION = {
    name: 'open_contract_by_param', label: 'Open contract by param', objectName: CASE, type: 'flow', target: BY_CUSTOM,
    params: [{ name: 'contractId', label: 'Contract', type: 'text' }],
};
const SCRIPT_ACTION = { name: 'touch_case', label: 'Touch', objectName: CASE, type: 'script', execute: 'return 1' };
const DECLARED_ACTION = {
    name: 'open_declared_contract', label: 'Open declared contract', objectName: CASE, type: 'flow', target: DECLARED,
    params: [{ name: 'contractId', label: 'Contract', type: 'text' }],
    ai: { exposed: true, description: 'Open the declared contract.' },
};
const UNDECLARED_ACTION = { ...DECLARED_ACTION, name: 'open_undeclared_contract', label: 'Open undeclared contract', target: UNDECLARED };
const CASE_DEF = { name: CASE, actions: [CONTRACT_ACTION, CUSTOM_ACTION, SCRIPT_ACTION, DECLARED_ACTION, UNDECLARED_ACTION] };
const CONTRACT_DEF = { name: CONTRACT, actions: [] };
const schemaOf = (n: string) => (n === CASE ? CASE_DEF : n === CONTRACT ? CONTRACT_DEF : undefined);

/** Row-scoped reads, per object: each row to its owner, nothing else exists. */
function makeQl() {
    const rows: Record<string, Array<{ id: string; owner_id: string }>> = {
        [CASE]: [{ id: BOTH, owner_id: MEMBER }, { id: CASE_ONLY, owner_id: MEMBER }],
        [CONTRACT]: [{ id: BOTH, owner_id: MEMBER }, { id: CASE_ONLY, owner_id: OTHER }, { id: CONTRACT_OTHER, owner_id: OTHER }],
    };
    return {
        executeAction: vi.fn(async () => ({ ok: true })),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async (object: string, options?: any) => {
            const caller = options?.context?.isSystem ? '*' : options?.context?.userId;
            const wanted = options?.where?.id;
            return (rows[object] ?? []).filter((r) => (wanted === undefined || r.id === wanted)
                && (caller === '*' || r.owner_id === caller));
        }),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    } as any;
}

function makeAutomation() {
    return {
        handlerReady: true,
        execute: vi.fn(async (_flow: string, _context?: any) => ({
            success: true, status: 'paused', runId: 'run_test', durationMs: 1,
        })),
        getFlow: vi.fn(async (name: string) => FLOWS[name] ?? null),
    };
}

function makeMetadata() {
    return {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [CASE_DEF, CONTRACT_DEF]),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
    };
}

function boot(principal: Record<string, unknown>) {
    const ql = makeQl();
    const automation = makeAutomation();
    const metadata = makeMetadata();
    const resolve = (n: string): unknown =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : n === 'automation' ? automation
        : undefined;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch` writes `context.executionContext` from.
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...principal });
    const context = (): HttpProtocolContext =>
        ({ request: {}, environmentId: 'platform', executionContext: { ...principal } }) as any;
    return {
        ql,
        automation,
        /** The wire answer through the registered trigger route. */
        trigger: (flowName: string, body: unknown, legacy = false) =>
            dispatcher.dispatch('POST', legacy ? `/automation/trigger/${flowName}` : `/automation/${flowName}/trigger`,
                body, {}, { request: {}, environmentId: 'platform' } as HttpProtocolContext),
        /** The REST action door. */
        actions: (path: string, body?: unknown) => (dispatcher as any).handleActions(path, 'POST', body ?? {}, context()),
        /** The MCP `run_action` bridge, on the REAL `callData`. */
        runAction: (name: string, input: Record<string, unknown>) => {
            const deps: any = {
                resolveService: async (_ctx: any, service: string) => (service === 'automation' ? automation : undefined),
                getObjectQL: async () => ql,
            };
            const requestContext: any = { request: {}, environmentId: 'platform' };
            return invokeBusinessAction(deps, requestContext, name, input as any, {
                driver: undefined,
                envId: 'platform',
                ec: { ...principal },
                getMeta: () => metadata,
                callData: (action, params, dataDriver, scopeId, execCtx) =>
                    callData(deps, requestContext, action, params, dataDriver, scopeId, execCtx),
            });
        },
    };
}

const statusOf = (r: any): unknown => r?.response?.status;
const errorOf = (r: any): any => r?.response?.body?.error ?? {};
/** Every row read, `[object, id]`. */
const reads = (h: { ql: any }): Array<[string, unknown]> =>
    h.ql.find.mock.calls.map((c: any[]) => [c[0], c[1]?.where?.id]);
/** The refusal envelope with the id normalised out, so two ids compare equal. */
const envelopeOf = (r: any, id: string) => ({
    status: statusOf(r),
    code: errorOf(r).code,
    message: String(errorOf(r).message ?? '').split(id).join('<ID>'),
});

// ───────────────────────────────────────────────────────────────────────────
// 1. The reading
// ───────────────────────────────────────────────────────────────────────────

describe('flowDeclaredRecordReads: the record reads a definition declares for its start inputs', () => {
    const readsOf = (defs: FlowDef[], name = defs[0]!.name) =>
        flowDeclaredRecordReads({ getFlow: async (n: string) => defs.find((d) => d.name === n) ?? null }, name)
            .then((m) => Object.fromEntries(m));

    it.each(['get_record', 'update_record', 'delete_record'])('a `%s` node whose `filter.id` is the input: one id of that object', async (type) => {
        expect(await readsOf([flow('f', ['x'], [getRow(CONTRACT, { id: cel('x') }, type)])])).toEqual({ x: [{ object: CONTRACT, many: false }] });
    });

    it('`filter.id.$eq` reads one id, `filter.id.$in` a list of ids', async () => {
        expect(await readsOf([flow('f', ['a', 'b'], [getRow(CONTRACT, { id: { $eq: cel('a') } }), getRow(CASE, { id: { $in: cel('b') } })])]))
            .toEqual({ a: [{ object: CONTRACT, many: false }], b: [{ object: CASE, many: true }] });
    });

    it('the `vars.` spelling of the input is the input', async () => {
        expect(await readsOf([flow('f', ['x'], [getRow(CONTRACT, { id: cel('vars.x') })])])).toEqual({ x: [{ object: CONTRACT, many: false }] });
    });

    it('a screen edit form whose `recordId` is the input', async () => {
        expect(await readsOf([FLOWS[SCREEN_EDIT]!])).toEqual({ contractId: [{ object: CONTRACT, many: false }] });
    });

    it('a node inside a structured region (a loop body, a try region) declares its read too', async () => {
        const looped = flow('f', ['x', 'y'], [
            { id: 'loop', type: 'loop', label: 'Loop', config: { collection: [1], iteratorVariable: 'it', body: { nodes: [getRow(CONTRACT, { id: cel('x') })], edges: [] } } },
            { id: 'try', type: 'try_catch', label: 'Try', config: { try: { nodes: [getRow(CASE, { id: cel('y') })], edges: [] } } },
        ]);
        expect(await readsOf([looped])).toEqual({ x: [{ object: CONTRACT, many: false }], y: [{ object: CASE, many: false }] });
    });

    it('through a subflow hand-off, and a map that hands each item on (a list of ids)', async () => {
        expect(await readsOf(Object.values(FLOWS), SUBFLOW_PARENT)).toEqual({ target: [{ object: CONTRACT, many: false }] });
        expect(await readsOf(Object.values(FLOWS), MAP_PARENT)).toEqual({ contractIds: [{ object: CONTRACT, many: true }] });
    });

    it('a flow that calls itself is read once, and the reading ends', async () => {
        const self = flow('f', ['x'], [
            getRow(CONTRACT, { id: cel('x') }),
            { id: 'again', type: 'subflow', label: 'Again', config: { flowName: 'f', input: { x: cel('x') } } },
        ]);
        expect(await readsOf([self])).toEqual({ x: [{ object: CONTRACT, many: false }] });
    });

    it('declares nothing for a value that is not a start input, is computed, or addresses an object the definition does not name', async () => {
        const nothing = flow('f', ['x'], [
            getRow(CONTRACT, { id: cel('notAnInput') }),
            getRow(CONTRACT, { id: cel("x + ''") }),
            getRow(CONTRACT, { name: cel('x') }),
            { id: 'dyn', type: 'get_record', label: 'Dyn', config: { objectName: cel('x'), filter: { id: cel('x') } } },
        ]);
        (nothing.variables as unknown[]).push({ name: 'notAnInput', type: 'text' });
        expect(await readsOf([nothing])).toEqual({});
    });

    it('a name a loop or map binds as its item is not read as the start input it shadows', async () => {
        const shadowed = flow('f', ['x'], [
            { id: 'loop', type: 'loop', label: 'Loop', config: { collection: [1], iteratorVariable: 'x', body: { nodes: [getRow(CONTRACT, { id: cel('x') })], edges: [] } } },
        ]);
        expect(await readsOf([shadowed])).toEqual({});
    });

    it('a service that cannot be asked, or a flow it does not serve, declares nothing', async () => {
        expect((await flowDeclaredRecordReads({}, BY_CUSTOM)).size).toBe(0);
        expect(await readsOf([], 'missing')).toEqual({});
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The trigger routes
// ───────────────────────────────────────────────────────────────────────────

describe('the trigger routes judge each start input against the object the flow reads it from', () => {
    for (const legacy of [false, true]) {
        const label = legacy ? 'legacy POST /automation/trigger/:name' : 'POST /automation/:name/trigger';
        describe(label, () => {
            it('a record key readable in the object the start names, but not in the object the flow reads: 404, no run', async () => {
                const h = boot(ec(MEMBER));
                const res = await h.trigger(BY_RECORD, { recordId: CASE_ONLY, objectName: CASE }, legacy);

                expect(statusOf(res)).toBe(404);
                expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
                expect(reads(h)).toContainEqual([CONTRACT, CASE_ONLY]);
                expect(h.automation.execute).not.toHaveBeenCalled();
            });

            it('a record key readable in both: the run starts, the firing control', async () => {
                const h = boot(ec(MEMBER));
                const res = await h.trigger(BY_RECORD, { recordId: BOTH, objectName: CASE }, legacy);

                expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
                expect(h.automation.execute).toHaveBeenCalledTimes(1);
                expect(reads(h)).toContainEqual([CONTRACT, BOTH]);
            });
        });
    }

    it('a custom input the flow reads as an id the caller cannot read: 404, no run', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.trigger(BY_CUSTOM, { params: { contractId: CONTRACT_OTHER } });

        expect(statusOf(res)).toBe(404);
        expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
        expect(h.automation.execute).not.toHaveBeenCalled();
    });

    it('…and one it can read starts the run with the value as given', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.trigger(BY_CUSTOM, { params: { contractId: BOTH } });

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(h.automation.execute.mock.calls[0]![1].params).toMatchObject({ contractId: BOTH });
    });

    it.each([
        ['an object', { id: BOTH }],
        ['a list', [BOTH]],
        ['a boolean', true],
    ])('a custom input the flow reads as one id, given %s: 400 naming the input, nothing loaded, no run', async (_label, value) => {
        const h = boot(ec(MEMBER));
        const res = await h.trigger(BY_CUSTOM, { params: { contractId: value } });

        expect(statusOf(res)).toBe(400);
        expect(errorOf(res).code).toBe('VALIDATION_FAILED');
        expect(String(errorOf(res).message)).toContain('`contractId`');
        expect(JSON.stringify(errorOf(res).details ?? {})).toContain('contractId');
        expect(reads(h)).toHaveLength(0);
        expect(h.automation.execute).not.toHaveBeenCalled();
    });

    it('an unreadable id and an id that names nothing are one refusal', async () => {
        const denied = await boot(ec(MEMBER)).trigger(BY_CUSTOM, { params: { contractId: CONTRACT_OTHER } });
        const nothing = await boot(ec(MEMBER)).trigger(BY_CUSTOM, { params: { contractId: GHOST } });

        expect(envelopeOf(nothing, GHOST)).toEqual(envelopeOf(denied, CONTRACT_OTHER));
    });

    describe('an input the flow reads as a list of ids', () => {
        it('every id readable: the run starts', async () => {
            const h = boot(ec(MEMBER));
            const res = await h.trigger(BY_LIST, { params: { contractIds: [BOTH] } });

            expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
            expect(h.automation.execute).toHaveBeenCalledTimes(1);
        });

        it('one id unreadable: 404, no run', async () => {
            const h = boot(ec(MEMBER));
            const res = await h.trigger(BY_LIST, { params: { contractIds: [BOTH, CONTRACT_OTHER] } });

            expect(statusOf(res)).toBe(404);
            expect(h.automation.execute).not.toHaveBeenCalled();
        });

        it.each([
            ['one id', BOTH],
            ['a list holding an object', [{ id: BOTH }]],
        ])('given %s: 400 naming the input, nothing loaded, no run', async (_label, value) => {
            const h = boot(ec(MEMBER));
            const res = await h.trigger(BY_LIST, { params: { contractIds: value } });

            expect(statusOf(res)).toBe(400);
            expect(String(errorOf(res).message)).toContain('`contractIds`');
            expect(reads(h)).toHaveLength(0);
            expect(h.automation.execute).not.toHaveBeenCalled();
        });
    });

    it.each([
        ['a subflow it hands the input to', SUBFLOW_PARENT, { target: CONTRACT_OTHER }],
        ['a map that hands each item on', MAP_PARENT, { contractIds: [BOTH, CONTRACT_OTHER] }],
        ['a screen edit form', SCREEN_EDIT, { contractId: CONTRACT_OTHER }],
    ])('a read the flow declares through %s: 404, no run, whatever the flow runs as and with no object named', async (_label, flowName, params) => {
        const h = boot(ec(MEMBER));
        const res = await h.trigger(flowName, { params });

        expect(statusOf(res)).toBe(404);
        expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
        expect(h.automation.execute).not.toHaveBeenCalled();
    });
});

describe('what the trigger routes keep exactly as they were', () => {
    it('a read the definition does not declare (a computed id) is not judged', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.trigger(BY_COMPUTED, { params: { contractId: CONTRACT_OTHER } });

        expect(statusOf(res)).toBe(200);
        expect(h.automation.execute).toHaveBeenCalledTimes(1);
        expect(reads(h)).toHaveLength(0);
    });

    it('the system principal starts on any id, nothing loaded', async () => {
        const h = boot({ isSystem: true });
        const res = await h.trigger(BY_CUSTOM, { params: { contractId: CONTRACT_OTHER } });

        expect(statusOf(res)).toBe(200);
        expect(h.automation.execute).toHaveBeenCalledTimes(1);
        expect(reads(h)).toHaveLength(0);
    });

    it('an input the flow does not read as an id is not judged', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.trigger(BY_CUSTOM, { params: { contractId: BOTH, note: { any: 'shape' } } });

        expect(statusOf(res)).toBe(200);
        expect(h.automation.execute).toHaveBeenCalledTimes(1);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. A declared `type: 'flow'` endpoint
// ───────────────────────────────────────────────────────────────────────────

describe('a declared `type: flow` endpoint asks the same question', () => {
    const endpoint = ApiEndpointSchema.parse({
        name: 'contract_open', path: '/api/v1/apps/contract/open', method: 'POST', type: 'flow', target: BY_CUSTOM,
    });

    async function run(userId: string, body: unknown) {
        const ql = makeQl();
        const automation = makeAutomation();
        const deps: any = { resolveService: async () => undefined, getObjectQL: async () => ql };
        const protocolContext: any = { request: {}, environmentId: 'platform', executionContext: ec(userId) };
        const match: ApiEndpointMatch = { endpoint, params: {} };
        const answer = await executeEndpointTarget(
            buildEndpointExecutionContext({
                request: { method: 'POST', path: endpoint.path, query: {}, headers: {}, body },
                match,
                executionContext: ec(userId) as any,
                environmentId: 'platform',
            }),
            {
                automationService: automation,
                callData: (action, params, dataDriver, scopeId, execCtx) =>
                    callData(deps, protocolContext, action, params, dataDriver, scopeId, execCtx),
            },
        );
        return { answer, automation };
    }

    it('an input the flow reads as an id the caller cannot read: 404, no run', async () => {
        const { answer, automation } = await run(MEMBER, { params: { contractId: CONTRACT_OTHER } });

        expect(answer.status).toBe(404);
        expect((answer.body as any)?.error?.code).toBe('RECORD_NOT_FOUND');
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('one it can read starts the run: the firing control', async () => {
        const { answer, automation } = await run(MEMBER, { params: { contractId: BOTH } });

        expect(answer.status).toBe(200);
        expect(automation.execute).toHaveBeenCalledTimes(1);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The action door's flow branch
// ───────────────────────────────────────────────────────────────────────────

describe('the action door judges what it hands the run against the object the flow reads', () => {
    it('REST: a routed row readable in the action\'s object, not in the object the flow reads: 404, no run', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${CASE}/${CONTRACT_ACTION.name}/${CASE_ONLY}`);

        expect(statusOf(res)).toBe(404);
        expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
        expect(reads(h)).toContainEqual([CONTRACT, CASE_ONLY]);
        expect(h.automation.execute).not.toHaveBeenCalled();
    });

    it('REST: a routed row readable in both starts the run: the firing control', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${CASE}/${CONTRACT_ACTION.name}/${BOTH}`);

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(h.automation.execute).toHaveBeenCalledTimes(1);
    });

    it('MCP: the same routed row is thrown the same refusal, no run', async () => {
        const h = boot(ec(MEMBER));

        await expect(h.runAction(CONTRACT_ACTION.name, { objectName: CASE, recordId: CASE_ONLY }))
            .rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(h.automation.execute).not.toHaveBeenCalled();
    });

    it('REST: a declared action param the flow reads as an id the caller cannot read: 404, no run', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${CASE}/${CUSTOM_ACTION.name}/${BOTH}`, { params: { contractId: CONTRACT_OTHER } });

        expect(statusOf(res)).toBe(404);
        expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
        expect(h.automation.execute).not.toHaveBeenCalled();
    });

    it('REST: …and one it can read starts the run', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${CASE}/${CUSTOM_ACTION.name}/${BOTH}`, { params: { contractId: BOTH } });

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(h.automation.execute).toHaveBeenCalledTimes(1);
    });

    it('the trigger route and the action door answer one refusal for one row', async () => {
        const viaTrigger = await boot(ec(MEMBER)).trigger(BY_RECORD, { recordId: CASE_ONLY, objectName: CASE });
        const viaAction = await boot(ec(MEMBER)).actions(`/${CASE}/${CONTRACT_ACTION.name}/${CASE_ONLY}`);

        expect(envelopeOf(viaAction, CASE_ONLY)).toEqual(envelopeOf(viaTrigger, CASE_ONLY));
        expect(envelopeOf(viaAction, CASE_ONLY)).toMatchObject({ status: 404, code: 'RECORD_NOT_FOUND' });
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. The REST action door's routed record is one id
// ───────────────────────────────────────────────────────────────────────────

describe('the REST action door refuses a routed record that is not one id, before anything is loaded or run', () => {
    const NOT_ONE_ID: Array<[string, unknown]> = [
        ['an object', { id: BOTH }],
        ['a list', [BOTH]],
        ['a boolean', true],
    ];

    for (const action of [CONTRACT_ACTION, SCRIPT_ACTION]) {
        it.each(NOT_ONE_ID)(`${action.type} action: \`recordId\` given %s: 400 VALIDATION_FAILED naming \`recordId\``, async (_label, value) => {
            const h = boot(ec(MEMBER));
            const res = await h.actions(`/${CASE}/${action.name}`, { recordId: value });

            expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(400);
            expect(errorOf(res).code).toBe('VALIDATION_FAILED');
            expect(errorOf(res).details?.fields).toMatchObject([{ field: 'recordId', code: 'invalid_type' }]);
            expect(String(errorOf(res).message)).toMatch(/^Invalid action body/);
            expect(reads(h)).toHaveLength(0);
            expect(h.automation.execute).not.toHaveBeenCalled();
            expect(h.ql.executeAction).not.toHaveBeenCalled();
        });
    }

    it('a string id in the body is loaded as before: the firing control', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${CASE}/${CONTRACT_ACTION.name}`, { recordId: BOTH });

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(reads(h)).toContainEqual([CASE, BOTH]);
    });

    it('a number id in the body passes the shape check and is loaded', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${CASE}/${CONTRACT_ACTION.name}`, { recordId: 42 });

        expect(statusOf(res)).toBe(404);
        expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
        expect(reads(h).length).toBeGreaterThan(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. An input the author declares a record id (`objectName`, #29425 ruling A)
// ───────────────────────────────────────────────────────────────────────────

describe('a start input declared a record id is loaded from the declared object at every door, before the run exists', () => {
    const readsOf = (name: string) =>
        flowDeclaredRecordReads({ getFlow: async (n: string) => FLOWS[n] ?? null }, name).then((m) => Object.fromEntries(m));

    /** The declared `type: 'flow'` endpoint door, on the real `callData`. */
    async function endpoint(target: string, body: unknown) {
        const declared = ApiEndpointSchema.parse({
            name: `${target}_open`, path: `/api/v1/apps/${target}/open`, method: 'POST', type: 'flow', target,
        });
        const ql = makeQl();
        const automation = makeAutomation();
        const deps: any = { resolveService: async () => undefined, getObjectQL: async () => ql };
        const protocolContext: any = { request: {}, environmentId: 'platform', executionContext: ec(MEMBER) };
        const answer = await executeEndpointTarget(
            buildEndpointExecutionContext({
                request: { method: 'POST', path: declared.path, query: {}, headers: {}, body },
                match: { endpoint: declared, params: {} },
                executionContext: ec(MEMBER) as any,
                environmentId: 'platform',
            }),
            {
                automationService: automation,
                callData: (action, params, dataDriver, scopeId, execCtx) =>
                    callData(deps, protocolContext, action, params, dataDriver, scopeId, execCtx),
            },
        );
        return { status: answer.status, error: (answer.body as any)?.error ?? {}, ql, automation };
    }

    /**
     * One start of `flowName` with `contractId` set to `value`, at each door that
     * starts a flow by name, read back as status + error + what was loaded + runs.
     */
    const DOORS: Record<string, (flowName: string, value: unknown) => Promise<{ status: unknown; error: any; ql: any; automation: any }>> = {
        'POST /automation/:name/trigger': async (flowName, value) => {
            const h = boot(ec(MEMBER));
            const res = await h.trigger(flowName, { params: { contractId: value } });
            return { status: statusOf(res), error: errorOf(res), ql: h.ql, automation: h.automation };
        },
        'legacy POST /automation/trigger/:name': async (flowName, value) => {
            const h = boot(ec(MEMBER));
            const res = await h.trigger(flowName, { params: { contractId: value } }, true);
            return { status: statusOf(res), error: errorOf(res), ql: h.ql, automation: h.automation };
        },
        'a declared `type: flow` endpoint': (flowName, value) => endpoint(flowName, { params: { contractId: value } }),
        'REST POST /actions/:object/:action': async (flowName, value) => {
            const h = boot(ec(MEMBER));
            const action = flowName === DECLARED ? DECLARED_ACTION : UNDECLARED_ACTION;
            const res = await h.actions(`/${CASE}/${action.name}/${BOTH}`, { params: { contractId: value } });
            return { status: statusOf(res), error: errorOf(res), ql: h.ql, automation: h.automation };
        },
        'MCP run_action': async (flowName, value) => {
            const h = boot(ec(MEMBER));
            const action = flowName === DECLARED ? DECLARED_ACTION : UNDECLARED_ACTION;
            try {
                await h.runAction(action.name, { objectName: CASE, recordId: BOTH, params: { contractId: value } });
                return { status: 200, error: {}, ql: h.ql, automation: h.automation };
            } catch (err: any) {
                return { status: err?.status, error: err ?? {}, ql: h.ql, automation: h.automation };
            }
        },
    };
    /**
     * The code a value that is not an id is refused with, per door. The trigger
     * routes and the endpoint hand every param to the start check, which answers
     * `VALIDATION_FAILED`. The action doors type each declared param first
     * (ADR-0104 D2), so a `text` param holding an object, a list or a boolean
     * is refused there, `400 VALIDATION_ERROR` naming the same param, before
     * the start check is reached: one more gate in front, never a gap.
     */
    const NOT_AN_ID_CODE = (door: string): string => (door.includes('action') ? 'VALIDATION_ERROR' : 'VALIDATION_FAILED');
    /** Every `crm_contract` row the start loaded. */
    const contractReads = (ql: any) => ql.find.mock.calls.filter((c: any[]) => c[0] === CONTRACT).map((c: any[]) => c[1]?.where?.id);

    it('the reading: a declared input is one id of the declared object, read by no node', async () => {
        expect(await readsOf(DECLARED)).toEqual({ contractId: [{ object: CONTRACT, many: false }] });
        expect(await readsOf(UNDECLARED)).toEqual({});
    });

    it('the reading: a declaration sits beside a read in plain sight of another object, never in place of it', async () => {
        expect(await readsOf(DECLARED_AND_READ)).toEqual({
            subjectId: [{ object: CASE, many: false }, { object: CONTRACT, many: false }],
        });
    });

    it('the reading: a callee\'s declared input is followed through the hand-off', async () => {
        expect(await readsOf(DECLARED_CALLEE_PARENT)).toEqual({ target: [{ object: CONTRACT, many: false }] });
    });

    it('the reading: a loop that rebinds the name does not withdraw the declaration', async () => {
        const looped = declaring(flow('looped', ['x'], [
            { id: 'loop', type: 'loop', label: 'Loop', config: { collection: [1], iteratorVariable: 'x', body: { nodes: [getRow(CASE, { id: cel('x') })], edges: [] } } },
        ]), 'x', CONTRACT);
        const got = await flowDeclaredRecordReads({ getFlow: async () => looped }, 'looped');
        expect(Object.fromEntries(got)).toEqual({ x: [{ object: CONTRACT, many: false }] });
    });

    for (const [door, start] of Object.entries(DOORS)) {
        describe(door, () => {
            it('a declared input naming a record the caller can read: the run starts, the firing control', async () => {
                const got = await start(DECLARED, BOTH);

                expect(got.status, JSON.stringify(got.error)).toBe(200);
                expect(got.automation.execute).toHaveBeenCalledTimes(1);
                expect(contractReads(got.ql)).toContain(BOTH);
            });

            it.each([
                ['the caller cannot read', CONTRACT_OTHER],
                ['does not exist', GHOST],
            ])('a declared input naming a record the caller %s: 404 RECORD_NOT_FOUND, no run', async (_label, id) => {
                const got = await start(DECLARED, id);

                expect(got.status).toBe(404);
                expect(got.error.code).toBe('RECORD_NOT_FOUND');
                expect(contractReads(got.ql)).toContain(id);
                expect(got.automation.execute).not.toHaveBeenCalled();
            });

            it.each([
                ['an object', { id: BOTH }],
                ['a list', [BOTH]],
                ['a boolean', true],
            ])('a declared input given %s: 400 naming the input, nothing loaded from the declared object, no run', async (_label, value) => {
                const got = await start(DECLARED, value);

                expect(got.status).toBe(400);
                expect(got.error.code).toBe(NOT_AN_ID_CODE(door));
                expect(String(got.error.message)).toContain('contractId');
                expect(contractReads(got.ql)).toHaveLength(0);
                expect(got.automation.execute).not.toHaveBeenCalled();
            });

            it('the same input undeclared, read by no node: not judged, the run starts on an id the caller cannot read (today\'s rule)', async () => {
                const got = await start(UNDECLARED, CONTRACT_OTHER);

                expect(got.status, JSON.stringify(got.error)).toBe(200);
                expect(got.automation.execute).toHaveBeenCalledTimes(1);
                expect(contractReads(got.ql)).toHaveLength(0);
            });
        });
    }

    it('declared one object and read from another: the caller must read the row in both', async () => {
        const inCaseOnly = boot(ec(MEMBER));
        const refused = await inCaseOnly.trigger(DECLARED_AND_READ, { params: { subjectId: CASE_ONLY } });
        expect(statusOf(refused)).toBe(404);
        expect(errorOf(refused).code).toBe('RECORD_NOT_FOUND');
        expect(reads(inCaseOnly)).toEqual(expect.arrayContaining([[CASE, CASE_ONLY], [CONTRACT, CASE_ONLY]]));
        expect(inCaseOnly.automation.execute).not.toHaveBeenCalled();

        const inBoth = boot(ec(MEMBER));
        const started = await inBoth.trigger(DECLARED_AND_READ, { params: { subjectId: BOTH } });
        expect(statusOf(started), JSON.stringify(started?.response?.body)).toBe(200);
        expect(inBoth.automation.execute).toHaveBeenCalledTimes(1);
    });

    it('a parent that hands its input to a callee\'s declared input is judged by the callee\'s declaration', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.trigger(DECLARED_CALLEE_PARENT, { params: { target: CONTRACT_OTHER } });

        expect(statusOf(res)).toBe(404);
        expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
        expect(h.automation.execute).not.toHaveBeenCalled();
    });

    it('the system principal starts on any declared id, nothing loaded', async () => {
        const h = boot({ isSystem: true });
        const res = await h.trigger(DECLARED, { params: { contractId: CONTRACT_OTHER } });

        expect(statusOf(res)).toBe(200);
        expect(h.automation.execute).toHaveBeenCalledTimes(1);
        expect(reads(h)).toHaveLength(0);
    });
});
