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
 * ## The mongodb half is NOT closed here
 *
 * `buildMongoUrl`'s `if (explicit) return explicit;` still drops the bound
 * secret, so a mongo DSN datasource still reaches MongoClient with an empty
 * password. It is not pinned as expected behaviour below — a test asserting the
 * defect would read as a contract. The remedy and what blocks it are recorded
 * on `buildMongoUrl` itself; #8696 stays open for it.
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
