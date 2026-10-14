// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D12 items 7–8 · D11] The `/automation` definition writes —
 * `POST /`, `PUT /:name`, `DELETE /:name` and `POST /:name/clone` — ask the
 * walled refusal (`walledCatalogWriteVerdict`, `@objectstack/metadata-core`)
 * right after the `manage_metadata` gate: a flow definition is registered at
 * environment scope, so under `isolated` / `group` it is the platform
 * operator's to create, change, deregister or clone (ruling A on #23231).
 *
 * Pinned here: a `manage_metadata` holder below the operator rung is refused
 * `403 PERMISSION_DENIED` naming the posture before the automation service is
 * touched; the controls — the operator rung, `isSystem`, `single` and no
 * `tenancy` service — are not refused by it. The enablement door stays the
 * ADR-0126 §5 activation gate's (`automation-activation-posture-gate.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const FLOW = 'vendor_lead_router';
const DEFINITION = {
    name: FLOW, label: 'Vendor Lead Router', type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', label: 'Start', config: {} }, { id: 'end', type: 'end', label: 'End' }],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

function boot(posture: 'single' | 'isolated' | 'group' | null) {
    const automation = {
        handlerReady: true,
        registerFlow: vi.fn(async () => undefined),
        unregisterFlow: vi.fn(async () => undefined),
        cloneFlow: vi.fn(async () => ({ name: 'my_router' })),
        getFlow: vi.fn(async (name: string) => (name === FLOW ? DEFINITION : undefined)),
        listFlows: vi.fn(async () => [FLOW]),
    };
    const services: Record<string, unknown> = { automation };
    if (posture) services.tenancy = { posture };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), automation };
}

const ctx = (executionContext: any): any => ({ request: {}, executionContext });
/** A tenant org admin who holds `manage_metadata`, so the capability gate admits it and the walled refusal is what answers. */
const TENANT_ADMIN = { userId: 'u_owner', systemPermissions: ['manage_metadata'], posture: 'TENANT_ADMIN', tenantId: 'org_a' };
const OPERATOR = { userId: 'u_operator', systemPermissions: ['manage_metadata'], posture: 'PLATFORM_ADMIN' };
const SYSTEM = { userId: 'usr_system', isSystem: true };

const WRITES: Array<{ path: string; method: string; body?: unknown }> = [
    { path: '/', method: 'POST', body: { ...DEFINITION, name: 'tenant_flow' } },
    { path: `/${FLOW}`, method: 'PUT', body: { ...DEFINITION, label: 'Edited' } },
    { path: `/${FLOW}`, method: 'DELETE' },
    { path: `/${FLOW}/clone`, method: 'POST', body: { name: 'my_router', label: 'My Router' } },
];

const touched = (stack: ReturnType<typeof boot>) =>
    (['registerFlow', 'unregisterFlow', 'cloneFlow'] as const).filter((fn) => stack.automation[fn].mock.calls.length > 0);

describe('[ADR-0131 D12 items 7–8] /automation definition writes — the walled refusal', () => {
    for (const posture of ['isolated', 'group'] as const) {
        for (const write of WRITES) {
            it(`${posture} · ${write.method} ${write.path}: a tenant holder is refused 403 PERMISSION_DENIED naming the posture, and the service is not touched`, async () => {
                const stack = boot(posture);
                const { response } = await stack.dispatcher.handleAutomation(write.path, write.method, write.body, ctx(TENANT_ADMIN), undefined);
                expect((response as any)?.status).toBe(403);
                expect((response as any)?.body?.error?.code).toBe('PERMISSION_DENIED');
                const message = String((response as any)?.body?.error?.message);
                expect(message).toContain(`'${posture}' tenancy posture`);
                expect(message).toContain("a 'flow' metadata item");
                expect(touched(stack)).toEqual([]);
            });
        }

        it(`${posture}: CONTROL — the platform operator rung and the engine itself are not refused by it`, async () => {
            for (const caller of [OPERATOR, SYSTEM]) {
                for (const write of WRITES) {
                    const stack = boot(posture);
                    const { response } = await stack.dispatcher.handleAutomation(write.path, write.method, write.body, ctx(caller), undefined);
                    expect(String((response as any)?.body?.error?.message ?? ''), `${caller.userId} ${write.method} ${write.path}`)
                        .not.toContain('tenancy posture');
                    expect((response as any)?.status, `${caller.userId} ${write.method} ${write.path}`).not.toBe(403);
                }
            }
        });
    }

    it('CONTROL — under `single` and with no `tenancy` service the same tenant holder is not refused by it', async () => {
        for (const posture of ['single', null] as const) {
            for (const write of WRITES) {
                const stack = boot(posture);
                const { response } = await stack.dispatcher.handleAutomation(write.path, write.method, write.body, ctx(TENANT_ADMIN), undefined);
                expect(String((response as any)?.body?.error?.message ?? ''), `${posture} ${write.method} ${write.path}`)
                    .not.toContain('tenancy posture');
                expect((response as any)?.status, `${posture} ${write.method} ${write.path}`).not.toBe(403);
            }
        }
    });

    it('the capability gate still answers first: a caller without `manage_metadata` gets its sentence, not the posture one', async () => {
        const stack = boot('isolated');
        const { response } = await stack.dispatcher.handleAutomation('/', 'POST', DEFINITION, ctx({ userId: 'u_x', systemPermissions: [] }), undefined);
        expect((response as any)?.status).toBe(403);
        expect(String((response as any)?.body?.error?.message)).toContain('requires the `manage_metadata` capability');
        expect(touched(stack)).toEqual([]);
    });
});
