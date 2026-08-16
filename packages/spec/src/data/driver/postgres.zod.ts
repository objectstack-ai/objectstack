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

import { parse as parsePostgresUrl } from 'pg-connection-string';
import { z } from 'zod';

import { lazySchema } from '../../shared/lazy-schema';
import { strictObject } from '../../shared/strict-object';
import {
  CREDENTIAL_URL_QUERY_PARAMS,
  credentialFreeUrl,
  driverConfigJsonSchema,
  DriverSslToggleSchema,
  INLINE_CREDENTIAL_REFUSED,
  placeholderFree,
  READ_ONLY_BELONGS_ON_DATASOURCE,
  refusedInlineCredentialKey,
  SCHEMA_MODE_BELONGS_ON_DATASOURCE,
  SqlAutoMigrateSchema,
  SSL_DETAIL_BELONGS_ON_DATASOURCE,
} from './common.zod';

/**
 * Refusal prescription for a `url` that `pg` itself cannot parse (#9091).
 *
 * The gap this closes: the describe text below documents a grammar
 * (`postgresql://[user@][host][:port][/dbname][?params]`) that nothing
 * enforced. The shared `credentialFreeUrl` / `placeholderFree` checks are
 * string-boundary scans by design — their refusal to parse is load-bearing
 * for mongo's multi-host and `+srv` forms (#8696), so the parse question is
 * asked HERE, per-driver, of the postgres client's own grammar: `parse` from
 * `pg-connection-string@2.14.0`, the parser `pg@8.22.0` itself runs a
 * connection string through (`ConnectionParameters`). What that parser
 * throws on (measured: libpq's multi-host `h1:5432,h2:5433` form —
 * `ERR_INVALID_URL`; a non-numeric port; a malformed percent-escape) used to
 * parse green at publish and then fail at connect with a bare `Invalid URL`
 * whose own `input` field `pg` redacts — an error naming neither the value
 * nor the datasource. Same posture as #8873's runtime arm: ask `pg`'s
 * grammar, never re-model it.
 */
const PG_UNPARSEABLE_URL_REFUSED = (key: string, detail: string): string =>
  `this \`${key}\` is not a connection URL \`pg\` can open — \`pg-connection-string\` (the `
  + `parser \`pg\` itself uses) refuses it: ${detail}. The datasource would publish green and `
  + 'then fail at connect time with an error that names neither the value nor the datasource. '
  + 'Expected format: `postgresql://[user@][host][:port][/dbname][?params]`. Note that `pg` '
  + "does not implement libpq's multi-host form (`host1:port1,host2:port2`) — a multi-host "
  + 'DSN fails exactly this way; point the URL at a single host (or a proxy in front of the '
  + 'cluster) instead. Runtime-environment DSNs (`OS_DATABASE_URL` and friends) do not pass '
  + 'through this publish door and are unaffected.';

/**
 * Refusal for a value `pg` "parses" only by resolving it against its
 * placeholder base URL (#9091 — the structurally-unusable half).
 *
 * `pg-connection-string` parses via `new URL(str, 'postgres://base')`, so a
 * value that is not an absolute URL at all (`not a url`, a libpq
 * keyword/value string like `host=x dbname=y`) does not throw — it resolves
 * RELATIVE to the base, and the client then connects to the literal host
 * `base` with the whole authored value as the database name. That is a
 * "successful" parse of a configuration the author never wrote, so it is
 * refused as unusable rather than accepted as what `pg` happens to do.
 */
const PG_RELATIVE_URL_REFUSED = (key: string): string =>
  `this \`${key}\` is not a URL: it has no scheme, so \`pg\` would parse it only by resolving `
  + 'it against an internal placeholder base and then connect to the literal host `base` — a '
  + 'host that was never named — with the authored text as the database name. Write a real '
  + 'connection URL: `postgresql://[user@][host][:port][/dbname][?params]` (a unix-socket '
  + 'path starting with `/` is also accepted). Runtime-environment DSNs (`OS_DATABASE_URL` '
  + 'and friends) do not pass through this publish door and are unaffected.';

/**
 * Refusal for the query parameters that make `pg`'s parser READ THE LOCAL
 * FILESYSTEM (#9091): `?sslcert=` / `?sslkey=` / `?sslrootcert=` are file
 * PATHS that `pg-connection-string` opens with `fs.readFileSync` during
 * `parse` itself. Publish-time validation must not read the validating
 * server's filesystem (the verdict would depend on which machine validates,
 * and the parse would become a file-existence oracle), and certificate
 * material already has a declared home this schema names for the config-level
 * `ca`/`cert`/`key` keys: the datasource-level `ssl` block. Same prescription,
 * one syntax over.
 */
const PG_FS_QUERY_PARAM_REFUSED = (key: string, param: string): string =>
  `this \`${key}\` carries \`?${param}=\` in its query string — a file path that \`pg\` reads `
  + 'from the local filesystem while parsing the URL, so it cannot be judged (or safely '
  + 'parsed) at publish: whether the file exists is a fact about the connect-time host, not '
  + `about the datasource. ${SSL_DETAIL_BELONGS_ON_DATASOURCE}`;

/**
 * The query parameters `pg-connection-string@2.14.0`'s `parse` resolves into
 * `fs.readFileSync` calls (measured — see {@link PG_FS_QUERY_PARAM_REFUSED}).
 * Matched EXACT-CASE on the percent-decoded key, mirroring the parser's own
 * `config.sslcert` property reads off WHATWG `URLSearchParams` (measured:
 * `?SSLCERT=` is copied into the config and read by nothing — no fs touch, no
 * refusal), and only with a non-empty value (an empty value is falsy at the
 * parser's `if (config.sslcert)` guard — no fs touch either).
 */
const PG_FS_QUERY_PARAMS: readonly string[] = ['sslcert', 'sslkey', 'sslrootcert'];

/** The {@link PG_FS_QUERY_PARAMS} an authored URL-ish string carries with a non-empty value. */
function pgFileReadingQueryParams(value: string): string[] {
  const hashIdx = value.indexOf('#');
  const head = hashIdx === -1 ? value : value.slice(0, hashIdx);
  const queryIdx = head.indexOf('?');
  if (queryIdx === -1) return [];
  const found: string[] = [];
  for (const pair of head.slice(queryIdx + 1).split('&')) {
    const splitIdx = pair.indexOf('=');
    if (splitIdx < 0 || splitIdx === pair.length - 1) continue;
    let key = pair.slice(0, splitIdx).replace(/\+/g, ' ');
    try {
      key = decodeURIComponent(key);
    } catch {
      // A malformed escape cannot spell a declared name once decoding fails
      // (and `parse` itself throws on it before reaching the fs branch).
    }
    const match = PG_FS_QUERY_PARAMS.find((param) => param === key);
    if (match !== undefined && !found.includes(match)) found.push(match);
  }
  return found;
}

/** Can WHATWG `URL` parse this string as an ABSOLUTE URL (no base)? */
function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Did `parse` succeed only by resolving the value against its placeholder
 * base? Mirrors the parser's own preprocessing (space/percent re-encoding,
 * then the `@/` → `@___DUMMY___/` empty-host retry — the retry form,
 * `postgresql://user@/db`, is libpq's real empty-host-with-userinfo spelling
 * and stays accepted) so the two cannot disagree about which branch ran.
 */
function pgParsedRelativeToBase(value: string): boolean {
  const str = / |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(value)
    ? encodeURI(value).replace(/%25(\d\d)/g, '%$1')
    : value;
  return !isAbsoluteUrl(str) && !isAbsoluteUrl(str.replace('@/', '@___DUMMY___/'));
}

/**
 * Attach the #9091 pg-grammar refusal to the postgres `url` key — per-driver
 * by design (see {@link PG_UNPARSEABLE_URL_REFUSED}; the shared helpers must
 * keep refusing to parse for mongo's sake, #8696). Composes with
 * `credentialFreeUrl` (#8082/#8337) and `placeholderFree` (#8336) the same
 * way those compose with each other: independent `superRefine`s judging one
 * value, each reporting its own finding.
 */
function pgParseableUrl<S extends z.ZodString>(schema: S, key: string) {
  return schema.superRefine((value, ctx) => {
    if (typeof value !== 'string') return;
    // A leading `/` is the unix-socket path form: `parse` short-circuits on
    // it before any URL or query handling and cannot refuse it.
    if (value.startsWith('/')) return;
    // Refused BEFORE `parse` so the fs-reading branch is never reached here.
    const fsParams = pgFileReadingQueryParams(value);
    if (fsParams.length > 0) {
      for (const param of fsParams) {
        ctx.addIssue({ code: 'custom', message: PG_FS_QUERY_PARAM_REFUSED(key, param) });
      }
      return;
    }
    try {
      parsePostgresUrl(value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      ctx.addIssue({ code: 'custom', message: PG_UNPARSEABLE_URL_REFUSED(key, detail) });
      return;
    }
    if (pgParsedRelativeToBase(value)) {
      ctx.addIssue({ code: 'custom', message: PG_RELATIVE_URL_REFUSED(key) });
    }
  });
}

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
      // #7990 — former ALIASES of `password` (`passwd:`/`pwd:` used to rename
      // onto it). Now that the key itself is unwritable they carry the refusal
      // directly: an alias row pointing at a tombstoned key would send the
      // author into a second rejection (`strict-object.ts`'s `triggerPhrase`
      // lesson).
      passwd: INLINE_CREDENTIAL_REFUSED('passwd'),
      pwd: INLINE_CREDENTIAL_REFUSED('pwd'),
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
   * `username`. Credential-free by contract since #8082: a `user:password@`
   * userinfo is refused at publish exactly like an inline `password` (#7990) —
   * bind the secret (`external.credentialsRef` / the connection form's secret
   * field) and it is injected at connect time. A bare username (`user@host`)
   * stays writable. Since #8337 the same closure covers the query string:
   * `pg-connection-string` copies every query parameter into the client
   * config, so `?password=` is honoured (it even wins over userinfo —
   * measured; see `CREDENTIAL_URL_QUERY_PARAMS` in common.zod.ts) and is
   * refused the same way; non-credential parameters (`?sslmode=` and
   * friends) stay writable, except the fs-reading trio (`?sslcert=` /
   * `?sslkey=` / `?sslrootcert=`) — refused since #9091, certificate
   * material lives in the datasource-level `ssl` block. Placeholder-free since #8336: a `${…}` span anywhere in
   * the value is refused — placeholders in authored metadata are resolved by
   * nothing. Runtime-environment DSNs (`OS_DATABASE_URL`) never pass
   * through this schema and are unaffected.
   * Since #9091 the documented format is ENFORCED by asking `pg`'s own
   * parser (`pg-connection-string`): a URL `pg` cannot parse — libpq's
   * multi-host form, a non-numeric port, a scheme-less non-URL — is refused
   * at publish instead of exploding at connect with a redacted `Invalid URL`.
   * Format: `postgresql://[user@][host][:port][/dbname][?params]`
   */
  url: pgParseableUrl(
    placeholderFree(
      credentialFreeUrl(z.string(), 'url', CREDENTIAL_URL_QUERY_PARAMS.postgres),
      'url',
    ),
    'url',
  ).optional()
    .describe('Connection URI (supersedes the discrete fields; must be a URL `pg` can parse; must not embed a password — bind the secret instead)')
    .meta({ title: 'Connection URL' }),

  /** Hostname or IP address. Placeholder-free since #8336. */
  host: placeholderFree(z.string(), 'host').default('localhost')
    .describe('Host address').meta({ title: 'Host' }),

  /** Port number. */
  port: z.number().int().default(5432).describe('Port number').meta({ title: 'Port' }),

  /** Database name. Required unless `url` carries it. Placeholder-free since #8336. */
  database: placeholderFree(z.string(), 'database').optional()
    .describe('Database name').meta({ title: 'Database' }),

  /** Authentication user. Passed to `pg` as `user`. Placeholder-free since #8336. */
  username: placeholderFree(z.string(), 'username').optional()
    .describe('Authentication user').meta({ title: 'User' }),

  /**
   * Authentication password — REFUSED inline since #7990. Declared-unwritable
   * (`z.never()`) rather than deleted so the removal is audible in `tsc` and
   * in the parse, and so the `format: 'password'` projection keeps rendering
   * the connection form's secret input (which routes to the secret binder —
   * the mechanism the refusal diverts to). The resolved
   * `external.credentialsRef` secret is injected at connect time.
   */
  password: refusedInlineCredentialKey('password', 'Password'),

  /** TLS settings, passed to `pg` verbatim. */
  ssl: DriverSslToggleSchema.optional().meta({ title: 'Use SSL/TLS' }),

  /** Default schema for tables that do not name one — knex `searchPath`. Placeholder-free since #8336. */
  schema: placeholderFree(z.string(), 'schema').default('public')
    .describe('Default schema (knex searchPath)')
    .meta({ title: 'Schema' }),

  /**
   * `application_name` on the connection — how this stack shows up in
   * `pg_stat_activity`. Placeholder-free since #8336: a `${…}` here does not
   * mask a connection failure, but it is authored under the same false belief
   * and would report a literal `${SERVICE_NAME}` to every operator reading
   * `pg_stat_activity` — and leaving one connection-material string key open
   * is exactly the displacement door the class-wide refusal exists to close.
   */
  applicationName: placeholderFree(z.string(), 'applicationName').optional()
    .describe('Postgres application_name')
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
