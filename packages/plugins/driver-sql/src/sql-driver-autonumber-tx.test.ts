// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression guard for the auto_number-in-transaction deadlock.
//
// Reported: on SQLite (better-sqlite3, pool max=1), the first autonumber write
// after process start that goes through a transaction — e.g. POST /api/v1/batch,
// which wraps every operation in one `ql.transaction(...)` — dead-locked with
// "Knex: Timeout acquiring a connection. The pool is probably full."
//
// Root cause: the sequence-counter table (`_objectstack_sequences`) was created
// lazily on the first autonumber INSERT, via a bare `this.knex.schema.*` call
// that asks the pool for a SECOND connection. Inside a batch transaction the
// only pooled connection is already held, so the acquire blocked until timeout.
//
// Fixes under test:
//   1. `initObjects` pre-creates the table outside any data transaction, so the
//      first write never runs DDL (primary fix — covers the real batch path).
//   2. The lazy fallback (`ensureSequencesTable`) runs its DDL on the caller's
//      own transaction on SQLite instead of grabbing a second connection, so
//      even a cold-cache in-transaction first write cannot deadlock.

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

const SEQUENCES_TABLE = '_objectstack_sequences';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT: ${label} (deadlock)`)), ms)),
  ]);
}

describe('SqlDriver auto_number in-transaction (deadlock regression)', () => {
  let driver: SqlDriver | undefined;

  afterEach(async () => {
    if (driver) await driver.disconnect();
    driver = undefined;
  });

  async function setup() {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'contract',
        fields: {
          organization_id: { type: 'string' },
          contract_number: { type: 'autonumber', format: 'CTR-{0000}' },
          name: { type: 'string' },
        },
      },
    ]);
    return (driver as any).knex;
  }

  it('pre-creates the sequences table during initObjects (before any write)', async () => {
    const k = await setup();
    // The counter table must exist immediately after initObjects, without a
    // single create() — this is what keeps the first write off the DDL path.
    expect(await k.schema.hasTable(SEQUENCES_TABLE)).toBe(true);
    expect((driver as any).sequencesTableReady).toBe(true);
  });

  it('commits a batch-style transaction whose FIRST write fills an autonumber', async () => {
    const k = await setup();

    // Two autonumber creates inside a single transaction, mirroring how the REST
    // /batch endpoint wraps operations. Must commit, not hang.
    const trx = await driver!.beginTransaction();
    const r1 = await withTimeout(
      driver!.create('contract', { organization_id: 'org_x', name: 'A' }, { transaction: trx }),
      6000,
      'batch create #1 (autonumber)',
    );
    const r2 = await withTimeout(
      driver!.create('contract', { organization_id: 'org_x', name: 'B' }, { transaction: trx }),
      6000,
      'batch create #2 (autonumber)',
    );
    await withTimeout(driver!.commit(trx), 6000, 'commit');

    expect(r1.contract_number).toBe('CTR-0001');
    expect(r2.contract_number).toBe('CTR-0002');

    const rows = await k('contract').select('contract_number').orderBy('contract_number');
    expect(rows.map((r: any) => r.contract_number)).toEqual(['CTR-0001', 'CTR-0002']);
  });

  it('does not deadlock even with a COLD cache inside the transaction (lazy fallback)', async () => {
    const k = await setup();

    // Simulate the path where the table was NOT pre-created (an external object,
    // or a consumer that writes without initObjects): drop it and clear the
    // process cache, then take the single connection with a transaction and let
    // the first autonumber write hit the lazy ensure. On the old code this asked
    // the pool for a second connection and blocked until acquire-timeout.
    await k.schema.dropTableIfExists(SEQUENCES_TABLE);
    (driver as any).sequencesTableReady = false;
    (driver as any).sequencesHasKeyHash = false;
    (driver as any).sequencesTableEnsurePromise = null;

    const trx = await driver!.beginTransaction();
    const r1 = await withTimeout(
      driver!.create('contract', { organization_id: 'org_cold', name: 'C' }, { transaction: trx }),
      6000,
      'cold-cache create inside tx',
    );
    await withTimeout(driver!.commit(trx), 6000, 'commit');

    expect(r1.contract_number).toBe('CTR-0001');
    // The table the fallback created on the transaction survives the commit.
    expect(await k.schema.hasTable(SEQUENCES_TABLE)).toBe(true);
  });
});
