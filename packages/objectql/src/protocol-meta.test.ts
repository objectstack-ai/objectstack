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

    describe('getMetaItems draft-overlay preview (ADR-0033)', () => {
        const seedActiveAndDraft = () => mockEngine.find.mockImplementation((_t: string, opts: any) => {
            const w = opts?.where ?? {};
            if (w.type !== 'app') return Promise.resolve([]);
            if (w.state === 'active') {
                return Promise.resolve([
                    { type: 'app', name: 'shared', state: 'active', metadata: JSON.stringify({ name: 'shared', label: 'Active' }) },
                    { type: 'app', name: 'published_only', state: 'active', metadata: JSON.stringify({ name: 'published_only', label: 'Pub' }) },
                ]);
            }
            if (w.state === 'draft') {
                return Promise.resolve([
                    { type: 'app', name: 'shared', state: 'draft', package_id: 'app.x', metadata: JSON.stringify({ name: 'shared', label: 'Draft' }) },
                    { type: 'app', name: 'draft_only', state: 'draft', package_id: 'app.x', metadata: JSON.stringify({ name: 'draft_only', label: 'New' }) },
                ]);
            }
            return Promise.resolve([]);
        });

        it('overlays drafts on active when previewDrafts is set (draft wins, draft-only surfaces, _draft tagged)', async () => {
            seedActiveAndDraft();
            const result = await protocol.getMetaItems({ type: 'app', previewDrafts: true });
            const items = result.items as any[];
            expect(items.map((i) => i.name).sort()).toEqual(['draft_only', 'published_only', 'shared']);
            const shared = items.find((i) => i.name === 'shared');
            expect(shared.label).toBe('Draft');     // draft wins over active
            expect(shared._draft).toBe(true);
            const draftOnly = items.find((i) => i.name === 'draft_only');
            expect(draftOnly._draft).toBe(true);
            expect(draftOnly._packageId).toBe('app.x');
            expect(items.find((i) => i.name === 'published_only')._draft).toBeUndefined(); // active untouched
        });

        it('hides drafts by default (no previewDrafts)', async () => {
            seedActiveAndDraft();
            const result = await protocol.getMetaItems({ type: 'app' });
            const items = result.items as any[];
            expect(items.map((i) => i.name).sort()).toEqual(['published_only', 'shared']);
            expect(items.find((i) => i.name === 'shared').label).toBe('Active');
            expect(items.some((i) => i.name === 'draft_only')).toBe(false);
        });
    });

    describe('getMetaItem draft-overlay preview (ADR-0033)', () => {
        it('returns the draft when previewDrafts and a draft exists (_draft tagged, non-strict)', async () => {
            mockEngine.findOne.mockImplementation((_t: string, opts: any) => {
                const w = opts?.where ?? {};
                if (w.state === 'draft' && w.name === 'lead') {
                    return Promise.resolve({ type: 'object', name: 'lead', state: 'draft', package_id: 'app.x', metadata: JSON.stringify({ name: 'lead', label: 'Draft Lead' }) });
                }
                return Promise.resolve(null);
            });
            const res: any = await protocol.getMetaItem({ type: 'object', name: 'lead', previewDrafts: true });
            expect(res.item.label).toBe('Draft Lead');
            expect(res.item._draft).toBe(true);
        });

        it('falls back to active when previewDrafts but no draft exists (no no_draft 404)', async () => {
            mockEngine.findOne.mockImplementation((_t: string, opts: any) => {
                const w = opts?.where ?? {};
                if (w.state === 'active' && w.name === 'lead') {
                    return Promise.resolve({ type: 'object', name: 'lead', state: 'active', metadata: JSON.stringify({ name: 'lead', label: 'Active Lead' }) });
                }
                return Promise.resolve(null); // no draft row
            });
            const res: any = await protocol.getMetaItem({ type: 'object', name: 'lead', previewDrafts: true });
            expect(res.item.label).toBe('Active Lead');
            expect(res.item._draft).toBeUndefined();
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
                    // ADR-0021 single-form: widgets bind a dataset + select values by name.
                    dataset: 'opportunity_metrics',
                    values: ['amount_sum'],
                    layout: { x: 0, y: 0, w: 3, h: 2 },
                }],
            };

            it('accepts a spec-conformant view payload', async () => {
                await expect(
                    protocol.saveMetaItem({ type: 'view', name: 'all_leads', item: validView })
                ).resolves.toMatchObject({ success: true });
                expect(mockEngine.insert).toHaveBeenCalled();
            });

            it('accepts a container-shape view payload (list + listViews)', async () => {
                // This is the shape `defineView()`, Studio's metadata designer,
                // and artifact-shipped views (e.g. service-ai/ai_traces) all
                // produce. It conforms to `@objectstack/spec` ViewSchema, not
                // ListViewSchema. Regression guard for the bug where the
                // overlay validator picked ListViewSchema for every `view`
                // and rejected the container with `columns: Invalid input`.
                const containerView = {
                    name: 'ai_traces',
                    list: {
                        type: 'grid',
                        data: { provider: 'object', object: 'ai_traces' },
                        columns: [{ field: 'created_at' }],
                    },
                    listViews: {
                        errors: {
                            label: 'Errors',
                            type: 'grid',
                            data: { provider: 'object', object: 'ai_traces' },
                            columns: [{ field: 'error' }],
                        },
                    },
                    _packageId: 'com.objectstack.service-ai',
                };
                await expect(
                    protocol.saveMetaItem({ type: 'view', name: 'ai_traces', item: containerView })
                ).resolves.toMatchObject({ success: true });
            });

            it('accepts a container-shape view payload (form only)', async () => {
                const formContainer = {
                    name: 'lead_form_only',
                    form: {
                        type: 'tabbed',
                        data: { provider: 'object', object: 'lead' },
                        sections: [{ id: 'main', title: 'Main', fields: [{ field: 'first_name' }] }],
                    },
                };
                await expect(
                    protocol.saveMetaItem({ type: 'view', name: 'lead_form_only', item: formContainer })
                ).resolves.toMatchObject({ success: true });
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

            it('rejects an invalid view (container with a listView missing `columns`) with 422', async () => {
                // The `defineView` container shape (left intact by the view-write
                // normalizer) is strictly validated: a named sub-view missing the
                // required `columns` is rejected.
                const invalid = {
                    list: { type: 'grid', data: { provider: 'object', object: 'lead' }, columns: ['name'] },
                    listViews: {
                        bad: { type: 'grid', data: { provider: 'object', object: 'lead' } }, // columns missing
                    },
                };
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

            it('validates types via the central spec registry (e.g. app)', async () => {
                // Every overlay-allowed built-in type now has a canonical Zod
                // schema registered in `getMetadataTypeSchema()`. An app
                // payload with a non-snake_case `name` must be rejected.
                let caught: any;
                try {
                    await protocol.saveMetaItem({
                        type: 'app',
                        name: 'BadApp',
                        item: { name: 'BadApp', label: 'X' }, // name violates snake_case
                    });
                } catch (e) { caught = e; }

                expect(caught?.code).toBe('invalid_metadata');
                expect(caught?.status).toBe(422);
                expect(mockEngine.insert).not.toHaveBeenCalled();
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
            expect(result.item).toMatchObject(sampleApp);
            expect(mockEngine.findOne).toHaveBeenCalledWith('sys_metadata', expect.objectContaining({
                where: expect.objectContaining({ type: 'app', name: 'test_app', state: 'active' }),
            }));
        });

        it('should fall back to registry when no overlay row exists', async () => {
            registry.registerItem('app', sampleApp, 'name');
            mockEngine.findOne.mockResolvedValue(null);

            const result = await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            expect(result.item).toMatchObject(sampleApp);
        });

        it('should return overlay row content from DB when present', async () => {
            mockEngine.findOne.mockResolvedValue({
                type: 'app',
                name: 'test_app',
                state: 'active',
                metadata: JSON.stringify(sampleApp),
            });

            const result = await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            expect(result.item).toMatchObject(sampleApp);
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

            expect(result.item).toMatchObject(sampleApp);
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

            expect(result.item).toMatchObject(fresh);
            // The third arg is the package-scoped resolution hint (ADR-0048),
            // undefined here since the request carries no packageId.
            expect(metadataService.get).toHaveBeenCalledWith('view', 'case', undefined);
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

            expect(result.item).toMatchObject(fromRegistry);
        });

        it('resolves a same-name collision to the requesting package (ADR-0048 prefer-local)', async () => {
            // Two installed packages each ship `doc/intro`; the registry stores
            // them under composite keys `${packageId}:intro`. A single-item GET
            // carrying `packageId` must resolve to that package's own item.
            registry.registerItem('doc', { name: 'intro', content: '# Studio' }, 'name' as any, 'com.objectstack.studio');
            registry.registerItem('doc', { name: 'intro', content: '# Setup' }, 'name' as any, 'com.objectstack.setup');

            mockEngine.findOne.mockResolvedValue(null); // no sys_metadata overlay

            const studio = await protocol.getMetaItem({ type: 'doc', name: 'intro', packageId: 'com.objectstack.studio' });
            const setup = await protocol.getMetaItem({ type: 'doc', name: 'intro', packageId: 'com.objectstack.setup' });

            expect((studio.item as any).content).toBe('# Studio');
            expect((setup.item as any).content).toBe('# Setup');
        });

        it('package-scoped overlay read prefers the row owned by the requesting package (ADR-0048)', async () => {
            // sys_metadata holds two `doc/intro` rows differing only by package_id.
            // The overlay lookup must filter on package_id when one is supplied.
            const rows: Record<string, any> = {
                'com.objectstack.studio': { type: 'doc', name: 'intro', state: 'active', package_id: 'com.objectstack.studio', metadata: { name: 'intro', content: '# Studio overlay' } },
                'com.objectstack.setup': { type: 'doc', name: 'intro', state: 'active', package_id: 'com.objectstack.setup', metadata: { name: 'intro', content: '# Setup overlay' } },
            };
            // findOne(collection, query) — the package-scoped query carries
            // `package_id`; the package-less fallback query must miss (null).
            mockEngine.findOne.mockImplementation(async (_collection: string, query: any) =>
                query?.where?.package_id ? (rows[query.where.package_id] ?? null) : null,
            );

            const studio = await protocol.getMetaItem({ type: 'doc', name: 'intro', packageId: 'com.objectstack.studio' });
            const setup = await protocol.getMetaItem({ type: 'doc', name: 'intro', packageId: 'com.objectstack.setup' });

            expect((studio.item as any).content).toBe('# Studio overlay');
            expect((setup.item as any).content).toBe('# Setup overlay');
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

            expect(result.item).toMatchObject(complexData);
        });

        it('should handle metadata already parsed as object from DB', async () => {
            mockEngine.findOne.mockResolvedValue({
                type: 'app',
                name: 'test_app',
                state: 'active',
                metadata: sampleApp, // already an object, not a string
            });

            const result = await protocol.getMetaItem({ type: 'app', name: 'test_app' });

            expect(result.item).toMatchObject(sampleApp);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // getMetaItemCached — locale-aware ETag (#1319)
    // ═══════════════════════════════════════════════════════════════
    //
    // The REST layer translates the response body AFTER this validator runs,
    // so the ETag must vary by locale — otherwise a language switch matches
    // the prior `If-None-Match` and returns a stale-locale 304.

    describe('getMetaItemCached locale-aware ETag', () => {
        const sampleObject = { name: 'customer', label: 'Customer' };

        beforeEach(() => {
            // Serve the item from a sys_metadata overlay row so the read
            // succeeds without tripping SchemaRegistry validation on a
            // deliberately-minimal object def.
            mockEngine.findOne.mockResolvedValue({
                type: 'object',
                name: 'customer',
                state: 'active',
                metadata: JSON.stringify(sampleObject),
            });
        });

        it('produces distinct ETags for distinct locales', async () => {
            const en = await protocol.getMetaItemCached({ type: 'object', name: 'customer', locale: 'en' });
            const zh = await protocol.getMetaItemCached({ type: 'object', name: 'customer', locale: 'zh-CN' });
            expect(en.etag?.value).toBeTruthy();
            expect(zh.etag?.value).toBeTruthy();
            expect(en.etag?.value).not.toBe(zh.etag?.value);
        });

        it('returns a fresh 200 (not 304) when the cached ETag is from another locale', async () => {
            const en = await protocol.getMetaItemCached({ type: 'object', name: 'customer', locale: 'en' });
            // Client re-requests after switching to zh-CN, replaying the en ETag.
            const zh = await protocol.getMetaItemCached({
                type: 'object',
                name: 'customer',
                locale: 'zh-CN',
                cacheRequest: { ifNoneMatch: `"${en.etag?.value}"` },
            });
            expect(zh.notModified).toBe(false);
            expect(zh.data).toBeDefined();
        });

        it('still returns 304 when the same locale revalidates with a matching ETag', async () => {
            const first = await protocol.getMetaItemCached({ type: 'object', name: 'customer', locale: 'zh-CN' });
            const second = await protocol.getMetaItemCached({
                type: 'object',
                name: 'customer',
                locale: 'zh-CN',
                cacheRequest: { ifNoneMatch: `"${first.etag?.value}"` },
            });
            expect(second.notModified).toBe(true);
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

        it('serves _packageId/_provenance for items registered with a source package id', async () => {
            // Package-shipped item — registered with its real package id, as
            // the engine manifest path and the metadata-service sync both do.
            registry.registerItem('page', { name: 'pkg_page', label: 'Pkg Page' }, 'name', 'com.example.crm');
            // Runtime-authored item — no package id, must stay unstamped so
            // clients can tell the two apart (objectui NavigationSyncEffect).
            registry.registerItem('page', { name: 'user_page', label: 'User Page' }, 'name');
            mockEngine.find.mockResolvedValue([]);

            const result = await protocol.getMetaItems({ type: 'page' });

            const pkgPage = result.items.find((i: any) => i.name === 'pkg_page');
            expect(pkgPage._packageId).toBe('com.example.crm');
            expect(pkgPage._provenance).toBe('package');

            const userPage = result.items.find((i: any) => i.name === 'user_page');
            expect(userPage._packageId).toBeUndefined();
            expect(userPage._provenance).toBeUndefined();
        });

        it('keeps each colliding item\'s own _packageId on the list (ADR-0048)', async () => {
            // Two installed packages ship `page/home`. The list decorate step
            // grafts artifact protection per item; that lookup must be scoped to
            // EACH item's owning package, or both rows inherit the first-match
            // package's `_packageId` and the frontend prefer-local (which filters
            // by `_packageId`) can no longer tell them apart.
            registry.registerItem('page', { name: 'home', label: 'Acme Home' }, 'name', 'com.acme.crm');
            registry.registerItem('page', { name: 'home', label: 'Globex Home' }, 'name', 'com.globex.crm');
            mockEngine.find.mockResolvedValue([]);

            const result = await protocol.getMetaItems({ type: 'page' });
            const homes = result.items.filter((i: any) => i.name === 'home');

            expect(homes).toHaveLength(2);
            const byPkg = Object.fromEntries(homes.map((h: any) => [h._packageId, h.label]));
            expect(byPkg['com.acme.crm']).toBe('Acme Home');
            expect(byPkg['com.globex.crm']).toBe('Globex Home');
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
            expect(result.items[0]).toMatchObject(sampleApp);
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
            expect(result.items[0]).toMatchObject(overlayDashboard);
            expect(metadataService.list).toHaveBeenCalledWith('dashboard');
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // ADR-0029 D7 — navigation contributions reach the serving path
    //
    // Regression: the setup app is a shell of empty group anchors; menu
    // entries are injected as navigation contributions and merged lazily on
    // read. `registry.getApp` / `getAllApps` did the merge, but the REST app
    // endpoints read through `protocol.getMetaItems` / `getMetaItem`, which
    // returned the raw shell — leaving every Setup menu group empty.
    // ═══════════════════════════════════════════════════════════════

    describe('app navigation contributions (ADR-0029 D7)', () => {
        const shellApp = {
            name: 'setup',
            label: 'Setup',
            navigation: [
                { id: 'group_diagnostics', type: 'group', label: 'Diagnostics', children: [] },
            ],
        };

        const contribution = {
            app: 'setup',
            group: 'group_diagnostics',
            priority: 100,
            items: [{ id: 'nav_audit_logs', type: 'object', label: 'Audit Logs', objectName: 'sys_audit_log' }],
        };

        it('getMetaItems({type:"app"}) merges contributions into the served app', async () => {
            registry.registerItem('app', shellApp, 'name');
            registry.registerAppNavContribution(contribution, 'platform-objects');

            const result = await protocol.getMetaItems({ type: 'app' });

            const setup = (result.items as any[]).find((a) => a.name === 'setup');
            expect(setup).toBeDefined();
            const group = setup.navigation.find((g: any) => g.id === 'group_diagnostics');
            expect(group.children).toHaveLength(1);
            expect(group.children[0].id).toBe('nav_audit_logs');
            // The stored shell is never mutated — repeated reads stay idempotent.
            expect((registry.getItem('app', 'setup') as any).navigation[0].children).toHaveLength(0);
        });

        it('getMetaItem({type:"app"}) merges contributions for a single-app fetch', async () => {
            registry.registerItem('app', shellApp, 'name');
            registry.registerAppNavContribution(contribution, 'platform-objects');

            const result = await protocol.getMetaItem({ type: 'app', name: 'setup' });

            const group = (result.item as any).navigation.find((g: any) => g.id === 'group_diagnostics');
            expect(group.children).toHaveLength(1);
            expect(group.children[0].id).toBe('nav_audit_logs');
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
            // Object schemas pass through registerObject -> applyProtection (ADR-0010 §3.7),
            // which stamps the internal `_packageId`/`_provenance` envelope markers used by
            // listItems() filtering, the HTTP dispatcher and the runtime. Those are an
            // intentional, system-wide concern — assert the author-supplied shape is preserved
            // rather than demanding strict equality against them.
            expect(registry.getItem('object', 'task')).toMatchObject(objDef);
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

    // ═══════════════════════════════════════════════════════════════
    // ADR-0005 PR-10d.7 — two-tier metadata authorization model.
    //
    // For types declaring `allowOrgOverride:false, allowRuntimeCreate:true`
    // (hook, trigger, validation), the per-item provenance decides:
    //
    //  • Item exists in the SchemaRegistry tagged with `_packageId`
    //    (i.e. shipped from a code package)   →   write rejected with 403
    //                                              not_overridable.
    //  • Item does NOT exist as a packaged artifact (registry miss OR
    //    registry hit with no `_packageId`)   →   write accepted; persists
    //                                              to sys_metadata as a
    //                                              user-created DB item.
    //
    // Verifies the security boundary (artifact-shipped code is never
    // mutable at runtime) while restoring the "I can author my own hooks"
    // capability the spec always intended.
    // ═══════════════════════════════════════════════════════════════

    describe('two-tier authorization (PR-10d.7)', () => {
        let scoped: ObjectStackProtocolImplementation;

        beforeEach(() => {
            // Project-kernel mode (environmentId set) so the gate engages.
            scoped = new ObjectStackProtocolImplementation(
                mockEngine,
                undefined,
                undefined,
                'env_alpha',
            );
        });

        it('rejects modifying an artifact-backed hook with not_overridable', async () => {
            // Simulate the artifact loader having registered a code-shipped
            // hook. The `_packageId` tag is the trusted artifact-origin
            // marker (set by registerItem when called with a packageId).
            registry.registerItem(
                'hook',
                { name: 'shipped_hook', object: 'case', events: ['beforeUpdate'] },
                'name' as any,
                'crm-plugin',
            );

            await expect(
                scoped.saveMetaItem({
                    type: 'hook',
                    name: 'shipped_hook',
                    item: { name: 'shipped_hook', object: 'case', events: ['beforeInsert'] },
                    organizationId: 'org_alpha',
                }),
            ).rejects.toMatchObject({
                code: 'not_overridable',
                status: 403,
            });
        });

        it('accepts brand-new hook (no artifact at this name)', async () => {
            mockEngine.findOne.mockResolvedValue(null);

            const result = await scoped.saveMetaItem({
                type: 'hook',
                name: 'my_user_hook',
                item: { name: 'my_user_hook', object: 'case', events: ['beforeUpdate'] },
                organizationId: 'org_alpha',
            });

            expect(result.success).toBe(true);
            expect(mockEngine.insert).toHaveBeenCalled();
        });

        it('accepts editing an existing DB-only hook (no artifact)', async () => {
            // DB-only items: the seeder / prior saveMetaItem may rehydrate
            // them into the registry without a packageId. Such items must
            // still be editable.
            registry.registerItem(
                'hook',
                { name: 'my_user_hook', object: 'case', events: ['beforeUpdate'] },
                'name' as any,
            ); // no packageId arg — DB-rehydration parity

            mockEngine.findOne.mockResolvedValue(null);

            const result = await scoped.saveMetaItem({
                type: 'hook',
                name: 'my_user_hook',
                item: { name: 'my_user_hook', object: 'case', events: ['beforeInsert', 'beforeUpdate'] },
                organizationId: 'org_alpha',
            });

            expect(result.success).toBe(true);
        });

        it('accepts brand-new trigger and validation (allowRuntimeCreate:true)', async () => {
            mockEngine.findOne.mockResolvedValue(null);

            const triggerResult = await scoped.saveMetaItem({
                type: 'trigger',
                name: 'my_trigger',
                item: { name: 'my_trigger', object: 'case', event: 'beforeInsert' },
                organizationId: 'org_alpha',
            });
            const validationResult = await scoped.saveMetaItem({
                type: 'validation',
                name: 'my_validation',
                item: {
                    name: 'my_validation',
                    type: 'script',
                    message: 'Amount must be positive',
                    condition: 'record.amount < 0',
                },
                organizationId: 'org_alpha',
            });

            expect(triggerResult.success).toBe(true);
            expect(validationResult.success).toBe(true);
        });

        it('rejects brand-new function with not_creatable (allowRuntimeCreate:false)', async () => {
            // `function` has BOTH flags false → no runtime authoring allowed.
            await expect(
                scoped.saveMetaItem({
                    type: 'function',
                    name: 'my_fn',
                    item: { name: 'my_fn', handler: 'index.ts' },
                    organizationId: 'org_alpha',
                }),
            ).rejects.toMatchObject({
                code: 'not_creatable',
                status: 403,
            });
        });

        // ───────────────────────────────────────────────────────────────
        // Regression: plugin-registered types (no static registry entry)
        //
        // `theme`, `api`, `connector`, `data`, `mapping`, `policy`,
        // `sharing_rule`, `webhook`, `analytics_cube`, `package` are
        // registered by plugins at runtime — not in
        // DEFAULT_METADATA_TYPE_REGISTRY. `getMetaTypes()` synthesises
        // descriptors with `allowRuntimeCreate: true` for them so the
        // admin UI advertises them as writable. The write gate must
        // agree, otherwise users see "writable" types 403 on save.
        //
        // Before fix: gate keyed off the static registry only, rejecting
        // these 10+ types with not_creatable / 403.
        // ───────────────────────────────────────────────────────────────

        it('accepts brand-new plugin-registered type (no static registry entry)', async () => {
            mockEngine.findOne.mockResolvedValue(null);

            const themeResult = await scoped.saveMetaItem({
                type: 'theme',
                name: 'my_theme',
                item: { name: 'my_theme', label: 'Test', tokens: {} },
                organizationId: 'org_alpha',
            });
            const apiResult = await scoped.saveMetaItem({
                type: 'api',
                name: 'my_api',
                item: { name: 'my_api', path: '/x', method: 'GET' },
                organizationId: 'org_alpha',
            });
            const webhookResult = await scoped.saveMetaItem({
                type: 'webhook',
                name: 'my_webhook',
                item: { name: 'my_webhook', url: 'https://e.example/x', events: ['x.created'] },
                organizationId: 'org_alpha',
            });

            expect(themeResult.success).toBe(true);
            expect(apiResult.success).toBe(true);
            expect(webhookResult.success).toBe(true);
        });

        it('artifact-backed view (allowOrgOverride:true) still overlays cleanly', async () => {
            // Regression: types that DO allow overlays must keep working
            // even when the item is artifact-backed.
            const viewBase = { name: 'case_grid', type: 'grid' as const, object: 'case', columns: [{ field: 'name' }] };
            registry.registerItem('view', viewBase, 'name' as any, 'crm-plugin');
            mockEngine.findOne.mockResolvedValue(null);

            const result = await scoped.saveMetaItem({
                type: 'view',
                name: 'case_grid',
                item: { ...viewBase, columns: [{ field: 'name' }, { field: 'status' }] },
                organizationId: 'org_alpha',
            });
            expect(result.success).toBe(true);
        });

        // ───────────────────────────────────────────────────────────────
        // Read-path semantics for runtime-create types
        //
        // hook/trigger/validation declare supportsOverlay:false but
        // allowRuntimeCreate:true. The read path must still surface
        // sys_metadata rows for these types — otherwise the user could
        // write a hook (PUT 200) but never read it back. These tests
        // pin down the empirical behavior so future refactors of the
        // read path do not silently regress it.
        // ───────────────────────────────────────────────────────────────

        it('getMetaItem returns sys_metadata row for runtime-create types (hook)', async () => {
            const userHook = {
                name: 'my_runtime_hook',
                object: 'case',
                events: ['beforeUpdate'],
                handler: 'my_runtime_hook',
                body: { language: 'js', source: '// noop', capabilities: [] },
            };
            mockEngine.findOne.mockResolvedValue({
                type: 'hook',
                name: 'my_runtime_hook',
                state: 'active',
                metadata: JSON.stringify(userHook),
            });

            const result = await scoped.getMetaItem({ type: 'hook', name: 'my_runtime_hook' });

            expect(result.item).toMatchObject(userHook);
            // The first call must query sys_metadata — proves the read
            // path consults the DB regardless of supportsOverlay:false.
            expect(mockEngine.findOne).toHaveBeenCalledWith(
                'sys_metadata',
                expect.objectContaining({
                    where: expect.objectContaining({ type: 'hook', name: 'my_runtime_hook', state: 'active' }),
                }),
            );
        });

        it('getMetaItems unions artifact + DB-only items for runtime-create types', async () => {
            // Simulate: artifact ships one hook, user authored another.
            const artifactHook = {
                name: 'shipped_hook',
                object: 'case',
                events: ['beforeUpdate'],
                handler: 'shipped_hook',
                body: { language: 'js', source: '// shipped', capabilities: [] },
            };
            registry.registerItem('hook', artifactHook, 'name' as any, 'crm-plugin');

            // Engine.find returns the user-authored row from sys_metadata.
            mockEngine.find = vi.fn().mockResolvedValue([
                {
                    type: 'hook',
                    name: 'my_runtime_hook',
                    state: 'active',
                    metadata: JSON.stringify({
                        name: 'my_runtime_hook',
                        object: 'case',
                        events: ['beforeInsert'],
                        handler: 'my_runtime_hook',
                        body: { language: 'js', source: '// user', capabilities: [] },
                    }),
                },
            ]);

            const result = await scoped.getMetaItems({ type: 'hook' });

            const names = (result.items ?? []).map((i: any) => i.name).sort();
            expect(names).toContain('my_runtime_hook');
            expect(names).toContain('shipped_hook');
        });

        // ───────────────────────────────────────────────────────────────
        // Object provenance edge case
        //
        // `loadMetaFromDb` registers DB-rehydrated objects with a
        // synthetic packageId of `'sys_metadata'`. Without the sentinel
        // filter in `isArtifactBacked`, a DB-only object would be
        // misclassified as artifact-backed. Object is allowOrgOverride:true
        // so the gate still passes either way, but this test pins down
        // the classification so future refactors do not regress the
        // semantic distinction (which matters for any future type that
        // shares the same loadMetaFromDb registration pattern).
        // ───────────────────────────────────────────────────────────────

        it('does not classify DB-only objects as artifact-backed (sys_metadata sentinel)', async () => {
            // Mirror what loadMetaFromDb does for an object with no real
            // artifact origin.
            registry.registerObject(
                {
                    name: 'crm_quote',
                    label: 'Quote',
                    fields: { name: { type: 'text' as const } },
                } as any,
                'sys_metadata',
            );
            mockEngine.findOne.mockResolvedValue(null);

            const result = await scoped.saveMetaItem({
                type: 'object',
                name: 'crm_quote',
                item: {
                    name: 'crm_quote',
                    label: 'Quote',
                    fields: { name: { type: 'text' }, amount: { type: 'number' } },
                } as any,
                organizationId: 'org_alpha',
            });
            // The relaxed save path must succeed — proving the sentinel
            // is not treated as a real artifact origin.
            expect(result.success).toBe(true);
        });
    });
});
