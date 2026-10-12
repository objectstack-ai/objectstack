// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3] The dispatcher's `PUT /meta/:type/:name` asks the walled
 * catalog refusal (`walledCatalogWriteVerdict`, `@objectstack/metadata-core`)
 * right after its capability gate: under `isolated` / `group` a position, a
 * permission set or a capability is saved only by the platform operator rung
 * or the engine itself. `RestServer`'s four write doors ask the same predicate;
 * the booted proof of both transports' shared behaviour, including the
 * cross-organization read-back, is `wall-catalog-refusal.dogfood.test.ts`.
 *
 * Pinned here, on this transport: the refusal's envelope
 * (`403 PERMISSION_DENIED`, this transport's spelling), that nothing reaches
 * `saveMetaItem`, and the controls (the operator, `single`, no `tenancy`
 * service, and a type outside the catalog).
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

function boot(posture: 'single' | 'isolated' | 'group' | null) {
    const saveMetaItem = vi.fn(async ({ type, name }: any) => ({ success: true, type, name }));
    const getMetaItem = vi.fn(async () => null);
    const protocol = { saveMetaItem, getMetaItem };
    const services: Record<string, unknown> = { protocol };
    if (posture) services.tenancy = { posture };
    const resolve = (name: string): unknown => services[name] ?? null;
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), saveMetaItem };
}

const ctx = (executionContext: any): any => ({ request: {}, environmentId: 'platform', executionContext });

/** An organization-scoped `manage_metadata` holder: the capability gate admits it, and it is not the operator. */
const TENANT_AUTHOR = { userId: 'u_tenant', tenantId: 'org_a', systemPermissions: ['manage_metadata'], posture: 'TENANT_ADMIN' };
const OPERATOR = { userId: 'u_operator', systemPermissions: ['manage_metadata'], posture: 'PLATFORM_ADMIN' };

const BODIES: Record<string, Record<string, unknown>> = {
    position: { name: 'plant_lead', label: 'Plant lead' },
    permission: { name: 'plant_set', label: 'Plant set', objects: {} },
    capability: { name: 'plant.cap', label: 'Plant cap', scope: 'org' },
};

describe('[ADR-0131 D3] dispatcher PUT /meta — the walled catalog refusal', () => {
    for (const posture of ['isolated', 'group'] as const) {
        it(`${posture}: a tenant's save of each catalog type is refused 403 PERMISSION_DENIED, and nothing is saved`, async () => {
            for (const [type, body] of Object.entries(BODIES)) {
                const stack = boot(posture);
                const res = await stack.dispatcher.handleMetadata(`/${type}/${body.name}`, ctx(TENANT_AUTHOR), 'PUT', body);
                expect(res.response?.status, type).toBe(403);
                expect(res.response?.body?.error?.code, type).toBe('PERMISSION_DENIED');
                expect(String(res.response?.body?.error?.message), type).toContain(`'${posture}' tenancy posture`);
                expect(stack.saveMetaItem, type).not.toHaveBeenCalled();
            }
        });

        it(`${posture}: a plural URL spelling is judged as the catalog type it writes`, async () => {
            const stack = boot(posture);
            const res = await stack.dispatcher.handleMetadata('/permissions/plant_set', ctx(TENANT_AUTHOR), 'PUT', BODIES.permission);
            expect(res.response?.status).toBe(403);
            expect(stack.saveMetaItem).not.toHaveBeenCalled();
        });

        it(`${posture}: CONTROL — the platform operator rung saves`, async () => {
            const stack = boot(posture);
            await stack.dispatcher.handleMetadata('/position/plant_lead', ctx(OPERATOR), 'PUT', BODIES.position);
            expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
        });

        it(`${posture}: CONTROL — a type outside the catalog is not judged`, async () => {
            const stack = boot(posture);
            await stack.dispatcher.handleMetadata('/view/plant_view', ctx(TENANT_AUTHOR), 'PUT', { name: 'plant_view', label: 'Plant view' });
            expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
        });
    }

    it('single: CONTROL — the same `manage_metadata` holder saves a position, unchanged', async () => {
        const stack = boot('single');
        await stack.dispatcher.handleMetadata('/position/plant_lead', ctx(TENANT_AUTHOR), 'PUT', BODIES.position);
        expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
    });

    it('no `tenancy` service behaves like `single` (ADR-0093 D4/D5)', async () => {
        const stack = boot(null);
        await stack.dispatcher.handleMetadata('/position/plant_lead', ctx(TENANT_AUTHOR), 'PUT', BODIES.position);
        expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
    });

    it('the capability gate still answers first: a caller without `manage_metadata` gets its sentence, not the posture one', async () => {
        const stack = boot('isolated');
        const res = await stack.dispatcher.handleMetadata('/position/plant_lead', ctx({ userId: 'u_x', systemPermissions: [] }), 'PUT', BODIES.position);
        expect(res.response?.status).toBe(403);
        expect(String(res.response?.body?.error?.message)).toContain('requires the `manage_metadata` capability');
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
    });
});
