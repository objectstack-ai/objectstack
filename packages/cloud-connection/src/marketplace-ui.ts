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
 *   - no MarketplaceInstallLocalPlugin → no "Installed Apps" entry.
 *
 * "Browse Marketplace" still points at the console's marketplace route.
 * "Installed Apps" opens Setup → Packages filtered to Source = marketplace
 * (#23933, ruling B on #23892): Packages is the one list of what is installed,
 * and its marketplace rows carry the actions the plugin's own Installed Apps
 * page used to (Details, Uninstall). That page is no longer shipped.
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
 * "Installed Apps" — owned by the local-install capability, registered by
 * `MarketplaceInstallLocalPlugin` at `kernel:ready`.
 *
 * The entry targets the console's `developer:packages` component (the one
 * Setup's own "Packages" entry opens) with `params: { source: 'marketplace' }`.
 * The console sends a component entry's `params` as the query string, so the
 * entry opens `/apps/APP/component/developer/packages?source=marketplace` —
 * the filter objectui#12675 published (`PACKAGES_SOURCE_PARAM = 'source'`,
 * values `code` / `marketplace` / `authored`, an unknown value refused by
 * name). A `component` entry rather than a `url` one: the target is a
 * first-party console component, and the app segment comes from the app the
 * entry is rendered in instead of a spelled-out `/apps/setup`.
 *
 * The bundle carries no page. The `marketplace_installed` page it used to
 * ship (cloud ADR-0009 P2a) only redirected to that same filtered view once
 * Packages carried the marketplace row actions, so it was retired with the
 * entry's retarget.
 */
export const MARKETPLACE_INSTALLED_UI_BUNDLE = {
    id: 'com.objectstack.cloud-connection.marketplace-installed-ui',
    namespace: 'sys',
    version: '0.3.0',
    type: 'plugin',
    scope: 'system',
    name: 'Marketplace Installed UI',
    description: 'Setup navigation for locally-installed marketplace packages: "Installed Apps" opens Packages filtered to marketplace installs.',
    navigationContributions: [
        {
            app: 'setup',
            group: 'group_apps',
            priority: 110,
            items: [
                {
                    id: 'nav_marketplace_installed',
                    type: 'component',
                    label: 'Installed Apps',
                    componentRef: 'developer:packages',
                    params: { source: 'marketplace' },
                    icon: 'package-check',
                },
            ],
        },
    ],
};
