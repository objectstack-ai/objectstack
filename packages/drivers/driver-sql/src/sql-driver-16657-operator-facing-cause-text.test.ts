// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16657] The producer↔consumer pin for `operatorFacingErrorText`.
 *
 * `@objectstack/types` cannot import a driver — every driver depends on it —
 * so the helper that reads the raw-path envelope carries its own copy of the
 * sentence that identifies one. A copy is a phantom check the moment the
 * producer rewords: every fixture that BUILDS the envelope by hand would keep
 * passing, and the only symptom would be a customer's backfill record silently
 * going back to saying nothing.
 *
 * This file is the leg that cannot go stale. It takes a REAL `SqlDriver`
 * refusal — the composition `TursoDriver` remote mode reaches through
 * `SqlDriver.rawStatementFault` as well — and asserts the helper reads the
 * dialect's words out of it. If `rawStatementFaultError` is reworded, this
 * reddens here, naming the helper, rather than in a customer's log a release
 * later.
 *
 * ⛔ It asserts nothing about what the ENVELOPE discloses. That is #16019's
 * disclosure clause and it is unchanged: the message still carries neither the
 * statement nor the diagnostic, which the sibling
 * `sql-driver-16019-raw-statement-fault-envelope.test.ts` owns and this file
 * deliberately does not restate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { operatorFacingErrorText } from '@objectstack/types';
import { SqlDriver } from './index.js';

/** A column no table has — SQLite answers `no such column: foo`, distinctively. */
const MISSING_COLUMN_SQL = 'select foo';

async function faultOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the driver to refuse this statement, but it resolved');
}

/**
 * The driver's log sink is `protected`, so the only way to hold it is from a
 * subclass — the shape the sibling #16019 suite uses. The dialect text is
 * written HERE on any default deployment; a stored record's reader never sees
 * this line, which is the whole card.
 */
class QuietSqlDriver extends SqlDriver {
  constructor() {
    super({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    this.logger = { warn: () => {} };
  }
}

describe('[#16657] a real raw-exec refusal still yields the dialect text to an operator', () => {
  let driver: SqlDriver;

  beforeEach(() => {
    driver = new QuietSqlDriver();
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('the envelope says the composed sentence and the helper says `no such column: foo`', async () => {
    const thrown = (await faultOf(() => driver.execute(MISSING_COLUMN_SQL))) as Error;

    // BEFORE — the message every consumer used to store, unchanged.
    expect(thrown.message).toMatch(/refused to run a raw statement/);
    expect(thrown.message).not.toMatch(/no such column/);

    // AFTER — read off the cause the driver already attached.
    const operatorText = operatorFacingErrorText(thrown);
    expect(operatorText).toContain('no such column: foo');
    expect(operatorText).not.toMatch(/refused to run a raw statement/);
  });

  it('an UNDECLARED throw from the same seam is returned on its own message channel', async () => {
    // The control that proves the pin above reads the declaration and not the
    // shape of any error the seam happens to produce.
    const bare = new Error('connection terminated unexpectedly');

    expect(operatorFacingErrorText(bare)).toBe('connection terminated unexpectedly');
  });
});
