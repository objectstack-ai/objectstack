// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';


/**
 * Driver Identifier
 * Can be a built-in driver or a plugin-contributed driver (e.g., "com.vendor.snowflake").
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictUnknownKeyError } from '../shared/suggestions.zod';
import { validateDriverConfig } from './driver/config-registry.zod';

/*
 * ── Unknown-key strictness (#4001 data step, closed out by #4410) ───────────
 *
 * Every AUTHORING shape in this module is `.strict()`. `datasource` is a
 * registered metadata type (BUILTIN_METADATA_TYPE_SCHEMAS), so one shape backs
 * `defineDatasource()`, `defineStack({ datasources })`, the
 * `/api/v1/meta/datasource` endpoint, and the Setup → Datasources form.
 *
 * `config` stays `z.record` HERE, because it is per-driver by construction: a
 * sqlite `filename` and a postgres `host`/`port` share no shape. What it no
 * longer is, is unchecked. Since #4410 the refinement on
 * {@link DatasourceSchema} parses it against the contract for the declared
 * driver (`data/driver/config-registry.zod.ts`), so the openness at this level
 * is a shape this level cannot express — not the absence of one.
 *
 * That openness is exactly why the TOP level had to close first. Before #4001, a
 * connection key written one level too high — `host` next to `driver` instead
 * of inside `config` — was stripped in silence, and the datasource then
 * connected on driver defaults (localhost, default port) rather than failing.
 * A misplaced `password` is the same bug wearing a worse hat, which is why it
 * is prescribed toward `external.credentialsRef` rather than merely relocated.
 *
 * A driver the platform ships no contract for (a plugin's
 * `com.vendor.snowflake`) keeps an unvalidated `config`. That is the honest
 * boundary, not a leftover hole — see the registry's own note on why inventing
 * a verdict against a shape we do not have would be worse than the silence.
 */

/** Keys {@link DriverDefinitionSchema} declares (drift-guarded by datasource.test.ts). */
const DRIVER_DEFINITION_KEYS = ['id', 'label', 'description', 'icon', 'configSchema', 'capabilities'] as const;

/** Keys {@link ExternalDatasourceSettingsSchema} declares (drift-guarded by datasource.test.ts). */
const EXTERNAL_SETTINGS_KEYS = [
  'label', 'allowedSchemas', 'allowWrites', 'validation',
  'credentialsRef', 'queryTimeoutMs', 'requirePermission',
] as const;

/** Keys the external `validation` block declares (drift-guarded by datasource.test.ts). */
const EXTERNAL_VALIDATION_KEYS = ['onMismatch', 'checkOnBoot', 'checkIntervalMs'] as const;

/** Keys {@link DatasourceSchema} declares (drift-guarded by datasource.test.ts). */
const DATASOURCE_KEYS = [
  'name', 'label', 'driver', 'config', 'pool', 'capabilities',
  'healthCheck', 'ssl', 'retryPolicy', 'description', 'active', 'autoConnect',
  'schemaMode', 'external', 'origin',
] as const;

/** Keys the datasource `pool` block declares (drift-guarded by datasource.test.ts). */
const POOL_KEYS = ['min', 'max', 'idleTimeoutMillis', 'connectionTimeoutMillis'] as const;

/** Keys the datasource `healthCheck` block declares (drift-guarded by datasource.test.ts). */
const HEALTH_CHECK_KEYS = ['enabled', 'intervalMs', 'timeoutMs'] as const;

/** Keys the datasource `ssl` block declares (drift-guarded by datasource.test.ts). */
const SSL_KEYS = ['enabled', 'rejectUnauthorized', 'ca', 'cert', 'key'] as const;

/** Keys the datasource `retryPolicy` block declares (drift-guarded by datasource.test.ts). */
const DATASOURCE_RETRY_POLICY_KEYS = ['maxRetries', 'baseDelayMs', 'maxDelayMs', 'backoffMultiplier'] as const;

/**
 * A connection detail written one level too high — it belongs inside `config`.
 *
 * This prescription makes a validation claim again, and #4410 is what made the
 * claim true. Between #4001 and #4410 it did not: the sentence read "the
 * driver's own configSchema validates it there", which was false twice over —
 * {@link DriverDefinitionSchema}'s `configSchema` was a `z.record` both bundled
 * driver specs set to `{}`, and nothing read it. That made this the worst line
 * in the module: it took an author who had made a *recoverable* mistake at a
 * place that catches it, and pointed them — with the platform's authority — at a
 * slot where the same mistake was silent again. `config: { hostname: … }` was
 * stripped in silence and the datasource connected on localhost, which is
 * #4001's original bug verbatim, one level down. A wrong instruction is worse
 * than none, and worst of all for an AI author, whose only check on "did that
 * work?" is whether the parse complained.
 *
 * Note the SECOND thing #4410 had to fix for this line to be safe: the target
 * must be the key the driver contract actually declares. Prescribing
 * `config: { user: … }` when the postgres contract spells it `username` would
 * have swapped a one-step correction for a two-step one — reject at the top,
 * reject again inside — so `canonical` names the landing key, not the one the
 * author happened to type.
 */
const belongsInConfig = (key: string, canonical: string = key) =>
  `\`${key}\` is a driver connection detail — it belongs inside \`config\`, not at the top `
  + `level. Move it to \`config: { ${canonical}: … }\`, which is parsed against your driver's `
  + `config contract (\`PostgresConfigSchema\` / \`MysqlConfigSchema\` / \`SqliteConfigSchema\` / `
  + `\`MongoConfigSchema\` / \`MemoryConfigSchema\`, exported from \`@objectstack/spec/data\`).`;

const driverDefinitionUnknownKeyError = strictUnknownKeyError({
  surface: 'this driver definition',
  knownKeys: DRIVER_DEFINITION_KEYS,
  aliases: {
    name: 'id',
    driver: 'id',
    title: 'label',
    config: 'configSchema',
    schema: 'configSchema',
    capability: 'capabilities',
  },
  history: 'Until #4001 these were dropped silently — the driver still registered.',
});

const externalSettingsUnknownKeyError = strictUnknownKeyError({
  surface: "this datasource's external settings",
  knownKeys: EXTERNAL_SETTINGS_KEYS,
  aliases: {
    schemas: 'allowedSchemas',
    allowedschema: 'allowedSchemas',
    writable: 'allowWrites',
    allowwrite: 'allowWrites',
    credentials: 'credentialsRef',
    secretref: 'credentialsRef',
    timeoutms: 'queryTimeoutMs',
    querytimeout: 'queryTimeoutMs',
    permission: 'requirePermission',
  },
  guidance: {
    password:
      '`password` must never be inlined. Put the secret in the secrets store and reference '
      + 'it with `credentialsRef` (e.g. `credentialsRef: "secret:warehouse/password"`).',
    // #4487 corrected the second half of this line. It used to offer
    // `capabilities.readOnly` as the place to "describe the driver" — a key the
    // liveness audit found has NO reader (liveness/datasource.json), so an
    // author who took the advice believed they had marked a datasource
    // non-writable and had not. Same defect as the pre-#4410 `belongsInConfig`
    // line documented above, on a property whose whole point is safety: a
    // prescription must land somewhere enforced, and `allowWrites` is the only
    // write gate there is.
    readOnly:
      '`readOnly` is not an external-settings key. Use `allowWrites: false` here — it is the '
      + 'enforced datasource-wide write gate (checked by the ObjectQL engine before any write '
      + 'to a federated datasource).',
  },
  history: 'Until #4001 these were dropped silently — federation ran on the defaults instead.',
});

const externalValidationUnknownKeyError = strictUnknownKeyError({
  surface: "this datasource's external validation policy",
  knownKeys: EXTERNAL_VALIDATION_KEYS,
  aliases: {
    onmismatch: 'onMismatch',
    mismatch: 'onMismatch',
    checkonboot: 'checkOnBoot',
    validateonboot: 'checkOnBoot',
    interval: 'checkIntervalMs',
    checkinterval: 'checkIntervalMs',
  },
  history:
    'Until #4001 these were dropped silently — drift checking ran on the defaults '
    + '(fail on mismatch, check at boot) regardless of what was written.',
});

/**
 * `datasource.readReplicas` — retired (#4468, ADR-0049 enforce-or-remove).
 *
 * The full lifecycle of a declared-only key, in one slot. `readReplicas` was
 * declared, `.strict()`-guarded, and #4410 even taught it to validate each
 * entry against the driver's config contract — so a typo'd replica host was
 * rejected with a precise fix-it error. What none of that established is that
 * anything ever *connects* to a replica: `ConnectableDatasource` and
 * `DatasourceConnectionSpec` have no replicas field, the driver factory never
 * reads the key, and no query path distinguishes a read from a write. The
 * platform has no read/write splitting at all, so there was no seam for this to
 * plug into. #4410 made the validation better without making the feature exist,
 * which is the trap ADR-0049 names: precision applied to an inert slot reads as
 * evidence the slot is live.
 *
 * `replicas` shares this prescription rather than aliasing to the removed key —
 * an author who spelled it the other way deserves the same explanation, not a
 * rename onto a key that is also gone.
 */
const RETIRED_READ_REPLICAS =
  '`datasource.readReplicas` was removed in @objectstack/spec 17.0.0 (#4468, ADR-0049) — '
  + 'it described replica connections nothing ever opened: no driver reads the key, and no '
  + 'query path separates reads from writes, so every statement always went to the primary. '
  + 'Delete the key. There is no read-replica routing to migrate to — if your database fronts '
  + 'its replicas behind one endpoint (pgpool, ProxySQL, an RDS reader endpoint), point '
  + '`config` at that endpoint, which is the only read-scaling path that works today. '
  + 'Run `os migrate meta --from 16` to rewrite it automatically.';

const datasourceUnknownKeyError = strictUnknownKeyError({
  surface: 'this datasource',
  knownKeys: DATASOURCE_KEYS,
  aliases: {
    type: 'driver',
    connection: 'config',
    connectionconfig: 'config',
    options: 'config',
    enabled: 'active',
    pooling: 'pool',
    mode: 'schemaMode',
    schema_mode: 'schemaMode',
    federation: 'external',
    retry: 'retryPolicy',
    tls: 'ssl',
  },
  guidance: {
    host: belongsInConfig('host'),
    port: belongsInConfig('port'),
    database: belongsInConfig('database'),
    user: belongsInConfig('user', 'username'),
    username: belongsInConfig('username'),
    filename: belongsInConfig('filename'),
    url: belongsInConfig('url'),
    connectionString: belongsInConfig('connectionString', 'url'),
    password:
      '`password` must never be inlined on a datasource. Interpolate it from the environment '
      + 'inside `config`, or for an external datasource reference the secrets store via '
      + '`external.credentialsRef`.',
    readReplicas: RETIRED_READ_REPLICAS,
    replicas: RETIRED_READ_REPLICAS,
  },
  history:
    'Until #4001 these were dropped silently — a connection key written one level too high '
    + 'left the datasource connecting on driver defaults rather than failing.',
});

const poolUnknownKeyError = strictUnknownKeyError({
  surface: "this datasource's pool config",
  knownKeys: POOL_KEYS,
  aliases: {
    minimum: 'min',
    maximum: 'max',
    minconnections: 'min',
    maxconnections: 'max',
    idletimeout: 'idleTimeoutMillis',
    idletimeoutms: 'idleTimeoutMillis',
    connectiontimeout: 'connectionTimeoutMillis',
    connectiontimeoutms: 'connectionTimeoutMillis',
    acquiretimeoutmillis: 'connectionTimeoutMillis',
  },
  history:
    'Until #4001 these were dropped silently — the pool ran on its defaults (min 0, max 10) '
    + 'no matter what was written. Note both timeouts end in `Millis`, not `Ms`.',
});

const healthCheckUnknownKeyError = strictUnknownKeyError({
  surface: "this datasource's healthCheck config",
  knownKeys: HEALTH_CHECK_KEYS,
  aliases: {
    active: 'enabled',
    interval: 'intervalMs',
    intervalmillis: 'intervalMs',
    timeout: 'timeoutMs',
    timeoutmillis: 'timeoutMs',
  },
  history: 'Until #4001 these were dropped silently — health checks ran on the defaults.',
});

const sslUnknownKeyError = strictUnknownKeyError({
  surface: "this datasource's ssl config",
  knownKeys: SSL_KEYS,
  aliases: {
    active: 'enabled',
    ssl: 'enabled',
    tls: 'enabled',
    rejectunauthorised: 'rejectUnauthorized',
    cacert: 'ca',
    certificate: 'cert',
    clientcert: 'cert',
    privatekey: 'key',
    clientkey: 'key',
  },
  guidance: {
    insecure:
      '`insecure` is not an ssl key. To accept a self-signed certificate set '
      + '`rejectUnauthorized: false` — deliberately, and never against a production database.',
  },
  history:
    'Until #4001 these were dropped silently — which meant a TLS setting that never took '
    + 'effect looked identical to one that did.',
});

const datasourceRetryPolicyUnknownKeyError = strictUnknownKeyError({
  surface: "this datasource's retryPolicy",
  knownKeys: DATASOURCE_RETRY_POLICY_KEYS,
  aliases: {
    retries: 'maxRetries',
    attempts: 'maxRetries',
    backoffms: 'baseDelayMs',
    basedelay: 'baseDelayMs',
    delayms: 'baseDelayMs',
    maxdelay: 'maxDelayMs',
    multiplier: 'backoffMultiplier',
    backoff: 'backoffMultiplier',
  },
  history:
    'Until #4001 these were dropped silently — reconnects ran on the defaults. Note a hook '
    + 'retryPolicy spells its delay `backoffMs`; a datasource spells it `baseDelayMs`.',
});

const capabilitiesUnknownKeyError = strictUnknownKeyError({
  surface: 'these datasource capabilities',
  knownKeys: [
    'transactions', 'queryFilters', 'queryAggregations', 'querySorting',
    'queryPagination', 'queryWindowFunctions', 'querySubqueries', 'joins',
    'fullTextSearch', 'readOnly', 'dynamicSchema',
  ],
  aliases: {
    transaction: 'transactions',
    filters: 'queryFilters',
    filtering: 'queryFilters',
    aggregations: 'queryAggregations',
    aggregation: 'queryAggregations',
    sorting: 'querySorting',
    sort: 'querySorting',
    pagination: 'queryPagination',
    windowfunctions: 'queryWindowFunctions',
    subqueries: 'querySubqueries',
    join: 'joins',
    fulltext: 'fullTextSearch',
    search: 'fullTextSearch',
    readonly: 'readOnly',
    schemaless: 'dynamicSchema',
  },
  history:
    'Until #4001 these were dropped silently — and a capability that fails to register '
    + 'reads as FALSE, so the engine quietly stopped pushing that work down to the driver '
    + 'and recomputed it in memory instead.',
});

export const DriverType = z.string().describe('Underlying driver identifier');

/**
 * Driver Definition Schema
 * Metadata describing a Database Driver.
 * Plugins use this to register new connectivity options.
 */
export const DriverDefinitionSchema = lazySchema(() => z.object({
  id: z.string().describe('Unique driver identifier (e.g. "postgres")'),
  label: z.string().describe('Display label (e.g. "PostgreSQL")'),
  description: z.string().optional(),
  icon: z.string().optional(),
  
  /**
   * Configuration Schema (JSON Schema)
   *
   * The structure of the `config` object this driver needs — rendered by the
   * Studio connection form (`GET /api/v1/datasources/drivers`) and, for the
   * built-in drivers, the JSON-Schema projection of the very zod schema
   * `DatasourceSchema` parses `config` against. Form and gate therefore describe
   * one shape by construction.
   *
   * Both bundled driver specs used to set this to `{}`, one of them with a
   * comment promising it would be "populated at runtime" by code that did not
   * exist; nothing read the field either (#4410). Fill it from a real schema —
   * an empty object here means the connection form has nothing to render and
   * says so, which is the loud version of the same absence.
   */
  configSchema: z.record(z.string(), z.unknown()).describe('JSON Schema for connection configuration'),

  /**
   * Default Capabilities
   * What this driver supports out-of-the-box.
   */
  capabilities: z.lazy(() => DatasourceCapabilities).optional(),
}, { error: driverDefinitionUnknownKeyError }).strict());

/** A driver definition — {@link DriverDefinitionSchema}'s parsed shape. */
export type DriverDefinition = z.infer<typeof DriverDefinitionSchema>;

/**
 * Datasource Capabilities Schema
 * Declares what this datasource naturally supports.
 * The ObjectQL engine uses this to determine what logic to push down
 * and what to compute in memory.
 */
export const DatasourceCapabilities = z.object({
  // ============================================================================
  // Transaction & Connection Management
  // ============================================================================
  
  /** Can handle ACID transactions? */
  transactions: z.boolean().default(false),
  
  // ============================================================================
  // Query Operations
  // ============================================================================
  
  /** Can execute WHERE clause filters natively? */
  queryFilters: z.boolean().default(false),
  
  /** Can perform aggregation (group by, sum, avg)? */
  queryAggregations: z.boolean().default(false),
  
  /** Can perform ORDER BY sorting? */
  querySorting: z.boolean().default(false),
  
  /** Can perform LIMIT/OFFSET pagination? */
  queryPagination: z.boolean().default(false),
  
  /** Can perform window functions? */
  queryWindowFunctions: z.boolean().default(false),
  
  /** Can perform subqueries? */
  querySubqueries: z.boolean().default(false),
  
  /** Can execute SQL-like joins natively? */
  joins: z.boolean().default(false),
  
  // ============================================================================
  // Advanced Features
  // ============================================================================
  
  /** Can perform full-text search? */
  fullTextSearch: z.boolean().default(false),
  
  /** Is read-only? */
  readOnly: z.boolean().default(false),
  
  /** Is scheme-less (needs schema inference)? */
  dynamicSchema: z.boolean().default(false),
}, { error: capabilitiesUnknownKeyError }).strict();

/**
 * Schema Ownership Mode (ADR-0015)
 *
 * Distinguishes "ObjectStack owns this schema" from "this is somebody
 * else's production database — never touch DDL". Gates migrations,
 * boot-time validation, and writes.
 *
 * - `managed`       — ObjectStack owns the schema: DDL + migrations allowed.
 * - `external`      — Mature external DB: DDL forbidden; mismatch fails boot.
 * - `validate-only` — Like `external`, but mismatches warn instead of fail.
 */
export const SchemaModeSchema = z
  .enum(['managed', 'external', 'validate-only'])
  .describe('Schema ownership mode');

export type SchemaMode = z.infer<typeof SchemaModeSchema>;

/**
 * External Datasource Settings (ADR-0015)
 *
 * Present only when `schemaMode !== 'managed'`. Carries the federation
 * policy for a mature external database: write gating, schema whitelist,
 * boot/drift validation behaviour, credentials reference, and query caps.
 */
export const ExternalDatasourceSettingsSchema = z.object({
  label: z.string().optional()
    .describe('Display label, e.g. "Snowflake — ANALYTICS / PROD"'),
  allowedSchemas: z.array(z.string()).optional()
    .describe('Whitelist of remote schemas/databases that may be exposed.'),
  allowWrites: z.boolean().default(false)
    .describe('Global write gate. Individual objects must also opt in via object.external.writable.'),
  validation: z.object({
    onMismatch: z.enum(['fail', 'warn', 'ignore']).default('fail')
      .describe('What to do when a federated object diverges from the remote table.'),
    checkOnBoot: z.boolean().default(true)
      .describe('Validate federated objects against the remote schema at boot.'),
    checkIntervalMs: z.number().optional()
      .describe('Optional background drift-check interval in milliseconds.'),
  }, { error: externalValidationUnknownKeyError }).strict()
    .default({ onMismatch: 'fail', checkOnBoot: true }).describe('Boot/drift validation policy'),
  credentialsRef: z.string().optional()
    .describe('Reference into the secrets store; never inline credentials.'),
  queryTimeoutMs: z.number().default(30_000)
    .describe('Hard cap on per-query execution time.'),
  requirePermission: z.string().optional()
    .describe('Optional convenience: gate the entire datasource behind a single role.'),
}, { error: externalSettingsUnknownKeyError }).strict()
  .describe('External datasource federation settings (schemaMode != "managed")');

export type ExternalDatasourceSettings = z.infer<typeof ExternalDatasourceSettingsSchema>;

/**
 * Replay a driver-config parse onto the datasource's own issue list (#4410).
 *
 * A no-op for a driver the platform ships no contract for — `known: false` is
 * the registry saying "nothing to check against", which is deliberately NOT the
 * same answer as "checked and clean".
 */
function reportDriverConfigIssues(
  ctx: z.RefinementCtx,
  driver: unknown,
  config: unknown,
  basePath: (string | number)[],
): void {
  const result = validateDriverConfig(driver, config);
  if (!result.known) return;
  for (const issue of result.issues) {
    ctx.addIssue({
      code: 'custom',
      path: [...basePath, ...issue.path],
      message: issue.message,
    });
  }
}

/**
 * Datasource Schema
 * Represents a connection to an external data store.
 */
export const DatasourceSchema = lazySchema(() => z.object({
  /** Machine Name */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique datasource identifier'),
  
  /** Human Label */
  label: z.string().optional().describe('Display label'),
  
  /** Driver */
  driver: DriverType.describe('Underlying driver type'),
  
  /** 
   * Connection Configuration 
   * Specific to the driver (e.g., host, port, user, password, bucket, etc.)
   * Stored securely (passwords usually interpolated from ENV).
   */
  config: z.record(z.string(), z.unknown()).describe('Driver specific configuration'),
  
  /**
   * Connection Pool Configuration
   * Standard connection pooling settings.
   */
  pool: z.object({
    min: z.number().default(0).describe('Minimum connections'),
    max: z.number().default(10).describe('Maximum connections'),
    idleTimeoutMillis: z.number().default(30000).describe('Idle timeout'),
    connectionTimeoutMillis: z.number().default(3000).describe('Connection establishment timeout'),
  }, { error: poolUnknownKeyError }).strict().optional().describe('Connection pool settings'),

  // `readReplicas` was removed here (#4468) — see RETIRED_READ_REPLICAS. It
  // declared replica connections nothing opened; read/write splitting does not
  // exist in the platform, so there was no consumer for it to reach.

  /**
   * Capability Overrides
   * Manually override what the driver claims to support.
   */
  capabilities: DatasourceCapabilities.optional().describe('Capability overrides'),
  
  /** Health Check */
  healthCheck: z.object({
    enabled: z.boolean().default(true).describe('Enable health check endpoint'),
    intervalMs: z.number().default(30000).describe('Health check interval in milliseconds'),
    timeoutMs: z.number().default(5000).describe('Health check timeout in milliseconds'),
  }, { error: healthCheckUnknownKeyError }).strict().optional().describe('Datasource health check configuration'),

  /** SSL/TLS Configuration */
  ssl: z.object({
    enabled: z.boolean().default(false).describe('Enable SSL/TLS for database connection'),
    rejectUnauthorized: z.boolean().default(true).describe('Reject connections with invalid/self-signed certificates'),
    ca: z.string().optional().describe('CA certificate (PEM format or path to file)'),
    cert: z.string().optional().describe('Client certificate (PEM format or path to file)'),
    key: z.string().optional().describe('Client private key (PEM format or path to file)'),
  }, { error: sslUnknownKeyError }).strict().optional().describe('SSL/TLS configuration for secure database connections'),

  /** Retry Policy */
  retryPolicy: z.object({
    maxRetries: z.number().default(3).describe('Maximum number of retry attempts'),
    baseDelayMs: z.number().default(1000).describe('Base delay between retries in milliseconds'),
    maxDelayMs: z.number().default(30000).describe('Maximum delay between retries in milliseconds'),
    backoffMultiplier: z.number().default(2).describe('Exponential backoff multiplier'),
  }, { error: datasourceRetryPolicyUnknownKeyError }).strict().optional().describe('Connection retry policy for transient failures'),

  /** Description */
  description: z.string().optional().describe('Internal description'),
  
  /** Is enabled? */
  active: z.boolean().default(true).describe('Is datasource enabled'),

  /**
   * Auto-connect opt-in (ADR-0062 D2(c)).
   *
   * Forces the runtime to build a live driver for this datasource at boot even
   * when it is `managed` and nothing routes to it. By default a declared
   * datasource only auto-connects when it is `external` or an object explicitly
   * binds to it via `object.datasource` (see ADR-0062 D2). Set this to opt a
   * managed, unrouted datasource into the live-connection lifecycle.
   */
  autoConnect: z.boolean().default(false)
    .describe('Force a live driver connection at boot even when managed + unrouted (ADR-0062 D2).'),

  /**
   * Schema Ownership Mode (ADR-0015)
   * Declares whether ObjectStack owns this schema (`managed`, default) or
   * is a guest in a mature external database (`external` / `validate-only`).
   */
  schemaMode: SchemaModeSchema.default('managed'),

  /**
   * External Federation Settings (ADR-0015)
   * Required when `schemaMode !== 'managed'`; forbidden otherwise.
   */
  external: ExternalDatasourceSettingsSchema.optional(),

  /**
   * Provenance (ADR-0015 Addendum)
   *
   * Server-managed, read-only. Distinguishes code-defined datasources
   * (`code` — authored as `*.datasource.ts`, GitOps-owned, read-only in the
   * UI) from runtime datasources (`runtime` — created via the Studio wizard,
   * persisted in the runtime metadata store, environment-scoped, editable).
   *
   * Never accepted from client input: the runtime stamps `code` on artefact
   * load and `runtime` on UI create. Defaults to `code` for artefact-defined
   * datasources that predate this field.
   */
  origin: z.enum(['code', 'runtime']).default('code')
    .describe('Datasource provenance (server-managed, read-only)'),
}, { error: datasourceUnknownKeyError }).strict().superRefine((ds, ctx) => {
  // The `config` gate (#4410). `config` is parsed against the contract for the
  // declared driver and every issue is re-pathed under the slot it came from —
  // the author sees `config.hostname`, not a detached message.
  //
  // #4410 ran this over each `readReplicas` entry too. #4468 removed that along
  // with the key: validating entries for connections nothing opens spends the
  // author's trust on a slot that cannot pay it back.
  reportDriverConfigIssues(ctx, ds.driver, ds.config, ['config']);

  if (ds.schemaMode !== 'managed' && !ds.external) {
    ctx.addIssue({
      code: 'custom',
      path: ['external'],
      message: `schemaMode='${ds.schemaMode}' requires 'external' settings.`,
    });
  }
  if (ds.schemaMode === 'managed' && ds.external) {
    ctx.addIssue({
      code: 'custom',
      path: ['external'],
      message: `'external' settings only apply when schemaMode != 'managed'.`,
    });
  }
}));

export type Datasource = z.infer<typeof DatasourceSchema>;
/** Authoring input for {@link Datasource} — defaulted fields are optional. */
export type DatasourceInput = z.input<typeof DatasourceSchema>;
export type DatasourceCapabilitiesType = z.infer<typeof DatasourceCapabilities>;

/**
 * Type-safe factory for an external data connection (datasource). Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Datasource` literal.
 */
export function defineDatasource(config: z.input<typeof DatasourceSchema>): Datasource {
  return DatasourceSchema.parse(config);
}
