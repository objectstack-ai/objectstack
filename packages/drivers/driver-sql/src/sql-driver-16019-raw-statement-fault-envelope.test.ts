// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16019] `SqlDriver.execute()` — the raw-SQL path every analytics compiler
 * runs on — declares its own fault.
 *
 * ## The gap, measured on this tree
 *
 * The typed read exits terminate in `backendStatementFault`, so a dialect
 * refusal on `find` / `count` / `aggregate` leaves the driver as a declared
 * `DATABASE_ERROR`/500. The raw path had no terminal: `execute()` awaited
 * `knex.raw()` bare, and knex's executor hands back the dialect's own error
 * object — `code: 'SQLITE_ERROR'`, no `status`, and the message
 * `<statement> - <diagnostic>`. Measured on knex 3.3.0 + better-sqlite3:
 *
 * ```
 * select translate('ABC', 'ABC', 'abc') as x - no such function: translate
 * ```
 *
 * The prefix is unconditional (`compileSqlOnError: false` only changes how the
 * statement is formatted; it never drops it), so through knex the HTTP doors'
 * phrasing heuristic withheld this text by ACCIDENT — `startsWith('select ')`
 * — while `no such function:` itself matched nothing, and a transport that
 * hands the engine's text back without a statement (`driver-turso` remote
 * mode, pinned in its own package) reached the same door bare. Neither was a
 * declaration.
 *
 * ## Maintainer ruling 2026-09-06 (decision batch #57, option 3)
 *
 * The substring list in `looksLikeInternalErrorLeak` is not grown. The driver
 * declares its fault and the doors classify on the declaration. These pins
 * are that declaration at the layer that produces it, in every direction that
 * matters: the composed envelope carries `code` + `status` and none of the
 * dialect's words; the dialect error survives whole under a NON-ENUMERABLE
 * `cause`, so cause-following classification (`isMissingTableError`) keeps
 * working; and an error that already declares a status passes through, never
 * double-wrapped.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Restore the bare `await builder` in `execute()` (delete its `try`/`catch`)
 * and the envelope cases go RED on `code` / `status` (`SQLITE_ERROR` and
 * `undefined` in their place) and on the message assertions (the statement and
 * `no such function` are then IN the message). The positive control and the
 * pass-through gate stay GREEN — that leg never hands the gate a knex error.
 * Recorded in the PR, both legs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from './index.js';
import { declaresServerFault, isMissingTableError, looksLikeInternalErrorLeak } from '@objectstack/types';

/** The shape `declaresServerFault` and both HTTP doors read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
  cause?: unknown;
}

/** The statement SQLite refuses — `translate()` is the #16028 fault verbatim. */
const TRANSLATE_SQL = "select translate('ABC', 'ABC', 'abc') as x";

async function faultOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this statement, but it resolved');
}

/**
 * A driver whose log sink is captured, so the server-side copy of the dialect
 * text can be asserted, and whose protected terminal is exposed for the
 * pass-through pin.
 */
class LoggedSqlDriver extends SqlDriver {
  readonly warned: string[] = [];

  constructor() {
    super({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    this.logger = { warn: (msg: string) => { this.warned.push(msg); } };
  }

  terminal(command: string, error: unknown): Error {
    return this.rawStatementFault(command, error);
  }
}

describe('[#16019] SqlDriver.execute() declares a backend refusal as DATABASE_ERROR/500', () => {
  let driver: LoggedSqlDriver;

  beforeEach(() => {
    driver = new LoggedSqlDriver();
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it("the statement SQLite refuses leaves execute() as a declared fault carrying none of the dialect's words", async () => {
    const err = await faultOf(() => driver.execute(TRANSLATE_SQL));

    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
    expect(declaresServerFault(err)).toBe(true);
    expect(err.message).toMatch(/refused to run a raw statement/);
    // Not the statement, not the diagnostic, not the function name we emitted.
    expect(err.message).not.toMatch(/translate/i);
    expect(err.message).not.toMatch(/no such function/i);
    expect(err.message).not.toMatch(/select/i);
  });

  it('the dialect error travels whole under a NON-ENUMERABLE cause — the knex shape, statement prefixed', async () => {
    const err = await faultOf(() => driver.execute(TRANSLATE_SQL));
    const cause = err.cause as WireBearingError;

    expect(cause).toBeInstanceOf(Error);
    // knex 3.3.0's executor: `<formatted statement> - <engine diagnostic>`, unconditionally.
    expect(cause.message).toBe(`${TRANSLATE_SQL} - no such function: translate`);
    expect(cause.code).toBe('SQLITE_ERROR');
    // Readable by code, invisible to serialisation — the same carrier discipline
    // `backendStatementFaultError` applies one terminal over.
    expect(Object.getOwnPropertyDescriptor(err, 'cause')?.enumerable).toBe(false);
    expect(Object.keys(err)).not.toContain('cause');
    expect(JSON.stringify(err)).not.toMatch(/translate/);
  });

  it('the declaration, not the phrasing heuristic, is what withholds it', async () => {
    const err = await faultOf(() => driver.execute(TRANSLATE_SQL));

    // The heuristic never covered the engine's phrase, and the composed message
    // gives it nothing to recognise either: the doors withhold on the declaration.
    expect(looksLikeInternalErrorLeak('no such function: translate')).toBe(false);
    expect(looksLikeInternalErrorLeak(err.message)).toBe(false);
    expect(declaresServerFault(err)).toBe(true);
    // Control: the sibling limb the heuristic DOES cover, so the `false` above is
    // a reading about the phrase and not about a broken probe.
    expect(looksLikeInternalErrorLeak('no such column: bogus_dim')).toBe(true);
  });

  it('writes the statement and the dialect message to the server log — after this change, the only copy', async () => {
    await faultOf(() => driver.execute(TRANSLATE_SQL));

    const line = driver.warned.find((m) => m.includes('DATABASE_ERROR'));
    expect(line).toBeDefined();
    expect(line).toContain('(SQLITE_ERROR)');
    expect(line).toContain(TRANSLATE_SQL);
    expect(line).toContain('no such function: translate');
  });

  it('a missing table on the raw path stays classifiable through `cause` (isMissingTableError)', async () => {
    const err = await faultOf(() => driver.execute('select 1 from nope_16019'));

    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
    expect(err.message).not.toMatch(/nope_16019/);
    expect(isMissingTableError(err, 'nope_16019')).toBe(true);
    // Control: the same envelope is not a missing-table verdict about some
    // OTHER relation — no `DRIVER_TARGETED_TABLE` is declared on this path, so
    // the comparison is the caller's name against the phrase, as before.
    expect(isMissingTableError(err, 'other_16019')).toBe(false);
  });

  it('an error that already declares a status passes through untouched — never double-wrapped', () => {
    const declared = Object.assign(new Error('the Query Protocol has no such function'), {
      code: 'INVALID_QUERY',
      status: 400,
    });

    expect(driver.terminal('select 1', declared)).toBe(declared);
    expect(driver.warned).toHaveLength(0);
  });

  it('POSITIVE CONTROL: a statement the engine runs still resolves with its rows, and logs nothing', async () => {
    const rows: unknown = await driver.execute('select 1 as x');
    const first = Array.isArray(rows) ? rows[0] : (rows as { rows?: unknown[] })?.rows?.[0];

    expect(first).toEqual({ x: 1 });
    expect(driver.warned).toHaveLength(0);
  });
});
