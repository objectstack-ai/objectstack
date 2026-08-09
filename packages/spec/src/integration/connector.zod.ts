// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';
import { WebhookSchema } from '../automation/webhook.zod';
import { ConnectorAuthConfigSchema, ConnectorInstanceAuthSchema } from '../shared/connector-auth.zod';
import { FieldMappingSchema as BaseFieldMappingSchema } from '../shared/mapping.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { retiredKey } from '../shared/retired-key';

/**
 * Connector Protocol - LEVEL 3: Enterprise Connector
 * 
 * Defines the standard connector specification for external system integration.
 * Connectors enable ObjectStack to sync data with SaaS apps, databases, file storage,
 * and message queues through a unified protocol.
 * 
 * **Positioning in the sync/integration layering** — this file is now the ONLY
 * layer. Both layers above it were retired under ADR-0049 for the same measured
 * reason, that no engine ever executed them: L1 "Simple Sync"
 * (`automation/sync.zod.ts`) in #4738, and L2 "ETL Pipeline"
 * (`automation/etl.zod.ts`) in #6414. See
 * `packages/spec/docs/SYNC_ARCHITECTURE.md`:
 * - **Enterprise Connector** (THIS FILE) - System integrators - Full SAP integration; connector-attached sync via `syncConfig`
 * 
 * **SCOPE: Most comprehensive integration layer.**
 * Includes authentication, webhooks, field mapping, bidirectional sync,
 * retry policies, and complete lifecycle management.
 *
 * This protocol supports multiple authentication strategies, bidirectional sync,
 * field mapping, webhooks, and comprehensive retry and resilience policies.
 *
 * ## What this layer does NOT provide
 *
 * **There is no outbound rate limiting.** This header used to advertise "rate
 * limiting" twice — once in the SCOPE line, once as "comprehensive rate limiting" —
 * and no engine ever backed either. `connector.rateLimitConfig`, and the entire
 * `ConnectorRateLimitConfig` / `RateLimitStrategy` shape behind it, was removed in
 * `@objectstack/spec` 17.0.0 (#4911, ADR-0049 D2), because **no outbound
 * rate-limiting engine ever existed**. The platform's only token bucket (runtime
 * `security/rate-limit.ts`) throttles **INBOUND** requests *to* us; nothing throttles
 * the calls a connector makes *out*. Do **not** substitute `shared`'s
 * `RateLimitConfig` — that is the inbound limiter and would cap the wrong direction.
 * **Until an outbound throttle exists, rate-limit at the connector provider or
 * upstream gateway.** What L3 does declare for a rate-limited upstream is
 * `retryConfig` — whose `retryableStatusCodes` default `[408, 429, 500, 502, 503,
 * 504]` includes `429` — and `health.circuitBreaker`. The full removal reasoning is
 * recorded at the removal site: the "REMOVED: outbound rate limiting" block in
 * `integration/connector.zod.ts`, and `packages/spec/docs/SYNC_ARCHITECTURE.md`.
 *
 * **Field mapping does not transform values.** This header used to offer "field
 * mapping and transformations"; only the first half was ever true.
 * `ConnectorFieldMappingSchema` extends the base mapping with exactly three keys —
 * `dataType`, `required` and `syncMode`. `FieldMapping.transform` was removed in
 * `@objectstack/spec` 17.0.0 (#5552, ADR-0049), and the whole `FieldMappingTransform`
 * union went with it (`constant` / `cast` / `lookup` / `javascript` / `map`) — **no
 * runtime ever executed any of the five**. An L3 connector mapping moves a value from
 * `source` to `target`; it does not compute one. **Value conversion belongs on a
 * surface that runs it:** the import mapping's own `mapping.fieldMapping[].transform`
 * (`data/mapping.zod.ts` — a string enum,
 * `none`/`constant`/`map`/`split`/`join`/`lookup`, with its settings in `params`),
 * applied row by row by the REST import path — or an ETL transformation step
 * (L2 above). Already authored the retired key? `os migrate meta --from 16` rewrites it.
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
 *    boot are tracked in #2977 (ADR-0097).
 *
 * Authentication is now imported from the canonical auth/config.zod.ts.
 * 
 * ## When to Use This Layer
 * 
 * **Use Enterprise Connector when:**
 * - Building enterprise-grade connectors (e.g., Salesforce, SAP, Oracle)
 * - Complex OAuth2/SAML authentication required
 * - Bidirectional sync with field mapping (`dataType` / `syncMode` per field — it moves values, it does not transform them)
 * - Webhook management required
 * - Full CRUD operations and data synchronization
 * - Need comprehensive retry strategies and error handling
 * 
 * **Examples:**
 * - Full Salesforce integration with webhooks
 * - SAP ERP connector with CDC (Change Data Capture)
 * - Microsoft Dynamics 365 connector
 * 
 * **When to downgrade:**
 * - Per-field value conversion on import only → the import mapping's own
 *   `transform` (`data/mapping.zod.ts`), which the REST import path executes
 *   row by row. (This used to point at `automation/etl.zod.ts`; L2 was retired
 *   at #6414 for having no executor, so the pointer would have been a signpost
 *   landing nowhere — the same defect class this header names below.)
 * 
 * ## There is no "Trigger Registry" alternative
 *
 * This header used to carry a "When to use Integration Connector vs. Trigger
 * Registry?" comparison, steering "lightweight" cases to
 * `automation/trigger-registry.zod.ts`. That file was a third declaration of
 * the connector vocabulary with zero consumers — nothing registered, validated
 * or executed against it — so the guidance pointed authors, with the
 * platform's authority, at a dead end (#4499; removed alongside the #4480
 * per-provider template cluster). The same defect class as the
 * `capabilities.readOnly` prescription #4487 corrected: a signpost must land
 * somewhere enforced. Lightweight cases are served HERE — a connector instance
 * with simple `auth`. (Both automation-side layers were themselves retired as
 * dead ends of the same class: L1 "Simple Sync" in #4738, L2 `etl.zod.ts` in
 * #6414. This paragraph named L2 as the transformation destination until the
 * second retirement; a signpost that must land somewhere enforced cannot make
 * an exception for itself.)
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
 * Extends the base field mapping ({@link BaseFieldMappingSchema}, declared in
 * `shared/mapping.zod.ts`) with connector-specific features like bidirectional
 * sync modes and data type mapping.
 *
 * Renamed from `FieldMappingSchema` / `FieldMapping` (#4703, ADR-0112 D9a):
 * THREE entry points published that name for three declarations — `./shared`
 * (this schema's base, 4 keys), `./integration` (this one, 7 keys) and
 * `./data` (`ImportFieldMappingSchema`, a CSV/table column mapping that is not
 * a connector mapping at all). Which type an importer got depended only on the
 * import path — the #4411 trap. Prefixing the domain-specific sides keeps the
 * base name for the base, matching `ConnectorErrorCategory` and
 * `ConnectorRetryStrategy` in this same file (`ConnectorRateLimitConfig`,
 * #4684, was the fourth until its whole shape was retired in #4911), and
 * `ExternalFieldMappingSchema` in `data/external-lookup.zod.ts` — which extends
 * the same base and, precisely because it carries a domain prefix, never
 * entered the dual-source baseline.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ConnectorFieldMappingSchema = lazySchema(() => BaseFieldMappingSchema.extend({
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

export type ConnectorFieldMapping = z.input<typeof ConnectorFieldMappingSchema>;
/** Post-parse shape of {@link ConnectorFieldMapping} — defaults applied, transforms run (ADR-0122). */
export type ConnectorFieldMappingParsed = z.infer<typeof ConnectorFieldMappingSchema>;

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

export type SyncStrategy = z.input<typeof SyncStrategySchema>;

/**
 * Connector Conflict Resolution Strategy
 *
 * Renamed from `ConflictResolution` (#4738, ADR-0112 D9a — the C9/C12
 * prefixing lineage): that bare name was published by three entry points for
 * three different declarations (#4411 trap). The connector-sync strategy takes
 * the domain prefix; the bare `ConflictResolution` went to
 * `@objectstack/spec/ui` (offline client/server sync — a different concept with
 * a disjoint vocabulary). #4988 then retired `ui/offline.zod.ts` whole under
 * ADR-0049, so the bare name is now published by nobody. This name STAYS as it
 * is: it is the connector vocabulary's real name, and un-renaming it to reclaim
 * a freed word would be a second breaking change for no gain.
 * The enum VALUES here are unchanged — authored `syncConfig.conflictResolution`
 * metadata parses byte-for-byte the same. Note `@objectstack/spec/api` also
 * exports `ConflictResolutionStrategy` (route conflicts) — a fourth, distinct
 * name; unrelated to this rename.
 */
export const ConnectorConflictResolutionSchema = lazySchema(() => z.enum([
  'source_wins',    // External system data takes precedence
  'target_wins',    // ObjectStack data takes precedence
  'latest_wins',    // Most recently modified wins
  'manual',         // Flag for manual resolution
]).describe('Conflict resolution strategy'));

export type ConnectorConflictResolution = z.input<typeof ConnectorConflictResolutionSchema>;

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
  conflictResolution: ConnectorConflictResolutionSchema.optional().default('latest_wins'),
  
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

export type DataSyncConfig = z.input<typeof DataSyncConfigSchema>;
/** Post-parse shape of {@link DataSyncConfig} — defaults applied, transforms run (ADR-0122). */
export type DataSyncConfigParsed = z.infer<typeof DataSyncConfigSchema>;

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

export type WebhookEvent = z.input<typeof WebhookEventSchema>;

/**
 * Webhook Signature Algorithm
 */
export const WebhookSignatureAlgorithmSchema = lazySchema(() => z.enum([
  'hmac_sha256',
  'hmac_sha512',
  'none',
]).describe('Webhook signature algorithm'));

export type WebhookSignatureAlgorithm = z.input<typeof WebhookSignatureAlgorithmSchema>;

/**
 * Webhook Configuration Schema
 *
 * Extends the canonical WebhookSchema with connector-specific event types.
 * This allows connectors to subscribe to both data events and connector lifecycle events.
 *
 * ⚠️ NOT YET ENFORCED — declared but ignored at registration (#3197).
 * `AutomationEngine.registerConnector` reads only `actions`; a connector's
 * `webhooks` (including `events`) parse and are stored, but no runtime
 * dispatches, emits, or filters on them.
 */
export const WebhookConfigSchema = lazySchema(() => WebhookSchema.extend({
  /**
   * Events to listen for
   * Connector-specific events like sync completion, auth expiry, etc.
   */
  events: z.array(WebhookEventSchema).optional().describe('Connector events to subscribe to (not yet enforced — no runtime dispatches these; see #3197)'),
  
  /**
   * Signature algorithm for webhook security
   */
  signatureAlgorithm: WebhookSignatureAlgorithmSchema.optional().default('hmac_sha256'),
}));

export type WebhookConfig = z.input<typeof WebhookConfigSchema>;
/** Post-parse shape of {@link WebhookConfig} — defaults applied, transforms run (ADR-0122). */
export type WebhookConfigParsed = z.infer<typeof WebhookConfigSchema>;

// ============================================================================
// Retry Configuration
// ============================================================================
//
// ─── REMOVED: outbound rate limiting (#4911, ADR-0049) ──────────────────
//
// `ConnectorRateLimitConfigSchema` / `ConnectorRateLimitConfig` and the
// `RateLimitStrategySchema` / `RateLimitStrategy` enum it embedded were removed
// wholesale in @objectstack/spec 17.0.0. The key that carried them
// (`ConnectorSchema.rateLimitConfig`) is tombstoned below.
//
// The reason is not "no reader yet" — it is that **the engine does not exist**.
// The platform's only token bucket is `packages/runtime/src/security/
// rate-limit.ts`, and it is INBOUND: the dispatcher calls `consume(key)` with a
// request fingerprint and short-circuits with 429. Nothing anywhere throttles
// the calls *we* make to an external system, so `strategy` / `maxRequests` /
// `windowSeconds` / `burstCapacity` / `respectUpstreamLimits` /
// `rateLimitHeaders` were six well-formed knobs wired to nothing, on the most
// safety-shaped surface a connector has: an author who set them believed they
// had capped their outbound call rate. ADR-0049 says such a property is
// enforced, marked `experimental`, or absent; with no implementation and no
// committed roadmap, absent is the honest disposition. The vocabulary comes
// back **with** the engine, in the same change — implementation-first, the
// #4834 / PR #4878 precedent.
//
// Do NOT reach for `shared/http.zod.ts`'s `RateLimitConfig` as a replacement:
// that one is the INBOUND limiter (`enabled` / `windowMs` / `maxRequests`) and
// limits the calls *others* make to us. The two describe opposite directions and
// were separated by name for exactly that reason (#4684, ADR-0112 D9a) — the
// rename is absorbed by this removal (`scripts/lib/renamed-defs.ts`).
//
// Until an outbound throttle exists, rate-limit an integration where the calls
// are actually made: at the connector provider / upstream gateway.

/**
 * Retry Strategy — connector-side.
 *
 * `Connector`-prefixed because `api/errors.zod.ts` exports a different
 * `RetryStrategy` (`no_retry`, `retry_immediate`, `retry_backoff`,
 * `retry_after`) for HTTP error responses. The two value sets are not
 * interchangeable, so they may not share a name (ADR-0112 D9a).
 */
export const ConnectorRetryStrategySchema = lazySchema(() => z.enum([
  'exponential_backoff',
  'linear_backoff',
  'fixed_delay',
  'no_retry',
]).describe('Retry strategy'));

export type ConnectorRetryStrategy = z.input<typeof ConnectorRetryStrategySchema>;

/**
 * Retry Configuration
 */
export const RetryConfigSchema = lazySchema(() => z.object({
  /**
   * Retry strategy
   */
  strategy: ConnectorRetryStrategySchema.optional().default('exponential_backoff'),
  
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

export type RetryConfig = z.input<typeof RetryConfigSchema>;
/** Post-parse shape of {@link RetryConfig} — defaults applied, transforms run (ADR-0122). */
export type RetryConfigParsed = z.infer<typeof RetryConfigSchema>;

// ============================================================================
// Error Mapping Configuration
// ============================================================================

/**
 * Error Category — connector-side: what an external system's failure maps TO
 * when a connector normalises it.
 *
 * `Connector`-prefixed because `api/errors.zod.ts` exports a different
 * `ErrorCategory` for HTTP error responses. They overlap but disagree
 * (`server_error`/`integration_error`/`timeout` here vs
 * `server`/`external`/`maintenance`/`authentication` there), so a value valid
 * for one is invalid for the other — they may not share a name (ADR-0112 D9a).
 */
export const ConnectorErrorCategorySchema = lazySchema(() => z.enum([
  'validation',
  'authorization',
  'not_found',
  'conflict',
  'rate_limit',
  'timeout',
  'server_error',
  'integration_error',
]).describe('Standard error category'));

export type ConnectorErrorCategory = z.input<typeof ConnectorErrorCategorySchema>;

/**
 * Error Mapping Rule
 * 
 * Maps an external system error code to an ObjectStack standard error.
 */
export const ErrorMappingRuleSchema = lazySchema(() => z.object({
  sourceCode: z.union([z.string(), z.number()]).describe('External system error code'),
  sourceMessage: z.string().optional().describe('Pattern to match against error message'),
  targetCode: z.string().describe('ObjectStack standard error code'),
  targetCategory: ConnectorErrorCategorySchema.describe('Error category'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Error severity level'),
  retryable: z.boolean().describe('Whether the error is retryable'),
  userMessage: z.string().optional().describe('Human-readable message to show users'),
}).describe('Error mapping rule'));

export type ErrorMappingRule = z.input<typeof ErrorMappingRuleSchema>;

/**
 * Error Mapping Configuration
 * 
 * Configures how external system errors are mapped to ObjectStack standard errors.
 */
export const ErrorMappingConfigSchema = lazySchema(() => z.object({
  rules: z.array(ErrorMappingRuleSchema).describe('Error mapping rules'),
  defaultCategory: ConnectorErrorCategorySchema.optional().default('integration_error').describe('Default category for unmapped errors'),
  unmappedBehavior: z.enum(['passthrough', 'generic_error', 'throw']).describe('What to do with unmapped errors'),
  logUnmapped: z.boolean().optional().default(true).describe('Log unmapped errors'),
}).describe('Error mapping configuration'));

export type ErrorMappingConfig = z.input<typeof ErrorMappingConfigSchema>;
/** Post-parse shape of {@link ErrorMappingConfig} — defaults applied, transforms run (ADR-0122). */
export type ErrorMappingConfigParsed = z.infer<typeof ErrorMappingConfigSchema>;

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

export type HealthCheckConfig = z.input<typeof HealthCheckConfigSchema>;
/** Post-parse shape of {@link HealthCheckConfig} — defaults applied, transforms run (ADR-0122). */
export type HealthCheckConfigParsed = z.infer<typeof HealthCheckConfigSchema>;

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

export type CircuitBreakerConfig = z.input<typeof CircuitBreakerConfigSchema>;
/** Post-parse shape of {@link CircuitBreakerConfig} — defaults applied, transforms run (ADR-0122). */
export type CircuitBreakerConfigParsed = z.infer<typeof CircuitBreakerConfigSchema>;

/**
 * Connector Health Configuration
 * 
 * Combines health check and circuit breaker for connector resilience.
 */
export const ConnectorHealthSchema = lazySchema(() => z.object({
  healthCheck: HealthCheckConfigSchema.optional().describe('Health check configuration'),
  circuitBreaker: CircuitBreakerConfigSchema.optional().describe('Circuit breaker configuration'),
}).describe('Connector health configuration'));

export type ConnectorHealth = z.input<typeof ConnectorHealthSchema>;
/** Post-parse shape of {@link ConnectorHealth} — defaults applied, transforms run (ADR-0122). */
export type ConnectorHealthParsed = z.infer<typeof ConnectorHealthSchema>;

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
  'api',            // Generic REST API
  'custom',         // Custom connector
]).describe('Connector type'));

export type ConnectorType = z.input<typeof ConnectorTypeSchema>;

/**
 * Connector Status
 */
export const ConnectorStatusSchema = lazySchema(() => z.enum([
  'active',         // Connector is active and syncing
  'inactive',       // Connector is configured but disabled
  'error',          // Connector has errors
  'configuring',    // Connector is being set up
]).describe('Connector status'));

export type ConnectorStatus = z.input<typeof ConnectorStatusSchema>;

/**
 * What one connector action does **upstream** (#4395).
 *
 *  - `'read'` — the action never mutates the external system (a lookup, a
 *    search, a fetch). Its step reports a real `acted: 0`.
 *  - `'write'` — it mutates (a create, an update, a delete, an enqueue). A
 *    step whose dispatch SUCCEEDED reports `acted: 1`.
 *
 * Absent is the third answer and stays the default: the platform reports
 * `ExecutionStepMetrics.unmeasuredEffect`, i.e. "this may have caused an effect
 * I cannot count" — never `acted: 0`, which would claim it did nothing.
 *
 * ## Why the runtime needs this declared rather than inferred
 *
 * `connector_action` dispatches to a handler that reaches an external system;
 * nothing on this side can see what happened there. #4354's per-run summary
 * reports `selected` / `acted` and the broken-sweep alert is
 * `selected > 0 AND acted = 0 AND unmeasured = 0`, so the two guesses are both
 * wrong in a costly direction: a blanket `acted: 0` trips the alert on every
 * healthy connector sweep until operators learn to ignore it, and a blanket
 * `acted: 1` makes a read-only sweep look busy forever so the alert never
 * fires. `http` gets to skip this question because the HTTP method answers it
 * (`GET` reads, anything else mutates); a connector action's key does not.
 *
 * ## Why the vocabulary differs from `FlowFunctionEffectSchema`
 *
 * That one (`'pure' | 'writes'`, #4396) classifies a *local* compute step and
 * deliberately has no `reads` member, because a `script` node's writes are
 * downstream declarative nodes that count themselves. Here BOTH members are
 * countable facts about a remote call, which is exactly what makes declaring
 * `read` worth writing: it converts an uncountable step into a measured zero.
 */
export const ConnectorActionEffectSchema = lazySchema(() => z.enum([
  'read',
  'write',
]).describe("What the action does upstream: 'read' never mutates (reports acted:0); 'write' does (a successful dispatch reports acted:1). Omit when the effect is not knowable — the step is then reported as unmeasured, not as zero"));

export type ConnectorActionEffect = z.input<typeof ConnectorActionEffectSchema>;

/**
 * Connector Action Definition
 */
export const ConnectorActionSchema = lazySchema(() => z.object({
  key: z.string().describe('Action key (machine name)'),
  label: z.string().describe('Human readable label'),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional().describe('Input parameters schema (JSON Schema)'),
  outputSchema: z.record(z.string(), z.unknown()).optional().describe('Output schema (JSON Schema)'),
  /**
   * What this action does upstream (#4395) — see
   * {@link ConnectorActionEffectSchema}. Optional on purpose: every connector
   * written before this key keeps working and reports exactly what it reported
   * before (`unmeasuredEffect`), so declaring it is a strict improvement rather
   * than a migration.
   *
   * This is the ONLY producer of the effect. `AutomationEngine.registerConnector`
   * stores `ConnectorSchema.parse(def)`, and the designer-facing
   * `ConnectorActionDescriptor` is projected from that stored def — so both the
   * hand-registered path and the ADR-0097 declarative materialization path read
   * the declaration from right here.
   */
  effect: ConnectorActionEffectSchema.optional(),
}));
export type ConnectorAction = z.input<typeof ConnectorActionSchema>;

/**
 * Connector Trigger Definition
 *
 * ⚠️ NOT YET ENFORCED — declared but never read by the runtime (#3197).
 * `AutomationEngine.registerConnector` ignores a connector's `triggers`; the
 * only runtime touch is the authoring-time reject rule that forbids triggers
 * on provider-bound declarative instances (ADR-0097 §5). No polling loop or
 * webhook receiver is driven by these definitions.
 */
export const ConnectorTriggerSchema = lazySchema(() => z.object({
  key: z.string().describe('Trigger key'),
  label: z.string().describe('Trigger label'),
  description: z.string().optional(),
  type: z.enum(['polling', 'webhook']).describe('Trigger type'),
  interval: z.number().optional().describe('Polling interval in seconds'),
}));
export type ConnectorTrigger = z.input<typeof ConnectorTriggerSchema>;

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
   * here (ADR-0097). Hand-written / plugin connectors keep setting it as before.
   */
  authentication: ConnectorAuthConfigSchema.optional().default({ type: 'none' }).describe(
    'Authentication configuration (runtime shape with inline secrets). Provider-bound declarative instances use `auth.credentialRef` instead.',
  ),

  /**
   * ADR-0097 — provider key naming the installed **generic executor** that
   * materializes this declarative entry into a live, dispatchable connector at
   * boot (`openapi`, `mcp`, `rest`, or any provider a connector plugin
   * contributes). Presence flips the entry from an inert catalog **descriptor**
   * (#2612) to an **instance declaration**: the automation service resolves the
   * matching provider factory at boot and registers the result on the connector
   * registry. A declared `provider` with no installed factory is a hard boot
   * error. Omit `provider` to keep the entry a pure descriptor.
   */
  provider: z.string().regex(/^[a-z][a-z0-9_]*$/).optional().describe(
    'Generic-executor key that materializes this declarative entry at boot (e.g. openapi/mcp/rest). Omit for a catalog-only descriptor. Unknown provider ⇒ hard boot error (ADR-0097).',
  ),

  /**
   * ADR-0097 — provider-specific configuration, **validated by the provider
   * factory** (not by this schema): the OpenAPI provider expects `{ spec,
   * baseUrl? }` — where `spec` is an inline OpenAPI document object, a file
   * path resolved relative to the declaring stack/package root (reads are
   * confined to that root; #3016), or an http(s) URL — the MCP provider a
   * `{ transport }`, the REST provider a `{ baseUrl }`. Deliberately untyped
   * here — re-modelling each provider's inputs in the stack schema (an OpenAPI
   * document, an MCP transport) is exactly what ADR-0023 rejected. Ignored
   * unless `provider` is set.
   */
  providerConfig: z.record(z.string(), z.unknown()).optional().describe(
    'Provider-specific config validated by the provider factory at boot (e.g. { spec, baseUrl } for openapi, ' +
      "where spec is an inline document, a package-relative file path like './billing-openapi.json', or an http(s) URL). " +
      'Requires `provider`.',
  ),

  /**
   * ADR-0097 — declarative auth for a provider-bound instance: secret-bearing
   * variants carry a `credentialRef` the automation service resolves through the
   * secrets/env layer at materialization, never an inline secret (§3). Distinct
   * from {@link authentication}, which is the runtime shape with the resolved
   * secret inline. Requires `provider`.
   */
  auth: ConnectorInstanceAuthSchema.optional().describe(
    'Declarative instance auth — references credentials via `credentialRef` (resolved at boot), never inline secrets. Requires `provider` (ADR-0097).',
  ),

  /** Zapier-style Capabilities */
  actions: z.array(ConnectorActionSchema).optional(),
  triggers: z.array(ConnectorTriggerSchema).optional().describe('Trigger definitions (not yet enforced — never read at registration; see #3197)'),
  
  /**
   * Data synchronization configuration
   */
  syncConfig: DataSyncConfigSchema.optional().describe('Data sync configuration'),
  
  
  /**
   * Field mappings
   */
  fieldMappings: z.array(ConnectorFieldMappingSchema).optional().describe('Field mapping rules'),
  
  /**
   * Webhook configuration
   */
  webhooks: z.array(WebhookConfigSchema).optional().describe('Webhook configurations (not yet enforced — never read at registration; see #3197)'),
  
  /**
   * REMOVED (#4911) — outbound rate limiting. See the block above
   * "REMOVED: outbound rate limiting" for why the whole shape went, not just
   * this key. `ConnectorSchema` is NOT `.strict()`, so a plain delete would be
   * a silent strip (ADR-0104); the tombstone makes the removal audible in the
   * two channels an upgrading author actually hits — `tsc` and the parse.
   */
  rateLimitConfig: retiredKey(
    '`connector.rateLimitConfig` was removed in @objectstack/spec 17.0.0 (#4911, ADR-0049 D2) — ' +
    'the entire shape is gone, not just this key: `ConnectorRateLimitConfig` and its ' +
    '`RateLimitStrategy` enum were removed with it, because no outbound rate-limiting engine ' +
    'ever existed. The platform\'s only token bucket (runtime `security/rate-limit.ts`) throttles ' +
    'INBOUND requests to us; nothing throttled the calls a connector makes out, so every knob ' +
    'here was inert while reading like a configured cap. Delete the key. Do NOT substitute ' +
    '`shared` `RateLimitConfig` — that is the inbound limiter and would cap the wrong direction; ' +
    'until an outbound throttle exists, rate-limit at the connector provider or upstream gateway. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),

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

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  //
  // [#6362, split out of #6245] Declared for the reason `webhook.zod.ts` and
  // `sharing.zod.ts` state for their own spreads: BOTH metadata load paths call
  // `applyProtection` on EVERY type, so a package-loaded connector already
  // carries these keys by the time anything re-parses it — and `/meta/connector`
  // has re-parsed them since #6245 bound `DeclarativeConnectorEntrySchema` to
  // that door.
  //
  // The failure mode here is the QUIET half of the pair, which is exactly why
  // it outlived its two siblings. `sharing_rule` is `.strict()`, so its
  // undeclared envelope was REJECTED — a hard 422, fixed in #6245 the moment
  // the door was bound. This shape is a plain (non-strict) `z.object`, so it
  // TOLERATES the envelope and returns `success` — then strips it. Tolerate is
  // not preserve: measured on `origin/main` before this spread, a stamped
  // catalog descriptor round-tripping through the bound schema came back having
  // lost all seven keys (`_lock`, `_lockReason`, `_lockSource`, `_provenance`,
  // `_packageId`, `_packageVersion`, `_lockDocsUrl`), so every consumer of
  // `extractProtection` / `resolveLockState` downstream of a parse saw an
  // unlocked, unattributed, org-provenance item. No error anywhere.
  //
  // `webhook` was measured in the same pass and needs nothing: it has carried
  // this spread since #4001 batch 11, and all seven keys survive its
  // round-trip. See `connector.test.ts` → 'ADR-0010 protection envelope' for
  // the pins that hold both readings.
  //
  // Pure-additive and internal: every key is `_`-prefixed and optional, so no
  // author-facing field changes and nothing that parsed before stops parsing.
  ...MetadataProtectionFields,
}));

export type Connector = z.input<typeof ConnectorSchema>;
/** Post-parse shape of {@link Connector} — defaults applied, transforms run (ADR-0122). */
export type ConnectorParsed = z.infer<typeof ConnectorSchema>;

/**
 * Type-safe factory for an external-system connector. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Connector` literal.
 */
export function defineConnector(config: z.input<typeof ConnectorSchema>): ConnectorParsed {
  return ConnectorSchema.parse(config);
}

/**
 * A declarative `connectors:` **stack entry** (ADR-0097) — {@link ConnectorSchema}
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
          message: '`providerConfig` requires a `provider` — a connector entry with no provider is a catalog descriptor (ADR-0097).',
        });
      }
      if (entry.auth !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['auth'],
          message: '`auth` requires a `provider` — declarative instance auth applies only to a provider-bound entry (ADR-0097).',
        });
      }
      return;
    }
    // Provider-bound instance declaration.
    if (entry.authentication && entry.authentication.type !== 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['authentication'],
        message: `Provider-bound connector instance '${entry.name}' must not inline secrets via \`authentication\`; reference credentials with \`auth: { type, credentialRef }\` instead (ADR-0097 §3).`,
      });
    }
    if (entry.actions && entry.actions.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: `Provider-bound connector instance '${entry.name}' must not author \`actions\` — the '${entry.provider}' provider derives them from the upstream at boot (ADR-0097 §5).`,
      });
    }
    if (entry.triggers && entry.triggers.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['triggers'],
        message: `Provider-bound connector instance '${entry.name}' must not author \`triggers\` — the '${entry.provider}' provider derives them from the upstream at boot (ADR-0097 §5).`,
      });
    }
  }),
);

export type DeclarativeConnectorEntry = z.input<typeof DeclarativeConnectorEntrySchema>;
/** Post-parse shape of {@link DeclarativeConnectorEntry} — defaults applied, transforms run (ADR-0122). */
export type DeclarativeConnectorEntryParsed = z.infer<typeof DeclarativeConnectorEntrySchema>;

// Re-export the declarative-instance auth surface (ADR-0097) so consumers reach
// it through `@objectstack/spec/integration` alongside the connector schema.
export {
  ConnectorInstanceAuthSchema,
  ConnectorInstanceNoAuthSchema,
  ConnectorInstanceBearerAuthSchema,
  ConnectorInstanceAPIKeyAuthSchema,
  ConnectorInstanceBasicAuthSchema,
} from '../shared/connector-auth.zod';
export type {
  ConnectorInstanceAuth,
  ResolvedConnectorAuth,
  // The four member aliases travel with the four schema consts above: each is a
  // documented JSON Schema whose reference page lives under `integration/`, so
  // the type has to reach the same entry point or the page's `import type` line
  // has nothing to name (#4593).
  ConnectorInstanceNoAuth,
  ConnectorInstanceBearerAuth,
  ConnectorInstanceAPIKeyAuth,
  ConnectorInstanceBasicAuth,
} from '../shared/connector-auth.zod';
