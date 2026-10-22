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

/**
 * Ruling 乙 (#25119): the ONE capability the Cloud Connection surface is gated
 * on — the nav entry below, the connection record `GET /status` serves, and the
 * three doors that change the connection (`CloudConnectionPlugin`).
 *
 * It is `manage_platform_settings`, the Integrations group's own gate
 * (`requiredPermissions` on `group_integrations`, `SETUP_APP` in
 * `@objectstack/platform-objects`), which the platform's capability registry
 * describes as the one for "platform-only Setup pages". One constant, read by
 * the entry and by the doors, so the two cannot drift apart. ⛔ Not
 * `setup.access`: that admits the organization administrator's default set,
 * which the Integrations group does not.
 *
 * The page itself declares nothing: a page carries no permission key
 * (`PageSchema`), so it is held at this line where its data is served — the
 * panel reads `status` and drives the doors.
 */
export const CLOUD_CONNECTION_CAPABILITY = 'manage_platform_settings';

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
 * `SETUP_APP` in `@objectstack/platform-objects`) applies to the entry, and
 * the entry declares the same capability on itself
 * ({@link CLOUD_CONNECTION_CAPABILITY}, ruling 乙, #25119): the rule the page's
 * doors enforce is stated by the plugin that enforces it, not borrowed from
 * wherever the group happens to sit — the shape `service-datasource`'s
 * `nav_datasources` entry takes in the same group.
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
                requiredPermissions: [CLOUD_CONNECTION_CAPABILITY],
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
