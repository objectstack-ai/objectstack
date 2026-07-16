// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/connector-rest
 *
 * Generic REST connector — the reference *concrete* connector (ADR-0018
 * §Addendum). The baseline automation engine ships the `connector_action`
 * dispatch node + an empty connector registry; this plugin populates the
 * registry with a `rest` connector exposing a `request` action.
 *
 * Static auth only (`none` / `api-key` / `basic` / `bearer`); OAuth2 refresh,
 * credential vaulting, and multi-tenant lifecycle are the enterprise tier.
 */

export {
    createRestConnector,
    type RestConnectorOptions,
    type RestConnectorBundle,
    type RestRequestInput,
    type RestAuth,
} from './rest-connector.js';
export {
    ConnectorRestPlugin,
    type ConnectorRestPluginOptions,
    type ConnectorRegistrySurface,
} from './connector-rest-plugin.js';
export {
    createRestProviderFactory,
    REST_PROVIDER_KEY,
    type RestProviderDeps,
} from './rest-provider.js';
