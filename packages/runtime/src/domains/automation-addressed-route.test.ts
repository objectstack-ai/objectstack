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
        withSlots(d.automation);
        return d;
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
        withSlots(d.automation);
        const answer = await d.call('/ops/send_digest/trigger', 'POST');
        expect([answer.status, codeOf(answer)]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(candidatesOf(answer)).toEqual([{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]);
        expect(d.automation.executeSlot).not.toHaveBeenCalled();
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

    it('CONTROL — the literal segments keep their routes: `oauth` and `credential-refs` are never read as a namespace', async () => {
        // A package booted under `oauth` (held before the install refusal) holds `stripe`.
        const { call, automation } = dispatcherWith({ packages: { 'connector:stripe': [HR] }, namespaces: { [HR]: 'oauth' } });
        await call('/connectors/oauth/stripe/connection', 'GET');
        expect(automation.getConnectorConnection).not.toHaveBeenCalled();
    });
});
