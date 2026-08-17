// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { lazySchema } from '../../shared/lazy-schema';
import { strictObject } from '../../shared/strict-object';
import type { DriverDefinition } from '../datasource.zod';
import {
  credentialFreeMongoOptions,
  credentialFreeUrl,
  driverConfigJsonSchema,
  INLINE_CREDENTIAL_REFUSED,
  placeholderFree,
  placeholderFreeDeep,
  READ_ONLY_BELONGS_ON_DATASOURCE,
  refusedInlineCredentialKey,
  SCHEMA_MODE_BELONGS_ON_DATASOURCE,
} from './common.zod';

/**
 * MongoDB Standard Driver Protocol
 *
 * Describes the MongoDB connection settings and capabilities.
 *
 * ENFORCED as of #4410. This block used to claim it was "used by the Platform
 * to validate `datasource.config` when `driver: 'mongo'`", which was false: the
 * config slot was a bare `z.record` and this schema had no consumer at all —
 * not even an export, since `data/driver/` was reachable only from its own
 * tests. It is now what `DatasourceSchema` parses `config` against for a mongo
 * datasource, and the same schema is projected onto
 * {@link MongoDriverSpec}.configSchema for the connection form.
 */

// ==========================================================================
// 1. Connection Configuration
// ==========================================================================

export const MongoConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this mongo datasource's config",
    aliases: {
      uri: 'url',
      connectionstring: 'url',
      dsn: 'url',
      hostname: 'host',
      server: 'host',
      dbname: 'database',
      db: 'database',
      user: 'username',
      authdb: 'authSource',
      authdatabase: 'authSource',
      replicaset: 'options',
    },
    guidance: {
      // #7990 — former aliases of the now-unwritable `password` key; the
      // refusal is carried directly (see postgres.zod.ts for the reasoning).
      passwd: INLINE_CREDENTIAL_REFUSED('passwd'),
      pwd: INLINE_CREDENTIAL_REFUSED('pwd'),
      pool:
        '`pool` is not driver config — connection pooling is configured once for every driver in '
        + "the datasource's own `pool` block, which the factory maps onto the Mongo client's "
        + '`minPoolSize`/`maxPoolSize`. Move it next to `driver`.',
      schemaMode: SCHEMA_MODE_BELONGS_ON_DATASOURCE,
      readOnly: READ_ONLY_BELONGS_ON_DATASOURCE,
      ssl:
        '`ssl` is not a top-level mongo key. TLS is a connection-string concern here: put it in '
        + '`url` (`?tls=true`) or in the `options` passthrough the Mongo client reads.',
    },
    history:
      'Until #4410 nothing validated `datasource.config` at all — an unrecognised connection key '
      + 'was accepted in silence and the datasource then connected to mongodb://localhost:27017 '
      + 'rather than failing.',
  },
  {
  /**
   * Connection URI (standard connection string). When present it supersedes
   * `host`/`port`/`database`/`username`/`authSource` — those are only used to
   * COMPOSE a URI when none is given. Credential-free by contract since #8082:
   * a `username:password@` userinfo is refused at publish exactly like an
   * inline `password` (#7990) — bind the secret (`external.credentialsRef` /
   * the connection form's secret field) and it is injected at connect time. A
   * bare username (`user@host1`) stays writable. Placeholder-free since
   * #8336: a `${…}` span anywhere in the value is refused — placeholders in
   * authored metadata are resolved by nothing. Runtime-environment DSNs
   * (`OS_DATABASE_URL`) never pass through this schema and are unaffected.
   * Format: `mongodb://[username@]host1[:port1][,…][/[db][?options]]`
   */
  url: placeholderFree(credentialFreeUrl(z.string(), 'url'), 'url').optional()
    .describe('Connection URI (supersedes the discrete fields; must not embed a password — bind the secret instead)')
    .meta({ title: 'Connection URI' }),

  /**
   * Database name — the logical database holding the collections.
   * Required unless `url` carries it. Placeholder-free since #8336.
   */
  database: placeholderFree(z.string().min(1), 'database').optional()
    .describe('Database name').meta({ title: 'Database' }),

  /** Hostname. Used only when `url` is absent. Placeholder-free since #8336. */
  host: placeholderFree(z.string(), 'host').default('localhost')
    .describe('Host address').meta({ title: 'Host' }),

  /** Port. Used only when `url` is absent. */
  port: z.number().int().default(27017).describe('Port number').meta({ title: 'Port' }),

  /** Authentication user. Used only when `url` is absent. Placeholder-free since #8336. */
  username: placeholderFree(z.string(), 'username').optional()
    .describe('Authentication user').meta({ title: 'User' }),

  /**
   * Authentication password — REFUSED inline since #7990 (see postgres.zod.ts:
   * declared-unwritable so `tsc`, the parse and the connection form's secret
   * input all stay wired to the secret binder / `external.credentialsRef`).
   */
  password: refusedInlineCredentialKey('password', 'Password'),

  /** Authentication database, when it differs from `database`. Placeholder-free since #8336. */
  authSource: placeholderFree(z.string(), 'authSource').optional()
    .describe('Authentication database')
    .meta({ title: 'Auth source' }),

  /**
   * Passthrough options handed to the MongoDB client verbatim
   * (`replicaSet`, `tls`, timeouts, …). Placeholder-free since #8336, judged
   * DEEP: every nested string value reaches the client, and this passthrough
   * is exactly where a refusal on `url`/`host` would otherwise displace the
   * placeholder to. Credential-free since #9040 — `auth.password` was the
   * FOURTH spelling of the inline secret (after the top-level key #7990, URL
   * userinfo #8082 and URL query params #8337): the client resolves the block
   * into `MongoCredentials`, so a passthrough password authenticated for real
   * while sitting cleartext in `sys_metadata`. A non-empty `auth.password` is
   * refused with the binder prescription; `auth.username` stays writable
   * (#8876's asymmetry — a username is not credential material).
   */
  options: credentialFreeMongoOptions(
    placeholderFreeDeep(z.record(z.string(), z.unknown()), 'options'),
    'options',
  ).optional()
    .describe('Extra MongoClient options (replicaSet, tls, timeouts, …). Only `auth.password` is refused inline — bind it via the connection form / external.credentialsRef. `proxyPassword`, `tlsCertificateKeyFilePassword`, `key`, and `passphrase` are accepted and stored at rest in cleartext; they\'re redacted only when the datasource is read back, not refused at write.'),
})
  .describe('MongoDB Connection Configuration')
  .superRefine((cfg, ctx) => {
    if (!cfg.url && !cfg.database) {
      ctx.addIssue({
        code: 'custom',
        path: ['database'],
        message:
          'A mongo datasource needs a connection target: set `database` (with `host`/`port`) or '
          + 'a full `url`. Neither was given, so the connection would fall back to '
          + 'mongodb://localhost:27017 with no database selected.',
      });
    }
  }));

/**
 * JSON-Schema projection of {@link MongoConfigSchema}, memoized — what
 * {@link MongoDriverSpec} publishes as its `configSchema`.
 */
export const getMongoConfigJsonSchema = driverConfigJsonSchema(MongoConfigSchema);

// ==========================================================================
// 2. Driver Definition (Metadata)
// ==========================================================================

/**
 * The static definition of the Mongo driver's default metadata, satisfying the `DriverDefinitionSchema` contract (proved by
 * `mongo.test.ts`, which parses this constant).
 *
 * `configSchema` is a getter so the JSON-Schema projection is computed on first
 * read rather than at module load — the same deferral `lazySchema` exists for,
 * and what lets this constant drop its runtime import of `DatasourceSchema`'s
 * module (a `.parse()` at module scope would have made the config registry and
 * this file a cycle). It used to be `{}` with a comment promising it would be
 * "populated with a JSON Schema version of MongoConfigSchema at runtime"; no
 * such code ever existed (#4410), so the promise is discharged here rather than
 * described.
 */
export const MongoDriverSpec = {
  // `mongodb`, not `mongo`, since #6345: the canonical driver id was renamed to
  // the spelling both boot hosts, the `@objectstack/driver-mongodb` package and
  // every URL scheme already used, so driver selection and config-contract
  // selection are one string. `mongo` remains an accepted alias.
  id: 'mongodb',
  label: 'MongoDB',
  description: 'Official MongoDB Driver for ObjectStack. Supports rich queries, aggregation, and atomic updates.',
  icon: 'database',
  get configSchema() {
    return getMongoConfigJsonSchema();
  },
} satisfies DriverDefinition;

/**
 * Derived Types
 */
export type MongoConfig = z.input<typeof MongoConfigSchema>;
/** Post-parse shape of {@link MongoConfig} — defaults applied, transforms run (ADR-0122). */
export type MongoConfigParsed = z.infer<typeof MongoConfigSchema>;
