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
 *    all, and the compile pin below checks it.
 *
 * ⚠️ What MySQL does INSTEAD of refusing was left un-asserted by #8567 —
 * correctly, since nobody had watched a MySQL server do it and an assertion
 * written from the compiled SQL alone would be exactly the inferred evidence
 * that card existed to stop accepting. **[#8592] observed it on a live MySQL
 * 8.0.46**: it merged on a unique key the caller never named, rewrote the merged
 * row's primary key, and did not merge on the key it was given.
 *
 * ✅ **[#8621] has since closed that gap from the other end.** MySQL cannot be
 * made to refuse this (the target never reaches the server), so the driver
 * refuses it first: `upsert` consults the table's physical PRIMARY KEY and
 * UNIQUE indexes before compiling, and answers the same sentence this sweep
 * asserts on the other two dialects. The last section of this file is that
 * refusal's pins — rewritten from #8592's characterization, as that card
 * instructed, not relaxed.
 *
 * ✅ **[#8755] has since closed the second half**, on the same introspection:
 * `ON DUPLICATE KEY UPDATE` has no target even when the named one IS backed, so
 * a second UNIQUE key on the table can absorb the conflict. That call is now
 * refused too, with its OWN sentence (#5240 — one condition, one wording; this
 * is a different condition from "no index backs your target" and every remedy it
 * names is different). What is deliberately left merging, and documented rather
 * than silent, is the PRIMARY-KEY-targeted call and the `conflictKeys`-less
 * default — see {@link WRONG_KEY} and the residue pins below.
 *
 * ✅ **[#8622] has since repaired the primary-key half**, and only that half.
 * `id` is now insert-only on the merge path for every dialect, so the pin that
 * measured the rewrite has been rewritten to assert PRESERVATION. It was not a
 * MySQL defect at all: the merge set is built in this process, so the same
 * rewrite was measured on SQLite and live Postgres 16.13 against a properly
 * BACKED conflict target — the supported path, no unbacked target anywhere near
 * it. That is why the repair lives in the sweep above as well, and why it did
 * not have to wait for #8621.
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

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import knex from 'knex';
import { StandardErrorCode } from '@objectstack/spec/api';
import { SqlDriver } from '../src/index.js';
import {
  DIALECT_CELLS,
  declareDialectCell,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

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

    // ───────────────────────────────────────────────────────────────────
    // Pin 4 — [#8622] the merged row keeps its IDENTITY
    // ───────────────────────────────────────────────────────────────────

    /**
     * The control above (`MERGES when a declared unique index does back the
     * conflict target`) asserts the row COUNT and the `title`, and never the
     * `id` — which is exactly why the primary-key rewrite survived a green
     * suite. These pins read the column that control does not.
     *
     * Measured before the fix, on this same backed (i.e. fully supported) path:
     *
     * ```
     * [sqlite] before=[{id:'yMh3oywrp0Z6p-oJ', title:'first'}]
     *          after =[{id:'d8T8rUlTxlRlaUhN', title:'second'}]  idPreserved=false
     * [pg]     before=[{id:'T3AlYiyDi5buzGvW', title:'first'}]
     *          after =[{id:'TvbCTa5mydWPYP76', title:'second'}]  idPreserved=false
     * ```
     *
     * `upsert` mints a nanoid for every call that supplies none, and `id` rode
     * the merge set (`… do update set …, "id" = excluded."id"`), so the LOSING
     * insert's fresh id overwrote the winning row's. Invisible on the default
     * `['id']` conflict target, where both sides hold the same value.
     */
    it('[#8622] preserves the merged row’s primary key across a backed merge', async () => {
      await driver.upsert(BACKED.name, { email: 'pk@b.com', title: 'first' }, ['email']);
      const before = await driver.find(BACKED.name, { where: { email: 'pk@b.com' } });
      expect(before).toHaveLength(1);

      await driver.upsert(BACKED.name, { email: 'pk@b.com', title: 'second' }, ['email']);
      const after = await driver.find(BACKED.name, { where: { email: 'pk@b.com' } });

      // The merge still HAPPENS — the accept set is unchanged by this fix, so a
      // green here must not be reachable by refusing the call or by inserting a
      // second row. Both halves are asserted before the identity is.
      expect(after, 'the backed merge must still collapse to one row').toHaveLength(1);
      expect(after[0].title, 'the mergeable columns must still merge').toBe('second');

      expect(
        after[0].id,
        'the merged row was re-identified — `id` is back in the merge set, so every relationship, ' +
          'audit record and external id mapping pointing at the old row now dangles silently',
      ).toBe(before[0].id);
    });

    /**
     * `created_at` is the sibling exclusion (#7011) and rides the same set, so
     * asserting it here is the cheap proof that the fix widened the existing
     * mechanism rather than special-casing one column somewhere else.
     */
    it('[#8622] keeps `created_at` insert-only alongside it', async () => {
      await driver.upsert(BACKED.name, { email: 'ts@b.com', title: 'first' }, ['email']);
      const before = await driver.find(BACKED.name, { where: { email: 'ts@b.com' } });

      await driver.upsert(BACKED.name, { email: 'ts@b.com', title: 'second' }, ['email']);
      const after = await driver.find(BACKED.name, { where: { email: 'ts@b.com' } });

      const stamp = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
      expect(stamp(after[0].created_at)).toBe(stamp(before[0].created_at));
    });

    /**
     * The exclusion is UNCONDITIONAL, per #7011's ruling for `auto_number`: an
     * explicit payload value does not re-key on merge either. Both spellings are
     * exercised because `upsert` folds the `_id` alias into `id` before the merge
     * set is built (`const { _id, ...rest } = data`) — so the alias branch is
     * covered by the same exclusion, and this is what says so out loud.
     */
    it('[#8622] does not re-key even when the caller supplies an explicit `id` / `_id`', async () => {
      await driver.upsert(BACKED.name, { id: 'os8622_seed', email: 'ex@b.com', title: 'first' }, ['email']);

      await driver.upsert(BACKED.name, { id: 'os8622_other', email: 'ex@b.com', title: 'second' }, ['email']);
      let rows = await driver.find(BACKED.name, { where: { email: 'ex@b.com' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('os8622_seed');

      // The `_id` alias reaches `id` through a different line of `upsert`; it
      // must land on the same exclusion rather than on a second code path.
      await driver.upsert(BACKED.name, { _id: 'os8622_alias', email: 'ex@b.com', title: 'third' }, ['email']);
      rows = await driver.find(BACKED.name, { where: { email: 'ex@b.com' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id, 'the `_id` alias branch re-keyed where `id` did not').toBe('os8622_seed');
      expect(rows[0].title, 'the alias call must still have merged its other columns').toBe('third');
    });

    /**
     * The counterweight, and the reason the three pins above are a repair rather
     * than a capability removal: re-keying a row is still possible, through the
     * call whose entire job is to write the columns it is handed. This is
     * #7011's own framing — `update()` is the deliberate path — and it is
     * measured here rather than asserted, on both cells.
     */
    it('[#8622] leaves `update()` as the deliberate re-key path', async () => {
      await driver.create(BACKED.name, { id: 'os8622_from', email: 'rekey@b.com', title: 'x' });

      await driver.update(BACKED.name, 'os8622_from', { id: 'os8622_to' });

      const rows = await driver.find(BACKED.name, { where: { email: 'rekey@b.com' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id, '`update()` must still be able to re-key a row deliberately').toBe('os8622_to');
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// [#8622] The branch the `id` exclusion made REACHABLE
// ─────────────────────────────────────────────────────────────────────────

/**
 * `upsert` builds its merge set as "every formatted column that is not
 * insert-only", and falls back to a bare `insertion.merge()` when that set comes
 * out empty. A bare `merge()` is merge-**ALL** — it re-admits every insert-only
 * column — and before the `id` exclusion it was DEAD code: `id` is in every
 * payload (minted when absent) and was always mergeable, so the set could never
 * empty.
 *
 * Excluding `id` woke it up. Measured on live Postgres 16.13 with an object
 * whose only non-`id` column is an `auto_number`, mid-fix:
 *
 * ```
 * upsert({ email:'f@b.com' }, ['email'])   -> seeded, case_no=0003
 * upsert({ id: <seeded id> },  ['id'])     -> ok rows=1 idPreserved=true
 *                                             case_no 0003 -> 0004   ← #7011 defeated
 * ```
 *
 * `formatted` was `{ id, case_no }`, both insert-only, so the fallback fired and
 * merge-ALL rewrote the autonumber from the reservation the losing insert had
 * just burned. SQLite never reaches it — `stampInsertTimestamps` puts a mergeable
 * `updated_at` in the payload on that dialect — which is precisely the kind of
 * one-cell blind spot the dialect matrix exists for.
 *
 * The remedy falls back to the CONFLICT-TARGET columns present in the payload
 * instead: on a conflict those matched by definition, so `excluded.<target>` is
 * the stored value and the UPDATE is a provable no-op. It also reproduces the
 * exact SQL `main` emits for this shape (`merge(['id'])`, `id` having been
 * `main`'s only mergeable column here), so this file's subject — the PR's net
 * behavioural delta — is the `id` exclusion and nothing else.
 *
 * These pins therefore guard #7011, not #8622: they go red if the `id` exclusion
 * is ever landed without the fallback that pairs with it.
 */
const EXHAUSTED = {
  name: 'os8622_exhausted',
  fields: {
    email: { type: 'string', unique: true },
    case_no: { type: 'auto_number', format: 'CASE-{0000}' },
  },
} as any;

for (const cell of DIALECT_CELLS) {
  if (!ON_CONFLICT_DIALECTS.has(cell.id)) continue;
  declareDialectCell(cell, 'insert-only exhaustion on the upsert merge path', declareExhaustionPins);
}

function declareExhaustionPins(cell: DialectCell): void {
  describe(`[#8622] SqlDriver.upsert — every column insert-only (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: any;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = (driver as any).knex;
      await knexInstance.schema.dropTableIfExists(EXHAUSTED.name);
      await driver.initObjects([EXHAUSTED]);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(EXHAUSTED.name).catch(() => {});
      await driver?.disconnect?.();
    });

    it('does not rewrite the row’s `auto_number` when nothing is left to merge', async () => {
      await driver.upsert(EXHAUSTED.name, { email: 'ex@b.com' }, ['email']);
      const before = await driver.find(EXHAUSTED.name, { where: { email: 'ex@b.com' } });
      expect(before).toHaveLength(1);

      // A payload of `{ id }` alone: after the exclusion every formatted column
      // is insert-only, which is what empties the merge set.
      await driver.upsert(EXHAUSTED.name, { id: before[0].id }, ['id']);
      const after = await driver.find(EXHAUSTED.name, { where: { email: 'ex@b.com' } });

      expect(after, 'the upsert must still resolve to one row').toHaveLength(1);
      expect(
        after[0].case_no,
        'the merge-ALL fallback fired and renumbered the row — #7011’s exclusion is defeated ' +
          'whenever the insert-only set covers every column in the payload',
      ).toBe(before[0].case_no);
      expect(after[0].id).toBe(before[0].id);
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

// ─────────────────────────────────────────────────────────────────────────
// [#8592] MySQL — what happens INSTEAD of the refusal, now observed
// ─────────────────────────────────────────────────────────────────────────

/**
 * ✅ **[#8621] has landed: these are CONTRACT pins now, not characterization.**
 * #8592 wrote this section as a record of what MySQL 8.0 does with a conflict
 * target no index backs, and said in as many words that the pins would go red
 * when the pre-flight refusal landed and must then be rewritten to the refusal
 * rather than relaxed. That is this rewrite. `SqlDriver.upsert` now consults the
 * table's physical PRIMARY KEY and UNIQUE indexes BEFORE compiling on MySQL, and
 * answers the same `VALIDATION_ERROR` / 400 sentence SQLite and Postgres already
 * answer for the same mistake (#5240 — one condition, one wording).
 *
 * Why a pre-flight and not the existing catch: that catch classifies an error
 * the SERVER raised, and on MySQL no error is ever raised — knex compiles the
 * conflict target away entirely (the compile pin above proves it with no server
 * at all), so there is nothing to classify. The full mechanism argument, and why
 * the pre-flight runs on MySQL alone, is on `assertConflictTargetBacked` in
 * `sql-driver.ts`. The negative control for "MySQL alone" is in the sweep at the
 * top of this file: on SQLite and Postgres the refusal still arrives with the
 * SERVER's own sentence attached as `cause`, which only the reactive path can
 * produce.
 *
 * ✅ **[#8622]'s primary-key pin was already a contract before this card**, and
 * it stays one, with its assertion untouched. What moved is the FIXTURE it runs
 * on, of necessity: it pinned identity preservation across a merge on a key the
 * caller never named, and on the mismatched table that call is now REFUSED, so
 * the phenomenon it measures no longer occurs there. It runs on
 * {@link WRONG_KEY} below instead — the table where a wrong-key merge still
 * happens after this card (both business columns unique, so the named target is
 * backed and the pre-flight passes it; see #8755). Same claim, same strength,
 * same failure message; a fixture that can still exhibit the behaviour.
 *
 * ⚠️ **[#8755] moved that same pin a SECOND time, one step further, and for the
 * same reason.** #8755 refuses the two-unique-key call as well, so naming
 * `email` on {@link WRONG_KEY} no longer merges either. The pin now runs on the
 * `conflictKeys`-LESS default call against that table — the shape no pre-flight
 * has ever probed, where MySQL still merges on whichever UNIQUE key collides.
 * Measured on live MySQL 8.0.46 while implementing #8755, and it is the same
 * phenomenon: one row, merged on `tax_id`, the stored `id` surviving. If a later
 * card removes THAT wrong-key merge too, this pin moves again rather than being
 * deleted — it is #8622's only MySQL-cell coverage of a landed fix.
 *
 * # How this was measured
 *
 * #8567 left the MySQL half as an inference from compiled SQL — "merges on
 * whichever unique key the row happens to collide with" — and said so, because
 * inferred dialect behaviour is not evidence. This card observed it instead, on
 * a real server raised in the dev container: system MySQL 8.0.46 (Ubuntu noble
 * `mysql-server`), `mysqld --daemonize`, `default_time_zone='+08:00'`, driven
 * through the same knex + `mysql2` path `upsert` takes. CI's
 * `Temporal Conformance (live PG + MySQL)` job runs this same cell against
 * `mysql:8.0`.
 *
 * The table: `email` is the column the CALLER names in `conflictKeys` and has no
 * unique index; `tax_id` carries the only unique index. Verified DDL:
 *
 * ```
 * CREATE TABLE `os8592_mismatched` (
 *   `id` varchar(255) NOT NULL, … `email` varchar(255) DEFAULT NULL,
 *   `tax_id` varchar(255) DEFAULT NULL, …
 *   PRIMARY KEY (`id`),
 *   UNIQUE KEY `uniq_os8592_mismatched_tax_id` (`tax_id`)
 * )
 * ```
 *
 * # What the server did — three facts, all worse than "does not refuse"
 *
 * ```
 * seed  upsert({email:'a@b.com',     tax_id:'T-1', title:'first'},  ['email'])
 *       -> RESOLVED. rows=[{id:'VBjOQwQp3uTtewte', email:'a@b.com', tax_id:'T-1'}]
 * B     upsert({email:'other@b.com', tax_id:'T-1', title:'second'}, ['email'])
 *       -> RESOLVED. rows=[{id:'RnSaXzGO69OKkP_D', email:'other@b.com', tax_id:'T-1'}]
 *          ONE row. Merged on `tax_id` — which the caller never named — across two
 *          DIFFERENT `email` values. And the surviving row's PRIMARY KEY changed.
 * D     seed then upsert({email:'a@b.com', tax_id:'T-2'}, ['email'])
 *       -> RESOLVED. TWO rows, both `email='a@b.com'`: the merge the caller asked
 *          for did not happen either.
 * ```
 *
 * The identical first call is refused on SQLite and Postgres with
 * `VALIDATION_ERROR` / 400 (the sweep above). So MySQL fails in both directions
 * at once: it merges where the other two refuse, and it does not merge on the key
 * it was told to merge on. The card's inference was right about the wrong-key
 * merge and did not contain the primary-key rewrite, which is the sharpest edge —
 * the row's identity is silently replaced, so anything holding the old `id`
 * dangles with no error anywhere.
 *
 * ✅ **[#8622] repaired that third fact; the transcript above is left verbatim**
 * because it is a record of what was measured on 2026-08-14, not a description
 * of current behaviour. Read the `id` values in it as historical. The repair was
 * NOT MySQL-specific and did not need a live MySQL to find: the same rewrite
 * reproduced on SQLite and live Postgres 16.13 against a *backed* conflict
 * target, because `id` was in the merge set this driver builds before any server
 * is involved.
 *
 * ✅ **[#8621] then removed facts one and two from this table**, by refusing the
 * call before it is compiled. The transcript above stays verbatim for the same
 * reason: it is what was measured on 2026-08-14, and what the refusal now
 * prevents. Re-measured on the same live MySQL 8.0.46 while implementing #8621 —
 * every line of it reproduced against `main` before the fix, and the suite below
 * is the after.
 *
 * # Reverse verification — direction predicted BEFORE running it
 *
 * Predicted, with the fix committed first and then the `this.isMysql` guard on
 * the pre-flight call site inverted to `!this.isMysql`: the four MySQL pins
 * below go RED (the refusal stops arriving, the wrong-key merge and the
 * duplicate-`email` rows come back), and — the half that makes it a *direction*
 * rather than a tautology — the SQLite sweep at the top of this file goes red
 * TOO, but differently: its refusal pins stay green (the reactive catch still
 * answers) while its `cause` pin fails, because the pre-flight now answers first
 * and its cause is the driver's own introspection sentence, not the server's
 * `insert into … on conflict …`. That asymmetry is the evidence the MySQL-only
 * gate is doing something: one dialect loses the refusal, the other loses only
 * the server's text. Measured; it matched.
 */
const MYSQL_CELL = DIALECT_CELLS.find((c) => c.id === 'mysql')!;

/** The named conflict target is `email`; the only unique index is on `tax_id`. */
const MISMATCHED = {
  name: 'os8592_mismatched',
  fields: {
    email: { type: 'string' },
    tax_id: { type: 'string', unique: true },
    title: { type: 'string' },
  },
} as any;

/**
 * [#8621 → #8755] Both business columns unique. The named target `email` IS
 * backed, so #8621's pre-flight passes the call — and MySQL then merges it on
 * whichever unique index the row actually collides with, which is the whole of
 * #8755.
 *
 * **This is now the REFUSAL fixture for #8755**: naming a non-primary target on
 * this table is refused before compiling, because `uniq_os8621_wrong_key_tax_id`
 * can absorb the conflict instead of the named `uniq_os8621_wrong_key_email`.
 *
 * It remains the wrong-key-MERGE fixture too, on the two shapes #8755
 * deliberately does not refuse and documents as the dialect's residue: the
 * `conflictKeys`-less default, and an explicitly named PRIMARY KEY. That is
 * where #8622's identity pin lives now.
 */
const WRONG_KEY = {
  name: 'os8621_wrong_key',
  fields: {
    email: { type: 'string', unique: true },
    tax_id: { type: 'string', unique: true },
    title: { type: 'string' },
  },
} as any;

/**
 * [#8755] The DISCRIMINATING CONTROL the ruling names first: one unique key
 * besides the primary, and the caller names exactly it.
 *
 * This is the common shape — a business object with one natural key — and it
 * must keep merging, or the refusal is a blanket ban on `conflictKeys` upserts
 * over MySQL rather than the narrow rule that was ruled. It is a table of its
 * own rather than a reuse of {@link MISMATCHED} with `['tax_id']` (which has the
 * same physical shape today) precisely so the control cannot be weakened by a
 * later edit to a fixture that exists to be mismatched.
 */
const SINGLE_KEY = {
  name: 'os8755_single_key',
  fields: {
    email: { type: 'string', unique: true },
    title: { type: 'string' },
  },
} as any;

declareDialectCell(
  MYSQL_CELL,
  'unbacked conflict-target refusal (pre-flight, MySQL)',
  declareMysqlPreflightRefusal,
);

function declareMysqlPreflightRefusal(cell: DialectCell): void {
  describe(`[#8621] SqlDriver.upsert — MySQL refuses an unbacked conflict target (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: any;

    const rows = async (object: string = MISMATCHED.name): Promise<any[]> => {
      const found = await driver.find(object, {});
      return [...found].sort((a: any, b: any) => String(a.tax_id).localeCompare(String(b.tax_id)));
    };

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = (driver as any).knex;
      await knexInstance.schema.dropTableIfExists(MISMATCHED.name);
      await knexInstance.schema.dropTableIfExists(WRONG_KEY.name);
      await knexInstance.schema.dropTableIfExists(SINGLE_KEY.name);
      await driver.initObjects([MISMATCHED, WRONG_KEY, SINGLE_KEY]);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(MISMATCHED.name).catch(() => {});
      await knexInstance?.schema.dropTableIfExists(WRONG_KEY.name).catch(() => {});
      await knexInstance?.schema.dropTableIfExists(SINGLE_KEY.name).catch(() => {});
      await driver?.disconnect?.();
    });

    // The live cells share one database with every other suite in this package,
    // so each case starts from an empty table rather than from its neighbour.
    beforeEach(async () => {
      await knexInstance(MISMATCHED.name).delete();
      await knexInstance(WRONG_KEY.name).delete();
      await knexInstance(SINGLE_KEY.name).delete();
    });

    /**
     * ① of the three consequences #8592 recorded: the identical call that is
     * `VALIDATION_ERROR` / 400 on SQLite and Postgres RESOLVED here.
     *
     * `code` AND `status`, never a bare `rejects.toThrow()`: a driver that threw
     * some other error for this input — an unknown column, a dead connection —
     * would satisfy a bare throw assertion while the accept set had not moved at
     * all. The negative assertions name what the refusal replaces on this cell,
     * which is not an error code but the absence of one.
     */
    it('refuses the unbacked conflict target, with the same `code` and `status` as the other dialects', async () => {
      const err = await captureError(() =>
        driver.upsert(MISMATCHED.name, { email: 'a@b.com', tax_id: 'T-1', title: 'first' }, ['email']),
      );

      expect(
        err,
        'MySQL accepted an unbacked conflict target — the pre-flight did not run, or judged a ' +
          'target backed that no PRIMARY KEY or UNIQUE index covers (#8621)',
      ).not.toBeNull();
      expect(err!.code).toBe(StandardErrorCode.enum.VALIDATION_ERROR);
      expect(err!.status).toBe(400);
      expect(err!.message).toMatch(new RegExp(MISMATCHED.name));
      expect(err!.message).toMatch(/email/);
      expect(err!.message).toMatch(/unique/i);
    });

    /**
     * #5240 — one condition, one wording, and the sentence must not name an
     * engine. This is the assertion that makes the card's claim ("all three
     * dialects answer the same sentence for the same mistake") checkable: it is
     * the identical string the sweep at the top of this file asserts on SQLite
     * and Postgres, with only the object name differing.
     */
    it('answers the same sentence SQLite and Postgres answer — no dialect named', async () => {
      const err = await captureError(() =>
        driver.upsert(MISMATCHED.name, { email: 'a@b.com', tax_id: 'T-1', title: 'first' }, ['email']),
      );

      expect(err!.message.split('. ')[0] + '.').toBe(
        `Cannot upsert into "${MISMATCHED.name}" on conflict keys ("email"): no PRIMARY KEY or UNIQUE ` +
          'index backs them, so the merge target does not exist and the database refuses the statement.',
      );
      expect(err!.message).not.toMatch(/SQLite|Postgres|MySQL/i);
    });

    /**
     * ② and ③ of #8592's consequences, killed at the root: the refusal happens
     * BEFORE the statement is compiled, so nothing is written at all.
     *
     * This is the assertion that distinguishes a pre-flight from a post-hoc
     * classification. A refusal thrown after the write would satisfy every
     * envelope pin above while the wrong row sat in the table — which is
     * precisely the shape of the defect, since MySQL's own answer was a
     * successful wrong write.
     */
    it('writes NOTHING — the refusal lands before the statement is compiled', async () => {
      await captureError(() =>
        driver.upsert(MISMATCHED.name, { email: 'a@b.com', tax_id: 'T-1', title: 'first' }, ['email']),
      );

      expect(
        await rows(),
        'the refused upsert still inserted a row — the pre-flight is running after the write, ' +
          'not before it',
      ).toHaveLength(0);
    });

    /**
     * ③, stated as the observable #8592 named: two rows sharing the `email` the
     * caller asked to merge on. It is gone because the call is REFUSED — not
     * because merging changed — and this case asserts both halves so a future
     * change that silently starts merging on `email` cannot pass it either.
     */
    it('cannot produce duplicates on the named key — both calls are refused', async () => {
      const first = await captureError(() =>
        driver.upsert(MISMATCHED.name, { email: 'a@b.com', tax_id: 'T-1', title: 'first' }, ['email']),
      );
      const second = await captureError(() =>
        driver.upsert(MISMATCHED.name, { email: 'a@b.com', tax_id: 'T-2', title: 'second' }, ['email']),
      );

      expect(first!.code).toBe(StandardErrorCode.enum.VALIDATION_ERROR);
      expect(second!.code).toBe(StandardErrorCode.enum.VALIDATION_ERROR);
      expect(
        await rows(),
        'this is the two-rows-on-one-email observable #8592 measured; after #8621 the table must ' +
          'be empty, because neither call was ever executed',
      ).toHaveLength(0);
    });

    /**
     * The payload contract the refusal already keeps on the other two dialects,
     * asserted here because this cell's `cause` is BUILT rather than caught: the
     * pre-flight has no server error to attach, so it attaches the introspected
     * keys instead. Schema identifiers are the ground truth an operator acts on
     * — the MySQL counterpart of the server sentence — and row values are not.
     */
    it('keeps row values out of the message, and puts the introspected keys on `cause`', async () => {
      const err = await captureError(() =>
        driver.upsert(MISMATCHED.name, { email: 'leaked@example.com', tax_id: 'T-9', title: 'secret-title' }, ['email']),
      );

      expect(err!.message).not.toContain('leaked@example.com');
      expect(err!.message).not.toContain('secret-title');
      expect(err!.message).not.toMatch(/insert into/i);

      const causeText = String((err!.cause as Error | undefined)?.message);
      expect(causeText).toMatch(/uniq_os8592_mismatched_tax_id/);
      expect(causeText).toMatch(/PRIMARY/);
      expect(causeText).not.toContain('leaked@example.com');
      expect(causeText).not.toContain('secret-title');
    });

    /**
     * The control that stops "refuse more" from passing trivially: a conflict
     * target a UNIQUE index really does back must still merge, on the same
     * table, through the same pre-flight. Without it, a pre-flight that refused
     * every `conflictKeys` upsert would satisfy every pin above while having
     * destroyed the capability the driver exists to provide.
     */
    it('MERGES when a declared unique index does back the conflict target', async () => {
      await driver.upsert(MISMATCHED.name, { email: 'a@b.com', tax_id: 'T-1', title: 'first' }, ['tax_id']);
      await driver.upsert(MISMATCHED.name, { email: 'a@b.com', tax_id: 'T-1', title: 'second' }, ['tax_id']);

      const after = await rows();
      expect(after, 'the backed conflict target must still merge').toHaveLength(1);
      expect(after[0].title).toBe('second');
    });

    /**
     * The second control: the PRIMARY KEY, named EXPLICITLY. The pre-flight only
     * runs when the caller supplies `conflictKeys`, so this is the case that
     * proves the primary key is recognised by introspection rather than skipped
     * by the default-path short circuit below.
     */
    it('accepts the primary key as an explicit conflict target', async () => {
      await driver.upsert(MISMATCHED.name, { id: 'os8621_pk', email: 'pk@b.com', tax_id: 'T-5', title: 'first' }, ['id']);
      await driver.upsert(MISMATCHED.name, { id: 'os8621_pk', email: 'pk@b.com', tax_id: 'T-5', title: 'second' }, ['id']);

      const after = await rows();
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe('os8621_pk');
      expect(after[0].title).toBe('second');
    });

    /**
     * ✅ **[#8622] This one pin is no longer a defect characterization.** #8592
     * measured `id` being replaced here and wrote the pin as `not.toBe`, with a
     * failure message instructing whoever fixed it to rewrite the pin to describe
     * the repair. That is this rewrite.
     *
     * The cause was never MySQL's: `upsert` mints a nanoid for every call that
     * supplies none, and `id` rode the merge set, so `on duplicate key update …
     * id = values(id)` wrote the LOSING insert's fresh id over the stored row.
     * `id` is now insert-only (`insertOnlyUpsertColumns`), on every dialect.
     *
     * ⚠️ **Un-run where it was written, and RUN here.** The #8622 container
     * could raise SQLite and Postgres 16.13 but not MySQL — no `mysqld` — so
     * this assertion was carried for the MySQL cell on the driver-level argument
     * (the merge set is built in this process, before any dialect sees a
     * statement) and its docblock named CI as the first runner that would
     * actually execute it. #8621's container raised MySQL 8.0.46 for real and
     * executed it: **green**, the driver-level reasoning holds on MySQL too. The
     * standing instruction survives unchanged — if CI ever disagrees, that is a
     * card of its own; do not relax this back to `not.toBe` without one.
     *
     * ⚠️ **[#8621] moved this pin's FIXTURE, and nothing else.** It measures
     * identity preservation ACROSS a merge on a key the caller never named, and
     * on {@link MISMATCHED} that call is now refused before it runs — the
     * phenomenon is gone from that table, so the pin cannot live there.
     *
     * ⚠️ **[#8755] moved the fixture again, for the same reason and no other.**
     * Naming `email` on {@link WRONG_KEY} is refused now too, so the call that
     * used to exhibit the wrong-key merge here is gone as well. The surviving
     * shape is the `conflictKeys`-LESS default: no pre-flight has ever probed it
     * (the driver's own `['id']`), the minted id cannot collide, and MySQL
     * merges on whichever UNIQUE key does — measured on live MySQL 8.0.46 while
     * implementing #8755. The assertion, its strength and its failure message
     * are untouched: deleting it, or weakening it to fit the refusal, would have
     * dropped #8622's only MySQL-cell coverage of a landed fix.
     */
    it('KEEPS the surviving row’s primary key, even merging on that wrong key', async () => {
      await driver.upsert(WRONG_KEY.name, { email: 'a@b.com', tax_id: 'T-1', title: 'first' });
      const seededId = (await rows(WRONG_KEY.name))[0].id;

      await driver.upsert(WRONG_KEY.name, { email: 'other@b.com', tax_id: 'T-1', title: 'second' });
      const merged = (await rows(WRONG_KEY.name))[0];

      expect(
        merged.id,
        'the merged row was re-identified — `id` is back in the merge set (#8622), so every ' +
          'relationship, audit record and external id mapping pointing at the old row now dangles',
      ).toBe(seededId);

      // The wrong-key merge itself is UNCHANGED and still wrong: one row, and
      // the columns that are not insert-only still took the losing insert's
      // values. Without this half, the pin above would also pass if the merge
      // had simply stopped happening.
      expect(merged.title, 'the mergeable columns must still merge — only identity is excluded').toBe('second');
      expect(merged.email).toBe('other@b.com');
    });

    /**
     * ✅ **[#8755] The condition #8621 left standing, now refused.** This was a
     * characterization pin ("still merges on another unique key when the NAMED
     * target is backed") whose failure message said that if it ever went red the
     * pin — not the behaviour — was the thing to rewrite. That is this rewrite.
     *
     * `email` IS backed here, so #8621's arm passes the call. What refuses it is
     * the second arm: `uniq_os8621_wrong_key_tax_id` is a UNIQUE key outside the
     * named target, `ON DUPLICATE KEY UPDATE` carries no target, and MySQL would
     * therefore merge on whichever of the two collided first — measured on live
     * MySQL 8.0.46 before the fix as ONE row, merged on `tax_id`, across two
     * different values of the key the caller named.
     *
     * `code` AND `status`, never a bare `rejects.toThrow()`: an unrelated failure
     * (a dead connection, an unknown column) would satisfy a bare throw while the
     * accept set had not moved at all.
     */
    it('[#8755] REFUSES the upsert when a second UNIQUE key can absorb the conflict', async () => {
      const err = await captureError(() =>
        driver.upsert(WRONG_KEY.name, { email: 'a@b.com', tax_id: 'T-1', title: 'first' }, ['email']),
      );

      expect(
        err,
        'MySQL accepted a conflict target another UNIQUE key can absorb — the second arm of the ' +
          'pre-flight did not run (#8755)',
      ).not.toBeNull();
      expect(err!.code).toBe(StandardErrorCode.enum.VALIDATION_ERROR);
      expect(err!.status).toBe(400);
      expect(
        await rows(WRONG_KEY.name),
        'the refused upsert still wrote — the second arm is running after the statement, not before it',
      ).toHaveLength(0);
    });

    /**
     * [#8755] The ruling requires the message to NAME the colliding key and to
     * state the way out. Asserted as text because an untested message drifts
     * into uselessness — and because the whole reason A was ruled over B is that
     * a refusal an author can read beats a merge they cannot see.
     */
    it('[#8755] names the second UNIQUE key and both workarounds in the message', async () => {
      const err = await captureError(() =>
        driver.upsert(WRONG_KEY.name, { email: 'a@b.com', tax_id: 'T-1', title: 'first' }, ['email']),
      );

      // The colliding key, by the name an operator will find in SHOW INDEXES —
      // and its column, since the name alone is not actionable on a table whose
      // indexes were created by hand.
      expect(err!.message).toContain('uniq_os8621_wrong_key_tax_id');
      expect(err!.message).toContain('tax_id');
      // The named target, so the sentence says which call is being refused.
      expect(err!.message).toContain('"email"');
      expect(err!.message).toContain(WRONG_KEY.name);
      // Workaround ①: drop or rename the extra key. Workaround ②: a dialect
      // without the limitation, named rather than alluded to.
      expect(err!.message).toMatch(/drop(ping)? or renam/i);
      expect(err!.message).toMatch(/SQLite and PostgreSQL/);
      expect(err!.message).toMatch(/ON DUPLICATE KEY UPDATE/);
      // And the primary-key path, which this refusal deliberately leaves open.
      expect(err!.message).toMatch(/primary key is unaffected/i);
    });

    /**
     * [#8755] The payload contract, on the new arm: schema identifiers are the
     * ground truth an operator acts on, row values are not. Same claim #8621's
     * `cause` pin makes for the unbacked arm, asserted separately because this
     * arm builds a different `cause`.
     */
    it('[#8755] keeps row values out of the refusal, and puts the rival keys on `cause`', async () => {
      const err = await captureError(() =>
        driver.upsert(
          WRONG_KEY.name,
          { email: 'leaked@example.com', tax_id: 'T-9', title: 'secret-title' },
          ['email'],
        ),
      );

      expect(err!.message).not.toContain('leaked@example.com');
      expect(err!.message).not.toContain('secret-title');
      expect(err!.message).not.toMatch(/insert into/i);

      const causeText = String((err!.cause as Error | undefined)?.message);
      expect(causeText).toContain('uniq_os8621_wrong_key_tax_id');
      expect(causeText).not.toContain('leaked@example.com');
      expect(causeText).not.toContain('secret-title');
    });

    /**
     * ✅ **[#8755] THE discriminating control.** One unique key besides the
     * primary, named by the caller: the common shape, and it must still merge.
     *
     * Without this case every pin above is satisfied by a pre-flight that
     * refuses every `conflictKeys` upsert on MySQL — which is option C
     * un-narrowed, the accept-set change the ruling explicitly did not make
     * ("the single-key fast path stays untouched"). Narrowness is the entire
     * reason A was ruled over C, so it is pinned rather than argued.
     */
    it('[#8755] single-unique-key upsert still MERGES — the fast path is untouched', async () => {
      await driver.upsert(SINGLE_KEY.name, { email: 'one@b.com', title: 'first' }, ['email']);
      const err = await captureError(() =>
        driver.upsert(SINGLE_KEY.name, { email: 'one@b.com', title: 'second' }, ['email']),
      );

      expect(
        err,
        'a table whose only UNIQUE key IS the conflict target must never be refused — this is the ' +
          'shape the ruling protects, and refusing it turns A into a blanket ban',
      ).toBeNull();

      const after = await rows(SINGLE_KEY.name);
      expect(after).toHaveLength(1);
      expect(after[0].title).toBe('second');
      expect(after[0].email).toBe('one@b.com');
    });

    /**
     * [#8755] The residue this card deliberately does NOT refuse, pinned so it is
     * documented behaviour rather than an accident nobody measured: an
     * explicitly named PRIMARY KEY on a table that also carries UNIQUE keys.
     *
     * The reasoning is on `refuseAmbiguousConflictTarget` in `sql-driver.ts`. In
     * one line: this call compiles byte-identically to the `conflictKeys`-less
     * default that no pre-flight has ever probed, so refusing the explicit
     * spelling while merging the implicit one would make the accept set a
     * property of how the caller typed the same statement — and the only
     * `conflictKeys` the platform itself issues is exactly this one (the
     * lifecycle archiver's hot→cold copy).
     */
    it('[#8755] leaves an explicitly named PRIMARY KEY merging, UNIQUE keys or not', async () => {
      const err = await captureError(() =>
        driver.upsert(WRONG_KEY.name, { id: 'os8755_pk', email: 'pk@b.com', tax_id: 'T-4', title: 'first' }, ['id']),
      );
      expect(err, 'the primary-key fast path must not be refused').toBeNull();

      await driver.upsert(WRONG_KEY.name, { id: 'os8755_pk', email: 'pk@b.com', tax_id: 'T-4', title: 'second' }, ['id']);

      const after = await rows(WRONG_KEY.name);
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe('os8755_pk');
      expect(after[0].title).toBe('second');
    });

    /**
     * The control, and the reason the pins above are readable as a refusal
     * rather than as a broken cell: the primary-key merge path — the one whose
     * target MySQL's `ON DUPLICATE KEY UPDATE` really does honour, and the one
     * the pre-flight deliberately does not probe — still works on this same
     * driver and this same table.
     */
    it('still merges correctly on the primary key — no conflictKeys, one row', async () => {
      await driver.upsert(MISMATCHED.name, { id: 'os8592_fixed', email: 'id@b.com', tax_id: 'T-7', title: 'first' });
      await driver.upsert(MISMATCHED.name, { id: 'os8592_fixed', email: 'id@b.com', tax_id: 'T-7', title: 'second' });

      const after = await rows();
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe('os8592_fixed');
      expect(after[0].title).toBe('second');
    });
  });
}
