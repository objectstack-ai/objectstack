// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25366 — `POST /api/v1/packages` (with or without `overwrite`) is not a door
 * through which a package can ship a position, permission set or capability
 * name, so it cannot register one an environment-authored item holds.
 *
 * The rule (ADR-0048 §3.4 narrowed; ruling Q4 = A on #15196): a package may not
 * ship a security catalog name another holder already holds, the environment
 * catalog included. The marketplace install door is pinned for it in
 * `@objectstack/cloud-connection`
 * (`marketplace-install-local-catalog-name-collision.test.ts`). This file pins
 * why the second package-install door needs no check of its own: it stores the
 * manifest alone, and its body is parsed strictly by `PackageInstallBodySchema`
 * (the `ManifestSchema` close, `scope` narrowed). A manifest carrying a catalog
 * collection is refused `400` at that parse, before any write — whoever holds
 * the name. A manifest-stage `permissions` is the ADR-0025 capability grant
 * block, so a permission-set LIST under that key is refused too.
 *
 * Real: `HttpDispatcher.handlePackages` and a real `SchemaRegistry` holding the
 * environment's item in its bare slot, as `sys_metadata` hydration registers
 * it. No protocol service, so an admitted install takes the documented
 * fallback limb (`registry.installPackage`); the parse runs ahead of both limbs.
 *
 * CONTROL: the same manifest without the collection installs (`201`), fresh
 * and as an overwrite — so each refusal is the collection's, not the body's.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from './http-dispatcher.js';

/** `/packages` demands `manage_metadata` on a state-changing route. */
const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

const PKG_ID = 'com.acme.field-service';

const CASES = [
    { type: 'permission', collection: 'permissions', name: 'acme_dispatcher_lite', item: { name: 'acme_dispatcher_lite', label: 'Clone', objects: {} } },
    { type: 'position', collection: 'positions', name: 'acme_lead_technician', item: { name: 'acme_lead_technician', label: 'Clone' } },
    { type: 'capability', collection: 'capabilities', name: 'acme_close_jobs', item: { name: 'acme_close_jobs', label: 'Clone' } },
] as const;

const manifest = (version: string, extra: Record<string, unknown> = {}) => ({
    id: PKG_ID, name: 'acme_field_service', type: 'app', version, ...extra,
});

/** The door over a real registry that holds `k`'s name as the environment's item. */
function rig(k: (typeof CASES)[number]) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.registerItem(k.type, { ...k.item });
    const kernel: any = {
        getService: (name: string) => (name === 'objectql' ? Promise.resolve({ registry }) : null),
        context: { getService: () => null },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const post = (body: unknown) => dispatcher.handlePackages('', 'POST', body, {}, PKG_ADMIN());
    return { registry, post };
}

function expectEnvironmentItemKept(registry: SchemaRegistry, k: (typeof CASES)[number]) {
    const kept = registry.getItem<Record<string, unknown>>(k.type, k.name);
    expect(kept?.label).toBe('Clone');
    expect(kept?._packageId).toBeUndefined();
}

describe('POST /api/v1/packages refuses a catalog collection at its body parse, before any write', () => {
    for (const k of CASES) {
        describe(k.type, () => {
            it(`a fresh install carrying \`${k.collection}\` is refused 400; nothing is installed`, async () => {
                const { registry, post } = rig(k);

                const out = await post({ manifest: manifest('1.0.0', { [k.collection]: [{ ...k.item, label: 'Vendor' }] }) });

                expect(out.handled).toBe(true);
                expect(out.response?.status, JSON.stringify(out.response?.body)).toBe(400);
                // The body parse's refusal, naming the collection key — not the catalog rule's.
                expect(out.response?.body?.error?.code).toBe('VALIDATION_ERROR');
                expect(out.response?.body?.error?.message).toContain(k.collection);
                expect(registry.getPackage(PKG_ID)).toBeUndefined();
                expectEnvironmentItemKept(registry, k);
            });

            it(`an overwrite carrying \`${k.collection}\` is refused 400; the installed version stands`, async () => {
                const { registry, post } = rig(k);
                expect((await post({ manifest: manifest('1.0.0') })).response?.status).toBe(201);

                const out = await post({ manifest: manifest('2.0.0', { [k.collection]: [{ ...k.item, label: 'Vendor' }] }), overwrite: true });

                expect(out.response?.status, JSON.stringify(out.response?.body)).toBe(400);
                expect(out.response?.body?.error?.message).toContain(k.collection);
                expect(registry.getPackage(PKG_ID)?.manifest?.version).toBe('1.0.0');
                expectEnvironmentItemKept(registry, k);
            });

            it('CONTROL — the same manifests without the collection install, fresh and as an overwrite', async () => {
                const { registry, post } = rig(k);

                expect((await post({ manifest: manifest('1.0.0') })).response?.status).toBe(201);
                const overwrite = await post({ manifest: manifest('2.0.0'), overwrite: true });

                expect(overwrite.response?.status, JSON.stringify(overwrite.response?.body)).toBe(201);
                expect(registry.getPackage(PKG_ID)?.manifest?.version).toBe('2.0.0');
                expectEnvironmentItemKept(registry, k);
            });
        });
    }
});
