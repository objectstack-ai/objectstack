// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { SchemaRegistry } from './registry.js';

/**
 * Tests for the Protocol Implementation's metadata persistence methods.
 * Validates dual-write strategy (SchemaRegistry + database), DB fallback for reads,
 * graceful degradation when DB is unavailable, and the loadMetaFromDb() bootstrap method.
 */
describe('ObjectStackProtocolImplementation - Metadata Persistence', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;

    const sampleApp = {
        name: 'test_app',
        label: 'Test App',
        description: 'A test application',
    };

    beforeEach(() => {
        // Each test owns a fresh registry instance — the protocol reads it
        // via `engine.registry`, mirroring the real ObjectQL contract.
        registry = new SchemaRegistry({ multiTenant: false });

        mockEngine = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn().mockResolvedValue({ id: 'new-uuid' }),
            update: vi.fn().mockResolvedValue({ id: 'existing-uuid' }),
            delete: vi.fn().mockResolvedValue({ deleted: 1 }),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        protocol = new ObjectStackProtocolImplementation(mockEngine);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ═══════════════════════════════════════════════════════════════
    // saveMetaItem — dual-write (registry + database)
    // ═══════════════════════════════════════════════════════════════

    describe('saveMetaItem', () => {
        it('should throw when item data is missing', async () => {
            await expect(
                protocol.saveMetaItem({ type: 'app', name: 'test_app' })
            ).rejects.toThrow('Item data is required');
        });

        it('should NOT mutate the SchemaRegistry for non-object types (ADR-0005)', async () => {
            // ADR-0005: sys_metadata is the authoritative overlay store.
            // saveMetaItem must not pollute the artifact-loaded registry for
            // overlay-eligible types (view/dashboard/etc.) — getMetaItem reads
            // sys_metadata first, so the registry stays at the artifact value.
            await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp });

            const stored = registry.getItem('app', 'test_app');
            expect(stored).toBeUndefined();
        });

        it('should register `object` type items in SchemaRegistry (engine schema-sync needs it)', async () => {
            await protocol.saveMetaItem({
                type: 'object',
                name: 'test_obj',
                item: { name: 'test_obj', label: 'Test', fields: {} },
            });

            const stored = registry.getItem('object', 'test_obj');
            expect(stored).toBeDefined();
            expect((stored as any).name).toBe('test_obj');
        });

        it('should insert a new record in the database when item does not exist', async () => {
            mockEngine.findOne.mockResolvedValue(null); // not existing

            await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp });

            expect(mockEngine.findOne).toHaveBeenCalledWith('sys_metadata', {
                where: { type: 'app', name: 'test_app', project_id: null }
            });
            expect(mockEngine.insert).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                name: 'test_app',
                type: 'app',
                scope: 'platform',
                state: 'active',
                version: 1,
                metadata: JSON.stringify(sampleApp),
            }));
        });

        it('should update an existing record in the database and increment version', async () => {
            const existingRecord = { id: 'existing-uuid', version: 2 };
            mockEngine.findOne.mockResolvedValue(existingRecord);

            await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp });

            expect(mockEngine.update).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                metadata: JSON.stringify(sampleApp),
                version: 3, // incremented from 2
            }), {
                where: { id: 'existing-uuid' }
            });
            expect(mockEngine.insert).not.toHaveBeenCalled();
        });

        it('should return success=true on DB success (control-plane path)', async () => {
            const result = await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp });

            expect(result.success).toBe(true);
            // control-plane (no projectId) returns the legacy message
            expect(result.message).toBe('Saved to database and registry');
        });

        it('should fail-fast with 500 when DB findOne is unavailable (ADR-0005)', async () => {
            // ADR-0005 removed the silent in-memory degrade — DB write failures
            // must surface as a 500 so callers know persistence failed.
            mockEngine.findOne.mockRejectedValue(new Error('Connection refused'));

            await expect(
                protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp })
            ).rejects.toThrow(/Failed to persist customization overlay/);
        });

        it('should fail-fast with 500 when DB insert fails (ADR-0005)', async () => {
            mockEngine.findOne.mockResolvedValue(null);
            mockEngine.insert.mockRejectedValue(new Error('Table not found'));

            await expect(
                protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp })
            ).rejects.toThrow(/Failed to persist customization overlay/);
        });

        it('should use version=1 for initial insert when existing record has no version', async () => {
            mockEngine.findOne.mockResolvedValue(null);

            await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp });

            expect(mockEngine.insert).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                version: 1,
            }));
        });

        it('should handle existing record with version=0 and increment to 1', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 'uuid', version: 0 });

            await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp });

            expect(mockEngine.update).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                version: 1,
            }), expect.anything());
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // getMetaItem — registry-first, DB fallback
    // ═══════════════════════════════════════════════════════════════

    describe('getMetaItem', () => {
        it('should consult sys_metadata FIRST even when registry has the item (ADR-0005)', async () => {
            // ADR-0005 read order: sys_metadata (overlay) wins over the
            // artifact-loaded registry. Customer customizations must always
            // override factory defaults.
            registry.registerItem('app', sampleApp, 'name');

            const result = await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            // Registry value is still returned (no overlay row exists),
            // but sys_metadata MUST have been queried.
            expect(result.item).toEqual(sampleApp);
            expect(mockEngine.findOne).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                where: expect.objectContaining({ type: 'app', name: 'test_app', state: 'active' }),
            }));
        });

        it('should fall back to registry when no overlay row exists', async () => {
            registry.registerItem('app', sampleApp, 'name');
            mockEngine.findOne.mockResolvedValue(null);

            const result = await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            expect(result.item).toEqual(sampleApp);
        });

        it('should return overlay row content from DB when present', async () => {
            mockEngine.findOne.mockResolvedValue({
                type: 'app',
                name: 'test_app',
                state: 'active',
                metadata: JSON.stringify(sampleApp),
            });

            const result = await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            expect(result.item).toEqual(sampleApp);
            expect(mockEngine.findOne).toHaveBeenCalledWith('sys_metadata', {
                where: { type: 'app', name: 'test_app', state: 'active', project_id: null }
            });
        });

        it('should NOT hydrate registry after reading overlay (ADR-0005)', async () => {
            // The registry is reserved for artifact-loaded factory values.
            // Overlay reads stay ephemeral; the next read re-queries sys_metadata.
            mockEngine.findOne.mockResolvedValue({
                type: 'app',
                name: 'test_app',
                state: 'active',
                metadata: JSON.stringify(sampleApp),
            });

            await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            const cached = registry.getItem('app', 'test_app');
            expect(cached).toBeUndefined();
        });

        it('should try alternate type name in DB when primary type not found', async () => {
            // 'app' not found, try 'apps'
            mockEngine.findOne
                .mockResolvedValueOnce(null) // first call: type='app' not found
                .mockResolvedValueOnce({    // second call: type='apps' found
                    type: 'apps',
                    name: 'test_app',
                    state: 'active',
                    metadata: JSON.stringify(sampleApp),
                });

            const result = await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            expect(result.item).toEqual(sampleApp);
            expect(mockEngine.findOne).toHaveBeenCalledTimes(2);
        });

        it('should return undefined item when not in registry or DB', async () => {
            mockEngine.findOne.mockResolvedValue(null);

            const result = await protocol.getMetaItem({ type: 'app', name: 'nonexistent' });

            expect(result.item).toBeUndefined();
        });

        it('should handle DB errors gracefully and return undefined item', async () => {
            mockEngine.findOne.mockRejectedValue(new Error('DB down'));

            const result = await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            expect(result.item).toBeUndefined();
            expect(result.type).toBe('app');
            expect(result.name).toBe('test_app');
        });

        it('should parse metadata JSON string from DB record', async () => {
            const complexData = { name: 'complex', nested: { value: 42 } };
            mockEngine.findOne.mockResolvedValue({
                type: 'object',
                name: 'complex',
                state: 'active',
                metadata: JSON.stringify(complexData),
            });

            const result = await protocol.getMetaItem({ type: 'object', name: 'complex' });

            expect(result.item).toEqual(complexData);
        });

        it('should handle metadata already parsed as object from DB', async () => {
            mockEngine.findOne.mockResolvedValue({
                type: 'app',
                name: 'test_app',
                state: 'active',
                metadata: sampleApp, // already an object, not a string
            });

            const result = await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            expect(result.item).toEqual(sampleApp);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // getMetaItems — registry-first, DB fallback
    // ═══════════════════════════════════════════════════════════════

    describe('getMetaItems', () => {
        it('should return items from SchemaRegistry and still consult DB for seeded entries', async () => {
            registry.registerItem('app', sampleApp, 'name');
            registry.registerItem('app', { name: 'app2', label: 'App 2' }, 'name');
            // DB has no extra rows for this type — registry entries must still
            // be returned unchanged.
            mockEngine.find.mockResolvedValue([]);

            const result = await protocol.getMetaItems({ type: 'app' });

            expect(result.items).toHaveLength(2);
            // DB *is* queried (always-merge semantics) so seeded metadata
            // surfaces even when the registry already has unrelated items.
            expect(mockEngine.find).toHaveBeenCalledWith('sys_metadata', {
                where: { type: 'app', state: 'active', project_id: null }
            });
        });

        it('should fall back to DB when registry is empty for type', async () => {
            mockEngine.find.mockResolvedValue([
                {
                    type: 'app',
                    name: 'test_app',
                    state: 'active',
                    metadata: JSON.stringify(sampleApp),
                }
            ]);

            const result = await protocol.getMetaItems({ type: 'app' });

            expect(result.items).toHaveLength(1);
            expect(result.items[0]).toEqual(sampleApp);
            expect(mockEngine.find).toHaveBeenCalledWith('sys_metadata', {
                where: { type: 'app', state: 'active', project_id: null }
            });
        });

        it('should hydrate registry after DB fallback for getMetaItems', async () => {
            mockEngine.find.mockResolvedValue([
                {
                    type: 'app',
                    name: 'test_app',
                    state: 'active',
                    metadata: JSON.stringify(sampleApp),
                }
            ]);

            await protocol.getMetaItems({ type: 'app' });

            // Should now be in registry
            const cached = registry.getItem('app', 'test_app');
            expect(cached).toEqual(sampleApp);
        });

        it('should try alternate type name in DB when primary type has no records', async () => {
            mockEngine.find
                .mockResolvedValueOnce([]) // 'app' returns nothing
                .mockResolvedValueOnce([ // 'apps' returns results
                    { type: 'apps', name: 'test_app', state: 'active', metadata: JSON.stringify(sampleApp) }
                ]);

            const result = await protocol.getMetaItems({ type: 'app' });

            expect(result.items).toHaveLength(1);
            expect(mockEngine.find).toHaveBeenCalledTimes(2);
        });

        it('should return empty items array when DB also has no records', async () => {
            mockEngine.find.mockResolvedValue([]);

            const result = await protocol.getMetaItems({ type: 'app' });

            expect(result.items).toHaveLength(0);
        });

        it('should handle DB errors gracefully and return empty items', async () => {
            mockEngine.find.mockRejectedValue(new Error('DB down'));

            const result = await protocol.getMetaItems({ type: 'app' });

            expect(result.items).toHaveLength(0);
            expect(result.type).toBe('app');
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // loadMetaFromDb — startup hydration
    // ═══════════════════════════════════════════════════════════════

    describe('loadMetaFromDb', () => {
        it('should load all active records from DB into SchemaRegistry', async () => {
            const app2 = { name: 'app2', label: 'App 2' };
            mockEngine.find.mockResolvedValue([
                { type: 'app', name: 'test_app', state: 'active', metadata: JSON.stringify(sampleApp) },
                { type: 'app', name: 'app2', state: 'active', metadata: JSON.stringify(app2) },
            ]);

            const result = await protocol.loadMetaFromDb();

            expect(result.loaded).toBe(2);
            expect(result.errors).toBe(0);

            expect(registry.getItem('app', 'test_app')).toEqual(sampleApp);
            expect(registry.getItem('app', 'app2')).toEqual(app2);
        });

        it('should query only active state records', async () => {
            mockEngine.find.mockResolvedValue([]);

            await protocol.loadMetaFromDb();

            expect(mockEngine.find).toHaveBeenCalledWith('sys_metadata', {
                where: { state: 'active', project_id: null }
            });
        });

        it('should count parse errors and continue loading other records', async () => {
            mockEngine.find.mockResolvedValue([
                { type: 'app', name: 'test_app', state: 'active', metadata: JSON.stringify(sampleApp) },
                { type: 'object', name: 'bad', state: 'active', metadata: 'not-valid-json{{{' },
            ]);

            const result = await protocol.loadMetaFromDb();

            expect(result.loaded).toBe(1);
            expect(result.errors).toBe(1);
        });

        it('should return loaded=0 errors=0 when DB returns empty results', async () => {
            mockEngine.find.mockResolvedValue([]);

            const result = await protocol.loadMetaFromDb();

            expect(result.loaded).toBe(0);
            expect(result.errors).toBe(0);
        });

        it('should gracefully skip DB hydration when DB is unavailable', async () => {
            mockEngine.find.mockRejectedValue(new Error('Connection refused'));

            const result = await protocol.loadMetaFromDb();

            expect(result.loaded).toBe(0);
            expect(result.errors).toBe(0);
        });

        it('should handle metadata already parsed as an object (not string)', async () => {
            mockEngine.find.mockResolvedValue([
                { type: 'app', name: 'test_app', state: 'active', metadata: sampleApp }, // object, not string
            ]);

            const result = await protocol.loadMetaFromDb();

            expect(result.loaded).toBe(1);
            expect(result.errors).toBe(0);
            expect(registry.getItem('app', 'test_app')).toEqual(sampleApp);
        });

        it('should load records of different types', async () => {
            const objDef = { name: 'task', label: 'Task', fields: {} };
            mockEngine.find.mockResolvedValue([
                { type: 'app', name: 'test_app', state: 'active', metadata: JSON.stringify(sampleApp) },
                { type: 'object', name: 'task', state: 'active', metadata: JSON.stringify(objDef) },
            ]);

            const result = await protocol.loadMetaFromDb();

            expect(result.loaded).toBe(2);
            expect(registry.getItem('app', 'test_app')).toEqual(sampleApp);
            expect(registry.getItem('object', 'task')).toEqual(objDef);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Discovery — metadata service status
    // ═══════════════════════════════════════════════════════════════

    describe('getDiscovery - metadata service status', () => {
        it('should report metadata service as available (not degraded)', async () => {
            const discovery = await protocol.getDiscovery();

            expect(discovery.services.metadata).toBeDefined();
            expect(discovery.services.metadata.enabled).toBe(true);
            expect(discovery.services.metadata.status).toBe('available');
            expect(discovery.services.metadata.message).toBeUndefined();
        });
    });
});
