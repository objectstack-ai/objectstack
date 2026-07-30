// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `getSchemaSyncStats` — the observation behind fresh-datastore attestation
 * (#3438, ADR-0104's 2026-07-30 addendum).
 *
 * A deployment may record that it needs no data migration only when the
 * platform watched itself create the store: every table made by this boot,
 * none found already there. Nothing else in the platform knows that — the
 * driver knows it for one statement (`hasTable` → `createTable`) and used to
 * throw it away.
 *
 * The counts are per TABLE, not per sync call, because boot syncs the schema
 * more than once and objects registered later sync on demand. Counting a
 * re-sync of our own table as pre-existing would make every store look like it
 * had history, silently disabling attestation everywhere it matters.
 */

import { describe, it, expect } from 'vitest';
import { SqlDriver } from '../src/index.js';

const sqlite = () =>
  new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

const OBJECTS = [
  { name: 'alpha', fields: { name: { type: 'string' } } },
  { name: 'beta', fields: { name: { type: 'string' } } },
];

describe('SqlDriver.getSchemaSyncStats', () => {
  it('reports nothing before any schema work — a driver that synced nothing vouches for nothing', async () => {
    const driver = sqlite();
    try {
      expect(driver.getSchemaSyncStats()).toEqual({ created: 0, existing: 0 });
    } finally {
      await driver.disconnect();
    }
  });

  it('counts every table it creates in an empty store', async () => {
    const driver = sqlite();
    try {
      await driver.initObjects(OBJECTS as any);

      expect(driver.getSchemaSyncStats()).toEqual({ created: 2, existing: 0 });
    } finally {
      await driver.disconnect();
    }
  });

  /** Boot's own repeated sync must not look like history. */
  it('stays "created from empty" across repeated syncs of its own tables', async () => {
    const driver = sqlite();
    try {
      await driver.initObjects(OBJECTS as any);
      await driver.initObjects(OBJECTS as any);
      await driver.syncSchema('alpha', OBJECTS[0] as any);

      expect(driver.getSchemaSyncStats()).toEqual({ created: 2, existing: 0 });
    } finally {
      await driver.disconnect();
    }
  });

  /**
   * The load-bearing negative: a store with tables from an earlier run. Here
   * a second driver connects to the same file, which is what an upgrade looks
   * like from the platform's side.
   */
  it('reports pre-existing tables for a store it did not create', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'oss-sync-stats-'));
    const filename = join(dir, 'store.db');
    const opts = { client: 'better-sqlite3' as const, connection: { filename }, useNullAsDefault: true };

    // Both pools are closed unconditionally: a knex pool outlives a failed
    // assertion with a live timer, which keeps the test process from exiting
    // long after the run itself has passed.
    const first = new SqlDriver(opts);
    try {
      await first.initObjects(OBJECTS as any);
      expect(first.getSchemaSyncStats()).toEqual({ created: 2, existing: 0 });
    } finally {
      await first.disconnect();
    }

    // A later boot against the same store — the tables precede it.
    const second = new SqlDriver(opts);
    try {
      await second.initObjects(OBJECTS as any);

      expect(second.getSchemaSyncStats()).toEqual({ created: 0, existing: 2 });
    } finally {
      await second.disconnect();
    }
  });

  it('a store that gains an object later is still not one we found', async () => {
    const driver = sqlite();
    try {
      await driver.initObjects([OBJECTS[0]] as any);
      await driver.syncSchema('gamma', { name: 'gamma', fields: { n: { type: 'string' } } } as any);

      expect(driver.getSchemaSyncStats()).toEqual({ created: 2, existing: 0 });
    } finally {
      await driver.disconnect();
    }
  });
});
