// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8873 — a bound `external.credentialsRef` reaches the SERVER on the postgres
 * arm's DSN branch, not merely the knex config.
 *
 * ## The defect, and why it survived a passing sibling pin
 *
 * `DatasourceConnectionService` resolves `external.credentialsRef` to a
 * cleartext secret and hands it to this factory as `spec.secret`. The postgres
 * arm returned `{ connectionString: url, password: spec.secret }` — an explicit
 * secret branch, a comment declaring the intent, and a config object that
 * passes any assertion written against it. `pg` then threw the credential away
 * one layer lower:
 *
 * ```js
 * // pg 8.22.0, lib/connection-parameters.js
 * if (config.connectionString) {
 *   config = Object.assign({}, config, parse(config.connectionString))
 * }
 * ```
 *
 * Measured on `origin/main` @ c308a4fd8, driver `postgres`, secret bound:
 *
 * ```text
 * config.url 'postgresql://app@db.internal:5432/app'          -> password null
 * config.url 'postgresql://app:embedded-legacy@db.internal/app' -> password 'embedded-legacy'
 * ```
 *
 * Two independent mechanisms destroy it, and either alone is sufficient:
 * `parse()` emits a `password` key for EVERY url (`''` when the url carries no
 * userinfo password) which `Object.assign` copies over the injected value; and
 * knex's `setHiddenProperty` has already made `password` a NON-ENUMERABLE own
 * property of `connectionSettings`, which `Object.assign` does not copy at all.
 *
 * ## What is asserted, and at which layer — the constraint this file exists for
 *
 * Every credential assertion below reads what the **`pg` client resolved**, via
 * the `pg` module knex itself will use (`knex.client.driver.Client`) fed the
 * exact `connectionSettings` knex will hand it. Nothing asserts on the
 * `connection` object this factory emitted, deliberately: that assertion PASSED
 * throughout this defect's entire life. It is the same lesson the mongodb half
 * of `bound-secret-dsn-branches.test.ts` records, whose header names this arm by
 * name — *"the postgres arm passes the equivalent config-layer assertion while
 * still being broken below it"* — inherited here rather than re-learned.
 *
 * No connection is opened anywhere in this file: `new Client(config)` resolves
 * `connectionParameters` in its constructor and does no I/O, which is exactly
 * what makes this seam assertable without a server.
 *
 * ## Why the remedy is a third shape again, not either sibling's
 *
 * `mysql2` merges a `uri` UNDER its sibling keys (explicit key wins →
 * `{ uri, password }`); mongodb rides in `options.auth` beside an untouched
 * url. `pg` merges the other way, so the only shape that survives is a config
 * it will not re-parse: pg's own `parse()` of the url, spread as the connection
 * itself, with `password` applied afterwards. The competing remedy — splice the
 * secret into the url's userinfo — is measured in this file too: it does not
 * even fix the defect, because `pg-connection-string` honours `?password=` over
 * userinfo.
 *
 * ## Reverse verification (predicted in writing before running)
 *
 * Predicted with the pre-fix branch (`{ connectionString: url, ...(secret ?
 * { password } : {}) }`) restored over these tests at their fixed state:
 * **8 failed / 3 passed**, and specifically these —
 *
 *  - RED, the five credential cases, each on the resolved password: `null` for
 *    the bare-username, no-userinfo and ssl/extras urls, `'embedded-legacy'`
 *    for the stored userinfo row, `'from-query-param'` for the stored query
 *    row. Those last two are the sharper direction: the credential is not
 *    merely missing, it is someone else's.
 *  - RED, the equivalence sweep — it excludes `password` from the key-by-key
 *    comparison on purpose, but still asserts the injected value separately,
 *    and that half fails.
 *  - RED, the `connectionString`-absence mechanism pin: the old branch emits it.
 *  - RED, the unparseable-DSN refusal, by a DIFFERENT route from all the
 *    others — the old branch never parses, so it never throws and the
 *    assertion fails for want of a rejection rather than on a credential.
 *  - GREEN, the three cases that must not move: the no-secret passthrough and
 *    both discrete-branch controls. The defect is branch-local, so an arm-wide
 *    regression would mean this file measures something else.
 *
 * Measured exactly that set: 8 failed / 3 passed, first two failures verbatim —
 *
 * ```text
 * × resolves the bound secret as the handshake password instead of nothing
 *     AssertionError: expected null to be 's3cr3t-from-sys_secret'
 * × lets the bound secret win over a legacy password embedded in a stored DSN
 *     AssertionError: expected 'embedded-legacy' to be 's3cr3t-from-sys_secret'
 * ```
 */

import { describe, it, expect } from 'vitest';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

/** The cleartext `DatasourceConnectionService` resolves a `credentialsRef` to. */
const BOUND_SECRET = 's3cr3t-from-sys_secret';

/**
 * The one authorable postgres URL shape post-#8082: a username, never a
 * password. `PostgresConfigSchema.url` states the contract this arm failed to
 * keep, verbatim — *"bind the secret (`external.credentialsRef` / the
 * connection form's secret field) and it is injected at connect time. A bare
 * username (`user@host`) stays writable."*
 */
const BARE_USERNAME_DSN = 'postgresql://app@db.internal:5432/app';

/** Build the driver and return the `pg` client knex would open the pool with. */
async function pgClient(spec: Record<string, unknown>): Promise<any> {
  const handle: any = await factory().create({ driver: 'postgres', ...spec } as any);
  try {
    const knexClient = (handle.driver ?? handle).knex.client;
    // `knex.client.driver` is the `pg` module knex resolved for itself, and
    // `connectionSettings` is the object it passes to `new Client(...)` in
    // `acquireRawConnection`. Reading both from knex rather than importing `pg`
    // here keeps the pin on the code path that actually runs.
    return new knexClient.driver.Client(knexClient.connectionSettings);
  } finally {
    // The pool is never opened — nothing in this file connects.
    try { await handle.disconnect?.(); } catch { /* noop */ }
  }
}

/** Everything `pg` resolved for the handshake, credential included. */
async function pgResolved(spec: Record<string, unknown>): Promise<Record<string, unknown>> {
  const client = await pgClient(spec);
  const p = client.connectionParameters;
  return {
    user: p.user,
    // Direct property access, never JSON.stringify or Object.keys: `pg` hides
    // `password` exactly as knex does, so a serialising probe reports a dropped
    // secret that is in fact present.
    password: p.password,
    host: p.host,
    port: p.port,
    database: p.database,
    ssl: p.ssl,
    application_name: p.application_name,
    statement_timeout: p.statement_timeout,
    options: p.options,
    connect_timeout: p.connect_timeout,
    client_encoding: p.client_encoding,
  };
}

/** The `connection` object the factory emitted — the layer that CANNOT judge this. */
async function emittedConnection(spec: Record<string, unknown>): Promise<any> {
  const handle: any = await factory().create({ driver: 'postgres', ...spec } as any);
  try {
    const driver = handle.driver ?? handle;
    return (driver?.config ?? {}).connection;
  } finally {
    try { await handle.disconnect?.(); } catch { /* noop */ }
  }
}

describe('#8873 — postgres: a bound secret reaches the CLIENT on the DSN branch', () => {
  it('resolves the bound secret as the handshake password instead of nothing', async () => {
    // The whole card in one assertion. Before the fix this resolved to `null`:
    // `parse()` contributed `password: ''` and `Object.assign` copied it over
    // the injected value, so the datasource reported connected while having
    // authenticated with no credential at all.
    const resolved = await pgResolved({
      name: 'orders',
      config: { url: BARE_USERNAME_DSN },
      secret: BOUND_SECRET,
    });

    expect(resolved.password).toBe(BOUND_SECRET);
    // And the rest of the DSN still describes the same server: the credential
    // is attached to pg's own reading of the url, not to a re-parsed one.
    expect(resolved).toMatchObject({
      user: 'app',
      host: 'db.internal',
      port: 5432,
      database: 'app',
    });
  });

  it('lets the bound secret win over a legacy password embedded in a stored DSN', async () => {
    // #8082 refuses this url at the publish door, so it can only arrive as a
    // stored pre-#8082 row. Before the fix the DSN's own password won — the
    // arm's comment promised the opposite ("a separately-supplied secret
    // overrides the embedded password") and `pg` decided otherwise.
    const resolved = await pgResolved({
      name: 'legacy-userinfo',
      config: { url: 'postgresql://app:embedded-legacy@db.internal:5432/app' },
      secret: BOUND_SECRET,
    });

    expect(resolved.password).toBe(BOUND_SECRET);
    expect(resolved.user).toBe('app');
  });

  it('wins over a `?password=` query parameter — the spelling that defeats a userinfo splice', async () => {
    // `pg-connection-string` copies every query parameter into the config and
    // `?password=` beats userinfo (measured; the reason #8337 refuses it at
    // authoring, so this too is a stored-row-only shape). This case is what
    // rules OUT the competing remedy: splicing the secret into the userinfo
    // resolves to 'from-query-param' here, i.e. it leaves the card's defect
    // live for this row. Overriding the PARSED key wins over every spelling
    // because it is applied after the parse.
    const resolved = await pgResolved({
      name: 'legacy-query',
      config: { url: 'postgresql://app@db.internal:5432/app?password=from-query-param' },
      secret: BOUND_SECRET,
    });

    expect(resolved.password).toBe(BOUND_SECRET);
  });

  it('carries the credential on a DSN that names no user', async () => {
    // Deliberately UNLIKE the mongodb arm, which no-ops here. The asymmetry is
    // mechanical, not a second policy: `MongoClient` cannot carry a password
    // without a username and injecting `{username:''}` would turn a working
    // anonymous connection into a guaranteed failure, whereas `pg` sends a
    // password only when the server asks for one — so injecting cannot break a
    // datasource that connects today, and refusing would silently drop a
    // credential the operator bound. Making the contradictory pair loud belongs
    // at the authoring door (#9041), which this card lands before.
    const resolved = await pgResolved({
      name: 'anonymous-url',
      config: { url: 'postgresql://db.internal:5432/app' },
      secret: BOUND_SECRET,
    });

    expect(resolved.password).toBe(BOUND_SECRET);
    expect(resolved.database).toBe('app');
  });

  it('keeps the datasource\'s own `ssl` block and pg extras reaching the client', async () => {
    // The DSN branch carries more than a credential, and dropping any of it
    // while fixing the credential would be the same class of defect one key
    // over. #4410 made these keys real; they must stay real on the branch this
    // card rewrites.
    const resolved = await pgResolved({
      name: 'tls',
      config: {
        url: BARE_USERNAME_DSN,
        applicationName: 'objectstack',
        statementTimeout: 30000,
      },
      ssl: { enabled: true, rejectUnauthorized: false },
      secret: BOUND_SECRET,
    });

    expect(resolved.password).toBe(BOUND_SECRET);
    expect(resolved.ssl).toMatchObject({ rejectUnauthorized: false });
    expect(resolved.application_name).toBe('objectstack');
    expect(resolved.statement_timeout).toBe(30000);
  });

  it('changes NOTHING a bound secret does not touch (equivalence sweep)', async () => {
    // The safety half of the remedy. Dropping `connectionString` means this arm
    // no longer lets `pg` read the url itself, so every non-credential key the
    // url contributes has to arrive by the new route unchanged — including the
    // query parameters only `pg-connection-string` knows to copy. Compared
    // key-by-key against the same datasource with no secret bound, which still
    // takes the untouched `connectionString` path.
    const urls = [
      BARE_USERNAME_DSN,
      'postgres://app@db.internal/app?sslmode=require',
      'postgres://app@db.internal/app?sslmode=disable',
      'postgresql://app@db.internal:5432/app?application_name=from-url&connect_timeout=10',
      'postgresql://app@db.internal:5432/app?options=-c%20geqo%3Doff',
      'postgresql:///app?host=/var/run/postgresql',
      'postgresql://app@db.internal:5432/app',
    ];

    for (const url of urls) {
      const config = { url, applicationName: 'objectstack', statementTimeout: 30000 };
      const withSecret = await pgResolved({ name: 'sweep', config, secret: BOUND_SECRET });
      const without = await pgResolved({ name: 'sweep', config });

      // `password` is the one key this card changes; everything else must be
      // what `pg` derived from the url before, verbatim.
      const { password: injected, ...restWith } = withSecret;
      const { password: _none, ...restWithout } = without;
      expect(restWith, url).toEqual(restWithout);
      expect(injected, url).toBe(BOUND_SECRET);
    }
  });

  it('leaves a DSN with nothing bound exactly as it was (no behaviour change)', async () => {
    // Blast radius is "a secret was bound". A datasource that binds none must
    // reach `pg` byte-for-byte as before — still through `connectionString`,
    // still parsed by the client, still with whatever password its own url
    // implies, which is not this change's business to alter.
    const spec = { name: 'anon', config: { url: BARE_USERNAME_DSN } };

    expect(await emittedConnection(spec)).toMatchObject({ connectionString: BARE_USERNAME_DSN });
    expect((await pgResolved(spec)).password).toBeNull();
  });

  it('hands `pg` no `connectionString` to re-parse once a secret is bound', async () => {
    // The one deliberate config-layer assertion in this file, and it is about
    // the MECHANISM rather than the credential: a future refactor that puts the
    // url back beside the password would restore the exact defect this card
    // closed, and would do it while every credential assertion above still
    // reads as intentional code. `connectionString`'s absence is what makes
    // them true.
    const conn = await emittedConnection({
      name: 'orders',
      config: { url: BARE_USERNAME_DSN },
      secret: BOUND_SECRET,
    });

    expect(conn.connectionString).toBeUndefined();
    expect(conn.host).toBe('db.internal');
  });

  it('refuses a DSN pg cannot parse, without echoing the url', async () => {
    // Multi-host DSNs are a libpq feature `pg` does not implement: measured,
    // `parse` and `new ConnectionParameters` BOTH throw ERR_INVALID_URL on this
    // url, so the datasource has never been able to connect. The parse moving
    // to build time makes the failure earlier and named instead of arriving as
    // a bare `Invalid URL` on first query — and both `create()` call sites turn
    // a throw here into a located datasource failure, not a boot crash.
    const url = 'postgresql://app:embedded-legacy@h1:5432,h2:5433/app';
    await expect(factory().create({
      name: 'multi-host',
      driver: 'postgres',
      config: { url },
      secret: BOUND_SECRET,
    } as any)).rejects.toThrow(/pg's own parser rejects/);

    // The message must not carry the url: a stored row may embed a credential
    // in exactly that string, which is why `pg` redacts it in its own error.
    let err: Error | undefined;
    try {
      await factory().create({
        name: 'multi-host',
        driver: 'postgres',
        config: { url },
        secret: BOUND_SECRET,
      } as any);
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).not.toContain('embedded-legacy');
    expect(err?.message).not.toContain(url);
    expect(err?.message).toContain('multi-host');
  });

  it('still reads the bound secret on the discrete-fields branch (control)', async () => {
    // Green before this change and after it: the branch that already worked is
    // what makes the DSN branch's silence a per-branch asymmetry rather than an
    // arm that never read the secret at all.
    const resolved = await pgResolved({
      name: 'discrete',
      config: { host: 'db.internal', port: 5432, database: 'app', username: 'app' },
      secret: BOUND_SECRET,
    });

    expect(resolved.password).toBe(BOUND_SECRET);
    expect(resolved.user).toBe('app');
  });

  it('keeps preferring the bound secret over an inline `config.password` (control)', async () => {
    // `config.password` is `z.never()` at every authoring door since #7990, so
    // this is a stored-row-only shape; the discrete branch's precedence is
    // unchanged by this card.
    const resolved = await pgResolved({
      name: 'discrete-legacy',
      config: { host: 'db.internal', database: 'app', username: 'app', password: 'inline-legacy' },
      secret: BOUND_SECRET,
    });

    expect(resolved.password).toBe(BOUND_SECRET);
  });
});
