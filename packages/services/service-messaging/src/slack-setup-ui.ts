// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Integrations → "Slack" — the navigation entry of the Slack
 * administrator doors (`PUT` / `DELETE /api/v1/messaging/slack/account`,
 * `GET /api/v1/messaging/slack/links`, `DELETE …/slack/links/:id`), carried by
 * the messaging service that owns those doors: the entry lives and dies with
 * the capability, the `CONNECTOR_CREDENTIALS_UI_BUNDLE` shape in
 * `@objectstack/service-automation`.
 *
 * The page body is the console's `messaging:slack` component
 * (`@object-ui/app-shell`), named by registry key like every other
 * framework-contributed Setup page.
 *
 * Registered by `MessagingServicePlugin` at `kernel:ready` in the same hook,
 * and on the same condition, as the `slack` channel: only where
 * connector-slack's `slack` client service resolves. A composition without
 * connector-slack has no Slack channel, its Slack doors answer 503, and Setup
 * lists no Slack entry.
 *
 * The entry asks {@link SLACK_ADMIN_CAPABILITY} (`setup.write`), the capability
 * every administrator door asks: the rule the page's doors enforce is stated
 * by the plugin that enforces it, not borrowed from the group.
 */

import { SLACK_ADMIN_CAPABILITY } from './slack-link-routes.js';

/** The console component the entry opens. */
export const SLACK_SETUP_COMPONENT_REF = 'messaging:slack';

/**
 * `priority` orders contributions within a group, lowest first. The group's
 * other contributors, read where they are declared: Webhooks / HTTP Deliveries
 * (`@objectstack/plugin-webhooks`) and Datasources
 * (`@objectstack/service-datasource`) at 100, Connector Credentials and
 * Connector Connections (`@objectstack/service-automation`) at 120, Cloud
 * Connection (`@objectstack/cloud-connection`) at 200 — so 140 sorts this
 * entry after the connector pages and before the cloud connection.
 */
export const SLACK_SETUP_UI_BUNDLE = {
    id: 'com.objectstack.service-messaging.slack-ui',
    namespace: 'sys',
    version: '0.1.0',
    type: 'plugin',
    scope: 'system',
    name: 'Slack Setup UI',
    description: 'Setup navigation for the Slack page: install or replace the organization\'s Slack token, remove the install, and review or remove each member\'s Slack link.',
    navigationContributions: [
        {
            app: 'setup',
            group: 'group_integrations',
            priority: 140,
            items: [
                {
                    id: 'nav_slack',
                    type: 'component',
                    label: 'Slack',
                    componentRef: SLACK_SETUP_COMPONENT_REF,
                    icon: 'message-square',
                    requiredPermissions: [SLACK_ADMIN_CAPABILITY],
                },
            ],
        },
    ],
};
