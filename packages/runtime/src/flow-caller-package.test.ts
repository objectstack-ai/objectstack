// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3, epic #31527 child B (flow), #31696] A flow action's and a
 * flow endpoint's `target` is a reference its own package wrote, so it
 * resolves from that package.
 *
 * Once the flow's one-holder rule narrows to the namespace (ADR-0150 D9), a
 * second namespace may install a flow of the name package P's action or
 * endpoint names. The engine then holds both flows, one slot each, and
 * refuses the bare name (409, naming both). Read bare, P's own action and
 * endpoint would answer that 409 from the moment the other package installs:
 * fail closed, but not D3, which resolves P's own item first (seat ruling
 * 6810580480 item 2, epic red line 3). Pinned here, through the real `/actions`
 * door and the endpoint executor:
 *
 *  - P's flow action and P's flow endpoint still run P's flow, from P's slot,
 *    with a second namespace's same-name flow installed;
 *  - CONTROL: an action and an endpoint with no package still get the 409
 *    naming both holders, and nothing runs;
 *  - a package that reaches neither holder is refused naming both;
 *  - a name one package holds is read bare, exactly as before.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiEndpointSchema } from '@objectstack/spec/api';

// Paid at collection, not inside a case's clock (check:test-source-alias): the
// dispatcher chain this file reaches loads it dynamically.
import '@objectstack/metadata';
import { HttpDispatcher } from './http-dispatcher.js';
import { executeEndpointTarget, type EndpointExecutionContext } from './endpoint-executor.js';
import { endpointPackageOf, flowHolderForCaller, flowServiceForCaller, flowSlotView, flowWalkReads } from './flow-slot-view.js';
import { SchemaRegistry, type PackageScopedRegistry } from '@objectstack/objectql';
import { admitAutomationAddress, bareNameAdmission, bareNameRefusal } from './domains/automation-address.js';

const CRM = 'com.crm.pkg';
const HR = 'com.hr.pkg';
const OPS = 'com.ops.pkg';
const FLOW = 'convert_lead';

type Installed = NonNullable<ReturnType<PackageScopedRegistry['getPackage']>>;
/** An installed package as the closure walk reads it: its manifest's id, namespace and dependencies. */
const installed = (manifest: { id: string; namespace: string; dependencies?: Record<string, string> }) =>
    ({ manifest, source: 'code' }) as unknown as Installed;

/** The registry's holder table: `type:name` → the packages holding it. */
function registryWith(packages: Record<string, string[]>, namespaces: Record<string, string> = { [CRM]: 'crm', [HR]: 'hr', [OPS]: 'ops' }) {
    const holdersOf = (type: string, name: string) => packages[`${type}:${name}`] ?? [];
    return {
        packageScopedHoldersOf: (type: string, name: string) => holdersOf(type, name),
        getPackageScopedItem: <T,>(type: string, name: string, packageId: string): T | undefined =>
            (holdersOf(type, name).includes(packageId) ? ({ name, _packageId: packageId } as T) : undefined),
        getEnvironmentScopedItem: () => undefined,
        getPackage: (id: string): Installed | undefined => (namespaces[id] ? installed({ id, namespace: namespaces[id] }) : undefined),
        getAllPackages: (): Installed[] => Object.keys(namespaces).map((id) => installed({ id, namespace: namespaces[id] })),
        getNamespaceOwners: (ns: string) => Object.keys(namespaces).filter((id) => namespaces[id] === ns),
    };
}

/** An engine holding `FLOW` in one slot per holder, its bare entries refusing a shared name as the engine's do. */
function engineWith(holders: string[]) {
    const shared = holders.length > 1;
    const refusal = () => Object.assign(new Error(`Flow '${FLOW}' is held by ${holders.join(' and ')}`), { code: 'RESOURCE_CONFLICT', status: 409 });
    const keyOf = (pkg: string | null) => (pkg !== null && holders.includes(pkg) ? (shared ? `${pkg}/${FLOW}` : FLOW) : undefined);
    return {
        handlerReady: true,
        getFlow: vi.fn(async (name: string) => {
            if (name !== FLOW) return null;
            if (shared) throw refusal();
            return { name, label: `${holders[0]} flow` };
        }),
        execute: vi.fn(async (_name: string, _context?: unknown) => ({ success: true, output: { ran: 'bare' } })),
        flowSlotKey: vi.fn((pkg: string | null, name: string) => (name === FLOW ? keyOf(pkg) : undefined)),
        getFlowSlot: vi.fn((pkg: string | null, name: string) => (name === FLOW && keyOf(pkg) ? { name, label: `${pkg} flow` } : null)),
        executeSlot: vi.fn(async (pkg: string | null, _name: string, _context?: unknown) => ({ success: true, output: { ran: pkg } })),
        toggleFlowSlot: vi.fn(async () => {}),
    };
}

describe('flowServiceForCaller — the target resolves from the caller package', () => {
    const shared = registryWith({ [`flow:${FLOW}`]: [CRM, HR] });

    it('a name two packages hold: the caller package\'s own flow, from its slot', async () => {
        const engine = engineWith([CRM, HR]);
        const service = flowServiceForCaller(engine, shared, FLOW, HR);
        expect(await service.getFlow(FLOW)).toEqual({ name: FLOW, label: `${HR} flow` });
        await service.execute(FLOW, {} as never);
        expect(engine.executeSlot.mock.calls.map((c) => [c[0], c[1]])).toEqual([[HR, FLOW]]);
        expect(engine.execute).not.toHaveBeenCalled();
        expect(engine.getFlow).not.toHaveBeenCalled();
    });

    it('a package that depends on one holder reaches that holder\'s flow', async () => {
        const engine = engineWith([CRM, HR]);
        const registry = registryWith({ [`flow:${FLOW}`]: [CRM, HR] });
        const withDependency = {
            ...registry,
            getPackage: (id: string) => (id === OPS
                ? installed({ id, namespace: 'ops', dependencies: { [CRM]: '^1.0.0' } })
                : registry.getPackage(id)),
        };
        await flowServiceForCaller(engine, withDependency, FLOW, OPS).execute(FLOW, {} as never);
        expect(engine.executeSlot.mock.calls.map((c) => c[0])).toEqual([CRM]);
    });

    it('a package that reaches neither holder is refused, naming both, before anything is read', () => {
        const engine = engineWith([CRM, HR]);
        let thrown: any;
        try {
            flowServiceForCaller(engine, shared, FLOW, OPS);
        } catch (err) {
            thrown = err;
        }
        expect([thrown?.code, thrown?.status]).toEqual(['RESOURCE_CONFLICT', 409]);
        expect(thrown?.refusal?.candidates?.map((c: { packageId?: string }) => c.packageId)).toEqual([CRM, HR]);
        expect(engine.getFlow).not.toHaveBeenCalled();
        expect(engine.getFlowSlot).not.toHaveBeenCalled();
    });

    it('CONTROL — no caller package: the service itself, whose bare entries refuse the shared name', async () => {
        const engine = engineWith([CRM, HR]);
        expect(flowServiceForCaller(engine, shared, FLOW, undefined)).toBe(engine);
    });

    it('CONTROL — a name one package holds is read bare, as before, whatever the caller', () => {
        const engine = engineWith([CRM]);
        expect(flowServiceForCaller(engine, registryWith({ [`flow:${FLOW}`]: [CRM] }), FLOW, HR)).toBe(engine);
    });

    it('CONTROL — an engine with no slot entries is the service itself (fail closed: its bare entries refuse)', () => {
        const { executeSlot: _e, getFlowSlot: _g, toggleFlowSlot: _t, flowSlotKey: _k, ...bare } = engineWith([CRM, HR]);
        expect(flowServiceForCaller(bare, shared, FLOW, CRM)).toBe(bare);
        expect(flowSlotView(bare, CRM, FLOW)).toBeUndefined();
    });
});

/**
 * How {@link actionDispatcher} declares the flow action: embedded in the
 * object's `actions[]` (the default), or as a standalone `action` item bound to
 * the object, stamped with `standalonePackage` (left out: no package).
 */
interface ActionShape {
    readonly standalone?: boolean;
    readonly standalonePackage?: string;
    /** Rows the data plane answers a `get` of, by object: `object → ids`. */
    readonly rows?: Record<string, string[]>;
    /** The request's `params`. */
    readonly params?: Record<string, unknown>;
}

/** The `/actions` door over one object whose flow action targets `FLOW`, the object declared by `actionPackage`. */
function actionDispatcher(engine: object, registry: ReturnType<typeof registryWith>, actionPackage?: string, shape: ActionShape = {}) {
    const flowAction = {
        name: 'convert', label: 'Convert', objectName: 'crm_lead', type: 'flow', target: FLOW,
        ...(shape.standalonePackage ? { _packageId: shape.standalonePackage } : {}),
    };
    const objectDef = { name: 'crm_lead', actions: shape.standalone ? [] : [flowAction], ...(actionPackage ? { _packageId: actionPackage } : {}) };
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        getSchema: (name: string) => (name === objectDef.name ? objectDef : undefined),
        registry: {
            ...registry,
            getObject: (name: string) => (name === objectDef.name ? objectDef : undefined),
            getItem: (type: string, name: string) => (shape.standalone && type === 'action' && name === flowAction.name ? flowAction : undefined),
        },
        find: vi.fn(async (object: string, opts?: { where?: { id?: unknown } }) =>
            (shape.rows?.[object] ?? []).filter((id) => id === opts?.where?.id).map((id) => ({ id }))),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : n === 'automation' ? engine
        : null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);
    const ctx: any = { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } };
    const body = shape.params ? { params: shape.params } : {};
    const call = async () => (await dispatcher.handleActions('/crm_lead/convert', 'POST', body, ctx) as any).response;
    return Object.assign(call, { ql });
}

describe('a flow action runs the flow its own package names (ADR-0150 D3)', () => {
    const shared = registryWith({ [`flow:${FLOW}`]: [CRM, HR] });

    it('P\'s flow action still runs P\'s flow, with a second namespace\'s same-name flow installed (CONTROL: an embedded action inherits its object\'s package)', async () => {
        const engine = engineWith([CRM, HR]);
        const response = await actionDispatcher(engine, shared, CRM)();
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(engine.executeSlot.mock.calls.map((c) => [c[0], c[1]])).toEqual([[CRM, FLOW]]);
        expect(engine.execute).not.toHaveBeenCalled();
    });

    it('a standalone action with no package, bound to P\'s object, never inherits the object\'s package: 409 naming both, nothing runs', async () => {
        const engine = engineWith([CRM, HR]);
        const response = await actionDispatcher(engine, shared, CRM, { standalone: true })();
        expect([response.status, response.body?.error?.code], JSON.stringify(response.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(response.body?.error?.message).toContain(CRM);
        expect(response.body?.error?.message).toContain(HR);
        expect(engine.execute).not.toHaveBeenCalled();
        expect(engine.executeSlot).not.toHaveBeenCalled();
    });

    it('a standalone action its own package stamps runs that package\'s flow, whatever its object\'s package', async () => {
        const engine = engineWith([CRM, HR]);
        const response = await actionDispatcher(engine, shared, CRM, { standalone: true, standalonePackage: HR })();
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(engine.executeSlot.mock.calls.map((c) => [c[0], c[1]])).toEqual([[HR, FLOW]]);
        expect(engine.execute).not.toHaveBeenCalled();
    });

    it('CONTROL — an action with no package gets the 409 naming both holders, and nothing runs', async () => {
        const engine = engineWith([CRM, HR]);
        const response = await actionDispatcher(engine, shared)();
        expect([response.status, response.body?.error?.code], JSON.stringify(response.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(response.body?.error?.message).toContain(CRM);
        expect(response.body?.error?.message).toContain(HR);
        expect(engine.execute).not.toHaveBeenCalled();
        expect(engine.executeSlot).not.toHaveBeenCalled();
    });

    it('an action of a package that reaches neither holder is refused 409 naming both, and nothing runs', async () => {
        const engine = engineWith([CRM, HR]);
        const response = await actionDispatcher(engine, shared, OPS)();
        expect([response.status, response.body?.error?.code], JSON.stringify(response.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(response.body?.error?.message).toContain(CRM);
        expect(response.body?.error?.message).toContain(HR);
        expect(engine.execute).not.toHaveBeenCalled();
        expect(engine.executeSlot).not.toHaveBeenCalled();
    });

    it('CONTROL — one holder: the action runs the bare name, as before', async () => {
        const engine = engineWith([CRM]);
        const response = await actionDispatcher(engine, registryWith({ [`flow:${FLOW}`]: [CRM] }), CRM)();
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(engine.execute.mock.calls.map((c: any[]) => c[0])).toEqual([FLOW]);
        expect(engine.executeSlot).not.toHaveBeenCalled();
    });
});

/** One flow endpoint `crm_convert` whose `target` is `FLOW`, executed directly. */
function endpointCall(engine: ReturnType<typeof engineWith>, registry: ReturnType<typeof registryWith>) {
    const endpoint = ApiEndpointSchema.parse({ name: 'crm_convert', path: '/api/v1/apps/crm/convert', method: 'POST', type: 'flow', target: FLOW });
    const ctx: EndpointExecutionContext = {
        endpoint, params: {}, method: 'POST', path: endpoint.path, query: {}, headers: {}, body: {},
        executionContext: { userId: 'u1' } as never,
        protocolContext: { request: {} } as never,
    };
    return executeEndpointTarget(ctx, { callData: vi.fn(async () => null) as never, automationService: engine, registry });
}

describe('a flow endpoint runs the flow its own package names (ADR-0150 D3)', () => {
    it('P\'s flow endpoint still runs P\'s flow, with a second namespace\'s same-name flow installed', async () => {
        const engine = engineWith([CRM, HR]);
        const answer = await endpointCall(engine, registryWith({ [`flow:${FLOW}`]: [CRM, HR], 'api:crm_convert': [CRM] }));
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(engine.executeSlot.mock.calls.map((c) => [c[0], c[1]])).toEqual([[CRM, FLOW]]);
        expect(engine.execute).not.toHaveBeenCalled();
    });

    it('CONTROL — an endpoint no package holds gets the 409 naming both holders, and nothing runs', async () => {
        const engine = engineWith([CRM, HR]);
        const answer = await endpointCall(engine, registryWith({ [`flow:${FLOW}`]: [CRM, HR] }));
        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(JSON.stringify(answer.body)).toContain(CRM);
        expect(JSON.stringify(answer.body)).toContain(HR);
        expect(engine.execute).not.toHaveBeenCalled();
        expect(engine.executeSlot).not.toHaveBeenCalled();
    });

    it('CONTROL — one holder: the endpoint runs the bare name, as before', async () => {
        const engine = engineWith([CRM]);
        const answer = await endpointCall(engine, registryWith({ [`flow:${FLOW}`]: [CRM], 'api:crm_convert': [CRM] }));
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(engine.execute.mock.calls.map((c: any[]) => c[0])).toEqual([FLOW]);
    });
});

/**
 * [ADR-0150 D3/D4, #31696] A start's record-read admission walks the flows the
 * run reaches (`flowDeclaredRecordReads`): a `subflow` / `map` callee is read
 * the way the engine's run reads it (`resolveFlowKey`), from the CALLING
 * flow's package, never bare. P's flow `FLOW` hands its input to the subflow
 * `SUB`, a name CRM and HR both hold: the start reads P's own subflow, and the
 * record the input names is judged against the object THAT subflow reads.
 */
const SUB = 'enrich_account';
const cel = (source: string) => ({ dialect: 'cel', source });
const parentFlow = {
    name: FLOW, label: 'Convert', type: 'autolaunched', status: 'active',
    variables: [{ name: 'account_id', type: 'text', isInput: true }],
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'sub', type: 'subflow', label: 'Enrich', config: { flowName: SUB, input: { accountId: cel('account_id') } } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [],
};
/** `SUB` as `pkg` ships it: it reads one row of `object` by the id it is handed. */
const subflowReading = (object: string) => ({
    name: SUB, label: 'Enrich', type: 'autolaunched', status: 'active',
    variables: [{ name: 'accountId', type: 'text', isInput: true }],
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'read', type: 'get_record', label: 'Read', config: { objectName: object, filter: { id: cel('accountId') }, outputVariable: 'row' } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [],
});
const SUB_READS: Record<string, string> = { [CRM]: 'crm_account', [HR]: 'hr_employee' };

/** An engine holding `FLOW` for `parentHolders` and `SUB` for CRM and HR, one slot each; the bare entries refuse a shared name. */
function walkEngine(parentHolders: string[]) {
    const holdersOf: Record<string, string[]> = { [FLOW]: parentHolders, [SUB]: [CRM, HR] };
    const refusal = (name: string) => Object.assign(new Error(`Flow '${name}' is held by ${holdersOf[name].join(' and ')}`), { code: 'RESOURCE_CONFLICT', status: 409 });
    const keyOf = (pkg: string | null, name: string) => {
        const holders = holdersOf[name] ?? [];
        if (pkg === null || !holders.includes(pkg)) return undefined;
        return holders.length > 1 ? `${pkg}/${name}` : name;
    };
    const definition = (pkg: string, name: string) => (name === FLOW ? parentFlow : subflowReading(SUB_READS[pkg]));
    return {
        handlerReady: true,
        getFlow: vi.fn(async (name: string) => {
            const holders = holdersOf[name];
            if (!holders) return null;
            if (holders.length > 1) throw refusal(name);
            return definition(holders[0], name);
        }),
        execute: vi.fn(async (_name: string, _context?: unknown) => ({ success: true, output: { ran: 'bare' } })),
        flowSlotKey: vi.fn((pkg: string | null, name: string) => keyOf(pkg, name)),
        getFlowSlot: vi.fn((pkg: string | null, name: string) => (keyOf(pkg, name) && pkg ? definition(pkg, name) : null)),
        executeSlot: vi.fn(async (pkg: string | null, _name: string, _context?: unknown) => ({ success: true, output: { ran: pkg } })),
        toggleFlowSlot: vi.fn(async () => {}),
    };
}
const walkRegistry = (parentHolders: string[]) => registryWith({ [`flow:${FLOW}`]: parentHolders, [`flow:${SUB}`]: [CRM, HR], 'api:crm_convert': [CRM] });
/** Each row id the data plane holds, by object: both subflows' objects hold `acc_1`. */
const ROWS = { crm_account: ['acc_1'], hr_employee: ['acc_1'] };
/** The subflows' objects the start read, in order (the actor's own `sys_user` read is not the walk's). */
const readObjects = (find: { mock: { calls: unknown[][] } }) =>
    find.mock.calls.map((c) => c[0]).filter((object) => object === 'crm_account' || object === 'hr_employee');
const subReads = (engine: ReturnType<typeof walkEngine>) =>
    engine.getFlowSlot.mock.calls.filter((c) => c[1] === SUB).map((c) => c[0]);

describe('a start\'s record-read walk reads each callee from the calling flow\'s package (ADR-0150 D3/D4)', () => {
    it('the action door: P\'s flow action starts, its input judged against the object P\'s own subflow reads', async () => {
        const engine = walkEngine([CRM]);
        const call = actionDispatcher(engine, walkRegistry([CRM]), CRM, { rows: ROWS, params: { account_id: 'acc_1' } });
        const response = await call();
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(readObjects(call.ql.find)).toEqual(['crm_account']);
        expect(subReads(engine)).toEqual([CRM]);
        expect(engine.getFlow.mock.calls.map((c) => c[0])).not.toContain(SUB);
        expect(engine.execute.mock.calls.map((c) => c[0])).toEqual([FLOW]);
    });

    it('the action door: a row P\'s subflow cannot read is refused 404 before the run, though HR\'s object holds it', async () => {
        const engine = walkEngine([CRM]);
        const call = actionDispatcher(engine, walkRegistry([CRM]), CRM, { rows: { hr_employee: ['acc_1'] }, params: { account_id: 'acc_1' } });
        const response = await call();
        expect([response.status, response.body?.error?.code], JSON.stringify(response.body)).toEqual([404, 'RECORD_NOT_FOUND']);
        expect(readObjects(call.ql.find)).toEqual(['crm_account']);
        expect(engine.execute).not.toHaveBeenCalled();
    });

    it('the endpoint door: P\'s flow endpoint starts, reading P\'s own subflow', async () => {
        const engine = walkEngine([CRM]);
        const endpoint = ApiEndpointSchema.parse({ name: 'crm_convert', path: '/api/v1/apps/crm/convert', method: 'POST', type: 'flow', target: FLOW });
        const callData = vi.fn(async (_op: string, params: { object: string; id: string }) =>
            ((ROWS as Record<string, string[]>)[params.object]?.includes(params.id) ? { object: params.object, id: params.id, record: { id: params.id } } : null));
        const ctx: EndpointExecutionContext = {
            endpoint, params: {}, method: 'POST', path: endpoint.path, query: {}, headers: {}, body: { account_id: 'acc_1' },
            executionContext: { userId: 'u1' } as never,
            protocolContext: { request: {} } as never,
        };
        const answer = await executeEndpointTarget(ctx, { callData: callData as never, automationService: engine, registry: walkRegistry([CRM]) });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(callData.mock.calls.map((c) => c[1].object)).toEqual(['crm_account']);
        expect(subReads(engine)).toEqual([CRM]);
        expect(engine.getFlow.mock.calls.map((c) => c[0])).not.toContain(SUB);
    });

    it('the trigger door: HR\'s address of a flow both hold starts HR\'s flow, reading HR\'s own subflow', async () => {
        const engine = walkEngine([CRM, HR]);
        const find = vi.fn(async (object: string, opts?: { where?: { id?: unknown } }) =>
            ((ROWS as Record<string, string[]>)[object] ?? []).filter((id) => id === opts?.where?.id).map((id) => ({ id })));
        const ql = { registry: walkRegistry([CRM, HR]), find };
        const resolve = (n: string) => (n === 'automation' ? engine : n === 'objectql' || n === 'data' ? ql : undefined);
        const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
        const dispatcher = new HttpDispatcher(kernel);
        const ec = { userId: 'u1', systemPermissions: [] };
        const answered: any = await dispatcher.handleAutomation(`/hr/${FLOW}/trigger`, 'POST', { account_id: 'acc_1' }, { request: {}, executionContext: ec } as any, {});
        expect(answered.response?.status ?? 200, JSON.stringify(answered.response?.body)).toBe(200);
        expect(readObjects(find)).toEqual(['hr_employee']);
        expect(subReads(engine)).toEqual([HR]);
        expect(engine.executeSlot.mock.calls.map((c) => [c[0], c[1]])).toEqual([[HR, FLOW]]);
        expect(engine.getFlow.mock.calls.map((c) => c[0])).not.toContain(SUB);
    });

    it('CONTROL — a caller package that reaches neither callee holder is refused 409 naming both, nothing runs', async () => {
        const engine = walkEngine([OPS]);
        const call = actionDispatcher(engine, registryWith({ [`flow:${FLOW}`]: [OPS], [`flow:${SUB}`]: [CRM, HR] }), OPS, { rows: ROWS, params: { account_id: 'acc_1' } });
        const response = await call();
        expect([response.status, response.body?.error?.code], JSON.stringify(response.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(JSON.stringify(response.body)).toContain(CRM);
        expect(JSON.stringify(response.body)).toContain(HR);
        expect(readObjects(call.ql.find)).toEqual([]);
        expect(engine.execute).not.toHaveBeenCalled();
    });
});

/**
 * [ADR-0150 D3, #33386; seat ruling 6884403301] The flow doors #31696 opened
 * judge the SERVED holders of a name two packages hold: a disabled package
 * holds no name. Its slot stays armed and keyed in the engine (amendment 7),
 * so a disable never re-points a slot; it only moves which slot a door
 * reaches. Replaces the R4-G parity pin (`main` held these doors over every
 * holder, a disabled package's included).
 *
 * Over a real `SchemaRegistry` (its `disablePackage`, its served filter) and
 * an engine double holding one slot per holder whose BARE entries judge the
 * served holders, as the engine's do after this change (service-automation
 * `engine.ts` `resolveFlowKey`, pinned there): one served holder runs that
 * slot, two refuse naming them, none is no flow. Every row of the PR's
 * Clause-② table for these doors is asserted per registration order.
 */

/** Depends on both holders. */
const BOTH = 'com.both.pkg';
/** Depends on neither. */
const NONE = 'com.none.pkg';
const API = 'lead_api';
const HOLDERS = [CRM, HR];
const CALLERS = [undefined, CRM, HR, OPS, BOTH, NONE];
const NAMESPACES = ['crm', 'hr', 'ops', 'none'];

function registryOf(order: readonly string[], disabled: readonly string[]): SchemaRegistry {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    const install = (id: string, namespace: string, deps: string[] = []) => registry.installPackage({
        id, name: id, version: '1.0.0', type: 'app', namespace,
        ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
    } as never, 'code');
    install(CRM, 'crm');
    install(HR, 'hr');
    install(OPS, 'ops', [CRM]);
    install(BOTH, 'both', [CRM, HR]);
    install(NONE, 'none');
    for (const holder of order) {
        registry.registerItem('flow', { name: FLOW, _packageId: holder }, 'name' as never, holder);
        registry.registerItem('api', { name: API, _packageId: holder }, 'name' as never, holder);
    }
    for (const id of disabled) registry.disablePackage(id);
    return registry;
}

/** One slot per holder; the bare entries judge the served holders, as the engine's do. */
function engineWithBothSlots(registry: SchemaRegistry) {
    const served = () => registry.packageScopedHoldersOf('flow', FLOW, null);
    const refusal = (holders: string[]) => Object.assign(new Error(`Flow '${FLOW}' is held by ${holders.join(' and ')}`), {
        code: 'RESOURCE_CONFLICT', status: 409, refusal: { candidates: holders.map((packageId) => ({ kind: 'package', packageId })) },
    });
    const bareSlot = (name: string): string | null => {
        if (name !== FLOW) return null;
        const holders = served();
        if (holders.length > 1) throw refusal(holders);
        return holders[0] ?? null;
    };
    return {
        handlerReady: true,
        getFlow: vi.fn(async (name: string) => { const pkg = bareSlot(name); return pkg ? { name, label: `${pkg} flow` } : null; }),
        execute: vi.fn(async (name: string) => {
            const pkg = bareSlot(name);
            return pkg ? { success: true, output: { ran: pkg } } : { success: false, error: `Flow '${name}' not found` };
        }),
        flowSlotKey: vi.fn((pkg: string | null, name: string) => (name === FLOW && pkg !== null && HOLDERS.includes(pkg) ? `${pkg}/${FLOW}` : undefined)),
        getFlowSlot: vi.fn((pkg: string | null, name: string) => (name === FLOW && pkg !== null && HOLDERS.includes(pkg) ? { name, label: `${pkg} flow` } : null)),
        executeSlot: vi.fn(async (pkg: string | null) => ({ success: true, output: { ran: pkg } })),
        toggleFlowSlot: vi.fn(async () => {}),
    };
}

/** What a thrown refusal names, or its message. */
const refusalOf = (err: any) => ['refused', err?.refusal?.candidates?.map((c: any) => c.packageId ?? c.kind) ?? String(err?.message)];

/** A run's answer: the slot it ran, or no flow. */
const ranOf = (result: any) => (result?.success ? ['ran', result.output.ran] : ['no flow']);

/** Every door's answer, per caller and per namespace. */
async function answersOf(registry: SchemaRegistry) {
    const out: Record<string, unknown> = {};
    for (const caller of CALLERS) {
        const engine = engineWithBothSlots(registry);
        try {
            const service = flowServiceForCaller(engine, registry, FLOW, caller);
            out[`action ${caller}`] = ranOf(await service.execute(FLOW));
        } catch (err) {
            out[`action ${caller}`] = refusalOf(err);
        }
        out[`holder ${caller}`] = flowHolderForCaller(registry, FLOW, caller);
        const walk = flowWalkReads(engineWithBothSlots(registry), async () => registry);
        try {
            const callee = await walk.callee(FLOW, caller ?? null);
            out[`callee ${caller}`] = callee.flow === null ? ['no flow'] : ['read', callee.packageId, (callee.flow as { label?: string } | null)?.label];
        } catch (err) {
            out[`callee ${caller}`] = refusalOf(err);
        }
    }
    out.root = await flowWalkReads(engineWithBothSlots(registry), async () => registry).rootPackage(FLOW);
    out.endpoint = endpointPackageOf(registry, API);
    out.durable = bareNameRefusal(registry, 'flow', FLOW)?.candidates.map((c: any) => c.packageId ?? c.kind);
    const addressOf = (admitted: ReturnType<typeof admitAutomationAddress>) => {
        if (admitted === undefined) return 'bare path';
        if ('packageId' in admitted) return ['slot', admitted.packageId];
        return [admitted.status, 'refusal' in admitted ? admitted.refusal.candidates.map((c: any) => c.packageId ?? c.kind) : undefined];
    };
    out.bare = addressOf(bareNameAdmission(registry, 'flow', FLOW));
    for (const namespace of NAMESPACES) {
        out[`address ${namespace}`] = addressOf(admitAutomationAddress(registry, { kind: 'namespace', namespace }, { type: 'flow', name: FLOW }));
    }
    out['address _env'] = addressOf(admitAutomationAddress(registry, { kind: 'environment' }, { type: 'flow', name: FLOW }));
    return out;
}

const ORDERS = [HOLDERS, [...HOLDERS].reverse()];

/** The answers with `off` disabled and `on` the one served holder. */
function oneServed(off: string, on: string, order: readonly string[]) {
    return {
        // the bare caller and the caller whose closure holds both: the served holder's slot (amendments 1, 5)
        'action undefined': ['ran', on],
        [`action ${BOTH}`]: ['ran', on],
        // caller-first (amendment 4): the disabled holder's own action gets no flow, never the closure holder's
        [`action ${off}`]: ['no flow'],
        [`action ${on}`]: ['ran', on],
        // reached only through the disabled holder, or reaching neither: refused naming the served holder only (amendment 6)
        [`action ${OPS}`]: off === CRM ? ['refused', [on]] : ['ran', CRM],
        [`action ${NONE}`]: ['refused', [on]],
        'holder undefined': on,
        [`holder ${BOTH}`]: on,
        [`holder ${off}`]: undefined,
        [`holder ${on}`]: on,
        [`holder ${OPS}`]: off === CRM ? undefined : CRM,
        [`holder ${NONE}`]: undefined,
        // the walk reads the slot the run executes (amendment 8)
        'callee undefined': ['read', on, `${on} flow`],
        [`callee ${BOTH}`]: ['read', on, `${on} flow`],
        [`callee ${off}`]: ['no flow'],
        [`callee ${on}`]: ['read', on, `${on} flow`],
        [`callee ${OPS}`]: off === CRM ? ['refused', [on]] : ['read', CRM, `${CRM} flow`],
        [`callee ${NONE}`]: ['refused', [on]],
        root: on,
        // durable coordinates stay judged over every holder (amendment 7)
        endpoint: undefined,
        durable: [...order],
        bare: ['slot', on],
        // an address naming the disabled holder is never another package's flow (amendment 2)
        [`address ${off === CRM ? 'crm' : 'hr'}`]: [409, [on]],
        [`address ${on === CRM ? 'crm' : 'hr'}`]: ['slot', on],
        'address ops': [409, [on]],
        'address none': [409, [on]],
        'address _env': [409, [on]],
    };
}

describe('the #31696 flow doors judge the served holders (ADR-0150 D3, #33386)', () => {
    describe.each(ORDERS.map((order) => [order.join(' then '), order] as const))('registered %s', (_o, order) => {
        it('CONTROL — nothing disabled: what `main` answers', async () => {
            const answers = await answersOf(registryOf(order, []));
            expect(answers[`action ${HR}`]).toEqual(['ran', HR]);
            expect(answers[`action ${OPS}`]).toEqual(['ran', CRM]);
            expect(answers[`action ${BOTH}`]).toEqual(['refused', [...order]]);
            expect(answers['action undefined']).toEqual(['refused', [...order]]);
            expect(answers[`action ${NONE}`]).toEqual(['refused', [...order]]);
            expect(answers[`callee ${HR}`]).toEqual(['read', HR, `${HR} flow`]);
            expect(answers['callee undefined']).toEqual(['refused', [...order]]);
            expect(answers[`holder ${BOTH}`]).toBeUndefined();
            expect(answers.root).toBeNull();
            expect(answers.durable).toEqual([...order]);
            expect(answers.bare).toEqual([409, [...order]]);
            expect(answers.endpoint).toBeUndefined();
            expect(answers['address crm']).toEqual(['slot', CRM]);
            expect(answers['address hr']).toEqual(['slot', HR]);
            expect(answers['address ops']).toEqual([409, [...order]]);
            expect(answers['address _env']).toEqual([409, [...order]]);
        });

        it.each([[CRM, HR], [HR, CRM]])('%s disabled: every door answers the one served holder\'s slot, or no flow, or a refusal naming it', async (off, on) => {
            expect(await answersOf(registryOf(order, [off]))).toEqual(oneServed(off, on, order));
        });

        it('both disabled: no door reaches a flow; the durable coordinates still name both', async () => {
            const answers = await answersOf(registryOf(order, [CRM, HR]));
            for (const caller of CALLERS) {
                expect(answers[`action ${caller}`], `action ${caller}`).toEqual(['no flow']);
                expect(answers[`holder ${caller}`], `holder ${caller}`).toBeUndefined();
                expect(answers[`callee ${caller}`], `callee ${caller}`).toEqual(['no flow']);
            }
            expect(answers.root).toBeNull();
            expect(answers.durable).toEqual([...order]);
            expect(answers.bare).toBe('bare path');
            for (const namespace of NAMESPACES) expect(answers[`address ${namespace}`], namespace).toEqual([404, undefined]);
            expect(answers['address _env']).toBe('bare path');
        });

        it('CONTROL — one holder, disabled: judged as `main` judges it (not a name two packages hold)', async () => {
            const registry = registryOf([CRM], [CRM]);
            const engine = engineWithBothSlots(registry);
            expect(flowServiceForCaller(engine, registry, FLOW, CRM)).toBe(engine);
            expect(bareNameAdmission(registry, 'flow', FLOW)).toBeUndefined();
            expect(addressOrNone(admitAutomationAddress(registry, { kind: 'namespace', namespace: 'crm' }, { type: 'flow', name: FLOW }))).toBe(404);
        });

        it('CONTROL — no holder: no admission, no flow', async () => {
            const registry = new SchemaRegistry();
            registry.logLevel = 'silent';
            expect(bareNameAdmission(registry, 'flow', FLOW)).toBeUndefined();
            expect(flowHolderForCaller(registry, FLOW, undefined)).toBeUndefined();
        });
    });
});

const addressOrNone = (admitted: ReturnType<typeof admitAutomationAddress>) => (admitted && 'status' in admitted ? admitted.status : admitted);
