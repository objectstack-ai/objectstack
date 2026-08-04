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
