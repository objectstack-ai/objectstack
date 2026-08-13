// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8445] A `conflictKeys` upsert whose target no unique index backs refuses in
 * the ADR-0112 envelope — the LOCAL twin of #8413's remote-face refusal.
 *
 * # What was measured, before the fix
 *
 * `SqlDriver.upsert` let SQLite's error escape exactly as raised. Measured on
 * this face (knex + better-sqlite3), on `origin/main` @ `719a21bf`:
 *
 * ```
 * upsert('plain', { email: 'a@b.com', title: 'x' }, ['email'])
 *   -> THREW name=SqliteError code=SQLITE_ERROR status=undefined
 *      msg=insert into `plain` (`created_at`, `email`, `id`, `title`, `updated_at`)
 *          values ('2026-08-13T…', 'a@b.com', 'ib21mSZ…', 'x', '2026-08-13T…')
 *          on conflict (`email`) do update set … - ON CONFLICT clause does not
 *          match any PRIMARY KEY or UNIQUE constraint
 * ```
 *
 * # Why the payload matters as much as the missing code
 *
 * `mapDataError` builds the envelope from `error.code` / `error.status`. With
 * neither set it falls through to its default branch and serves the thrown
 * message as the entire body — and that message is the STATEMENT, bound values
 * included. So the defect is two things at once: no `code` for any client to
 * branch on, and the SQL text (with row data in it) shipped to the caller.
 * Hence the leak pin below, beside the envelope pin: asserting `code`/`status`
 * alone would let a refusal that still echoed the statement pass.
 *
 * # Every case asserts `code` AND `status`
 *
 * Never a bare `toThrow()` — the un-fixed driver threw for this input too, so
 * `rejects.toThrow()` was green before and after and could not see the defect
 * at all. This is the same rule `sql-driver-date-bucket.test.ts` records for
 * the `code`/`status`-`undefined` fall-through it pins.
 *
 * # The positive control is not optional
 *
 * An implementation that refused EVERY `conflictKeys` upsert would satisfy the
 * refusal pin while having destroyed the capability. The control asserts the
 * same `conflictKeys` upsert MERGES when a declared `unique: true` does back
 * the target — and it is the half that caught the equivalent risk on #8413.
 * The specificity control beside it is its mirror: an unrelated statement
 * failure must still come back as itself, because the recognition is a narrow
 * message match and not a catch-all over `SQLITE_ERROR`.
 *
 * # Reverse verification — direction predicted BEFORE it was run
 *
 * Predicted, with the two helpers' call site removed from `upsert`'s catch (the
 * fix committed first, so the file is restored from a commit that exists):
 * the envelope pin and the leak pin go RED — the envelope pin on its first
 * assertion (`code` → `'SQLITE_ERROR'`, not through any "it resolved" branch,
 * because the un-fixed driver refused this input all along), the leak pin on
 * the statement text reappearing in the caller-visible message. The wording pin
 * goes red with them. Everything else stays GREEN, and that is the half worth
 * predicting: the positive control, the `id`-merge-key control and the
 * specificity control never depended on the fix — they describe behaviour this
 * card does not change, which is precisely what makes them controls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StandardErrorCode } from '@objectstack/spec/api';
import { SqlDriver } from '../src/index.js';

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
  cause?: unknown;
}

/**
 * The card's object: one business key beside an ordinary column, and no tenant
 * column — so `uniqueIndexesFromFields` resolves to the single-column `(email)`
 * form rather than a tenant-scoped composite.
 */
const CONTACT = {
  name: 'crm_contact',
  fields: {
    email: { type: 'string', unique: true },
    title: { type: 'string' },
  },
} as any;

/** The same object with the declaration REMOVED — the un-backed conflict target. */
const PLAIN = {
  name: 'crm_contact_plain',
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

describe('[#8445] SqlDriver.upsert refuses an unbacked conflict target in the ADR-0112 envelope', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([CONTACT, PLAIN]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  // ───────────────────────────────────────────────────────────────────
  // Pin 1 — the envelope
  // ───────────────────────────────────────────────────────────────────

  it('answers a real `code` and `status` — never a raw SqliteError', async () => {
    const err = await captureError(() => driver.upsert(PLAIN.name, { email: 'a@b.com', title: 'x' }, ['email']));

    expect(err).not.toBeNull();
    // The measured defect: `code: 'SQLITE_ERROR'`, `status: undefined`.
    expect(err!.code).toBe(StandardErrorCode.enum.VALIDATION_ERROR);
    expect(err!.status).toBe(400);
    expect(err!.code).not.toBe('SQLITE_ERROR');

    // The message names what an operator has to act on: which object, which
    // keys, and that the remedy is the index rather than a retry.
    expect(err!.message).toMatch(/crm_contact_plain/);
    expect(err!.message).toMatch(/email/);
    expect(err!.message).toMatch(/unique/i);

    // The SQLite ground truth is preserved rather than destroyed — the refusal
    // adds a classification, it does not replace what a DBA needs.
    expect(String((err!.cause as Error | undefined)?.message)).toMatch(/ON CONFLICT clause does not match/i);
  });

  // ───────────────────────────────────────────────────────────────────
  // Pin 2 — the payload: the statement must not travel with the refusal
  // ───────────────────────────────────────────────────────────────────

  it('keeps the SQL statement and its bound values out of the caller-visible message', async () => {
    const err = await captureError(() =>
      driver.upsert(PLAIN.name, { email: 'leaked@example.com', title: 'secret-title' }, ['email']),
    );

    expect(err).not.toBeNull();
    // `mapDataError` serves this string as the whole body for a `code`-less
    // throw; before the fix it was the INSERT, values inlined.
    expect(err!.message).not.toMatch(/insert into/i);
    expect(err!.message).not.toMatch(/excluded\./i);
    expect(err!.message).not.toContain('leaked@example.com');
    expect(err!.message).not.toContain('secret-title');

    // …while the statement is still reachable from the `cause`, which no error
    // mapper puts on the wire.
    expect(String((err!.cause as Error | undefined)?.message)).toMatch(/insert into/i);
  });

  // ───────────────────────────────────────────────────────────────────
  // Pin 3 — one condition, one wording (#5240)
  // ───────────────────────────────────────────────────────────────────

  /**
   * The first sentence is `driver-turso`'s `refuseUnbackedConflictTarget`
   * (#8413), verbatim: `TursoDriver` picks its face from `url`, so this one
   * condition can be answered by either compiler in a single deployment and a
   * second wording would make the answer a property of the connection string.
   *
   * ⚠️ Read what this pin can and cannot do. It is ONE-WAY: it fails if THIS
   * face is reworded, and cannot see a reword of the remote face. The two-way
   * form compares the two RUNTIME messages (the shape
   * `remote-transport-aggregate-function-refusal.test.ts` uses), which needs a
   * package that can import both faces — `driver-sql` cannot import
   * `driver-turso`, and `remote-transport.ts` is deliberately free of knex and
   * of `SqlDriver`, so neither source can hold it. That pin belongs in
   * `driver-turso`, outside this card's declared file surface, and is filed as
   * #8568 rather than smuggled in here.
   */
  it('opens with the remote refusal’s first sentence, word for word', async () => {
    const err = await captureError(() => driver.upsert(PLAIN.name, { email: 'a@b.com', title: 'x' }, ['email']));

    expect(err!.message.split('. ')[0] + '.').toBe(
      'Cannot upsert into "crm_contact_plain" on conflict keys ("email"): no PRIMARY KEY or UNIQUE ' +
        'index backs them, so the merge target does not exist and SQLite refuses the statement.',
    );
  });

  // ───────────────────────────────────────────────────────────────────
  // Pin 4 — the controls: what this card must NOT have changed
  // ───────────────────────────────────────────────────────────────────

  it('MERGES when a declared unique index does back the conflict target', async () => {
    await driver.upsert(CONTACT.name, { email: 'a@b.com', title: 'first' }, ['email']);
    await driver.upsert(CONTACT.name, { email: 'a@b.com', title: 'second' }, ['email']);

    const rows = await driver.find(CONTACT.name, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('second');
  });

  it('leaves the default `id` merge key working — no conflictKeys, no refusal', async () => {
    const created = await driver.upsert(PLAIN.name, { id: 'fixed_id', email: 'a@b.com', title: 'first' });
    expect(created.id).toBe('fixed_id');
    await driver.upsert(PLAIN.name, { id: 'fixed_id', email: 'a@b.com', title: 'second' });

    const rows = await driver.find(PLAIN.name, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('second');
  });

  it('does not swallow an unrelated statement failure as this refusal', async () => {
    // A table that was never created: a different `SQLITE_ERROR` entirely. The
    // recognition matches SQLite's ON CONFLICT sentence, not the generic code,
    // so this must come back as itself.
    const err = await captureError(() => driver.upsert('never_created', { id: 'x' }));

    expect(err).not.toBeNull();
    expect(err!.message).not.toMatch(/Cannot upsert into/);
    expect(err!.code).not.toBe(StandardErrorCode.enum.VALIDATION_ERROR);
  });
});
