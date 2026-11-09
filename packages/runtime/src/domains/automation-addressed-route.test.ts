// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, epic child G1] The `/automation` by-name doors read D5's
 * address: `/automation/:ns/:name[/trigger | /toggle | /clone | /runs …]`,
 * `/automation/trigger/:ns/:name`, `/automation/connectors/:ns/:name/connection`
 * and the same under `_env` (`./automation-address.ts`).
 *
 * The engine keeps one slot per bare name and is not re-keyed, so an admitted
 * address is served as its bare path; what is pinned here is WHICH addresses
 * are admitted, what the refused ones answer, that every gate still judges the
 * bare shape ahead of the address, and that a bare name the resolver refuses
 * answers `409` naming every candidate.
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
    };
    const ql = { registry: registryWith(h) };
    const services: Record<string, unknown> = { automation, objectql: ql };
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
    return { call, automation };
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

    it('a bare name two packages hold: its address is refused naming both, since the engine serves no package\'s flow under it', async () => {
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

describe('the legacy trigger is two segments bare, three addressed, and nothing else at three', () => {
    it('`trigger/:x/:y` whose `:x` is no address is declined — the flow `:x` never runs', async () => {
        const { call, automation } = dispatcherWith(ONE_HOLDER);
        expect((await call('/trigger/nope/send_digest', 'POST')).handled).toBe(false);
        expect((await call('/trigger/send_digest/extra', 'POST')).handled).toBe(false);
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
