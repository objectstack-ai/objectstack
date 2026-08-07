// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FieldMappingSchema as BaseFieldMappingSchema } from '../shared/mapping.zod';

/**
 * External Data Source Schema
 * 
 * Configuration for connecting to external data systems.
 * Similar to Salesforce External Objects for real-time data integration.
 * 
 * @example
 * ```json
 * {
 *   "id": "salesforce-accounts",
 *   "name": "Salesforce Account Data",
 *   "type": "rest-api",
 *   "endpoint": "https://api.salesforce.com/services/data/v58.0",
 *   "authentication": {
 *     "type": "oauth2",
 *     "config": {
 *       "clientId": "...",
 *       "clientSecret": "...",
 *       "tokenUrl": "https://login.salesforce.com/services/oauth2/token"
 *     }
 *   }
 * }
 * ```
 */
import { lazySchema } from '../shared/lazy-schema';
export const ExternalDataSourceSchema = lazySchema(() => z.object({
  /**
   * Unique identifier for the external data source
   */
  id: z.string().describe('Data source ID'),

  /**
   * Human-readable name of the data source
   */
  name: z.string().describe('Data source name'),

  /**
   * Protocol type for connecting to the data source
   */
  type: z.enum(['odata', 'rest-api', 'graphql', 'custom']).describe('Protocol type'),

  /**
   * Base URL endpoint for the external system
   */
  endpoint: z.string().url().describe('API endpoint URL'),

  /**
   * Authentication configuration
   */
  authentication: z.object({
    /**
     * Authentication method
     */
    type: z.enum(['oauth2', 'api-key', 'basic', 'none']).describe('Auth type'),

    /**
     * Authentication-specific configuration
     * Structure varies based on auth type
     */
    config: z.record(z.string(), z.unknown()).describe('Auth configuration'),
  }).describe('Authentication'),
}));

/**
 * Field Mapping Schema for External Lookups
 * 
 * Extends the base field mapping with external lookup specific features.
 * Uses the canonical field mapping protocol from shared/mapping.zod.ts.
 * 
 * @see {@link BaseFieldMappingSchema} for the base field mapping schema
 * 
 * @example
 * ```json
 * {
 *   "source": "AccountName",
 *   "target": "name",
 *   "readonly": true
 * }
 * ```
 */
export const ExternalFieldMappingSchema = lazySchema(() => BaseFieldMappingSchema.extend({
  /**
   * Field data type
   */
  type: z.string().optional().describe('Field type'),

  /**
   * Whether the field is read-only
   * @default true
   */
  readonly: z.boolean().optional().default(true).describe('Read-only field'),
}));

/**
 * External Lookup Schema
 * 
 * Real-time data lookup protocol for external systems.
 * Enables querying external data sources without replication.
 * Inspired by Salesforce External Objects and OData protocols.
 * 
 * @example
 * ```json
 * {
 *   "fieldName": "external_account",
 *   "dataSource": {
 *     "id": "salesforce-api",
 *     "name": "Salesforce",
 *     "type": "rest-api",
 *     "endpoint": "https://api.salesforce.com/services/data/v58.0",
 *     "authentication": {
 *       "type": "oauth2",
 *       "config": {"clientId": "..."}
 *     }
 *   },
 *   "query": {
 *     "endpoint": "/sobjects/Account",
 *     "method": "GET",
 *     "parameters": {"limit": 100}
 *   },
 *   "fieldMappings": [
 *     {
 *       "externalField": "Name",
 *       "localField": "account_name",
 *       "type": "text",
 *       "readonly": true
 *     }
 *   ],
 *   "caching": {
 *     "enabled": true,
 *     "ttl": 300,
 *     "strategy": "ttl"
 *   },
 *   "fallback": {
 *     "enabled": true,
 *     "showError": true
 *   },
 *   "rateLimit": {
 *     "requestsPerSecond": 10,
 *     "burstSize": 20
 *   }
 * }
 * ```
 */
export const ExternalLookupSchema = lazySchema(() => z.object({
  /**
   * Name of the field that uses external lookup
   */
  fieldName: z.string().describe('Field name'),

  /**
   * External data source configuration
   */
  dataSource: ExternalDataSourceSchema.describe('External data source'),

  /**
   * Query configuration for fetching external data
   */
  query: z.object({
    /**
     * API endpoint path (relative to base endpoint)
     */
    endpoint: z.string().describe('Query endpoint path'),

    /**
     * HTTP method for the query
     * @default 'GET'
     */
    method: z.enum(['GET', 'POST']).optional().default('GET').describe('HTTP method'),

    /**
     * Query parameters or request body
     */
    parameters: z.record(z.string(), z.unknown()).optional().describe('Query parameters'),
  }).describe('Query configuration'),

  /**
   * Mapping between external and local fields
   */
  fieldMappings: z.array(ExternalFieldMappingSchema).describe('Field mappings'),

  /**
   * Cache configuration for external data
   */
  caching: z.object({
    /**
     * Whether caching is enabled
     * @default true
     */
    enabled: z.boolean().optional().default(true).describe('Cache enabled'),

    /**
     * Time-to-live in seconds
     * @default 300
     */
    ttl: z.number().optional().default(300).describe('Cache TTL (seconds)'),

    /**
     * Cache eviction strategy
     * @default 'ttl'
     */
    strategy: z.enum(['lru', 'lfu', 'ttl']).optional().default('ttl').describe('Cache strategy'),
  }).optional().describe('Caching configuration'),

  /**
   * Fallback behavior when external system is unavailable
   */
  fallback: z.object({
    /**
     * Whether fallback is enabled
     * @default true
     */
    enabled: z.boolean().optional().default(true).describe('Fallback enabled'),

    /**
     * Default value to use when external system fails
     */
    defaultValue: z.unknown().optional().describe('Default fallback value'),

    /**
     * Whether to show error message to user
     * @default true
     */
    showError: z.boolean().optional().default(true).describe('Show error to user'),
  }).optional().describe('Fallback configuration'),

  /**
   * Rate limiting to prevent overwhelming external system
   */
  rateLimit: z.object({
    /**
     * Maximum requests per second
     */
    requestsPerSecond: z.number().describe('Requests per second limit'),

    /**
     * Burst size for handling spikes
     */
    burstSize: z.number().optional().describe('Burst size'),
  }).optional().describe('Rate limiting'),

  /**
   * Retry configuration with exponential backoff
   *
   * @example
   * ```json
   * {
   *   "maxRetries": 3,
   *   "initialDelayMs": 1000,
   *   "maxDelayMs": 30000,
   *   "backoffMultiplier": 2,
   *   "retryableStatusCodes": [429, 500, 502, 503, 504]
   * }
   * ```
   */
  retry: z.object({
    /** Maximum number of retry attempts */
    maxRetries: z.number().min(0).default(3).describe('Maximum retry attempts'),
    /** Initial delay before first retry (ms) */
    initialDelayMs: z.number().default(1000).describe('Initial retry delay in milliseconds'),
    /** Maximum delay between retries (ms) */
    maxDelayMs: z.number().default(30000).describe('Maximum retry delay in milliseconds'),
    /** Backoff multiplier for exponential backoff */
    backoffMultiplier: z.number().default(2).describe('Exponential backoff multiplier'),
    /** HTTP status codes that trigger a retry */
    retryableStatusCodes: z.array(z.number()).default([429, 500, 502, 503, 504])
      .describe('HTTP status codes that are retryable'),
  }).optional().describe('Retry configuration with exponential backoff'),

  /**
   * Request/response transformation pipeline
   *
   * Allows transforming request parameters and response data
   * before they are processed by the external lookup system.
   */
  transform: z.object({
    /** Transform request parameters before sending */
    request: z.object({
      /** Header transformations (key-value additions) */
      headers: z.record(z.string(), z.string()).optional().describe('Additional request headers'),
      /** Query parameter transformations */
      queryParams: z.record(z.string(), z.string()).optional().describe('Additional query parameters'),
    }).optional().describe('Request transformation'),
    /** Transform response data after receiving */
    response: z.object({
      /** JSONPath expression to extract data from response */
      dataPath: z.string().optional().describe('JSONPath to extract data (e.g., "$.data.results")'),
      /** JSONPath expression to extract total count for pagination */
      totalPath: z.string().optional().describe('JSONPath to extract total count (e.g., "$.meta.total")'),
    }).optional().describe('Response transformation'),
  }).optional().describe('Request/response transformation pipeline'),

  /** Pagination support for external data sources */
  pagination: z.object({
    /** Pagination type */
    type: z.enum(['offset', 'cursor', 'page']).default('offset').describe('Pagination type'),
    /** Page size */
    pageSize: z.number().default(100).describe('Items per page'),
    /** Maximum pages to fetch */
    maxPages: z.number().optional().describe('Maximum number of pages to fetch'),
  }).optional().describe('Pagination configuration for external data'),
}));

// Type exports
export type ExternalLookup = z.infer<typeof ExternalLookupSchema>;
/** Post-parse shape of {@link ExternalLookup} — defaults applied, transforms run (ADR-0122). */
export type ExternalLookupParsed = z.infer<typeof ExternalLookupSchema>;
export type ExternalDataSource = z.infer<typeof ExternalDataSourceSchema>;
export type ExternalFieldMapping = z.infer<typeof ExternalFieldMappingSchema>;
/** Post-parse shape of {@link ExternalFieldMapping} — defaults applied, transforms run (ADR-0122). */
export type ExternalFieldMappingParsed = z.infer<typeof ExternalFieldMappingSchema>;
