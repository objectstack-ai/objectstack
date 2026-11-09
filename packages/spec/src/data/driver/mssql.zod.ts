// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Microsoft SQL Server driver configuration — the `config` slot of a
 * `datasource` whose `driver` resolves to `mssql` (`sqlserver` / `tedious`).
 *
 * FEDERATION ONLY. SQL Server is served by `@objectstack/driver-sql` over
 * knex's `mssql` client (the `tedious` binding) for an ADR-0015 external
 * datasource — `schemaMode: 'external'` or `'validate-only'` — whose tables
 * already exist and are read (and, with `external.allowWrites`, written) in
 * place. The platform does not build its own schema on SQL Server, so a
 * `managed` datasource declaring this driver is refused at parse
 * (`DriverVocabularyEntry.federationOnly`), and no boot host offers it as the
 * platform database. The usual reason to point a datasource here is an older
 * line-of-business system (an ERP, a MES, a HIS) whose database is federated
 * in place rather than migrated.
 *
 * Every key here is read by `createDefaultDatasourceDriverFactory`
 * (→ `SqlDriver`, knex `mssql`). There is no `url`: `tedious` reads no
 * connection-string grammar, so a URL key would have to be parsed by a second
 * grammar the client never sees — the discrete fields are the shape it takes.
 * There is no `autoMigrate` either: it governs DDL the platform emits, and on
 * SQL Server it emits none.
 */

import { z } from 'zod';

import { lazySchema } from '../../shared/lazy-schema';
import { strictObject } from '../../shared/strict-object';
import {
  driverConfigJsonSchema,
  DriverSslToggleSchema,
  INLINE_CREDENTIAL_REFUSED,
  placeholderFree,
  READ_ONLY_BELONGS_ON_DATASOURCE,
  refusedInlineCredentialKey,
  SCHEMA_MODE_BELONGS_ON_DATASOURCE,
  SSL_DETAIL_BELONGS_ON_DATASOURCE,
} from './common.zod';

/** Why a connection-string key is refused on this driver rather than parsed. */
const MSSQL_URL_REFUSED =
  'SQL Server takes no connection URL here: the `tedious` client the driver connects through reads no '
  + 'connection-string grammar, so the platform would have to parse one the client never sees. Write the '
  + 'discrete fields instead — `host`, `port`, `database`, `username` (and `instanceName` for a named '
  + 'instance) — and bind the password through the connection form or `external.credentialsRef`.';

export const MssqlConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this mssql datasource's config",
    aliases: {
      hostname: 'host',
      server: 'host',
      dbname: 'database',
      db: 'database',
      initialcatalog: 'database',
      catalog: 'database',
      user: 'username',
      userid: 'username',
      uid: 'username',
      instance: 'instanceName',
      instancename: 'instanceName',
      encrypt: 'ssl',
      sslmode: 'ssl',
      tls: 'ssl',
    },
    guidance: {
      passwd: INLINE_CREDENTIAL_REFUSED('passwd'),
      pwd: INLINE_CREDENTIAL_REFUSED('pwd'),
      url: MSSQL_URL_REFUSED,
      connectionString: MSSQL_URL_REFUSED,
      dsn: MSSQL_URL_REFUSED,
      uri: MSSQL_URL_REFUSED,
      pool:
        '`pool` is not driver config — connection pooling is configured once for every driver in '
        + "the datasource's own `pool` block. Move it next to `driver`.",
      schemaMode: SCHEMA_MODE_BELONGS_ON_DATASOURCE,
      readOnly: READ_ONLY_BELONGS_ON_DATASOURCE,
      ca: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      cert: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      key: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      rejectUnauthorized: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      trustServerCertificate: SSL_DETAIL_BELONGS_ON_DATASOURCE,
      autoMigrate:
        '`autoMigrate` governs schema DDL the platform emits, and on SQL Server it emits none: the '
        + 'driver is federation-only, so the remote schema stays the remote system\'s to change. Remove it.',
      options:
        '`options` is not a passthrough on this driver: the factory builds the tedious connection from '
        + 'the keys listed here only, so anything written under `options` would never reach the client.',
    },
    history:
      'SQL Server joined the built-in driver vocabulary as a federation-only dialect; this shape is closed '
      + 'from its first day, so an unrecognised connection key is refused at publish instead of being '
      + 'dropped on the way to the client.',
  },
  {
  /** Hostname or IP address of the SQL Server. Placeholder-free (as on every driver). */
  host: placeholderFree(z.string(), 'host')
    .describe('Host address').meta({ title: 'Host' }),

  /** TCP port. Ignored by the client when `instanceName` is set (the SQL Browser service resolves it). */
  port: z.number().int().default(1433).describe('Port number').meta({ title: 'Port' }),

  /**
   * Named instance (`SQLEXPRESS`, `PROD01`), resolved through the SQL Server
   * Browser service. Leave unset for the default instance.
   */
  instanceName: placeholderFree(z.string(), 'instanceName').optional()
    .describe('Named instance, resolved through the SQL Server Browser service (leave unset for the default instance)')
    .meta({ title: 'Instance name' }),

  /** Database (catalog) name. Required — the federation target. */
  database: placeholderFree(z.string(), 'database')
    .describe('Database name').meta({ title: 'Database' }),

  /** SQL authentication login. Passed to `tedious` as `userName`. */
  username: placeholderFree(z.string(), 'username').optional()
    .describe('SQL authentication login').meta({ title: 'User' }),

  /**
   * Authentication password — REFUSED inline (see postgres.zod.ts:
   * declared-unwritable so the parse and the connection form's secret input
   * stay wired to the secret binder / `external.credentialsRef`).
   */
  password: refusedInlineCredentialKey('password', 'Password'),

  /**
   * TLS on/off — `tedious`'s `encrypt`. Azure SQL requires it; an on-premises
   * server usually accepts both. Certificate verification lives in the
   * datasource-level `ssl` block: `ssl: { enabled: true, rejectUnauthorized: false }`
   * is how a server with a self-signed certificate is trusted. The block's
   * `enabled` defaults to `false`, and a block that leaves it out turns
   * encryption off, so it is spelled out.
   */
  ssl: DriverSslToggleSchema.optional().meta({ title: 'Encrypt (TLS)' }),
})
  .describe('Microsoft SQL Server connection configuration (federation only)'));

export type MssqlConfig = z.input<typeof MssqlConfigSchema>;
/** Post-parse shape of {@link MssqlConfig} — defaults applied, transforms run (ADR-0122). */
export type MssqlConfigParsed = z.infer<typeof MssqlConfigSchema>;

/** JSON-Schema projection of {@link MssqlConfigSchema}, memoized. */
export const getMssqlConfigJsonSchema = driverConfigJsonSchema(MssqlConfigSchema);
