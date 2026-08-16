// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Driver Identifier
 * Can be a built-in driver or a plugin-contributed driver (e.g., "com.vendor.snowflake").
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { urlUserinfoUsername } from './driver/common.zod';
import { resolveDriverId, validateDriverConfig } from './driver/config-registry.zod';

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

const CAPABILITIES_REMOVED_PREFIX =
  '`datasource.capabilities` was removed in @objectstack/spec 17.0.0 (#4583, ADR-0049) — '
  + 'all eleven flags were declared, strict-guarded and read by nobody. ';

/**
 * Tombstone for the retired `capabilities` block (#4583).
 *
 * Each flag gets its own prescription rather than one shared line, because the
 * mechanism that actually decides the behaviour differs per flag — and a
 * prescription that names the wrong mechanism is worse than none (#4001 landed
 * four of those before the sweep caught them).
 */
const RETIRED_CAPABILITIES: Record<string, string> = {
  capabilities:
    CAPABILITIES_REMOVED_PREFIX
    + 'Pushdown is decided by the runtime driver\'s own `supports.*` object, not by datasource '
    + 'metadata, so declaring a capability here never changed which engine path ran. Delete the '
    + 'block. If you wrote `readOnly: true`, read its note below — it did NOT make anything '
    + 'read-only. Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  readOnly:
    CAPABILITIES_REMOVED_PREFIX
    + '`readOnly` in particular NEVER made a datasource read-only: no write path consulted it, '
    + 'so a datasource labelled a read replica accepted writes exactly like any other. The one '
    + 'enforced datasource-wide write gate is `external.allowWrites: false`, and it applies ONLY '
    + 'to a federated datasource (`schemaMode` other than `managed`) — for a managed datasource '
    + 'there is no read-only gate at all, so delete the key rather than trusting it. #4584 '
    + 'settled that this stays so ON PURPOSE: grant the connection SELECT-only at the database '
    + '(`GRANT SELECT`), which no direct connection, migration or DDL can talk past — an '
    + 'application-layer flag holds in the ObjectQL path only, and one that looks like a boundary '
    + 'without being one is worse than none.',
};

/**
 * Tombstones for the three inert blocks retired alongside `capabilities`
 * (#4583 batches B/C/D).
 *
 * Same finding in each case: declared, `.strict()`-guarded, and read by no
 * runtime path. What differs — and what each prescription has to name — is the
 * mechanism that DOES decide the behaviour, because pointing an author at the
 * wrong one is how the `readOnly` defect propagated for three releases.
 */
const RETIRED_DATASOURCE_BLOCKS: Record<string, string> = {
  retryPolicy:
    '`datasource.retryPolicy` was removed in @objectstack/spec 17.0.0 (#4583, ADR-0049) — no '
    + 'connect or query path ever retried on it. Connection failure is handled by the boot '
    + 'policy in the datasource connection service (degraded boot, or `bootCritical` fail-fast), '
    + 'which does not retry on a schedule. Delete the block. '
    + 'CAREFUL — do NOT "fix" this by renaming keys: `hook.retryPolicy` and `job.retryPolicy` ARE '
    + 'enforced, but they are a DIFFERENT key on a different type and spell the delay `backoffMs`, '
    + 'not `baseDelayMs`. Moving these values onto a hook or a job only makes sense if you '
    + 'actually want that hook or job retried. Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  healthCheck:
    '`datasource.healthCheck` was removed in @objectstack/spec 17.0.0 (#4583, ADR-0049) — no '
    + 'health-check loop ever read it, so `enabled: true` scheduled nothing and the two timeouts '
    + 'bounded nothing. Connection liveness is probed ON DEMAND through the driver handle '
    + '(`ping()` / `checkHealth()`), which the datasource admin service calls for "Test '
    + 'connection". The only recurring datasource timer is `external.validation.checkIntervalMs`, '
    + 'which checks SCHEMA DRIFT — a different concern, not a liveness probe. Delete the block. '
    + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  externalLabel:
    '`external.label` was removed in @objectstack/spec 17.0.0 (#4583, ADR-0049) — nothing read '
    + "the federation block's own label. Use the datasource's TOP-LEVEL `label`, which is what "
    + 'Setup → Datasources actually renders. Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  externalRequirePermission:
    '`external.requirePermission` was removed in @objectstack/spec 17.0.0 (#4583, ADR-0049) — no '
    + 'authorization check ever consulted it, so a permission named here gated nothing. Access to '
    + "a federated datasource's data is governed by the ordinary object permission sets and RLS, "
    + 'exactly as for a managed datasource. Naming a permission that is never required is the '
    + 'false-compliance shape ADR-0049 exists to remove — grant or withhold the object '
    + 'permissions instead. Run `os migrate meta --from 16` to rewrite existing sources automatically.',
};

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
  + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.';

export const DriverType = z.string().describe('Underlying driver identifier');
export type DriverType = z.input<typeof DriverType>;

/**
 * Driver Definition Schema
 * Metadata describing a Database Driver.
 * Plugins use this to register new connectivity options.
 */
export const DriverDefinitionSchema = lazySchema(() => strictObject(
  {
    surface: 'this driver definition',
    aliases: {
      name: 'id',
      driver: 'id',
      title: 'label',
      config: 'configSchema',
      schema: 'configSchema',
    },
    guidance: {
      capabilities: RETIRED_CAPABILITIES.capabilities,
      capability: RETIRED_CAPABILITIES.capabilities,
    },
    history: 'Until #4001 these were dropped silently — the driver still registered.',
  },
  {
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

}));

/** A driver definition — {@link DriverDefinitionSchema}'s parsed shape. */
export type DriverDefinition = z.input<typeof DriverDefinitionSchema>;

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

export type SchemaMode = z.input<typeof SchemaModeSchema>;

/**
 * External Datasource Settings (ADR-0015)
 *
 * The federation policy for a mature external database: write gating, schema
 * whitelist, boot/drift validation behaviour, credentials reference, and
 * query caps. The federation keys apply only when `schemaMode !== 'managed'`;
 * `credentialsRef` alone is also valid on a managed datasource (#8153) —
 * the Studio wizard's `createDatasource` stores the secret in the secrets
 * store and keeps the reference here, whatever the schema mode.
 */
export const ExternalDatasourceSettingsSchema = strictObject(
  {
    surface: "this datasource's external settings",
    aliases: {
      schemas: 'allowedSchemas',
      allowedschema: 'allowedSchemas',
      writable: 'allowWrites',
      allowwrite: 'allowWrites',
      credentials: 'credentialsRef',
      secretref: 'credentialsRef',
      timeoutms: 'queryTimeoutMs',
      querytimeout: 'queryTimeoutMs',
    },
    guidance: {
      label: RETIRED_DATASOURCE_BLOCKS.externalLabel,
      requirePermission: RETIRED_DATASOURCE_BLOCKS.externalRequirePermission,
      permission: RETIRED_DATASOURCE_BLOCKS.externalRequirePermission,
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
  },
  {
  allowedSchemas: z.array(z.string()).optional()
    .describe('Whitelist of remote schemas/databases that may be exposed.'),
  allowWrites: z.boolean().default(false)
    .describe('Global write gate. Individual objects must also opt in via object.external.writable.'),
  validation: strictObject(
  {
    surface: "this datasource's external validation policy",
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
  },
  {
    onMismatch: z.enum(['fail', 'warn', 'ignore']).default('fail')
      .describe('What to do when a federated object diverges from the remote table.'),
    checkOnBoot: z.boolean().default(true)
      .describe('Validate federated objects against the remote schema at boot.'),
    checkIntervalMs: z.number().optional()
      .describe('Optional background drift-check interval in milliseconds.'),
  })
    .default({ onMismatch: 'fail', checkOnBoot: true }).describe('Boot/drift validation policy'),
  credentialsRef: z.string().optional()
    .describe('Reference into the secrets store; never inline credentials. '
      + 'Valid in every schemaMode — the one `external` key a managed datasource may carry (#8153).'),
  queryTimeoutMs: z.number().default(30_000)
    .describe('Hard cap on per-query execution time.'),
})
  .describe('External datasource settings: federation policy (schemaMode != "managed") '
    + 'plus the secrets-store credentials reference (valid in every schemaMode)');

export type ExternalDatasourceSettings = z.input<typeof ExternalDatasourceSettingsSchema>;
/** Post-parse shape of {@link ExternalDatasourceSettings} — defaults applied, transforms run (ADR-0122). */
export type ExternalDatasourceSettingsParsed = z.infer<typeof ExternalDatasourceSettingsSchema>;

/**
 * Refusal for the contradictory pair "`external.credentialsRef` bound + a
 * mongo `config.url` whose userinfo names NO user" (#9041) — the "absence must
 * be loud" half of the #8696 family, refused at the one door that sees both
 * halves at once.
 *
 * Why the pair cannot work as written, all measured (on the #9041 card and
 * re-verified against `buildMongoAuth` in service-datasource's driver
 * factory): `MongoClient` credentials need a username as well as a password,
 * and with `url` present the discrete `username` field is ignored
 * (`MongoConfigSchema.url` supersedes it), so the only place the username can
 * come from is the URL's own userinfo. The bound secret is therefore injected
 * only when the URL names a user; on a user-less URL the binding is a silent
 * no-op — the datasource connects anonymously and the operator is told
 * nothing. Injecting anyway is worse, not better: measured on mongodb@7.5.0,
 * a user-less URL carries NO credentials at all, while the same URL with
 * `auth: { username: '', password: BOUND }` carries `credentials{username:''}`
 * — fabricating an empty username converts a datasource that connects today
 * into a guaranteed handshake failure. And refusing at CONNECT would
 * contradict `MongoConfigSchema.url`'s published contract ("bind the secret …
 * and it is injected at connect time") while planting a per-branch asymmetry
 * inside the factory — the defect class #8696 closed. Hence this door.
 *
 * Scope fences, each deliberate (#9041's triage, adopted verbatim):
 *
 *  - **mongo arm ONLY** (judged through {@link resolveDriverId}, so a stored
 *    legacy `driver: 'mongo'` row is judged identically to `'mongodb'` — the
 *    same alias mechanism the #9040 read-path redaction uses). The postgres
 *    arm injects on a user-less DSN by a different, measured mechanism
 *    (#8873: `pg` sends a password only when the server asks) and is NOT
 *    assumed to share this defect.
 *  - **"names no user" means {@link urlUserinfoUsername} answers
 *    `undefined`** — no userinfo at all. The present-but-empty forms
 *    (`mongodb://@h/db`, `mongodb://:p@h/db` — the accessor answers `''`)
 *    already throw in `MongoClient` itself (`MongoParseError: URI contained
 *    empty userinfo section`, measured), so only the `undefined` case is
 *    silent and only it is refused here.
 *  - **"bound" mirrors the connect path exactly**: `DatasourceConnectionService`
 *    resolves the ref under `if (credentialsRef)` — a truthy check — so an
 *    empty-string ref is not a binding there and is not one here.
 *  - The COMPOSED branch (no `url`; discrete `host`/`username` fields) is out
 *    of scope by the card's own fences: with no `url` the `username` field is
 *    live and the factory interpolates the secret into the URI it builds.
 */
const CREDENTIALS_REF_MONGO_URL_NO_USER_REFUSED =
  'this mongo `config.url` names no user in its userinfo while `external.credentialsRef` binds '
  + 'a secret — a pair that cannot work as written (#9041). MongoClient credentials need a '
  + 'username as well as a password, and with `url` present the only place the username can '
  + 'come from is the URL\'s own userinfo (the discrete `username` field is superseded by '
  + '`url`), so the bound secret is injected only when the URL names a user — on this URL the '
  + 'binding is a silent no-op: the datasource connects anonymously and the secret is never '
  + 'used. (Injecting with a fabricated empty username is worse: measured on mongodb@7.5.0, it '
  + 'turns a connection that works anonymously today into a guaranteed handshake failure.) Two '
  + 'authoring fixes are valid, depending on what this datasource is meant to do: add the '
  + 'username to the URL\'s userinfo (`mongodb://user@host/db`) so the bound secret is '
  + 'injected at connect (#8696) — or, if the datasource is genuinely meant to connect '
  + 'unauthenticated, remove the `external.credentialsRef` binding. Runtime-environment DSNs '
  + '(`OS_DATABASE_URL` and friends) do not pass through this publish door and are unaffected.';

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
export const DatasourceSchema = lazySchema(() => strictObject(
  {
    surface: 'this datasource',
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
      capabilities: RETIRED_CAPABILITIES.capabilities,
      readOnly: RETIRED_CAPABILITIES.readOnly,
      retryPolicy: RETIRED_DATASOURCE_BLOCKS.retryPolicy,
      retry: RETIRED_DATASOURCE_BLOCKS.retryPolicy,
      healthCheck: RETIRED_DATASOURCE_BLOCKS.healthCheck,
      healthcheck: RETIRED_DATASOURCE_BLOCKS.healthCheck,
    },
    history:
      'Until #4001 these were dropped silently — a connection key written one level too high '
      + 'left the datasource connecting on driver defaults rather than failing.',
  },
  {
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
  pool: strictObject(
  {
    surface: "this datasource's pool config",
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
  },
  {
    min: z.number().default(0).describe('Minimum connections'),
    max: z.number().default(10).describe('Maximum connections'),
    idleTimeoutMillis: z.number().default(30000).describe('Idle timeout'),
    connectionTimeoutMillis: z.number().default(3000).describe('Connection establishment timeout'),
  }).optional().describe('Connection pool settings'),

  // `readReplicas` was removed here (#4468) — see RETIRED_READ_REPLICAS. It
  // declared replica connections nothing opened; read/write splitting does not
  // exist in the platform, so there was no consumer for it to reach.

  /**
   * Capability Overrides
   * Manually override what the driver claims to support.
   */
  

  /** SSL/TLS Configuration */
  ssl: strictObject(
  {
    surface: "this datasource's ssl config",
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
  },
  {
    enabled: z.boolean().default(false).describe('Enable SSL/TLS for database connection'),
    rejectUnauthorized: z.boolean().default(true).describe('Reject connections with invalid/self-signed certificates'),
    ca: z.string().optional().describe('CA certificate (PEM format or path to file)'),
    cert: z.string().optional().describe('Client certificate (PEM format or path to file)'),
    key: z.string().optional().describe('Client private key (PEM format or path to file)'),
  }).optional().describe('SSL/TLS configuration for secure database connections'),

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
   * Required when `schemaMode !== 'managed'`. On a managed datasource the
   * block may carry `credentialsRef` — and only it — because the wizard's
   * `createDatasource` writes the secrets-store reference there whatever the
   * schema mode; every federation key is still refused on managed (#8153).
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

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // MISSING until the registered-type invariant test was written: `datasource`
  // closed strict in the #4001 data step without declaring it, so the
  // `_packageId` / `_provenance` that `MetadataPlugin` stamps on every
  // registered type were REJECTED here. Same live defect as `hook`, and the
  // same one `permission` hit as a 422 on the ADR-0094 overlay path before
  // Tier-A declared them (#4001 findings log, entries 2/8).
  ...MetadataProtectionFields,
}).superRefine((ds, ctx) => {
  // The `config` gate (#4410). `config` is parsed against the contract for the
  // declared driver and every issue is re-pathed under the slot it came from —
  // the author sees `config.hostname`, not a detached message.
  //
  // #4410 ran this over each `readReplicas` entry too. #4468 removed that along
  // with the key: validating entries for connections nothing opens spends the
  // author's trust on a slot that cannot pay it back.
  reportDriverConfigIssues(ctx, ds.driver, ds.config, ['config']);

  // #9041 — see CREDENTIALS_REF_MONGO_URL_NO_USER_REFUSED. This cannot live in
  // `MongoConfigSchema` (a config-level refinement sees only `config`;
  // `credentialsRef` sits on the datasource), so it runs here, where both
  // halves are visible at once. It composes independently with the config
  // gate above: a config also violating #8082/#8336/#9040 reports those
  // issues too, each at its own path.
  if (resolveDriverId(ds.driver) === 'mongodb' && ds.external?.credentialsRef) {
    const url = ds.config?.['url'];
    if (typeof url === 'string' && urlUserinfoUsername(url) === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'url'],
        message: CREDENTIALS_REF_MONGO_URL_NO_USER_REFUSED,
      });
    }
  }

  if (ds.schemaMode !== 'managed' && !ds.external) {
    ctx.addIssue({
      code: 'custom',
      path: ['external'],
      message: `schemaMode='${ds.schemaMode}' requires 'external' settings.`,
    });
  }
  if (ds.schemaMode === 'managed' && ds.external) {
    const federationKeys = managedFederationContentKeys(ds.external);
    if (federationKeys.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['external'],
        message: `'external' settings only apply when schemaMode != 'managed'. `
          + `A managed datasource may carry 'external.credentialsRef' (and only it) — `
          + `remove: ${federationKeys.join(', ')}.`,
      });
    }
  }
}));

/**
 * Parsed shape of an empty `external` block — every key a default. Lazily
 * computed so the module does not pay a parse at load time.
 */
let parsedEmptyExternal: ExternalDatasourceSettingsParsed | undefined;

/**
 * The federation keys a managed datasource's `external` block effectively
 * carries (#8153) — empty means the block is `credentialsRef` plus inert
 * defaults, which is the exact shape the Studio wizard's `createDatasource`
 * persists on managed rows (the secret goes to the secrets store; the row
 * keeps the reference).
 *
 * The comparison is against the parsed-empty baseline — VALUES, not key
 * presence — deliberately: this refinement runs post-parse, where defaults
 * are already applied, so a re-parsed stored row (or a `PUT /meta` round-trip
 * of served output) legitimately carries every default key. Refusing on key
 * presence would 422 the exact round-trip this allowance exists to keep
 * valid. An explicitly-written default is byte-equal to an applied one and
 * semantically inert either way; any non-default federation value — write
 * gating, schema whitelist, drift validation, query caps — still refuses.
 */
function managedFederationContentKeys(external: ExternalDatasourceSettingsParsed): string[] {
  const baseline = (parsedEmptyExternal ??= ExternalDatasourceSettingsSchema.parse({}));
  return Object.keys(external)
    .filter((key) => key !== 'credentialsRef')
    .filter((key) => !sameParsedValue(
      (external as Record<string, unknown>)[key],
      (baseline as Record<string, unknown>)[key],
    ))
    .sort();
}

/** Structural equality over parsed plain data (objects/arrays/primitives). */
function sameParsedValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, i) => sameParsedValue(value, b[i]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length
    && aKeys.every((key) => sameParsedValue(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ));
}

export type Datasource = z.input<typeof DatasourceSchema>;
/** Post-parse shape of {@link Datasource} — defaults applied, transforms run (ADR-0122). */
export type DatasourceParsed = z.infer<typeof DatasourceSchema>;

/**
 * Type-safe factory for an external data connection (datasource). Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Datasource` literal.
 */
export function defineDatasource(config: z.input<typeof DatasourceSchema>): DatasourceParsed {
  return DatasourceSchema.parse(config);
}
