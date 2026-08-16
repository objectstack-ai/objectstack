// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'datasource-config-postgres-url-unparseable-refused',
  surface: 'datasource.config.url (postgres) — connection URLs the `pg` client cannot parse ' +
    "(libpq's multi-host `h1:5432,h2:5433` form, a non-numeric port, a scheme-less non-URL, " +
    'a malformed percent-escape), plus the filesystem-reading query parameters ' +
    '`?sslcert=` / `?sslkey=` / `?sslrootcert=`',
  replacement: 'a single-host URL `pg` itself parses — ' +
    '`postgresql://[user@][host][:port][/dbname][?params]` (unix-socket forms stay accepted: ' +
    'a leading-`/` path, `socket:`, or a percent-encoded socket host). For a multi-host ' +
    'cluster, point the URL at one node or at a proxy/pooler in front of the cluster — ' +
    '`pg` does not implement libpq\'s multi-host DSN, so no spelling of it can connect. For ' +
    'certificate material, use the datasource-level `ssl` block (`ssl: { ca: …, cert: …, ' +
    'key: … }` next to `driver`) instead of file-path query parameters',
  reason:
    "`PostgresConfigSchema.url`'s own describe text documents the postgres URL grammar, but " +
    'until protocol 18 the value was only string-scanned for credentials (#8082/#8337) and ' +
    'placeholders (#8336) — deliberately so at the SHARED helper, whose refusal to parse is ' +
    "load-bearing for mongo's multi-host/`+srv` forms (#8696). For postgres that leniency " +
    'was no check at all: `pg@8.22.0` does not implement libpq\'s multi-host DSN — both ' +
    "`pg-connection-string`'s `parse` and `pg`'s `ConnectionParameters` throw " +
    '`TypeError [ERR_INVALID_URL]` on `postgresql://app@h1:5432,h2:5433/app` (measured) — ' +
    'so an operator could publish exactly that URL, see it saved, and discover only at ' +
    'connect time that it can never open a connection, via a bare `Invalid URL` whose ' +
    '`input` field `pg` redacts. The refusal now asks the same grammar one door up: ' +
    '`parse` from `pg-connection-string` (the parser `pg` itself uses) runs at publish, ' +
    'per-driver, and what it throws on is refused with the value\'s path named. Two ' +
    'adjacent shapes are refused as structurally unusable rather than parse-refused, both ' +
    'measured: a scheme-less value "parses" only by resolving against the parser\'s ' +
    'placeholder base (`postgres://base`), i.e. `pg` would connect to the literal host ' +
    '`base` with the authored text as the database name; and `?sslcert=`/`?sslkey=`/' +
    '`?sslrootcert=` make `parse` itself call `fs.readFileSync`, so the verdict would ' +
    'depend on the validating host\'s filesystem — certificate material already has its ' +
    'declared home in the datasource-level `ssl` block. There is no mechanical rewrite: a ' +
    'URL `pg` cannot parse does not carry enough structure to say which single host the ' +
    'author meant (a multi-host DSN names several on purpose), so the choice of target is ' +
    "the author's. Runtime-environment DSNs (`OS_DATABASE_URL` and friends) never pass " +
    'through the publish door and are unaffected by construction.',
  acceptanceCriteria:
    'Every postgres datasource parses with a `config.url` that `pg-connection-string` ' +
    'parses without throwing, that carries a scheme (or is a unix-socket path), and that ' +
    'carries no `?sslcert=`/`?sslkey=`/`?sslrootcert=` query parameter; each affected ' +
    'datasource still connects to the intended single host; certificate material, where ' +
    'needed, lives in the datasource-level `ssl` block; mongo/mysql/turso datasources are ' +
    'byte-identical before and after (their URL checks are unchanged).',
};
