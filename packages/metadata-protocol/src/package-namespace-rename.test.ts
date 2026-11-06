// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30794] The rename engine alone — `planNamespaceRename`, the pure function
 * both copy doors call. The doors' own pins live beside their harnesses: the
 * duplicate's in the objectql `protocol-duplicate-package-*` battery, the
 * unmanaged import's (and the parity of the two) in
 * `package-unmanaged-install.test.ts`. What is pinned here is what no door can
 * reach: the engine does not trust its caller's judgement of the names.
 */
import { describe, expect, it } from 'vitest';
import {
    METADATA_ITEM_NAME_STORAGE_LIMIT,
    OBJECT_TABLE_IDENTIFIER_LIMIT,
    planNamespaceRename,
} from './package-namespace-rename.js';

const items = [
    { type: 'object', name: 'crm_lead', body: { name: 'crm_lead', fields: { title: { name: 'title', type: 'text' } } } },
    { type: 'view', name: 'crm_lead.board', body: { name: 'crm_lead.board', object: 'crm_lead' } },
    { type: 'translation', name: 'crm_en', body: { name: 'crm_en', locale: 'en', objects: { crm_lead: { label: 'Lead' } } } },
];

describe('planNamespaceRename — the one rename engine (#30794)', () => {
    it('reads its storage limits off their declarations: the table identifier, and the `sys_metadata.name` column', () => {
        expect(OBJECT_TABLE_IDENTIFIER_LIMIT).toBe(63);
        expect(METADATA_ITEM_NAME_STORAGE_LIMIT).toBe(255);
    });

    it('a copy name the item grammar refuses is refused, naming the item — the engine does not trust its caller', () => {
        // No door hands the engine a namespace its declaration refuses; the engine judges the copy name anyway.
        const rename = planNamespaceRename({
            sourcePackageId: 'com.example.crm', sourceNamespace: 'crm', targetNamespace: 'Acme', items, retryVerb: 'install',
        });
        expect(rename.copyName('object', 'crm_lead')).toBe('Acme_lead');
        expect(rename.copyNameRefusal('object', 'crm_lead'))
            .toContain("Object 'crm_lead' is not copied: its copy name 'Acme_lead' in namespace 'Acme' is not a legal metadata item name");
        expect(rename.copyNameRefusal('view', 'crm_lead.board')).toContain("View 'crm_lead.board' is not copied");
    });

    it('an item the copy does not rename is never refused by name, whatever its length', () => {
        const long = `ext_${'x'.repeat(70)}`;
        const rename = planNamespaceRename({
            sourcePackageId: 'com.example.crm', sourceNamespace: 'crm', targetNamespace: 'acme',
            items: [...items, { type: 'object', name: long, body: {} }], retryVerb: 'install',
        });
        // `ext_…` lacks the source prefix, so it takes the target prefix in front — a rename, judged.
        expect(rename.copyNameRefusal('object', long)).toContain('storage identifier limit');
        // A view of an object outside the package keeps its name, so nothing is judged.
        expect(rename.copyName('view', `other_${'y'.repeat(300)}.board`)).toBe(`other_${'y'.repeat(300)}.board`);
        expect(rename.copyNameRefusal('view', `other_${'y'.repeat(300)}.board`)).toBeUndefined();
    });

    it('the remedy names the door: "then duplicate again" for the duplicate, "then install again" for the import', () => {
        const withBare = [...items, { type: 'object', name: 'lead', body: {} }];
        const duplicate = planNamespaceRename({
            sourcePackageId: 'com.example.crm', sourceNamespace: 'crm', targetNamespace: 'acme', items: withBare, retryVerb: 'duplicate',
        });
        const install = planNamespaceRename({
            sourcePackageId: 'com.example.crm', sourceNamespace: 'crm', targetNamespace: 'acme', items: withBare, retryVerb: 'install',
        });
        expect(duplicate.objectRefusal('lead')).toMatch(/then duplicate again\.$/);
        expect(install.objectRefusal('lead')).toMatch(/then install again\.$/);
        expect(install.objectRefusal('crm_lead')).toBeUndefined();
    });

    it('a view named by its object follows the object whole — a bare object\'s container included', () => {
        const rename = planNamespaceRename({
            sourcePackageId: 'com.example.crm', sourceNamespace: 'crm', targetNamespace: 'acme',
            items: [...items, { type: 'object', name: 'ticket', body: {} }, { type: 'view', name: 'ticket', body: { object: 'ticket' } }],
            retryVerb: 'install',
        });
        // The prefix swap kept `ticket`, while the container's `object` follows the copy to `acme_ticket`.
        expect(rename.copyName('view', 'ticket')).toBe('acme_ticket');
        expect(rename.copyName('views', 'ticket')).toBe('acme_ticket');
        expect(rename.rewrite('view', 'ticket', { object: 'ticket' })).toEqual({ item: { name: 'acme_ticket', object: 'acme_ticket' } });
        // A prefixed object's container: the name the swap gave already.
        expect(rename.copyName('view', 'crm_lead')).toBe('acme_lead');
        // NEGATIVE CONTROL: a bare name that is no object of the package keeps it, and so does a non-view row.
        expect(rename.copyName('view', 'board')).toBe('board');
        expect(rename.copyName('action', 'ticket')).toBe('ticket');
    });

    it('rewrites a body: names, the reference site, a record key, and `name` set to the copy name', () => {
        const rename = planNamespaceRename({
            sourcePackageId: 'com.example.crm', sourceNamespace: 'crm', targetNamespace: 'acme', items, retryVerb: 'install',
        });
        expect(rename.rewrite('view', 'crm_lead.board', items[1]!.body)).toEqual({
            item: { name: 'acme_lead.board', object: 'acme_lead' },
        });
        expect(rename.rewrite('translation', 'crm_en', items[2]!.body)).toEqual({
            item: { name: 'acme_en', locale: 'en', objects: { acme_lead: { label: 'Lead' } } },
        });
    });
});
