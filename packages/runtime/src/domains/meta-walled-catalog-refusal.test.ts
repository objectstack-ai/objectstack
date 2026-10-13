// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3 · D12 items 7–8] The dispatcher's `PUT /meta/:type/:name` asks
 * the walled refusal (`walledCatalogWriteVerdict`, `@objectstack/metadata-core`)
 * right after its capability gate: under `isolated` / `group` an item of ANY
 * type is saved only by the platform operator rung or the engine itself (ruling
 * A on #23231: the security catalog is no longer a special case).
 * `RestServer`'s four write doors ask the same predicate; the booted proof of
 * the shared behaviour, including the cross-organization read-back, is
 * `wall-environment-metadata-refusal.dogfood.test.ts` (and, for the catalog,
 * `wall-catalog-refusal.dogfood.test.ts`).
 *
 * Pinned here, on this transport: the refusal's envelope
 * (`403 PERMISSION_DENIED`, this transport's spelling), that nothing reaches
 * `saveMetaItem`, and the controls (the operator, `isSystem`, `single`, no
 * `tenancy` service).
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
    object: { name: 'plant_widget', label: 'Plant widget', fields: {} },
    view: { name: 'plant_widget.all', label: 'Plant view' },
    flow: { name: 'plant_flow', label: 'Plant flow', type: 'autolaunched', nodes: [], edges: [] },
};

describe('[ADR-0131 D12 items 7–8] dispatcher PUT /meta — the walled refusal, for every type', () => {
    for (const posture of ['isolated', 'group'] as const) {
        it(`${posture}: a tenant's save of each type, catalog or not, is refused 403 PERMISSION_DENIED, and nothing is saved`, async () => {
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

        it(`${posture}: CONTROL — the engine itself (\`isSystem\`) saves any type`, async () => {
            for (const [type, body] of Object.entries(BODIES)) {
                const stack = boot(posture);
                await stack.dispatcher.handleMetadata(`/${type}/${body.name}`, ctx({ userId: 'u_system', isSystem: true }), 'PUT', body);
                expect(stack.saveMetaItem, type).toHaveBeenCalledTimes(1);
            }
        });

        it(`${posture}: CONTROL — the platform operator rung saves a non-catalog type`, async () => {
            const stack = boot(posture);
            await stack.dispatcher.handleMetadata('/view/plant_widget.all', ctx(OPERATOR), 'PUT', BODIES.view);
            expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
        });
    }

    it('single: CONTROL — the same `manage_metadata` holder saves every type, unchanged', async () => {
        for (const [type, body] of Object.entries(BODIES)) {
            const stack = boot('single');
            await stack.dispatcher.handleMetadata(`/${type}/${body.name}`, ctx(TENANT_AUTHOR), 'PUT', body);
            expect(stack.saveMetaItem, type).toHaveBeenCalledTimes(1);
        }
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
