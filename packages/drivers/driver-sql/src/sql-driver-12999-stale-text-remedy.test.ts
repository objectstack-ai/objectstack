// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12999 — the refusal message for an unkeyable TEXT column has TWO causes, and
 * for one of them the advice it gave was a no-op.
 *
 * ## The defect
 *
 * `explainUnkeyableTextColumn` rendered every `ER_BLOB_KEY_WITHOUT_LENGTH` /
 * `ER_TOO_LONG_KEY` index refusal as "the field declares no `maxLength` …
 * declare `maxLength` on the field(s)". True at CREATE time. False on the
 * UPGRADE path, in both halves: once a release adds the bound (#12978 did
 * exactly that for five `sys_notification_*` objects), the field DOES declare
 * one — but the additive sync never rewrites a column's type, so the physical
 * column stays TEXT, the index is refused again on every boot, and the message
 * tells the operator to do the thing they already did. In production that reads
 * as the fix they just deployed being broken.
 *
 * ## Why the pins run HERE, on SQLite, and what that does NOT cover
 *
 * The branch is a message-rendering decision over two inputs the driver already
 * holds — the physical column type (`columnInfo()`) and the declared field
 * (`managedObjectFields`) — so it is dialect-independent; only the error CODE
 * that triggers it is MySQL's, and it is supplied here as the `cause` the real
 * call site passes through verbatim. What SQLite gives that a stub could not is
 * the FIXTURE: the stale column is produced by really booting the object twice,
 * unbounded then bounded, so the "additive sync never rewrites the column"
 * premise the whole card rests on is measured rather than assumed.
 *
 * ⚠️ Not covered here: the end-to-end MySQL boot in which the server itself
 * raises the refusal. The live cells in `sql-driver-keyed-text-mysql.test.ts`
 * own that path, and they pin the CREATE-path message — which this change must
 * leave byte-identical, and which the counter-pins below assert directly.
 *
 * ## Both directions, deliberately
 *
 * A suite that asserted only the new branch would stay green through a
 * regression that broke the CREATE message — the message that is still correct
 * for every deployment that never had the column. So each new-branch assertion
 * has a counter-pin: unbounded field, and bound past the key ceiling.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { dialectCell } from './live-dialect-matrix.testkit.js';

/** The `cause` the real call site forwards — the server's own refusal object. */
const BLOB_KEY_REFUSAL = {
  code: 'ER_BLOB_KEY_WITHOUT_LENGTH',
  message: "BLOB/TEXT column 'token' used in key specification without a key length",
};

const TABLE = 'os12999_upgraded';
const INDEX = 'idx_os12999_upgraded_token';

/** The release that shipped BEFORE anyone declared a bound. */
const beforeTheBound = () => ({
  name: TABLE,
  fields: { token: { type: 'text' } },
});

/** The release that adds it — the #12978 shape, and the one that must not lie. */
const afterTheBound = () => ({
  name: TABLE,
  fields: { token: { type: 'text', maxLength: 64 } },
  indexes: [{ fields: ['token'], unique: false }],
});

/** Never upgraded: the field genuinely declares nothing. The CREATE path. */
const NEVER_BOUND_TABLE = 'os12999_never_bound';
const neverBound = () => ({
  name: NEVER_BOUND_TABLE,
  fields: { token: { type: 'text' } },
  indexes: [{ fields: ['token'], unique: false }],
});

/**
 * Bounded, but WIDER than a utf8mb4 key part can hold. ⚠️ The false-positive
 * this branch has to avoid: the field declares a `maxLength` and the column is
 * TEXT, yet the column is NOT stale — a fresh create emits TEXT for it too, and
 * converting it to `varchar(1024)` by hand would only trade
 * `ER_BLOB_KEY_WITHOUT_LENGTH` for `ER_TOO_LONG_KEY`. The 768-character ceiling
 * is what this operator needs to read, so this case keeps the CREATE message.
 */
const TOO_WIDE_TABLE = 'os12999_too_wide';
const boundPastTheCeiling = () => ({
  name: TOO_WIDE_TABLE,
  fields: { token: { type: 'text', maxLength: 1024 } },
  indexes: [{ fields: ['token'], unique: false }],
});

/** One stale column and one genuinely unbounded column in the SAME key. */
const MIXED_TABLE = 'os12999_mixed';
const mixedBefore = () => ({
  name: MIXED_TABLE,
  fields: { slug: { type: 'text' }, note: { type: 'text' } },
});
const mixedAfter = () => ({
  name: MIXED_TABLE,
  fields: { slug: { type: 'text', maxLength: 64 }, note: { type: 'text' } },
  indexes: [{ fields: ['slug', 'note'], unique: false }],
});

const explain = (driver: SqlDriver, table: string, columns: string[], index = INDEX) =>
  (driver as any).explainUnkeyableTextColumn(table, index, columns, BLOB_KEY_REFUSAL) as Promise<
    string | null
  >;

const columnType = async (driver: SqlDriver, table: string, column: string) => {
  const info: Record<string, { type?: string }> = await (driver as any).knex(table).columnInfo();
  return String(info[column]?.type ?? '').toLowerCase();
};

describe('unkeyable TEXT column: the upgrade path names the real remedy (#12999)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  it('produces the stale-column remedy for a bounded field over a TEXT column', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());

    // The upgrade, performed rather than described: boot the old release, then
    // the new one on the same database.
    await driver.initObjects([beforeTheBound()]);
    expect(await columnType(driver, TABLE, 'token')).toBe('text');
    await driver.initObjects([afterTheBound()]);

    // ⭐ The premise the whole card rests on, measured: the bound is declared
    // and the physical column is STILL TEXT. If the additive sync ever starts
    // rewriting the column, this assertion is the one that should fail first.
    expect(await columnType(driver, TABLE, 'token')).toBe('text');
    expect((driver as any).declaredFieldsFor(TABLE).token.maxLength).toBe(64);

    const message = (await explain(driver, TABLE, ['token'])) ?? '';

    // Names the column, the bound it already declares, and that re-declaring is
    // not the fix — the sentence whose absence is the reported defect.
    expect(message).toContain('"token"');
    expect(message).toContain('maxLength: 64');
    expect(message).toMatch(/ALREADY declares a usable `maxLength`/);
    expect(message).toMatch(/re-declaring `maxLength` changes nothing/);

    // The remedy, in full. Each clause is separately load-bearing: an operator
    // who converts the column without restating NOT NULL / DEFAULT on MySQL
    // ends up WORSE off than the no-op, having silently dropped the default.
    expect(message).toMatch(/backup taken first/);
    expect(message).toMatch(/restating the FULL column definition on MySQL/);
    expect(message).toMatch(/MODIFY drops a NOT NULL or DEFAULT you do not repeat/);
    expect(message).toContain('varchar(64)');
    expect(message).toMatch(/next boot create this index/);

    // ⛔ And it does NOT quietly become an instruction the driver will carry out
    // itself: the rewrite needs an exclusive metadata lock, so it stays manual.
    expect(message).toMatch(/does NOT rewrite the column for you/);
    expect(message).toMatch(/exclusive metadata lock/);

    // ⛔ The CREATE-path advice must be GONE from this message — its presence is
    // the misdirection being fixed.
    expect(message).not.toMatch(/declares no `maxLength`/);
    expect(message).not.toMatch(/Declare `maxLength` on the field\(s\)/);
  });

  it('keeps the refusal loud — the index is still absent and said to be', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([beforeTheBound()]);
    await driver.initObjects([afterTheBound()]);

    const message = (await explain(driver, TABLE, ['token'])) ?? '';

    // ⛔ The card's hard fence: naming a better remedy must not soften the
    // report. The index genuinely was not created, and a declared uniqueness
    // that is not enforced is a real durability degradation.
    expect(message).toMatch(/^\[sql-driver\] cannot create index '.+' on ".+"/);
    expect(message).toMatch(/The table exists but this index does NOT/);
    expect(message).toMatch(/currently unenforced/);
    // The anti-workaround note survives too: a prefix index is still refused.
    expect(message).toMatch(/prefix index is deliberately not substituted/);
  });

  // ── counter-pins: the CREATE path must be untouched ──────────────────────

  it('COUNTER-PIN: an unbounded field still gets the original declare-maxLength message', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([neverBound()]);
    expect(await columnType(driver, NEVER_BOUND_TABLE, 'token')).toBe('text');

    const message = (await explain(driver, NEVER_BOUND_TABLE, ['token'])) ?? '';

    expect(message).toMatch(/Column\(s\) "token" are stored as TEXT because the field declares no `maxLength`/);
    expect(message).toMatch(/Declare `maxLength` on the field\(s\) so the column is emitted as varchar\(n\)/);
    expect(message).toContain('#11374');
    // ⛔ The new branch must not reach this deployment: nothing here is stale.
    expect(message).not.toMatch(/ALREADY declares/);
    expect(message).not.toContain('#12999');
  });

  it('COUNTER-PIN: a bound past the 768-character key ceiling is NOT a stale column', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([boundPastTheCeiling()]);
    // A fresh create emits TEXT here too — so the column is current, not stale,
    // and hand-converting it to varchar(1024) would fix nothing.
    expect(await columnType(driver, TOO_WIDE_TABLE, 'token')).toBe('text');

    const message = (await explain(driver, TOO_WIDE_TABLE, ['token'])) ?? '';

    expect(message).toMatch(/wider than 768 characters/);
    expect(message).not.toMatch(/ALREADY declares/);
    expect(message).not.toContain('#12999');
  });

  it('COUNTER-PIN: a table this driver holds no declaration for keeps the CREATE message', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([neverBound()]);

    // Never registered here (ADR-0015 external/federated objects land this way,
    // and so does a shard table, registered under its BASE name): the fields are
    // unavailable, so the branch must degrade rather than guess.
    expect((driver as any).declaredFieldsFor('os12999_unregistered')).toBeUndefined();
    const message = (await explain(driver, 'os12999_unregistered', ['token'])) ?? '';

    expect(message).toMatch(/Declare `maxLength` on the field\(s\)/);
    expect(message).not.toContain('#12999');
  });

  it('names BOTH dispositions when one key column is stale and another is unbounded', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([mixedBefore()]);
    await driver.initObjects([mixedAfter()]);
    expect(await columnType(driver, MIXED_TABLE, 'slug')).toBe('text');
    expect(await columnType(driver, MIXED_TABLE, 'note')).toBe('text');

    const message =
      (await explain(driver, MIXED_TABLE, ['slug', 'note'], 'idx_os12999_mixed_slug_note')) ?? '';

    // The stale half gets the conversion remedy…
    expect(message).toMatch(/"slug" \(declares `maxLength: 64`\)/);
    expect(message).toMatch(/restating the FULL column definition on MySQL/);
    // …and the genuinely unbounded half is still told to declare a bound, so a
    // composite key does not send the operator down one route for both columns.
    expect(message).toMatch(/Column\(s\) "note" in the same key declare no usable bound and DO need `maxLength`/);
    expect(message).toContain('#11374');
  });

  it('still declines to explain a failure that is not the TEXT-key refusal', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([beforeTheBound()]);
    await driver.initObjects([afterTheBound()]);

    // Unchanged gate: this helper speaks only for the two MySQL codes, and the
    // new branch sits behind that same gate rather than beside it.
    const other = await (driver as any).explainUnkeyableTextColumn(TABLE, INDEX, ['token'], {
      code: 'ER_DUP_ENTRY',
    });
    expect(other).toBeNull();
  });
});
