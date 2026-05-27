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

    // ═══════════════════════════════════════════════════════════════
    // ADR-0005 (revised 2026-05): per-organization overlay isolation
    // ═══════════════════════════════════════════════════════════════

    describe('per-organization overlay isolation', () => {
        it('saveMetaItem persists organization_id when provided', async () => {
            mockEngine.findOne.mockResolvedValue(null);
            await protocol.saveMetaItem({
                type: 'app',
                name: 'test_app',
                item: sampleApp,
                organizationId: 'org_alpha',
            });
            expect(mockEngine.findOne).toHaveBeenCalledWith('sys_metadata', {
                where: { type: 'app', name: 'test_app', organization_id: 'org_alpha', state: 'active' },
            });
            expect(mockEngine.insert).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                organization_id: 'org_alpha',
            }), expect.anything());
        });

        it('getMetaItem returns org-specific overlay when both org and env-wide rows exist', async () => {
            // findOverlay calls: first attempts org=org_alpha (returns row),
            // env-wide fallback should be skipped.
            mockEngine.findOne.mockImplementation((_table: string, opts: any) => {
                if (opts?.where?.organization_id === 'org_alpha') {
                    return Promise.resolve({
                        type: 'app', name: 'test_app', state: 'active',
                        metadata: JSON.stringify({ ...sampleApp, label: 'Org Alpha' }),
                    });
                }
                if (opts?.where?.organization_id === null) {
                    return Promise.resolve({
                        type: 'app', name: 'test_app', state: 'active',
                        metadata: JSON.stringify({ ...sampleApp, label: 'Env Default' }),
                    });
                }
                return Promise.resolve(null);
            });

            const result = await protocol.getMetaItem({
                type: 'app', name: 'test_app', organizationId: 'org_alpha',
            });
            expect((result.item as any).label).toBe('Org Alpha');
        });

        it('getMetaItem falls through to env-wide overlay when no org-specific row exists', async () => {
            mockEngine.findOne.mockImplementation((_table: string, opts: any) => {
                if (opts?.where?.organization_id === null) {
                    return Promise.resolve({
                        type: 'app', name: 'test_app', state: 'active',
                        metadata: JSON.stringify({ ...sampleApp, label: 'Env Default' }),
                    });
                }
                return Promise.resolve(null);
            });
            const result = await protocol.getMetaItem({
                type: 'app', name: 'test_app', organizationId: 'org_alpha',
            });
            expect((result.item as any).label).toBe('Env Default');
        });

        it('getMetaItems unions env-wide and org-specific rows (org wins on collision)', async () => {
            mockEngine.find.mockImplementation((_table: string, opts: any) => {
                if (opts?.where?.organization_id === 'org_alpha') {
                    return Promise.resolve([
                        { type: 'app', name: 'shared', state: 'active', metadata: JSON.stringify({ name: 'shared', label: 'Org Alpha' }) },
                        { type: 'app', name: 'alpha_only', state: 'active', metadata: JSON.stringify({ name: 'alpha_only', label: 'Alpha Only' }) },
                    ]);
                }
                if (opts?.where?.organization_id === null) {
                    return Promise.resolve([
                        { type: 'app', name: 'shared', state: 'active', metadata: JSON.stringify({ name: 'shared', label: 'Env Default' }) },
                        { type: 'app', name: 'env_only', state: 'active', metadata: JSON.stringify({ name: 'env_only', label: 'Env Only' }) },
                    ]);
                }
                return Promise.resolve([]);
            });
            const result = await protocol.getMetaItems({
                type: 'app', organizationId: 'org_alpha',
            });
            const names = (result.items as any[]).map((i) => i.name).sort();
            expect(names).toEqual(['alpha_only', 'env_only', 'shared']);
            const shared = (result.items as any[]).find((i) => i.name === 'shared');
            expect(shared.label).toBe('Org Alpha');
        });
    });

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
                where: { type: 'app', name: 'test_app', organization_id: null, state: 'active' }
            });
            expect(mockEngine.insert).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                name: 'test_app',
                type: 'app',
                state: 'active',
                version: 1,
                metadata: JSON.stringify(sampleApp),
            }), expect.anything());
        });

        it('should update an existing record in the database and increment version', async () => {
            const existingRecord = { id: 'existing-uuid', version: 2 };
            mockEngine.findOne.mockResolvedValue(existingRecord);

            // parentVersion: null because the mock row has no checksum column
            // (existingHash = existing?.checksum ?? null = null).
            await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp, parentVersion: null });

            expect(mockEngine.update).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                metadata: JSON.stringify(sampleApp),
                version: 1, // history-based counter (empty history → 1)
            }), expect.objectContaining({
                where: { id: 'existing-uuid' }
            }));
            // The history append is the only sys_metadata insert on a successful update.
            expect(mockEngine.insert).toHaveBeenCalledWith('sys_metadata_history', expect.anything(), expect.anything());
            expect(mockEngine.insert).not.toHaveBeenCalledWith('sys_metadata', expect.anything(), expect.anything());
        });

        it('should return success=true on DB success (control-plane path)', async () => {
            const result = await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp });

            expect(result.success).toBe(true);
            // env-wide (no organizationId) overlay save
            expect(result.message).toMatch(/Saved customization overlay/);
        });

        it('should fail-fast with 500 when DB findOne is unavailable (ADR-0005)', async () => {
            // ADR-0005 removed the silent in-memory degrade — DB write failures
            // must surface as a 500 so callers know persistence failed.
            // The new SysMetadataRepository path does not wrap errors; the raw
            // DB error propagates directly.
            mockEngine.findOne.mockRejectedValue(new Error('Connection refused'));

            await expect(
                protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp })
            ).rejects.toThrow(/Connection refused/);
        });

        it('should fail-fast with 500 when DB insert fails (ADR-0005)', async () => {
            mockEngine.findOne.mockResolvedValue(null);
            mockEngine.insert.mockRejectedValue(new Error('Table not found'));

            await expect(
                protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp })
            ).rejects.toThrow(/Table not found/);
        });

        it('should use version=1 for initial insert when existing record has no version', async () => {
            mockEngine.findOne.mockResolvedValue(null);

            await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp });

            expect(mockEngine.insert).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                version: 1,
            }), expect.anything());
        });

        it('should handle existing record with version=0 and increment to 1', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 'uuid', version: 0 });

            // parentVersion: null because the mock row has no checksum column.
            await protocol.saveMetaItem({ type: 'app', name: 'test_app', item: sampleApp, parentVersion: null });

            expect(mockEngine.update).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                version: 1, // history-based counter (empty history → 1)
            }), expect.anything());
        });

        // ─── Spec validation (ADR-0005 §"Validation") ───────────────────
        describe('spec validation', () => {
            const validView = {
                name: 'all_leads',
                label: 'All Leads',
                type: 'grid',
                data: { provider: 'object', object: 'lead' },
                columns: ['first_name', 'last_name'],
            };
            const validDashboard = {
                name: 'sales_dashboard',
                label: 'Sales',
                widgets: [{
                    id: 'pipeline',
                    title: 'Pipeline',
                    type: 'metric',
                    object: 'opportunity',
                    valueField: 'amount',
                    aggregate: 'sum',
                    layout: { x: 0, y: 0, w: 3, h: 2 },
                }],
            };

            it('accepts a spec-conformant view payload', async () => {
                await expect(
                    protocol.saveMetaItem({ type: 'view', name: 'all_leads', item: validView })
                ).resolves.toMatchObject({ success: true });
                expect(mockEngine.insert).toHaveBeenCalled();
            });

            it('accepts a spec-conformant dashboard payload', async () => {
                await expect(
                    protocol.saveMetaItem({
                        type: 'dashboard',
                        name: 'sales_dashboard',
                        item: validDashboard,
                    })
                ).resolves.toMatchObject({ success: true });
                expect(mockEngine.insert).toHaveBeenCalled();
            });

            it('preserves Studio-only auxiliary fields verbatim (not stripped)', async () => {
                // isPinned / isDefault / sortOrder are not in ListViewSchema;
                // we must NOT replace the persisted document with parsed.data,
                // or these fields would be silently dropped on every save.
                const itemWithExtras = {
                    ...validView,
                    isPinned: true,
                    isDefault: false,
                    sortOrder: 5,
                    objectName: 'lead',
                };

                await protocol.saveMetaItem({
                    type: 'view',
                    name: 'all_leads',
                    item: itemWithExtras,
                });

                const insertCall = mockEngine.insert.mock.calls[0];
                const persisted = JSON.parse(insertCall[1].metadata);
                expect(persisted.isPinned).toBe(true);
                expect(persisted.isDefault).toBe(false);
                expect(persisted.sortOrder).toBe(5);
                expect(persisted.objectName).toBe('lead');
            });

            it('rejects a view missing the required `columns` field with 422', async () => {
                const invalid = { name: 'bad_view', type: 'grid' }; // no columns
                let caught: any;
                try {
                    await protocol.saveMetaItem({
                        type: 'view',
                        name: 'bad_view',
                        item: invalid,
                    });
                } catch (e) { caught = e; }

                expect(caught).toBeDefined();
                expect(caught.code).toBe('invalid_metadata');
                expect(caught.status).toBe(422);
                expect(caught.message).toMatch(/invalid_metadata/);
                expect(Array.isArray(caught.issues)).toBe(true);
                expect(mockEngine.insert).not.toHaveBeenCalled();
            });

            it('rejects a dashboard with wrong-typed widgets with 422', async () => {
                const invalid = {
                    name: 'bad_dashboard',
                    label: 'Bad',
                    widgets: 'not-an-array', // must be an array of widgets
                };
                let caught: any;
                try {
                    await protocol.saveMetaItem({
                        type: 'dashboard',
                        name: 'bad_dashboard',
                        item: invalid,
                    });
                } catch (e) { caught = e; }

                expect(caught?.code).toBe('invalid_metadata');
                expect(caught?.status).toBe(422);
                expect(mockEngine.insert).not.toHaveBeenCalled();
            });

            it('skips validation for types without a registered schema (e.g. app)', async () => {
                // `app` is intentionally not in OVERLAY_VALIDATION_SCHEMAS;
                // legacy save paths must continue to work unvalidated.
                await expect(
                    protocol.saveMetaItem({
                        type: 'app',
                        name: 'test_app',
                        item: { name: 'test_app', label: 'X' }, // would fail AppSchema, but should not be checked
                    })
                ).resolves.toMatchObject({ success: true });
            });

            it('accepts plural type strings (e.g. `views`, `dashboards`)', async () => {
                await expect(
                    protocol.saveMetaItem({ type: 'views', name: 'all_leads', item: validView })
                ).resolves.toMatchObject({ success: true });
            });
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
                where: { type: 'app', name: 'test_app', state: 'active', organization_id: null }
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

        it('MetadataService is consulted BEFORE SchemaRegistry (HMR re-register wins over stale registry)', async () => {
            // Regression test for the dev-mode HMR data-reload gap:
            // CLI watcher recompiles → POSTs /api/v1/dev/metadata-events →
            // MetadataPlugin re-registers via MetadataManager → only
            // MetadataService sees the new value. SchemaRegistry was
            // populated at boot via `loadMetadataFromService` and is NOT
            // invalidated. If the protocol checks the registry first, reads
            // return stale data. The fix: consult MetadataService first.
            const stale = { name: 'case', label: 'Service Workflow' };
            const fresh = { name: 'case', label: 'Service Workflow (HMR)' };

            registry.registerItem('view', stale, 'name' as any);

            const metadataService = {
                get: vi.fn().mockResolvedValue(fresh),
            };
            const servicesRegistry = new Map<string, any>([['metadata', metadataService]]);
            const protocolWithService = new ObjectStackProtocolImplementation(
                mockEngine,
                () => servicesRegistry,
            );

            mockEngine.findOne.mockResolvedValue(null); // no sys_metadata overlay

            const result = await protocolWithService.getMetaItem({ type: 'view', name: 'case' });

            expect(result.item).toEqual(fresh);
            expect(metadataService.get).toHaveBeenCalledWith('view', 'case');
        });

        it('falls back to SchemaRegistry when MetadataService returns undefined', async () => {
            const fromRegistry = { name: 'case', label: 'From Registry' };
            registry.registerItem('view', fromRegistry, 'name' as any);

            const metadataService = {
                get: vi.fn().mockResolvedValue(undefined),
            };
            const servicesRegistry = new Map<string, any>([['metadata', metadataService]]);
            const protocolWithService = new ObjectStackProtocolImplementation(
                mockEngine,
                () => servicesRegistry,
            );

            mockEngine.findOne.mockResolvedValue(null);

            const result = await protocolWithService.getMetaItem({ type: 'view', name: 'case' });

            expect(result.item).toEqual(fromRegistry);
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
                where: { type: 'app', state: 'active', organization_id: null }
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
                where: { type: 'app', state: 'active', organization_id: null }
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

        it('should preserve sys_metadata overlay over MetadataService.list() baseline', async () => {
            // Regression: previously the MetadataService merge loop called
            // `itemMap.set(entry.name, entry)` unconditionally, blowing away
            // the customization overlay that had just been merged from
            // sys_metadata. Result: edits saved by the user disappeared from
            // every list endpoint on the next refresh (the detail endpoint
            // kept working because it uses a different code path). See
            // commit history around getMetaItems / MetadataService merge.
            const overlayDashboard = { name: 'sales_dashboard', label: 'Customized', columns: 9 };
            const baselineDashboard = { name: 'sales_dashboard', label: 'Original', columns: 12 };

            mockEngine.find.mockResolvedValue([
                {
                    type: 'dashboard',
                    name: 'sales_dashboard',
                    state: 'active',
                    metadata: JSON.stringify(overlayDashboard),
                }
            ]);

            const metadataService = {
                list: vi.fn().mockResolvedValue([baselineDashboard]),
            };
            const services = new Map<string, any>();
            services.set('metadata', metadataService);
            const scopedProtocol = new ObjectStackProtocolImplementation(
                mockEngine,
                () => services,
            );

            const result = await scopedProtocol.getMetaItems({ type: 'dashboard' });

            expect(result.items).toHaveLength(1);
            // Overlay wins; the artifact baseline must NOT overwrite it.
            expect(result.items[0]).toEqual(overlayDashboard);
            expect(metadataService.list).toHaveBeenCalledWith('dashboard');
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
                where: { state: 'active', organization_id: null }
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
            // systemFields:false avoids the auto-injected audit field set so
            // the registry stores the exact object we passed in for a tight
            // equality assertion.
            const objDef = { name: 'task', label: 'Task', fields: {}, systemFields: false };
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
