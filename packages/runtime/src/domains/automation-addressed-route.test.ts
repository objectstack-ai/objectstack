// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, epic child G1] The `/automation` by-name doors read D5's
 * address: `/automation/:ns/:name[/trigger | /toggle | /clone | /runs …]`,
 * `/automation/trigger/:ns/:name`, `/automation/connectors/:ns/:name/connection`
 * and the same under `_env` (`./automation-address.ts`).
 *
 * An address naming the holder the bare name resolves to is served as its
 * bare path; what is pinned here is WHICH addresses are admitted, what the
 * refused ones answer, that every gate still judges the bare shape ahead of
 * the address, and that a bare name the resolver refuses answers `409` naming
 * every candidate. [ADR-0150 D4/D9, #31696] A flow name two packages hold is
 * held by the engine in one slot per holder: each holder's address is served
 * from its own slot, and the definition writes keep their `409`.
 *
 * Driven through the real `HttpDispatcher`, with an automation slot double and
 * an ObjectQL registry double answering the holder table the resolver reads.
 */
import { describe, it, expect, vi } from 'vitest';
import '@objectstack/metadata';

import { HttpDispatcher } from '../http-dispatcher.js';
import { SchemaRegistry } from '@objectstack/objectql';

const CRM = 'com.crm.pkg';
const HR = 'com.hr.pkg';
const ADMIN = { userId: 'u1', systemPermissions: ['manage_metadata', 'manage_connector_connections'] };

interface Holdings {
    /** `type:name` → the packages holding it. */
    readonly packages?: Record<string, string[]>;
    /** `type:name` the environment holds as its own item. */
    readonly environment?: string[];
    /** package id → its manifest namespace. */
    readonly namespaces?: Record<string, string>;
}

function registryWith(h: Holdings) {
    const packages = h.packages ?? {};
    const environment = new Set(h.environment ?? []);
    const namespaces = h.namespaces ?? { [CRM]: 'crm', [HR]: 'hr' };
    const holdersOf = (type: string, name: string) => packages[`${type}:${name}`] ?? [];
    return {
        getNamespaceOwners: (ns: string) => Object.keys(namespaces).filter((id) => namespaces[id] === ns),
        packageScopedHoldersOf: (type: string, name: string) => holdersOf(type, name),
        getPackageScopedItem: (type: string, name: string, packageId: string) =>
            (holdersOf(type, name).includes(packageId) ? { name, _packageId: packageId } : undefined),
        // The registry's rule: the environment's own item exists only for a name no package holds.
        getEnvironmentScopedItem: (type: string, name: string) =>
            (environment.has(`${type}:${name}`) && holdersOf(type, name).length === 0 ? { name } : undefined),
        getPackage: (id: string) => (namespaces[id] ? { manifest: { id, namespace: namespaces[id] } } : undefined),
    };
}

function dispatcherWith(h: Holdings, flowNames: string[] = ['send_digest', 'ping', 'crm']) {
    const flows = new Map(flowNames.map((n) => [n, { name: n }]));
    const automation = {
        handlerReady: true,
        getFlow: vi.fn(async (name: string) => flows.get(name) ?? null),
        execute: vi.fn(async () => ({ success: true, output: {} })),
        toggleFlow: vi.fn(async () => {}),
        listRunsPage: vi.fn(async () => ({ runs: [] as unknown[], hasMore: false })),
        getConnectorConnection: vi.fn(async (request: { connector: string }) => ({ connector: request.connector, status: 'not_connected' })),
        getActionDescriptors: vi.fn(() => []),
        getFlowRuntimeStates: vi.fn(() => []),
        getRun: vi.fn(async (runId: string) => ({ id: runId, flowName: 'trigger' })),
    };
    const ql = { registry: registryWith(h) };
    // `auth` signs in the caller `dispatch()` resolves for itself (the catch-all
    // seam below); `handleAutomation` is handed its execution context directly.
    const auth = { api: { getSession: async () => ({ user: { id: 'u1' } }) } };
    const services: Record<string, unknown> = { automation, objectql: ql, auth };
    const resolve = (name: string) => services[name];
    const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);
    const call = async (path: string, method: string, ec: Record<string, unknown> = ADMIN, body: unknown = {}) => {
        const answered = await dispatcher.handleAutomation(path, method, body, { request: {}, executionContext: ec } as any, {});
        return {
            handled: answered.handled,
            status: answered.response?.status ?? 200,
            headers: answered.response?.headers as Record<string, string> | undefined,
            body: answered.response?.body as any,
        };
    };
    // What a catch-all host (`createHonoApp`) does with any `/api/v1/*` path:
    // hand it to `dispatch()` and answer what comes back.
    const dispatch = async (path: string, method: string) => {
        const answered = await dispatcher.dispatch(method, path, {}, {}, { request: new Request(`http://host/api/v1${path}`, { method }) } as any, '/api/v1');
        return { handled: answered.handled, status: answered.response?.status, body: answered.response?.body as any };
    };
    return { call, dispatch, automation };
}

const ONE_HOLDER: Holdings = { packages: { 'flow:send_digest': [CRM] }, environment: ['flow:ping', 'flow:crm'] };
const TWO_HOLDERS: Holdings = { packages: { 'flow:send_digest': [CRM, HR] } };
const codeOf = (a: { body?: any }) => a.body?.error?.code;
const candidatesOf = (a: { body?: any }) => a.body?.error?.details?.candidates ?? a.body?.details?.candidates;

describe('/automation/:ns/:name — an installed namespace names its flow', () => {
    it('the namespace\'s one holder is served exactly as its bare path: read, run, legacy trigger, runs', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        expect((await call('/crm/send_digest', 'GET')).status).toBe(200);
        expect((await call('/crm/send_digest/trigger', 'POST')).status).toBe(200);
        expect((await call('/trigger/crm/send_digest', 'POST')).status).toBe(200);
        expect((await call('/crm/send_digest/runs', 'GET')).status).toBe(200);
        expect(automation.getFlow).toHaveBeenCalledWith('send_digest');
        expect(automation.execute.mock.calls.map((c: any[]) => c[0])).toEqual(['send_digest', 'send_digest']);
        expect(automation.listRunsPage.mock.calls.map((c: any[]) => c[0])).toEqual(['send_digest']);
    });

    it('a namespace that holds no such flow, while another package does: 409 naming the holder, nothing run', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        const answer = await call('/hr/send_digest/trigger', 'POST');
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(candidatesOf(answer)).toEqual([{ kind: 'package', packageId: CRM }]);
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('a name nothing holds: 404 naming the namespace', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        const answer = await call('/crm/ghost', 'GET');
        expect(answer.status).toBe(404);
        expect(String(answer.body?.error?.message)).toContain("namespace 'crm'");
        expect(automation.getFlow).not.toHaveBeenCalled();
    });

    it('a namespace two packages co-own, both holding the name: 409 naming both, nothing run', async () => {
        const { call, automation } = dispatcherWith({ ...TWO_HOLDERS, namespaces: { [CRM]: 'crm', [HR]: 'crm' } });
        const answer = await call('/crm/send_digest/trigger', 'POST');
        expect([answer.status, codeOf(answer)]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(candidatesOf(answer)).toEqual([{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]);
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('a bare name two packages hold, on an engine with no slot entries: its address is refused naming both, nothing run (fail closed)', async () => {
        const { call, automation } = dispatcherWith(TWO_HOLDERS);
        const answer = await call('/crm/send_digest/trigger', 'POST');
        expect([answer.status, codeOf(answer)]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(candidatesOf(answer)).toEqual([{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]);
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('CONTROL — a first segment that is no installed namespace reads as the bare path, as before', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        expect((await call('/send_digest/trigger', 'POST')).status).toBe(200);
        expect((await call('/sales/send_digest', 'GET')).handled).toBe(false);
        expect(automation.execute.mock.calls.map((c: any[]) => c[0])).toEqual(['send_digest']);
    });
});

/**
 * [ADR-0150 D4] The engine's slot entries for `send_digest`, which `CRM` and
 * `HR` both hold: one slot each, filed under `PACKAGE/NAME`. The bare entries
 * refuse the shared name, as the engine's do.
 */
function withSlots(automation: Record<string, any>, name = 'send_digest', holders: string[] = [CRM, HR]) {
    const keyOf = (pkg: string | null) => (pkg !== null && holders.includes(pkg) ? `${pkg}/${name}` : undefined);
    const shared = (n: string) => Object.assign(new Error(`Flow '${n}' is held by several packages`), { code: 'RESOURCE_CONFLICT', status: 409 });
    const bareGetFlow = automation.getFlow;
    automation.getFlow = vi.fn(async (n: string) => { if (n === name) throw shared(n); return bareGetFlow(n); });
    automation.execute = vi.fn(async (n: string) => (n === name ? { success: false, error: shared(n).message } : { success: true, output: {} }));
    automation.toggleFlow = vi.fn(async (n: string) => { if (n === name) throw shared(n); });
    automation.flowSlotKey = vi.fn((pkg: string | null, n: string) => (n === name ? keyOf(pkg) : undefined));
    automation.getFlowSlot = vi.fn((pkg: string | null, n: string) => (n === name && keyOf(pkg) ? { name, label: `${pkg} flow` } : null));
    automation.executeSlot = vi.fn(async () => ({ success: true, output: {} }));
    automation.toggleFlowSlot = vi.fn(async () => {});
    automation.getRun = vi.fn(async (runId: string) => ({ id: runId, flowName: runId === 'r-crm' ? `${CRM}/${name}` : `${HR}/${name}` }));
    return automation;
}

describe('[ADR-0150 D4/D9, #31696] a flow name two namespaces\' packages hold: each address is served from its holder\'s own slot', () => {
    const slotted = () => {
        const d = dispatcherWith(TWO_HOLDERS);
        return { ...d, automation: withSlots(d.automation) };
    };

    it('read, run, legacy trigger, toggle and runs of `crm`\'s address reach CRM\'s flow; `hr`\'s reach HR\'s; the bare name is never read', async () => {
        const { call, automation } = slotted();
        const read = await call('/crm/send_digest', 'GET');
        expect([read.status, read.body?.data?.label], JSON.stringify(read.body)).toEqual([200, `${CRM} flow`]);
        expect((await call('/hr/send_digest', 'GET')).body?.data?.label).toBe(`${HR} flow`);
        expect((await call('/crm/send_digest/trigger', 'POST')).status).toBe(200);
        expect((await call('/trigger/hr/send_digest', 'POST')).status).toBe(200);
        expect((await call('/hr/send_digest/toggle', 'POST', ADMIN, { enabled: false })).status).toBe(200);
        expect((await call('/crm/send_digest/runs', 'GET')).status).toBe(200);
        expect(automation.executeSlot.mock.calls.map((c: any[]) => [c[0], c[1]])).toEqual([[CRM, 'send_digest'], [HR, 'send_digest']]);
        expect(automation.toggleFlowSlot.mock.calls.map((c: any[]) => [c[0], c[1], c[2]])).toEqual([[HR, 'send_digest', false]]);
        expect(automation.listRunsPage.mock.calls.map((c: any[]) => c[0])).toEqual([`${CRM}/send_digest`]);
        expect(automation.getFlow).not.toHaveBeenCalled();
        expect(automation.execute).not.toHaveBeenCalled();
        expect(automation.toggleFlow).not.toHaveBeenCalled();
    });

    it('a run read under `crm`\'s address answers CRM\'s run, named as the flow; HR\'s run is not found there', async () => {
        const { call } = slotted();
        const own = await call('/crm/send_digest/runs/r-crm', 'GET');
        expect(own.status, JSON.stringify(own.body)).toBe(200);
        const other = await call('/crm/send_digest/runs/r-hr', 'GET');
        expect([other.status, codeOf(other)], JSON.stringify(other.body)).toEqual([404, 'RUN_NOT_FOUND']);
    });

    it('the definition writes keep their 409 naming both: an address names a slot to read and run, never one to write', async () => {
        const { call, automation } = slotted();
        for (const [path, method, body] of [
            ['/crm/send_digest', 'PUT', { name: 'send_digest', type: 'autolaunched' }],
            ['/crm/send_digest', 'DELETE', {}],
            ['/crm/send_digest/clone', 'POST', { name: 'send_digest_copy' }],
        ] as const) {
            const answer = await call(path, method, ADMIN, body);
            expect([path, method, answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([path, method, 409, 'RESOURCE_CONFLICT']);
            expect(candidatesOf(answer)).toEqual([{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]);
        }
        expect(automation.executeSlot).not.toHaveBeenCalled();
        expect(automation.getFlowSlot).not.toHaveBeenCalled();
    });

    it('CONTROL — the bare name is still refused 409 naming both, nothing read or run', async () => {
        const { call, automation } = slotted();
        for (const [path, method] of [['/send_digest/trigger', 'POST'], ['/send_digest', 'GET'], ['/send_digest/runs', 'GET']] as const) {
            const answer = await call(path, method);
            expect([path, answer.status, codeOf(answer)]).toEqual([path, 409, 'RESOURCE_CONFLICT']);
            expect(candidatesOf(answer)).toEqual([{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]);
        }
        expect(automation.executeSlot).not.toHaveBeenCalled();
        expect(automation.getFlowSlot).not.toHaveBeenCalled();
    });

    it('CONTROL — a namespace that holds neither is refused naming both, nothing read or run', async () => {
        const d = dispatcherWith({ ...TWO_HOLDERS, namespaces: { [CRM]: 'crm', [HR]: 'hr', 'com.ops.pkg': 'ops' } });
        const automation = withSlots(d.automation);
        const answer = await d.call('/ops/send_digest/trigger', 'POST');
        expect([answer.status, codeOf(answer)]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(candidatesOf(answer)).toEqual([{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]);
        expect(automation.executeSlot).not.toHaveBeenCalled();
    });
});

describe('a bare name the resolver refuses answers 409 naming every candidate', () => {
    for (const [path, method] of [['/send_digest/trigger', 'POST'], ['/trigger/send_digest', 'POST'], ['/send_digest', 'GET'], ['/send_digest/runs', 'GET'], ['/send_digest/toggle', 'POST']] as const) {
        it(`${method} ${path}`, async () => {
            const { call, automation } = dispatcherWith(TWO_HOLDERS);
            const answer = await call(path, method, ADMIN, method === 'POST' && path.endsWith('toggle') ? { enabled: false } : {});
            expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            expect(candidatesOf(answer)).toEqual([{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]);
            expect(automation.execute).not.toHaveBeenCalled();
            expect(automation.toggleFlow).not.toHaveBeenCalled();
            expect(automation.listRunsPage).not.toHaveBeenCalled();
        });
    }

    it('CONTROL — one holder: the bare doors answer as before', async () => {
        const { call } = dispatcherWith(ONE_HOLDER);
        expect((await call('/send_digest/trigger', 'POST')).status).toBe(200);
        expect((await call('/send_digest', 'GET')).status).toBe(200);
    });
});

describe('/automation/_env/:name — the environment named exactly', () => {
    it('the environment\'s own flow is served as its bare path', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        expect((await call('/_env/ping/trigger', 'POST')).status).toBe(200);
        expect(automation.execute.mock.calls.map((c: any[]) => c[0])).toEqual(['ping']);
    });

    it('a name only packages hold: 409 naming them, nothing run', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        const answer = await call('/_env/send_digest/trigger', 'POST');
        expect([answer.status, codeOf(answer)]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(candidatesOf(answer)).toEqual([{ kind: 'package', packageId: CRM }]);
        expect(automation.execute).not.toHaveBeenCalled();
    });
});

describe('a sub-resource literal in the name position keeps its bare route (seat ruling Q1)', () => {
    it('/automation/crm/runs and /crm/trigger are the flow `crm`\'s doors, though `crm` is an installed namespace', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        expect((await call('/crm/runs', 'GET')).status).toBe(200);
        expect((await call('/crm/trigger', 'POST')).status).toBe(200);
        expect(automation.listRunsPage.mock.calls.map((c: any[]) => c[0])).toEqual(['crm']);
        expect(automation.execute.mock.calls.map((c: any[]) => c[0])).toEqual(['crm']);
    });

    it('and `_env` reaches the same flow\'s every door', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        expect((await call('/_env/crm/trigger', 'POST')).status).toBe(200);
        expect((await call('/_env/crm', 'GET')).status).toBe(200);
        expect(automation.execute.mock.calls.map((c: any[]) => c[0])).toEqual(['crm']);
        expect(automation.getFlow).toHaveBeenCalledWith('crm');
    });
});

describe('every gate judges the bare shape, ahead of the address', () => {
    it('an addressed toggle is the authoring write it is bare: refused 403 without the capability, before the address is judged', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        // `hr` holds nothing: judged first, the address would answer 409.
        const answer = await call('/hr/send_digest/toggle', 'POST', { userId: 'u1', systemPermissions: [] }, { enabled: false });
        expect(answer.status, JSON.stringify(answer.body)).toBe(403);
        expect(automation.toggleFlow).not.toHaveBeenCalled();
    });

    it('CONTROL — with the capability the addressed toggle reaches the flow', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        const answer = await call('/crm/send_digest/toggle', 'POST', ADMIN, { enabled: false });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(automation.toggleFlow.mock.calls.map((c: any[]) => [c[0], c[1]])).toEqual([['send_digest', false]]);
    });
});

describe('the door\'s own literals are never an addressed name, and never the bare by-name 409', () => {
    it('`_env` followed by a door literal is no route: declined, nothing read or run', async () => {
        const { call, automation } = dispatcherWith({ ...ONE_HOLDER, environment: ['flow:actions', 'flow:_status', 'flow:connectors', 'flow:trigger', 'flow:hooks'] });
        for (const [path, method] of [
            ['/_env/actions', 'GET'], ['/_env/_status', 'GET'], ['/_env/connectors', 'GET'],
            ['/_env/trigger/send_digest', 'POST'], ['/_env/hooks/send_digest/h1', 'POST'],
        ] as const) {
            expect([path, method, (await call(path, method)).handled]).toEqual([path, method, false]);
        }
        expect(automation.getActionDescriptors).not.toHaveBeenCalled();
        expect(automation.getFlowRuntimeStates).not.toHaveBeenCalled();
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('a namespace followed by a door literal that is no sub-resource is no route either', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        for (const [path, method] of [
            ['/crm/actions', 'GET'], ['/crm/_status', 'GET'], ['/crm/connectors', 'GET'], ['/crm/hooks/send_digest/h1', 'POST'],
        ] as const) {
            expect([path, method, (await call(path, method)).handled]).toEqual([path, method, false]);
        }
        expect(automation.getActionDescriptors).not.toHaveBeenCalled();
        expect(automation.getFlowRuntimeStates).not.toHaveBeenCalled();
    });

    it('a bare literal route stays its own though two packages hold a flow of that name', async () => {
        const { call, automation } = dispatcherWith({ packages: { 'flow:actions': [CRM, HR], 'flow:_status': [CRM, HR] } });
        const catalog = await call('/actions', 'GET');
        expect([catalog.status, catalog.body?.data?.total], JSON.stringify(catalog.body)).toEqual([200, 0]);
        expect((await call('/_status', 'GET')).status).toBe(200);
        expect(automation.getActionDescriptors).toHaveBeenCalled();
        expect(automation.getFlowRuntimeStates).toHaveBeenCalled();
    });

    it('CONTROL — `_env` followed by a flow name is still the environment\'s flow', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        expect((await call('/_env/ping', 'GET')).status).toBe(200);
        expect(automation.getFlow).toHaveBeenCalledWith('ping');
    });
});

describe('the legacy trigger is two segments bare, three addressed, and nothing else at any depth', () => {
    it('`trigger/:x/:y` whose `:x` is no address is declined — the flow `:x` never runs', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        expect((await call('/trigger/nope/send_digest', 'POST')).handled).toBe(false);
        expect((await call('/trigger/send_digest/extra', 'POST')).handled).toBe(false);
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('a bare call past the bound is declined at every depth — the flow `:x` never runs (before the bound it RAN, tail ignored)', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER, ['send_digest', 'runs']);
        for (const path of [
            '/trigger/send_digest/a/b',
            '/trigger/send_digest/a/b/c',
            // The deep `POST` shapes a mounted host routes here by its parameters:
            // the run doors of a flow named `trigger` read as `trigger/runs/…`.
            '/trigger/runs/r1/cancel',
            '/trigger/runs/r1/resume',
            '/trigger/runs/r1/restore-suspension',
        ]) {
            expect([path, (await call(path, 'POST')).handled]).toEqual([path, false]);
        }
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('an addressed call past the bound is declined — neither the namespace nor the name runs as a flow', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        for (const path of ['/trigger/crm/send_digest/extra', '/trigger/_env/ping/extra', '/trigger/crm/runs/r1/resume']) {
            expect([path, (await call(path, 'POST')).handled]).toEqual([path, false]);
        }
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('on a catch-all host it is declined at `dispatch()` — the seam `createHonoApp` hands every path — nothing run', async () => {
        // `createHonoApp` answers a declined dispatch with its own 404, as for
        // `/actions` past its arity; the mounted host's `ROUTE_NOT_FOUND` is
        // pinned over a socket in `automation-every-verb.hono.integration.test.ts`.
        const { dispatch, automation } = dispatcherWith(ONE_HOLDER);
        for (const path of ['/automation/trigger/send_digest/a/b', '/automation/trigger/crm/send_digest/extra']) {
            expect([path, (await dispatch(path, 'POST')).handled]).toEqual([path, false]);
        }
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('CONTROL — the same catch-all seam serves the bare and the addressed legacy trigger', async () => {
        const { dispatch, automation } = dispatcherWith(ONE_HOLDER);
        for (const path of ['/automation/trigger/send_digest', '/automation/trigger/crm/send_digest']) {
            const answer = await dispatch(path, 'POST');
            expect([path, answer.handled, answer.status ?? 200], JSON.stringify(answer.body)).toEqual([path, true, 200]);
        }
        expect(automation.execute.mock.calls.map((c: any[]) => c[0])).toEqual(['send_digest', 'send_digest']);
    });

    it('CONTROL — another verb at three segments is the flow `trigger`\'s: its run read answers', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER, ['trigger']);
        const answer = await call('/trigger/runs/r1', 'GET');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(automation.getRun).toHaveBeenCalledWith('r1');
    });

    it('CONTROL — another verb at four segments is the flow `trigger`\'s too: a run door\'s shape answers its 405, never declined', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER, ['trigger']);
        for (const [path, method] of [['/trigger/runs/r1/resume', 'PUT'], ['/trigger/runs/r1/cancel', 'GET']] as const) {
            const answer = await call(path, method);
            expect([path, method, answer.status, answer.headers?.Allow, codeOf(answer)])
                .toEqual([path, method, 405, 'POST', 'METHOD_NOT_ALLOWED']);
        }
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('CONTROL — the addressed and the bare legacy trigger run their flow', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        expect((await call('/trigger/crm/send_digest', 'POST')).status).toBe(200);
        expect((await call('/trigger/send_digest', 'POST')).status).toBe(200);
        expect(automation.execute.mock.calls.map((c: any[]) => c[0])).toEqual(['send_digest', 'send_digest']);
    });
});

describe('a served shape under another verb answers the domain\'s 405, the verbs it serves in `Allow`', () => {
    // Every two-segment path reaches the domain under every verb now (the
    // addressed `/automation/:ns/:name` mounts), so the `Allow` the transport
    // used to build is the domain's to give, from the shapes it serves.
    it('bare and addressed: the verb a shape is never served under is refused with that shape\'s verbs, and nothing runs', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        for (const [path, method, allow] of [
            ['/send_digest/trigger', 'GET', 'POST'],
            ['/crm/send_digest/trigger', 'GET', 'POST'],
            ['/send_digest/runs', 'POST', 'GET'],
            ['/trigger/send_digest', 'GET', 'POST'],
            ['/connectors/credential-refs', 'POST', 'GET'],
            ['/send_digest', 'POST', 'GET, PUT, DELETE'],
        ] as const) {
            const answer = await call(path, method);
            expect([path, method, answer.status, answer.headers?.Allow, codeOf(answer)])
                .toEqual([path, method, 405, allow, 'METHOD_NOT_ALLOWED']);
        }
        expect(automation.execute).not.toHaveBeenCalled();
        expect(automation.listRunsPage).not.toHaveBeenCalled();
    });

    it('CONTROL — a shape no route serves is declined, never a 405', async () => {
        const { call } = dispatcherWith(ONE_HOLDER);
        for (const method of ['GET', 'POST', 'PUT']) {
            expect((await call('/send_digest/no-such-verb', method)).handled).toBe(false);
        }
    });
});

describe('/automation/connectors/:ns/:name/connection — a connector instance by its namespace', () => {
    const connectors: Holdings = { packages: { 'connector:stripe': [CRM], 'connector:mail': [CRM, HR] } };

    it('the namespace\'s one holder is served as the bare connection door', async () => {
        const { call, automation } = dispatcherWith(connectors);
        const answer = await call('/connectors/crm/stripe/connection', 'GET');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(automation.getConnectorConnection.mock.calls.map((c: any[]) => c[0].connector)).toEqual(['stripe']);
    });

    it('a namespace that holds no such instance: 409 naming the holder; a bare name two packages hold: 409 naming both', async () => {
        const { call, automation } = dispatcherWith(connectors);
        const elsewhere = await call('/connectors/hr/stripe/connection', 'GET');
        expect([elsewhere.status, candidatesOf(elsewhere)]).toEqual([409, [{ kind: 'package', packageId: CRM }]]);
        const bare = await call('/connectors/mail/connection', 'GET');
        expect([bare.status, candidatesOf(bare)]).toEqual([409, [{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]]);
        expect(automation.getConnectorConnection).not.toHaveBeenCalled();
    });

    it('[ADR-0150 D9, #31699] a name two packages hold: each namespace\'s address reads, connects and revokes its own package\'s instance (FROM: 409 naming both)', async () => {
        const { call, automation } = dispatcherWith(connectors);
        for (const [ns, pkg] of [['crm', CRM], ['hr', HR]] as const) {
            const read = await call(`/connectors/${ns}/mail/connection`, 'GET');
            expect(read.status, JSON.stringify(read.body)).toBe(200);
            expect(automation.getConnectorConnection.mock.calls.at(-1)?.[0]).toMatchObject({ connector: 'mail', package: pkg });
        }
        // CONTROL: the one-holder address names no package; the bare door names none.
        await call('/connectors/crm/stripe/connection', 'GET');
        expect(automation.getConnectorConnection.mock.calls.at(-1)?.[0]).not.toHaveProperty('package');
    });

    it('CONTROL — the literal segments keep their routes: `oauth` and `credential-refs` are never read as a namespace', async () => {
        // A package booted under `oauth` (held before the install refusal) holds `stripe`.
        const { call, automation } = dispatcherWith({ packages: { 'connector:stripe': [HR] }, namespaces: { [HR]: 'oauth' } });
        await call('/connectors/oauth/stripe/connection', 'GET');
        expect(automation.getConnectorConnection).not.toHaveBeenCalled();
    });
});

/**
 * [ADR-0150 D3, #33386; seat rulings 6884403301 and Q2 6888807772] A name two
 * packages hold, one of them disabled, through the real dispatcher over a real
 * `SchemaRegistry` (its `disablePackage`, its served filter), in both
 * registration orders. The doors judge the SERVED holders: the bare name is the
 * one served holder's slot or instance; an address naming the disabled holder
 * is refused naming the served holder only; `_env` and a third namespace name
 * the served holder only; with both disabled, nothing is reached.
 */
describe('[#33386] the by-name doors judge the served holders of a name two packages hold', () => {
    const OPS = 'com.ops.pkg';
    const ORDERS = [[CRM, HR], [HR, CRM]];

    function registryOf(order: readonly string[], disabled: readonly string[]) {
        const registry = new SchemaRegistry();
        registry.logLevel = 'silent';
        for (const [id, namespace] of [[CRM, 'crm'], [HR, 'hr'], [OPS, 'ops']]) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace } as never, 'code');
        }
        for (const holder of order) {
            registry.registerItem('flow', { name: 'convert', _packageId: holder }, 'name' as never, holder);
            registry.registerItem('connector', { name: 'mail', _packageId: holder }, 'name' as never, holder);
        }
        for (const id of disabled) registry.disablePackage(id);
        return registry;
    }

    function dispatcherOver(registry: SchemaRegistry) {
        const slotOf = (pkg: string | null, name: string) => (name === 'convert' && pkg !== null && [CRM, HR].includes(pkg) ? `${pkg}/convert` : undefined);
        const automation = {
            handlerReady: true,
            getFlow: vi.fn(async () => null),
            execute: vi.fn(async (name: string) => ({ success: false, error: `Flow '${name}' not found` })),
            toggleFlow: vi.fn(async () => {}),
            listRunsPage: vi.fn(async () => ({ runs: [] as unknown[], hasMore: false })),
            getConnectorConnection: vi.fn(async (request: { connector: string }) => ({ connector: request.connector, status: 'not_connected' })),
            getActionDescriptors: vi.fn(() => []),
            getFlowRuntimeStates: vi.fn(() => []),
            flowSlotKey: vi.fn(slotOf),
            getFlowSlot: vi.fn((pkg: string | null, name: string) => (slotOf(pkg, name) ? { name, label: `${pkg} flow` } : null)),
            executeSlot: vi.fn(async (pkg: string | null) => ({ success: true, output: { ran: pkg } })),
            toggleFlowSlot: vi.fn(async () => {}),
        };
        const services: Record<string, unknown> = { automation, objectql: { registry } };
        const resolve = (name: string) => services[name];
        const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
        const dispatcher = new HttpDispatcher(kernel);
        const call = async (path: string, method: string, body: unknown = {}) => {
            const answered = await dispatcher.handleAutomation(path, method, body, { request: {}, executionContext: ADMIN } as any, {});
            return { status: answered.response?.status ?? 200, body: answered.response?.body as any };
        };
        return { call, automation };
    }

    const packagesOf = (a: { body?: any }) => (candidatesOf(a) ?? []).map((c: { packageId?: string }) => c.packageId);

    describe.each(ORDERS.map((order) => [order.join(' then '), order] as const))('registered %s', (_o, order) => {
        it('CONTROL — nothing disabled: the bare doors refuse naming both; each address is its own slot or instance', async () => {
            const { call, automation } = dispatcherOver(registryOf(order, []));
            const bare = await call('/convert/trigger', 'POST');
            expect([bare.status, packagesOf(bare)]).toEqual([409, [...order]]);
            const mail = await call('/connectors/mail/connection', 'GET');
            expect([mail.status, packagesOf(mail)]).toEqual([409, [...order]]);
            expect((await call('/crm/convert/trigger', 'POST')).status).toBe(200);
            expect(automation.executeSlot.mock.calls.map((c) => c[0])).toEqual([CRM]);
            expect((await call('/connectors/hr/mail/connection', 'GET')).status).toBe(200);
            expect(automation.getConnectorConnection.mock.calls.at(-1)?.[0]).toMatchObject({ connector: 'mail', package: HR });
        });

        it('CRM disabled — flow: the bare door runs HR\'s slot (FROM 409 naming both); CRM\'s address is refused naming HR (FROM CRM\'s slot ran); HR\'s address is HR\'s slot', async () => {
            const { call, automation } = dispatcherOver(registryOf(order, [CRM]));
            expect((await call('/convert/trigger', 'POST')).status).toBe(200);
            expect(automation.executeSlot.mock.calls.map((c) => c[0])).toEqual([HR]);
            const off = await call('/crm/convert/trigger', 'POST');
            expect([off.status, codeOf(off), packagesOf(off)]).toEqual([409, 'RESOURCE_CONFLICT', [HR]]);
            expect((await call('/hr/convert/trigger', 'POST')).status).toBe(200);
            for (const path of ['/_env/convert/trigger', '/ops/convert/trigger']) {
                const other = await call(path, 'POST');
                expect([path, other.status, packagesOf(other)]).toEqual([path, 409, [HR]]);
            }
            expect(automation.executeSlot.mock.calls.map((c) => c[0])).toEqual([HR, HR]);
            expect(automation.execute).not.toHaveBeenCalled();
        });

        it('CRM disabled — connector (Q2 rows): the address naming CRM is refused naming HR (FROM 404 from the service); HR\'s address and the bare name connect HR\'s instance (bare FROM 409 naming both); `_env` and a third namespace name HR only (FROM naming both)', async () => {
            const { call, automation } = dispatcherOver(registryOf(order, [CRM]));
            const off = await call('/connectors/crm/mail/connection', 'GET');
            expect([off.status, codeOf(off), packagesOf(off)]).toEqual([409, 'RESOURCE_CONFLICT', [HR]]);
            expect(automation.getConnectorConnection).not.toHaveBeenCalled();
            for (const path of ['/connectors/hr/mail/connection', '/connectors/mail/connection']) {
                expect((await call(path, 'GET')).status, path).toBe(200);
                expect(automation.getConnectorConnection.mock.calls.at(-1)?.[0], path).toMatchObject({ connector: 'mail', package: HR });
            }
            for (const path of ['/connectors/_env/mail/connection', '/connectors/ops/mail/connection']) {
                const other = await call(path, 'GET');
                expect([path, other.status, packagesOf(other)]).toEqual([path, 409, [HR]]);
            }
            expect(automation.getConnectorConnection).toHaveBeenCalledTimes(2);
        });

        it('the definition writes (PUT, DELETE, clone) under a disable: an address naming CRM, `_env` or a third namespace is refused naming HR only (FROM: naming both); HR\'s address still names both; both disabled, an address answers 404 (FROM: 409)', async () => {
            const writes = (prefix: string) => [
                [`${prefix}/convert`, 'PUT', { name: 'convert', type: 'autolaunched' }],
                [`${prefix}/convert`, 'DELETE', {}],
                [`${prefix}/convert/clone`, 'POST', { name: 'convert_copy' }],
            ] as const;
            const oneOff = dispatcherOver(registryOf(order, [CRM]));
            for (const prefix of ['/crm', '/_env', '/ops']) {
                for (const [path, method, body] of writes(prefix)) {
                    const answer = await oneOff.call(path, method, body);
                    expect([path, method, answer.status, codeOf(answer), packagesOf(answer)]).toEqual([path, method, 409, 'RESOURCE_CONFLICT', [HR]]);
                }
            }
            // Not moved: HR's own address keeps the 409 naming every holder.
            for (const prefix of ['/hr']) {
                for (const [path, method, body] of writes(prefix)) {
                    const answer = await oneOff.call(path, method, body);
                    expect([path, method, answer.status, packagesOf(answer).sort()]).toEqual([path, method, 409, [CRM, HR].sort()]);
                }
            }
            const bothOff = dispatcherOver(registryOf(order, [CRM, HR]));
            for (const prefix of ['/crm', '/hr']) {
                for (const [path, method, body] of writes(prefix)) {
                    expect([path, method, (await bothOff.call(path, method, body)).status]).toEqual([path, method, 404]);
                }
            }
            for (const h of [oneOff, bothOff]) expect(h.automation.executeSlot).not.toHaveBeenCalled();
        });

        it('both disabled: no address reaches a flow or an instance (404); the bare door and `_env` reach no slot, and the service answers them with no package', async () => {
            const { call, automation } = dispatcherOver(registryOf(order, [CRM, HR]));
            for (const path of ['/crm/convert/trigger', '/hr/convert/trigger']) expect((await call(path, 'POST')).status, path).toBe(404);
            for (const path of ['/connectors/crm/mail/connection', '/connectors/hr/mail/connection']) expect((await call(path, 'GET')).status, path).toBe(404);
            expect((await call('/convert/trigger', 'POST')).status).toBe(404);
            expect(automation.executeSlot).not.toHaveBeenCalled();
            for (const path of ['/connectors/mail/connection', '/connectors/_env/mail/connection']) {
                await call(path, 'GET');
                expect(automation.getConnectorConnection.mock.calls.at(-1)?.[0], path).not.toHaveProperty('package');
            }
        });
    });
});

/**
 * [ADR-0150 D3, #33905] A flow name one package holds, that package disabled,
 * over a real `SchemaRegistry`: its namespaced address is refused `404` at
 * admission, before the service is asked. The bare path reaches the engine,
 * whose bare entries now answer as for a flow it does not hold (`getFlow`
 * `null`, pinned in service-automation's `flow-slots-per-package.test.ts`),
 * so each bare door answers what the address answers. The service here
 * answers as the engine does for such a flow.
 */
describe('[#33905] a flow whose only holder\'s package is disabled: the bare door answers as its namespaced address (404)', () => {
    function registryHolding(disabled: boolean) {
        const registry = new SchemaRegistry();
        registry.logLevel = 'silent';
        registry.installPackage({ id: CRM, name: CRM, version: '1.0.0', type: 'app', namespace: 'crm' } as never, 'code');
        registry.registerItem('flow', { name: 'solo', _packageId: CRM }, 'name' as never, CRM);
        if (disabled) registry.disablePackage(CRM);
        return registry;
    }

    function dispatcherOver(registry: SchemaRegistry, held: boolean) {
        const automation = {
            handlerReady: true,
            getFlow: vi.fn(async (name: string) => (held && name === 'solo' ? { name } : null)),
            execute: vi.fn(async (name: string) => (held ? { success: true, output: {} } : { success: false, error: `Flow '${name}' not found` })),
            toggleFlow: vi.fn(async (name: string) => { if (!held) throw new Error(`Flow '${name}' not found`); }),
            listRunsPage: vi.fn(async () => ({ runs: [] as unknown[], hasMore: false })),
            getActionDescriptors: vi.fn(() => []),
            getFlowRuntimeStates: vi.fn(() => []),
        };
        const services: Record<string, unknown> = { automation, objectql: { registry } };
        const resolve = (name: string) => services[name];
        const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
        const dispatcher = new HttpDispatcher(kernel);
        const call = async (path: string, method: string, body: unknown = {}) => {
            const answered = await dispatcher.handleAutomation(path, method, body, { request: {}, executionContext: ADMIN } as any, {});
            return { status: answered.response?.status ?? 200, body: answered.response?.body as any };
        };
        return { call, automation };
    }

    const DOORS: ReadonlyArray<readonly [string, string, string, unknown]> = [
        ['/solo', '/crm/solo', 'GET', {}],
        ['/solo/trigger', '/crm/solo/trigger', 'POST', {}],
        ['/trigger/solo', '/trigger/crm/solo', 'POST', {}],
        ['/solo/toggle', '/crm/solo/toggle', 'POST', { enabled: false }],
        ['/solo/runs', '/crm/solo/runs', 'GET', {}],
    ];

    it('each bare door answers 404 as its namespaced address does; nothing runs or switches (FROM: the bare door served the flow)', async () => {
        const { call, automation } = dispatcherOver(registryHolding(true), false);
        for (const [bare, addressed, method, body] of DOORS) {
            const viaAddress = await call(addressed, method, body);
            const viaBare = await call(bare, method, body);
            expect([bare, viaBare.status, codeOf(viaBare)]).toEqual([bare, 404, codeOf(viaAddress)]);
            expect([addressed, viaAddress.status]).toEqual([addressed, 404]);
        }
        expect(automation.execute).not.toHaveBeenCalled();
        expect(automation.toggleFlow).not.toHaveBeenCalled();
        expect(automation.listRunsPage).not.toHaveBeenCalled();
    });

    it('the clone door with the flow as its source answers 404 as its namespaced address does; nothing is registered (FROM: the source was copied)', async () => {
        const { call, automation } = dispatcherOver(registryHolding(true), false);
        const registerFlow = vi.fn();
        (automation as Record<string, unknown>).registerFlow = registerFlow;
        const viaAddress = await call('/crm/solo/clone', 'POST', { name: 'solo_copy', label: 'Solo copy' });
        const viaBare = await call('/solo/clone', 'POST', { name: 'solo_copy', label: 'Solo copy' });
        expect([viaBare.status, codeOf(viaBare)]).toEqual([404, codeOf(viaAddress)]);
        expect(viaAddress.status).toBe(404);
        expect(registerFlow).not.toHaveBeenCalled();
    });

    it('CONTROL — the package enabled: the address is its bare path, and both serve the flow', async () => {
        const { call } = dispatcherOver(registryHolding(false), true);
        for (const [bare, addressed, method, body] of DOORS) {
            const viaAddress = await call(addressed, method, body);
            const viaBare = await call(bare, method, body);
            expect([bare, viaBare.status]).toEqual([bare, 200]);
            expect([addressed, viaAddress.status]).toEqual([addressed, 200]);
        }
    });
});

/**
 * [ADR-0126 §7.2, ADR-0150 D4] The toggle door's `200` answers the switched
 * flow's own state, on a name two packages hold too. The door reaches such a
 * name through `flowSlotView` (an address, or the bare name with one served
 * holder left), whose `toggleFlow` switches one slot, while the engine reads
 * one row per slot under the bare name, in registration order. A row picked by
 * name there is the FIRST holder's, so each case switches the holder
 * registered SECOND, with the first one's row reading the opposite state.
 *
 * Driven through the real dispatcher over a real `SchemaRegistry`, and an
 * engine double that keeps each slot's state, switches it in `toggleFlowSlot`
 * and reads it back the engine's way (`getFlowRuntimeStates`: one row per
 * slot, under the bare name).
 */
describe('[ADR-0126 §7.2] the toggle door answers the switched slot, on a name two packages hold', () => {
    const NAME = 'convert';

    function registryOf(order: readonly string[], disabled: readonly string[] = []) {
        const registry = new SchemaRegistry();
        registry.logLevel = 'silent';
        for (const [id, namespace] of [[CRM, 'crm'], [HR, 'hr']]) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace } as never, 'code');
        }
        for (const holder of order) registry.registerItem('flow', { name: NAME, _packageId: holder }, 'name' as never, holder);
        for (const id of disabled) registry.disablePackage(id);
        return registry;
    }

    /** `slots`: each holder's slot of `NAME` and its state, in registration order. */
    function dispatcherOver(registry: SchemaRegistry, slots: Array<[string, boolean]>) {
        const state = new Map(slots);
        const keyed = (pkg: string | null) => (pkg !== null && state.has(pkg) ? (state.size > 1 ? `${pkg}/${NAME}` : NAME) : undefined);
        const shared = () => Object.assign(new Error(`Flow '${NAME}' is held by several packages`), { code: 'RESOURCE_CONFLICT', status: 409 });
        const automation = {
            handlerReady: true,
            getFlow: vi.fn(async (name: string) => { if (name === NAME) throw shared(); return null; }),
            toggleFlow: vi.fn(async (name: string) => { if (name === NAME) throw shared(); }),
            getFlowRuntimeStates: vi.fn(() => [...state].map(([, enabled]) => ({ name: NAME, enabled, bound: enabled }))),
            flowSlotKey: vi.fn((pkg: string | null, name: string) => (name === NAME ? keyed(pkg) : undefined)),
            getFlowSlot: vi.fn((pkg: string | null, name: string) => (name === NAME && keyed(pkg) ? { name, label: `${pkg} flow` } : null)),
            executeSlot: vi.fn(async () => ({ success: true, output: {} })),
            toggleFlowSlot: vi.fn(async (pkg: string, _name: string, enabled: boolean) => { state.set(pkg, enabled); }),
        };
        const services: Record<string, unknown> = { automation, objectql: { registry } };
        const resolve = (name: string) => services[name];
        const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
        const dispatcher = new HttpDispatcher(kernel);
        const toggle = async (path: string, enabled: boolean) => {
            const answered = await dispatcher.handleAutomation(path, 'POST', { enabled }, { request: {}, executionContext: ADMIN } as any, {});
            return { status: answered.response?.status ?? 200, body: answered.response?.body as any };
        };
        return { toggle, automation, stateOf: (pkg: string) => state.get(pkg) };
    }

    it('switched ON at the second holder\'s address, the first holder off: 200 { enabled: true }, that slot\'s state (FROM: the first holder\'s false)', async () => {
        const { toggle, automation, stateOf } = dispatcherOver(registryOf([CRM, HR]), [[CRM, false], [HR, false]]);
        const on = await toggle(`/hr/${NAME}/toggle`, true);
        expect(automation.toggleFlowSlot.mock.calls.map((c) => [c[0], c[2]])).toEqual([[HR, true]]);
        expect([on.status, on.body?.data], JSON.stringify(on.body)).toEqual([200, { name: NAME, enabled: true }]);
        expect(on.body?.data?.enabled).toBe(stateOf(HR));
        expect(stateOf(CRM)).toBe(false);
    });

    it('switched OFF at the second holder\'s address, the first holder on: 200 { enabled: false } (FROM: the first holder\'s true)', async () => {
        const { toggle, stateOf } = dispatcherOver(registryOf([CRM, HR]), [[CRM, true], [HR, true]]);
        const off = await toggle(`/hr/${NAME}/toggle`, false);
        expect([off.status, off.body?.data], JSON.stringify(off.body)).toEqual([200, { name: NAME, enabled: false }]);
        expect(off.body?.data?.enabled).toBe(stateOf(HR));
        expect(stateOf(CRM)).toBe(true);
    });

    it('the bare name whose one served holder is the second registered (the first disabled, its slot off): 200 { enabled: true } (FROM: the disabled holder\'s false)', async () => {
        const { toggle, automation, stateOf } = dispatcherOver(registryOf([CRM, HR], [CRM]), [[CRM, false], [HR, false]]);
        const on = await toggle(`/${NAME}/toggle`, true);
        expect(automation.toggleFlowSlot.mock.calls.map((c) => [c[0], c[2]])).toEqual([[HR, true]]);
        expect([on.status, on.body?.data], JSON.stringify(on.body)).toEqual([200, { name: NAME, enabled: true }]);
        expect(on.body?.data?.enabled).toBe(stateOf(HR));
        expect(automation.toggleFlow).not.toHaveBeenCalled();
    });

    it('CONTROL — the first holder\'s address, the second holder reading the opposite: the answer is the first holder\'s own state', async () => {
        const { toggle, automation, stateOf } = dispatcherOver(registryOf([CRM, HR]), [[CRM, false], [HR, true]]);
        const on = await toggle(`/crm/${NAME}/toggle`, true);
        expect(automation.toggleFlowSlot.mock.calls.map((c) => [c[0], c[2]])).toEqual([[CRM, true]]);
        expect([on.status, on.body?.data], JSON.stringify(on.body)).toEqual([200, { name: NAME, enabled: true }]);
        expect(on.body?.data?.enabled).toBe(stateOf(CRM));
    });

    it('CONTROL — a name one package holds still answers its one row read back, not the request', async () => {
        const { toggle, automation } = dispatcherOver(registryOf([HR]), [[HR, false]]);
        // The row reads off whatever was asked: the door answers the row.
        automation.toggleFlowSlot.mockImplementation(async () => {});
        automation.toggleFlow.mockImplementation(async () => {});
        automation.getFlow.mockImplementation(async (name: string) => (name === NAME ? { name } : null) as never);
        const on = await toggle(`/${NAME}/toggle`, true);
        expect([on.status, on.body?.data], JSON.stringify(on.body)).toEqual([200, { name: NAME, enabled: false }]);
        expect(automation.getFlowRuntimeStates).toHaveBeenCalled();
    });
});
