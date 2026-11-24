// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Marketplace — plugin-owned Setup navigation (cloud ADR-0009: cloud
 * functionality ships as plugins carrying their FULL UI surface).
 *
 * Ownership moved here from `@objectstack/platform-objects`'
 * setup-nav.contributions.ts (ADR-0029 K2's standing direction): the nav
 * entry now lives and dies with the capability —
 *
 *   - no MarketplaceProxyPlugin mounted (`OS_CLOUD_URL=off`) → no
 *     "Browse Marketplace" entry → no dead page.
 *
 * "Browse Marketplace" still points at the console's marketplace route. What
 * is installed is listed by Setup → Packages (`nav_packages`, owned by
 * `@objectstack/platform-objects`), whose marketplace rows carry the actions
 * the plugin's own Installed Apps page used to (Details, Uninstall); the
 * marketplace-filtered "Installed Apps" entry retired (objectstack#36834).
 */

/** "Browse Marketplace" — owned by the browse capability (the proxy). */
export const MARKETPLACE_BROWSE_UI_BUNDLE = {
    id: 'com.objectstack.cloud-connection.marketplace-browse-ui',
    namespace: 'sys',
    version: '0.1.0',
    type: 'plugin',
    scope: 'system',
    name: 'Marketplace Browse UI',
    description: 'Setup navigation for the public marketplace catalog (browse).',
    navigationContributions: [
        {
            app: 'setup',
            group: 'group_apps',
            priority: 100,
            items: [
                { id: 'nav_marketplace_browse', type: 'url', label: 'Browse Marketplace', url: '/apps/setup/system/marketplace', icon: 'store' },
            ],
        },
    ],
};

/**
 * The local-install capability's Setup UI bundle — registered by
 * `MarketplaceInstallLocalPlugin` at `kernel:ready`, and by hosted tenants
 * that import it from this package. It now carries NO navigation entry.
 *
 * Its one entry, "Installed Apps" (`nav_marketplace_installed`), opened the
 * console's `developer:packages` list filtered to marketplace installs
 * (`params: { source: 'marketplace' }`). It retired with objectstack#36834:
 * Setup's own "Packages" entry (`nav_packages`, `@objectstack/platform-objects`'
 * Setup nav contributions) opens that same list on its administration face,
 * every source, and the page's Source filter narrows it to marketplace
 * installs. A bookmarked `?source=marketplace` link still opens the list
 * filtered.
 *
 * The bundle stays exported and registrable under its id, with an empty
 * `navigationContributions`, so every host that registers it keeps compiling
 * and booting while it drops the registration on its own schedule. The
 * `marketplace_installed` page it used to ship (cloud ADR-0009 P2a) retired
 * earlier, with #23933.
 */
export const MARKETPLACE_INSTALLED_UI_BUNDLE: {
    id: string;
    namespace: string;
    version: string;
    type: string;
    scope: string;
    name: string;
    description: string;
    navigationContributions: Array<typeof MARKETPLACE_BROWSE_UI_BUNDLE['navigationContributions'][number]>;
} = {
    id: 'com.objectstack.cloud-connection.marketplace-installed-ui',
    namespace: 'sys',
    version: '0.4.0',
    type: 'plugin',
    scope: 'system',
    name: 'Marketplace Installed UI',
    description: 'Setup UI for locally-installed marketplace packages. It carries no navigation entry: installed packages are listed by Setup → Packages.',
    navigationContributions: [],
};
