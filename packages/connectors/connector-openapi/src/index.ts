// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/connector-openapi
 *
 * Generate an ObjectStack {@link Connector} from a declarative OpenAPI 3.x
 * document (ADR-0023). One operation becomes one connector action; a single
 * generic handler drives a self-contained static-auth HTTP transport (mirroring
 * `@objectstack/connector-rest`). The generated connector is an ordinary
 * `type: 'api'` connector — registered via `engine.registerConnector` with no
 * new engine surface.
 *
 * Open-source scope: static auth only (`none` / `api-key` / `basic` / `bearer`),
 * credentials supplied by the caller. Managed OAuth2, credential vaulting, and
 * per-tenant lifecycle are the enterprise tier (ADR-0015 / 0022).
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
