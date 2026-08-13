// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * API Protocol Exports
 * 
 * API Contracts & Envelopes
 * - Request/Response schemas
 * - Error handling
 * - OData v4 compatibility
 * - Batch operations
 * - Metadata caching
 * - HttpDispatcher routing
 * - API versioning
 */

export * from './contract.zod';
export * from './endpoint.zod';
// [#5189, #5040 E7b] The per-endpoint publish gates. #5111 kept this module
// package-internal because its only consumer was `ObjectStackDefinitionSchema`,
// one file away. #5189 proved the stack schema is NOT the only door: a
// `MetadataManager.publishPackage` / `metadata.register()` / Studio write mints
// an `api` item without ever parsing a stack, and ADR-0121 D6 (anonymous
// endpoints must carry an armed budget) has no runtime counterpart to catch it.
// The gate therefore becomes public so the metadata layer can reuse the SAME
// criteria at publish and at index-build time — one judge, three doors, rather
// than a second implementation that drifts.
export {
    validateApiEndpointDeclarations,
    identityFreeEndpointGateFailure,
    type EndpointGateIssue,
    type EndpointGateIdentity,
} from './endpoint-publish-gate';
export * from './discovery.zod';
export * from './events.zod';
export * from './realtime-shared.zod';
export * from './realtime.zod';
export * from './websocket.zod';
export * from './router.zod';
export * from './odata.zod';
export * from './batch.zod';
export * from './http-cache.zod';
export * from './errors.zod';
// The ADR-0114 D3 boundary mapper — the ONE implementation of Zod issue code →
// `FieldErrorCode` in the repo (#8124); `@objectstack/rest` and
// `@objectstack/types` both consume it.
export { zodIssuesToFields } from './zod-issues-to-fields';
export * from './error-code-ledger.zod';
export * from './protocol.zod';
export * from './rest-server.zod';
// `./registry.zod` (the `ApiRegistry` / `ApiEndpointRegistration` family) was
// RETIRED in #4939 — ADR-0049 enforce-or-remove. It was assembled only in
// `packages/core/examples/`, never by `packages/runtime`, `packages/cli` or any
// `examples/app-*`, so a real 47-plugin boot carried no `api-registry` service
// and the whole schema family was zero-execution. That included
// `ApiEndpointRegistration.requiredPermissions`, documented in the present
// tense as gateway-enforced while no gateway ever read it — false compliance,
// not debt. It also left the repo with TWO declaration shapes for one concept;
// this retirement converges them on `ApiEndpointSchema` (`./endpoint.zod`),
// whose executor is tracked by #5040. The one survivor,
// `ConflictResolutionStrategy`, moved to `./router.zod` — see the note there.
export * from './documentation.zod';
export * from './analytics.zod';
export * from './versioning.zod';

// Legacy interface export (deprecated)
// export type { IObjectStackProtocol } from './protocol';

export * from './auth.zod';
export * from './auth-endpoints.zod';
export * from './storage.zod';
export * from './metadata.zod';
export * from './dispatcher.zod';
export * from './plugin-rest-api.zod';
export * from './query-adapter.zod';
export * from './export.zod';
export * from './automation-api.zod';
export * from './package-api.zod';
