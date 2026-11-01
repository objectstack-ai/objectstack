// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /api/v1/packages/:id/customizations` is MOUNTED: a request through the
 * dispatcher plugin's registered route reaches the packages domain and answers
 * 200 with the read's declared shape.
 *
 * The read shipped with its ledger row and its domain branch but no
 * `mountPackagesRoute(...)` call, so the live router answered nothing for it,
 * while `domains/packages-customizations.test.ts` stayed green: that suite
 * calls `handlePackages()` directly, below the mount. This file drives the
 * other half: the route `createDispatcherPlugin().start()` registers on the
 * HTTP server, called the way the transport calls it, then `dispatch()`, then
 * the domain. Without the mount there is no handler to call.
 *
 * Harness: the recording `IHttpServer` of `analytics-empty-cube-refusal.test.ts`.
 * The read's own behaviour (the three lists, their sources, the refusals) is
 * pinned in `domains/packages-customizations.test.ts`; here only the door
 * matters, so the services are minimal stand-ins and identity is stubbed to a
 * caller holding the read capability (as `domain-handler-registry.test.ts`
 * does for the other `/packages` routes).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GetPackageCustomizationsResponseSchema } from '@objectstack/spec/api';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { HttpDispatcher } from './http-dispatcher.js';

const BASE = 'com.example.showcase';
const OVERRIDE = { type: 'view', name: 'showcase_task.default', basedOn: '1.0.0', version: 2 };

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
    };
}

function makeCtx(fakeServer: any) {
    const objectql = {
        registry: {
            getPackage: (id: string) => (id === BASE ? { id: BASE, manifest: { id: BASE, version: '1.0.0' } } : undefined),
            getAllObjects: () => [],
            getObject: () => null,
        },
        find: async () => [],
    };
    const protocol = { listServedOverrides: async ({ packageId }: { packageId: string }) => (packageId === BASE ? [OVERRIDE] : []) };
    const service = (name: string) => (name === 'objectql' ? objectql : name === 'protocol' ? protocol : undefined);
    const kernel = { getService: service, getServiceAsync: async (name: string) => service(name) };
    return {
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {},
        on: () => {},
    } as any;
}

function makeRes() {
    const res: any = {
        statusCode: undefined as number | undefined,
        body: undefined as any,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: any) { res.body = b; return res; },
    };
    return res;
}

beforeEach(() => {
    vi.spyOn(HttpDispatcher.prototype as any, 'timedResolveExecutionContext').mockResolvedValue({
        userId: 'u_reader', isSystem: false, systemPermissions: ['studio.access'],
    });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/v1/packages/:id/customizations — mounted', () => {
    it('the dispatcher plugin registers the route, and a request through it answers 200 with the declared shape', async () => {
        const { server, handlers } = makeFakeServer();
        const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
        await plugin.start?.(makeCtx(server));

        const handler = handlers['GET /api/v1/packages/:id/customizations'];
        expect(handler, 'GET /api/v1/packages/:id/customizations must be mounted').toBeTypeOf('function');

        const res = makeRes();
        await handler({ params: { id: BASE }, query: {}, headers: {} }, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({
            packageId: BASE,
            overrides: [OVERRIDE],
            extensions: [],
            switchedOff: [],
            counts: { overrides: 1, extensions: 0, switchedOff: 0 },
        });
        const parsed = GetPackageCustomizationsResponseSchema.safeParse(res.body.data);
        expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    });
});
