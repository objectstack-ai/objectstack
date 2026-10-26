// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25744] An object's OWN `actions`, registered by a code package through
 * {@link SchemaRegistry.registerObject}, are stored as their `ActionSchema`
 * parse — the parse a standalone `action` item is stored as since #25649 — so a
 * declared `requiresFeature` / `requiresMembershipReach` is lowered into
 * `visible`, and an action that does not parse is refused (`INVALID_METADATA`,
 * 422) before anything of the object is stored.
 *
 * Before, a raw manifest or a `strict: false` stack registered with
 * `ObjectQL.registerApp` stored its objects' actions as written: served by
 * `GET /api/v1/meta/objects/:name` (`protocol.getMetaItem({ type: 'object' })`)
 * with `requiresFeature` riding along raw and no `visible` — a feature gate no
 * reader enforces. A strict `defineStack`, `os validate` and the metadata save
 * door already parse the same body through `ActionSchema`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema } from '@objectstack/spec/data';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

/** One gated declaration, authored on an object's own action. */
const GATED = {
    name: 'gated', label: 'Gated', type: 'url' as const, target: 'https://example.com/gated',
    locations: ['record_header' as const], visible: "record.name != ''",
    requiresFeature: 'multiOrgEnabled' as const,
};
const LOWERED = { dialect: 'cel', source: "(record.name != '') && features.multiOrgEnabled != false" };

const objectWith = (actions: unknown[]) => ({
    name: 'oa_org', label: 'Org',
    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
    actions,
});
const rawManifest = (actions: unknown[]) => ({ id: 'com.test.raw', name: 'raw', objects: [objectWith(actions)] });

/** A driver that holds nothing: the reads below never reach a stored row. */
const emptyDriver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find() { return []; }, async findOne() { return null; }, async count() { return 0; },
};

/** The stored-metadata family the by-name read consults for an overlay row (none here). */
const sysMetadataObject = {
    name: 'sys_metadata', label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        state: { name: 'state', label: 'State', type: 'text' as const },
    },
};

async function host() {
    const engine = new ObjectQL();
    engine.registerDriver(emptyDriver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject);
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any);
    return { engine, protocol: new ObjectStackProtocolImplementation(engine) };
}

const servedAction = async (protocol: ObjectStackProtocolImplementation, name: string) => {
    const served: any = await protocol.getMetaItem({ type: 'object', name: 'oa_org' } as any);
    return (served.item.actions as any[]).find((a) => a?.name === name);
};

const refusalOf = (fn: () => unknown): any => {
    try { fn(); } catch (e) { return e; }
    return undefined;
};

describe("an object's own action is stored as its ActionSchema parse", () => {
    it('a raw manifest: GET /meta/object/<name> serves `requiresFeature` lowered into `visible`', async () => {
        const { engine, protocol } = await host();
        engine.registerApp(rawManifest([GATED]));
        const served = await servedAction(protocol, 'gated');
        expect(served.visible).toEqual(LOWERED);
        expect(served).not.toHaveProperty('requiresFeature');
        // The same lowering `ObjectSchema.create` gives a platform object's action of the same declaration.
        const authored: any = ObjectSchema.create(objectWith([GATED]) as any);
        expect(served.visible).toEqual(authored.actions[0].visible);
        // The registry's own resolved object holds the same parsed body.
        expect(engine.registry.getObject('oa_org')?.actions?.[0]).toEqual(served);
    });

    it('an action with no `visible` of its own is served the gate alone', async () => {
        const { visible: _visible, ...ungated } = GATED;
        const { engine, protocol } = await host();
        engine.registerApp(rawManifest([ungated]));
        const served = await servedAction(protocol, 'gated');
        expect(served.visible).toEqual({ dialect: 'cel', source: 'features.multiOrgEnabled != false' });
        expect(served).not.toHaveProperty('requiresFeature');
    });

    it('`requiresMembershipReach` is lowered the same way', async () => {
        const { requiresFeature: _feature, ...rest } = GATED;
        const { engine, protocol } = await host();
        engine.registerApp(rawManifest([{ ...rest, requiresMembershipReach: 'invite_member' }]));
        const served = await servedAction(protocol, 'gated');
        expect(served).not.toHaveProperty('requiresMembershipReach');
        expect(served.visible).toEqual(ObjectSchema.create(objectWith([{ ...rest, requiresMembershipReach: 'invite_member' }]) as any).actions![0].visible);
    });

    it('a `strict: false` stack registered with registerApp is parsed at the registry', async () => {
        const stack: any = defineStack({
            manifest: { id: 'com.test.loose', name: 'loose', version: '1.0.0', type: 'app' },
            objects: [objectWith([GATED])],
        } as any, { strict: false });
        // The loose stack hands the body on as written.
        expect(stack.objects[0].actions[0]).toHaveProperty('requiresFeature');
        const { engine, protocol } = await host();
        engine.registerApp({ ...stack, ...stack.manifest });
        const served = await servedAction(protocol, 'gated');
        expect(served.visible).toEqual(LOWERED);
        expect(served).not.toHaveProperty('requiresFeature');
    });

    it('a direct registerObject under a package is parsed; the caller\'s body is not mutated', async () => {
        const { engine } = await host();
        const def = objectWith([structuredClone(GATED)]);
        engine.registry.registerObject(def as any, 'com.test.direct');
        expect(engine.registry.getObject('oa_org')?.actions?.[0]).toMatchObject({ visible: LOWERED });
        expect(def.actions[0]).toHaveProperty('requiresFeature', 'multiOrgEnabled');
    });

    it('control: an object a strict parse already produced is stored deep-equal to what it arrived as', async () => {
        const authored: any = ObjectSchema.create(objectWith([GATED]) as any);
        const { engine, protocol } = await host();
        engine.registerApp({ id: 'com.test.strict', name: 'strict', objects: [structuredClone(authored)] });
        expect(await servedAction(protocol, 'gated')).toEqual(authored.actions[0]);
    });

    it('an action that does not parse is refused loudly, naming the action, its object and package — nothing stored', async () => {
        const { engine } = await host();
        const err = refusalOf(() => engine.registerApp(rawManifest([{ ...GATED, visible: false }])));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(err.message).toContain("Action 'gated' of object 'oa_org' in package 'com.test.raw' does not satisfy the action contract");
        expect(err.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'actions.0.requiresFeature' })]));
        expect(engine.registry.getObject('oa_org')).toBeUndefined();
    });

    it('a refused re-registration leaves the object already registered under that package in place', async () => {
        const { engine } = await host();
        engine.registerApp(rawManifest([GATED]));
        const err = refusalOf(() => engine.registry.registerObject(objectWith([{ ...GATED, bogus: true }]) as any, 'com.test.raw'));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unrecognized_keys' })]));
        expect(engine.registry.getObject('oa_org')?.actions?.[0]).toMatchObject({ name: 'gated', visible: LOWERED });
    });
});
