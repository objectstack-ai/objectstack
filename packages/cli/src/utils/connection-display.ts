// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One renderer for "which database am I actually talking to?" — the string the
 * startup banner (`os serve` / `os start` / `os dev`) and the migrate/resync
 * confirms put in front of a developer.
 *
 * Two jobs, both previously done ad hoc and both wrong in their own way
 * (#3793):
 *
 * 1. **Know every connection shape.** A driver's `config.connection` reaches
 *    us as a DSN string, as `{ connectionString }` / `{ uri }` / `{ url }`, as
 *    `{ filename }` (sqlite), or as discrete `{ host, port, database }` — and
 *    a non-SqlDriver keeps its address somewhere else again. The banner knew
 *    three of those, so a datasource declared with a DSN — exactly what
 *    `defaultDatasourceDriverFactory` turns into `{ connectionString }` —
 *    rendered as `→ (unknown)`. The address went missing precisely when the
 *    database is unreachable and the address is the one thing worth reading.
 *
 * 2. **Never print credentials.** A DSN carries `user:password@`, and a Turso
 *    DSN carries its `?authToken=…` in the query string. The banner is read on
 *    shared terminals, in CI logs and in screenshots, so credentials are
 *    *dropped* rather than masked — `admin:****@` tells a developer nothing
 *    that the driver label and the host don't already say.
 */

/**
 * Strip credentials from a connection string.
 *
 * Values that aren't URLs — a sqlite path, `:memory:`, the `(in-memory)`
 * marker — pass through untouched, as does anything the URL parser rejects
 * (minus its userinfo segment). Idempotent, so a call site that can't tell
 * whether its input was already redacted may apply it defensively.
 */
export function redactConnectionUrl(value: string): string {
  if (!value.includes('://')) return value;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    // Query params are where tokens hide (`libsql://….turso.io?authToken=…`),
    // and none of them help answer "which database".
    url.search = '';
    return url.toString();
  } catch {
    // Not parseable (a driver-specific dialect, a malformed URL). Drop the
    // userinfo segment by hand rather than printing the whole thing.
    return value.replace(/:\/\/[^@/]*@/, '://');
  }
}

/** Read a connection target out of one bag of connection-ish fields. */
function readTarget(fields: Record<string, unknown> | undefined): string | undefined {
  if (!fields) return undefined;

  // DSN-shaped. `connectionString` is what `defaultDatasourceDriverFactory`
  // builds for a pg datasource declared with `config.url`/`config.connectionString`;
  // `uri`/`url` are the mongo-family spellings of the same thing.
  for (const key of ['connectionString', 'uri', 'url'] as const) {
    const dsn = fields[key];
    if (typeof dsn === 'string' && dsn) return redactConnectionUrl(dsn);
  }

  if (typeof fields.filename === 'string' && fields.filename) return fields.filename;

  if (fields.host) {
    const port = fields.port === undefined || fields.port === null || fields.port === ''
      ? ''
      : `:${fields.port}`;
    const database = fields.database ? `/${fields.database}` : '';
    return `${fields.host}${port}${database}`;
  }

  return undefined;
}

/**
 * Render a driver's `config` as a credential-free connection target, or
 * `undefined` when the config carries no address at all — an in-memory driver,
 * or a function-valued `connection` the host builds fresh per pool checkout.
 *
 * Drivers don't agree on where the address lives, and a banner has to read all
 * of them: `SqlDriver` carries knex's `{ client, connection }`, while
 * `MongoDBDriver` keeps a top-level `config.url`. The same field precedence is
 * therefore applied to `config.connection` first and to `config` itself second.
 *
 * A DSN keeps its scheme (`postgres://db.example.com:5432/app`); discrete
 * fields have none to keep (`db.example.com:5432/app`). Callers that print
 * this without a driver label alongside should say which engine themselves.
 */
export function describeDriverConnection(config: unknown): string | undefined {
  if (!config || typeof config !== 'object') return undefined;
  const cfg = config as Record<string, unknown>;

  const conn = cfg.connection;
  if (typeof conn === 'string' && conn) return redactConnectionUrl(conn);

  return readTarget(conn && typeof conn === 'object' ? conn as Record<string, unknown> : undefined)
    ?? readTarget(cfg);
}
