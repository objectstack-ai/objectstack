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

/**
 * [#7519] `content` is a REAL authorable field, not this facade's storage
 * envelope.
 *
 * Every read member used to unwrap `item?.content ?? item`, presuming
 * `content` marked the facade's own wrapper — but `doc.zod.ts` (raw Markdown)
 * and `knowledge-document.zod.ts` both declare `content` as an authored
 * field, so a doc registered through the facade read back as its Markdown
 * STRING: truthy and string-typed, so nothing threw and downstream `?.name`
 * reads silently yielded `undefined`. That is the silent non-round-trip the
 * #7378 ruling (2026-08-12) forbids: `register(t, n, d)` → `get(t, n)`
 * round-trips or refuses loudly.
 *
 * The envelope the unwrap presumed has NO producer (measured on `main`, not
 * assumed — the full ledger is in `get`'s header in metadata-facade.ts), so
 * the fix removes the unwrap rather than renaming the envelope key: any
 * replacement key would merely reschedule this collision onto the next
 * authorable field.
 */
describe('MetadataFacade reads return the stored document, not its `content` field (#7519)', () => {
    let registry: SchemaRegistry;
    let facade: MetadataFacade;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        facade = new MetadataFacade(registry);
    });

    const MARKDOWN = '# Getting started\n\nWrite your first object.';
    const docDocument = () => ({
        name: 'getting_started',
        label: 'Getting started',
        content: MARKDOWN,
    });

    it('get returns the registered doc document, not its Markdown string', async () => {
        await facade.register('doc', 'getting_started', docDocument());

        const got = (await facade.get('doc', 'getting_started')) as any;
        // The defect shape was `got === MARKDOWN` — truthy and defined, so a
        // bare toBeDefined() would have passed. Assert the DOCUMENT came back.
        expect(got).toBeDefined();
        expect(got).not.toBe(MARKDOWN);
        expect(got.name).toBe('getting_started');
        expect(got.content).toBe(MARKDOWN);
    });

    it('list returns doc documents, not Markdown strings', async () => {
        await facade.register('doc', 'getting_started', docDocument());
        await facade.register('doc', 'faq', { name: 'faq', content: '# FAQ' });

        const listed = (await facade.list('doc')) as any[];
        expect(listed).toHaveLength(2);
        expect(listed.map((d) => d?.name).sort()).toEqual(['faq', 'getting_started']);
        expect(listed.every((d) => typeof d === 'object' && d !== null)).toBe(true);
    });

    it('listNames reads names off the documents themselves', async () => {
        await facade.register('doc', 'getting_started', docDocument());

        expect(await facade.listNames('doc')).toEqual(['getting_started']);
    });

    it('exists and getEntry agree the document is there, whole', async () => {
        await facade.register('doc', 'getting_started', docDocument());

        expect(await facade.exists('doc', 'getting_started')).toBe(true);
        const entry = facade.getEntry('doc', 'getting_started') as any;
        expect(entry.content).toBe(MARKDOWN);
    });

    it('a knowledge_document with a `content` field round-trips whole too', async () => {
        // The second live type the issue names (knowledge-document.zod.ts) —
        // pinned so the fix cannot be read as doc-specific.
        await facade.register('knowledge_document', 'onboarding_kb', {
            name: 'onboarding_kb',
            content: 'Answer the onboarding questions from this corpus.',
        });

        const got = (await facade.get('knowledge_document', 'onboarding_kb')) as any;
        expect(got.name).toBe('onboarding_kb');
        expect(typeof got.content).toBe('string');
    });

    it('a document WITHOUT a `content` field still round-trips unchanged (the surviving path)', async () => {
        // The other direction pinned: removing the unwrap must not trade one
        // class of correct read for another. Content-less items were read
        // correctly before this fix (the `??` fell through) and must stay so.
        await facade.register('view', 'plain_view', { name: 'plain_view', label: 'Plain', type: 'grid' });

        const got = (await facade.get('view', 'plain_view')) as any;
        expect(got).toMatchObject({ name: 'plain_view', label: 'Plain', type: 'grid' });
        expect(await facade.listNames('view')).toEqual(['plain_view']);
    });
});
