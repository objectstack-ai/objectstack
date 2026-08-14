// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8567] The unbacked-conflict-target refusal, across the DIALECTS
 * `driver-sql` actually serves — not just the one #8445 could raise it on.
 *
 * # What this card measured, and why measuring was the deliverable
 *
 * #8445 landed the refusal against SQLite's sentence and said so in the code:
 * the container had no other server, and its dispatch ruled that transcribing
 * another dialect's wording from memory is not evidence. That left Postgres
 * and MySQL answering the raw driver error — `mapDataError` falling through to
 * its default branch and shipping the STATEMENT, bound values included, with no
 * `code` for any client to branch on. Two of three dialects, the same payload
 * argument #8445 made for the third.
 *
 * So this file's first job is to be the place a dialect's wording is
 * OBSERVED rather than assumed. Postgres was raised for real — system PG 16
 * binaries, `initdb` + `pg_ctl`, no container runtime — through the same
 * knex + `pg` path `upsert` takes, and the sentence it produced is now a limb
 * of `isUnbackedConflictTargetError` in `@objectstack/types`.
 *
 * ```
 * # PostgreSQL 16.13, knex 3.3.0 + pg 8.22.0
 * upsert('plain', { email: 'a@b.com', title: 'x' }, ['email'])
 *   -> name=error (DatabaseError) code=42P10 severity=ERROR status=undefined
 *      routine=infer_arbiter_indexes  constraint=undefined  detail=undefined
 *      msg=insert into "plain" ("email", "id", "title") values ($1, $2, $3)
 *          on conflict ("email") do update set "title" = excluded."title"
 *          - there is no unique or exclusion constraint matching the ON CONFLICT specification
 * ```
 *
 * # The three cells are not symmetric, and pretending otherwise would lie
 *
 *  - **SQLite** runs everywhere, in-process. It is the cell that always
 *    executes, so a regression in the shared predicate cannot hide behind an
 *    unprovisioned matrix.
 *  - **Postgres** runs when `OS_TEST_POSTGRES_URL` is set, and is REPORTED as
 *    an un-run cell when it is not (`declareUnprovisionedCell`) — never a
 *    silent pass. This is the cell whose wording this card added.
 *  - **MySQL** cannot raise the condition at all, which is a measurement, not
 *    an excuse. knex compiles `onConflict(...).merge(...)` on that dialect to
 *    `ON DUPLICATE KEY UPDATE`, which takes **no conflict target**: the named
 *    keys are dropped before the statement leaves the process, so the server is
 *    never asked to find an index for them. That is checkable with no server at
 *    all, and the compile pin below checks it. The LIVE MySQL cell is still
 *    declared un-run rather than dropped, because "the condition cannot arise"
 *    is a claim about knex's compiler that a real server should eventually be
 *    held to.
 *
 * ⚠️ What MySQL does INSTEAD of refusing — merge on whichever unique key the
 * row collides with, or insert a second row — is a different defect with a
 * different fix, filed separately. This file does not assert it, because
 * nobody has watched a MySQL server do it: an assertion written from the
 * compiled SQL alone would be exactly the transcribed-from-memory evidence
 * this card exists to stop accepting.
 *
 * # Reverse verification — direction predicted BEFORE it was run
 *
 * Predicted, removing the Postgres limb from `UNBACKED_CONFLICT_TARGET` in
 * `@objectstack/types` with the fix committed first: the Postgres cell's
 * envelope pin and leak pin go RED (the raw `DatabaseError` returns, `code`
 * `42P10`, `status` undefined, statement text back in the caller-visible
 * message), and **every SQLite pin stays GREEN** — the SQLite limb is
 * untouched, which is what makes the two limbs independent rather than one
 * regex that happens to cover both. The positive controls stay GREEN on both
 * cells across that revert: they never depended on recognition, which is
 * precisely what makes them controls. Measured, and it matched.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knex from 'knex';
import { StandardErrorCode } from '@objectstack/spec/api';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareUnprovisionedCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
  cause?: unknown;
}

/**
 * Table names are card-scoped rather than the generic `crm_contact` #8445 uses:
 * the live cells share ONE database with every other matrix in this package, so
 * a generic name is a cross-suite collision waiting for the first parallel run.
 */
const BACKED = {
  name: 'os8567_backed',
  fields: {
    email: { type: 'string', unique: true },
    title: { type: 'string' },
  },
} as any;

/** The same object with the `unique` declaration REMOVED — the unbacked target. */
const PLAIN = {
  name: 'os8567_plain',
  fields: {
    email: { type: 'string' },
    title: { type: 'string' },
  },
} as any;

const captureError = async (run: () => Promise<unknown>): Promise<WireBearingError | null> => {
  try {
    await run();
    return null;
  } catch (e) {
    return e as WireBearingError;
  }
};

/**
 * The dialects whose `ON CONFLICT` compilation can carry a target at all. MySQL
 * is excluded here and handled on its own terms below — running it through this
 * sweep would assert a refusal that cannot happen and would read as a driver
 * defect rather than as the dialect fact it is.
 */
const ON_CONFLICT_DIALECTS = new Set(['sqlite', 'pg']);

for (const cell of DIALECT_CELLS) {
  if (!ON_CONFLICT_DIALECTS.has(cell.id)) continue;
  if (!cell.available) {
    declareUnprovisionedCell(cell, 'unbacked conflict-target refusal');
    continue;
  }
  declareRefusalSweep(cell);
}

function declareRefusalSweep(cell: DialectCell): void {
  describe(`SqlDriver.upsert — unbacked conflict-target refusal (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: any;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = (driver as any).knex;
      // Live cells reuse one database, so the sweep starts from dropped tables.
      await knexInstance.schema.dropTableIfExists(BACKED.name);
      await knexInstance.schema.dropTableIfExists(PLAIN.name);
      await driver.initObjects([BACKED, PLAIN]);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(BACKED.name).catch(() => {});
      await knexInstance?.schema.dropTableIfExists(PLAIN.name).catch(() => {});
      await driver?.disconnect?.();
    });

    // ───────────────────────────────────────────────────────────────────
    // Pin 1 — the envelope. `code` AND `status`, never a bare toThrow().
    // ───────────────────────────────────────────────────────────────────

    /**
     * A bare `rejects.toThrow()` is blind here in both directions: the un-fixed
     * driver threw for this input too (that is the whole defect), so it was
     * green before and after. The measured pre-fix values are the ones the
     * negative assertions name — `SQLITE_ERROR` on one cell, `42P10` on the
     * other, `status: undefined` on both.
     */
    it('answers a real `code` and `status` — not the raw driver error', async () => {
      const err = await captureError(() => driver.upsert(PLAIN.name, { email: 'a@b.com', title: 'x' }, ['email']));

      expect(err, 'the unbacked conflict target must still be refused, not silently accepted').not.toBeNull();
      expect(err!.code).toBe(StandardErrorCode.enum.VALIDATION_ERROR);
      expect(err!.status).toBe(400);
      // The two measured raw codes this refusal replaces, one per cell.
      expect(err!.code).not.toBe('SQLITE_ERROR');
      expect(err!.code).not.toBe('42P10');

      // The message names what an operator has to act on.
      expect(err!.message).toMatch(new RegExp(PLAIN.name));
      expect(err!.message).toMatch(/email/);
      expect(err!.message).toMatch(/unique/i);
    });

    /**
     * One condition, one wording (#5240) — and it must not name a dialect. The
     * clause read "SQLite refuses the statement" until this card; on a Postgres
     * deployment that sentence pointed the reader at the wrong engine.
     */
    it('states the refusal without naming a single engine', async () => {
      const err = await captureError(() => driver.upsert(PLAIN.name, { email: 'a@b.com', title: 'x' }, ['email']));

      expect(err!.message.split('. ')[0] + '.').toBe(
        `Cannot upsert into "${PLAIN.name}" on conflict keys ("email"): no PRIMARY KEY or UNIQUE ` +
          'index backs them, so the merge target does not exist and the database refuses the statement.',
      );
      expect(err!.message).not.toMatch(/SQLite|Postgres|MySQL/i);
    });

    // ───────────────────────────────────────────────────────────────────
    // Pin 2 — the payload: the statement must not travel with the refusal
    // ───────────────────────────────────────────────────────────────────

    it('keeps the SQL statement and its bound values out of the caller-visible message', async () => {
      const err = await captureError(() =>
        driver.upsert(PLAIN.name, { email: 'leaked@example.com', title: 'secret-title' }, ['email']),
      );

      expect(err).not.toBeNull();
      expect(err!.message).not.toMatch(/insert into/i);
      expect(err!.message).not.toMatch(/excluded\./i);
      expect(err!.message).not.toContain('leaked@example.com');
      expect(err!.message).not.toContain('secret-title');

      // …while the server's own text stays reachable through `cause`, which no
      // error mapper puts on the wire. This is the ground truth a DBA wants,
      // and it is the per-dialect sentence — the assertion is deliberately
      // loose about WHICH one, because both cells run this same case.
      const causeText = String((err!.cause as Error | undefined)?.message);
      expect(causeText).toMatch(/insert into/i);
      expect(causeText).toMatch(
        /ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint|there is no unique or exclusion constraint matching the ON CONFLICT specification/i,
      );
    });

    // ───────────────────────────────────────────────────────────────────
    // Pin 3 — the controls: what recognition must NOT have swallowed
    // ───────────────────────────────────────────────────────────────────

    /**
     * Without this, a predicate that matched EVERY upsert failure would pass
     * every pin above while having destroyed the capability the driver exists
     * to provide.
     */
    it('MERGES when a declared unique index does back the conflict target', async () => {
      await driver.upsert(BACKED.name, { email: 'ctl@b.com', title: 'first' }, ['email']);
      await driver.upsert(BACKED.name, { email: 'ctl@b.com', title: 'second' }, ['email']);

      const rows = await driver.find(BACKED.name, { where: { email: 'ctl@b.com' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('second');
    });

    it('leaves the default `id` merge key working — no conflictKeys, no refusal', async () => {
      await driver.upsert(PLAIN.name, { id: 'os8567_fixed', email: 'id@b.com', title: 'first' });
      await driver.upsert(PLAIN.name, { id: 'os8567_fixed', email: 'id@b.com', title: 'second' });

      const rows = await driver.find(PLAIN.name, { where: { id: 'os8567_fixed' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('second');
    });

    /**
     * The specificity control, and the reason the predicate reads the message
     * rather than the code on BOTH cells: Postgres answers `42P10` here too for
     * an out-of-range `ORDER BY` position, and SQLite answers its generic
     * `SQLITE_ERROR` for a missing table. Either would be swallowed by a
     * code-based test.
     */
    it('does not swallow an unrelated statement failure as this refusal', async () => {
      const err = await captureError(() => driver.upsert('os8567_never_created', { id: 'x' }));

      expect(err).not.toBeNull();
      expect(err!.message).not.toMatch(/Cannot upsert into/);
      expect(err!.code).not.toBe(StandardErrorCode.enum.VALIDATION_ERROR);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// MySQL — the condition cannot arise, proven by what knex COMPILES
// ─────────────────────────────────────────────────────────────────────────

describe('[#8567] MySQL: `onConflict().merge()` compiles the conflict target away', () => {
  /**
   * No server, no connection — `toSQL()` runs the dialect's compiler alone.
   * This is the whole MySQL half of the card's measurement question, and it is
   * answerable exactly because it is a claim about knex rather than about a
   * server nobody here can start.
   */
  const compile = (client: string): string => {
    const k = knex({ client, connection: {} } as any);
    try {
      return k('os8567_plain')
        .insert({ id: '1', email: 'a@b.com', title: 'x' })
        .onConflict(['email'])
        .merge(['title'])
        .toSQL().sql;
    } finally {
      void k.destroy();
    }
  };

  it('emits ON DUPLICATE KEY UPDATE, which takes no conflict target', () => {
    const sql = compile('mysql2');

    expect(sql).toMatch(/on duplicate key update/i);
    // The named key never reaches the server as a TARGET, so the server cannot
    // report that no index backs it — there is nothing for it to look up.
    expect(sql).not.toMatch(/on conflict/i);
    expect(sql).toBe(
      'insert into `os8567_plain` (`email`, `id`, `title`) values (?, ?, ?) ' +
        'on duplicate key update `title` = values(`title`)',
    );
  });

  /**
   * The contrast is the argument: the SAME builder call keeps the target on the
   * dialects that have `ON CONFLICT`. Without this half, the assertion above
   * would be consistent with knex having dropped conflict targets everywhere.
   */
  it('keeps the conflict target on the dialects that have ON CONFLICT', () => {
    expect(compile('pg')).toMatch(/on conflict \("email"\)/i);
    expect(compile('better-sqlite3')).toMatch(/on conflict \(`email`\)/i);
  });
});

/**
 * The live MySQL cell: declared un-run, never quietly dropped.
 *
 * The compile pin above proves the refusal cannot arise on MySQL. It does NOT
 * prove what happens instead, and that question needs a server this container
 * has none of (`mysqld` and `mariadbd` are both absent; only a PHP client
 * library is installed, and the docker daemon is unreachable). Reporting the
 * cell keeps that gap addressable by anyone who has one, instead of leaving a
 * dialect silently uncovered — which is the vacuous-green shape
 * `live-dialect-matrix.testkit.ts` exists to prevent.
 */
const MYSQL_CELL = DIALECT_CELLS.find((c) => c.id === 'mysql')!;
if (!MYSQL_CELL.available) {
  declareUnprovisionedCell(MYSQL_CELL, 'unbacked conflict-target refusal (behaviour never observed)');
}
