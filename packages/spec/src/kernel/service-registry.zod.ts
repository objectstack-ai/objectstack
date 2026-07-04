// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ServiceClusterAnnotationsSchema } from './cluster.zod';

/**
 * Service Registry Protocol
 * 
 * Zod schemas for service registry data structures.
 * These schemas align with the IServiceRegistry contract interface.
 * 
 * Following ObjectStack "Zod First" principle - all data structures
 * must have Zod schemas for runtime validation and JSON Schema generation.
 * 
 * Note: IServiceRegistry itself is a runtime interface (methods only),
 * so it correctly remains a TypeScript interface. This file contains
 * schemas for configuration and metadata related to service registry.
 */

// ============================================================================
// Service Metadata Schemas
// ============================================================================

/**
 * Service Scope Type Enum
 * Different service scoping strategies
 */
import { lazySchema } from '../shared/lazy-schema';
export const ServiceScopeType = z.enum([
  'singleton',    // Single instance shared across the application
  'transient',    // New instance created each time
  'scoped',       // Instance per scope (request, session, transaction, etc.)
]).describe('Service scope type');

export type ServiceScopeType = z.infer<typeof ServiceScopeType>;

/**
 * Service Metadata Schema
 * Metadata about a registered service
 * 
 * @example
 * {
 *   "name": "database",
 *   "scope": "singleton",
 *   "type": "IDataEngine",
 *   "registeredAt": 1706659200000
 * }
 */
export const ServiceMetadataSchema = lazySchema(() => z.object({
  /**
   * Service name (unique identifier)
   */
  name: z.string().min(1).describe('Unique service name identifier'),
  
  /**
   * Service scope type
   */
  scope: ServiceScopeType.optional().default('singleton')
    .describe('Service scope type'),
  
  /**
   * Service type or interface name (optional)
   */
  type: z.string().optional().describe('Service type or interface name'),
  
  /**
   * Registration timestamp (Unix milliseconds)
   */
  registeredAt: z.number().int().optional()
    .describe('Unix timestamp in milliseconds when service was registered'),
  
  /**
   * Additional metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional()
    .describe('Additional service-specific metadata'),

  /**
   * Cluster annotations governing how this service behaves in a
   * multi-node deployment. Optional — omitting it is equivalent to
   * `{ clusterScope: 'node' }`, which is correct on a single machine.
   *
   * @see content/docs/kernel/cluster.mdx §5
   */
  cluster: ServiceClusterAnnotationsSchema.optional()
    .describe('Cluster scope & leader strategy. See cluster-semantics.mdx §5.'),
}));

export type ServiceMetadata = z.infer<typeof ServiceMetadataSchema>;

// ============================================================================
// Service Registry Configuration Schemas
// ============================================================================

/**
 * Service Registry Configuration Schema
 * Configuration for service registry behavior
 * 
 * @example
 * {
 *   "strictMode": true,
 *   "allowOverwrite": false,
 *   "enableLogging": true,
 *   "scopeTypes": ["singleton", "transient", "request", "session"]
 * }
 */
export const ServiceRegistryConfigSchema = lazySchema(() => z.object({
  /**
   * Strict mode: throw errors on invalid operations
   * @default true
   */
  strictMode: z.boolean().optional().default(true)
    .describe('Throw errors on invalid operations (duplicate registration, service not found, etc.)'),
  
  /**
   * Allow overwriting existing services
   * @default false
   */
  allowOverwrite: z.boolean().optional().default(false)
    .describe('Allow overwriting existing service registrations'),
  
  /**
   * Enable logging for service operations
   * @default false
   */
  enableLogging: z.boolean().optional().default(false)
    .describe('Enable logging for service registration and retrieval'),
  
  /**
   * Custom scope types (beyond singleton, transient, scoped)
   * @default ['singleton', 'transient', 'scoped']
   */
  scopeTypes: z.array(z.string()).optional()
    .describe('Supported scope types'),
  
  /**
   * Maximum number of services (prevent memory leaks)
   */
  maxServices: z.number().int().min(1).optional()
    .describe('Maximum number of services that can be registered'),
}));

export type ServiceRegistryConfig = z.infer<typeof ServiceRegistryConfigSchema>;
export type ServiceRegistryConfigInput = z.input<typeof ServiceRegistryConfigSchema>;

// ============================================================================
// Service Factory Schemas
// ============================================================================

/**
 * Service Factory Registration Schema
 * Configuration for registering a service factory
 * 
 * @example
 * {
 *   "name": "logger",
 *   "scope": "singleton",
 *   "factoryType": "sync"
 * }
 */
export const ServiceFactoryRegistrationSchema = lazySchema(() => z.object({
  /**
   * Service name (unique identifier)
   */
  name: z.string().min(1).describe('Unique service name identifier'),
  
  /**
   * Service scope type
   */
  scope: ServiceScopeType.optional().default('singleton')
    .describe('Service scope type'),
  
  /**
   * Factory type (sync or async)
   */
  factoryType: z.enum(['sync', 'async']).optional().default('sync')
    .describe('Whether factory is synchronous or asynchronous'),
  
  /**
   * Whether this is a singleton (cache factory result)
   */
  singleton: z.boolean().optional().default(true)
    .describe('Whether to cache the factory result (singleton pattern)'),

  /**
   * Cluster annotations. See `ServiceMetadataSchema.cluster`.
   */
  cluster: ServiceClusterAnnotationsSchema.optional()
    .describe('Cluster scope & leader strategy for this service.'),
}));

export type ServiceFactoryRegistration = z.infer<typeof ServiceFactoryRegistrationSchema>;

// ============================================================================
// Scoped Service Schemas
// ============================================================================

/**
 * Scope Configuration Schema
 * Configuration for creating a new scope
 * 
 * @example
 * {
 *   "scopeType": "request",
 *   "scopeId": "req-12345",
 *   "metadata": {
 *     "userId": "user-123",
 *     "requestId": "req-12345"
 *   }
 * }
 */
export const ScopeConfigSchema = lazySchema(() => z.object({
  /**
   * Type of scope (request, session, transaction, etc.)
   */
  scopeType: z.string().describe('Type of scope'),
  
  /**
   * Scope identifier (optional, auto-generated if not provided)
   */
  scopeId: z.string().optional().describe('Unique scope identifier'),
  
  /**
   * Scope metadata (context information)
   */
  metadata: z.record(z.string(), z.unknown()).optional()
    .describe('Scope-specific context metadata'),
}));

export type ScopeConfig = z.infer<typeof ScopeConfigSchema>;

/**
 * Scope Info Schema
 * Information about an active scope
 * 
 * @example
 * {
 *   "scopeId": "req-12345",
 *   "scopeType": "request",
 *   "createdAt": 1706659200000,
 *   "serviceCount": 5,
 *   "metadata": {
 *     "userId": "user-123"
 *   }
 * }
 */
export const ScopeInfoSchema = lazySchema(() => z.object({
  /**
   * Scope identifier
   */
  scopeId: z.string().describe('Unique scope identifier'),
  
  /**
   * Type of scope
   */
  scopeType: z.string().describe('Type of scope'),
  
  /**
   * Creation timestamp (Unix milliseconds)
   */
  createdAt: z.number().int().describe('Unix timestamp in milliseconds when scope was created'),
  
  /**
   * Number of services in this scope
   */
  serviceCount: z.number().int().min(0).optional()
    .describe('Number of services registered in this scope'),
  
  /**
   * Scope metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional()
    .describe('Scope-specific context metadata'),
}));

export type ScopeInfo = z.infer<typeof ScopeInfoSchema>;
