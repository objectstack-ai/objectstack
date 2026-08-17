// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8696 — a bound `external.credentialsRef` reaches the client on the mysql
 * arm's DSN branch, not only on its discrete-fields branch.
 *
 * ## The defect
 *
 * `DatasourceConnectionService` resolves `external.credentialsRef` to a
 * cleartext secret and hands it to this factory as `spec.secret`. The mysql arm
 * then threw it away whenever `config.url` was present (`if (url) return url;`
 * — the DSN string became the whole knex `connection`). Measured on
 * `origin/main` @ 20067c56b, driver `mysql`, `config.url`
 * `mysql://app@db.internal:3306/app`, secret bound:
 *
 * ```text
 * knex connection: typeof=string  value="mysql://app@db.internal:3306/app"
 * ```
 *
 * No credential anywhere. Since #8082 refuses a `user:password@` userinfo at
 * the publish door, a bare-username DSN plus a bound secret is the only
 * authorable URL shape for this driver — so the arm dropped the credential of
 * precisely the configuration the platform tells operators to write, and the
 * datasource then connected unauthenticated (or failed with a driver-level auth
 * error naming nothing about the binding). This is the third branch of the
 * family #7314 / #7385 / #8152 closed one arm at a time.
 *
 * ## What is asserted, and at which layer
 *
 * The factory's own output — the `connection` it hands `SqlDriver`. That is
 * this module's contract, but it is deliberately NOT the whole story, and this
 * file says so because the sibling arm proves the difference matters: the
 * postgres arm passes the equivalent assertion at this layer and is STILL
 * broken, because `pg` merges `parse(connectionString)` OVER the explicit
 * `password` (measured on pg 8.22.0: effective password `null`). Filed
 * separately. mysql2 merges the other way — the explicit key wins — which is
 * what makes the shape below correct HERE and wrong there. Measured on
 * mysql2 3.23.1 and knex 3.3.0:
 *
 * ```text
 * mysql2 ConnectionConfig({uri:'mysql://app@db.internal:3306/app', password:'INJECTED'})
 *   -> user=app host=db.internal port=3306 database=app password=INJECTED
 * knex   connectionSettings for that object
 *   -> Object.keys = ['uri']            (password is NON-ENUMERABLE, setHiddenProperty)
 *      Object.getOwnPropertyNames = ['uri','password']   cs.password = 'INJECTED'
 * ```
 *
 * ⚠️ That last line is why every assertion below reads `conn.password`
 * directly. `JSON.stringify(conn)` / `Object.keys(conn)` on a knex-normalised
 * connection hide the very key under test — a serialising probe reports a
 * dropped secret that is in fact present.
 *
 * ## Reverse verification (predicted before running, then measured)
 *
 * Predicted, in writing, before running it: with `if (url) return url;`
 * restored, the two DSN cases go RED on the injected password while the
 * no-secret DSN case and both discrete-branch cases stay GREEN — the defect is
 * branch-local, so a whole-arm regression would be the wrong shape and would
 * mean the pin is measuring something else. Measured exactly that set, 2 failed
 * / 3 passed:
 *
 * ```text
 * × injects the bound secret beside the DSN instead of dropping it
 *     AssertionError: expected 'string' to be 'object'
 * × lets the bound secret win over a legacy password embedded in a stored DSN
 *     AssertionError: expected undefined to be 's3cr3t-from-sys_secret'
 * ```
 *
 * The first failure is the whole defect in one line: the arm answered with the
 * DSN *string*, which has no key for a credential to live in.
 *
 * ## The mongodb half, added second (#8696's remaining arm)
 *
 * `buildMongoUrl`'s `if (explicit) return explicit;` dropped the bound secret
 * the same way, and is closed by `buildMongoAuth` — `options.auth` beside an
 * unmodified url, which is a DIFFERENT shape from the mysql half above, on
 * purpose. Its assertions also sit one layer deeper, and that difference is the
 * lesson the mysql half paid for: the postgres arm passes the equivalent
 * config-layer assertion and is still broken, because the client throws the
 * injected password away afterwards. So nothing below asserts on the url string
 * this factory built or on the options object it emitted — every mongo
 * assertion reads `MongoClient`'s own resolved `credentials`, which is what a
 * handshake would actually use. A test that checked `buildMongoUrl`'s return
 * value would have passed throughout this defect's life.
 *
 * Measured on `origin/main` @ 792524c22, mongodb 7.5.0, before the fix:
 *
 * ```text
 * config.url 'mongodb://app@db.internal:27017/app' + bound secret
 *   -> client credentials {username:'app', password:''}
 * ```
 *
 * No connection is opened anywhere in this file: the `MongoClient` constructor
 * resolves `credentials` eagerly, which is exactly why this seam is assertable
 * without a server.
 *
 * ## Reverse verification of the mongo half (predicted before running)
 *
 * Predicted in writing before restoring the pre-fix arm with these tests at
 * their fixed state: the SIX injecting cases go RED on the password, and the
 * FIVE remaining cases stay GREEN — the passthrough-preservation control
 * (`options` already rode through verbatim), the two no-injection cases
 * (nothing bound / a url naming no user, where both versions agree), and the
 * two composed-branch controls, because the defect is branch-local and an
 * arm-wide regression would mean this file measures something else.
 * Measured exactly that set: 6 failed / 5 passed.
 */

import { describe, it, expect } from 'vitest';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

/** The cleartext `DatasourceConnectionService` resolves a `credentialsRef` to. */
const BOUND_SECRET = 's3cr3t-from-sys_secret';

/** The one authorable URL shape post-#8082: a username, never a password. */
const BARE_USERNAME_DSN = 'mysql://app@db.internal:3306/app';

/**
 * The `connection` this arm hands `SqlDriver`, read off the constructed driver
 * rather than from a private export — the same seam the #4456 pins in
 * `default-datasource-driver-factory.test.ts` read.
 */
async function mysqlConnection(spec: Record<string, unknown>): Promise<any> {
  const handle: any = await factory().create({ driver: 'mysql', ...spec } as any);
  try {
    const driver = handle.driver ?? handle;
    return (driver?.config ?? driver?.knexConfig ?? driver?.options ?? {}).connection;
  } finally {
    // The pool is never opened — nothing connects in this file.
    try { await handle.disconnect?.(); } catch { /* noop */ }
  }
}

describe('#8696 — mysql: a bound secret reaches the client on the DSN branch', () => {
  it('injects the bound secret beside the DSN instead of dropping it', async () => {
    const conn = await mysqlConnection({
      name: 'orders',
      config: { url: BARE_USERNAME_DSN },
      secret: BOUND_SECRET,
    });

    // Not the bare-string passthrough any more: mysql2 needs a sibling key to
    // merge the credential into, and a string has no siblings.
    expect(typeof conn).toBe('object');
    // Direct property access, never JSON.stringify — see the header note on
    // knex's setHiddenProperty.
    expect(conn.password).toBe(BOUND_SECRET);
    // The DSN itself is handed over untouched: mysql2 owns its grammar, and
    // nothing here re-encodes or rewrites the authored value.
    expect(conn.uri).toBe(BARE_USERNAME_DSN);
  });

  it('lets the bound secret win over a legacy password embedded in a stored DSN', async () => {
    // #8082 refuses this URL at the publish door, so it can only arrive as a
    // stored pre-#8082 row. The bound credential is the one an operator
    // deliberately bound, and mysql2's merge gives the explicit key precedence
    // — the same rule the postgres arm's DSN branch already declares.
    const conn = await mysqlConnection({
      name: 'legacy',
      config: { url: 'mysql://app:embedded-legacy@db.internal:3306/app' },
      secret: BOUND_SECRET,
    });

    expect(conn.password).toBe(BOUND_SECRET);
    expect(conn.uri).toBe('mysql://app:embedded-legacy@db.internal:3306/app');
  });

  it('leaves a DSN with nothing bound exactly as it was (no behaviour change)', async () => {
    // The whole blast radius of this change is "a secret was bound". A
    // datasource that binds none must be byte-for-byte what it was before, and
    // the bare-string passthrough is what knex has always parsed for it.
    const conn = await mysqlConnection({ name: 'anon', config: { url: BARE_USERNAME_DSN } });

    expect(conn).toBe(BARE_USERNAME_DSN);
  });

  it('still reads the bound secret on the discrete-fields branch (control)', async () => {
    // Green before this change and after it: the branch that already worked is
    // what makes the DSN branch's silence a per-branch asymmetry rather than an
    // arm that never read the secret at all.
    const conn = await mysqlConnection({
      name: 'discrete',
      config: { host: 'db.internal', port: 3306, database: 'app', username: 'app' },
      secret: BOUND_SECRET,
    });

    expect(conn.password).toBe(BOUND_SECRET);
    expect(conn.user).toBe('app');
  });

  it('keeps preferring the bound secret over an inline `config.password` (control)', async () => {
    // `config.password` is `z.never()` at every authoring door since #7990, so
    // this too is a stored-row-only shape; the precedence is unchanged here.
    const conn = await mysqlConnection({
      name: 'both',
      config: { host: 'db.internal', database: 'app', username: 'app', password: 'inline-legacy' },
      secret: BOUND_SECRET,
    });

    expect(conn.password).toBe(BOUND_SECRET);
  });
});

// ── the mongodb arm ──────────────────────────────────────────────────────────

/** The one authorable mongo URL shape post-#8082: a username, never a password. */
const MONGO_BARE_USERNAME_DSN = 'mongodb://app@db.internal:27017/app';

/**
 * What `MongoClient` resolved for this datasource — username, password and
 * auth source as a handshake would use them.
 *
 * Read off the constructed client rather than off the factory's output, and
 * that is the whole point of this helper: the emitted `options.auth` is what
 * this module produces, `client.options.credentials` is what the client made of
 * it *together with the url*. Only the second can answer "did the bound
 * credential arrive", which is the question the postgres arm answers wrongly at
 * the first layer.
 */
async function mongoCredentials(spec: Record<string, unknown>): Promise<any> {
  const handle: any = await factory().create({ driver: 'mongodb', ...spec } as any);
  try {
    const driver = handle.driver ?? handle;
    return driver?.client?.options?.credentials;
  } finally {
    // Nothing ever connected — the constructor only parses.
    try { await handle.disconnect?.(); } catch { /* noop */ }
  }
}

/** The url the factory handed the client, to prove it was not rewritten. */
async function mongoUrl(spec: Record<string, unknown>): Promise<string> {
  const handle: any = await factory().create({ driver: 'mongodb', ...spec } as any);
  try {
    const driver = handle.driver ?? handle;
    return driver?.config?.url;
  } finally {
    try { await handle.disconnect?.(); } catch { /* noop */ }
  }
}

describe('#8696 — mongodb: a bound secret reaches the client on the DSN branch', () => {
  it('injects the bound secret beside the DSN instead of dropping it', async () => {
    const spec = {
      name: 'events',
      config: { url: MONGO_BARE_USERNAME_DSN },
      secret: BOUND_SECRET,
    };

    // The credential the handshake would use — `''` before this change.
    expect(await mongoCredentials(spec)).toMatchObject({
      username: 'app',
      password: BOUND_SECRET,
    });
    // And the authored url is handed over byte for byte: the credential rides
    // beside it, so no `mongodb://…` is rewritten or re-encoded in this repo.
    expect(await mongoUrl(spec)).toBe(MONGO_BARE_USERNAME_DSN);
  });

  it('lets the bound secret win over a legacy password embedded in a stored DSN', async () => {
    // #8082 refuses this url at the publish door, so it can only arrive as a
    // stored pre-#8082 row. `auth` wins over the url's own userinfo password
    // (measured), which is the same precedence the mysql arm states — reached
    // by a different mechanism, because the clients disagree about merge order.
    const spec = {
      name: 'legacy',
      config: { url: 'mongodb://app:embedded-legacy@db.internal:27017/app' },
      secret: BOUND_SECRET,
    };

    expect(await mongoCredentials(spec)).toMatchObject({
      username: 'app',
      password: BOUND_SECRET,
    });
    expect(await mongoUrl(spec)).toBe('mongodb://app:embedded-legacy@db.internal:27017/app');
  });

  it('carries the credential on the multi-host DSN `new URL()` cannot even parse', async () => {
    // The form `MongoConfigSchema.url` documents (`host1[:port1][,…]`). It is
    // the reason the username is read through the platform's own DSN grammar:
    // `new URL('mongodb://app@h1:27017,h2:27017/app')` throws ERR_INVALID_URL,
    // so a WHATWG-based fix would have failed exactly here, and a URL-rewriting
    // fix would have had to re-emit a host list it could not parse.
    expect(await mongoCredentials({
      name: 'replicated',
      config: { url: 'mongodb://app@h1:27017,h2:27017/app' },
      secret: BOUND_SECRET,
    })).toMatchObject({ username: 'app', password: BOUND_SECRET });
  });

  it('carries the credential on a `mongodb+srv://` DSN too', async () => {
    // Same no-rewrite argument, second form: the srv scheme resolves hosts by
    // DNS at connect, so it has no host list to rewrite at all.
    expect(await mongoCredentials({
      name: 'atlas',
      config: { url: 'mongodb+srv://app@cluster0.example.mongodb.net/app' },
      secret: BOUND_SECRET,
    })).toMatchObject({ username: 'app', password: BOUND_SECRET });
  });

  it('decodes a percent-encoded userinfo username instead of authenticating as the raw one', async () => {
    // The spec accessor answers with the RAW component by contract, and the
    // client decodes the same component when it reads it from the url itself.
    // Handing the raw value through would authenticate as `app%40corp` — a
    // different user from the one the url names, and a silent one.
    expect(await mongoCredentials({
      name: 'encoded',
      config: { url: 'mongodb://app%40corp@db.internal:27017/app' },
      secret: BOUND_SECRET,
    })).toMatchObject({ username: 'app@corp', password: BOUND_SECRET });
  });

  it('wins over an `auth` block written into the `options` passthrough', async () => {
    // `config.options` reaches MongoClient verbatim, so it is one more spelling
    // of the same credential. A deliberately bound `credentialsRef` outranks it
    // — the rule the mysql arm applies to a legacy embedded password.
    const creds = await mongoCredentials({
      name: 'passthrough',
      config: {
        url: MONGO_BARE_USERNAME_DSN,
        options: { auth: { username: 'app', password: 'from-passthrough' }, replicaSet: 'rs0' },
      },
      secret: BOUND_SECRET,
    });

    expect(creds).toMatchObject({ username: 'app', password: BOUND_SECRET });
  });

  it('keeps the author\'s other `options` keys arriving untouched (control)', async () => {
    // The injection MERGES into the passthrough; it must not replace it.
    const handle: any = await factory().create({
      name: 'opts',
      driver: 'mongodb',
      config: { url: MONGO_BARE_USERNAME_DSN, options: { replicaSet: 'rs0' } },
      secret: BOUND_SECRET,
    } as any);
    const driver = handle.driver ?? handle;

    expect(driver.config.options).toMatchObject({ replicaSet: 'rs0' });
    expect(driver.client.options.replicaSet).toBe('rs0');
    try { await handle.disconnect?.(); } catch { /* noop */ }
  });

  it('leaves a DSN with nothing bound exactly as it was (no behaviour change)', async () => {
    // Blast radius is "a secret was bound". A datasource that binds none must
    // reach the client exactly as it did before — including the empty password
    // its own url implies, which is not this change's business to alter.
    const spec = { name: 'anon', config: { url: MONGO_BARE_USERNAME_DSN } };

    expect(await mongoCredentials(spec)).toMatchObject({ username: 'app', password: '' });
    expect(await mongoUrl(spec)).toBe(MONGO_BARE_USERNAME_DSN);
  });

  it('does NOT fabricate credentials on a DSN that names no user', async () => {
    // The one direction that could break a working install. `auth` needs a
    // username as well as a password, and inventing an empty one is measurably
    // worse than silence: this url carries NO credentials today, and would
    // carry `{username:''}` — a guaranteed handshake failure — if the arm
    // injected regardless. So it stays a no-op, matching the composed branch,
    // and the loud half of this pair belongs at the authoring door.
    expect(await mongoCredentials({
      name: 'anonymous-url',
      config: { url: 'mongodb://db.internal:27017/app' },
      secret: BOUND_SECRET,
    })).toBeUndefined();
  });

  it('still reads the bound secret on the composed branch (control)', async () => {
    // Green before this change and after it: the branch that already worked is
    // what made the DSN branch's silence a per-branch asymmetry rather than an
    // arm that never read the secret at all.
    expect(await mongoCredentials({
      name: 'composed',
      config: { host: 'db.internal', port: 27017, database: 'events', username: 'svc' },
      secret: BOUND_SECRET,
    })).toMatchObject({ username: 'svc', password: BOUND_SECRET });
  });

  it('keeps preferring the bound secret over an inline `config.password` (control)', async () => {
    // `config.password` is `z.never()` at every authoring door since #7990, so
    // this is a stored-row-only shape; the composed branch's precedence is
    // unchanged by this card.
    expect(await mongoCredentials({
      name: 'composed-legacy',
      config: { host: 'db.internal', database: 'events', username: 'svc', password: 'inline-legacy' },
      secret: BOUND_SECRET,
    })).toMatchObject({ username: 'svc', password: BOUND_SECRET });
  });

  it.each([
    ['no `username` key at all', undefined],
    ['an empty-string `username`', ''],
  ])('drops the bound secret on the composed branch with %s — the measured no-op #9147 refuses at publish', async (_label, username) => {
    // The connect-path measurement the #9147 publish refusal rests on, pinned
    // rather than described. `buildMongoUrl` composes the URI and the secret's
    // ONLY route into it is the userinfo written beside a username
    // (`const auth = user ? … : ''`); `buildMongoAuth` — the DSN branch's
    // route — returns early on `!url`. So a falsy `username` leaves the bound
    // secret with nowhere to go, and the datasource connects ANONYMOUSLY with
    // the operator told nothing.
    //
    // Both spellings are pinned because both are authorable and both are
    // silent: that is exactly why the refusal's fence is the falsy set rather
    // than key-absence. Left unpinned, a later "improvement" that injected a
    // fabricated empty username here would make the publish refusal wrong with
    // nothing going red — and it is measurably the wrong direction anyway (the
    // sibling pin above: `{username:''}` turns an anonymous connection that
    // works into a guaranteed handshake failure).
    const config: Record<string, unknown> = { host: 'db.internal', port: 27017, database: 'events' };
    if (username !== undefined) config.username = username;

    expect(await mongoCredentials({ name: 'composed-anon', config, secret: BOUND_SECRET }))
      .toBeUndefined();
    // And the composed URI itself carries no userinfo to have carried it.
    expect(await mongoUrl({ name: 'composed-anon', config, secret: BOUND_SECRET }))
      .toBe('mongodb://db.internal:27017/events');
  });
});
