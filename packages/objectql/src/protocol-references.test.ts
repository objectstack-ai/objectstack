// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';

/**
 * Phase 3a-references tests.
 *
 * Validates that findReferencesToMeta walks all loaded metadata and surfaces
 * "what depends on this artifact".
 *
 * [#9190] The registry it walks is now DERIVED from the metadata type schemas
 * rather than hand-curated, and the fixtures below were re-spelled to match the
 * schemas because they did not. `FieldSchema` spells the lookup target
 * `reference`, not `referenceTo`; `PermissionSetSchema.objects` is a
 * name-keyed RECORD, not an array of `{ name }`; `DashboardSchema` declares no
 * `view` property at any depth. Each of those fixtures agreed with a curated
 * path and therefore described a document the platform cannot store — the
 * hand-written list and the hand-written fixture confirming each other is
 * exactly how the drift stayed invisible.
 */
describe('ObjectStackProtocolImplementation - findReferencesToMeta', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        // Target object — must use registerObject so listItems('object')
        // surfaces it (objects live in their own contributor map).
        registry.registerObject({ name: 'account', label: 'Account', fields: {} }, 'pkg');
        // Sibling object whose field points at it.
        registry.registerObject({
            name: 'task',
            label: 'Task',
            fields: {
                name: { name: 'name', type: 'text' },
                account_id: { name: 'account_id', type: 'lookup', reference: 'account' },
            },
        } as any, 'pkg');
        // Views pointing at account.
        registry.registerItem('view', { name: 'account_list', type: 'grid', object: 'account', label: 'Account List' }, 'name');
        registry.registerItem('view', { name: 'task_list', type: 'grid', object: 'task' }, 'name');
        // Permission granting on the account object — a name-keyed record,
        // which is what `PermissionSetSchema.objects` actually is.
        registry.registerItem('permission', {
            name: 'sales_admin',
            label: 'Sales Admin',
            objects: { account: { allowRead: true }, task: { allowRead: true } },
        }, 'name');
        // App navigation referencing the account view. (This used to be a
        // dashboard widget, which `DashboardSchema` cannot carry.)
        registry.registerItem('app', {
            name: 'sales_app',
            label: 'Sales App',
            navigation: [{ label: 'Accounts', viewName: 'account_list' }],
        }, 'name');
        // Skill referencing a tool. (This used to be an agent, whose `tools`
        // key was REMOVED in spec 17 — an agent reaches tools through its
        // skills, ADR-0064.)
        registry.registerItem('tool', { name: 'crm_query', label: 'CRM Query' }, 'name');
        registry.registerItem('skill', {
            name: 'lookup_account',
            label: 'Look up account',
            tools: ['crm_query'],
        }, 'name');

        mockEngine = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn().mockResolvedValue({ id: 'x' }),
            update: vi.fn().mockResolvedValue({ id: 'x' }),
            delete: vi.fn().mockResolvedValue({ deleted: 1 }),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        protocol = new ObjectStackProtocolImplementation(mockEngine);
    });

    it('finds views, fields and permissions that reference an object', async () => {
        const result = await protocol.findReferencesToMeta({ type: 'object', name: 'account' });
        // view.account_list (object: 'account'), task object field referenceTo, sales_admin permission
        const byTypeName = new Map(result.references.map((r) => [`${r.type}:${r.name}`, r]));
        expect(byTypeName.has('view:account_list')).toBe(true);
        expect(byTypeName.has('object:task')).toBe(true);
        expect(byTypeName.has('permission:sales_admin')).toBe(true);
        // Path is reported — as the place in the document the name was found.
        expect(byTypeName.get('view:account_list')!.path).toBe('object');
        expect(byTypeName.get('object:task')!.path).toBe('fields.account_id.reference');
        expect(byTypeName.get('permission:sales_admin')!.path).toBe('objects{key}');
    });

    it('finds apps that reference a view', async () => {
        const result = await protocol.findReferencesToMeta({ type: 'view', name: 'account_list' });
        const names = result.references.map((r) => `${r.type}:${r.name}`);
        expect(names).toContain('app:sales_app');
    });

    it('finds skills that reference a tool', async () => {
        const result = await protocol.findReferencesToMeta({ type: 'tool', name: 'crm_query' });
        expect(result.references.some((r) => r.type === 'skill' && r.name === 'lookup_account')).toBe(true);
    });

    it('returns empty array for a target type no declared schema can name', async () => {
        const result = await protocol.findReferencesToMeta({ type: 'unknown_kind', name: 'foo' });
        expect(result.references).toEqual([]);
    });

    it('returns empty array when nothing points at the target', async () => {
        registry.registerObject({ name: 'orphan', fields: {} }, 'pkg');
        const result = await protocol.findReferencesToMeta({ type: 'object', name: 'orphan' });
        expect(result.references).toEqual([]);
    });

    it('does not list an object as referencing itself for non-array path', async () => {
        // view.account_list has object='account'. If we ask refs for 'account_list' view
        // it should not list the same view via a hypothetical self-path.
        const result = await protocol.findReferencesToMeta({ type: 'view', name: 'account_list' });
        expect(result.references.some((r) => r.type === 'view' && r.name === 'account_list')).toBe(false);
    });
});
