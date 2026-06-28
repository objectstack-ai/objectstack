// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';

/**
 * Phase 3a-references tests.
 *
 * Validates that findReferencesToMeta walks the hand-curated path registry
 * across all loaded metadata and surfaces "what depends on this artifact".
 */
describe('ObjectStackProtocolImplementation - findReferencesToMeta', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        // Target object — must use registerObject so listItems('object')
        // surfaces it (objects live in their own contributor map).
        registry.registerObject({ name: 'account', label: 'Account', fields: {} } as any, 'pkg');
        // Sibling object whose field points at it.
        registry.registerObject({
            name: 'task',
            label: 'Task',
            fields: {
                name: { name: 'name', type: 'text' },
                account_id: { name: 'account_id', type: 'lookup', referenceTo: 'account' },
            },
        } as any, 'pkg');
        // Views pointing at account.
        registry.registerItem('view', { name: 'account_list', type: 'grid', object: 'account', label: 'Account List' }, 'name');
        registry.registerItem('view', { name: 'task_list', type: 'grid', object: 'task' }, 'name');
        // Permission listing the account object.
        registry.registerItem('permission', {
            name: 'sales_admin',
            label: 'Sales Admin',
            objects: [{ name: 'account', allowRead: true }, { name: 'task', allowRead: true }],
        }, 'name');
        // Dashboard widget referencing the account view.
        registry.registerItem('dashboard', {
            name: 'sales_dash',
            label: 'Sales Dashboard',
            widgets: [{ id: 'w1', view: 'account_list' }],
        }, 'name');
        // Agent referencing a tool.
        registry.registerItem('tool', { name: 'crm_query', label: 'CRM Query' }, 'name');
        registry.registerItem('agent', {
            name: 'sdr',
            label: 'SDR Agent',
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
        // Path is reported.
        expect(byTypeName.get('view:account_list')!.path).toBe('object');
        expect(byTypeName.get('object:task')!.path).toBe('fields{}.referenceTo');
    });

    it('finds dashboards that reference a view', async () => {
        const result = await protocol.findReferencesToMeta({ type: 'view', name: 'account_list' });
        const names = result.references.map((r) => `${r.type}:${r.name}`);
        expect(names).toContain('dashboard:sales_dash');
    });

    it('finds agents that reference a tool', async () => {
        const result = await protocol.findReferencesToMeta({ type: 'tool', name: 'crm_query' });
        expect(result.references.some((r) => r.type === 'agent' && r.name === 'sdr')).toBe(true);
    });

    it('returns empty array for unknown target type', async () => {
        const result = await protocol.findReferencesToMeta({ type: 'unknown_kind', name: 'foo' });
        expect(result.references).toEqual([]);
    });

    it('returns empty array when nothing points at the target', async () => {
        registry.registerObject({ name: 'orphan', fields: {} } as any, 'pkg');
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
