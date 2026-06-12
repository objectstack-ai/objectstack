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
 * The URLs still point at the console's existing marketplace routes; the
 * pages themselves migrate to plugin-carried metadata in later ADR-0009
 * stages (Installed Apps first).
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

/** "Installed Apps" — owned by the local-install capability. */
export const MARKETPLACE_INSTALLED_UI_BUNDLE = {
    id: 'com.objectstack.cloud-connection.marketplace-installed-ui',
    namespace: 'sys',
    version: '0.1.0',
    type: 'plugin',
    scope: 'system',
    name: 'Marketplace Installed UI',
    description: 'Setup navigation for locally-installed marketplace packages.',
    navigationContributions: [
        {
            app: 'setup',
            group: 'group_apps',
            priority: 110,
            items: [
                { id: 'nav_marketplace_installed', type: 'url', label: 'Installed Apps', url: '/apps/setup/system/marketplace/installed', icon: 'package-check' },
            ],
        },
    ],
};
