// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18063] The remote face DECLARES that it has no transactions, and the other
 * two faces do not.
 *
 * `TursoDriver extends SqlDriver`, whose `beginTransaction()` opens a real knex
 * transaction — so METHOD PRESENCE, the engine's transaction gate until now,
 * reported all three faces as transactional. Remote is not: `RemoteTransport`'s
 * data methods take no `options` argument at all, so a handle could never reach
 * the statement that would have to join it. A subclass cannot opt out of a door
 * it inherited, which is what `supports.transactionsUnsupported` is for.
 *
 * ⚠️ This pins the DECLARATION only. What the engine does with it is pinned in
 * `packages/objectql/src/engine-transaction-declared-unsupported.test.ts`, and
 * the driver-level refusals that fire when a caller reaches past the engine are
 * pinned in `turso-remote-transaction-refusal.test.ts` (#18616). Three layers,
 * three suites — a driver that declares honestly and an engine that ignores the
 * declaration would leave both of the others green.
 *
 * Constructing the driver is enough: `transportMode` is resolved in the
 * constructor, so no connection, no stub and no network are needed for the
 * `supports` reading. The one case that connects does so to prove the base
 * spread stayed intact.
 */

import { describe, it, expect } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { TursoDriver } from './turso-driver.js';

const remote = () => new TursoDriver({ url: 'libsql://probe.turso.io', authToken: 't' });
const local = () => new TursoDriver({ url: ':memory:' });
const replica = () =>
  new TursoDriver({
    url: ':memory:',
    syncUrl: 'libsql://probe.turso.io',
    authToken: 't',
    sync: { onConnect: false, intervalSeconds: 0 },
  });

describe('[#18063] TursoDriver.supports.transactionsUnsupported', () => {
  it('is true on the REMOTE face', () => {
    const driver = remote();
    expect(driver.transportMode).toBe('remote');
    expect(driver.supports.transactionsUnsupported).toBe(true);
  });

  it('is false on LOCAL and REPLICA — both run knex against a real connection', () => {
    // The discriminating control. If this bit were set per-CLASS rather than
    // per-instance, the case above would be green for the wrong reason and
    // every local Turso deployment would silently lose transactions.
    const localDriver = local();
    const replicaDriver = replica();
    expect(localDriver.transportMode).toBe('local');
    expect(replicaDriver.transportMode).toBe('replica');
    expect(localDriver.supports.transactionsUnsupported).toBe(false);
    expect(replicaDriver.supports.transactionsUnsupported).toBe(false);
  });

  it('inherits the value from SqlDriver rather than restating it — the base declares false', () => {
    // `false` reaches the local face through `...super.supports`, which is why
    // a future base-level change cannot leave this subclass behind.
    //
    // ⛔ Asserted with `instanceof` and not `constructor.name`: the built
    // bundle renames the class to `_SqlDriver`, so a name comparison is green
    // or red depending on whether the suite resolved source or dist.
    expect(TursoDriver.prototype).toBeInstanceOf(SqlDriver);
    expect(local().supports.transactionsUnsupported).toBe(false);
  });

  it('does not disturb the other bits the remote face already declared', () => {
    const driver = remote();
    // The remote arm's existing overrides, unchanged: DDL still batches, native
    // date bucketing is still withheld.
    expect(driver.supports.batchSchemaSync).toBe(true);
    expect(driver.supports.queryDateGranularity).toEqual({});
    // And the base's own live bit still comes through the spread.
    expect(driver.supports.autonumber).toBe(true);
  });
});
