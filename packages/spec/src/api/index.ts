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
export * from './registry.zod';
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
