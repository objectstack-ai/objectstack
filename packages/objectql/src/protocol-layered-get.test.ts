// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';

/**
 * Phase 3a-layered-get tests.
 *
 * Validates that getMetaItemLayered returns code / overlay / effective
 * separately so the admin UI can diff "what was customised".
 */
describe('ObjectStackProtocolImplementation - getMetaItemLayered', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;

    const codeBaseline = { name: 'my_view', type: 'grid', object: 'task', label: 'Code Label' };
    const overlayBody = { name: 'my_view', type: 'grid', object: 'task', label: 'Customised Label' };

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        // Register the code baseline in the registry.
        registry.registerItem('view', codeBaseline, 'name');

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

    it('returns code layer only when no overlay exists', async () => {
        const result = await protocol.getMetaItemLayered({ type: 'view', name: 'my_view' });
        expect(result.code).toMatchObject({ label: 'Code Label' });
        expect(result.overlay).toBeNull();
        expect(result.overlayScope).toBeNull();
        expect(result.effective).toMatchObject({ label: 'Code Label' });
    });

    it('returns both layers when env-wide overlay exists', async () => {
        mockEngine.findOne.mockImplementation((_table: string, opts: any) => {
            if (opts.where?.organization_id === null) {
                return Promise.resolve({ metadata: overlayBody });
            }
            return Promise.resolve(null);
        });

        const result = await protocol.getMetaItemLayered({ type: 'view', name: 'my_view' });
        expect(result.code).toMatchObject({ label: 'Code Label' });
        expect(result.overlay).toMatchObject({ label: 'Customised Label' });
        expect(result.overlayScope).toBe('env');
        expect(result.effective).toMatchObject({ label: 'Customised Label' });
    });

    it('prefers org-scoped overlay over env-wide when both exist', async () => {
        const orgOverlay = { ...overlayBody, label: 'Org-Specific Label' };
        mockEngine.findOne.mockImplementation((_table: string, opts: any) => {
            if (opts.where?.organization_id === 'org_alpha') {
                return Promise.resolve({ metadata: orgOverlay });
            }
            if (opts.where?.organization_id === null) {
                return Promise.resolve({ metadata: overlayBody });
            }
            return Promise.resolve(null);
        });

        const result = await protocol.getMetaItemLayered({
            type: 'view',
            name: 'my_view',
            organizationId: 'org_alpha',
        });
        expect(result.overlayScope).toBe('org');
        expect(result.overlay).toMatchObject({ label: 'Org-Specific Label' });
        expect(result.effective).toMatchObject({ label: 'Org-Specific Label' });
    });

    it('returns null code when artifact baseline missing but overlay exists', async () => {
        mockEngine.findOne.mockResolvedValue({ metadata: { name: 'phantom', label: 'Phantom' } });
        const result = await protocol.getMetaItemLayered({ type: 'view', name: 'phantom' });
        expect(result.code).toBeNull();
        expect(result.overlay).toMatchObject({ label: 'Phantom' });
        expect(result.effective).toMatchObject({ label: 'Phantom' });
    });

    it('returns all-null layers when nothing exists', async () => {
        const result = await protocol.getMetaItemLayered({ type: 'view', name: 'does_not_exist' });
        expect(result.code).toBeNull();
        expect(result.overlay).toBeNull();
        expect(result.effective).toBeNull();
    });

    it('scopes the code layer to the requested package on a same-name collision (ADR-0048)', async () => {
        // Two packages each ship view/clash; the registry stores them under
        // composite keys. The layered (Studio editor) read must resolve the
        // code baseline owned by the requested package.
        registry.registerItem('view', { name: 'clash', type: 'grid', object: 'task', label: 'Alpha view' }, 'name', 'com.acme.alpha');
        registry.registerItem('view', { name: 'clash', type: 'grid', object: 'task', label: 'Beta view' }, 'name', 'com.acme.beta');

        const alpha = await protocol.getMetaItemLayered({ type: 'view', name: 'clash', packageId: 'com.acme.alpha' });
        const beta = await protocol.getMetaItemLayered({ type: 'view', name: 'clash', packageId: 'com.acme.beta' });

        expect((alpha.code as any)?.label).toBe('Alpha view');
        expect((beta.code as any)?.label).toBe('Beta view');
    });

    it('scopes the overlay query to the requested package (ADR-0048)', async () => {
        const rows: Record<string, any> = {
            'com.acme.alpha': { metadata: { name: 'clash', label: 'Alpha overlay' } },
            'com.acme.beta': { metadata: { name: 'clash', label: 'Beta overlay' } },
        };
        // The package-scoped query carries package_id; the package-less
        // fallback must miss (null) so the scoped row is the only hit.
        mockEngine.findOne.mockImplementation((_table: string, opts: any) =>
            Promise.resolve(opts.where?.package_id ? (rows[opts.where.package_id] ?? null) : null),
        );

        const alpha = await protocol.getMetaItemLayered({ type: 'view', name: 'clash', packageId: 'com.acme.alpha' });
        const beta = await protocol.getMetaItemLayered({ type: 'view', name: 'clash', packageId: 'com.acme.beta' });

        expect((alpha.overlay as any)?.label).toBe('Alpha overlay');
        expect((beta.overlay as any)?.label).toBe('Beta overlay');
    });
});
