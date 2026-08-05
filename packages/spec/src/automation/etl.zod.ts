// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';
import { retiredKey } from '../shared/retired-key';
import { retryPolicyShape } from '../shared/retry-policy.zod';
import { strictObject } from '../shared/strict-object';

/**
 * ETL (Extract, Transform, Load) Pipeline Protocol - LEVEL 2: Data Engineering
 * 
 * Inspired by modern data integration platforms like Airbyte, Fivetran, and Apache NiFi.
 * 
 * **Positioning in the sync/integration layering** (L1 "Simple Sync" was
 * retired in #4738 — narrative-only, zero consumers; see
 * `packages/spec/docs/SYNC_ARCHITECTURE.md`):
 * - **ETL Pipeline** (THIS FILE) - Data engineers - Aggregate 10 sources to warehouse
 * - **Enterprise Connector** (integration/connector.zod.ts) - System integrators - Full SAP integration; connector-attached sync via `syncConfig`
 * 
 * ETL pipelines enable automated data synchronization between systems, transforming
 * data as it moves from source to destination.
 * 
 * **SCOPE: Advanced multi-source, multi-stage transformations.**
 * Supports complex operations: joins, aggregations, filtering, custom SQL.
 * 
 * ## When to Use This Layer
 * 
 * **Use ETL Pipeline when:**
 * - Combining data from multiple sources
 * - Need aggregations, joins, transformations
 * - Building data warehouses or analytics platforms
 * - Complex data transformations required
 * 
 * **Examples:**
 * - Sales data from Salesforce + Marketing from HubSpot → Data Warehouse
 * - Multi-region databases → Consolidated reporting
 * - Legacy system migration with transformation
 * 
 * **When to upgrade:**
 * - Need full connector lifecycle (auth, webhooks, rate limits) → Use {@link file://../integration/connector.zod.ts | Enterprise Connector}
 *
 * @see {@link file://../integration/connector.zod.ts} for the Enterprise Connector layer
 * 
 * ## Use Cases
 * 
 * 1. **Data Warehouse Population**
 *    - Extract from multiple operational systems
 *    - Transform to analytical schema
 *    - Load into data warehouse
 * 
 * 2. **System Integration**
 *    - Sync data between CRM and Marketing Automation
 *    - Keep product catalog synchronized across e-commerce platforms
 *    - Replicate data for backup/disaster recovery
 * 
 * 3. **Data Migration**
 *    - Move data from legacy systems to modern platforms
 *    - Consolidate data from multiple sources
 *    - Split monolithic databases into microservices
 * 
 * @see https://airbyte.com/
 * @see https://docs.fivetran.com/
 * @see https://nifi.apache.org/
 * 
 * @example
 * ```typescript
 * const salesforceToDB: ETLPipeline = {
 *   name: 'salesforce_to_postgres',
 *   label: 'Salesforce Accounts to PostgreSQL',
 *   source: {
 *     type: 'api',
 *     connector: 'salesforce',
 *     config: { object: 'Account' }
 *   },
 *   destination: {
 *     type: 'database',
 *     connector: 'postgres',
 *     config: { table: 'accounts' }
 *   },
 *   transformations: [
 *     { type: 'map', config: { 'Name': 'account_name' } }
 *   ],
 *   schedule: '0 2 * * *' // Daily at 2 AM
 * }
 * ```
 */

/**
 * ETL Source/Destination Type
 */
import { lazySchema } from '../shared/lazy-schema';
export const ETLEndpointTypeSchema = lazySchema(() => z.enum([
  'database',    // SQL/NoSQL databases
  'api',         // REST/GraphQL APIs
  'file',        // CSV, JSON, XML, Excel files
  'stream',      // Kafka, RabbitMQ, Kinesis
  'object',      // ObjectStack object
  'warehouse',   // Data warehouse (Snowflake, BigQuery, Redshift)
  'storage',     // S3, Azure Blob, Google Cloud Storage
  'spreadsheet', // Google Sheets, Excel Online
]));

// ─── `X` / `XParsed` — which shape the bare name means (#4963) ────────
//
// House convention, stated once here because this file exports nine pairs of
// it: the **bare name is what an author writes** (`z.input` — defaults
// unapplied, every defaulted key optional), and `XParsed` is **what a parse
// returns** (`z.infer` — defaults applied, those same keys present). The
// clearest write-up is on `shared/retry-policy.zod.ts`; the sibling automation
// configs (`flow.zod.ts`, `io-node-config.zod.ts`,
// `builtin-node-config.zod.ts`, `control-flow.zod.ts`) all export the pair.
//
// Until 17 all nine aliases here were `z.infer` under the bare name with no
// `*Parsed` counterpart at all, and on this file that was not a style detail.
// Five named keys across four shapes carry `.default()` —
// `ETLDestination.writeMode`, `ETLTransformation.continueOnError`,
// `ETLPipeline.syncMode` / `.enabled`, `ETLSource.incremental.enabled` — plus
// all five of `ETLPipeline.retry`'s (via `retryPolicyShape()`) and all four of
// `ETLPipelineRun.stats`'. And `schedule` is a `CronExpressionInputSchema`
// transform whose *output* is the `{ dialect, source }` envelope. Under
// `z.infer` every one of them was REQUIRED and a bare-string cron was
// rejected, so the one use this file actually has —
// `const p: ETLPipeline = { … }`, hand-written, which is the whole authoring
// door given there is no parse site in objectstack / objectui / cloud — did not
// compile. `packages/spec/docs/SYNC_ARCHITECTURE.md` carried three examples
// that proved it, and both ETL factories below were forced to spell defaults
// out and pre-wrap their cron just to satisfy their own return type.
//
// Flipping the bare names is breaking and was done in one step (#4963): the
// three-repo importer count was zero, so the migration surface is empty. A
// consumer that reads a PARSE RESULT — `const p = ETLPipelineSchema.parse(raw)`
// annotated by hand — renames its annotation to `ETLPipelineParsed`.
//
// The four enum aliases (`ETLEndpointType`, `ETLTransformationType`,
// `ETLSyncMode`, `ETLRunStatus`) get the pair too, even though `z.input` and
// `z.infer` are the same type for an enum. That is deliberate, not
// cargo-culting: the convention's value is that a reader never has to know
// WHICH of the nine has defaults before choosing an annotation, and a pair that
// exists today keeps costing nothing while an enum that later gains a
// `.transform()` or `.catch()` would otherwise reopen exactly this issue.

export type ETLEndpointType = z.input<typeof ETLEndpointTypeSchema>;
/** @see {@link ETLEndpointType} — the enum has no transform, so this is the same type. */
export type ETLEndpointTypeParsed = z.infer<typeof ETLEndpointTypeSchema>;

// ─── Unknown-key strictness (#4001 批 12, ADR-0078) ───────────────────
//
// The seven AUTHORING shapes in this file are closed against undeclared keys;
// the three `ETLPipelineRun` shapes at the bottom stay tolerant. The split, and
// how it was verified rather than assumed, is recorded on `ETLPipelineRunSchema`
// — read it before closing anything else here.
//
// One thing to know about this file before reading the tables: `etl.zod.ts` has
// **no parse site anywhere** in objectstack / objectui / cloud. That does not
// make it unauthored — it makes the exported schema and the exported type the
// whole authoring door (`const p: ETLPipeline = { … }`, as
// `packages/spec/docs/SYNC_ARCHITECTURE.md` and this module's own `@example`
// write it), the same posture the ledger already carries for `webhook.zod.ts`.
// It does mean the curation below could not be measured from stored payloads
// the way 批 9's was, because there are none. So every alias and guidance entry
// here is instead anchored to a **sibling contract that exists in this repo**
// and spells the same intent differently — each one names its anchor. Nothing
// is written from imagination: the campaign's finding 7 is that a confidently
// wrong prescription costs more than no prescription at all.

/**
 * The shared second half of the endpoint/transformation histories: where a
 * misplaced setting actually goes.
 *
 * `source`, `destination` and each `transformation` all pair a small closed key
 * set with an open `config: z.record(…)` bag, and that pairing is what makes an
 * unknown key on these three a **misplacement** far more often than a typo.
 * `table`, `schema`, `endpoint`, `path`, `format`, `condition`, `groupBy` are
 * all real, load-bearing settings — one nesting level down. `.strip` deleted
 * them where they stood, so the pipeline parsed clean and then ran against a
 * `config` missing exactly the setting the author had written.
 *
 * The pointer lives in `history` — appended to *every* unknown-key message on
 * these surfaces — rather than in a per-key `guidance` table, because the
 * misplaced key is drawn from the open bag's unbounded vocabulary. Enumerating
 * it would be guesswork; naming the destination is not.
 */
const ETL_CONFIG_SLOT_POINTER =
  'If the key is a real setting (`table`, `schema`, `endpoint`, `path`, `format`, `condition`, `groupBy`, …) '
  + 'it belongs one level down, inside the open `config` record — that bag is deliberately unconstrained and '
  + 'is the only place this schema reads endpoint-specific settings from.';

const ETL_SOURCE_HISTORY =
  'Until #4001 an undeclared key on an ETL source was dropped silently — the pipeline parsed clean and '
  + 'extracted with the key ignored. ' + ETL_CONFIG_SLOT_POINTER;

const ETL_INCREMENTAL_HISTORY =
  'Until #4001 an undeclared key here was dropped silently, and an incremental source whose cursor never '
  + 'took effect re-extracts the whole table (or nothing) on every run while still reporting success.';

/**
 * Anchor: `DataSyncConfig` in `integration/connector.zod.ts` — the LIVE sibling
 * (it is on the `ConnectorSchema.syncConfig` parse path) — calls this same thing
 * `timestampField`, "Field to track last modification time". Identical intent,
 * different word, and far outside the edit-distance window, which is exactly
 * the category `aliases` exists for.
 */
const ETL_INCREMENTAL_ALIASES: Readonly<Record<string, string>> = {
  timestampField: 'cursorField',
};

const ETL_DESTINATION_HISTORY =
  'Until #4001 an undeclared key on an ETL destination was dropped silently — the pipeline parsed clean and '
  + 'loaded with the key ignored. ' + ETL_CONFIG_SLOT_POINTER;

/**
 * Anchor: connector `syncConfig.strategy` (`SyncStrategySchema`,
 * `integration/connector.zod.ts`) is ONE enum — `full | incremental | upsert |
 * append_only` — whose four values split across TWO keys on this file: the
 * write half (`upsert` / `append_only`) is the destination's `writeMode`, the
 * extraction half (`full` / `incremental`) is the pipeline's `syncMode`.
 *
 * So the same borrowed word resolves to a different canonical key depending on
 * which surface it was written on, and each surface names only its own half.
 * Getting that right is the whole value of a hand-written alias here — a
 * single global "strategy → syncMode" would send a destination author to the
 * wrong key with full confidence.
 */
const ETL_DESTINATION_ALIASES: Readonly<Record<string, string>> = {
  strategy: 'writeMode',
};

const ETL_TRANSFORMATION_HISTORY =
  'Until #4001 an undeclared key on an ETL transformation was dropped silently — the step ran with the key '
  + 'ignored and the pipeline reported success. ' + ETL_CONFIG_SLOT_POINTER;

const ETL_PIPELINE_HISTORY =
  'Until #4001 an undeclared key on an ETL pipeline was dropped silently — the pipeline parsed clean and '
  + 'ran, minus whatever the key was meant to configure.';

/** See {@link ETL_DESTINATION_ALIASES} — this is that enum's extraction half. */
const ETL_PIPELINE_ALIASES: Readonly<Record<string, string>> = {
  strategy: 'syncMode',
};

/**
 * Anchor: `DataSyncConfig.direction` (`import | export | bidirectional`) is a
 * declared key on the connector layer and a **documented absence** here — which
 * makes it the likeliest wrong key for anyone arriving from that layer, exactly
 * the shape 批 9 recorded for `outputVariable` on `update_record`.
 */
const ETL_PIPELINE_GUIDANCE: Readonly<Record<string, string>> = {
  direction:
    'An ETL pipeline has no `direction` key, by design: direction is stated STRUCTURALLY, by which endpoint '
    + 'is `source` and which is `destination`. `direction` (import/export/bidirectional) is the CONNECTOR '
    + "layer's spelling (`ConnectorSchema.syncConfig`); to reverse an ETL pipeline, swap the two endpoints.",
};

const ETL_RETRY_HISTORY =
  'Until #4001 an undeclared key here was dropped silently and the block fell back to its defaults '
  + '(3 attempts, 60s) while reporting the authored policy as accepted. Until #4962 this block was a '
  + 'SEPARATE retry vocabulary — it spelled the count `maxAttempts`, defaulted it to 3, and declared no '
  + 'backoff multiplier, ceiling or jitter; it now carries the converged `RetryPolicySchema` contract.';

/**
 * Anchor: `RetryPolicySchema` (`shared/retry-policy.zod.ts`) — the retry policy
 * #4661 converged onto ONE declaration for `job.retryPolicy` and a `try_catch`
 * node's `retry` region. This block was a **third** encoding of the same
 * concept that the convergence did not reach, because it is an anonymous
 * inline object with no exported name and so never appeared in the #4411 /
 * #4535 dual-source scan that drove that work. (`Flow.errorHandling` was the
 * fourth — #4964, same construction, same blind spot.)
 *
 * 批 12 could only make the divergence *audible*: it closed the shape and spent
 * five curated entries stating the diff between the two vocabularies where an
 * author hits it. #4962 removed the diff instead, so all five entries are gone
 * — four of them (`retryDelayMs` plus the "documented absence" of
 * `backoffMultiplier` / `maxRetryDelayMs` / `jitter`) because those keys are
 * now DECLARED here, and the fifth (`maxRetries` → `maxAttempts`) because it
 * pointed the wrong way: `maxRetries` is the canonical spelling and
 * `maxAttempts` is the tombstone.
 *
 * What survives is anchored the same way 批 12's entries were — to sibling
 * contracts that exist in this repo and spell the same knob differently:
 * `integration/connector.zod.ts`'s `RetryConfig` (`initialDelayMs`,
 * `maxDelayMs`), and the plain-English count forms. This is deliberately the
 * SAME table `Flow.errorHandling` carries, because after the convergence the
 * two surfaces are the same contract and an author should not learn two
 * different lessons from them.
 */
const ETL_RETRY_ALIASES: Readonly<Record<string, string>> = {
  initialDelayMs: 'backoffMs',
  maxDelayMs: 'maxRetryDelayMs',
  retries: 'maxRetries',
  attempts: 'maxRetries',
};

const ETL_NOTIFICATIONS_HISTORY =
  'Until #4001 an undeclared key here was dropped silently — nobody was notified and the run still reported '
  + 'success, which is the one outcome this block exists to prevent.';

/**
 * Anchor: three in-repo surfaces spell the failure hook `onError`
 * (`ui/widget.zod.ts`, `data/hook.zod.ts`'s declared key list,
 * `kernel/plugin-loading.zod.ts`). This block spells it `onFailure`, and the
 * two are six edits apart — unreachable by the distance fallback.
 */
const ETL_NOTIFICATIONS_ALIASES: Readonly<Record<string, string>> = {
  onError: 'onFailure',
};

/**
 * ETL Source Configuration
 */
export const ETLSourceSchema = lazySchema(() => strictObject({
  surface: 'this ETL source',
  history: ETL_SOURCE_HISTORY,
}, {
  /**
   * Source type
   */
  type: ETLEndpointTypeSchema.describe('Source type'),

  /**
   * Connector identifier
   * References a registered connector
   * 
   * @example "salesforce", "postgres", "mysql", "s3"
   */
  connector: z.string().optional().describe('Connector ID'),

  /**
   * Source-specific configuration
   * Structure varies by source type
   * 
   * @example For database: { table: 'customers', schema: 'public' }
   * @example For API: { endpoint: '/api/users', method: 'GET' }
   * @example For file: { path: 's3://bucket/data.csv', format: 'csv' }
   */
  config: z.record(z.string(), z.unknown()).describe('Source configuration'),

  /**
   * Incremental sync configuration
   * Allows extracting only changed data
   */
  incremental: strictObject({
    surface: 'this ETL incremental extraction config',
    history: ETL_INCREMENTAL_HISTORY,
    aliases: ETL_INCREMENTAL_ALIASES,
  }, {
    enabled: z.boolean().default(false),
    cursorField: z.string().describe('Field to track progress (e.g., updated_at)'),
    cursorValue: z.unknown().optional().describe('Last processed value'),
  }).optional().describe('Incremental extraction config'),
}));

/** What an author writes — `incremental.enabled` optional. */
export type ETLSource = z.input<typeof ETLSourceSchema>;
/** The post-parse shape — `incremental.enabled` present. */
export type ETLSourceParsed = z.infer<typeof ETLSourceSchema>;

/**
 * ETL Destination Configuration
 */
export const ETLDestinationSchema = lazySchema(() => strictObject({
  surface: 'this ETL destination',
  history: ETL_DESTINATION_HISTORY,
  aliases: ETL_DESTINATION_ALIASES,
}, {
  /**
   * Destination type
   */
  type: ETLEndpointTypeSchema.describe('Destination type'),

  /**
   * Connector identifier
   */
  connector: z.string().optional().describe('Connector ID'),

  /**
   * Destination-specific configuration
   */
  config: z.record(z.string(), z.unknown()).describe('Destination configuration'),

  /**
   * Write mode
   */
  writeMode: z.enum([
    'append',      // Add new records
    'overwrite',   // Replace all data
    'upsert',      // Insert or update based on key
    'merge',       // Smart merge based on business rules
  ]).default('append').describe('How to write data'),

  /**
   * Primary key fields for upsert/merge
   */
  primaryKey: z.array(z.string()).optional().describe('Primary key fields'),
}));

/** What an author writes — `writeMode` optional (defaults to `append`). */
export type ETLDestination = z.input<typeof ETLDestinationSchema>;
/** The post-parse shape — `writeMode` present. */
export type ETLDestinationParsed = z.infer<typeof ETLDestinationSchema>;

/**
 * ETL Transformation Type
 */
export const ETLTransformationTypeSchema = lazySchema(() => z.enum([
  'map',         // Field mapping/renaming
  'filter',      // Row filtering
  'aggregate',   // Aggregation/grouping
  'join',        // Joining with other data
  'script',      // Custom JavaScript/Python script
  'lookup',      // Enrich with lookup data
  'split',       // Split one record into multiple
  'merge',       // Merge multiple records into one
  'normalize',   // Data normalization
  'deduplicate', // Remove duplicates
]));

export type ETLTransformationType = z.input<typeof ETLTransformationTypeSchema>;
/** @see {@link ETLTransformationType} — the enum has no transform, so this is the same type. */
export type ETLTransformationTypeParsed = z.infer<typeof ETLTransformationTypeSchema>;

/**
 * ETL Transformation Configuration
 */
export const ETLTransformationSchema = lazySchema(() => strictObject({
  surface: 'this ETL transformation',
  history: ETL_TRANSFORMATION_HISTORY,
  // No curated table. Every transformation-specific setting this file or
  // SYNC_ARCHITECTURE.md ever writes (`condition`, `groupBy`, `joinKey`,
  // `joinType`, `metrics`, `language`, `code`) lives inside the open `config`
  // bag, so the pointer in `history` already answers them as a class; and this
  // surface has no sibling contract spelling one of its four declared keys
  // differently, so there is nothing an alias could honestly claim. Same
  // reasoning as `HttpConfigSchema` in `io-node-config.zod.ts` (#4001 批 9).
}, {
  /**
   * Transformation name
   */
  name: z.string().optional().describe('Transformation name'),

  /**
   * Transformation type
   */
  type: ETLTransformationTypeSchema.describe('Transformation type'),

  /**
   * Transformation-specific configuration
   * 
   * @example For map: { oldField: 'newField' }
   * @example For filter: { condition: 'status == "active"' }
   * @example For script: { language: 'javascript', code: '...' }
   */
  config: z.record(z.string(), z.unknown()).describe('Transformation config'),

  /**
   * Whether to continue on error
   */
  continueOnError: z.boolean().default(false).describe('Continue on error'),
}));

/** What an author writes — `continueOnError` optional (defaults to `false`). */
export type ETLTransformation = z.input<typeof ETLTransformationSchema>;
/** The post-parse shape — `continueOnError` present. */
export type ETLTransformationParsed = z.infer<typeof ETLTransformationSchema>;

/**
 * ETL Sync Mode
 */
export const ETLSyncModeSchema = lazySchema(() => z.enum([
  'full',        // Full refresh - extract all data every time
  'incremental', // Only extract changed data
  'cdc',         // Change Data Capture - real-time streaming
]));

export type ETLSyncMode = z.input<typeof ETLSyncModeSchema>;
/** @see {@link ETLSyncMode} — the enum has no transform, so this is the same type. */
export type ETLSyncModeParsed = z.infer<typeof ETLSyncModeSchema>;

/**
 * ETL Pipeline Schema
 * 
 * Complete definition of a data pipeline from source to destination with transformations.
 */
export const ETLPipelineSchema = lazySchema(() => strictObject({
  surface: 'this ETL pipeline',
  history: ETL_PIPELINE_HISTORY,
  aliases: ETL_PIPELINE_ALIASES,
  guidance: ETL_PIPELINE_GUIDANCE,
}, {
  /**
   * Pipeline identifier (snake_case)
   */
  name: z.string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .describe('Pipeline identifier (snake_case)'),

  /**
   * Human-readable pipeline name
   */
  label: z.string().optional().describe('Pipeline display name'),

  /**
   * Pipeline description
   */
  description: z.string().optional().describe('Pipeline description'),

  /**
   * Data source configuration
   */
  source: ETLSourceSchema.describe('Data source'),

  /**
   * Data destination configuration
   */
  destination: ETLDestinationSchema.describe('Data destination'),

  /**
   * Transformation steps
   * Applied in order from source to destination
   */
  transformations: z.array(ETLTransformationSchema)
    .optional()
    .describe('Transformation pipeline'),

  /**
   * Sync mode
   */
  syncMode: ETLSyncModeSchema.default('full').describe('Sync mode'),

  /**
   * Execution schedule (cron expression)
   * 
   * @example "0 2 * * *" - Daily at 2 AM
   * @example "0 *\/4 * * *" - Every 4 hours
   * @example "0 0 * * 0" - Weekly on Sunday
   */
  schedule: CronExpressionInputSchema.optional().describe('Cron schedule expression'),

  /**
   * Whether pipeline is enabled
   */
  enabled: z.boolean().default(true).describe('Pipeline enabled status'),

  /**
   * Retry configuration for failed runs — the converged `RetryPolicySchema`
   * contract (#4962), shared with `job.retryPolicy`, a `try_catch` node's
   * `retry` and `flow.errorHandling`.
   *
   * Three things changed when this block stopped being its own vocabulary, and
   * all three are breaking (17.0.0):
   *
   *  1. `maxAttempts` → `maxRetries`. Pure rename, value preserved: both count
   *     the retries AFTER the initial attempt. (Do NOT carry the off-by-one
   *     that `integration/connector.zod.ts`'s `RetryConfig.maxAttempts` needs —
   *     that key INCLUDES the first attempt and is a different number. The
   *     tombstone below says so, because the same word means two things one
   *     directory apart.)
   *  2. The count now defaults to **0**, not 3. A pipeline that declared
   *     `retry: {}` used to buy three silent re-runs; it now buys none until
   *     the author states a count. An ETL destination is a foreign system by
   *     definition, so an implicit retry against a non-idempotent one is a
   *     duplicate write — a second invoice, a second export, a second webhook.
   *     That is the failure mode hardest to catch in tests and most expensive
   *     in production, and an unstated key is exactly where LLM-authored
   *     metadata hides it.
   *  3. `backoffMultiplier` / `maxRetryDelayMs` / `jitter` are now declarable.
   *     They were the documented absence 批 12 spent three guidance entries on:
   *     a nightly warehouse pipeline retrying every 60s, flat and unjittered,
   *     is the textbook thundering herd.
   *
   * The base delay's default follows the shared contract (1000ms, not this
   * block's old 60000ms). Nothing deployed moves: `etl.zod.ts` has no parse
   * site in objectstack / objectui / cloud and an ETL pipeline is not a
   * `defineStack` collection, so there is no stored pipeline for a default to
   * change under. State `backoffMs` explicitly if you want the old minute.
   */
  retry: strictObject({
    surface: "this ETL pipeline's retry configuration",
    history: ETL_RETRY_HISTORY,
    aliases: ETL_RETRY_ALIASES,
  }, {
    ...retryPolicyShape(),

    // ── Tombstone (ADR-0087) ──────────────────────────────────────────
    // The count's pre-17 ETL spelling. Tombstoned rather than deleted even
    // though this shape IS strict: an unknown-key rejection would carry the
    // key, and what an upgrading author needs is the RENAME plus the warning
    // that the identically-spelled connector key is a different number.
    maxAttempts: retiredKey(
      '`maxAttempts` was removed from an ETL pipeline\'s `retry` in @objectstack/spec 17.0.0 '
      + '(#4962) — the retry policy now has ONE vocabulary across `job.retryPolicy`, a '
      + '`try_catch` node\'s `retry`, `flow.errorHandling` and this block. Rename the key to '
      + '`maxRetries`; the NUMBER IS UNCHANGED, because this block\'s `maxAttempts` already '
      + 'counted the retries after the initial attempt. Do not subtract one — that adjustment '
      + 'belongs to `integration/connector.zod.ts`\'s `RetryConfig.maxAttempts`, which is a '
      + 'different key that INCLUDES the first attempt. Note the default also changed: an '
      + 'omitted count used to mean 3 retries and now means 0, so if you were relying on the '
      + 'old default, write `maxRetries: 3` explicitly.',
    ),
  }).optional().describe('Retry configuration'),

  /**
   * Notification configuration
   */
  notifications: strictObject({
    surface: "this ETL pipeline's notification settings",
    history: ETL_NOTIFICATIONS_HISTORY,
    aliases: ETL_NOTIFICATIONS_ALIASES,
  }, {
    onSuccess: z.array(z.string()).optional().describe('Email addresses for success notifications'),
    onFailure: z.array(z.string()).optional().describe('Email addresses for failure notifications'),
  }).optional().describe('Notification settings'),

  /**
   * Pipeline tags for organization
   */
  tags: z.array(z.string()).optional().describe('Pipeline tags'),

  /**
   * Custom metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom metadata'),
}));

/**
 * What an author writes — the annotation for a hand-written pipeline literal.
 *
 * `syncMode`, `enabled`, `destination.writeMode`, each transformation's
 * `continueOnError`, `source.incremental.enabled` and every key of `retry` are
 * optional here, and `schedule` accepts the bare cron string
 * (`'0 2 * * *'`) that `CronExpressionInputSchema` wraps at parse.
 */
export type ETLPipeline = z.input<typeof ETLPipelineSchema>;
/**
 * The post-parse shape — every defaulted key present and `schedule` normalized
 * to its `{ dialect: 'cron', source }` envelope. Annotate the RESULT of
 * `ETLPipelineSchema.parse(…)` with this, never the literal you pass in.
 */
export type ETLPipelineParsed = z.infer<typeof ETLPipelineSchema>;

/**
 * ETL Run Status
 */
export const ETLRunStatusSchema = lazySchema(() => z.enum([
  'pending',    // Queued for execution
  'running',    // Currently executing
  'succeeded',  // Completed successfully
  'failed',     // Failed with errors
  'cancelled',  // Manually cancelled
  'timeout',    // Timed out
]));

export type ETLRunStatus = z.input<typeof ETLRunStatusSchema>;
/** @see {@link ETLRunStatus} — the enum has no transform, so this is the same type. */
export type ETLRunStatusParsed = z.infer<typeof ETLRunStatusSchema>;

/**
 * ETL Pipeline Run Result
 *
 * Result of a pipeline execution.
 *
 * ## Deliberately NOT strict — the wire half of this file (#4001 批 12)
 *
 * Everything above this line closed against unknown keys. These three shapes —
 * `ETLPipelineRunSchema` and its `stats` / `error` blocks — stay tolerant, and
 * this comment is the exemption record so the next sweep reads a decision
 * rather than an omission. Same disposition, same reason, as
 * `FlowVersionHistorySchema` in `flow.zod.ts` and the whole of
 * `execution.zod.ts` ("run-state envelopes — never strict").
 *
 * **Why.** Every key here is a fact the engine PRODUCES about a run that
 * already happened: an id it minted, a status it reached, timestamps it
 * observed, counters it accumulated, the error it caught. Nobody authors a run
 * result — writing one by hand is not a use case, it is a lie about history.
 * Strictness on a shape like this buys nothing (there is no author to protect
 * from a silent strip) and costs the thing the campaign is most careful about:
 * an engine that later reports one more counter would turn every existing
 * reader's `.parse()` into a crash, which is how a tolerant wire shape becomes
 * a breaking change by accident (#3712 did exactly this to `provenance` on
 * `HookContextSchema`, and the ledger's `hook.zod.ts` row records the same
 * split for the same reason).
 *
 * **How this was verified, and the limit of that verification.** The honest
 * measurement is stated rather than dressed up: `etl.zod.ts` has NO parse site
 * in objectstack, objectui or cloud, so neither half of this file could be
 * classified by pointing at a live call. The seven above are authorable because
 * the exported schema and type ARE the authoring door — `SYNC_ARCHITECTURE.md`
 * and this module's `@example` both write `const p: ETLPipeline = { … }` by
 * hand. These three are wire because their key set is engine-produced fact, and
 * because no ETL engine exists yet the argument rests on the shape's semantics
 * plus the campaign's settled precedent for exactly this pair — not on an emit
 * site anyone can point at today. **The day an ETL engine lands, this comment
 * is the thing to re-read**: if a run result turns out to be something an
 * operator authors (a replay stub, a backfill marker), the verdict changes and
 * the ledger row changes with it.
 */
export const ETLPipelineRunSchema = lazySchema(() => z.object({
  /**
   * Run ID
   */
  id: z.string().describe('Run identifier'),

  /**
   * Pipeline name
   */
  pipelineName: z.string().describe('Pipeline name'),

  /**
   * Run status
   */
  status: ETLRunStatusSchema.describe('Run status'),

  /**
   * Start timestamp
   */
  startedAt: z.string().datetime().describe('Start time'),

  /**
   * End timestamp
   */
  completedAt: z.string().datetime().optional().describe('Completion time'),

  /**
   * Duration in milliseconds
   */
  durationMs: z.number().optional().describe('Duration in ms'),

  /**
   * Statistics
   */
  stats: z.object({
    recordsRead: z.number().int().default(0).describe('Records extracted'),
    recordsWritten: z.number().int().default(0).describe('Records loaded'),
    recordsErrored: z.number().int().default(0).describe('Records with errors'),
    bytesProcessed: z.number().int().default(0).describe('Bytes processed'),
  }).optional().describe('Run statistics'),

  /**
   * Error information
   */
  error: z.object({
    message: z.string().describe('Error message'),
    code: z.string().optional().describe('Error code'),
    details: z.unknown().optional().describe('Error details'),
  }).optional().describe('Error information'),

  /**
   * Execution logs
   */
  logs: z.array(z.string()).optional().describe('Execution logs'),
}));

/**
 * What a writer of a run result hands in — `stats`' four counters optional.
 *
 * A run result is engine-emitted, not authored (see the schema note above), so
 * the pair here is about the READER's annotation, not an authoring door. It
 * still follows the house convention rather than opting out, for the same
 * reason `FlowVersionHistory` — the other wire shape in `automation/` — does:
 * one rule for the whole namespace beats a per-shape exception nobody can
 * predict from the outside.
 */
export type ETLPipelineRun = z.input<typeof ETLPipelineRunSchema>;
/** The post-parse shape — `stats`' counters present, defaulted to 0. */
export type ETLPipelineRunParsed = z.infer<typeof ETLPipelineRunSchema>;

/**
 * Helper factory for creating ETL pipelines.
 *
 * Both helpers return {@link ETLPipeline} — the AUTHOR shape. They construct a
 * literal by hand, which is the same act an author performs, so the input type
 * is the correct return type; the caller passes the result to
 * `ETLPipelineSchema.parse` (or hands it to an engine that will) exactly as
 * they would their own literal.
 *
 * The annotation is textually unchanged from pre-17 but its MEANING flipped
 * with the alias (#4963), and that removed two workarounds these helpers were
 * carrying purely to satisfy their own return type:
 *
 *  - **`enabled: true` is gone from both.** It stated the schema's own default
 *    and was written only because `z.infer` made the key required. What each
 *    helper still spells out is what it actually DECIDES:
 *    `databaseSync` is `incremental` + `upsert` (neither is the default) and
 *    `apiToDatabase` is `full` + `append`. The second pair does coincide with
 *    the defaults, and is kept deliberately — the two helpers exist as a
 *    contrast, and a reader comparing them must be able to see which extraction
 *    and write posture each one picked without going to look up two defaults.
 *  - **`schedule` is passed straight through.** It used to be pre-wrapped
 *    (`typeof s === 'string' ? { dialect: 'cron', source: s } : s`) because
 *    `z.infer` of `CronExpressionInputSchema` is the post-transform envelope
 *    and would not accept the bare cron string these helpers advertise. The
 *    union IS the input type, so the normalization belongs where it always
 *    did — in the schema, at parse.
 */
export const ETL = {
  /**
   * Create a simple database-to-database pipeline
   */
  databaseSync: (params: {
    name: string;
    sourceTable: string;
    destTable: string;
    schedule?: import("../shared/expression.zod").CronExpressionInput;
  }): ETLPipeline => ({
    name: params.name,
    source: {
      type: 'database',
      config: { table: params.sourceTable },
    },
    destination: {
      type: 'database',
      config: { table: params.destTable },
      writeMode: 'upsert',
    },
    syncMode: 'incremental',
    schedule: params.schedule,
  }),

  /**
   * Create an API to database pipeline
   */
  apiToDatabase: (params: {
    name: string;
    apiConnector: string;
    destTable: string;
    schedule?: import("../shared/expression.zod").CronExpressionInput;
  }): ETLPipeline => ({
    name: params.name,
    source: {
      type: 'api',
      connector: params.apiConnector,
      config: {},
    },
    destination: {
      type: 'database',
      config: { table: params.destTable },
      writeMode: 'append',
    },
    syncMode: 'full',
    schedule: params.schedule,
  }),
} as const;
