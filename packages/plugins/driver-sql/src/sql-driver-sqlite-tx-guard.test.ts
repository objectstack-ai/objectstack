// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Dev/test guard against the SQLite single-connection dead-lock.
//
// SQLite's connection pool hands out exactly one connection. Issuing a bare
// `this.knex` query while a transaction holds that connection blocks forever
// acquiring a second one and finally fails with the opaque "Knex: Timeout
// acquiring a connection" — the reported /api/v1/batch autonumber dead-lock.
//
// `assertBareKnexSafe` turns that latent, timeout-delayed hang into an
// immediate, actionable error at the call site. This is the regression tripwire
// for "a caller opened a transaction but forgot to thread it through": the
// sequence-table ensure would otherwise silently fall back to `this.knex` and
// dead-lock. The guard is a no-op in production and on non-SQLite dialects.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

const SEQUENCES_TABLE = '_objectstack_sequences';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT: ${label}`)), ms)),
  ]);
}

describe('SqlDriver SQLite single-connection tx guard', () => {
  let driver: SqlDriver | undefined;
  const savedEnv = process.env.NODE_ENV;

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
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
          contract_number: { type: 'autonumber', format: 'CTR-{0000}' },
          name: { type: 'string' },
        },
      },
    ]);
    return (driver as any).knex;
  }

  /** Force the lazy fallback: drop the pre-created table and clear the cache. */
  function coldStart() {
    (driver as any).sequencesTableReady = false;
    (driver as any).sequencesHasKeyHash = false;
    (driver as any).sequencesTableEnsurePromise = null;
  }

  describe('beginTransaction bookkeeping', () => {
    it('counts an open transaction and releases it on commit', async () => {
      await setup();
      expect((driver as any).activeTransactions).toBe(0);
      const trx = await driver!.beginTransaction();
      expect((driver as any).activeTransactions).toBe(1);
      await driver!.commit(trx);
      expect((driver as any).activeTransactions).toBe(0);
    });

    it('releases the count on rollback too', async () => {
      await setup();
      const trx = await driver!.beginTransaction();
      expect((driver as any).activeTransactions).toBe(1);
      await driver!.rollback(trx);
      expect((driver as any).activeTransactions).toBe(0);
    });

    it('releases via the deprecated commitTransaction/rollbackTransaction aliases', async () => {
      await setup();
      const t1 = await driver!.beginTransaction();
      await driver!.commitTransaction(t1);
      expect((driver as any).activeTransactions).toBe(0);
      const t2 = await driver!.beginTransaction();
      await driver!.rollbackTransaction(t2);
      expect((driver as any).activeTransactions).toBe(0);
    });

    it('does not double-decrement when a transaction is closed twice', async () => {
      await setup();
      const trx = await driver!.beginTransaction();
      expect((driver as any).activeTransactions).toBe(1);
      await driver!.commit(trx);
      expect((driver as any).activeTransactions).toBe(0);
      // A redundant second close must not drive the count negative.
      await driver!.commit(trx).catch(() => {});
      expect((driver as any).activeTransactions).toBe(0);
    });
  });

  describe('guard fires on the dead-lock shape', () => {
    it('fails fast (not a 6s timeout) when a cold ensure runs bare-knex mid-transaction', async () => {
      const k = await setup();
      await k.schema.dropTableIfExists(SEQUENCES_TABLE);
      coldStart();

      // A transaction now owns the single connection. A create WITHOUT threading
      // that transaction through hits the lazy ensure on `this.knex` — the guard
      // must reject immediately instead of blocking on connection acquisition.
      const trx = await driver!.beginTransaction();
      try {
        await withTimeout(
          (driver as any).ensureSequencesTable(undefined),
          2000,
          'ensureSequencesTable should have thrown, not hung',
        );
        throw new Error('expected the guard to throw');
      } catch (err: any) {
        expect(err.message).toMatch(/transaction is open|dead-lock|Timeout acquiring/i);
        // Specifically the guard's message, not a real acquire-timeout.
        expect(err.message).not.toMatch(/^TIMEOUT:/);
      } finally {
        await driver!.rollback(trx);
      }
    });

    it('surfaces the guard through a real create() that forgot to pass the tx', async () => {
      const k = await setup();
      await k.schema.dropTableIfExists(SEQUENCES_TABLE);
      coldStart();

      const trx = await driver!.beginTransaction();
      try {
        await expect(
          withTimeout(
            driver!.create('contract', { name: 'A' }), // no { transaction: trx } — the bug shape
            2000,
            'create should have failed fast',
          ),
        ).rejects.toThrow(/transaction is open|dead-lock/i);
      } finally {
        await driver!.rollback(trx);
      }
    });
  });

  describe('guard does NOT fire on legitimate paths', () => {
    it('allows a cold ensure that correctly rides the caller transaction', async () => {
      const k = await setup();
      await k.schema.dropTableIfExists(SEQUENCES_TABLE);
      coldStart();

      const trx = await driver!.beginTransaction();
      // parentTrx passed → runs on the transaction, no bare-knex, no throw.
      await expect((driver as any).ensureSequencesTable(trx)).resolves.toBeUndefined();
      await driver!.commit(trx);
      expect(await k.schema.hasTable(SEQUENCES_TABLE)).toBe(true);
    });

    it('allows bare-knex ensure when NO transaction is open (the initObjects path)', async () => {
      const k = await setup();
      await k.schema.dropTableIfExists(SEQUENCES_TABLE);
      coldStart();
      // activeTransactions === 0 → bare knex is safe.
      await expect((driver as any).ensureSequencesTable(undefined)).resolves.toBeUndefined();
      expect(await k.schema.hasTable(SEQUENCES_TABLE)).toBe(true);
    });
  });

  describe('assertBareKnexSafe branch matrix', () => {
    beforeEach(async () => {
      await setup();
    });

    it('throws only in the danger combination: non-prod + sqlite + open tx', () => {
      (driver as any).activeTransactions = 1;
      delete process.env.NODE_ENV;
      expect(() => (driver as any).assertBareKnexSafe('x')).toThrow(/transaction is open/i);
    });

    it('is a no-op in production (guard must never break real deployments)', () => {
      (driver as any).activeTransactions = 1;
      process.env.NODE_ENV = 'production';
      expect(() => (driver as any).assertBareKnexSafe('x')).not.toThrow();
    });

    it('is a no-op when no transaction is open', () => {
      (driver as any).activeTransactions = 0;
      delete process.env.NODE_ENV;
      expect(() => (driver as any).assertBareKnexSafe('x')).not.toThrow();
    });
  });
});
