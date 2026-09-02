// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/packages` read doors must never hand back a response that cannot be
 * serialised.
 *
 * ## What was wrong
 *
 * On a stock showcase boot, signed in as the seeded admin:
 *
 *     GET /api/v1/packages                          -> 500 INTERNAL_ERROR
 *     GET /api/v1/packages/com.example.showcase     -> 500 INTERNAL_ERROR
 *     GET /api/v1/meta/package/com.example.showcase -> 500
 *     GET /api/v1/meta/package/com.objectstack.setup -> 200
 *
 * with `Converting circular structure to JSON · _ObjectQL -> actionActivation ->
 * store -> engine`. `SchemaRegistry.installPackage` stored the caller's live
 * `defineStack()` object, whose `plugins: [...]` hold initialised plugin
 * instances and through them the engine. Studio asks for the list three times
 * per open.
 *
 * ## Which door this file drives, and why that matters
 *
 * ⚠️ Measured on the failing boot rather than assumed: `GET /api/v1/packages`
 * and `GET /api/v1/packages/:id` are answered by THIS handler
 * (`handlePackagesRequest`), not by the same-pattern routes in
 * `packages/rest/src/package-routes.ts`. The 404 wording decides it —
 * `Package 'x' not found` (this file) against `Package "x" was not found.`
 * (the REST twin) — and a live probe returned the former.
 *
 * ## Two different claims, pinned separately
 *
 * 1. THE FIX, at the producer: with a real `SchemaRegistry` holding a
 *    showcase-shaped manifest, both doors answer 200 and their bodies
 *    round-trip. Remove `toRecordManifest` from `installPackage` and these go
 *    red with the exact `Converting circular structure to JSON` this card is
 *    about.
 * 2. THE DEFENCE, at this door: an undeclared member appearing on the registry
 *    ITEM — not the manifest — degrades to a field the response never mentions,
 *    instead of failing the whole read. That is what `{ ...pkg }` could not do:
 *    one bad member on one package took out the list for every caller.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

/** Authenticated caller holding the ADR-0106 D4 read capability. */
const reader = (): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['studio.access'] },
});

/** The engine's own `actionActivation -> store -> engine` cycle, reproduced. */
function cyclicEngine(): Record<string, unknown> {
    const engine: Record<string, unknown> = { name: '_ObjectQL' };
    const store: Record<string, unknown> = { name: 'ObjectStoreActionActivationStore', engine };
    engine.actionActivation = { name: 'ActionActivationProjection', store };
    return engine;
}

/** A host-constructed connector plugin that takes the engine on init. */
class FakeConnectorPlugin {
    name = 'connector-rest';
    engine: unknown;
    init(engine: unknown) { this.engine = engine; }
}

/**
 * A registry in the showcase's shape: one app package whose manifest carries
 * live, initialised plugin instances, plus one plugin-less platform package
 * (the `com.objectstack.setup` that kept answering 200 throughout).
 */
function showcaseShapedRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';

    const plugin = new FakeConnectorPlugin();
    registry.installPackage({
        id: 'com.example.showcase',
        name: 'Showcase',
        namespace: 'showcase',
        version: '0.3.16',
        type: 'app',
        scope: 'user',
        description: 'Kitchen-sink showcase workspace',
        objects: [{ name: 'invoice', fields: { total: { type: 'currency' } } }],
        apps: [{ name: 'showcase', label: 'Showcase' }],
        plugins: [plugin],
    } as any);
    // Init AFTER install — the measured ordering: the manifest serialised
    // cleanly during boot and only became cyclic once the plugins came up.
    plugin.init(cyclicEngine());

    registry.installPackage({
        id: 'com.objectstack.setup',
        name: 'Setup',
        namespace: 'setup',
        version: '9.3.0',
        type: 'plugin',
        scope: 'system',
    } as any);

    return registry;
}

function dispatcherOver(registry: SchemaRegistry): HttpDispatcher {
    const kernel: any = {
        context: { getService: (n: string) => (n === 'objectql' ? { registry } : null) },
    };
    return new HttpDispatcher(kernel);
}

describe('/packages read doors — the response always serialises', () => {
    it('GET /packages answers 200 over a showcase-shaped registry and round-trips', async () => {
        const registry = showcaseShapedRegistry();
        const r = await dispatcherOver(registry).handlePackages('/', 'GET', undefined, {}, reader());

        expect(r.response?.status).toBe(200);
        // The exact step the HTTP layer takes next, and the one that threw.
        expect(() => JSON.stringify(r.response?.body)).not.toThrow();

        const packages = r.response?.body?.data?.packages;
        expect(packages).toHaveLength(2);
        expect(r.response?.body?.data?.total).toBe(2);
        expect(packages.map((p: any) => p.manifest.id).sort())
            .toEqual(['com.example.showcase', 'com.objectstack.setup']);
    });

    it('GET /packages/:id answers 200 for the package that carried the cycle', async () => {
        const registry = showcaseShapedRegistry();
        const r = await dispatcherOver(registry)
            .handlePackages('/com.example.showcase', 'GET', undefined, {}, reader());

        expect(r.response?.status).toBe(200);
        expect(() => JSON.stringify(r.response?.body)).not.toThrow();
        expect(r.response?.body?.data?.manifest?.id).toBe('com.example.showcase');
    });

    it('serves the declared record fields, and no engine reference among them', () => {
        // Guards the OTHER direction of the projection: dropping the runtime
        // half must not cost the record the lifecycle half the doors publish.
        const registry = showcaseShapedRegistry();
        const record: any = registry.getPackage('com.example.showcase');
        expect(record.status).toBe('installed');
        expect(record.enabled).toBe(true);
        expect(JSON.stringify(record)).not.toContain('_ObjectQL');
    });

    it('an undeclared LIVE member on the registry item degrades to a missing field', async () => {
        // The door's own defence, independent of the producer's repair: this
        // member is on the ITEM, not inside the manifest, so no projection at
        // install time can reach it.
        const registry = showcaseShapedRegistry();
        (registry.getPackage('com.example.showcase') as any).liveEngineHandle = cyclicEngine();

        const list = await dispatcherOver(registry).handlePackages('/', 'GET', undefined, {}, reader());
        expect(list.response?.status).toBe(200);
        expect(() => JSON.stringify(list.response?.body)).not.toThrow();
        expect(list.response?.body?.data?.packages
            .some((p: any) => 'liveEngineHandle' in p)).toBe(false);

        const detail = await dispatcherOver(registry)
            .handlePackages('/com.example.showcase', 'GET', undefined, {}, reader());
        expect(detail.response?.status).toBe(200);
        expect(() => JSON.stringify(detail.response?.body)).not.toThrow();
        expect('liveEngineHandle' in detail.response?.body?.data).toBe(false);
        // …and the declared half is untouched by the drop.
        expect(detail.response?.body?.data?.manifest?.id).toBe('com.example.showcase');
        expect(detail.response?.body?.data?.status).toBe('installed');
    });

    it('a genuine MISS is still a 404 with the wording this door owns', async () => {
        // Both directions: the projection must not turn "absent" into "present
        // but empty", and the wording is what identifies which door answered.
        const r = await dispatcherOver(showcaseShapedRegistry())
            .handlePackages('/no.such.package', 'GET', undefined, {}, reader());
        expect(r.response?.status).toBe(404);
        expect(r.response?.body?.error?.message).toBe("Package 'no.such.package' not found");
    });
});
