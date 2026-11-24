// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36834 — the install-local plugin's "Installed Apps" entry
 * (`nav_marketplace_installed`) is retired: Setup's own "Packages" entry
 * (`nav_packages`, `@objectstack/platform-objects`) lists every installed
 * package on the list's administration face, and the page's Source filter
 * narrows it to marketplace installs (the maintainer's ruling 「合并，只留软件包」).
 *
 * ## What this file pins
 *
 * Read back from a REAL kernel's engine, `manifest` service and metadata
 * protocol (an `ObjectKernel` with `ObjectQLPlugin`), after the plugin's own
 * `kernel:ready` registration and the engine's ADR-0029 D7 merge of
 * `navigationContributions` into the app they name — the merge
 * `GET /api/v1/meta/app/setup` serves:
 *
 *   - plugin present: the plugin still registers `MARKETPLACE_INSTALLED_UI_BUNDLE`
 *     under its id, and Setup's `group_apps` carries no `nav_marketplace_installed`
 *     and no entry onto `developer:packages` from this package; no
 *     `marketplace_installed` page is served either (retired with #23933);
 *   - plugin absent: the same composition carries neither;
 *   - the bundle: still exported and importable, its id unchanged, with an
 *     empty `navigationContributions` and no `pages` — hosted tenants import and
 *     register it, so the export is the compatibility surface, not the entry.
 *
 * Every absence is read with a positive control: Browse Marketplace
 * (`MARKETPLACE_BROWSE_UI_BUNDLE`, registered beside it) lands in the same
 * `group_apps` through the same read, and the Cloud Connection UI bundle serves
 * its `cloud_connection_settings` page through the same page listing, so "no
 * entry" is a reading of a group that does carry plugin entries, not of an empty
 * one.
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

/** The retired entry's id, and the component every package-list entry opens. */
const RETIRED_ID = 'nav_marketplace_installed';
const PACKAGES_REF = 'developer:packages';

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
    /** The manifest ids the plugin itself registered through the `manifest` service. */
    const registered: string[] = [];

    if (withPlugin) {
        const routes = new Map<string, unknown>();
        const rawApp = {
            get: (p: string, h: unknown) => routes.set(`GET ${p}`, h),
            post: (p: string, h: unknown) => routes.set(`POST ${p}`, h),
            delete: (p: string, h: unknown) => routes.set(`DELETE ${p}`, h),
        };
        const hooks = new Map<string, () => Promise<void>>();
        const services: Record<string, unknown> = {
            manifest: {
                register(m: { id?: string }) {
                    registered.push(String(m?.id));
                    manifest.register(m);
                },
            },
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
    return { protocol, registered };
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

describe('#36834 — "Installed Apps" is retired; Setup → Packages lists what is installed', () => {
    it('plugin present: the bundle is still registered, and Setup carries no Installed Apps entry', async () => {
        const { protocol, registered } = await compose(true);
        expect(registered).toContain(MARKETPLACE_INSTALLED_UI_BUNDLE.id);

        const items = await setupAppsGroup(protocol);
        const ids = items.map((i) => i?.id);
        // Control: the read reaches the group's plugin-contributed entries.
        expect(ids).toContain('nav_marketplace_browse');
        expect(ids).not.toContain(RETIRED_ID);
        // No marketplace-filtered (or any) package-list entry from this package:
        // Setup's one door to the list is platform-objects' `nav_packages`.
        expect(items.filter((i) => i?.componentRef === PACKAGES_REF)).toEqual([]);
    });

    it('plugin present: no `marketplace_installed` page is served (control: the Cloud Connection page is)', async () => {
        const { protocol } = await compose(true);
        const pages = await servedPageNames(protocol);
        expect(pages).toContain('cloud_connection_settings');
        expect(pages).not.toContain('marketplace_installed');
    });

    it('plugin absent: the same composition carries no Installed Apps entry', async () => {
        const { protocol, registered } = await compose(false);
        expect(registered).toEqual([]);
        const ids = (await setupAppsGroup(protocol)).map((i) => i?.id);
        expect(ids).not.toContain(RETIRED_ID);
        // Control: the read reaches the group's plugin-contributed entries.
        // (Browse Marketplace, not Cloud Connection: that entry sits in
        // `group_integrations` since ruling 甲 on #25097.)
        expect(ids).toContain('nav_marketplace_browse');
    });

    it('the bundle stays exported under its id, with no nav entry and no page', () => {
        expect(MARKETPLACE_INSTALLED_UI_BUNDLE.id).toBe('com.objectstack.cloud-connection.marketplace-installed-ui');
        expect(Object.keys(MARKETPLACE_INSTALLED_UI_BUNDLE)).not.toContain('pages');
        // An array, so a host that walks it keeps working; empty, so it lands nothing.
        expect(MARKETPLACE_INSTALLED_UI_BUNDLE.navigationContributions).toEqual([]);
    });
});
