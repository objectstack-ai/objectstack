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

/**
 * Setup-nav contribution: the Integrations group, after its other entries
 * (ruling 甲, #25097 — the connection is an optional integration of a
 * self-hosted or local runtime, not an app).
 *
 * `priority` orders contributions within a group, lowest first. The group's
 * other contributors, read where they are declared: Webhooks / HTTP Deliveries
 * (`@objectstack/plugin-webhooks`) and Datasources
 * (`@objectstack/service-datasource`) at 100, Connect an Agent
 * (`@objectstack/mcp`) at 110 — so 200 sorts this entry last.
 *
 * The group's own `requiredPermissions` (`manage_platform_settings`, on
 * `SETUP_APP` in `@objectstack/platform-objects`) now applies to the entry.
 *
 * A platform-managed runtime registers none of this
 * (`CloudConnectionPlugin`, `platformManaged`).
 */
export const CLOUD_CONNECTION_NAV_CONTRIBUTIONS = [
    {
        app: 'setup',
        group: 'group_integrations',
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
