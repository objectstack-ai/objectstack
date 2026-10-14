// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D12 items 7–8 · D11] `POST /meta/_migrate-stored` on `RestServer`
 * asks the walled refusal (`walledCatalogWriteVerdict`,
 * `@objectstack/metadata-core`) right after its own `manage_metadata` gate: the
 * route rewrites every stored row of the environment's metadata, so under
 * `isolated` / `group` it is the platform operator's (ruling A on #23231). A
 * preview is refused too: it is the same install-wide pass, without the write.
 *
 * Pinned here, on this transport: the refusal's envelope (`403 FORBIDDEN`, the
 * door's own spelling, as its sibling capability refusal), that nothing reaches
 * `migrateStoredMetadata`, and the controls — the platform operator rung,
 * `isSystem`, `single` and no `tenancy` service — which run it as before. The
 * dispatcher's twin is pinned in `@objectstack/runtime`
 * (`meta-walled-catalog-refusal.test.ts`), and the booted door in
 * `wall-environment-metadata-refusal.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

const PATH = '/api/v1/meta/_migrate-stored';

/** An organization-scoped `manage_metadata` holder: the capability gate admits it, and it is not the operator. */
const TENANT_AUTHOR = { userId: 'u_tenant', tenantId: 'org_a', systemPermissions: ['manage_metadata'], posture: 'TENANT_ADMIN' };
const OPERATOR = { userId: 'u_operator', systemPermissions: ['manage_metadata'], posture: 'PLATFORM_ADMIN' };
const SYSTEM = { userId: 'u_system', isSystem: true };

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(),
    };
    return res;
}

/**
 * Boot the route with the caller `context`, on a deployment whose `tenancy`
 * service reports `posture` (`null`: no `tenancy` service at all).
 */
function boot(posture: 'single' | 'isolated' | 'group' | null, context: Record<string, unknown>) {
    const migrateStoredMetadata = vi.fn(async () => ({
        apply: false, scanned: 0, canonical: 0, pending: 0, rewritten: 0, skipped: 0, failed: 0, rows: [],
    }));
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue(null),
        migrateStoredMetadata,
    };
    const rest: any = new RestServer(
        mockServer() as any,
        protocol,
        {} as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined,
        posture ? (async () => ({ posture })) : undefined,
    );
    rest.resolveExecCtx = async () => context;
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === PATH);
    if (!route) throw new Error(`POST ${PATH} is not registered`);
    return {
        migrateStoredMetadata,
        call: async (body: unknown) => {
            const res = mockRes();
            await route.handler({ params: {}, query: {}, headers: {}, body }, res);
            const answer = res.json.mock.calls.at(-1)?.[0];
            return { status: res.statusCode as number, code: answer?.error?.code, message: String(answer?.error?.message ?? '') };
        },
    };
}

describe('[ADR-0131 D12 items 7–8] REST POST /meta/_migrate-stored — the walled refusal', () => {
    for (const posture of ['isolated', 'group'] as const) {
        it(`${posture}: a tenant's install-wide rewrite is refused 403 FORBIDDEN naming the posture, preview and apply alike, and nothing is read`, async () => {
            for (const body of [{}, { apply: true }]) {
                const stack = boot(posture, TENANT_AUTHOR);
                const answer = await stack.call(body);
                expect({ status: answer.status, code: answer.code }).toEqual({ status: 403, code: 'FORBIDDEN' });
                expect(answer.message).toContain(`'${posture}' tenancy posture`);
                expect(answer.message).toContain("the environment's stored metadata");
                expect(stack.migrateStoredMetadata).not.toHaveBeenCalled();
            }
        });

        it(`${posture}: CONTROL — the platform operator rung and the engine itself run it`, async () => {
            for (const caller of [OPERATOR, SYSTEM]) {
                const stack = boot(posture, caller);
                const answer = await stack.call({ apply: true });
                expect(answer.status, caller.userId).toBe(200);
                expect(stack.migrateStoredMetadata, caller.userId).toHaveBeenCalledTimes(1);
            }
        });
    }

    it('CONTROL — under `single` and with no `tenancy` service the same tenant holder runs it, unchanged', async () => {
        for (const posture of ['single', null] as const) {
            const stack = boot(posture, TENANT_AUTHOR);
            const answer = await stack.call({});
            expect(answer.status, String(posture)).toBe(200);
            expect(stack.migrateStoredMetadata, String(posture)).toHaveBeenCalledTimes(1);
        }
    });

    it('the capability gate still answers first: a caller without `manage_metadata` gets its sentence, not the posture one', async () => {
        const stack = boot('isolated', { userId: 'u_x', systemPermissions: [] });
        const answer = await stack.call({});
        expect({ status: answer.status, code: answer.code }).toEqual({ status: 403, code: 'FORBIDDEN' });
        expect(answer.message).toContain('requires the `manage_metadata` capability');
        expect(answer.message).not.toContain('tenancy posture');
        expect(stack.migrateStoredMetadata).not.toHaveBeenCalled();
    });
});
