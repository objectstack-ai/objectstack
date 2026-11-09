// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D6, child K] A namespace never equals an object name — at the two
 * runtime package doors Studio drives, in both directions, each answering
 * `422 NAMESPACE_CONFLICT` and naming both spellings:
 *
 *  - `POST /api/v1/packages` (create): a NEW package whose namespace equals an
 *    object name the deployment already holds. The door reaches
 *    `SchemaRegistry.installPackage`, whose refusal this is.
 *  - `POST /api/v1/packages/:id/publish` (Studio "全部发布"): a package whose
 *    object, about to go live through `MetadataManager.publishPackage`, equals
 *    an installed package's namespace, or is short-named `custom`. The door
 *    judges before the metadata service publishes (that class has no
 *    manifest), with the protocol's publish doors' judge.
 *
 * Real: `HttpDispatcher.handlePackages`, `SchemaRegistry`, `MetadataManager`.
 * Doubled: only the kernel's service lookup.
 */

import { describe, expect, it } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { MemoryLoader, MetadataManager } from '@objectstack/metadata';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { HttpDispatcher } from './http-dispatcher.js';

const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

const ALPHA = 'com.acme.alpha';
const BETA = 'com.acme.beta';

const manifest = (id: string, namespace: string) => ({ id, name: id, namespace, version: '1.0.0', type: 'app' });

function freshRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    return registry;
}

function freshMetadata(): MetadataManager {
    const manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
    manager.setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY);
    return manager;
}

function makeDoor(registry: SchemaRegistry, metadata?: MetadataManager) {
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'objectql') return Promise.resolve({ registry });
            if (name === 'metadata' && metadata) return Promise.resolve(metadata);
            return null;
        },
        context: { getService: () => null },
    };
    return new HttpDispatcher(kernel);
}

const objectDef = (name: string) => ({ name, label: name, fields: { title: { name: 'title', label: 'Title', type: 'text' } } }) as any;

describe('POST /packages — a NEW namespace equal to an installed object name', () => {
    it('is refused 422 NAMESPACE_CONFLICT, naming both spellings, and nothing installs', async () => {
        const registry = freshRegistry();
        registry.installPackage(manifest(ALPHA, 'crm') as any, 'authored');
        registry.registerObject(objectDef('crm_lead'), ALPHA, 'crm');
        const dispatcher = makeDoor(registry);

        const refused = await dispatcher.handlePackages('', 'POST', manifest(BETA, 'crm_lead'), {}, PKG_ADMIN());
        expect(refused.response?.status, JSON.stringify(refused.response?.body)).toBe(422);
        expect(refused.response?.body?.error?.code).toBe('NAMESPACE_CONFLICT');
        expect(refused.response?.body?.error?.message).toContain(`Namespace 'crm_lead' of package '${BETA}'`);
        expect(refused.response?.body?.error?.message).toContain(`the object 'crm_lead' of package '${ALPHA}'`);
        expect(registry.getPackage(BETA)).toBeUndefined();
    });

    it('CONTROL — a namespace only STARTING with an object name installs', async () => {
        const registry = freshRegistry();
        registry.installPackage(manifest(ALPHA, 'crm') as any, 'authored');
        registry.registerObject(objectDef('crm_lead'), ALPHA, 'crm');
        const dispatcher = makeDoor(registry);

        const created = await dispatcher.handlePackages('', 'POST', manifest(BETA, 'crm_lead_x'), {}, PKG_ADMIN());
        expect(created.response?.status, JSON.stringify(created.response?.body)).toBe(201);
    });
});

describe('POST /packages/:id/publish — a package object equal to an installed namespace', () => {
    const setup = async (objectName: string) => {
        const registry = freshRegistry();
        registry.installPackage(manifest(BETA, 'crm_lead') as any, 'authored');
        registry.installPackage(manifest(ALPHA, 'crm') as any, 'authored');
        const metadata = freshMetadata();
        await metadata.register('object', objectName, {
            name: objectName, label: objectName, packageId: ALPHA, state: 'draft', metadata: { fields: {} },
        });
        return { registry, metadata, dispatcher: makeDoor(registry, metadata) };
    };
    const publish = (dispatcher: HttpDispatcher) =>
        dispatcher.handlePackages(`/${ALPHA}/publish`, 'POST', {}, {}, PKG_ADMIN());

    it('is refused 422 NAMESPACE_CONFLICT before anything publishes, naming both spellings', async () => {
        const { metadata, dispatcher } = await setup('crm_lead');
        const refused = await publish(dispatcher);
        expect(refused.response?.status, JSON.stringify(refused.response?.body)).toBe(422);
        expect(refused.response?.body?.error?.code).toBe('NAMESPACE_CONFLICT');
        expect(refused.response?.body?.error?.message).toContain(`The object 'crm_lead' of package '${ALPHA}'`);
        expect(refused.response?.body?.error?.message).toContain(`installed namespace 'crm_lead' of package '${BETA}'`);
        expect(((await metadata.get('object', 'crm_lead')) as any)?.state).toBe('draft');
    });

    it('an object short-named `custom` is refused the same way', async () => {
        const { dispatcher } = await setup('crm_custom');
        const refused = await publish(dispatcher);
        expect(refused.response?.status).toBe(422);
        expect(refused.response?.body?.error?.code).toBe('NAMESPACE_CONFLICT');
        expect(refused.response?.body?.error?.message).toContain("short-named 'custom'");
    });

    it('CONTROL — an object only STARTING with an installed namespace publishes', async () => {
        const { metadata, dispatcher } = await setup('crm_lead_note');
        const published = await publish(dispatcher);
        expect(published.response?.status, JSON.stringify(published.response?.body)).toBe(200);
        expect(published.response?.body?.data?.success).toBe(true);
        expect(((await metadata.get('object', 'crm_lead_note')) as any)?.state).toBe('active');
    });
});
