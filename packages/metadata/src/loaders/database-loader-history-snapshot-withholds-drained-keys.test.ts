// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Ruling 6677709817, step (c): a `sys_metadata_history` snapshot written by
 * `DatabaseLoader` withholds every position the type's redactor marks withheld
 * AND not carried forward — the connector's undeclared `auth` keys the save
 * door drains from the live row — so no new history row carries such a value.
 *
 * Driven onto real SQLite (`driver-sqlite-wasm`) through the loader's two
 * history-writing paths, `save` and `registerRollback`, and read back from the
 * history table's rows, never from a cache. The live row the loader writes is
 * NOT asserted on: the ruling binds what history stores.
 *
 * The placeholder below is a fixture string, not a credential.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { DatabaseLoader } from './database-loader.js';

type Row = Record<string, unknown>;

const LEGACY_AUTH_VALUE = 'TEST_PLACEHOLDER_LEGACY_AUTH_VALUE';

/** A connector whose `auth` holds a key its `bearer` kind does not declare. */
function legacyConnector(): Row {
  return {
    name: 'vendor_api',
    label: 'Vendor API',
    type: 'api',
    provider: 'rest',
    // A DECLARED credential position (withheld on read, carried forward on save): kept in history.
    providerConfig: { baseUrl: 'https://api.vendor.example/v1', headers: { Accept: 'application/json' } },
    auth: { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN', token: LEGACY_AUTH_VALUE },
  };
}

describe('[ruling 6677709817 (c)] DatabaseLoader history snapshots withhold the drained connector keys', () => {
  let driver: SqliteWasmDriver;
  let loader: DatabaseLoader;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    loader = new DatabaseLoader({ driver, trackHistory: true, cache: { enabled: false } });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  async function history(type: string, name: string): Promise<Row[]> {
    const rows = (await driver.find('sys_metadata_history', { where: { type, name } })) as Row[];
    return rows.sort((a, b) => Number(a.version) - Number(b.version));
  }

  const snapshot = (r: Row): Row => JSON.parse(r.metadata as string) as Row;

  it('a create snapshot of a connector holding an undeclared `auth` key stores it without that key', async () => {
    await loader.save('connector', 'vendor_api', legacyConnector());

    const rows = await history('connector', 'vendor_api');
    expect(rows).toHaveLength(1);
    expect(rows[0].operation_type).toBe('create');
    expect(rows[0].metadata as string).not.toContain(LEGACY_AUTH_VALUE);
    expect(snapshot(rows[0]).auth).toEqual({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' });
  });

  it('CONTROL: every declared position is kept in the snapshot exactly as written', async () => {
    await loader.save('connector', 'vendor_api', legacyConnector());

    const { auth: _auth, ...rest } = legacyConnector();
    const { auth, ...snapshotRest } = snapshot((await history('connector', 'vendor_api'))[0]);
    // The declared `auth` keys (the kind and its reference) and the declared
    // credential map beside them: the snapshot drops the undeclared key only.
    expect(auth).toEqual({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' });
    expect(snapshotRest).toEqual(rest);
  });

  it('an update snapshot and a revert snapshot withhold it too', async () => {
    await loader.save('connector', 'vendor_api', legacyConnector());
    await loader.save('connector', 'vendor_api', { ...legacyConnector(), label: 'Vendor API (edited)' });
    await loader.registerRollback('connector', 'vendor_api', legacyConnector(), 1);

    const rows = await history('connector', 'vendor_api');
    expect(rows.map((r) => r.operation_type)).toEqual(['create', 'update', 'revert']);
    for (const r of rows) {
      expect(r.metadata as string).not.toContain(LEGACY_AUTH_VALUE);
      expect(snapshot(r).auth).toEqual({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' });
    }
  });

  it('CONTROL: a non-connector type\'s snapshot is byte-identical to the body written', async () => {
    const body = { name: 'invoice', label: 'Invoice', fields: { token: { type: 'text', label: 'Token' } } };
    await loader.save('object', 'invoice', body);

    const rows = await history('object', 'invoice');
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toBe(JSON.stringify(body));
  });

  it('CONTROL: a connector with nothing undeclared is byte-identical to the body written', async () => {
    const { auth: _auth, ...rest } = legacyConnector();
    const body = { ...rest, auth: { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' } };
    await loader.save('connector', 'vendor_api', body);

    expect((await history('connector', 'vendor_api'))[0].metadata).toBe(JSON.stringify(body));
  });
});
