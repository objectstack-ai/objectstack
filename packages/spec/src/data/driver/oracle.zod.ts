// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Oracle Database driver configuration — the `config` slot of a `datasource`
 * whose `driver` resolves to `oracle` (`oracledb`).
 *
 * Oracle is a FEDERATION-ONLY driver (ADR-0015 §4.6): the datasource must
 * declare `schemaMode: 'external'` (or `'validate-only'`), and a managed one is
 * refused at authoring. The platform reads the tables an Oracle system already
 * owns; it never creates or alters one there.
 *
 * Every key here is read by `createDefaultDatasourceDriverFactory`
 * (→ `SqlDriver`, knex `oracledb`, node-oracledb in Thin mode — pure
 * JavaScript, no Oracle Client libraries on the host). The connection is
 * opened from an Oracle connect string: either `connectString` verbatim, or
 * the Easy Connect string `host:port/serviceName` the factory composes from
 * the discrete keys. Oracle has no `scheme://` URL of its own, so there is no
 * `url` key to accept here.
 *
 * Deliberately absent, each because the factory would drop it:
 *  - `autoMigrate` — a managed-schema self-heal, and Oracle is never managed.
 *  - `ssl` (and `ca` / `cert` / `key` / `rejectUnauthorized`) — Thin mode
 *    negotiates TLS from the connect string itself
 *    (`tcps://host:2484/service`), not from a key beside it; the datasource
 *    `ssl` block is refused on an oracle datasource for the same reason.
 *  - `sid` — a SID names an instance, not a service; Thin mode reaches a
 *    SID-only listener through a full descriptor in `connectString`.
 */

import { z } from 'zod';

import { lazySchema } from '../../shared/lazy-schema';
import { strictObject } from '../../shared/strict-object';
import {
  driverConfigJsonSchema,
  INLINE_CREDENTIAL_REFUSED,
  placeholderFree,
  READ_ONLY_BELONGS_ON_DATASOURCE,
  refusedInlineCredentialKey,
  SCHEMA_MODE_BELONGS_ON_DATASOURCE,
} from './common.zod';

/**
 * Every TLS spelling an author might reach for in an oracle `config`. Thin-mode
 * node-oracledb takes TLS from the connect string and verifies the server
 * against the host's trusted certificate authorities; there is no toggle and no
 * certificate slot beside it — not in `config`, and not in the datasource
 * `ssl` block either (refused there too).
 */
const ORACLE_TLS_BY_CONNECT_STRING =
  'TLS to Oracle is chosen by the connect string, not by a key beside it: write '
  + "`connectString: 'tcps://host:2484/service_name'`. The server is verified against the host's trusted "
  + 'certificate authorities; there is no certificate or verification key to set here.';

/** The listener port an Oracle Database answers on unless configured otherwise. */
export const ORACLE_DEFAULT_PORT = 1521;

export const OracleConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this oracle datasource's config",
    aliases: {
      hostname: 'host',
      server: 'host',
      service: 'serviceName',
      service_name: 'serviceName',
      servicename: 'serviceName',
      database: 'serviceName',
      dbname: 'serviceName',
      connect_string: 'connectString',
      connectionstring: 'connectString',
      tns: 'connectString',
      dsn: 'connectString',
      user: 'username',
    },
    guidance: {
      passwd: INLINE_CREDENTIAL_REFUSED('passwd'),
      pwd: INLINE_CREDENTIAL_REFUSED('pwd'),
      pool:
        '`pool` is not driver config — connection pooling is configured once for every driver in '
        + "the datasource's own `pool` block. Move it next to `driver`.",
      schemaMode: SCHEMA_MODE_BELONGS_ON_DATASOURCE,
      readOnly: READ_ONLY_BELONGS_ON_DATASOURCE,
      url:
        'Oracle has no `scheme://` connection URL. Write the Oracle connect string as `connectString` '
        + '(Easy Connect `host:1521/service_name`, or a full `(DESCRIPTION=…)` descriptor), or give '
        + '`host`, `port` and `serviceName` and the connect string is composed from them.',
      sid:
        'A SID names an instance, not a service, and the Thin-mode client this driver uses connects '
        + 'to a service. Use the database service name as `serviceName`, or write a full descriptor '
        + 'with `(CONNECT_DATA=(SID=…))` as `connectString`.',
      ssl: ORACLE_TLS_BY_CONNECT_STRING,
      ca: ORACLE_TLS_BY_CONNECT_STRING,
      cert: ORACLE_TLS_BY_CONNECT_STRING,
      key: ORACLE_TLS_BY_CONNECT_STRING,
      rejectUnauthorized: ORACLE_TLS_BY_CONNECT_STRING,
      autoMigrate:
        '`autoMigrate` heals a schema the platform manages, and an Oracle datasource is federation-only: '
        + 'its tables belong to the Oracle system and are never altered from here. Remove the key.',
    },
    history:
      'Oracle joined the driver vocabulary as a federation-only dialect; the shape is closed from its first '
      + 'release, so an unrecognised key is refused rather than dropped.',
  },
  {
  /**
   * The Oracle connect string, handed to node-oracledb as `connectString`
   * verbatim: Easy Connect (`db.internal:1521/ORCLPDB1`,
   * `tcps://db.internal:2484/ORCLPDB1`) or a full `(DESCRIPTION=…)`
   * descriptor. Supersedes `host` / `port` / `serviceName`. Carries no
   * credential in either grammar; the password is the bound secret.
   * Placeholder-free: a `${…}` span is refused, since nothing resolves one.
   */
  connectString: placeholderFree(z.string().min(1), 'connectString').optional()
    .describe('Oracle connect string — Easy Connect or a full descriptor (supersedes host/port/serviceName)')
    .meta({ title: 'Connect string' }),

  /** Listener host. Composed into `host:port/serviceName` when `connectString` is absent. */
  host: placeholderFree(z.string().min(1), 'host').optional()
    .describe('Listener host address').meta({ title: 'Host' }),

  /** Listener port. */
  port: z.number().int().default(ORACLE_DEFAULT_PORT).describe('Listener port').meta({ title: 'Port' }),

  /** Database service name (a PDB's service on 12c and later, e.g. `ORCLPDB1` / `FREEPDB1`). */
  serviceName: placeholderFree(z.string().min(1), 'serviceName').optional()
    .describe('Database service name').meta({ title: 'Service name' }),

  /**
   * Authentication user. Passed to node-oracledb as `user`. In Oracle a user
   * is also a schema: an unqualified table name resolves in this user's own
   * schema, and another owner's table is reached as `OWNER.TABLE`.
   */
  username: placeholderFree(z.string().min(1), 'username').optional()
    .describe('Authentication user (also the default schema)').meta({ title: 'User' }),

  /** Authentication password — refused inline; bind the secret instead. */
  password: refusedInlineCredentialKey('password', 'Password'),
})
  .describe('Oracle Database connection configuration (federation only)')
  .superRefine((cfg, ctx) => {
    if (cfg.connectString) return;
    const missing = [
      ...(cfg.host ? [] : ['host']),
      ...(cfg.serviceName ? [] : ['serviceName']),
    ];
    if (missing.length === 0) return;
    ctx.addIssue({
      code: 'custom',
      path: [missing[0]!],
      message:
        'An oracle datasource needs a connection target: set `connectString`, or both `host` and '
        + `\`serviceName\` (missing: ${missing.map((k) => `\`${k}\``).join(', ')}). Oracle has no `
        + 'local default to fall back on, and a guessed one would open a database nobody named.',
    });
  }));

export type OracleConfig = z.input<typeof OracleConfigSchema>;
/** Post-parse shape of {@link OracleConfig} — defaults applied, transforms run (ADR-0122). */
export type OracleConfigParsed = z.infer<typeof OracleConfigSchema>;

/** JSON-Schema projection of {@link OracleConfigSchema}, memoized. */
export const getOracleConfigJsonSchema = driverConfigJsonSchema(OracleConfigSchema);
