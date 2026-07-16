// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';
import { WebhookSchema } from '../automation/webhook.zod';
import { ConnectorAuthConfigSchema, ConnectorInstanceAuthSchema } from '../shared/connector-auth.zod';
import { FieldMappingSchema as BaseFieldMappingSchema } from '../shared/mapping.zod';

/**
 * Connector Protocol - LEVEL 3: Enterprise Connector
 * 
 * Defines the standard connector specification for external system integration.
 * Connectors enable ObjectStack to sync data with SaaS apps, databases, file storage,
 * and message queues through a unified protocol.
 * 
 * **Positioning in 3-Layer Architecture:**
 * - **L1: Simple Sync** (automation/sync.zod.ts) - Business users - Sync Salesforce to Sheets
 * - **L2: ETL Pipeline** (automation/etl.zod.ts) - Data engineers - Aggregate 10 sources to warehouse
 * - **L3: Enterprise Connector** (THIS FILE) - System integrators - Full SAP integration
 * 
 * **SCOPE: Most comprehensive integration layer.**
 * Includes authentication, webhooks, rate limiting, field mapping, bidirectional sync,
 * retry policies, and complete lifecycle management.
 * 
 * This protocol supports multiple authentication strategies, bidirectional sync,
 * field mapping, webhooks, and comprehensive rate limiting.
 *
 * ## Runtime contract — descriptor vs. registered connector (#2612)
 *
 * This schema serves TWO distinct consumers; do not conflate them:
 *
 * 1. **Runtime registration (plugin-only).** The automation engine's connector
 *    registry — what `GET /connectors` lists and the `connector_action` flow
 *    node dispatches — is populated exclusively by plugins calling
 *    `engine.registerConnector(def, handlers)` with a handler per declared
 *    action (ADR-0018 §Addendum). The definition is validated against this
 *    schema at registration.
 * 2. **Declarative `connectors:` stack entries (catalog descriptors).** Stack
 *    metadata validated against this schema is registered as kind 'connector'
 *    for discovery/documentation/marketplace purposes only — it never reaches
 *    the runtime registry, because an action here carries no execution binding
 *    (deliberately: ADR-0023 rejected re-inventing OpenAPI inside this schema).
 *    The automation service warns at boot about declared entries with `actions`
 *    that lack a same-name runtime registration; mark deliberate catalog-only
 *    entries with `enabled: false`. Provider-bound declarative instances that
 *    a generic executor (connector-openapi / connector-mcp) materializes at
 *    boot are tracked in #2977 (ADR-0096).
 *
 * Authentication is now imported from the canonical auth/config.zod.ts.
 * 
 * ## When to Use This Layer
 * 
 * **Use Enterprise Connector when:**
 * - Building enterprise-grade connectors (e.g., Salesforce, SAP, Oracle)
 * - Complex OAuth2/SAML authentication required
 * - Bidirectional sync with field mapping and transformations
 * - Webhook management and rate limiting required
 * - Full CRUD operations and data synchronization
 * - Need comprehensive retry strategies and error handling
 * 
 * **Examples:**
 * - Full Salesforce integration with webhooks
 * - SAP ERP connector with CDC (Change Data Capture)
 * - Microsoft Dynamics 365 connector
 * 
 * **When to downgrade:**
 * - Simple field sync → Use {@link file://../automation/sync.zod.ts | Simple Sync}
 * - Data transformation only → Use {@link file://../automation/etl.zod.ts | ETL Pipeline}
 * 
 * @see {@link file://../automation/sync.zod.ts} for Level 1 (simple sync)
 * @see {@link file://../automation/etl.zod.ts} for Level 2 (data engineering)
 * 
 * ## When to use Integration Connector vs. Trigger Registry?
 * 
 * **Use `integration/connector.zod.ts` when:**
 * - Building enterprise-grade connectors (e.g., Salesforce, SAP, Oracle)
 * - Complex OAuth2/SAML authentication required
 * - Bidirectional sync with field mapping and transformations
 * - Webhook management and rate limiting required
 * - Full CRUD operations and data synchronization
 * - Need comprehensive retry strategies and error handling
 * 
 * **Use `automation/trigger-registry.zod.ts` when:**
 * - Building simple automation triggers (e.g., "when Slack message received, create task")
 * - No complex authentication needed (simple API keys, basic auth)
 * - Lightweight, single-purpose integrations
 * - Quick setup with minimal configuration
 * 
 * @see ../../automation/trigger-registry.zod.ts for lightweight automation triggers
 */

// ============================================================================
// Authentication Schemas - IMPORTED FROM CANONICAL SOURCE
// Use ConnectorAuthConfigSchema from shared/connector-auth.zod.ts
// ============================================================================

// ============================================================================
// Field Mapping Schema
// Uses the canonical field mapping protocol from shared/mapping.zod.ts
// Extended with connector-specific features
// ============================================================================

/**
 * Connector Field Mapping Configuration
 * 
 * Extends the base field mapping with connector-specific features
 * like bidirectional sync modes and data type mapping.
 */
import { lazySchema } from '../shared/lazy-schema';
export const FieldMappingSchema = lazySchema(() => BaseFieldMappingSchema.extend({
  /**
   * Data type mapping (connector-specific)
   */
  dataType: z.enum([
    'string',
    'number',
    'boolean',
    'date',
    'datetime',
    'json',
    'array',
  ]).optional().describe('Target data type'),
  
  /**
   * Is this field required?
   */
  required: z.boolean().default(false).describe('Field is required'),
  
  /**
   * Bidirectional sync mode (connector-specific)
   */
  syncMode: z.enum([
    'read_only',      // Only sync from external to ObjectStack
    'write_only',     // Only sync from ObjectStack to external
    'bidirectional',  // Sync both ways
  ]).default('bidirectional').describe('Sync mode'),
}));

export type FieldMapping = z.infer<typeof FieldMappingSchema>;

// ============================================================================
// Data Synchronization Configuration
// ============================================================================

/**
 * Sync Strategy Schema
 */
export const SyncStrategySchema = lazySchema(() => z.enum([
  'full',           // Full refresh (delete all and re-import)
  'incremental',    // Only sync changes since last sync
  'upsert',         // Insert new, update existing
  'append_only',    // Only insert new records
]).describe('Synchronization strategy'));

export type SyncStrategy = z.infer<typeof SyncStrategySchema>;

/**
 * Conflict Resolution Strategy
 */
export const ConflictResolutionSchema = lazySchema(() => z.enum([
  'source_wins',    // External system data takes precedence
  'target_wins',    // ObjectStack data takes precedence
  'latest_wins',    // Most recently modified wins
  'manual',         // Flag for manual resolution
]).describe('Conflict resolution strategy'));

export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;

/**
 * Data Synchronization Configuration
 */
export const DataSyncConfigSchema = lazySchema(() => z.object({
  /**
   * Sync strategy
   */
  strategy: SyncStrategySchema.optional().default('incremental'),
  
  /**
   * Sync direction
   */
  direction: z.enum([
    'import',         // External → ObjectStack
    'export',         // ObjectStack → External
    'bidirectional',  // Both ways
  ]).optional().default('import').describe('Sync direction'),
  
  /**
   * Sync frequency (cron expression)
   */
  schedule: CronExpressionInputSchema.optional().describe('Cron expression for scheduled sync — cron`0 */15 * * *`'),
  
  /**
   * Enable real-time sync via webhooks
   */
  realtimeSync: z.boolean().optional().default(false).describe('Enable real-time sync'),
  
  /**
   * Field to track last sync timestamp
   */
  timestampField: z.string().optional().describe('Field to track last modification time'),
  
  /**
   * Conflict resolution strategy
   */
  conflictResolution: ConflictResolutionSchema.optional().default('latest_wins'),
  
  /**
   * Batch size for bulk operations
   */
  batchSize: z.number().min(1).max(10000).optional().default(1000).describe('Records per batch'),
  
  /**
   * Delete handling
   */
  deleteMode: z.enum([
    'hard_delete',    // Permanently delete
    'soft_delete',    // Mark as deleted
    'ignore',         // Don't sync deletions
  ]).optional().default('soft_delete').describe('Delete handling mode'),
  
  /**
   * Filter criteria for selective sync
   */
  filters: z.record(z.string(), z.unknown()).optional().describe('Filter criteria for selective sync'),
}));

export type DataSyncConfig = z.infer<typeof DataSyncConfigSchema>;

// ============================================================================
// Webhook Configuration
// ============================================================================

/**
 * Webhook Event Schema
 */
export const WebhookEventSchema = lazySchema(() => z.enum([
  'record.created',
  'record.updated',
  'record.deleted',
  'sync.started',
  'sync.completed',
  'sync.failed',
  'auth.expired',
  'rate_limit.exceeded',
]).describe('Webhook event type'));

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/**
 * Webhook Signature Algorithm
 */
export const WebhookSignatureAlgorithmSchema = lazySchema(() => z.enum([
  'hmac_sha256',
  'hmac_sha512',
  'none',
]).describe('Webhook signature algorithm'));

export type WebhookSignatureAlgorithm = z.infer<typeof WebhookSignatureAlgorithmSchema>;

/**
 * Webhook Configuration Schema
 * 
 * Extends the canonical WebhookSchema with connector-specific event types.
 * This allows connectors to subscribe to both data events and connector lifecycle events.
 */
export const WebhookConfigSchema = lazySchema(() => WebhookSchema.extend({
  /**
   * Events to listen for
   * Connector-specific events like sync completion, auth expiry, etc.
   */
  events: z.array(WebhookEventSchema).optional().describe('Connector events to subscribe to'),
  
  /**
   * Signature algorithm for webhook security
   */
  signatureAlgorithm: WebhookSignatureAlgorithmSchema.optional().default('hmac_sha256'),
}));

export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

// ============================================================================
// Rate Limiting and Retry Configuration
// ============================================================================

/**
 * Rate Limiting Strategy
 */
export const RateLimitStrategySchema = lazySchema(() => z.enum([
  'fixed_window',       // Fixed time window
  'sliding_window',     // Sliding time window
  'token_bucket',       // Token bucket algorithm
  'leaky_bucket',       // Leaky bucket algorithm
]).describe('Rate limiting strategy'));

export type RateLimitStrategy = z.infer<typeof RateLimitStrategySchema>;

/**
 * Rate Limiting Configuration
 */
export const RateLimitConfigSchema = lazySchema(() => z.object({
  /**
   * Rate limiting strategy
   */
  strategy: RateLimitStrategySchema.optional().default('token_bucket'),
  
  /**
   * Maximum requests per window
   */
  maxRequests: z.number().min(1).describe('Maximum requests per window'),
  
  /**
   * Time window in seconds
   */
  windowSeconds: z.number().min(1).describe('Time window in seconds'),
  
  /**
   * Burst capacity (for token bucket)
   */
  burstCapacity: z.number().min(1).optional().describe('Burst capacity'),
  
  /**
   * Respect external system rate limits
   */
  respectUpstreamLimits: z.boolean().optional().default(true).describe('Respect external rate limit headers'),
  
  /**
   * Custom rate limit headers to check
   */
  rateLimitHeaders: z.object({
    remaining: z.string().optional().default('X-RateLimit-Remaining').describe('Header for remaining requests'),
    limit: z.string().optional().default('X-RateLimit-Limit').describe('Header for rate limit'),
    reset: z.string().optional().default('X-RateLimit-Reset').describe('Header for reset time'),
  }).optional().describe('Custom rate limit headers'),
}));

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

/**
 * Retry Strategy
 */
export const RetryStrategySchema = lazySchema(() => z.enum([
  'exponential_backoff',
  'linear_backoff',
  'fixed_delay',
  'no_retry',
]).describe('Retry strategy'));

export type RetryStrategy = z.infer<typeof RetryStrategySchema>;

/**
 * Retry Configuration
 */
export const RetryConfigSchema = lazySchema(() => z.object({
  /**
   * Retry strategy
   */
  strategy: RetryStrategySchema.optional().default('exponential_backoff'),
  
  /**
   * Maximum retry attempts
   */
  maxAttempts: z.number().min(0).max(10).optional().default(3).describe('Maximum retry attempts'),
  
  /**
   * Initial delay in milliseconds
   */
  initialDelayMs: z.number().min(100).optional().default(1000).describe('Initial retry delay in ms'),
  
  /**
   * Maximum delay in milliseconds
   */
  maxDelayMs: z.number().min(1000).optional().default(60000).describe('Maximum retry delay in ms'),
  
  /**
   * Backoff multiplier (for exponential backoff)
   */
  backoffMultiplier: z.number().min(1).optional().default(2).describe('Exponential backoff multiplier'),
  
  /**
   * HTTP status codes to retry
   */
  retryableStatusCodes: z.array(z.number()).optional().default([408, 429, 500, 502, 503, 504]).describe('HTTP status codes to retry'),
  
  /**
   * Retry on network errors
   */
  retryOnNetworkError: z.boolean().optional().default(true).describe('Retry on network errors'),
  
  /**
   * Jitter to add randomness to retry delays
   */
  jitter: z.boolean().optional().default(true).describe('Add jitter to retry delays'),
}));

export type RetryConfig = z.infer<typeof RetryConfigSchema>;

// ============================================================================
// Error Mapping Configuration
// ============================================================================

/**
 * Error Category
 */
export const ErrorCategorySchema = lazySchema(() => z.enum([
  'validation',
  'authorization',
  'not_found',
  'conflict',
  'rate_limit',
  'timeout',
  'server_error',
  'integration_error',
]).describe('Standard error category'));

export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;

/**
 * Error Mapping Rule
 * 
 * Maps an external system error code to an ObjectStack standard error.
 */
export const ErrorMappingRuleSchema = lazySchema(() => z.object({
  sourceCode: z.union([z.string(), z.number()]).describe('External system error code'),
  sourceMessage: z.string().optional().describe('Pattern to match against error message'),
  targetCode: z.string().describe('ObjectStack standard error code'),
  targetCategory: ErrorCategorySchema.describe('Error category'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Error severity level'),
  retryable: z.boolean().describe('Whether the error is retryable'),
  userMessage: z.string().optional().describe('Human-readable message to show users'),
}).describe('Error mapping rule'));

export type ErrorMappingRule = z.infer<typeof ErrorMappingRuleSchema>;

/**
 * Error Mapping Configuration
 * 
 * Configures how external system errors are mapped to ObjectStack standard errors.
 */
export const ErrorMappingConfigSchema = lazySchema(() => z.object({
  rules: z.array(ErrorMappingRuleSchema).describe('Error mapping rules'),
  defaultCategory: ErrorCategorySchema.optional().default('integration_error').describe('Default category for unmapped errors'),
  unmappedBehavior: z.enum(['passthrough', 'generic_error', 'throw']).describe('What to do with unmapped errors'),
  logUnmapped: z.boolean().optional().default(true).describe('Log unmapped errors'),
}).describe('Error mapping configuration'));

export type ErrorMappingConfig = z.infer<typeof ErrorMappingConfigSchema>;

// ============================================================================
// Health Check & Circuit Breaker Configuration
// ============================================================================

/**
 * Health Check Configuration
 * 
 * Configures periodic health checks for connector endpoints.
 */
export const HealthCheckConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Enable health checks'),
  intervalMs: z.number().optional().default(60000).describe('Health check interval in milliseconds'),
  timeoutMs: z.number().optional().default(5000).describe('Health check timeout in milliseconds'),
  endpoint: z.string().optional().describe('Health check endpoint path'),
  method: z.enum(['GET', 'HEAD', 'OPTIONS']).optional().describe('HTTP method for health check'),
  expectedStatus: z.number().optional().default(200).describe('Expected HTTP status code'),
  unhealthyThreshold: z.number().optional().default(3).describe('Consecutive failures before marking unhealthy'),
  healthyThreshold: z.number().optional().default(1).describe('Consecutive successes before marking healthy'),
}).describe('Health check configuration'));

export type HealthCheckConfig = z.infer<typeof HealthCheckConfigSchema>;

/**
 * Circuit Breaker Configuration
 * 
 * Implements the circuit breaker pattern to prevent cascading failures.
 */
export const CircuitBreakerConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Enable circuit breaker'),
  failureThreshold: z.number().optional().default(5).describe('Failures before opening circuit'),
  resetTimeoutMs: z.number().optional().default(30000).describe('Time in open state before half-open'),
  halfOpenMaxRequests: z.number().optional().default(1).describe('Requests allowed in half-open state'),
  monitoringWindow: z.number().optional().default(60000).describe('Rolling window for failure count in ms'),
  fallbackStrategy: z.enum(['cache', 'default_value', 'error', 'queue']).optional().describe('Fallback strategy when circuit is open'),
}).describe('Circuit breaker configuration'));

export type CircuitBreakerConfig = z.infer<typeof CircuitBreakerConfigSchema>;

/**
 * Connector Health Configuration
 * 
 * Combines health check and circuit breaker for connector resilience.
 */
export const ConnectorHealthSchema = lazySchema(() => z.object({
  healthCheck: HealthCheckConfigSchema.optional().describe('Health check configuration'),
  circuitBreaker: CircuitBreakerConfigSchema.optional().describe('Circuit breaker configuration'),
}).describe('Connector health configuration'));

export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>;

// ============================================================================
// Base Connector Schema
// ============================================================================

/**
 * Connector Type
 */
export const ConnectorTypeSchema = lazySchema(() => z.enum([
  'saas',           // SaaS application connector
  'database',       // Database connector
  'file_storage',   // File storage connector
  'message_queue',  // Message queue connector
  'api',            // Generic REST/GraphQL API
  'custom',         // Custom connector
]).describe('Connector type'));

export type ConnectorType = z.infer<typeof ConnectorTypeSchema>;

/**
 * Connector Status
 */
export const ConnectorStatusSchema = lazySchema(() => z.enum([
  'active',         // Connector is active and syncing
  'inactive',       // Connector is configured but disabled
  'error',          // Connector has errors
  'configuring',    // Connector is being set up
]).describe('Connector status'));

export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

/**
 * Connector Action Definition
 */
export const ConnectorActionSchema = lazySchema(() => z.object({
  key: z.string().describe('Action key (machine name)'),
  label: z.string().describe('Human readable label'),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional().describe('Input parameters schema (JSON Schema)'),
  outputSchema: z.record(z.string(), z.unknown()).optional().describe('Output schema (JSON Schema)'),
}));

/**
 * Connector Trigger Definition
 */
export const ConnectorTriggerSchema = lazySchema(() => z.object({
  key: z.string().describe('Trigger key'),
  label: z.string().describe('Trigger label'),
  description: z.string().optional(),
  type: z.enum(['polling', 'webhook']).describe('Trigger type'),
  interval: z.number().optional().describe('Polling interval in seconds'),
}));

/**
 * Base Connector Schema
 * Core connector configuration shared across all connector types
 */
export const ConnectorSchema = lazySchema(() => z.object({
  /**
   * Machine name (snake_case)
   */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique connector identifier'),
  
  /**
   * Human-readable label
   */
  label: z.string().describe('Display label'),
  
  /**
   * Connector type
   */
  type: ConnectorTypeSchema.describe('Connector type'),
  
  /**
   * Description
   */
  description: z.string().optional().describe('Connector description'),
  
  /**
   * Icon identifier
   */
  icon: z.string().optional().describe('Icon identifier'),
  
  /**
   * Authentication configuration (runtime shape — carries resolved secrets
   * inline, supplied by a plugin at `registerConnector`). Optional and defaults
   * to `{ type: 'none' }` so a declarative provider-bound instance can reference
   * credentials through {@link auth}/`credentialRef` instead of inlining them
   * here (ADR-0096). Hand-written / plugin connectors keep setting it as before.
   */
  authentication: ConnectorAuthConfigSchema.optional().default({ type: 'none' }).describe(
    'Authentication configuration (runtime shape with inline secrets). Provider-bound declarative instances use `auth.credentialRef` instead.',
  ),

  /**
   * ADR-0096 — provider key naming the installed **generic executor** that
   * materializes this declarative entry into a live, dispatchable connector at
   * boot (`openapi`, `mcp`, `rest`, or any provider a connector plugin
   * contributes). Presence flips the entry from an inert catalog **descriptor**
   * (#2612) to an **instance declaration**: the automation service resolves the
   * matching provider factory at boot and registers the result on the connector
   * registry. A declared `provider` with no installed factory is a hard boot
   * error. Omit `provider` to keep the entry a pure descriptor.
   */
  provider: z.string().regex(/^[a-z][a-z0-9_]*$/).optional().describe(
    'Generic-executor key that materializes this declarative entry at boot (e.g. openapi/mcp/rest). Omit for a catalog-only descriptor. Unknown provider ⇒ hard boot error (ADR-0096).',
  ),

  /**
   * ADR-0096 — provider-specific configuration, **validated by the provider
   * factory** (not by this schema): the OpenAPI provider expects `{ spec,
   * baseUrl? }`, the MCP provider a `{ transport }`, the REST provider a
   * `{ baseUrl }`. Deliberately untyped here — re-modelling each provider's
   * inputs in the stack schema (an OpenAPI document, an MCP transport) is exactly
   * what ADR-0023 rejected. Ignored unless `provider` is set.
   */
  providerConfig: z.record(z.string(), z.unknown()).optional().describe(
    'Provider-specific config validated by the provider factory at boot (e.g. { spec, baseUrl } for openapi). Requires `provider`.',
  ),

  /**
   * ADR-0096 — declarative auth for a provider-bound instance: secret-bearing
   * variants carry a `credentialRef` the automation service resolves through the
   * secrets/env layer at materialization, never an inline secret (§3). Distinct
   * from {@link authentication}, which is the runtime shape with the resolved
   * secret inline. Requires `provider`.
   */
  auth: ConnectorInstanceAuthSchema.optional().describe(
    'Declarative instance auth — references credentials via `credentialRef` (resolved at boot), never inline secrets. Requires `provider` (ADR-0096).',
  ),

  /** Zapier-style Capabilities */
  actions: z.array(ConnectorActionSchema).optional(),
  triggers: z.array(ConnectorTriggerSchema).optional(),
  
  /**
   * Data synchronization configuration
   */
  syncConfig: DataSyncConfigSchema.optional().describe('Data sync configuration'),
  
  
  /**
   * Field mappings
   */
  fieldMappings: z.array(FieldMappingSchema).optional().describe('Field mapping rules'),
  
  /**
   * Webhook configuration
   */
  webhooks: z.array(WebhookConfigSchema).optional().describe('Webhook configurations'),
  
  /**
   * Rate limiting configuration
   */
  rateLimitConfig: RateLimitConfigSchema.optional().describe('Rate limiting configuration'),
  
  /**
   * Retry configuration
   */
  retryConfig: RetryConfigSchema.optional().describe('Retry configuration'),
  
  /**
   * Connection timeout in milliseconds
   */
  connectionTimeoutMs: z.number().min(1000).max(300000).optional().default(30000).describe('Connection timeout in ms'),
  
  /**
   * Request timeout in milliseconds
   */
  requestTimeoutMs: z.number().min(1000).max(300000).optional().default(30000).describe('Request timeout in ms'),
  
  /**
   * Connector status
   */
  status: ConnectorStatusSchema.optional().default('inactive').describe('Connector status'),
  
  /**
   * Enable connector. On a declarative `connectors:` stack entry, `false`
   * additionally marks a deliberate catalog-only descriptor — it suppresses
   * the boot audit warning for declared-but-unregistered connectors (#2612).
   */
  enabled: z.boolean().optional().default(true).describe(
    'Enable connector. On declarative stack entries, false marks a deliberate catalog-only descriptor (#2612).',
  ),
  
  /**
   * Error mapping configuration
   */
  errorMapping: ErrorMappingConfigSchema.optional().describe('Error mapping configuration'),
  
  /**
   * Health check and circuit breaker configuration
   */
  health: ConnectorHealthSchema.optional().describe('Health and resilience configuration'),
  
  /**
   * Custom metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom connector metadata'),
}));

export type Connector = z.infer<typeof ConnectorSchema>;
/** Authoring input for {@link Connector} — defaulted fields are optional. */
export type ConnectorInput = z.input<typeof ConnectorSchema>;

/**
 * Type-safe factory for an external-system connector. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Connector` literal.
 */
export function defineConnector(config: z.input<typeof ConnectorSchema>): Connector {
  return ConnectorSchema.parse(config);
}

/**
 * A declarative `connectors:` **stack entry** (ADR-0096) — {@link ConnectorSchema}
 * plus the cross-field rules that apply only when a connector is *authored inside
 * a stack*, as opposed to a def a plugin builds at runtime and hands to
 * `registerConnector`. `stack.zod.ts` validates the `connectors:` array against
 * this; the base {@link ConnectorSchema} stays a plain object so connector
 * *subtypes* (github / database / …) can still `.extend()` it.
 *
 * All rules key off `provider` — instance declaration vs. catalog descriptor:
 *  - `providerConfig` / `auth` require a `provider`; on a pure descriptor they
 *    are meaningless materialization inputs, so they are rejected.
 *  - A provider-bound instance must NOT inline secrets via `authentication` —
 *    credentials are references (`auth.credentialRef`), never authored literals (§3).
 *  - A provider-bound instance must NOT author `actions` / `triggers` — the
 *    provider derives them from the upstream (OpenAPI document / MCP `tools/list`);
 *    authoring both the instance and its actions reintroduces drift (§5 non-goals).
 */
export const DeclarativeConnectorEntrySchema = lazySchema(() =>
  ConnectorSchema.superRefine((entry, ctx) => {
    const isInstance = typeof entry.provider === 'string' && entry.provider.length > 0;
    if (!isInstance) {
      if (entry.providerConfig !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['providerConfig'],
          message: '`providerConfig` requires a `provider` — a connector entry with no provider is a catalog descriptor (ADR-0096).',
        });
      }
      if (entry.auth !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['auth'],
          message: '`auth` requires a `provider` — declarative instance auth applies only to a provider-bound entry (ADR-0096).',
        });
      }
      return;
    }
    // Provider-bound instance declaration.
    if (entry.authentication && entry.authentication.type !== 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['authentication'],
        message: `Provider-bound connector instance '${entry.name}' must not inline secrets via \`authentication\`; reference credentials with \`auth: { type, credentialRef }\` instead (ADR-0096 §3).`,
      });
    }
    if (entry.actions && entry.actions.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: `Provider-bound connector instance '${entry.name}' must not author \`actions\` — the '${entry.provider}' provider derives them from the upstream at boot (ADR-0096 §5).`,
      });
    }
    if (entry.triggers && entry.triggers.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['triggers'],
        message: `Provider-bound connector instance '${entry.name}' must not author \`triggers\` — the '${entry.provider}' provider derives them from the upstream at boot (ADR-0096 §5).`,
      });
    }
  }),
);

export type DeclarativeConnectorEntry = z.infer<typeof DeclarativeConnectorEntrySchema>;

// Re-export the declarative-instance auth surface (ADR-0096) so consumers reach
// it through `@objectstack/spec/integration` alongside the connector schema.
export {
  ConnectorInstanceAuthSchema,
  ConnectorInstanceNoAuthSchema,
  ConnectorInstanceBearerAuthSchema,
  ConnectorInstanceAPIKeyAuthSchema,
  ConnectorInstanceBasicAuthSchema,
} from '../shared/connector-auth.zod';
export type { ConnectorInstanceAuth, ResolvedConnectorAuth } from '../shared/connector-auth.zod';
