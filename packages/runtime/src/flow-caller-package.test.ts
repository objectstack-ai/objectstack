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
import { flowServiceForCaller, flowSlotView } from './flow-slot-view.js';
import type { PackageScopedRegistry } from '@objectstack/objectql';

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

/** The `/actions` door over one object whose flow action targets `FLOW`, the action declared by `actionPackage`. */
function actionDispatcher(engine: ReturnType<typeof engineWith>, registry: ReturnType<typeof registryWith>, actionPackage?: string) {
    const flowAction = { name: 'convert', label: 'Convert', objectName: 'crm_lead', type: 'flow', target: FLOW };
    const objectDef = { name: 'crm_lead', actions: [flowAction], ...(actionPackage ? { _packageId: actionPackage } : {}) };
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        getSchema: (name: string) => (name === objectDef.name ? objectDef : undefined),
        registry: {
            ...registry,
            getObject: (name: string) => (name === objectDef.name ? objectDef : undefined),
            getItem: () => undefined,
        },
        find: vi.fn(async () => []),
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
    return async () => (await dispatcher.handleActions('/crm_lead/convert', 'POST', {}, ctx) as any).response;
}

describe('a flow action runs the flow its own package names (ADR-0150 D3)', () => {
    const shared = registryWith({ [`flow:${FLOW}`]: [CRM, HR] });

    it('P\'s flow action still runs P\'s flow, with a second namespace\'s same-name flow installed', async () => {
        const engine = engineWith([CRM, HR]);
        const response = await actionDispatcher(engine, shared, CRM)();
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(engine.executeSlot.mock.calls.map((c) => [c[0], c[1]])).toEqual([[CRM, FLOW]]);
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
