// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9190] `findReferencesToMeta` end-to-end, over the DERIVED site index.
 *
 * The unit pins next door prove the index is derived. These prove the thing an
 * operator actually experiences: target types that answered "nothing depends on
 * this item — safe to delete" on every deployment, whatever was stored, now
 * answer with the dependents that exist.
 *
 * The empty state is not a metaphor. `objectui`'s metadata-admin renders it
 * verbatim as *"Nothing in the metadata graph points at this item. Safe to
 * delete."*, immediately before the rename or delete the panel exists to gate
 * (ADR-0110 D3, the #8896 harm shape).
 */

import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * Registry-backed stub. Reference scanning reads through `getMetaItems`, which
 * falls back to the registry when `sys_metadata` holds nothing — so seeding the
 * registry is enough, and nothing here needs a store.
 */
function protocolWith(items: Record<string, Array<Record<string, unknown>>>) {
    const engine: any = {
        async find() { return []; },
        async findOne() { return null; },
        async count() { return 0; },
        registry: {
            listItems: (type: string) => items[type] ?? [],
            getItem: () => undefined,
            getObject: () => undefined,
            isPackageDisabled: () => false,
            getPackage: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            applyNavContributions: (app: unknown) => app,
        },
    };
    return new ObjectStackProtocolImplementation(engine as never);
}

describe('[#9190] target types that were silent by construction now answer', () => {
    it('a permission set that grants on an object is found — through the record KEY', async () => {
        // `PermissionSetSchema.objects` is `z.record(objectName, …)`. The
        // curated table spelled it `objects[].name`, an array shape the schema
        // has never had, so `GET /meta/object/account/references` never once
        // mentioned a permission set. Deleting `account` looked free.
        const protocol = protocolWith({
            permission: [{
                name: 'sales_admin',
                label: 'Sales Admin',
                objects: { account: { allowRead: true }, contact: { allowRead: true } },
            }],
        });

        const result = await protocol.findReferencesToMeta({ type: 'object', name: 'account' });

        expect(result.references).toEqual([
            {
                type: 'permission',
                name: 'sales_admin',
                label: 'Sales Admin',
                path: 'objects{key}',
                kind: 'permission objects',
            },
        ]);
    });

    it("the card's own example — a `translation` target — resolves its doc", async () => {
        // #9157 pinned this answering `[]` and named it a COVERAGE question
        // rather than a spelling one. This is that question, closed: nobody
        // wrote `translation` into a table; `DocSchema.translations` is a
        // declared property and the walk reads it.
        const protocol = protocolWith({
            doc: [{ name: 'getting_started', label: 'Getting Started', translations: { greeting: { title: 'Hallo' } } }],
        });

        const result = await protocol.findReferencesToMeta({ type: 'translation', name: 'greeting' });

        expect(result.references).toEqual([
            {
                type: 'doc',
                name: 'getting_started',
                label: 'Getting Started',
                path: 'translations{key}',
                kind: 'doc translations',
            },
        ]);
    });

    it('a `dataset` target — never a curated key at all — resolves the widgets that chart it', async () => {
        const protocol = protocolWith({
            dashboard: [{ name: 'revenue', label: 'Revenue', widgets: [{ id: 'w1', dataset: 'orders_by_month' }] }],
            report: [{ name: 'q3', dataset: 'orders_by_month' }],
        });

        const result = await protocol.findReferencesToMeta({ type: 'dataset', name: 'orders_by_month' });

        expect(result.references.map((r) => `${r.type}:${r.name}:${r.path}`)).toEqual([
            'dashboard:revenue:widgets[].dataset',
            'report:q3:dataset',
        ]);
    });

    it('a reference nested inside a RECURSIVE container is found at any depth', async () => {
        // The reason the unit of derivation is a property and not a path.
        // `AppSchema.navigation[].children[]` is self-recursive, so no finite
        // path list can cover it — the curated table stopped at the top level
        // even for the paths it spelled correctly, and a view referenced from a
        // nested nav group was invisible.
        const protocol = protocolWith({
            app: [{
                name: 'crm',
                label: 'CRM',
                navigation: [{ label: 'Sales', children: [{ label: 'Pipeline', children: [{ viewName: 'deal_board' }] }] }],
            }],
        });

        const result = await protocol.findReferencesToMeta({ type: 'view', name: 'deal_board' });

        expect(result.references).toEqual([
            {
                type: 'app',
                name: 'crm',
                label: 'CRM',
                path: 'navigation[].children[].children[].viewName',
                kind: 'app viewName',
            },
        ]);
    });

    it('the highest-value edge survives the rewrite: an object whose field points at another object', async () => {
        // `FieldSchema.reference` — carried by `SEMANTIC_REFERENCE_SITES`
        // because its NAME does not spell its target. One of only six curated
        // paths that were live, and the one an admin most needs before a
        // delete. ⚠️ The curated table ALSO spelled it `fields{}.referenceTo`,
        // which `FieldSchema` does not declare; that limb is gone rather than
        // tolerated, because a consumer that accepts both spellings is how the
        // wrong one survives (contract-first).
        const protocol = protocolWith({
            object: [{
                name: 'task',
                label: 'Task',
                fields: { account_id: { name: 'account_id', type: 'lookup', reference: 'account' } },
            }],
        });

        const result = await protocol.findReferencesToMeta({ type: 'object', name: 'account' });

        expect(result.references).toEqual([
            {
                type: 'object',
                name: 'task',
                label: 'Task',
                path: 'fields.account_id.reference',
                kind: 'object reference',
            },
        ]);
    });
});

describe('[#9190] the widened scan does not start inventing dependents', () => {
    it('an item nothing points at still answers with an empty list', async () => {
        const protocol = protocolWith({
            view: [{ name: 'lead_list', object: 'lead' }],
            permission: [{ name: 'sales_admin', objects: { lead: { allowRead: true } } }],
        });

        const result = await protocol.findReferencesToMeta({ type: 'object', name: 'orphan' });

        expect(result.references).toEqual([]);
    });

    it('a value that merely LOOKS like the target name under a non-reference key is ignored', async () => {
        // The scan reads named properties, not every string in the document —
        // over-reporting is the safe direction here, but it is not a licence to
        // report a description that happens to contain the word.
        const protocol = protocolWith({
            view: [{ name: 'lead_list', label: 'account', description: 'account', object: 'lead' }],
        });

        const result = await protocol.findReferencesToMeta({ type: 'object', name: 'account' });

        expect(result.references).toEqual([]);
    });

    it('an item is not listed as its own dependent through a scalar self-reference', async () => {
        const protocol = protocolWith({ view: [{ name: 'account_list', object: 'account' }] });

        const result = await protocol.findReferencesToMeta({ type: 'view', name: 'account_list' });

        expect(result.references).toEqual([]);
    });
});
