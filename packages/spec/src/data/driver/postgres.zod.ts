// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PostgreSQL driver configuration — the `config` slot of a `datasource` whose
 * `driver` resolves to `postgres` (`pg` / `postgresql`).
 *
 * ENFORCED as of #4410: `DatasourceSchema` parses `config` against this schema,
 * so a misspelled connection key fails at authoring time instead of leaving the
 * datasource on the client's localhost defaults. Every key here is read by
 * `createDefaultDatasourceDriverFactory` (→ `SqlDriver`, knex `pg`).
 *
 * Pool sizing is NOT here: it lives in the driver-agnostic `datasource.pool`
 * block, which the factory now honours for every SQL driver.
 */

import { z } from 'zod';

import { lazySchema } from '../../shared/lazy-schema';
import { strictObject } from '../../shared/strict-object';
import {
  driverConfigJsonSchema,
  DriverSslToggleSchema,
  READ_ONLY_BELONGS_ON_DATASOURCE,
  SCHEMA_MODE_BELONGS_ON_DATASOURCE,
  SqlAutoMigrateSchema,
  SSL_DETAIL_BELONGS_ON_DATASOURCE,
} from './common.zod';

/** Prescription for a pool knob written inside `config` instead of `pool`. */
const poolBelongsOnDatasource = (key: string, canonical: string) =>
  `\`${key}\` is not driver config — connection pooling is configured once for every driver in `
  + `the datasource's own \`pool\` block. Move it to \`pool: { ${canonical}: … }\`. `
  + `(It was declared here and read by nothing until #4410.)`;

export const PostgresConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this postgres datasource's config",
    aliases: {
      hostname: 'host',
      server: 'host',
      dbname: 'database',
      db: 'database',
      user: 'username',
      passwd: 'password',
      pwd: 'password',
      connectionstring: 'url',
      dsn: 'url',
      uri: 'url',
      searchpath: 'schema',
      applicationname: 'applicationName',
      statementtimeout: 'statementTimeout',
      sslmode: 'ssl',
      tls: 'ssl',
      usessl: 'ssl',
    },
    guidance: {
      pool: poolBelongsOnDatasource('pool', 'max'),
      min: poolBelongsOnDatasource('min', 'min'),
      max: poolBelongsOnDatasource('max', 'max'),
      idleTimeoutMillis: poolBelongsOnDatasource('idleTimeoutMillis', 'idleTimeoutMillis'),
      connectionTimeoutMillis: poolBelongsOnDatasource(
        'connectionTimeoutMillis',
        'connectionTimeoutMillis',
      ),
      schemaMode: SCHEMA_MODE_BELONGS_ON_DATASOURCE,
      readOnly: READ_ONLY_BELONGS_ON_DATASOURCE,
      ca: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      cert: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      key: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      rejectUnauthorized: SSL_DETAIL_BELONGS_ON_DATASOURCE,
    },
    history:
      'Until #4410 nothing validated `datasource.config` at all — an unrecognised connection key '
      + 'was accepted in silence and the datasource then connected on the client defaults '
      + "(localhost:5432), which is #4001's original bug one level down.",
  },
  {
  /**
   * Connection URI. When present it supersedes `host`/`port`/`database`/
   * `username`, and a datasource secret (`external.credentialsRef`) still
   * overrides any password embedded in it.
   * Format: `postgresql://[user[:password]@][host][:port][/dbname][?params]`
   */
  url: z.string().optional().describe('Connection URI (supersedes the discrete fields)')
    .meta({ title: 'Connection URL' }),

  /** Hostname or IP address. */
  host: z.string().default('localhost').describe('Host address').meta({ title: 'Host' }),

  /** Port number. */
  port: z.number().int().default(5432).describe('Port number').meta({ title: 'Port' }),

  /** Database name. Required unless `url` carries it. */
  database: z.string().optional().describe('Database name').meta({ title: 'Database' }),

  /** Authentication user. Passed to `pg` as `user`. */
  username: z.string().optional().describe('Authentication user').meta({ title: 'User' }),

  /**
   * Authentication password. Prefer `external.credentialsRef` — a secret-store
   * reference — or an environment placeholder; a datasource secret always wins
   * over this value.
   */
  password: z.string().optional()
    .describe('Authentication password (prefer external.credentialsRef)')
    .meta({ title: 'Password', format: 'password' }),

  /** TLS settings, passed to `pg` verbatim. */
  ssl: DriverSslToggleSchema.optional().meta({ title: 'Use SSL/TLS' }),

  /** Default schema for tables that do not name one — knex `searchPath`. */
  schema: z.string().default('public').describe('Default schema (knex searchPath)')
    .meta({ title: 'Schema' }),

  /** `application_name` on the connection — how this stack shows up in `pg_stat_activity`. */
  applicationName: z.string().optional().describe('Postgres application_name')
    .meta({ title: 'Application name' }),

  /** `statement_timeout` in milliseconds — aborts any statement that runs longer. */
  statementTimeout: z.number().int().positive().optional()
    .describe('Abort statements running longer than this (ms)')
    .meta({ title: 'Statement timeout (ms)' }),

  /** Dev-only, loosen-only schema self-heal (#2186). */
  autoMigrate: SqlAutoMigrateSchema.optional(),
})
  .describe('PostgreSQL connection configuration')
  .superRefine((cfg, ctx) => {
    if (!cfg.url && !cfg.database) {
      ctx.addIssue({
        code: 'custom',
        path: ['database'],
        message:
          'A postgres datasource needs a connection target: set `database` (with `host`/`port`) '
          + 'or a full `url`. Neither was given, so the connection would fall back to the client '
          + 'defaults and silently open a different database than the one intended.',
      });
    }
  }));

export type PostgresConfig = z.input<typeof PostgresConfigSchema>;
/** Post-parse shape of {@link PostgresConfig} — defaults applied, transforms run (ADR-0122). */
export type PostgresConfigParsed = z.infer<typeof PostgresConfigSchema>;

/** JSON-Schema projection of {@link PostgresConfigSchema}, memoized. */
export const getPostgresConfigJsonSchema = driverConfigJsonSchema(PostgresConfigSchema);
