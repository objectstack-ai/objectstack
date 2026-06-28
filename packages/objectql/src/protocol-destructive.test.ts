// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';

/**
 * Phase 3a-destructive tests.
 *
 * Validates that saveMetaItem refuses to overwrite an existing `object`
 * schema with a change that would drop or transform existing data
 * (removed field, type narrowing, required-toggled-on without default).
 * The caller can opt past the safety check with `force: true`.
 */
describe('ObjectStackProtocolImplementation - destructive change detection', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.registerObject({
            name: 'account',
            label: 'Account',
            fields: {
                name: { name: 'name', type: 'text' },
                amount: { name: 'amount', type: 'number' },
                status: { name: 'status', type: 'text' },
            },
        } as any, 'pkg');

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
        // No environmentId — bypass the overlay opt-in gate so we test
        // only the destructive check.
        protocol = new ObjectStackProtocolImplementation(mockEngine);
    });

    it('blocks save when a field is removed', async () => {
        await expect(protocol.saveMetaItem({
            type: 'object',
            name: 'account',
            item: {
                name: 'account',
                label: 'Account',
                fields: {
                    name: { name: 'name', type: 'text' },
                    amount: { name: 'amount', type: 'number' },
                    // status removed
                },
            },
        })).rejects.toMatchObject({
            code: 'destructive_change',
            status: 409,
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'field_removed', field: 'status' }),
            ]),
        });
    });

    it('blocks save when a field type is narrowed', async () => {
        await expect(protocol.saveMetaItem({
            type: 'object',
            name: 'account',
            item: {
                name: 'account',
                label: 'Account',
                fields: {
                    name: { name: 'name', type: 'text' },
                    amount: { name: 'amount', type: 'text' }, // number -> text not in compat list
                    status: { name: 'status', type: 'text' },
                },
            },
        })).rejects.toMatchObject({
            code: 'destructive_change',
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'field_type_change', field: 'amount' }),
            ]),
        });
    });

    it('blocks save when an existing field is made required without a default', async () => {
        await expect(protocol.saveMetaItem({
            type: 'object',
            name: 'account',
            item: {
                name: 'account',
                label: 'Account',
                fields: {
                    name: { name: 'name', type: 'text', required: true },
                    amount: { name: 'amount', type: 'number' },
                    status: { name: 'status', type: 'text' },
                },
            },
        })).rejects.toMatchObject({
            code: 'destructive_change',
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'field_required_no_default', field: 'name' }),
            ]),
        });
    });

    it('allows save when a field is made required WITH a default value', async () => {
        // No destructive_change should fire; downstream persistence may still
        // throw for other reasons, so just assert the code is not 'destructive_change'.
        try {
            await protocol.saveMetaItem({
                type: 'object',
                name: 'account',
                item: {
                    name: 'account',
                    label: 'Account',
                    fields: {
                        name: { name: 'name', type: 'text', required: true, defaultValue: 'untitled' },
                        amount: { name: 'amount', type: 'number' },
                        status: { name: 'status', type: 'text' },
                    },
                },
            });
        } catch (err: any) {
            expect(err?.code).not.toBe('destructive_change');
        }
    });

    it('allows save when force=true even with destructive changes', async () => {
        try {
            await protocol.saveMetaItem({
                type: 'object',
                name: 'account',
                force: true,
                item: {
                    name: 'account',
                    label: 'Account',
                    fields: {
                        name: { name: 'name', type: 'text' },
                        // status removed but force=true
                    },
                },
            });
        } catch (err: any) {
            expect(err?.code).not.toBe('destructive_change');
        }
    });

    it('allows save when adding new fields and widening types', async () => {
        try {
            await protocol.saveMetaItem({
                type: 'object',
                name: 'account',
                item: {
                    name: 'account',
                    label: 'Account',
                    fields: {
                        name: { name: 'name', type: 'textarea' }, // text -> textarea is in compat list
                        amount: { name: 'amount', type: 'number' },
                        status: { name: 'status', type: 'text' },
                        new_field: { name: 'new_field', type: 'text' }, // brand new
                    },
                },
            });
        } catch (err: any) {
            expect(err?.code).not.toBe('destructive_change');
        }
    });

    it('does not run destructive check for non-object types', async () => {
        // view doesn't have `fields`; saveMetaItem should not flag this as destructive.
        try {
            await protocol.saveMetaItem({
                type: 'view',
                name: 'account_grid',
                item: { name: 'account_grid', type: 'grid', object: 'account' },
            });
        } catch (err: any) {
            expect(err?.code).not.toBe('destructive_change');
        }
    });
});
