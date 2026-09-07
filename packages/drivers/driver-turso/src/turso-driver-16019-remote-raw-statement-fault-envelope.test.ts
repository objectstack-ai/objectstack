// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16019] `TursoDriver.execute()` in REMOTE mode declares a backend refusal
 * through the base class's raw-path terminal — the BARE shape, closed.
 *
 * ## Why this transport is the bare shape's in-repo producer
 *
 * Local and replica mode run `super.execute()`, i.e. knex, whose executor
 * prefixes the statement to every dialect error (`<statement> - <diagnostic>`)
 * — the "knex shape" `driver-sql`'s own pin covers. Remote mode does not go
 * through knex: `RemoteTransport.execute` hands the `@libsql/client` error back
 * whole. Measured in this container against `@libsql/client` on
 * `file::memory:`:
 *
 * ```
 * LibsqlError  code: 'SQLITE_ERROR'  status: undefined
 * message: "SQLITE_ERROR: no such function: translate"
 * ```
 *
 * No statement, no `status` — so at the HTTP doors it was undeclared, and its
 * text reached the caller or not depending on ONE substring (`sqlite_`) the
 * phrasing heuristic happens to know. The card's own measurement was the
 * shape one step barer still, `Error('no such function: translate')`, which
 * that heuristic does not know at all. The stub below (better-sqlite3 wearing
 * the libsql interface) raises exactly that bare text, so this file drives the
 * card's measured shape through a real driver exit, not a hand-made throw.
 *
 * ## What is pinned
 *
 * The same envelope `SqlDriver.execute()` raises — `DATABASE_ERROR`/500, a
 * composed message with none of the engine's words, the transport's error
 * under a non-enumerable `cause`, the server log holding the only copy of the
 * dialect text — so both transports of this driver leave it with ONE shape.
 * `declaresServerFault` is not imported here: `@objectstack/types` is not a
 * dependency of this package, and the predicate reads exactly the two fields
 * asserted below (`status >= 500` and a non-empty `code`).
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Restore `if (this.isRemote) return this.remoteTransport!.execute(…)` and the
 * envelope cases go RED on `code` (`SQLITE_ERROR` in its place) and `status`
 * (`undefined`), and the message assertions go red because the bare text IS
 * the message. The positive control stays GREEN.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
  cause?: unknown;
}

const TRANSLATE_SQL = "select translate('ABC', 'ABC', 'abc') as x";

async function faultOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this statement, but it resolved');
}

class LoggedTursoDriver extends TursoDriver {
  readonly warned: string[] = [];

  constructor(stub: LibsqlSqliteStub) {
    super({ url: 'libsql://issue-16019.turso.io', client: stub as never });
    this.logger = { warn: (msg: string) => { this.warned.push(msg); } };
  }
}

describe('[#16019] TursoDriver remote — execute() declares a backend refusal as DATABASE_ERROR/500', () => {
  let stub: LibsqlSqliteStub;
  let driver: LoggedTursoDriver;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new LoggedTursoDriver(stub);
    await driver.connect();
    expect(driver.transportMode).toBe('remote');
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  it("the bare engine text the card was filed on leaves execute() as a declared fault carrying none of the engine's words", async () => {
    const err = await faultOf(() => driver.execute(TRANSLATE_SQL));

    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/refused to run a raw statement/);
    expect(err.message).not.toMatch(/translate/i);
    expect(err.message).not.toMatch(/no such function/i);
    expect(err.message).not.toMatch(/select/i);
  });

  it('the transport error travels whole under a NON-ENUMERABLE cause — no statement prefix, the bare shape', async () => {
    const err = await faultOf(() => driver.execute(TRANSLATE_SQL));
    const cause = err.cause as WireBearingError;

    expect(cause).toBeInstanceOf(Error);
    // better-sqlite3's own diagnostic, exactly as the card measured it: no
    // statement in front of it, nothing the doors' `startsWith('select ')` limb
    // could have caught by accident.
    expect(cause.message).toBe('no such function: translate');
    expect(Object.getOwnPropertyDescriptor(err, 'cause')?.enumerable).toBe(false);
    expect(JSON.stringify(err)).not.toMatch(/translate/);
  });

  it('writes the statement and the engine text to the server log — the only copy', async () => {
    driver.warned.length = 0;
    await faultOf(() => driver.execute(TRANSLATE_SQL));

    const line = driver.warned.find((m) => m.includes('DATABASE_ERROR'));
    expect(line).toBeDefined();
    expect(line).toContain(TRANSLATE_SQL);
    expect(line).toContain('no such function: translate');
  });

  it('POSITIVE CONTROL: a statement the engine runs still resolves with its rows through the remote transport', async () => {
    driver.warned.length = 0;
    const rows = await driver.execute('select 1 as x');

    expect(rows).toEqual([{ x: 1 }]);
    expect(driver.warned).toHaveLength(0);
  });
});
