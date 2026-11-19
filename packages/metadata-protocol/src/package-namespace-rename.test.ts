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
    type NamespaceRenameItem,
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

describe('planNamespaceRename — a copied capability, and every grant and requirement of it (#35157)', () => {
    // The shape an AI-built app writes: the package DECLARES its capability,
    // a set GRANTS it, an action and an object REQUIRE it (ADR-0066 D1).
    const app: NamespaceRenameItem[] = [
        { type: 'object', name: 'demoasset_asset', body: {
            name: 'demoasset_asset',
            requiredPermissions: { delete: ['demoasset.manage_assets'], read: ['view_reports'] },
            fields: {},
        } },
        { type: 'capability', name: 'demoasset.manage_assets', body: { name: 'demoasset.manage_assets', label: 'Manage assets', scope: 'org' } },
        { type: 'capability', name: 'demoasset_decide_scrap', body: { name: 'demoasset_decide_scrap', label: 'Decide scrap' } },
        { type: 'capability', name: 'audit_trail', body: { name: 'audit_trail', label: 'Audit trail' } },
        { type: 'permission', name: 'demoasset_manager', body: {
            name: 'demoasset_manager',
            objects: { demoasset_asset: { allowRead: true } },
            systemPermissions: ['demoasset.manage_assets', 'demoasset_decide_scrap', 'manage_users'],
        } },
        { type: 'action', name: 'demoasset_scrap', body: {
            name: 'demoasset_scrap', objectName: 'demoasset_asset', requiredPermissions: ['demoasset_decide_scrap'],
        } },
    ];
    const plan = (targetNamespace: string, items = app) => planNamespaceRename({
        sourcePackageId: 'com.demo.asset', sourceNamespace: 'demoasset', targetNamespace, items, retryVerb: 'install',
    });

    it('a capability the package names with its prefix takes the target prefix, in either separator', () => {
        const rename = plan('trial1');
        expect(rename.copyName('capability', 'demoasset.manage_assets')).toBe('trial1.manage_assets');
        expect(rename.copyName('capabilities', 'demoasset.manage_assets')).toBe('trial1.manage_assets');
        expect(rename.copyName('capability', 'demoasset_decide_scrap')).toBe('trial1_decide_scrap');
        expect(rename.rewrite('capability', 'demoasset.manage_assets', app[1]!.body))
            .toEqual({ item: { name: 'trial1.manage_assets', label: 'Manage assets', scope: 'org' } });
    });

    it('every grant and requirement of a renamed capability follows it — and nothing else moves', () => {
        const rename = plan('trial1');
        const set = rename.rewrite('permission', 'demoasset_manager', app[4]!.body);
        // The platform capability the set also grants is not the package's, so it keeps its name.
        expect((set as { item: any }).item.systemPermissions).toEqual(['trial1.manage_assets', 'trial1_decide_scrap', 'manage_users']);
        const action = rename.rewrite('action', 'demoasset_scrap', app[5]!.body);
        expect((action as { item: any }).item.requiredPermissions).toEqual(['trial1_decide_scrap']);
        // An object's per-operation map follows too; `view_reports` (a platform name) does not move.
        const object = rename.rewrite('object', 'demoasset_asset', app[0]!.body);
        expect((object as { item: any }).item.requiredPermissions)
            .toEqual({ delete: ['trial1.manage_assets'], read: ['view_reports'] });
    });

    it('a capability declared WITHOUT the source prefix keeps its name — the save door refuses a second holder', () => {
        const rename = plan('trial1');
        expect(rename.copyName('capability', 'audit_trail')).toBe('audit_trail');
    });

    it('CONTROL: a copy that keeps the source namespace renames no capability', () => {
        const rename = plan('demoasset');
        expect(rename.copyName('capability', 'demoasset.manage_assets')).toBe('demoasset.manage_assets');
        const set = rename.rewrite('permission', 'demoasset_manager', app[4]!.body);
        expect((set as { item: any }).item.systemPermissions).toEqual(['demoasset.manage_assets', 'demoasset_decide_scrap', 'manage_users']);
    });

    it('a copy name another capability of the package declares is refused at its own name — two gates never merge', () => {
        const rename = plan('trial1', [
            ...app,
            { type: 'capability', name: 'trial1.manage_assets', body: { name: 'trial1.manage_assets' } },
        ]);
        const refused = rename.rewrite('capability', 'demoasset.manage_assets', app[1]!.body);
        expect(refused).toEqual({ refusal: expect.stringContaining("Capability 'demoasset.manage_assets' is not copied") });
        expect((refused as { refusal: string }).refusal).toMatch(/then install again\.$/);
    });
});

