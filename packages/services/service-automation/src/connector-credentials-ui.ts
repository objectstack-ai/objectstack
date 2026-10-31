// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Integrations → "Connector Credentials" — the navigation entry of the
 * connector credential door, carried by the automation service that owns the
 * door (ruling A on #27230; cloud ADR-0009 shape, as `packages/cloud-connection`
 * restates it: the nav entry lives and dies with the capability — no automation
 * service, no entry).
 *
 * The page body is the console's `automation:connector-credentials` component
 * (`@object-ui/app-shell`), the way Setup's packaged-automation entry names
 * `automation:packaged`. It reads `GET /api/v1/automation/connectors/credential-refs`
 * and writes through `PUT` / `DELETE …/credential-refs/:ref`; ⛔ no value ever
 * reaches it, since none of the three routes answers one.
 *
 * Registered by {@link AutomationServicePlugin} at `kernel:ready`. The entry
 * declares the door's own capability, `manage_metadata`, which every one of its
 * three routes asks before anything else: the rule the page's routes enforce
 * is stated by the plugin that enforces it, not borrowed from the group.
 */

/** The console component the entry opens. */
export const CONNECTOR_CREDENTIALS_COMPONENT_REF = 'automation:connector-credentials';

/** The capability the credential door asks on all three routes. */
export const CONNECTOR_CREDENTIALS_NAV_CAPABILITY = 'manage_metadata';

/**
 * `priority` orders contributions within a group, lowest first. The group's
 * other contributors, read where they are declared: Webhooks / HTTP Deliveries
 * (`@objectstack/plugin-webhooks`) and Datasources
 * (`@objectstack/service-datasource`) at 100, Connect an Agent
 * (`@objectstack/mcp`) at 110, Cloud Connection (`@objectstack/cloud-connection`)
 * at 200 — so 120 sorts this entry after the connection surfaces it serves.
 */
export const CONNECTOR_CREDENTIALS_UI_BUNDLE = {
    id: 'com.objectstack.service-automation.connector-credentials-ui',
    namespace: 'sys',
    version: '0.1.0',
    type: 'plugin',
    scope: 'system',
    name: 'Connector Credentials UI',
    description: 'Setup navigation for the connector credentials the installed apps declare: set, replace or clear each one.',
    navigationContributions: [
        {
            app: 'setup',
            group: 'group_integrations',
            priority: 120,
            items: [
                {
                    id: 'nav_connector_credentials',
                    type: 'component',
                    label: 'Connector Credentials',
                    componentRef: CONNECTOR_CREDENTIALS_COMPONENT_REF,
                    icon: 'key-round',
                    requiredPermissions: [CONNECTOR_CREDENTIALS_NAV_CAPABILITY],
                },
            ],
        },
    ],
};
