// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11161] A failed introspection read must surface as a THROW, never as an
 * empty collection.
 *
 * `introspectPrimaryKeys`, `introspectForeignKeys` and
 * `introspectUniqueConstraints` used to wrap their whole dialect dispatch in a
 * bare `catch {}` and return `[]` — so a query a live server rejects degraded
 * to "this table has no primary key / foreign keys / unique constraints", with
 * no diagnostic. `primaryKeys` is consumed as an addressing /
 * upsert-conflict-target key (federated-object codegen, the persisted
 * `external_catalog` under ADR-0015, schema-drift comparison), so the silent
 * `[]` was a *wrong answer downstream code acts on*, not "we don't know".
 *
 * #7332 already ruled this exact question for the sibling method
 * `introspectIndexes`: `onFailure?: 'throw' | 'partial'`, **defaulting to
 * `'throw'`** — only a caller that can CORRECT a short read may ask for one by
 * name. This file pins that the three siblings now carry the same contract.
 *
 * ## ⛔ Why every failure leg asserts a REJECTION, not "does not throw"
 *
 * The defect's exact shape was a resolved `[]` over a failed read — a test
 * asserting "does not throw" is the defect's own green. Each leg therefore
 * asserts the promise REJECTS and that the rejection carries the underlying
 * error (the knex pool refusal, or Postgres' `undefined_table` with its
 * SQLSTATE), plus the positive half: `{ onFailure: 'partial' }` still resolves,
 * because the opt-in — not the default — is where a short read is legal.
 *
 * ## How the failure is manufactured
 *
 * - **Every cell** (SQLite embedded + live PG/MySQL): destroy the connection
 *   pool, then introspect. The read cannot happen; under the old catch each
 *   method resolved `[]` anyway.
 * - **Postgres additionally**: introspect a non-existent relation.
 *   `?::regclass` raises `undefined_table` (SQLSTATE 42P01) — the exact
 *   measured evidence from #11101's development, where an invalid spelling of
 *   the rewritten `pg_index` query produced no error, no log and an empty key.
 *   (The FK/unique arms are parameterized `information_schema` reads, so a
 *   missing table is legitimately zero rows there — only the pool sabotage can
 *   exercise their catch on a live server.)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'introspection error contract';

/** A table created per cell so the healthy-read legs have something real. */
const TABLE = 'os11161_err_contract';

/** knex's tarn pool refusal after `destroy()` — dialect-independent. */
const POOL_REFUSAL = /Unable to acquire a connection/;

/** The three siblings, exposed for direct pinning (they are `protected`). */
class IntrospectionProbeDriver extends SqlDriver {
  primaryKeys(table: string, opts?: { onFailure?: 'throw' | 'partial' }) {
    return this.introspectPrimaryKeys(table, opts);
  }
  foreignKeys(table: string, opts?: { onFailure?: 'throw' | 'partial' }) {
    return this.introspectForeignKeys(table, opts);
  }
  uniqueConstraints(table: string, opts?: { onFailure?: 'throw' | 'partial' }) {
    return this.introspectUniqueConstraints(table, opts);
  }
}

function declareErrorContractSuite(cell: DialectCell): void {
  describe(`introspection error contract — ${cell.label} (#11161)`, () => {
    let driver: IntrospectionProbeDriver;

    afterEach(async () => {
      // The sabotage legs already destroyed the pool; a second destroy is a
      // no-op, so this is safe either way.
      await driver.disconnect().catch(() => {});
    });

    it('a read the server cannot answer REJECTS by default — for all three siblings', async () => {
      driver = new IntrospectionProbeDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.execute(
        `create table ${TABLE} (id varchar(64) not null, label varchar(64), primary key (id))`,
      );
      // Sabotage: destroy the pool so the next read fails before any row
      // arrives. Under the old `catch {}` every method below resolved `[]`.
      await driver.disconnect();

      await expect(driver.primaryKeys(TABLE)).rejects.toThrow(POOL_REFUSAL);
      await expect(driver.foreignKeys(TABLE)).rejects.toThrow(POOL_REFUSAL);
      await expect(driver.uniqueConstraints(TABLE)).rejects.toThrow(POOL_REFUSAL);
    });

    it("`onFailure: 'partial'` is the opt-in: a failed read resolves to what was read before it", async () => {
      driver = new IntrospectionProbeDriver(cell.config());
      await driver.disconnect();

      // Nothing was read before the failure, so the partial answer is empty —
      // but it RESOLVES, by the caller's explicit request (#7332's shape).
      await expect(driver.primaryKeys(TABLE, { onFailure: 'partial' })).resolves.toEqual([]);
      await expect(driver.foreignKeys(TABLE, { onFailure: 'partial' })).resolves.toEqual([]);
      await expect(driver.uniqueConstraints(TABLE, { onFailure: 'partial' })).resolves.toEqual([]);
    });

    it("`onFailure: 'partial'` on a HEALTHY read returns the full answer — partial is not 'empty'", async () => {
      driver = new IntrospectionProbeDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.execute(
        `create table ${TABLE} (id varchar(64) not null, label varchar(64), primary key (id))`,
      );

      await expect(driver.primaryKeys(TABLE, { onFailure: 'partial' })).resolves.toEqual(['id']);

      await driver.execute(`drop table ${TABLE}`);
    });

    if (cell.id === 'pg') {
      it('a server-side query rejection surfaces with its SQLSTATE — the measured undefined_table case', async () => {
        driver = new IntrospectionProbeDriver(cell.config());

        // `?::regclass` raises `undefined_table` for a relation that does not
        // exist (measured on PostgreSQL 16.13 — the evidence #11161 was filed
        // with). The old catch converted it to a confident empty key.
        const outcome = await driver.primaryKeys('os11161_no_such_relation').then(
          (value) => ({ resolved: true as const, value }),
          (error: unknown) => ({ resolved: false as const, error }),
        );
        expect(
          outcome.resolved,
          'introspectPrimaryKeys resolved ' +
            (outcome.resolved ? JSON.stringify(outcome.value) : '') +
            ' over a rejected query — the #11161 defect shape: a failed read reported as a ' +
            'table without a primary key.',
        ).toBe(false);
        if (!outcome.resolved) {
          // The underlying Postgres error, undecorated: SQLSTATE on `code`,
          // the relation named in the message. This is what #7332's 'throw'
          // default exists to deliver to the caller.
          expect((outcome.error as { code?: string }).code).toBe('42P01');
          expect(String((outcome.error as Error).message)).toMatch(/os11161_no_such_relation/);
        }
      });
    }
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareErrorContractSuite);
}
