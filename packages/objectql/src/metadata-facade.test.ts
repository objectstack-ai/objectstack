// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry';
import { MetadataFacade } from './metadata-facade';

describe('MetadataFacade provenance passthrough', () => {
    let registry: SchemaRegistry;
    let facade: MetadataFacade;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        facade = new MetadataFacade(registry);
    });

    it('passes the item\'s own _packageId through to registerItem so _provenance is stamped', async () => {
        await facade.register('page', 'installed_apps', {
            name: 'installed_apps',
            _packageId: 'com.example.marketplace',
        });

        const item = registry.getItem<any>('page', 'installed_apps');
        expect(item).toBeDefined();
        expect(item._packageId).toBe('com.example.marketplace');
        expect(item._provenance).toBe('package');

        // listItems is what protocol.getMetaItems serves from — the stamp
        // must survive enumeration too.
        const listed = registry.listItems<any>('page');
        expect(listed).toHaveLength(1);
        expect(listed[0]._packageId).toBe('com.example.marketplace');
        expect(listed[0]._provenance).toBe('package');
    });

    it('leaves runtime-authored items (no _packageId) unstamped', async () => {
        await facade.register('page', 'my_user_page', { name: 'my_user_page' });

        const item = registry.getItem<any>('page', 'my_user_page');
        expect(item).toBeDefined();
        expect(item._packageId).toBeUndefined();
        expect(item._provenance).toBeUndefined();
    });

    it('never invents a synthetic package id for object registrations', async () => {
        await facade.register('object', 'task', {
            name: 'task',
            label: 'Task',
            fields: {},
        });

        // getItem('object', …) routes to the merged-object path, so read the
        // generic collection directly to inspect what register() stored.
        //
        // [#6725] The direct read is STILL the right instrument here, and for
        // the same reason as before: this pin is about the STORED document, and
        // the two object reads answer the contributor copy — which now exists,
        // and which deliberately does carry the `'sys_metadata'` sentinel (see
        // the round-trip suite below). Reading through `get('object', …)` would
        // silently retarget this assertion at the other document and stop
        // guarding what it was written to guard.
        const stored = (registry as any).metadata.get('object')?.get('task');
        expect(stored).toBeDefined();
        expect(stored._packageId).toBeUndefined();
        expect(stored._provenance).toBeUndefined();
    });

    it('keeps the stored document unstamped even when the contributor copy is stamped', async () => {
        // The hazard the copy in `registerObjectBothPlaces` exists for:
        // `applyProtection` stamps IN PLACE and `applySystemFields` returns its
        // input unchanged when there is nothing to inject (`systemFields: false`
        // takes that path), so a shared reference would leak the sentinel into
        // the entry the pin above guards.
        await facade.register('object', 'nothing_injected', {
            name: 'nothing_injected',
            label: 'No injection',
            fields: {},
            systemFields: false,
        });

        const stored = (registry as any).metadata.get('object')?.get('nothing_injected');
        expect(stored._packageId).toBeUndefined();
        expect(stored._provenance).toBeUndefined();

        // …while the contributor copy — a different document — is stamped.
        expect((registry.getObject('nothing_injected') as any)._packageId).toBe('sys_metadata');
    });
});

/**
 * [#6725] The write/read pin.
 *
 * `MetadataFacade.register('object', …)` wrote through `registerItem` into the
 * generic `metadata` map, while every one of this class's object reads resolves
 * from `objectContributors` — so an object written through the public facade was
 * not readable back through the public facade. `IMetadataService`
 * (`@objectstack/spec/contracts`) declares `getObject(name)` ≡
 * `get('object', name)` and its own conformance test round-trips a
 * `register('object', …)` through both members; this file is the gate for the
 * facade's half of that.
 *
 * Refs #6725, #6505 / PR #6723, #6808, ADR-0010, ADR-0029.
 */
describe('MetadataFacade object write/read round-trip', () => {
    let registry: SchemaRegistry;
    let facade: MetadataFacade;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        facade = new MetadataFacade(registry);
    });

    const taskDefinition = () => ({ name: 'task', label: 'Task', fields: {} });

    it('reads a registered object back through BOTH getObject and get', async () => {
        await facade.register('object', 'task', taskDefinition());

        const viaGetObject = await facade.getObject('task');
        const viaGet = await facade.get('object', 'task');

        // Anti-vacuity: before the fix both members answered `undefined`, which
        // an identity assertion alone would have called agreement.
        expect(viaGetObject).toBeDefined();
        expect((viaGetObject as any).name).toBe('task');
        expect((viaGetObject as any).label).toBe('Task');
        expect(viaGetObject).toBe(viaGet);
    });

    it('reads it back through the enumeration members too', async () => {
        await facade.register('object', 'task', taskDefinition());

        expect(await facade.exists('object', 'task')).toBe(true);
        expect(await facade.listNames('object')).toEqual(['task']);
        expect(await facade.listObjects()).toHaveLength(1);
        const listed = await facade.list('object');
        expect(listed.map((o: any) => o.name)).toEqual(['task']);
    });

    it('closes the same split for the plural `objects` spelling', async () => {
        // `registry.getItem` / `listItems` special-case both spellings to the
        // contributor path, so a write that handled only the singular left this
        // one broken in exactly the same way.
        await facade.register('objects', 'lead', { name: 'lead', label: 'Lead', fields: {} });

        expect(await facade.getObject('lead')).toBeDefined();
        expect(await facade.get('objects', 'lead')).toBeDefined();
        expect(await facade.get('object', 'lead')).toBeDefined();
    });

    it('serves the runtime-effective object, as the contract says it does', async () => {
        // #6505 / PR #6723: `getObject` answers the object as the engine runs
        // it, not the document its author wrote. The materialization seam is
        // `registerObject`'s, so it only runs now that the write reaches it.
        const multiTenantRegistry = new SchemaRegistry({ multiTenant: true });
        const multiTenantFacade = new MetadataFacade(multiTenantRegistry);

        await multiTenantFacade.register('object', 'task', taskDefinition());

        const effective = (await multiTenantFacade.getObject('task')) as any;
        expect(effective.fields.organization_id).toBeDefined();
        expect(effective.fields.created_at).toBeDefined();
    });

    it('registers a package-less object under the sentinel, not as an artifact', async () => {
        await facade.register('object', 'task', taskDefinition());

        const owner = registry.getObjectOwner('task');
        expect(owner?.packageId).toBe('sys_metadata');
        // ADR-0010: runtime-authored, so it must not read as code-shipped —
        // `getArtifactItem` is what write authorization consults.
        expect((registry.getObject('task') as any)._provenance).toBe('org');
        expect(registry.getArtifactItem('object', 'task')).toBeUndefined();
    });

    it('registers a package-stamped object under its own package id', async () => {
        await facade.register('object', 'crm_account', {
            name: 'crm_account',
            label: 'Account',
            fields: {},
            _packageId: 'com.example.crm',
        });

        expect(registry.getObjectOwner('crm_account')?.packageId).toBe('com.example.crm');
        const served = registry.getObject('crm_account') as any;
        expect(served._packageId).toBe('com.example.crm');
        expect(served._provenance).toBe('package');
        expect(registry.getArtifactItem('object', 'crm_account')).toBeDefined();
    });

    it('re-registering the same object replaces it rather than accumulating owners', async () => {
        await facade.register('object', 'task', taskDefinition());
        await facade.register('object', 'task', { ...taskDefinition(), label: 'Task v2' });

        expect(((await facade.getObject('task')) as any).label).toBe('Task v2');
        expect(registry.getObjectContributors('task')).toHaveLength(1);
        expect(await facade.listObjects()).toHaveLength(1);
    });

    it('refuses to claim an object another package owns, and writes nothing', async () => {
        registry.registerObject({ name: 'task', label: 'Owned', fields: {} } as never, 'com.example.owner');

        // ADR-0029 — one owner per object. The contributor write runs first
        // precisely so the refusal leaves the generic map untouched too.
        await expect(
            facade.register('object', 'task', { ...taskDefinition(), _packageId: 'com.example.other' }),
        ).rejects.toThrow(/already owned by package "com.example.owner"/);

        expect((registry as any).metadata.get('object')?.size ?? 0).toBe(0);
        expect(((await facade.getObject('task')) as any).label).toBe('Owned');
    });

    it('unregisters an object out of BOTH places it was written into', async () => {
        await facade.register('object', 'task', taskDefinition());
        expect(await facade.getObject('task')).toBeDefined();

        await facade.unregister('object', 'task');

        // #6808: removing only the generic-map half left `getObject` — what the
        // data plane dispatches on — serving a deleted object for the life of
        // the process.
        expect(await facade.getObject('task')).toBeUndefined();
        expect(await facade.get('object', 'task')).toBeUndefined();
        expect(await facade.exists('object', 'task')).toBe(false);
        expect(await facade.listObjects()).toHaveLength(0);
        expect((registry as any).metadata.get('object')?.get('task')).toBeUndefined();
    });

    it('unregistering an object nothing registered stays a no-op', async () => {
        await expect(facade.unregister('object', 'absent')).resolves.toBeUndefined();
    });
});
