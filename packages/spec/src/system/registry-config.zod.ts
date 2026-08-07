// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Registry Configuration Protocol
 * 
 * Defines the configuration for the ObjectStack Registry Service.
 * Includes federation, synchronization, and storage settings.
 */

/**
 * Registry Sync Policy
 * Defines how registries synchronize with upstreams
 */
import { lazySchema } from '../shared/lazy-schema';
export const RegistrySyncPolicySchema = lazySchema(() => z.enum([
  'manual',    // Manual synchronization only
  'auto',      // Automatic synchronization
  'proxy',     // Proxy requests to upstream without caching
]).describe('Registry synchronization strategy'));

/**
 * Registry Upstream Configuration
 * Configuration for upstream registry connection
 */
export const RegistryUpstreamSchema = lazySchema(() => z.object({
  /**
   * Upstream registry URL
   */
  url: z.string().url()
    .describe('Upstream registry endpoint'),
  
  /**
   * Synchronization policy
   */
  syncPolicy: RegistrySyncPolicySchema.default('auto'),
  
  /**
   * Sync interval in seconds (for auto sync)
   */
  syncInterval: z.number().int().min(60).optional()
    .describe('Auto-sync interval in seconds'),
  
  /**
   * Authentication credentials
   */
  auth: z.object({
    type: z.enum(['none', 'basic', 'bearer', 'api-key', 'oauth2']).default('none'),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    apiKey: z.string().optional(),
  }).optional(),
  
  /**
   * TLS/SSL configuration
   */
  tls: z.object({
    enabled: z.boolean().default(true),
    verifyCertificate: z.boolean().default(true),
    certificate: z.string().optional(),
    privateKey: z.string().optional(),
  }).optional(),
  
  /**
   * Timeout settings
   */
  timeout: z.number().int().min(1000).default(30000)
    .describe('Request timeout in milliseconds'),
  
  /**
   * Retry configuration
   */
  retry: z.object({
    maxAttempts: z.number().int().min(0).default(3),
    backoff: z.enum(['fixed', 'linear', 'exponential']).default('exponential'),
  }).optional(),
}));

/**
 * Registry Configuration
 * Complete registry configuration supporting federation
 */
export const RegistryConfigSchema = lazySchema(() => z.object({
  /**
   * Registry type
   */
  type: z.enum([
    'public',    // Public marketplace (e.g., plugins.objectstack.com)
    'private',   // Private enterprise registry
    'hybrid',    // Hybrid with upstream federation
  ]).describe('Registry deployment type'),
  
  /**
   * Upstream registries (for hybrid/private registries)
   */
  upstream: z.array(RegistryUpstreamSchema).optional()
    .describe('Upstream registries to sync from or proxy to'),
  
  /**
   * Scopes managed by this registry
   */
  scope: z.array(z.string()).optional()
    .describe('npm-style scopes managed by this registry (e.g., @my-corp, @enterprise)'),
  
  /**
   * Default scope for new plugins
   */
  defaultScope: z.string().optional()
    .describe('Default scope prefix for new plugins'),
  
  /**
   * Registry storage configuration
   */
  storage: z.object({
    /**
     * Storage backend type
     */
    backend: z.enum(['local', 's3', 'gcs', 'azure-blob', 'oss']).default('local'),
    
    /**
     * Storage path or bucket name
     */
    path: z.string().optional(),
    
    /**
     * Credentials
     */
    credentials: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  
  /**
   * Registry visibility
   */
  visibility: z.enum(['public', 'private', 'internal']).default('private')
    .describe('Who can access this registry'),
  
  /**
   * Access control
   */
  accessControl: z.object({
    /**
     * Require authentication for read
     */
    requireAuthForRead: z.boolean().default(false),
    
    /**
     * Require authentication for write
     */
    requireAuthForWrite: z.boolean().default(true),
    
    /**
     * Allowed users/teams
     */
    allowedPrincipals: z.array(z.string()).optional(),
  }).optional(),
  
  /**
   * Caching configuration
   */
  cache: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().int().min(0).default(3600)
      .describe('Cache TTL in seconds'),
    maxSize: z.number().int().optional()
      .describe('Maximum cache size in bytes'),
  }).optional(),
  
  /**
   * Mirroring configuration (for high availability)
   */
  mirrors: z.array(z.object({
    url: z.string().url(),
    priority: z.number().int().min(1).default(1),
  })).optional()
    .describe('Mirror registries for redundancy'),
}));

export type RegistrySyncPolicy = z.input<typeof RegistrySyncPolicySchema>;
export type RegistryUpstream = z.input<typeof RegistryUpstreamSchema>;
/** Post-parse shape of {@link RegistryUpstream} — defaults applied, transforms run (ADR-0122). */
export type RegistryUpstreamParsed = z.infer<typeof RegistryUpstreamSchema>;
export type RegistryConfig = z.input<typeof RegistryConfigSchema>;
/** Post-parse shape of {@link RegistryConfig} — defaults applied, transforms run (ADR-0122). */
export type RegistryConfigParsed = z.infer<typeof RegistryConfigSchema>;
