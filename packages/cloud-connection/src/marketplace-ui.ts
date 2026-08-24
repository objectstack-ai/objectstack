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

import type { Page } from '@objectstack/spec/ui';

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

/** "Installed Apps" — owned by the local-install capability (ADR-0009 P2a:
 *  the page itself is now metadata; the console provides only the
 *  `marketplace:installed-list` widget).
 *
 *  Declared `: Page` (#11480) — this is a raw-literal page served through the
 *  bundle below, and `export const X: Page =` is the export shape the
 *  canonical-envelope gate's population scan discovers pages by. Un-annotated
 *  it shipped invisibly to that scan (measured while wiring this package's
 *  `canonical-expression-envelopes.test.ts`). */
export const MarketplaceInstalledPage: Page = {
    name: 'marketplace_installed',
    label: 'Installed Apps',
    type: 'app' as const,
    template: 'default',
    kind: 'full' as const,
    isDefault: false,
    regions: [
        {
            name: 'header',
            width: 'full' as const,
            components: [
                {
                    type: 'page:header',
                    properties: {
                        title: 'Installed Apps',
                        subtitle: 'Marketplace packages currently installed into this runtime\'s kernel.',
                        // `icon` removed here (#6946): `page:header` never drew one — retired from the spec.
                    },
                },
            ],
        },
        {
            name: 'main',
            width: 'large' as const,
            components: [
                { type: 'marketplace:installed-list', properties: {} },
            ],
        },
    ],
};

export const MARKETPLACE_INSTALLED_UI_BUNDLE = {
    id: 'com.objectstack.cloud-connection.marketplace-installed-ui',
    namespace: 'sys',
    version: '0.2.0',
    type: 'plugin',
    scope: 'system',
    name: 'Marketplace Installed UI',
    description: 'Installed Apps page + Setup navigation for locally-installed marketplace packages.',
    pages: [MarketplaceInstalledPage],
    navigationContributions: [
        {
            app: 'setup',
            group: 'group_apps',
            priority: 110,
            items: [
                { id: 'nav_marketplace_installed', type: 'page', pageName: 'marketplace_installed', label: 'Installed Apps', icon: 'package-check' },
            ],
        },
    ],
};
