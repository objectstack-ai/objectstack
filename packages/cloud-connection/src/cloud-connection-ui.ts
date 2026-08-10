// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cloud Connection — SDUI surface (metadata, not React).
 *
 * The binding UI ships WITH the plugin as page + navigation metadata
 * (ADR-0029 K2: capability plugins contribute their own Setup entries;
 * cloud ADR-0008 / console-SDUI direction: new console surfaces are
 * metadata-first). The only React involved is the registered
 * `cloud-connection:panel` widget — the device-code state machine — which
 * the console registers once as a reusable primitive; everything else
 * (page shell, nav placement, labels) is server-driven and can evolve
 * without a console release.
 */

import type { Page } from '@objectstack/spec/ui';

/** Setup page hosting the binding panel widget. */
export const CloudConnectionSettingsPage: Page = {
    name: 'cloud_connection_settings',
    label: 'Cloud Connection',
    type: 'app',
    template: 'default',
    kind: 'full',
    isDefault: false,
    regions: [
        {
            name: 'header',
            width: 'full',
            components: [
                {
                    type: 'page:header',
                    properties: {
                        title: 'Cloud Connection',
                        subtitle:
                            'Connect this runtime to an ObjectStack control plane to browse your '
                            + 'organization\'s private packages and install them here.',
                        // `icon` removed here (#6946): `page:header` never drew one — retired from the spec.
                    },
                },
            ],
        },
        {
            name: 'main',
            width: 'large',
            components: [
                {
                    // Registered console widget — the RFC 8628 device-code
                    // state machine (status → start → user-code display →
                    // poll → bound / disconnect). Talks to the same-origin
                    // /api/v1/cloud-connection/* routes this plugin mounts.
                    type: 'cloud-connection:panel',
                    properties: {},
                },
            ],
        },
    ],
};

/** Setup-nav contribution: System group, after the marketplace entries. */
export const CLOUD_CONNECTION_NAV_CONTRIBUTIONS = [
    {
        app: 'setup',
        group: 'group_apps',
        priority: 200,
        items: [
            {
                id: 'nav_cloud_connection',
                type: 'page',
                pageName: 'cloud_connection_settings',
                label: 'Cloud Connection',
                icon: 'cloud',
            },
        ],
    },
];

/** Manifest bundle the plugin registers so the page + nav reach the kernel. */
export const CLOUD_CONNECTION_UI_BUNDLE = {
    id: 'com.objectstack.cloud-connection.ui',
    namespace: 'sys',
    version: '0.1.0',
    type: 'plugin',
    scope: 'system',
    name: 'Cloud Connection UI',
    description: 'Setup page + navigation for binding this runtime to a control plane.',
    pages: [CloudConnectionSettingsPage],
    navigationContributions: CLOUD_CONNECTION_NAV_CONTRIBUTIONS,
};
