// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ConnectorAuthConfigSchema, ConnectorInstanceAuthSchema } from '../shared/connector-auth.zod';
import { FieldMappingSchema as BaseFieldMappingSchema } from '../shared/mapping.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { acceptRetiredDefaultResidue, retiredKey } from '../shared/retired-key';

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
 * Includes authentication, field mapping, bidirectional sync, retry policies,
 * and complete lifecycle management.
 *
 * This protocol supports multiple authentication strategies, bidirectional sync,
 * field mapping, and an executed retry policy. It declares no health probe, no
 * circuit breaker, no authored status, no webhooks and no triggers of its own —
 * see "What this layer does NOT provide" below.
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
 * upstream gateway.**
 *
 * **What you MAY reach for is `retryConfig` — ADR-0049 ruled `实现` and the
 * platform now executes it.** A connector's declared policy is applied at the
 * one place the platform makes an outbound call, `shared/resilientFetch`, via
 * the single mapping in `integration/connector-fetch-policy.ts`: the backoff
 * shape (`strategy`, `initialDelayMs`, `backoffMultiplier`, `maxDelayMs`,
 * `jitter`), the attempt count (`maxAttempts`, which counts TOTAL calls with
 * the first included), what is retried (`retryableStatusCodes`, whose default
 * `[408, 429, 500, 502, 503, 504]` includes `429`, and `retryOnNetworkError`),
 * and `requestTimeoutMs` as each attempt's deadline. It reaches a provider
 * factory through `ConnectorProviderContext`, so a custom provider doing its
 * own I/O honours the same policy the built-in HTTP providers honour by
 * construction. ⚠️ Retrying a `429` is not throttling it: a retry policy
 * spaces out the calls you already made, it does not cap the rate, so the
 * sentence above about rate limiting stands unchanged.
 *
 * **There is no connector health probe and no circuit breaker.** The
 * `health` block (`healthCheck` and `circuitBreaker`) was removed in
 * `@objectstack/spec` 17 (ADR-0049 enforce-or-remove) together with the
 * authored `status` and the nested `webhooks` array: nothing ever scheduled a
 * probe, opened a breaker, read an authored status or delivered a webhook
 * declared inside a connector. Implement probes and circuit breaking in the
 * connector provider or an upstream gateway; whether a registered connector can
 * be dispatched is the computed `state` (`ready` / `degraded`) that
 * `GET /api/v1/automation/connectors` reports; and a webhook that is actually
 * delivered is declared in the stack's top-level `webhooks:` collection. The
 * "REMOVED: `health`, `status` and the nested `webhooks`" section below records
 * the measurement.
 *
 * **There are no connector triggers.** The `triggers` array (`polling` /
 * `webhook`) was removed in `@objectstack/spec` 17 (ADR-0049 enforce-or-remove):
 * nothing ever registered, polled or received one, so a declared trigger never
 * started a flow. Work starts from a FLOW that calls the connector's action in a
 * `connector_action` node — an `api` flow for an external event, a `schedule`
 * flow for a scheduled pull. The "REMOVED: `triggers`" section below records the
 * measurement.
 *
 * `connectionTimeoutMs` used to be the second exception and is now **removed**
 * (ADR-0049, the narrower second decision that surface was owed): it was
 * carried to a provider factory but never applied as a deadline anywhere, and
 * it is not implementable where it was declared, because a WHATWG `fetch`
 * exposes one `AbortSignal` over the whole operation and never the connection
 * phase alone. `requestTimeoutMs` is the bound the platform can keep. The full
 * removal reasoning is recorded at each removal site: the "REMOVED:
 * `connectionTimeoutMs`" and "REMOVED: outbound rate limiting" blocks in
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
 * (L2 above). Already authored the retired key? `os migrate meta --from 16` lists the mechanical edits for existing sources — the key itself is removed.
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
 * - Full CRUD operations and data synchronization
 * - Need comprehensive retry strategies and error handling
 *
 * **Examples:**
 * - Full Salesforce integration
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
 * `ExternalFieldMappingSchema` in `data/external-lookup.zod.ts` — which
 * extended the same base and, precisely because it carried a domain prefix,
 * never entered the dual-source baseline (the external-lookup family was
 * itself retired whole in #8075 — ADR-0049, zero consumers).
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
  
  /*
   * `syncConfig.schedule` was DELETED here in @objectstack/spec 17 (ADR-0049
   * enforce-or-remove, #16320). The cron slot on connector-attached sync was
   * declared, parsed into the `{ dialect: 'cron', source }` envelope and read by
   * nothing: `syncConfig` has no reader outside `packages/spec`, no engine schedules
   * a connector sync, and `@objectstack/formula`'s cronEngine has zero consumers
   * outside its own package. Deleted outright — no `retiredKey()` tombstone, no D2
   * conversion, no D3 semantic entry (maintainer ruling 2026-09-10 on the retirement
   * PR). `realtimeSync` is unchanged; sync on a cadence is a `job`
   * (`Job.schedule.expression`, the one cron slot the platform evaluates) whose
   * handler drives the connector.
   */
  
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
// REMOVED: the connector-nested webhook shape (ADR-0049 enforce-or-remove)
// ============================================================================
//
// `WebhookConfigSchema` (the canonical `WebhookSchema` `.extend()`ed with
// `events` and `signatureAlgorithm`), its `WebhookEventSchema` event vocabulary
// (`record.*`, `sync.*`, `auth.expired`, `rate_limit.exceeded`) and the
// `WebhookSignatureAlgorithmSchema` enum used to live here, authorable only
// through `ConnectorSchema.webhooks`. They left whole with that key: a webhook
// nested inside a connector was never registered as a `webhook` metadata item
// (the stack decomposition registers a connector entry WHOLE), so
// `@objectstack/plugin-webhooks` never materialized it into `sys_webhook` and
// nothing ever delivered it — and no code path emits a connector lifecycle
// event (`sync.completed`, `auth.expired`, …) for `events` to have subscribed
// to. The three defs are declared in `RETIRED_DEFS_BY_MAJOR[18]`; the carrier
// key is the `webhooks` tombstone on `ConnectorBaseSchema` below, and the
// section "REMOVED: `health`, `status` and the nested `webhooks`" records the
// measurement. A webhook that is actually delivered is declared in the stack's
// top-level `webhooks:` collection (`automation/webhook.zod.ts`).

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
// Error Mapping Configuration — RETIRED (ADR-0049 enforce-or-remove)
// ============================================================================
//
// This section declared `ConnectorErrorCategorySchema` (an 8-value enum),
// `ErrorMappingRuleSchema` (7 keys: `sourceCode`, `sourceMessage`, `targetCode`,
// `targetCategory`, `severity`, `retryable`, `userMessage`) and
// `ErrorMappingConfigSchema` (4 keys: `rules`, `defaultCategory`,
// `unmappedBehavior`, `logUnmapped`), authorable through
// `ConnectorSchema.errorMapping` below. Measured on `origin/main` before the
// removal: outside this file and its unit test, the only reference in the tree
// was a type-identity pin — no provider, dispatcher or materializer ever mapped
// an external error through the rules, so `unmappedBehavior` configured nothing
// and a rule's `userMessage` was never shown to anyone. That last spelling is
// what made the surface worse than ordinary dead metadata: it is the name of the
// LIVE API-error channel (`ApiError.userMessage`, read off a thrown HTTP error),
// so an author who had read that documentation and wrote a rule here reasonably
// believed they were marking a refusal for an end user, and the failure was
// silent in both directions (it validated, it published, nothing was shown).
//
// Removal resolved the collision by deletion. The three defs left whole
// (`integration/ErrorMappingConfig`, `integration/ErrorMappingRule`,
// `integration/ConnectorErrorCategory` in `RETIRED_DEFS_BY_MAJOR[18]` — the
// enum's only consumers were the two removed shapes, and an exported value
// schema with no consumer reads as a capability); the carrier key is a
// `retiredKey()` tombstone (`ERROR_MAPPING_RETIRED`, on `ConnectorSchema`), and
// the D2 conversion `connector-error-mapping-removed` strips the block from
// existing sources. `api/errors.zod.ts`'s `ErrorCategory` — the HTTP-response
// vocabulary the retired enum was deliberately NOT allowed to share a name
// with (ADR-0112 D9a) — is unaffected.

/**
 * The prescription an author meets when they write `errorMapping` — in `tsc`
 * (the key's input type is `never`) and at parse (this string is the issue
 * message). It IS the migration doc for whoever hits it; the closing sentence
 * is the house `os migrate meta` form pinned by
 * `shared/retired-key-migrate-sentence.test.ts`.
 */
const ERROR_MAPPING_RETIRED =
  '`connector.errorMapping` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no provider, dispatcher or materializer '
  + 'mapped an external error through the rules, so `unmappedBehavior` configured nothing '
  + "and a rule's `userMessage` was never shown to anyone (that spelling is the live "
  + 'API-error channel, `ApiError.userMessage`, which a thrown HTTP error declares — not '
  + 'connector metadata). Delete the key; the whole shape leaves with it (`ErrorMappingConfig`, '
  + '`ErrorMappingRule` and the `ConnectorErrorCategory` enum). There is no replacement, '
  + "because no error-mapping engine exists: a connector's failures reach callers as the "
  + "provider's own errors (ADR-0097). "
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

// ============================================================================
// REMOVED: `connectionTimeoutMs` — the connect-phase deadline (ADR-0049)
// ============================================================================
//
// A bounded (`min(1000).max(300000)`), defaulted (`30000`), `.describe()`d key
// on this schema and — because both published carriers wrap the same private
// `ConnectorBaseSchema` — on
// `DeclarativeConnectorEntrySchema`, so it was authorable from `stack.connectors[]`,
// from `PUT /meta/connector/:name`, and served back by `/meta/connector`. Every
// signal an authoring surface can give said it worked.
//
// ⚠️ It was not merely unimplemented — it is NOT IMPLEMENTABLE AT THE SITE IT
// NAMES, which is why ADR-0049's `实现` arm was unavailable and the second
// decision came out `retire`. A connector's outbound call is a WHATWG `fetch`,
// whose only cancellation surface is ONE `AbortSignal` covering the whole
// operation; nothing in that interface observes the connection phase
// separately. The two honest readings were both losses: bound "time until the
// response arrives" with this key — which kills a slow-but-connected upstream
// the author meant to allow with a large `requestTimeoutMs`, breaking the very
// promise the key makes — or leave it unenforced and say so. (Node's undici
// exposes `connectTimeout` through a custom dispatcher; Node-only, and a new
// subsystem underneath every connector, which the #18975 ruling forbids.)
//
// ⚠️ The carry was real and is what this removal actually withdraws, so do not
// read it as a zero-mention retirement. #18975 put the key on
// `ConnectorProviderContext`, and five sites outside `packages/spec` READ it:
// the materialization fingerprint and the context build in
// `services/service-automation/src/plugin.ts`, `ctx.connectionTimeoutMs` in the
// `rest` and `openapi` provider factories, and the `?? 30000` fallbacks that
// deposited it back onto the reported def. Measured across all five, the
// value's only termini were the def `GET /connectors` echoes and the
// fingerprint that decides whether to re-materialize — never a deadline.
// `connectorFetchOptions()` (`integration/connector-fetch-policy.ts`) is the one
// mapping from authored policy onto the platform's outbound `fetch`, and it was
// handed `{ retryConfig, requestTimeoutMs }` only. Carrying a number is not
// honouring it: ADR-0049 forbids the parsed-unmarked-unenforced state whether
// the inert value travels or sits still.
//
// `requestTimeoutMs` is the replacement and the lit control for every reading
// above — same schema, same census, same files — because it resolves to a real
// read. The live record is in the tree, not in a card number:
// `integration/connector-fetch-policy.ts` maps it onto `opts.timeoutMs`,
// `resilientFetch`'s per-attempt deadline, and `connector-fetch-policy.test.ts`
// pins that mapping. Bound the connect phase at a provider or gateway that can
// see it.
//
// `ConnectorSchema` is NOT `.strict()`, so a plain delete would be a silent
// strip (ADR-0104); the tombstone below makes the removal audible in the two
// channels an upgrading author actually hits — `tsc` and the parse. Registered
// as `integration/Connector:connectionTimeoutMs` and
// `integration/DeclarativeConnectorEntry:connectionTimeoutMs` in
// `RETIRED_KEYS_BY_MAJOR[18]`; stored rows and authored sources are rewritten by
// the D2 conversion `connector-connection-timeout-ms-removed`, and the withdrawn
// `ConnectorProviderContext` member by the D3 semantic entry
// `connector-provider-context-connection-timeout-ms-retired`.
//
// No orphaned def leaves with it: the key was a bare `z.number()`, not a
// `ConfigSchema` shape, so `RETIRED_DEFS_BY_MAJOR[18]` gains nothing here.

/**
 * The prescription an author meets when they write `connectionTimeoutMs` — in
 * `tsc` (the key's input type is `never`) and at parse (this string is the
 * issue message). It IS the migration doc for whoever hits it; the closing
 * sentence is the house `os migrate meta` form pinned by
 * `shared/retired-key-migrate-sentence.test.ts`.
 */
const CONNECTION_TIMEOUT_MS_RETIRED =
  '`connector.connectionTimeoutMs` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — the platform never honoured it and cannot honour it where it was '
  + "declared: a connector's outbound call is a WHATWG `fetch`, whose only cancellation "
  + 'surface is one `AbortSignal` over the whole operation, so nothing there observes the '
  + 'connection phase separately, and the value only ever travelled (onto the reported def '
  + 'and the materialization fingerprint) without ever bounding a connect. Delete the key. '
  + 'Use `requestTimeoutMs` for the deadline the platform does keep — it is applied as '
  + "`resilientFetch`'s per-attempt timeout — and bound the connect phase at a connector "
  + 'provider or upstream gateway on a transport that can separate the phases. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

/**
 * The retired default the published 17.x toolchain MATERIALIZED, captured as a
 * literal because nothing else records it once the declaration is gone
 * (#12840, maintainer ruling 2026-08-28; the class rule is
 * `shared/retired-key.ts` — "the next retirement of a defaulted key reuses this
 * helper with its own captured literal instead of re-inventing the judgement").
 *
 * ⭐ WHY THIS RETIREMENT IS OWED THE STAGE, measured rather than argued by
 * analogy. `connectionTimeoutMs` was declared `.optional().default(30000)`, so a
 * 17.x parse emitted it into EVERY connector — authored or not. Measured across
 * two builds: on the base build `ObjectStackSchema.parse({ connectors: [{ name,
 * label, type }] })` returns an entry whose keys are `authentication`,
 * `connectionTimeoutMs`, `enabled`, `label`, `name`, `requestTimeoutMs`,
 * `status`, `type` — the author typed three of those. Feed that exact emitted
 * object back to the tombstoned build and it is refused at
 * `connectors.0.connectionTimeoutMs`.
 *
 * That residue is not hypothetical, because this schema has TWO DOORS (the fact
 * `liveness/connector.json` records at the top of its `_note`): besides the
 * authoring doors, `AutomationEngine.registerConnector` parses `ConnectorSchema`
 * for a def a PLUGIN or an ADR-0097 provider factory builds IN CODE. A connector
 * package still compiled against 17.x carries the materialized `30000` in that
 * def literal — every one of the four shipped connectors did, which is what the
 * card counted as its five hardcoded writes — so without this stage a 17.x
 * plugin fails registration on a value its author never typed.
 *
 * ⛔ Nothing is un-retired: `z.input` stays `never` (authoring it is still a tsc
 * error), the `[RETIRED]` authorable-surface row stays, and any OTHER value —
 * `15000`, `1000` — keeps the tombstone's refusal with the prescription
 * byte-for-byte. Only the emitted default is accepted, and it is STRIPPED, so a
 * parse → serialize round-trip converges on the clean shape.
 *
 * ⭐ `status: 'inactive'` joined the stage when `status` was retired, for the
 * same measured reason and by the same class rule: the key was declared
 * `.optional().default('inactive')`, so the same 17.x parse above emitted
 * `status: 'inactive'` into every connector too (it is in that emitted key
 * list), and a def built by a released toolchain carries it back to
 * `registerConnector`. `'active'`, `'error'` and `'configuring'` were never
 * materialized by anything but an author (or a plugin's own literal), so they
 * keep the tombstone's refusal with the prescription.
 */
const CONNECTOR_RETIRED_KEY_RESIDUE = {
  connectionTimeoutMs: 30000,
  status: 'inactive',
} as const;

// ============================================================================
// REMOVED: `health`, `status` and the nested `webhooks` (ADR-0049)
// ============================================================================
//
// Sixteen authorable keys on this schema, in three families, that NOTHING read —
// retired together under ADR-0049 enforce-or-remove, by the maintainer's
// criterion for a declared-but-unenforced family: does the mainstream platform
// offer this capability? Yes ⇒ build the consumer once, correctly; no ⇒ retire.
// Measured on `origin/main` before the removal, with a lit control beside each
// zero:
//
//  - `health.healthCheck` (`enabled`, `intervalMs`, `timeoutMs`, `endpoint`,
//    `method`, `expectedStatus`, `unhealthyThreshold`, `healthyThreshold`) and
//    `health.circuitBreaker` (`enabled`, `failureThreshold`, `resetTimeoutMs`,
//    `halfOpenMaxRequests`, `monitoringWindowMs`, `fallbackStrategy`): zero
//    reads outside `packages/spec`. No loop ever polled a connector endpoint,
//    counted consecutive failures or crossed a threshold, and no state machine
//    ever opened, half-opened or closed a breaker; `fallbackStrategy` named four
//    behaviours none of which was implemented. The only `healthCheck` code
//    outside this package is the KERNEL's plugin health contract — a different
//    shape on a different subject. (Control: `retryConfig`, the executed
//    sibling policy, is read in the same scope.) Mainstream connector metadata
//    (Salesforce Named Credentials, Power Platform custom connectors,
//    Retool / Appsmith resources) carries no author-configured probe or
//    breaker; breakers live in API-gateway infrastructure.
//  - `status` (`active` / `inactive` / `error` / `configuring`, defaulted
//    `'inactive'`): zero reads. `GET /api/v1/automation/connectors` publishes
//    `state` (`ready` / `degraded`), which the runtime COMPUTES and no authored
//    value can set — two names one letter apart on one payload, only one of
//    them real. What decides participation is `enabled` (and `provider` on a
//    declarative instance). The four shipped connector packages and the
//    automation service's degraded husk WROTE the key (`'active'` / `'error'`)
//    and nothing read it back; those writes were deleted with it.
//  - `webhooks` (the nested `WebhookConfig[]`): zero reads of a connector's own
//    array. The stack decomposition registers a connector entry WHOLE, so a
//    webhook nested in it never became a `webhook` item, never reached
//    `@objectstack/plugin-webhooks`' materializer and was never delivered — the
//    top-level `webhooks:` collection is the delivered one.
//
// `ConnectorSchema` is NOT `.strict()`, so a plain delete would be a silent
// strip (ADR-0104): each carrier key is a `retiredKey()` tombstone below,
// inherited by `DeclarativeConnectorEntrySchema` because both published
// carriers wrap the same private `ConnectorBaseSchema`. The shapes behind them
// leave whole — `integration/ConnectorHealth`, `integration/HealthCheckConfig`,
// `integration/CircuitBreakerConfig`, `integration/ConnectorStatus`,
// `integration/WebhookConfig`, `integration/WebhookEvent` and
// `integration/WebhookSignatureAlgorithm` in `RETIRED_DEFS_BY_MAJOR[18]` —
// because an exported value schema with no consumer reads as a capability.
// Registered as `integration/Connector:{health,status,webhooks}` and
// `integration/DeclarativeConnectorEntry:{health,status,webhooks}` in
// `RETIRED_KEYS_BY_MAJOR[18]`; authored sources and stored rows are rewritten
// by the D2 conversion `connector-resilience-keys-removed`, and the family's
// judgement lives in the D3 entry `connector-resilience-keys-retired`.
//
// `circuitBreaker.monitoringWindow` → `monitoringWindowMs` was renamed earlier
// in this same unreleased protocol step; the rename's breaker half is ABSORBED
// by this removal (`spec-property-retirement` §0): a renamed key that is then
// stripped with its whole block is unobservable, and the conversion table's
// disjoint-fixture contract cannot hold both. The same rename's other half,
// `triggers[].interval` → `intervalSeconds`, was a different family and was
// left standing here; it was absorbed in turn when the whole `triggers` array
// was retired — see "REMOVED: `triggers`" below.

/**
 * The prescription an author meets when they write `health` — in `tsc` (the
 * key's input type is `never`) and at parse (this string is the issue
 * message). It IS the migration doc for whoever hits it, including the author
 * who still holds the pre-rename `monitoringWindow` spelling; the closing
 * sentence is the house `os migrate meta` form pinned by
 * `shared/retired-key-migrate-sentence.test.ts`.
 */
const HEALTH_RETIRED =
  '`connector.health` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
  + 'no connector health probe or circuit breaker ever existed: nothing scheduled a '
  + '`healthCheck` request, counted consecutive failures against a threshold, or opened, '
  + 'half-opened or closed a `circuitBreaker`, and no `fallbackStrategy` was ever applied, so '
  + 'every key in the block configured nothing. That includes `circuitBreaker.monitoringWindowMs` '
  + 'and the `monitoringWindow` spelling it was renamed from: the renamed key is removed with the '
  + 'rest. Delete the key; the whole shape leaves with it (`ConnectorHealth`, '
  + '`HealthCheckConfig`, `CircuitBreakerConfig`). Whether a connector can be dispatched is '
  + 'computed, not authored: `GET /api/v1/automation/connectors` reports each connector\'s '
  + '`state` (`ready` or `degraded`). Put health probes and circuit breaking in the connector '
  + 'provider or an upstream gateway. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

/**
 * The prescription an author meets when they write `status` — in `tsc` and at
 * parse. Only a NON-default value reaches it at parse: the emitted default
 * `'inactive'` is accepted and stripped as inert residue by
 * {@link CONNECTOR_RETIRED_KEY_RESIDUE}.
 */
const STATUS_RETIRED =
  '`connector.status` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
  + "nothing ever read it: `status: 'active'` neither enabled nor advertised a connector, and "
  + "`'error'` or `'configuring'` changed nothing either. Delete the key; the "
  + '`ConnectorStatus` enum leaves with it. On a declarative entry, `enabled: false` is what '
  + 'withdraws a materialized instance or marks a catalog-only descriptor, and whether a '
  + 'registered connector can be dispatched is computed by the runtime and reported as `state` '
  + '(`ready` or `degraded`) on `GET /api/v1/automation/connectors` — no authored value sets it. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

/**
 * The prescription an author meets when they write `webhooks` on a connector —
 * in `tsc` and at parse.
 */
const WEBHOOKS_RETIRED =
  '`connector.webhooks` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
  + 'a webhook nested inside a connector was never registered as a `webhook` item, so it was '
  + 'never materialized into `sys_webhook` and never delivered, and nothing emits the connector '
  + 'events its `events` list could name (`sync.completed`, `auth.expired` and the rest). Delete '
  + 'the key; the nested shape leaves with it (`WebhookConfig`, `WebhookEvent`, '
  + '`WebhookSignatureAlgorithm`). To have a webhook actually sent, declare it in the stack\'s '
  + 'top-level `webhooks:` collection, which is materialized into `sys_webhook` and delivered on '
  + 'record events — note that doing so STARTS deliveries this connector never made. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

// ============================================================================
// REMOVED: `triggers` (ADR-0049)
// ============================================================================
//
// `connector.triggers` — the `ConnectorTrigger` shape (`key`, `label`,
// `description`, `type: 'polling' | 'webhook'`, `intervalSeconds`) — declared a
// connector-owned way to start an automation, and NOTHING ever read it. Its own
// docblock said so ("NOT YET ENFORCED — declared but never read by the
// runtime"). Measured on `origin/main` before the removal:
// `AutomationEngine.registerConnector` walks `parsed.actions` only and stores the
// rest of the def unread; the engine's trigger registry holds FLOW trigger kinds
// (`record_change`, `time_relative`, `schedule`, `api` — a closed set) and no
// connector trigger ever entered it; no polling loop read `intervalSeconds`; no
// receiver was driven by a `webhook` trigger; and no connector package, provider
// or example declared one. The only runtime touch was a REFUSAL on a
// provider-bound declarative instance, whose reason ("the provider derives them
// from the upstream at boot") was itself untrue — no provider derives a trigger.
//
// Retired rather than built, by ruling on the maintainer's criterion for a
// declared-but-unenforced family: the accepted ADR-0041 places connector-event
// triggers (webhook-subscribe and poll) in its third tier, as their own trigger
// package, promoted only when real projects ask for it. When that happens the
// family returns in the mainstream shape — a subscribe / unsubscribe lifecycle,
// signature verification, a dedupe cursor — which these five keys could not
// carry. What works today, and what the prescription below names, is a FLOW that
// calls the connector's action: an external event starts an `api` flow, and a
// scheduled pull is a `schedule` flow.
//
// `ConnectorSchema` is NOT `.strict()`, so a plain delete would be a silent strip
// (ADR-0104): `triggers` is a `retiredKey()` tombstone below, inherited by
// `DeclarativeConnectorEntrySchema` because both published carriers wrap the same
// private `ConnectorBaseSchema`. That made the provider-bound refusal unreachable
// (every carrier now refuses the key outright, with the prescription), so the
// rule and its untrue reason left with it. `integration/ConnectorTrigger` leaves
// whole (`RETIRED_DEFS_BY_MAJOR[18]`), because an exported value schema with no
// consumer reads as a capability. Registered as `integration/Connector:triggers`
// and `integration/DeclarativeConnectorEntry:triggers` in
// `RETIRED_KEYS_BY_MAJOR[18]`; authored sources and stored rows are rewritten by
// the D2 conversion `connector-triggers-removed`, and the family's judgement
// lives in the D3 entry `connector-triggers-retired`.
//
// `triggers[].interval` → `intervalSeconds` was renamed earlier in this same
// unreleased protocol step; that rename is ABSORBED by this removal
// (`spec-property-retirement` §0), as its breaker half was by the `health`
// removal above: a key renamed and then stripped with its whole array is
// unobservable, and the conversion table's disjoint-fixture contract cannot hold
// both. The `integration/ConnectorTrigger:interval` registration stays — it is
// still the record that the bare `interval` spelling was retired.

/**
 * The prescription an author meets when they write `triggers` on a connector —
 * in `tsc` (the key's input type is `never`) and at parse (this string is the
 * issue message). It serves the author who still holds the pre-rename
 * `interval` spelling too; the closing sentence is the house `os migrate meta`
 * form pinned by `shared/retired-key-migrate-sentence.test.ts`.
 */
const TRIGGERS_RETIRED =
  '`connector.triggers` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
  + 'a connector trigger never started anything: `AutomationEngine.registerConnector` registers '
  + 'a connector\'s actions only, no polling loop read `intervalSeconds` (or the `interval` '
  + 'spelling it was renamed from), and no receiver was driven by a `webhook` trigger. Delete '
  + 'the key; the `ConnectorTrigger` shape leaves with it. To start work from an external '
  + 'system, write a flow that calls the connector\'s action in a `connector_action` node: for '
  + 'an external event, an `api` flow that the event\'s sender calls; for a scheduled pull, a '
  + '`schedule` flow. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

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

// `ConnectorStatusSchema` / `ConnectorStatus` (`active` / `inactive` / `error` /
// `configuring`) used to be declared here. It left whole with the `status` key
// it was the only carrier of — see "REMOVED: `health`, `status` and the nested
// `webhooks`" above; the runtime's dispatchability answer is the computed
// `ConnectorState` (`ready` / `degraded`) in `connector-descriptor.ts`.

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
 * reports `selected` / `acted`, and a broken sweep is FIRST FILTERED by
 * `selected > 0 AND acted = 0 AND unmeasured = 0` — a filter, not a verdict
 * (#12685: a healthy idempotent sweep matches it on every run too, and what
 * discriminates is the per-node fold in `FlowRunSummary.nodes[]` / `gates[]`).
 * The two guesses are wrong in a costly direction even so: a blanket `acted: 0`
 * puts every healthy connector sweep into that candidate set until operators
 * learn to ignore it, and a blanket `acted: 1` makes a read-only sweep look
 * busy forever so it never becomes a candidate at all. `http` gets to skip this
 * question because the HTTP method answers it
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

// `ConnectorTriggerSchema` / `ConnectorTrigger` (`key`, `label`, `description`,
// `type: 'polling' | 'webhook'`, `intervalSeconds`, and the `interval` tombstone
// of its unit rename) used to be declared here. It left whole with the
// `triggers` key it was the only carrier of — see "REMOVED: `triggers`" above.

/**
 * Base Connector Schema
 * Core connector configuration shared across all connector types
 */
const ConnectorBaseSchema = lazySchema(() => z.object({
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
   * to `{ type: 'none' }` so a declarative entry can reference credentials
   * through {@link auth}/`credentialRef` instead of inlining them here
   * (ADR-0097). Hand-written / plugin connectors keep setting it at
   * `registerConnector` as before — but the AUTHORING door refuses any
   * non-`none` value: since #7990 `DeclarativeConnectorEntrySchema` (the shape
   * behind `defineStack({ connectors })` and `PUT /meta/connector/:name`)
   * rejects an inline credential on every entry, descriptor or instance,
   * because a published row lands whole in `sys_metadata`.
   */
  authentication: ConnectorAuthConfigSchema.optional().default({ type: 'none' }).describe(
    'Authentication configuration (runtime shape with inline secrets — plugin-supplied at registerConnector). Authored entries must not inline secrets: use `auth.credentialRef` on a provider-bound instance.',
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

  /**
   * `triggers` — RETIRED (ADR-0049 enforce-or-remove). A connector trigger never
   * started anything: `registerConnector` registers actions only, no polling
   * loop or receiver was driven by one, and no provider derives one. What starts
   * work from an external system is a flow calling the connector's action — an
   * `api` flow for an external event, a `schedule` flow for a scheduled pull.
   * `ConnectorSchema` is NOT `.strict()`, so a plain delete would be a silent
   * strip (ADR-0104); the tombstone makes the removal audible in `tsc` and at
   * parse. See "REMOVED: `triggers`" above.
   */
  triggers: retiredKey(TRIGGERS_RETIRED),
  
  /**
   * Data synchronization configuration
   */
  syncConfig: DataSyncConfigSchema.optional().describe('Data sync configuration'),
  
  
  /**
   * Field mappings
   */
  fieldMappings: z.array(ConnectorFieldMappingSchema).optional().describe('Field mapping rules'),
  
  /**
   * `webhooks` — RETIRED (ADR-0049 enforce-or-remove). A webhook nested in a
   * connector was never registered as a `webhook` item, so it was never
   * materialized into `sys_webhook` and never delivered; the delivered surface
   * is the stack's top-level `webhooks:` collection. `ConnectorSchema` is NOT
   * `.strict()`, so a plain delete would be a silent strip (ADR-0104); the
   * tombstone makes the removal audible in `tsc` and at parse. See "REMOVED:
   * `health`, `status` and the nested `webhooks`" above.
   */
  webhooks: retiredKey(WEBHOOKS_RETIRED),
  
  /**
   * REMOVED (#4911) — outbound rate limiting. See the block above
   * "REMOVED: outbound rate limiting" for why the whole shape went, not just
   * this key. `ConnectorSchema` is NOT `.strict()`, so a plain delete would be
   * a silent strip (ADR-0104); the tombstone makes the removal audible in the
   * two channels an upgrading author actually hits — `tsc` and the parse.
   */
  rateLimitConfig: retiredKey(
    '`connector.rateLimitConfig` was removed in @objectstack/spec 17.0.0 (ADR-0049 D2) — ' +
    'the entire shape is gone, not just this key: `ConnectorRateLimitConfig` and its ' +
    '`RateLimitStrategy` enum were removed with it, because no outbound rate-limiting engine ' +
    'ever existed. The platform\'s only token bucket (runtime `security/rate-limit.ts`) throttles ' +
    'INBOUND requests to us; nothing throttled the calls a connector makes out, so every knob ' +
    'here was inert while reading like a configured cap. Delete the key. Do NOT substitute ' +
    '`shared` `RateLimitConfig` — that is the inbound limiter and would cap the wrong direction; ' +
    'until an outbound throttle exists, rate-limit at the connector provider or upstream gateway. ' +
    'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  ),

  /**
   * Retry configuration
   */
  retryConfig: RetryConfigSchema.optional().describe('Retry configuration'),
  
  /**
   * `connectionTimeoutMs` — RETIRED (ADR-0049 enforce-or-remove). A bounded,
   * defaulted, served-back key that no site ever applied as a deadline, and one
   * that is not implementable where it was declared: a WHATWG `fetch` exposes a
   * single `AbortSignal` over the whole operation and never the connect phase.
   * `requestTimeoutMs` below is the bound the platform can keep. The section
   * comment above `CONNECTION_TIMEOUT_MS_RETIRED` records the measurement,
   * including the five reader sites #18975 created and what this withdraws.
   */
  connectionTimeoutMs: retiredKey(CONNECTION_TIMEOUT_MS_RETIRED),

  /**
   * Request timeout in milliseconds
   */
  requestTimeoutMs: z.number().min(1000).max(300000).optional().default(30000).describe('Request timeout in ms'),
  
  /**
   * `status` — RETIRED (ADR-0049 enforce-or-remove). Declared with a
   * `.default('inactive')` and read by nothing: the runtime's dispatchability
   * answer is the COMPUTED `state` (`ready` / `degraded`) that
   * `GET /api/v1/automation/connectors` publishes, and participation is
   * `enabled` below. Tombstoned rather than deleted (non-strict schema,
   * ADR-0104); its emitted default `'inactive'` is accepted and stripped as
   * inert residue by {@link CONNECTOR_RETIRED_KEY_RESIDUE}, every other value
   * meets the prescription.
   */
  status: retiredKey(STATUS_RETIRED),
  
  /**
   * Enable connector. On a declarative `connectors:` stack entry, `false`
   * additionally marks a deliberate catalog-only descriptor — it suppresses
   * the boot audit warning for declared-but-unregistered connectors (#2612).
   */
  enabled: z.boolean().optional().default(true).describe(
    'Enable connector. On declarative stack entries, false marks a deliberate catalog-only descriptor.',
  ),
  
  /**
   * `errorMapping` — RETIRED (ADR-0049 enforce-or-remove). Eleven authorable
   * keys (`ErrorMappingConfig` x4, `ErrorMappingRule` x7) that nothing in the
   * tree ever read, one of them spelled `userMessage` — the name of the LIVE
   * API-error channel — so writing a rule here validated, published and showed
   * nobody anything. `ConnectorSchema` is NOT `.strict()`, so a plain delete
   * would be a silent strip (ADR-0104); the tombstone makes the removal audible
   * in the two channels an upgrading author actually hits — `tsc` and the
   * parse — and `DeclarativeConnectorEntrySchema` carries it too (both
   * published carriers wrap the same private `ConnectorBaseSchema`; until the
   * `connectionTimeoutMs` retirement the entry schema was literally
   * `ConnectorSchema.superRefine(...)`), so `stack.connectors[]` and the
   * `/meta/connector` door refuse
   * it too. Registered as `integration/Connector:errorMapping` and
   * `integration/DeclarativeConnectorEntry:errorMapping` in
   * `RETIRED_KEYS_BY_MAJOR[18]`; sources are rewritten by the D2 conversion
   * `connector-error-mapping-removed`. The section comment above
   * `ERROR_MAPPING_RETIRED` records what the shape was.
   */
  errorMapping: retiredKey(ERROR_MAPPING_RETIRED),
  
  /**
   * `health` — RETIRED (ADR-0049 enforce-or-remove). The `healthCheck` probe
   * and the `circuitBreaker` blocks (fourteen keys) had no engine: nothing
   * polled, counted or tripped. Tombstoned rather than deleted (non-strict
   * schema, ADR-0104); the three shapes behind it left whole. See "REMOVED:
   * `health`, `status` and the nested `webhooks`" above.
   */
  health: retiredKey(HEALTH_RETIRED),
  
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

/**
 * Core connector configuration — the authorable shape behind the ruled
 * retired-default residue stage (see {@link CONNECTOR_RETIRED_KEY_RESIDUE}).
 *
 * The wrapper is a `z.preprocess` PIPE, not a `ZodObject`: it keeps a
 * read-through `shape` so the schema walkers and shape-reading consumers see
 * the inner authorable truth, but the `ZodObject` combinators do NOT survive
 * it. Measured on the built entry against a plain-object control
 * (`RetryConfigSchema`, which keeps all nine — the control was
 * `WebhookConfigSchema` until that shape was retired with the nested
 * `webhooks`): `.extend()`, `.omit()`, `.pick()`, `.partial()`, `.merge()`,
 * `.strict()`, `.keyof()` and `.safeExtend()` are gone.
 *
 * ⚠️ `.superRefine()` is the exception and the trap — it lives on zod's base
 * type, so it is still CALLABLE here and silently returns a schema with no
 * read-through `shape`, which is precisely what the authorable-surface and
 * liveness walkers duck-test. So: build on `ConnectorBaseSchema` and re-wrap,
 * the way `DeclarativeConnectorEntrySchema` below does (the
 * `EffectiveObjectPermissionSchema` precedent).
 */
export const ConnectorSchema = lazySchema(() =>
  acceptRetiredDefaultResidue(ConnectorBaseSchema, CONNECTOR_RETIRED_KEY_RESIDUE),
);

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
 * this.
 *
 * ⚠️ This used to end "the base {@link ConnectorSchema} stays a plain object so
 * connector *subtypes* (github / database / …) can still `.extend()` it". That
 * is NO LONGER TRUE and the sentence is corrected rather than deleted, because
 * it was quoted verbatim downstream: both published exports are now
 * `z.preprocess` PIPES (the ADR-0049 retired-default residue stage), and a pipe
 * is not a `ZodObject`. Measured on the built entry, against a plain-object
 * control (`RetryConfigSchema`; `WebhookConfigSchema` until its retirement)
 * that keeps all nine: `.extend()`, `.omit()`,
 * `.pick()`, `.partial()`, `.merge()`, `.strict()`, `.keyof()` and
 * `.safeExtend()` are all gone from `ConnectorSchema` and from this schema.
 * `.superRefine()` is the one that survives — it lives on zod's base type — but
 * ⛔ calling it on a pipe returns a schema with NO read-through `shape`, which
 * is what the authorable-surface and liveness walkers duck-test, so a
 * refinement still belongs on the inner object.
 *
 * **Subtype route:** extend `ConnectorBaseSchema` and re-wrap the result with
 * `acceptRetiredDefaultResidue(…, CONNECTOR_RETIRED_KEY_RESIDUE)` — exactly
 * what this schema does below, and the `EffectiveObjectPermissionSchema`
 * precedent.
 *
 * One rule applies to EVERY authored entry (#7990, maintainer-ruled 2026-08-12):
 *  - NO entry may inline secrets via `authentication`. A published connector
 *    row lands whole in `sys_metadata` (`apiMethods: ['get','list']`), so an
 *    inline `token`/`key`/`password`/`clientSecret` is cleartext at rest,
 *    readable through the ordinary data API. Until #7990 this rule bound only
 *    provider-bound instances (ADR-0097 §3) and a catalog DESCRIPTOR could
 *    still publish an inline credential — the ①-d hole of the #7902 survey.
 *
 * The remaining rules key off `provider` — instance vs. catalog descriptor:
 *  - `providerConfig` / `auth` require a `provider`; on a pure descriptor they
 *    are meaningless materialization inputs, so they are rejected.
 *  - A provider-bound instance must NOT author `actions` — the provider derives
 *    them from the upstream (OpenAPI document / MCP `tools/list`); authoring both
 *    the instance and its actions reintroduces drift (§5 non-goals).
 *
 * `triggers` used to be the second key of that last rule, refused with the
 * reason that the provider derives triggers too. That reason was untrue — no
 * provider ever derived a trigger — and the rule is gone rather than corrected:
 * `triggers` is now a `retiredKey()` tombstone on the shared base, so every
 * carrier — descriptor and instance alike — refuses any value with the
 * retirement prescription, and a provider-bound refusal could only ever repeat
 * that verdict with a wrong reason (see "REMOVED: `triggers`" above).
 */
export const DeclarativeConnectorEntrySchema = lazySchema(() =>
  // [#12840 precedent] The ADR-0097 refusals ride on the BASE, INSIDE the
  // residue stage, for the reason `ObjectPermissionSchema` records: in zod 4
  // `.superRefine()` on a `ZodObject` returns a `ZodObject` that keeps
  // `.shape`, while the same call on the residue PIPE returns a schema with no
  // `.shape` — and the pipe's read-through `shape` is exactly what the
  // authorable-surface / liveness walkers duck-test. Wrapping second also keeps
  // this door's residue tolerance identical to the base's rather than a second
  // dialect.
  acceptRetiredDefaultResidue(ConnectorBaseSchema.superRefine((entry, ctx) => {
    const isInstance = typeof entry.provider === 'string' && entry.provider.length > 0;
    // #7990 — the one rule that binds EVERY authored entry, descriptor and
    // instance alike: `authentication` is the RUNTIME shape (its secret fields
    // are required and inline), so any non-`none` value published through this
    // door puts a cleartext credential into `sys_metadata`. The two messages
    // differ because the fixes differ; both name the mechanism to use instead.
    if (entry.authentication && entry.authentication.type !== 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['authentication'],
        message: isInstance
          ? `Provider-bound connector instance '${entry.name}' must not inline secrets via \`authentication\`; reference credentials with \`auth: { type, credentialRef }\` instead (ADR-0097 §3).`
          : `Connector '${entry.name}' must not inline secrets via \`authentication\` — a published connector row is stored whole in \`sys_metadata\`, so the credential would land in cleartext. A catalog descriptor holds no live credentials: drop \`authentication\` (or set \`{ type: 'none' }\`) and describe the auth scheme in \`description\`. A dispatchable instance declares \`provider\` and references its credential with \`auth: { type, credentialRef }\` (ADR-0097 §3).`,
      });
    }
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
    if (entry.actions && entry.actions.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: `Provider-bound connector instance '${entry.name}' must not author \`actions\` — the '${entry.provider}' provider derives them from the upstream at boot (ADR-0097 §5).`,
      });
    }
  }), CONNECTOR_RETIRED_KEY_RESIDUE),
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
