// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MySQL / MariaDB driver configuration — the `config` slot of a `datasource`
 * whose `driver` resolves to `mysql` (`mysql2`).
 *
 * The driver id was offered by the connection form and buildable by the shared
 * factory long before #4410, but had no config shape at all in `packages/spec`
 * — postgres, mongo and memory each had one and mysql did not, so its `config`
 * was the one slot with neither a gate nor a documented shape.
 *
 * Every key here is read by `createDefaultDatasourceDriverFactory`
 * (→ `SqlDriver`, knex `mysql2`). Postgres-only knobs are deliberately absent:
 * `mysql2` has no `application_name` and no `statement_timeout`, so declaring
 * them would advertise settings the client drops.
 */

import { z } from 'zod';

import { lazySchema } from '../../shared/lazy-schema';
import { strictObject } from '../../shared/strict-object';
import {
  driverConfigJsonSchema,
  DriverSslToggleSchema,
  INLINE_CREDENTIAL_REFUSED,
  READ_ONLY_BELONGS_ON_DATASOURCE,
  refusedInlineCredentialKey,
  SCHEMA_MODE_BELONGS_ON_DATASOURCE,
  SqlAutoMigrateSchema,
  SSL_DETAIL_BELONGS_ON_DATASOURCE,
} from './common.zod';

export const MysqlConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this mysql datasource's config",
    aliases: {
      hostname: 'host',
      server: 'host',
      dbname: 'database',
      db: 'database',
      schema: 'database',
      user: 'username',
      connectionstring: 'url',
      dsn: 'url',
      uri: 'url',
      sslmode: 'ssl',
      tls: 'ssl',
      usessl: 'ssl',
    },
    guidance: {
      // #7990 — former aliases of the now-unwritable `password` key; the
      // refusal is carried directly (see postgres.zod.ts for the reasoning).
      passwd: INLINE_CREDENTIAL_REFUSED('passwd'),
      pwd: INLINE_CREDENTIAL_REFUSED('pwd'),
      pool:
        '`pool` is not driver config — connection pooling is configured once for every driver in '
        + "the datasource's own `pool` block. Move it next to `driver`.",
      schemaMode: SCHEMA_MODE_BELONGS_ON_DATASOURCE,
      readOnly: READ_ONLY_BELONGS_ON_DATASOURCE,
      ca: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      cert: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      key: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      rejectUnauthorized: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      charset:
        '`charset` is not honoured: the factory builds the mysql2 connection from the keys listed '
        + 'here only. Put it in the `url` as a query parameter (`?charset=utf8mb4`) so the client '
        + 'actually receives it.',
    },
    history:
      'Until #4410 nothing validated `datasource.config` at all — an unrecognised connection key '
      + 'was accepted in silence and the datasource then connected on the client defaults '
      + '(localhost:3306) rather than failing.',
  },
  {
  /**
   * Connection URI, passed to `mysql2` as-is when present.
   * Format: `mysql://[user[:password]@][host][:port]/[dbname][?params]`
   */
  url: z.string().optional().describe('Connection URI (supersedes the discrete fields)')
    .meta({ title: 'Connection URL' }),

  /** Hostname or IP address. */
  host: z.string().default('localhost').describe('Host address').meta({ title: 'Host' }),

  /** Port number. */
  port: z.number().int().default(3306).describe('Port number').meta({ title: 'Port' }),

  /** Database (schema) name. Required unless `url` carries it. */
  database: z.string().optional().describe('Database name').meta({ title: 'Database' }),

  /** Authentication user. Passed to `mysql2` as `user`. */
  username: z.string().optional().describe('Authentication user').meta({ title: 'User' }),

  /**
   * Authentication password — REFUSED inline since #7990 (see postgres.zod.ts:
   * declared-unwritable so `tsc`, the parse and the connection form's secret
   * input all stay wired to the secret binder / `external.credentialsRef`).
   */
  password: refusedInlineCredentialKey('password', 'Password'),

  /** TLS settings, passed to `mysql2` verbatim. */
  ssl: DriverSslToggleSchema.optional().meta({ title: 'Use SSL/TLS' }),

  /** Dev-only, loosen-only schema self-heal (#2186). */
  autoMigrate: SqlAutoMigrateSchema.optional(),
})
  .describe('MySQL / MariaDB connection configuration')
  .superRefine((cfg, ctx) => {
    if (!cfg.url && !cfg.database) {
      ctx.addIssue({
        code: 'custom',
        path: ['database'],
        message:
          'A mysql datasource needs a connection target: set `database` (with `host`/`port`) or '
          + 'a full `url`. Neither was given, so the connection would fall back to the client '
          + 'defaults and silently open a different database than the one intended.',
      });
    }
  }));

export type MysqlConfig = z.input<typeof MysqlConfigSchema>;
/** Post-parse shape of {@link MysqlConfig} — defaults applied, transforms run (ADR-0122). */
export type MysqlConfigParsed = z.infer<typeof MysqlConfigSchema>;

/** JSON-Schema projection of {@link MysqlConfigSchema}, memoized. */
export const getMysqlConfigJsonSchema = driverConfigJsonSchema(MysqlConfigSchema);
