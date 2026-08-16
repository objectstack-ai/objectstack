// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8874 — a declared `ssl` reaches the mysql CLIENT on both branches of the
 * mysql arm, in the spelling mysql2 can actually read.
 *
 * ## The defect, in two halves
 *
 * `buildMysqlConnection` computed the TLS option and then returned before
 * anything could use it:
 *
 * ```ts
 * const mysqlSsl = resolveSslOption(spec);   // computed
 * const url = cfg.url as string | undefined;
 * if (url) { … }                             // returned without it
 * return { …, ...(mysqlSsl !== undefined ? { ssl: mysqlSsl } : {}) };  // only here
 * ```
 *
 * So a mysql datasource that declared TLS **and** wrote a `config.url`
 * negotiated no TLS at all — declared, resolved, dropped, no diagnostic — while
 * the discrete-fields branch of the same arm carried it. The postgres arm has
 * honoured exactly this case on its DSN branch since #4410, with the reasoning
 * written in-code, so whether a connection was encrypted depended on which
 * branch of one arm a datasource happened to take.
 *
 * The second half was found while measuring the first, and is why this file
 * pins the discrete branch too. The value `resolveSslOption` answers for the
 * two commonest declarations — `ssl: { enabled: true }` with no certificate
 * material, and the `config.ssl` shorthand, whose schema is `z.boolean()` and
 * therefore has no other authorable value — is `true`, and **mysql2 rejects a
 * boolean outright**. Measured on mysql2 3.23.1, no connection opened:
 *
 * ```text
 * {host,port,database,user, ssl:true}   -> TypeError: SSL profile must be an object, instead it's a boolean
 * {host,port,database,user, ssl:{}}     -> ssl {rejectUnauthorized:true}
 * {uri:'mysql://app@db.internal:3306/app'}          -> ssl false        (the dropped DSN case)
 * {uri:'mysql://app@db.internal:3306/app', ssl:{}}  -> ssl {rejectUnauthorized:true}
 * ```
 *
 * The branch #8874 describes as "honouring" the declaration was therefore
 * throwing on every connection acquisition for the commonest way of declaring
 * it. Emitting `ssl: true` onto the DSN branch to close the first half would
 * have shipped that throw to a second branch, so `mysqlSslOption` translates
 * `true` to the empty-options object `resolveSslOption`'s own comment says it
 * is short for.
 *
 * ## What is asserted, and at which layer
 *
 * Everything below reads what **mysql2 resolved** — `ConnectionConfig`, from
 * the mysql2 module knex itself resolved (`knex.client.driver`), fed the exact
 * `connectionSettings` knex will hand it. Nothing asserts on the `connection`
 * object this factory emitted, and that is deliberate: it is the constraint
 * inherited from #8873, where the postgres arm passed the equivalent
 * config-layer assertion throughout the defect's entire life while the client
 * threw the value away one layer below. Here it is the sharper of the two
 * lessons, because the boolean half of this card is invisible at the config
 * layer by construction — `{ ssl: true }` is a perfectly good-looking object
 * and only the client's own parse says otherwise.
 *
 * `new ConnectionConfig(settings)` does no I/O — it parses the uri and
 * validates the options — which is what makes this seam assertable without a
 * server. No connection is opened anywhere in this file.
 *
 * ## Reverse verification (predicted in writing before running)
 *
 * Predicted with the pre-fix `buildMysqlConnection` restored over these tests
 * at their fixed state: **8 failed / 6 passed**, and specifically —
 *
 *  - RED, the four DSN-branch TLS cases, on the dropped option: mysql2 resolves
 *    `ssl false` because nothing was carried beside the uri.
 *  - RED, the two discrete-branch TLS cases, by a DIFFERENT route from every
 *    other failure — the old branch DID carry the option, as `true`, so mysql2
 *    throws `SSL profile must be an object` and the case fails for want of a
 *    resolved config rather than on a compared value. That direction is the
 *    reason this file pins a branch the card describes as working.
 *  - RED, the two shape assertions, on `'string'` where an object is required:
 *    the emitted-shape mechanism pin, and the DSN `enabled: false` case, whose
 *    resolved `ssl` is `false` either way but whose return shape is not.
 *  - GREEN, the six that must not move: the nothing-declared passthrough and
 *    the bound-secret-only control (the blast-radius bounds — if either moved,
 *    the scoping claim would be false), the parser-equivalence sweep (it
 *    compares two parses, not the fix), and the three discrete-branch cases
 *    whose declaration was never the broken spelling — a certificate object, an
 *    `enabled: false`, and no declaration at all.
 *
 * Measured exactly that set, case for case: **8 failed / 6 passed**.
 *
 * ```text
 * × carries a declared TLS block onto the DSN branch with no secret bound
 *     AssertionError: expected false to deeply equal { rejectUnauthorized: true }
 * × carries TLS and a bound secret together on the DSN branch
 *     AssertionError: expected false to deeply equal { rejectUnauthorized: false }
 * × carries certificate material onto the DSN branch verbatim
 *     AssertionError: expected false to deeply equal { …(2) }
 * × carries the `config.ssl` on/off shorthand onto the DSN branch
 *     AssertionError: expected false to deeply equal { rejectUnauthorized: true }
 * × returns an object rather than the bare DSN string once TLS is declared
 *     AssertionError: expected 'string' to be 'object'
 * × honours a declared `enabled: false` on the DSN branch
 *     AssertionError: expected 'string' to be 'object'
 * × resolves TLS on the discrete-fields branch instead of throwing on a boolean
 *     TypeError: SSL profile must be an object, instead it's a boolean
 * × resolves the `config.ssl` shorthand on the discrete-fields branch too
 *     TypeError: SSL profile must be an object, instead it's a boolean
 * ```
 *
 * The ablation was restored from the commit and proven byte-identical
 * (`git hash-object` on the restored file equals `git rev-parse HEAD:<path>`).
 * Nothing is built for it: these tests import the factory source through the
 * `.js`-to-`.ts` test alias, so the ablated code is the code that ran.
 */

import { describe, it, expect } from 'vitest';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

/** The cleartext `DatasourceConnectionService` resolves a `credentialsRef` to. */
const BOUND_SECRET = 's3cr3t-from-sys_secret';

/** The one authorable URL shape post-#8082: a username, never a password. */
const BARE_USERNAME_DSN = 'mysql://app@db.internal:3306/app';

/** A CA certificate is only ever a string here; its bytes are never inspected. */
const CA_PEM = '-----BEGIN CERTIFICATE-----\nMIIB…\n-----END CERTIFICATE-----';

/**
 * What `mysql2` made of this datasource — the layer that can answer "did the
 * declared TLS arrive".
 *
 * `knex.client.driver` is the mysql2 module knex resolved for itself and
 * `connectionSettings` is the object it passes to `createConnection` in
 * `acquireRawConnection`, so this is the code path that actually runs. A
 * `ConnectionConfig` is what that call builds first, and it is the whole of the
 * client's opinion about `ssl`: it parses the uri, merges the sibling keys, and
 * rejects a value it cannot use.
 */
async function mysqlResolved(spec: Record<string, unknown>): Promise<any> {
  const handle: any = await factory().create({ driver: 'mysql', ...spec } as any);
  try {
    const knexClient = (handle.driver ?? handle).knex.client;
    return new knexClient.driver.ConnectionConfig(knexClient.connectionSettings);
  } finally {
    // The pool is never opened — nothing in this file connects.
    try { await handle.disconnect?.(); } catch { /* noop */ }
  }
}

/**
 * The `connection` object the factory emitted — asserted ONLY where the
 * mechanism is the claim (a bare string cannot carry an `ssl` key, so the
 * return shape is itself part of this card), never as evidence that TLS
 * arrived.
 */
async function emittedConnection(spec: Record<string, unknown>): Promise<any> {
  const handle: any = await factory().create({ driver: 'mysql', ...spec } as any);
  try {
    const driver = handle.driver ?? handle;
    return (driver?.config ?? driver?.knexConfig ?? driver?.options ?? {}).connection;
  } finally {
    try { await handle.disconnect?.(); } catch { /* noop */ }
  }
}

describe('#8874 — mysql: a declared `ssl` reaches the client on the DSN branch', () => {
  it('carries a declared TLS block onto the DSN branch with no secret bound', async () => {
    // The card's headline case, and the sub-case its cost estimate missed: with
    // no secret bound this arm returned the bare DSN *string*, which has no key
    // for an `ssl` option to live in. Before the fix mysql2 resolved `ssl false`
    // — the datasource connected in cleartext while its metadata declared TLS.
    const resolved = await mysqlResolved({
      name: 'orders',
      config: { url: BARE_USERNAME_DSN },
      ssl: { enabled: true },
    });

    expect(resolved.ssl).toEqual({ rejectUnauthorized: true });
    // And the DSN still describes the same server: mysql2 parses it, nothing
    // in this repo rewrites or re-encodes a `mysql://…`.
    expect(resolved).toMatchObject({
      user: 'app',
      host: 'db.internal',
      port: 3306,
      database: 'app',
    });
  });

  it('carries TLS and a bound secret together on the DSN branch', async () => {
    // The other DSN sub-case. #8696 made this branch return `{ uri, password }`
    // and deliberately left `ssl` out of it, because carrying TLS only for
    // datasources that happen to bind a credential would have been a second,
    // stranger asymmetry. Both channels now ride together.
    const resolved = await mysqlResolved({
      name: 'orders-auth',
      config: { url: BARE_USERNAME_DSN },
      ssl: { enabled: true, rejectUnauthorized: false },
      secret: BOUND_SECRET,
    });

    expect(resolved.ssl).toEqual({ rejectUnauthorized: false });
    // Direct property access — knex's `setHiddenProperty` makes `password`
    // non-enumerable, so a serialising probe reports a dropped secret that is
    // in fact present.
    expect(resolved.password).toBe(BOUND_SECRET);
    expect(resolved.user).toBe('app');
  });

  it('carries certificate material onto the DSN branch verbatim', async () => {
    // The shape `SSL_DETAIL_BELONGS_ON_DATASOURCE` tells authors to write, and
    // the one whose silent loss the `datasource.ssl` schema comment warns about
    // by name — "a TLS setting that never took effect looked identical to one
    // that did".
    const resolved = await mysqlResolved({
      name: 'certs',
      config: { url: BARE_USERNAME_DSN },
      ssl: { enabled: true, ca: CA_PEM, rejectUnauthorized: true },
    });

    expect(resolved.ssl).toEqual({ ca: CA_PEM, rejectUnauthorized: true });
  });

  it('carries the `config.ssl` on/off shorthand onto the DSN branch', async () => {
    // The second declared spelling (`MysqlConfigSchema.ssl`, and the target of
    // its `sslmode`/`tls`/`usessl` aliases). It resolves to the same `true` the
    // TLS block does, so it exercises the same translation.
    const resolved = await mysqlResolved({
      name: 'shorthand',
      config: { url: BARE_USERNAME_DSN, ssl: true },
    });

    expect(resolved.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('returns an object rather than the bare DSN string once TLS is declared', async () => {
    // The mechanism, asserted at the config layer because the mechanism IS the
    // return shape: `ssl` cannot be attached to a string. This is the "behaviour
    // change for existing rows" the card flagged, and the assertion below is
    // what bounds it — see the passthrough control.
    const conn = await emittedConnection({
      name: 'shape',
      config: { url: BARE_USERNAME_DSN },
      ssl: { enabled: true },
    });

    expect(typeof conn).toBe('object');
    expect(conn.uri).toBe(BARE_USERNAME_DSN);
  });

  it('leaves a DSN with NOTHING declared exactly as it was (blast-radius control)', async () => {
    // The scoping this whole card rests on: the shape changes only for the
    // population that was broken. A datasource that declared no TLS and bound
    // no secret still gets the byte-identical bare string knex has always
    // parsed for it, and mysql2's own `ssl` default (`false`) is untouched.
    const spec = { name: 'anon', config: { url: BARE_USERNAME_DSN } };

    expect(await emittedConnection(spec)).toBe(BARE_USERNAME_DSN);
    expect((await mysqlResolved(spec)).ssl).toBe(false);
  });

  it('leaves a DSN with only a secret bound as the #8696 shape (control)', async () => {
    // Green before this change and after it. The `ssl` key must not appear on a
    // connection that declared none — otherwise this card would have widened
    // #8696's blast radius rather than added to it.
    const conn = await emittedConnection({
      name: 'secret-only',
      config: { url: BARE_USERNAME_DSN },
      secret: BOUND_SECRET,
    });

    expect(Object.getOwnPropertyNames(conn).sort()).toEqual(['password', 'uri']);
    expect((await mysqlResolved({
      name: 'secret-only',
      config: { url: BARE_USERNAME_DSN },
      secret: BOUND_SECRET,
    })).password).toBe(BOUND_SECRET);
  });

  it('honours a declared `enabled: false` on the DSN branch', async () => {
    // A declaration either way is a declaration, which is why the shape switch
    // keys on `!== undefined` rather than on truthiness — the same rule the
    // postgres arm applies. mysql2 resolves `false`, its own default, so this
    // disables nothing that was enabled.
    const spec = {
      name: 'tls-off',
      config: { url: BARE_USERNAME_DSN },
      ssl: { enabled: false },
    };

    expect((await mysqlResolved(spec)).ssl).toBe(false);
    expect(typeof await emittedConnection(spec)).toBe('object');
  });

  it('changes NOTHING else the DSN contributed — knex\'s parse vs mysql2\'s, key by key', async () => {
    // Switching the no-secret return from a string to `{ uri, ssl }` moves the
    // DSN from knex's own connection-string parser to mysql2's, so every
    // non-TLS key it contributed has to arrive by the new route unchanged.
    // Compared across the forms a stored row can hold; `ssl` is excluded
    // because it is the one key this card deliberately moves.
    const FIELDS = [
      'host', 'port', 'user', 'password', 'database',
      'charset', 'timezone', 'connectTimeout', 'flags', 'socketPath', 'multipleStatements',
    ] as const;
    const URLS = [
      BARE_USERNAME_DSN,
      'mysql://app:embedded-legacy@db.internal:3306/app',
      'mysql://db.internal:3306/app',
      'mysql://app@db.internal/app',
      'mysql://app%40corp@db.internal:3306/app',
      'mysql://app@db.internal:3306/app?charset=utf8mb4&connectTimeout=5000',
      'mysql://app@db.internal:3306/app?timezone=Z',
    ];

    for (const url of URLS) {
      const before = await mysqlResolved({ name: 'sweep', config: { url } });
      const after = await mysqlResolved({ name: 'sweep', config: { url }, ssl: { enabled: true } });
      for (const field of FIELDS) {
        expect({ url, field, value: after[field] })
          .toEqual({ url, field, value: before[field] });
      }
    }
  });
});

describe('#8874 — mysql: the discrete-fields branch declares TLS mysql2 can read', () => {
  const DISCRETE = { host: 'db.internal', port: 3306, database: 'app', username: 'app' };

  it('resolves TLS on the discrete-fields branch instead of throwing on a boolean', async () => {
    // The half found while measuring the first. This branch already carried the
    // option — as `true`, which mysql2 refuses: `SSL profile must be an object,
    // instead it's a boolean`, thrown from `new ConnectionConfig` and therefore
    // from every `acquireRawConnection`. So the branch the card calls "honours
    // it" could not open a connection at all for the commonest declaration, and
    // emitting the same `true` onto the DSN branch would have spread the throw.
    const resolved = await mysqlResolved({
      name: 'discrete-tls',
      config: DISCRETE,
      ssl: { enabled: true },
    });

    expect(resolved.ssl).toEqual({ rejectUnauthorized: true });
    expect(resolved).toMatchObject({ user: 'app', host: 'db.internal', database: 'app' });
  });

  it('resolves the `config.ssl` shorthand on the discrete-fields branch too', async () => {
    // `DriverSslToggleSchema` is `z.boolean()`, so `true` is the ONLY value an
    // author can write here — which is what made the boolean the common case
    // rather than an edge one.
    expect((await mysqlResolved({ name: 'discrete-shorthand', config: { ...DISCRETE, ssl: true } })).ssl)
      .toEqual({ rejectUnauthorized: true });
  });

  it('keeps carrying certificate material and a bound secret together (control)', async () => {
    // Green before this change and after it: an options object was never the
    // broken spelling, and this is what proves the translation is confined to
    // the boolean rather than rewriting what authors declared.
    const resolved = await mysqlResolved({
      name: 'discrete-certs',
      config: DISCRETE,
      ssl: { enabled: true, ca: CA_PEM, rejectUnauthorized: false },
      secret: BOUND_SECRET,
    });

    expect(resolved.ssl).toEqual({ ca: CA_PEM, rejectUnauthorized: false });
    expect(resolved.password).toBe(BOUND_SECRET);
  });

  it('honours a declared `enabled: false` on the discrete-fields branch', async () => {
    expect((await mysqlResolved({ name: 'discrete-off', config: DISCRETE, ssl: { enabled: false } })).ssl)
      .toBe(false);
  });

  it('leaves a discrete-fields datasource that declared no TLS alone (control)', async () => {
    expect((await mysqlResolved({ name: 'discrete-plain', config: DISCRETE })).ssl).toBe(false);
  });
});
