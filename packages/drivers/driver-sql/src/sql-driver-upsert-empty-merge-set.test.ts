// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An upsert with nothing left to merge is a plain INSERT.
 *
 * `upsert`'s merge leg writes every payload column that is not insert-only
 * (`insertOnlyUpsertColumns`), or, when that set is empty, the conflict-target
 * columns the payload carries (a no-op: a conflict means they matched). When
 * both are empty the statement used to fall back to knex's bare `merge()`,
 * which compiles to merge-ALL on every dialect: `do update set` /
 * `on duplicate key update` over EVERY inserted column, insert-only ones
 * included. That fallback is gone. With nothing to merge the statement carries
 * no conflict clause, so a collision surfaces as the driver's own
 * unique-violation error and the stored row is left as it was.
 *
 * Pinned here:
 *  - the compiled SQL per dialect, with no server (`toSQL()`);
 *  - on every provisioned cell: a collision on a conflict-target column that
 *    the payload omits (the column has a non-null default) is refused and
 *    rewrites nothing; a collision on the primary key with only insert-only
 *    columns in the payload is refused and rewrites nothing;
 *  - controls: a payload that collides with nothing still inserts and answers
 *    the row, and a payload that carries its conflict target still upserts
 *    onto the stored row.
 *
 * The tables are created by hand and registered DDL-free, so the driver has not
 * observed an `updated_at` column on them and the payloads below reach the
 * empty merge set. Live cells run where their URL is provisioned; elsewhere they
 * are declared un-run, never silently passed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import knex from 'knex';
import { isUniqueViolationError } from '@objectstack/types';
import { SqlDriver } from '../src/index.js';
import { withUpsertConflictClause } from './upsert-conflict-clause.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

// ─────────────────────────────────────────────────────────────────────────
// The compiled statement, per dialect — no server
// ─────────────────────────────────────────────────────────────────────────

describe('SqlDriver.upsert — the statement compiled when nothing is left to merge', () => {
  const compile = (client: string, columnsToMerge: string[]): string => {
    const k = knex({ client, connection: {} } as any);
    try {
      return withUpsertConflictClause(k('os8740_t').insert({ id: '1', created_at: 'x' }), ['email'], columnsToMerge)
        .statement.toSQL().sql;
    } finally {
      void k.destroy();
    }
  };

  const EXPECTED_PLAIN: Record<string, string> = {
    'better-sqlite3': 'insert into `os8740_t` (`created_at`, `id`) values (?, ?)',
    pg: 'insert into "os8740_t" ("created_at", "id") values (?, ?)',
    mysql2: 'insert into `os8740_t` (`created_at`, `id`) values (?, ?)',
  };

  for (const [client, expected] of Object.entries(EXPECTED_PLAIN)) {
    it(`compiles a plain INSERT with no conflict clause (${client})`, () => {
      const sql = compile(client, []);
      expect(sql).not.toMatch(/do update set/i);
      expect(sql).not.toMatch(/on duplicate key update/i);
      expect(sql).not.toMatch(/on conflict/i);
      expect(sql).not.toMatch(/insert ignore/i);
      expect(sql).toBe(expected);
    });
  }

  // The contrast: with a column to merge, the same helper still emits the
  // conflict clause and merges exactly that column, never every column.
  it('keeps the conflict clause, merging only the named columns, when there is something to merge', () => {
    expect(compile('better-sqlite3', ['title'])).toBe(
      'insert into `os8740_t` (`created_at`, `id`) values (?, ?) on conflict (`email`) do update set `title` = excluded.`title`',
    );
    expect(compile('pg', ['title'])).toBe(
      'insert into "os8740_t" ("created_at", "id") values (?, ?) on conflict ("email") do update set "title" = excluded."title"',
    );
    expect(compile('mysql2', ['title'])).toBe(
      'insert into `os8740_t` (`created_at`, `id`) values (?, ?) on duplicate key update `title` = values(`title`)',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Behaviour, per provisioned dialect
// ─────────────────────────────────────────────────────────────────────────

/** A conflict-target column with a non-null default, so an omitted value still collides. */
const DEFAULTED = {
  name: 'os8740_defaulted',
  fields: { email: { type: 'string' }, title: { type: 'string' } },
} as any;

/** A business key the payloads below omit, beside insert-only `created_at`. */
const STAMPED = {
  name: 'os8740_stamped',
  fields: { email: { type: 'string' }, title: { type: 'string' } },
} as any;

const KEPT_ID = 'os8740_kept_row';
const KEPT_CREATED = '2020-01-01 00:00:00';

/** Each dialect's native unique-violation code, as its client library reports it. */
const UNIQUE_VIOLATION_CODES: Record<string, string[]> = {
  sqlite: ['SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE'],
  pg: ['23505'],
  mysql: ['ER_DUP_ENTRY'],
};

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'upsert with nothing left to merge', declareEmptyMergeSetPins);
}

function declareEmptyMergeSetPins(cell: DialectCell): void {
  describe(`SqlDriver.upsert — nothing left to merge (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: any;

    const rows = async (table: string): Promise<Array<Record<string, unknown>>> => {
      const found = await knexInstance(table).select('id', 'email', 'title').orderBy('id');
      return found.map((r: Record<string, unknown>) => ({ ...r }));
    };

    const createdAtOf = async (id: string): Promise<string> => {
      const row = await knexInstance(STAMPED.name).where('id', id).first();
      const value = row?.created_at;
      return value instanceof Date ? value.toISOString() : String(value);
    };

    /**
     * The dialect's own unique-violation code, beside the shared predicate: the
     * predicate matches its vocabulary anywhere in the message, and a statement
     * echoed into an unrelated error's message can carry that vocabulary.
     */
    const expectUniqueViolation = (err: unknown): void => {
      expect(err, 'the collision was merged instead of refused').not.toBeNull();
      const { code, message } = err as { code?: string; message?: string };
      expect(isUniqueViolationError(err), `not a unique violation: ${String(message)}`).toBe(true);
      expect(UNIQUE_VIOLATION_CODES[cell.id], `not a unique violation: ${String(message)}`).toContain(code);
    };

    const captureError = async (run: () => Promise<unknown>): Promise<unknown> => {
      try {
        await run();
        return null;
      } catch (e) {
        return e;
      }
    };

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = (driver as any).knex;
      await knexInstance.schema.dropTableIfExists(DEFAULTED.name);
      await knexInstance.schema.dropTableIfExists(STAMPED.name);
      await knexInstance.schema.createTable(DEFAULTED.name, (t: any) => {
        t.string('id', 64).primary();
        t.string('email', 191).notNullable().defaultTo('unset').unique();
        t.string('title', 191).nullable();
      });
      await knexInstance.schema.createTable(STAMPED.name, (t: any) => {
        t.string('id', 64).primary();
        t.timestamp('created_at').nullable();
        t.string('email', 191).nullable().unique();
        t.string('title', 191).nullable();
      });
      driver.registerExternalObject({ ...DEFAULTED, external: { remoteName: DEFAULTED.name } });
      driver.registerExternalObject({ ...STAMPED, external: { remoteName: STAMPED.name } });
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(DEFAULTED.name).catch(() => {});
      await knexInstance?.schema.dropTableIfExists(STAMPED.name).catch(() => {});
      await driver?.disconnect?.();
    });

    beforeEach(async () => {
      await knexInstance(DEFAULTED.name).delete();
      await knexInstance(STAMPED.name).delete();
      await knexInstance(DEFAULTED.name).insert({ id: KEPT_ID, email: 'unset', title: 'kept' });
      await knexInstance(STAMPED.name).insert({
        id: KEPT_ID,
        created_at: new Date(`${KEPT_CREATED.replace(' ', 'T')}Z`),
        email: 'kept@os8740.test',
        title: 'kept',
      });
    });

    it('refuses a collision on an omitted conflict-target column with a unique violation, and rewrites no column', async () => {
      const before = await rows(DEFAULTED.name);

      const err = await captureError(() => driver.upsert(DEFAULTED.name, { id: 'os8740_second_row' }, ['email']));

      expectUniqueViolation(err);
      expect(await rows(DEFAULTED.name), 'the stored row was rewritten, or a row was added').toEqual(before);
    });

    it('refuses a primary-key collision whose payload carries only insert-only columns, and rewrites no column', async () => {
      const before = await rows(STAMPED.name);
      const createdBefore = await createdAtOf(KEPT_ID);

      const err = await captureError(() =>
        driver.upsert(STAMPED.name, { id: KEPT_ID, created_at: '2030-06-01 00:00:00' }, ['email']),
      );

      expectUniqueViolation(err);
      expect(await rows(STAMPED.name)).toEqual(before);
      expect(await createdAtOf(KEPT_ID), 'an insert-only column was rewritten').toBe(createdBefore);
    });

    it('still inserts, and answers the row, when the payload collides with nothing', async () => {
      const written = await driver.upsert(STAMPED.name, { id: 'os8740_fresh_row' }, ['email']);

      expect(written.id).toBe('os8740_fresh_row');
      expect((await rows(STAMPED.name)).map((r) => r.id).sort()).toEqual(['os8740_fresh_row', KEPT_ID].sort());
    });

    it('still upserts onto the stored row when the payload carries its conflict target', async () => {
      const before = await rows(STAMPED.name);
      const createdBefore = await createdAtOf(KEPT_ID);

      const written = await driver.upsert(STAMPED.name, { id: KEPT_ID }, ['id']);

      expect(written.id).toBe(KEPT_ID);
      expect(await rows(STAMPED.name)).toEqual(before);
      expect(await createdAtOf(KEPT_ID)).toBe(createdBefore);
    });
  });
}
