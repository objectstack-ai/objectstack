// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/connector-slack
 *
 * Slack Web API connector — a concrete connector (ADR-0018 §Addendum) and the
 * second reference implementation after `@objectstack/connector-rest`. The
 * baseline automation engine ships the `connector_action` dispatch node + an
 * empty connector registry; this plugin populates it with a `slack` connector
 * exposing `chat.postMessage`, `chat.update`, and a generic `call` action.
 *
 * This is the integration mechanism (ADR-0022 "raw API call" path), not the
 * human-notification layer. Static bot-token auth only; OAuth2 install/refresh,
 * credential vaulting, and multi-tenant lifecycle are the enterprise tier.
 */

export {
    createSlackConnector,
    type SlackConnectorOptions,
    type SlackConnectorBundle,
    type SlackPostMessageInput,
    type SlackResult,
} from './slack-connector.js';
export {
    ConnectorSlackPlugin,
    type ConnectorSlackPluginOptions,
    type ConnectorRegistrySurface,
} from './connector-slack-plugin.js';
