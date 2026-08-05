// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { TursoDriver } from './turso-driver.js';

/**
 * Regression: in REMOTE mode (cloud/Turso via @libsql/client) reads returned
 * raw SQLite column values — a `boolean` came back as the integer `1`, a `json`
 * field as its stored text, a numeric-on-TEXT column as a string — because the
 * remote path (`RemoteTransport` → `mapRows`) never ran `SqlDriver.formatOutput`
 * AND `TursoDriver.initObjects`/`syncSchema` never populated the boolean/json/…
 * coercion registries in remote mode. Local/replica mode goes through Knex +
 * formatOutput, so it coerces correctly — the two transports disagreed.
 *
 * The concrete failure: a HotCRM `case_escalation` flow guarded on a boolean
 * with CEL `field != true`. On Turso the field read back as `1`, so `1 != true`
 * is always true → the guard never fired → the flow self-triggered infinitely
 * and wedged first-boot seed. A local repro (memory/sqlite) was green because
 * both coerce the boolean back to `true`.
 *
 * The fix makes remote reads run the same `formatOutput()` coercion, so remote
 * == local == memory. These assertions FAIL on the pre-fix driver (they'd see
 * `active === 1`, `meta` a string) and pass after it.
 */

const RAW_ROW = {
  id: '1',
  name: 'Widget',
  active: 1, // SQLite stores boolean as integer 0/1
  meta: '{"k":1}', // json stored as TEXT
  count: '5', // numeric scalar that came back as a string
};

/**
 * Minimal @libsql/client stand-in. Routes the handful of SQL shapes the remote
 * schema-sync + read paths emit; every SELECT against the table yields one raw
 * row so we can assert the driver coerces it.
 */
function makeMockClient() {
  const execute = vi.fn(async (stmt: any) => {
    const sql: string = typeof stmt === 'string' ? stmt : stmt.sql;
    if (/sqlite_master/i.test(sql)) return { rows: [], columns: ['name'] }; // table "does not exist" → CREATE path
    if (/^\s*SELECT/i.test(sql)) return { rows: [{ ...RAW_ROW }], columns: Object.keys(RAW_ROW) };
    return { rows: [], columns: [] }; // CREATE TABLE / ALTER / etc.
  });
  return { execute, batch: vi.fn(async () => []), close: vi.fn() };
}

async function makeRemoteDriver() {
  const client = makeMockClient();
  const driver = new TursoDriver({ url: 'libsql://test-db.turso.io', client: client as any });
  await driver.connect();
  expect(driver.isRemote).toBe(true);
  // Registers the field-type metadata (boolean/json/numeric) for coercion.
  await driver.syncSchema('widgets', {
    name: 'widgets',
    fields: {
      name: { type: 'string' },
      active: { type: 'boolean' },
      meta: { type: 'json' },
      count: { type: 'integer' },
    },
  });
  return driver;
}

describe('TursoDriver remote read coercion', () => {
  it('find() coerces boolean 0/1 → real boolean, json text → object, numeric string → number', async () => {
    const driver = await makeRemoteDriver();
    const rows = await driver.find('widgets', {});
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.active).toBe(true); // NOT the integer 1
    expect(typeof row.active).toBe('boolean');
    expect(row.meta).toEqual({ k: 1 }); // parsed, not the string '{"k":1}'
    expect(row.count).toBe(5); // number, not '5'
  });

  it('closes the CEL `field != true` hole that caused the case_escalation incident', async () => {
    const driver = await makeRemoteDriver();
    const [row] = await driver.find('widgets', {});
    // The guard the flow used. Pre-fix this was `1 != true` === true (guard never
    // fired → infinite self-trigger). Post-fix it is `true != true` === false.
    expect(row.active !== true).toBe(false);
  });

  it('findOne() applies the same coercion', async () => {
    const driver = await makeRemoteDriver();
    const row = await driver.findOne('widgets', { where: { id: '1' } });
    expect(row).not.toBeNull();
    expect(row.active).toBe(true);
    expect(row.meta).toEqual({ k: 1 });
  });
});

/**
 * Transport parity: the local (better-sqlite3) and remote (@libsql/client)
 * transports of the SAME driver must return values of the SAME declared type.
 * Cloud runs remote; dev-stack / file mode runs local — so a divergence here is
 * exactly a "green locally, red in prod" trap. This is the contract the fix
 * establishes; it guards against the two paths drifting again.
 */
describe('TursoDriver transport parity (local vs remote)', () => {
  const SCHEMA = {
    name: 'widgets',
    fields: {
      name: { type: 'string' },
      active: { type: 'boolean' },
      meta: { type: 'json' },
      count: { type: 'integer' },
    },
  };

  it('local (better-sqlite3 :memory:) and remote agree on boolean/json/number types', async () => {
    const local = new TursoDriver({ url: ':memory:' });
    await local.connect();
    expect(local.isRemote).toBe(false);
    await local.syncSchema('widgets', SCHEMA);
    await local.create('widgets', { id: '1', name: 'Widget', active: true, meta: { k: 1 }, count: 5 });
    const [lrow] = await local.find('widgets', {});

    const remote = await makeRemoteDriver();
    const [rrow] = await remote.find('widgets', {});

    for (const field of ['active', 'meta', 'count'] as const) {
      expect(typeof rrow[field]).toBe(typeof lrow[field]);
    }
    expect(rrow.active).toBe(lrow.active); // both true, not 1
    expect(rrow.meta).toEqual(lrow.meta); // both { k: 1 }
    expect(rrow.count).toBe(lrow.count); // both 5

    await local.disconnect();
  });
});
