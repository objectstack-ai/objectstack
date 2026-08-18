// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9354 — a blocked `os migrate` must FAIL, not hang.
 *
 * The deferred-DDL flush widens legacy MySQL `TIMESTAMP`/`TIME` columns with
 * `ALTER TABLE … MODIFY COLUMN`, which needs an exclusive metadata lock. The
 * session inherited MySQL's default `lock_wait_timeout` — **31,536,000 seconds,
 * one year** — so one other transaction holding a lock on the table parked the
 * ALTER silently for that long. Measured once as a CI stall (a sub-second test
 * blowing a 5000ms budget with no error at all); an operator meets it as
 * `os migrate apply` printing nothing, forever, indistinguishable from a crash.
 *
 * Maintainer ruling, 2026-08-17 (verbatim 「同意」): bound the wait on the
 * session performing the widening, and fail loudly with an ADR-0112 envelope
 * whose code comes from the closed vocabulary and names the lock wait. No retry
 * logic, no configurability.
 *
 * # What this suite pins, and why it is pinned THIS way
 *
 * ⭐ The observable is the **refusal**, never "a `SET SESSION` string was
 * emitted". A suite asserting only that the statement went out passes in full
 * while the operator still hangs — the bound could land on the wrong connection,
 * or the error could still be swallowed by the widening's catch, and every such
 * assertion stays green. So the assertions below are the caller-visible ones:
 * the flush REJECTS, with `code` and `status`, and the message names the wait.
 *
 * The fakes are deliberately shallow. Only two things are replaced — the
 * connection (`withPinnedSession`) and the `information_schema` probe that would
 * need a real MySQL — so the bounding, the 1205 recognition, the envelope and
 * the escape from the swallowing catch all execute for real. `isMysql` is true
 * only INSIDE the widening call, so the rest of the flush runs as the genuine
 * SQLite path it is: a real table, really created, really flushed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';

const WIDGET = {
  name: 'widgets_9354',
  fields: { sku: { type: 'text' }, at: { type: 'datetime' } },
};

/** One statement, tagged with the pinned session it was issued on. */
interface Issued { session: number; sql: string; bindings: unknown[] }

/**
 * MySQL's lock-wait timeout as mysql2 raises it, wrapped the way knex re-throws
 * it — the wrapper is the point: a recognizer reading only the top-level error
 * goes blind here, and blind means back to the year-long hang.
 */
function lockWaitTimeoutError(): Error {
  const driverErr = Object.assign(
    new Error('Lock wait timeout exceeded; try restarting transaction'),
    { errno: 1205, code: 'ER_LOCK_WAIT_TIMEOUT', sqlState: 'HY000' },
  );
  const wrapped = new Error(
    'alter table `widgets_9354` modify column … - Lock wait timeout exceeded',
  );
  // Attached by hand rather than through `new Error(msg, { cause })`: that
  // overload needs the ES2022 lib and this package targets ES2020, so the
  // constructor form does not type-check here. `defineProperty` is the shape the
  // driver's own refusals in `sql-driver.ts` use, and it reproduces what the
  // constructor produces at runtime exactly — including NON-enumerability, which
  // an `Object.assign` spelling would silently get wrong and make this fixture a
  // weaker stand-in for the real knex re-throw than it looks.
  Object.defineProperty(wrapped, 'cause', {
    value: driverErr,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return wrapped;
}

/** The server's default, so the restore has a prior value to put back. */
const MYSQL_DEFAULT_LOCK_WAIT = 31_536_000;

class FakeMysqlDriver extends SqlDriver {
  /** True only while a widening call is in flight — see the file header. */
  private pretendMysql = false;
  private sessions = 0;

  issued: Issued[] = [];
  /** What the ALTER should do; `undefined` = succeed. */
  alterFails: (() => Error) | undefined = lockWaitTimeoutError;
  legacyDatetimeColumns: Array<{ name: string; nullable: boolean }> = [
    { name: 'at', nullable: true },
  ];
  legacyTimeColumns: Array<{ name: string; nullable: boolean }> = [];

  protected override get isMysql(): boolean {
    return this.pretendMysql;
  }

  private async asMysql<T>(fn: () => Promise<T>): Promise<T> {
    this.pretendMysql = true;
    try { return await fn(); } finally { this.pretendMysql = false; }
  }

  protected override async migrateMysqlDatetimeColumns(
    table: string, fields: Record<string, any>,
  ): Promise<void> {
    return this.asMysql(() => super.migrateMysqlDatetimeColumns(table, fields));
  }

  protected override async migrateMysqlTimeColumns(
    table: string, fields: Record<string, any>,
  ): Promise<void> {
    return this.asMysql(() => super.migrateMysqlTimeColumns(table, fields));
  }

  /** The `information_schema` lookups, which need a real MySQL. */
  protected override async legacyMysqlTimestampColumns(): Promise<Array<{ name: string; nullable: boolean }>> {
    return this.legacyDatetimeColumns;
  }

  protected override async legacyMysqlTimeColumns(): Promise<Array<{ name: string; nullable: boolean }>> {
    return this.legacyTimeColumns;
  }

  /**
   * A pinned connection, faked. Every statement records the session number it
   * rode on, which is the ONLY way to prove the `SET SESSION` and the ALTER
   * share a connection — the defect a pooled `knex.raw` would reintroduce
   * invisibly.
   */
  protected override async withPinnedSession<T>(
    fn: (run: (sql: string, bindings?: unknown[]) => Promise<unknown>) => Promise<T>,
  ): Promise<T> {
    const session = ++this.sessions;
    return await fn(async (sql, bindings) => {
      this.issued.push({ session, sql, bindings: bindings ?? [] });
      if (/^select @@session\.lock_wait_timeout/i.test(sql)) {
        return [[{ v: MYSQL_DEFAULT_LOCK_WAIT }]];
      }
      if (/^alter table/i.test(sql) && this.alterFails) throw this.alterFails();
      return [];
    });
  }
}

function makeDriver(): FakeMysqlDriver {
  return new FakeMysqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

/** Create the table, then arm the deferral over the same metadata. */
async function armedFlush(driver: FakeMysqlDriver): Promise<void> {
  await driver.initObjects([WIDGET]);   // table now EXISTS — widening applies
  driver.issued.length = 0;             // drop anything the create path issued
  driver.setDeferredDdl(true);
  await driver.initObjects([WIDGET]);
}

async function caught(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return expect.fail('expected the flush to refuse, but it resolved');
}

const setStatements = (d: FakeMysqlDriver) =>
  d.issued.filter((s) => /^set session lock_wait_timeout/i.test(s.sql));
const alterStatements = (d: FakeMysqlDriver) =>
  d.issued.filter((s) => /^alter table/i.test(s.sql));

describe('[#9354] deferred-DDL flush — a blocked widening ALTER refuses, loudly', () => {
  let driver: FakeMysqlDriver;

  afterEach(async () => {
    await driver.disconnect();
  });

  // ───────────────────────────────────────────────────────────────
  // THE RULING — the refusal itself, as the operator meets it
  // ───────────────────────────────────────────────────────────────

  it('rejects with the ADR-0112 envelope instead of hanging', async () => {
    driver = makeDriver();
    await armedFlush(driver);

    const err = await caught(() => driver.flushDeferredSchemaDdl());

    // The closed-vocabulary pair. `toThrow()` alone would be no pin at all here:
    // the pre-fix driver swallowed this error entirely, and a driver that threw
    // a bare `Error` would satisfy a throw-only assertion while telling the
    // operator, and every programmatic consumer, nothing.
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
  });

  it("names the lock wait, the table and the bound — `os migrate` prints only the message", async () => {
    driver = makeDriver();
    await armedFlush(driver);

    const err = await caught(() => driver.flushDeferredSchemaDdl());

    // `migrate/apply.ts` prints `error.message` and exits 1; `code`/`status`
    // never reach the terminal. So the diagnosis has to live in this sentence.
    expect(err.message).toMatch(/lock_wait_timeout/);
    expect(err.message).toMatch(/metadata lock/i);
    expect(err.message).toContain(WIDGET.name);
    expect(err.message).toContain('120s');
    // It must also say what to DO — the ruling's whole point is an actionable
    // refusal rather than a diagnosable-in-principle one.
    expect(err.message).toMatch(/PROCESSLIST|metadata_locks/);
    // And that nothing was half-applied, so a re-run is obviously safe.
    expect(err.message).toMatch(/No schema change was made/i);
  });

  it('keeps the server error as `cause`, without putting it on the wire', async () => {
    driver = makeDriver();
    await armedFlush(driver);

    const err = await caught(() => driver.flushDeferredSchemaDdl());

    expect((err.cause as any)?.cause?.errno).toBe(1205);
    // Non-enumerable, like every sibling refusal in this file: readable by
    // cause-following predicates, invisible to `JSON.stringify(err)`.
    expect(Object.keys(err)).not.toContain('cause');
  });

  // ───────────────────────────────────────────────────────────────
  // THE BOUND — armed, minutes-scale, and on the ALTER's OWN session
  // ───────────────────────────────────────────────────────────────

  it('arms the bound on the SAME pinned session as the ALTER', async () => {
    driver = makeDriver();
    await armedFlush(driver);
    await caught(() => driver.flushDeferredSchemaDdl());

    const set = setStatements(driver);
    const alter = alterStatements(driver);
    expect(set.length).toBeGreaterThan(0);
    expect(alter).toHaveLength(1);

    // ⭐ The assertion the whole seam exists for. `SET SESSION` is per-connection:
    // issued through the pool it lands on a connection the ALTER never uses, and
    // the migration hangs exactly as before while every other pin here still
    // passes. Same session id, and the bound set BEFORE the ALTER.
    expect(set[0].session).toBe(alter[0].session);
    expect(driver.issued.indexOf(set[0])).toBeLessThan(driver.issued.indexOf(alter[0]));
  });

  it('bounds the wait at 120 seconds, not MySQL\'s one-year default', async () => {
    driver = makeDriver();
    await armedFlush(driver);
    await caught(() => driver.flushDeferredSchemaDdl());

    expect(setStatements(driver)[0].bindings).toEqual([120]);
    expect(setStatements(driver)[0].bindings).not.toEqual([MYSQL_DEFAULT_LOCK_WAIT]);
  });

  it('restores the prior bound, so the pooled connection carries nothing away', async () => {
    driver = makeDriver();
    driver.alterFails = undefined;          // the ALTER succeeds this time
    await armedFlush(driver);
    await driver.flushDeferredSchemaDdl();

    const set = setStatements(driver);
    expect(set).toHaveLength(2);
    expect(set[1].bindings).toEqual([MYSQL_DEFAULT_LOCK_WAIT]);
    // Restored on the same session it was set on — a restore elsewhere would
    // leave the bound live on the connection going back to the pool.
    expect(set[1].session).toBe(set[0].session);
  });

  it('refuses the `Field.time` widening the same way — it takes the same lock', async () => {
    driver = makeDriver();
    driver.legacyDatetimeColumns = [];
    driver.legacyTimeColumns = [{ name: 'at', nullable: true }];
    await armedFlush(driver);

    const err = await caught(() => driver.flushDeferredSchemaDdl());

    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
    expect(alterStatements(driver)[0].sql).toMatch(/time\(3\)/);
  });

  // ───────────────────────────────────────────────────────────────
  // THE BLAST RADIUS — everything else keeps the behaviour it had
  // ───────────────────────────────────────────────────────────────

  it('still swallows a NON-lock-wait failure during the flush', async () => {
    driver = makeDriver();
    driver.alterFails = () => Object.assign(new Error('Unknown column'), { errno: 1054 });
    await armedFlush(driver);

    // The swallow is deliberate and documented: correctness never depended on
    // the widening having run. This ruling escapes exactly ONE condition, and a
    // change that let every failure through would be a different decision.
    await expect(driver.flushDeferredSchemaDdl()).resolves.toBeDefined();
  });

  it('leaves BOOT sync unbounded and swallowing — it is not the flush', async () => {
    driver = makeDriver();
    await driver.initObjects([WIDGET]);
    driver.issued.length = 0;

    // A second boot-time sync over the existing table reaches the same widening,
    // but off the deferred path. Boot must never be taken down by a migration,
    // and nobody is waiting at a prompt to read a refusal.
    await expect(driver.initObjects([WIDGET])).resolves.toBeUndefined();
    expect(setStatements(driver)).toHaveLength(0);
  });

  it('clears the flush flag after a refusal, so a later boot sync is unaffected', async () => {
    driver = makeDriver();
    await armedFlush(driver);
    await caught(() => driver.flushDeferredSchemaDdl());
    driver.issued.length = 0;

    // `os migrate apply` keeps the stack alive to shut it down; a flag left set
    // by the throw would turn every later widening on this driver into a refusal.
    await expect(driver.initObjects([WIDGET])).resolves.toBeUndefined();
    expect(setStatements(driver)).toHaveLength(0);
  });
});
