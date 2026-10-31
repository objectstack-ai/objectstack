// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/connector-openapi
 *
 * Generate an ObjectStack {@link Connector} from a declarative OpenAPI 3.x
 * document (ADR-0023). One operation becomes one connector action; a single
 * generic handler drives a self-contained HTTP transport (mirroring
 * `@objectstack/connector-rest`). The generated connector is an ordinary
 * `type: 'api'` connector — registered via `engine.registerConnector` with no
 * new engine surface.
 *
 * Static auth (`none` / `api-key` / `basic` / `bearer`), a request signer
 * (ADR-0143 D2.3), or a per-dispatch credential handle for the grant-bearing
 * kinds `oauth2` and `app-credential` (ADR-0143 D4, open tier per D1).
 */

export {
    createOpenApiConnector,
    type OpenApiConnectorBundle,
    type OpenApiConnectorConfig,
    type OpenApiDocument,
    type OpenApiPathItem,
    type OpenApiOperation,
    type OpenApiParameter,
    type OpenApiRequestBody,
    type OpenApiResponse,
    type OpenApiSecurityScheme,
    type OperationInfo,
    type RestAuth,
    type JsonSchema,
} from './openapi-connector.js';
export {
    registerOpenApiConnector,
    ConnectorOpenApiPlugin,
    type ConnectorOpenApiPluginOptions,
    type ConnectorRegistrySurface,
} from './connector-openapi-plugin.js';
export {
    createOpenApiProviderFactory,
    OPENAPI_PROVIDER_KEY,
    type OpenApiProviderDeps,
} from './openapi-provider.js';
