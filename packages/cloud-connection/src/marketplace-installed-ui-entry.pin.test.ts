// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23933 — the install-local plugin's "Installed Apps" entry opens Setup →
 * Packages filtered to Source = marketplace (ruling B on #23892, record
 * 6216295104), and the plugin no longer ships a page of its own.
 *
 * ## What this file pins
 *
 * Read back from a REAL kernel's engine, `manifest` service and metadata
 * protocol (an `ObjectKernel` with `ObjectQLPlugin`), after the plugin's own
 * `kernel:ready` registration and the engine's ADR-0029 D7 merge of
 * `navigationContributions` into the app they name — the merge
 * `GET /api/v1/meta/app/setup` serves:
 *
 *   - plugin present: Setup's `group_apps` carries `nav_marketplace_installed`,
 *     a `component` entry on `developer:packages` (the component Setup's own
 *     "Packages" entry opens) with `params: { source: 'marketplace' }`, label
 *     and icon unchanged; and no `marketplace_installed` page is served;
 *   - plugin absent: the same composition carries no such entry — the entry
 *     lives and dies with the capability (cloud ADR-0009).
 *
 * The page listing is read with a positive control: the Cloud Connection UI
 * bundle registered beside it serves its `cloud_connection_settings` page
 * through the same read, so "no `marketplace_installed`" is a reading of a
 * listing that does carry plugin pages, not of an empty one.
 *
 * ## The filter spelling is objectui's, copied — not derived here
 *
 * `source` and `marketplace` are the spelling objectui#12675 published, read at
 * the commit objectstack's `.objectui-sha` pins (`5e15928b4631`, which carries
 * that card's merge `9d857c998c` as an ancestor): `packageSource.ts` declares
 * `PACKAGES_SOURCE_PARAM = 'source'` and `PACKAGE_SOURCES = ['code',
 * 'marketplace', 'authored']`, and its Packages page refuses any other value by
 * name. The console's sidebar sends a `component` entry's `params` as the
 * query string (`NavigationRenderer`'s `resolveHref`), so this entry opens
 * `/apps/APP/component/developer/packages?source=marketplace`. A different
 * spelling here would open a refusal, not a filtered list — this pin is what
 * holds the two repositories' halves to one word.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The plugin reaches `@objectstack/runtime` through a lazy `import()`; its first
// load is paid here, at module top, never inside a clocked `it`.
import '@objectstack/runtime';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { MARKETPLACE_BROWSE_UI_BUNDLE, MARKETPLACE_INSTALLED_UI_BUNDLE } from './marketplace-ui.js';
import { CLOUD_CONNECTION_UI_BUNDLE } from './cloud-connection-ui.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Bag = Record<string, any>;

/** The entry as objectui#12675 published it for a Setup nav item. */
const FILTERED_PACKAGES_ENTRY = {
    id: 'nav_marketplace_installed',
    type: 'component',
    label: 'Installed Apps',
    componentRef: 'developer:packages',
    params: { source: 'marketplace' },
    icon: 'package-check',
};

/**
 * A Setup shell with the group anchor the entry lands in, and the one the Cloud
 * Connection UI bundle's entry lands in (`group_integrations`, ruling 甲 on
 * #25097), so no contribution in this composition misses its group. The real
 * shell (`SETUP_APP` in `@objectstack/platform-objects`) is not a dependency of
 * this package; the merge under test is the engine's, which reads an anchor by
 * id.
 */
const SETUP_SHELL = {
    id: 'test.setup-shell',
    namespace: 'sys',
    version: '0.0.0',
    type: 'plugin',
    scope: 'system',
    name: 'Setup shell (test)',
    apps: [{
        name: 'setup',
        label: 'Setup',
        navigation: [
            { id: 'group_apps', type: 'group', label: 'Apps', children: [] },
            { id: 'group_integrations', type: 'group', label: 'Integrations', children: [] },
        ],
    }],
};

/**
 * A driver holding no row of anything. The protocol's reads consult the stored
 * rows (`sys_metadata`) besides the registry; the plugin registers in memory,
 * so the store holds none and every answer below comes from the registry.
 */
const EMPTY_STORE = {
    name: 'empty-store',
    version: '0.0.0',
    supports: {},
    connect: async () => undefined,
    disconnect: async () => undefined,
    find: async () => [],
    findOne: async () => null,
    count: async () => 0,
};

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-installed-entry-')); });
afterEach(async () => {
    while (kernels.length) {
        const k = kernels.pop()!;
        if (k.getState() === 'running') await k.shutdown();
    }
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * A real kernel carrying the Setup shell, the Cloud Connection UI bundle (the
 * page-listing control) and the marketplace browse bundle (the `group_apps`
 * control: a plugin-contributed entry in the group this file reads), with the
 * install-local plugin booted to `kernel:ready` when `withPlugin`.
 */
async function compose(withPlugin: boolean) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';
    ql.registerDriver(EMPTY_STORE as never, true);
    const manifest = kernel.getService<{ register(m: unknown): void }>('manifest');
    manifest.register(structuredClone(SETUP_SHELL));
    manifest.register(structuredClone(CLOUD_CONNECTION_UI_BUNDLE));
    manifest.register(structuredClone(MARKETPLACE_BROWSE_UI_BUNDLE));
    const protocol = kernel.getService<any>('protocol');

    if (withPlugin) {
        const routes = new Map<string, unknown>();
        const rawApp = {
            get: (p: string, h: unknown) => routes.set(`GET ${p}`, h),
            post: (p: string, h: unknown) => routes.set(`POST ${p}`, h),
            delete: (p: string, h: unknown) => routes.set(`DELETE ${p}`, h),
        };
        const hooks = new Map<string, () => Promise<void>>();
        const services: Record<string, unknown> = {
            manifest,
            protocol,
            metadata: kernel.getService('metadata'),
            auth: installerAuthService(),
            objectql: withInstallerGrants({
                convertPackageBodyForward: (body: unknown) => ql.convertPackageBodyForward(body),
                registry: ql.registry,
                syncSchemas: async () => undefined,
            }),
        };
        const ctx = {
            hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                if (!(name in services)) throw new Error(`no ${name}`);
                return services[name];
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        };
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as never);
        await hooks.get('kernel:ready')?.();
    }
    return { protocol };
}

/** Setup's `group_apps` entries, as the metadata protocol serves the merged app. */
async function setupAppsGroup(protocol: any): Promise<Bag[]> {
    const res = await protocol.getMetaItem({ type: 'app', name: 'setup' });
    const navigation: Bag[] = res?.item?.navigation ?? [];
    const group = navigation.find((g) => g?.id === 'group_apps');
    expect(group, 'the Setup shell\'s group_apps anchor is served').toBeDefined();
    return (group?.children ?? []) as Bag[];
}

/** The page names `GET /api/v1/meta/page` serves. */
async function servedPageNames(protocol: any): Promise<string[]> {
    const res = await protocol.getMetaItems({ type: 'page' });
    const items: Bag[] = Array.isArray(res) ? res : res?.items ?? [];
    return items.map((it) => it?.name).filter((n): n is string => typeof n === 'string');
}

describe('#23933 — "Installed Apps" opens Setup → Packages filtered to Source = marketplace', () => {
    it('plugin present: the served entry is the filtered Packages component, label and icon unchanged', async () => {
        const { protocol } = await compose(true);
        const entries = (await setupAppsGroup(protocol)).filter((i) => i?.id === 'nav_marketplace_installed');
        expect(entries).toHaveLength(1);
        const entry = entries[0]!;
        expect({
            id: entry.id,
            type: entry.type,
            label: entry.label,
            componentRef: entry.componentRef,
            params: entry.params,
            icon: entry.icon,
        }).toEqual(FILTERED_PACKAGES_ENTRY);
        // The page target is gone from the entry, not carried beside the new one.
        expect(entry.pageName).toBeUndefined();
    });

    it('plugin present: no `marketplace_installed` page is served (control: the Cloud Connection page is)', async () => {
        const { protocol } = await compose(true);
        const pages = await servedPageNames(protocol);
        expect(pages).toContain('cloud_connection_settings');
        expect(pages).not.toContain('marketplace_installed');
    });

    it('plugin absent: the same composition carries no Installed Apps entry', async () => {
        const { protocol } = await compose(false);
        const ids = (await setupAppsGroup(protocol)).map((i) => i?.id);
        expect(ids).not.toContain('nav_marketplace_installed');
        // Control: the read reaches the group's plugin-contributed entries.
        // (Browse Marketplace, not Cloud Connection: that entry sits in
        // `group_integrations` since ruling 甲 on #25097.)
        expect(ids).toContain('nav_marketplace_browse');
    });

    it('the bundle ships the entry and no page', () => {
        expect(Object.keys(MARKETPLACE_INSTALLED_UI_BUNDLE)).not.toContain('pages');
        const items = MARKETPLACE_INSTALLED_UI_BUNDLE.navigationContributions.flatMap((c) => c.items);
        expect(items).toEqual([FILTERED_PACKAGES_ENTRY]);
    });
});
