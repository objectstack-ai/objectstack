// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { MetadataPlugin } from './plugin';
import { NodeMetadataManager } from './node-metadata-manager';

vi.mock('@objectstack/core', async (orig) => {
    const real = (await orig()) as any;
    return {
        ...real,
        createLogger: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    };
});

describe('MetadataPlugin — bootstrap × watch coupling (D2)', () => {
    it('attaches a filesystem watcher in eager mode when watch=true', () => {
        const plugin = new MetadataPlugin({
            watch: true,
            config: { bootstrap: 'eager' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeDefined();
        // Cleanup
        return mgr.stopWatching();
    });

    it('attaches a filesystem watcher in lazy mode when watch=true', () => {
        const plugin = new MetadataPlugin({
            watch: true,
            config: { bootstrap: 'lazy' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeDefined();
        return mgr.stopWatching();
    });

    it('NEVER attaches a filesystem watcher in artifact-only mode', () => {
        const plugin = new MetadataPlugin({
            watch: true, // explicitly requested — must be ignored
            config: { bootstrap: 'artifact-only' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeUndefined();
    });

    it('honors watch=false in eager mode', () => {
        const plugin = new MetadataPlugin({
            watch: false,
            config: { bootstrap: 'eager' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeUndefined();
    });
});

// `MetadataPluginOptions.watch` documents its own default as `false` — the posture both
// non-test construction sites (`runtime/standalone-stack.ts`, `cli/commands/serve.ts`)
// assert explicitly, citing an EMFILE hazard: `watch: true` recursively polls the whole
// project root. The constructor used to implement the opposite, and it did so in TWO
// places — an object literal covering the omitted key, and a `?? true` fallback covering
// an explicit `undefined` — so both entry shapes are pinned here, on the OBSERVABLE
// (whether a watcher object exists) rather than on the resolved options value alone.
describe('MetadataPlugin — watch defaults to false, matching its documented contract', () => {
    it('attaches NO filesystem watcher when the caller passes no options at all', () => {
        const plugin = new MetadataPlugin();
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeUndefined();
        expect((plugin as any).options.watch).toBe(false);
    });

    it('attaches NO filesystem watcher when the `watch` key is omitted', () => {
        const plugin = new MetadataPlugin({
            config: { bootstrap: 'eager' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeUndefined();
        expect((plugin as any).options.watch).toBe(false);
    });

    it('attaches NO filesystem watcher when `watch` is explicitly undefined', () => {
        const plugin = new MetadataPlugin({
            watch: undefined,
            config: { bootstrap: 'eager' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeUndefined();
        // Normalized, not merely absent: every read of this flag — including the
        // `start()`-time FileSystemRepository `disableWatch`, which keys on `=== false`
        // rather than on a nullish fallback — must see the same resolved default.
        expect((plugin as any).options.watch).toBe(false);
    });

    it('lazy bootstrap also attaches NO filesystem watcher by default', () => {
        const plugin = new MetadataPlugin({
            config: { bootstrap: 'lazy' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeUndefined();
    });

    // CONTROL — this is a default flip, NOT a removal of the capability. Co-located with
    // the pins above deliberately: a regression that disabled watching outright would
    // leave every `toBeUndefined()` above green.
    it('still attaches a filesystem watcher when `watch: true` is explicit', () => {
        const plugin = new MetadataPlugin({
            watch: true,
            config: { bootstrap: 'eager' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeDefined();
        expect((plugin as any).options.watch).toBe(true);
        return mgr.stopWatching();
    });

    // The sealed-runtime carve-out is independent of the default and must stay intact:
    // `artifact-only` forces watching off even against an explicit `watch: true`.
    it('artifact-only bootstrap still short-circuits an explicit `watch: true`', () => {
        const plugin = new MetadataPlugin({
            watch: true,
            config: { bootstrap: 'artifact-only' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        expect((mgr as any).watcher).toBeUndefined();
        expect((plugin as any).options.watch).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// PR-10e regression: artifact view items have no top-level `name`. Their
// identity is the target object (encoded in `list.data.object` /
// `form.data.object`). When `_parseAndRegisterArtifact` consumes a
// compiled artifact it must derive the view name from the inner data
// source — otherwise views are silently SKIPPED and reads through
// `metadataService.get('view', <object>)` return undefined, falling
// back to the boot-time SchemaRegistry copy and breaking HMR data
// reload.
// ─────────────────────────────────────────────────────────────────────────
describe('MetadataPlugin._parseAndRegisterArtifact — view name resolution (PR-10e)', () => {
    it('registers view items by their target object even when top-level `name` is absent', async () => {
        const plugin = new MetadataPlugin({
            watch: false,
            config: { bootstrap: 'eager' },
            environmentId: 'proj_test',
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;

        const fakeCtx = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        } as any;

        // Manifest fields belong under `manifest:` — the flattened spelling this
        // fixture used to carry was never a compiled-artifact shape (the strip-
        // mode schema silently dropped all seven keys, and `scope: 'app'` is not
        // even a manifest scope). #8687's strict close refuses the flat keys.
        const artifact = {
            manifest: {
                id: 'com.example.test',
                name: 'test',
                version: '0.0.0',
                type: 'app',
                namespace: 'test',
                defaultDatasource: 'memory',
            },
            views: [
                {
                    // intentionally NO top-level name — mirrors compiled artifact shape
                    list: { name: 'all_case', label: 'All Cases', type: 'grid',
                            data: { provider: 'object', object: 'case' }, columns: [] },
                    listViews: {
                        case_workflow: { name: 'case_workflow', label: 'Service Workflow', type: 'kanban',
                                         data: { provider: 'object', object: 'case' }, columns: [] },
                    },
                },
            ],
        };

        await (plugin as any)._parseAndRegisterArtifact(fakeCtx, artifact, 'test-artifact');

        const registered = await mgr.get('view', 'case');
        expect(registered).toBeDefined();
        const label = (registered as any)?.listViews?.case_workflow?.label;
        expect(label).toBe('Service Workflow');
    });
});

// ─────────────────────────────────────────────────────────────────────────
// ADR-0046 regression: a compiled artifact carries package docs in a
// top-level `docs: DocSchema[]` array. The artifact loader registers only
// the metadata fields enumerated in ARTIFACT_FIELD_TO_TYPE; `docs` was
// omitted, so the bundle's docs were silently dropped and GET /meta/doc
// returned an empty list even though the package shipped docs. The field
// must map to the `doc` type so docs register like any other item.
// ─────────────────────────────────────────────────────────────────────────
describe('MetadataPlugin._parseAndRegisterArtifact — package docs (ADR-0046)', () => {
    it('registers `doc` items from the artifact `docs` array', async () => {
        const plugin = new MetadataPlugin({
            watch: false,
            config: { bootstrap: 'eager' },
            environmentId: 'proj_test',
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        const fakeCtx = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        } as any;

        // Same #8687 re-spell as above: manifest fields under `manifest:`.
        const artifact = {
            manifest: {
                id: 'com.example.docs',
                name: 'test',
                version: '0.0.0',
                type: 'app',
                namespace: 'test',
                defaultDatasource: 'memory',
            },
            docs: [
                { name: 'test_index', label: 'Overview', content: '# Overview\n' },
                { name: 'test_guide', content: '# Guide\n' },
            ],
        };

        await (plugin as any)._parseAndRegisterArtifact(fakeCtx, artifact, 'test-artifact');

        const index = await mgr.get('doc', 'test_index');
        expect(index).toBeDefined();
        expect((index as any)?.content).toContain('# Overview');
        const guide = await mgr.get('doc', 'test_guide');
        expect(guide).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Filesystem-scanner provenance: when the host declares its package id
// (options.packageId — the project's `defineStack` manifest id), scanned
// source-file metadata must be stamped `_packageId`/`_provenance` exactly
// like the artifact path, so GET /meta consumers (objectui
// NavigationSyncEffect) can tell code-defined items from user-authored
// rows. Without the option, items must stay unstamped — `_packageId`
// feeds isArtifactBacked() write authorization.
// ─────────────────────────────────────────────────────────────────────────
describe('MetadataPlugin._loadFromFileSystem — package provenance stamping', () => {
    const fakeCtx = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as any;

    it('stamps _packageId/_provenance on scanned items when options.packageId is set', async () => {
        const plugin = new MetadataPlugin({
            watch: false,
            config: { bootstrap: 'eager' },
            packageId: 'com.example.proj',
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        vi.spyOn(mgr, 'loadMany').mockImplementation(async (type: string) =>
            type === 'page' ? [{ name: 'home_page', label: 'Home' }] : []);

        await (plugin as any)._loadFromFileSystem(fakeCtx);

        const item = await mgr.get('page', 'home_page') as any;
        expect(item).toBeDefined();
        expect(item._packageId).toBe('com.example.proj');
        expect(item._provenance).toBe('package');
    });

    it('does not overwrite an item\'s pre-existing _packageId', async () => {
        const plugin = new MetadataPlugin({
            watch: false,
            config: { bootstrap: 'eager' },
            packageId: 'com.example.proj',
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        vi.spyOn(mgr, 'loadMany').mockImplementation(async (type: string) =>
            type === 'page' ? [{ name: 'vendor_page', _packageId: 'com.vendor.pkg' }] : []);

        await (plugin as any)._loadFromFileSystem(fakeCtx);

        const item = await mgr.get('page', 'vendor_page') as any;
        expect(item._packageId).toBe('com.vendor.pkg');
        expect(item._provenance).toBe('package');
    });

    it('leaves scanned items unstamped when options.packageId is not configured', async () => {
        const plugin = new MetadataPlugin({
            watch: false,
            config: { bootstrap: 'eager' },
        });
        const mgr = (plugin as any).manager as NodeMetadataManager;
        vi.spyOn(mgr, 'loadMany').mockImplementation(async (type: string) =>
            type === 'page' ? [{ name: 'plain_page', label: 'Plain' }] : []);

        await (plugin as any)._loadFromFileSystem(fakeCtx);

        const item = await mgr.get('page', 'plain_page') as any;
        expect(item).toBeDefined();
        expect(item._packageId).toBeUndefined();
        expect(item._provenance).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────
// ADR-0067 regression: the package-scoped commit log `sys_metadata_commit`
// must be registered among the queryable system objects so per-project
// (cloud) env kernels provision the table at boot. Every publish/apply
// writes a commit row via `publishPackageDrafts`; the object was omitted
// from `queryableMetadataObjects` (only the standalone ObjectQLPlugin
// `environmentId === undefined` path had it), so env builds logged
// `no such table: sys_metadata_commit` and the commit timeline recorded
// nothing. init() must register it via the manifest — next to its
// `sys_metadata_history` sibling — whenever registerSystemObjects is on.
// ─────────────────────────────────────────────────────────────────────────
describe('MetadataPlugin — system object provisioning (ADR-0067 commit log)', () => {
    function fakeCtxWithManifest() {
        const registered: any[] = [];
        const manifest = { register: vi.fn((m: any) => registered.push(m)) };
        const ctx = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            getService: vi.fn((name: string) => (name === 'manifest' ? manifest : undefined)),
        } as any;
        return { ctx, registered };
    }

    it('registers sys_metadata_commit alongside its history sibling (env kernel)', async () => {
        const plugin = new MetadataPlugin({
            watch: false,
            config: { bootstrap: 'lazy' },
            environmentId: 'proj_test',
            // registerSystemObjects defaults to true → env-kernel provisioning path
        });
        const { ctx, registered } = fakeCtxWithManifest();

        await plugin.init(ctx);

        const names = registered.flatMap((m) => m.objects ?? []).map((o: any) => o.name);
        // The bug: history present, commit absent → the table is never provisioned.
        expect(names).toContain('sys_metadata_history');
        expect(names).toContain('sys_metadata_commit');
    });

    it('registers NOTHING when registerSystemObjects=false (control-plane kernel)', async () => {
        const plugin = new MetadataPlugin({
            watch: false,
            config: { bootstrap: 'lazy' },
            environmentId: 'proj_test',
            registerSystemObjects: false,
        });
        const { ctx, registered } = fakeCtxWithManifest();

        await plugin.init(ctx);

        // Control-plane owns these tables; per-ADR they must NOT leak into a
        // kernel that opted out of system-object registration.
        expect(registered).toHaveLength(0);
    });
});
