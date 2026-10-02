// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21385] driver-sql's own refusal log lines take the shared driver-fault cut.
 *
 * Maintainer ruling 2026-10-02 (letter A, "one cutter for every log face"): the
 * five lines this driver writes on the way to composing a refusal call the
 * same redaction the engine boundary uses (`@objectstack/core`'s driver-fault
 * redaction, moved there from `@objectstack/objectql` so this package can
 * import it). Each line keeps its code, its class of fault and the dialect's
 * own diagnostic; the statement and the values bound or inlined into it are
 * cut. The five:
 *
 *  1. the unresolvable WHERE column (`INVALID_FILTER`), on `find` and `count`;
 *  2. the read terminal (`DATABASE_ERROR`);
 *  3. the raw-statement terminal (`DATABASE_ERROR`), which also used to write
 *     the statement it was sent;
 *  4. the unresolvable groupBy / aggregation column (`INVALID_FIELD`);
 *  5. the unresolvable listed-distinct column (`INVALID_FIELD`).
 *
 * ## How a pin here reads, and why nothing here prints a line
 *
 * Every pin plants {@link SENTINEL}, a synthetic value, and asserts it is
 * ABSENT from the line. A line is never printed: every assertion on a line is
 * a boolean, so a red names the line and the fact, never the text.
 *
 * ## Non-vacuity: the text the line was HANDED
 *
 * "The sentinel is absent from the line" is unfalsifiable for a line that was
 * never handed it. So {@link RecordingDriver} records, per line, whether the
 * dialect error that reached the refusal method carried the sentinel, before
 * the method writes anything. Measured on better-sqlite3, live PostgreSQL 16
 * and live MySQL 8.0:
 *
 * | line      | sqlite | pg  | mysql |
 * |-----------|--------|-----|-------|
 * | where     | yes    | no  | yes   |
 * | read      | yes    | yes | yes   |
 * | raw       | yes    | yes | yes   |
 * | aggregate | yes    | no  | yes   |
 * | distinct  | yes    | no  | yes   |
 *
 * On SQLite and MySQL knex inlines the bound values into the statement it
 * prefixes to the dialect's message. Postgres positions them as `$n` first, so
 * an unresolvable-column statement carries none and its diagnostic names
 * identifiers only: those three pg cells are a non-regression pin, recorded as
 * such ({@link HANDED}). The pg read and raw cells reach it through the
 * dialect's own value-bearing diagnostic (`22P02`), which the cut's value
 * templates own.
 *
 * Runs on every cell of the driver axis: SQLite always, live PostgreSQL and
 * MySQL when `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set (a named
 * skip otherwise, a failure under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import type { SqlDriverConfig } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell, type DialectId } from './live-dialect-matrix.testkit.js';

/** Synthetic, distinctive, and free of the ` - ` separator the cut keys on. */
const SENTINEL = 'zz-os21385-synthetic-sentinel';

const TABLE = 'os21385_log_task';
const MISSING = 'os21385_log_never_created';
const MISSING_COLUMN = 'os21385_nosuchcol';

/** The cut's own marker: a statement stood here and was removed. */
const STATEMENT_MARKER = '[statement and bound values redacted]';

type LineId = 'where' | 'read' | 'raw' | 'aggregate' | 'distinct';

/** Whether the dialect error HANDED to each line carried the sentinel, as measured (see header). */
const HANDED: Readonly<Record<DialectId, Readonly<Record<LineId, boolean>>>> = {
  sqlite: { where: true, read: true, raw: true, aggregate: true, distinct: true },
  pg: { where: false, read: true, raw: true, aggregate: false, distinct: false },
  mysql: { where: true, read: true, raw: true, aggregate: true, distinct: true },
};

/** The dialect's own diagnostic each line must keep — a fragment of the database's words. */
const DIAGNOSTIC: Readonly<Record<DialectId, Readonly<Record<LineId, RegExp>>>> = {
  sqlite: {
    where: /no such column/,
    read: /no such table/,
    raw: /no such table/,
    aggregate: /no such column/,
    distinct: /no such column/,
  },
  pg: {
    where: /column .* does not exist/,
    read: /invalid input syntax for type integer/,
    raw: /invalid input syntax for type integer/,
    aggregate: /column .* does not exist/,
    distinct: /column .* does not exist/,
  },
  mysql: {
    where: /Unknown column/,
    read: /doesn't exist/,
    raw: /doesn't exist/,
    aggregate: /Unknown column/,
    distinct: /Unknown column/,
  },
};

/** The code and the class of fault each line opens with. */
const LEAD: Readonly<Record<LineId, string>> = {
  where: `[sql-driver] INVALID_FILTER — a WHERE column could not be resolved on '${TABLE}'`,
  read: '[sql-driver] DATABASE_ERROR — the backend refused a read on ',
  raw: '[sql-driver] DATABASE_ERROR — the backend refused a raw statement',
  aggregate: `[sql-driver] INVALID_FIELD — a groupBy/aggregation column could not be resolved on '${TABLE}'`,
  distinct: `[sql-driver] INVALID_FIELD — the listed distinct column could not be resolved on '${TABLE}'`,
};

interface Handed {
  readonly line: LineId;
  readonly carriesSentinel: boolean;
  readonly code: unknown;
}

/**
 * Records what each refusal method was HANDED, then lets it run unchanged. The
 * five are `protected` precisely so a subclass (`TursoDriver`) composes through
 * them; this one only watches.
 */
class RecordingDriver extends SqlDriver {
  readonly warned: string[] = [];
  readonly debugged: string[] = [];
  readonly handed: Handed[] = [];

  constructor(config: SqlDriverConfig) {
    super(config);
    this.logger = {
      warn: (m: string) => { this.warned.push(String(m)); },
      debug: (m: string) => { this.debugged.push(String(m)); },
      info: () => {},
      error: () => {},
    };
  }

  private record(line: LineId, error: unknown): void {
    const message = (error as { message?: unknown } | null | undefined)?.message;
    this.handed.push({
      line,
      carriesSentinel: typeof message === 'string' && message.includes(SENTINEL),
      code: (error as { code?: unknown } | null | undefined)?.code,
    });
  }

  protected override unresolvableFilterColumnRefusal(object: string, error: unknown, rootFilter?: unknown): Error {
    this.record('where', error);
    return super.unresolvableFilterColumnRefusal(object, error, rootFilter);
  }

  protected override backendStatementFault(object: string, error: unknown): Error {
    this.record('read', error);
    return super.backendStatementFault(object, error);
  }

  protected override rawStatementFault(command: string, error: unknown): Error {
    this.record('raw', error);
    return super.rawStatementFault(command, error);
  }

  protected override unresolvableAggregateColumnRefusal(
    object: string,
    column: string,
    namedBy: { inGroupBy: boolean; inAggregations: boolean },
    error: unknown,
  ): Error {
    this.record('aggregate', error);
    return super.unresolvableAggregateColumnRefusal(object, column, namedBy, error);
  }

  protected override unresolvableDistinctColumnRefusal(object: string, column: string, error: unknown): Error {
    this.record('distinct', error);
    return super.unresolvableDistinctColumnRefusal(object, column, error);
  }

  /** Run one refusal, returning the envelope plus what the one line was handed and wrote. */
  async refuse(line: LineId, run: () => Promise<unknown>): Promise<{ err: any; handed: Handed; written: string }> {
    this.warned.length = 0;
    this.handed.length = 0;
    let err: any;
    try {
      await run();
    } catch (e) {
      err = e;
    }
    expect(err, `${line}: the call must be refused`).toBeDefined();
    const handed = this.handed.filter((h) => h.line === line);
    expect(handed.length, `${line}: the refusal method was reached exactly once`).toBe(1);
    const written = this.warned.filter((l) => l.startsWith(LEAD[line]));
    expect(written.length, `${line}: exactly one line opens with this line's lead`).toBe(1);
    return { err, handed: handed[0], written: written[0] };
  }
}

function declareCell(cell: DialectCell): void {
  describe(`[#21385] driver-sql refusal log lines carry no bound value (${cell.label})`, () => {
    let driver: RecordingDriver;

    beforeAll(async () => {
      driver = new RecordingDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        { name: TABLE, fields: { title: { type: 'string' }, rank: { type: 'integer' } } },
      ]);
      await driver.create(TABLE, { id: 'r1', title: 'Design', rank: 1 }, { bypassTenantAudit: true });
    }, 60_000);

    afterAll(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.disconnect();
    });

    /**
     * The pin every line shares: handed as measured, written with no sentinel,
     * and keeping its code, class and diagnostic. Booleans only, by design.
     */
    function expectCut(
      line: LineId,
      outcome: { handed: Handed; written: string },
      extra: { code?: string; subject?: readonly string[] } = {},
    ): void {
      const { handed, written } = outcome;
      expect(handed.carriesSentinel, `${line}: the dialect text handed to the line carried the sentinel`)
        .toBe(HANDED[cell.id][line]);
      expect(written.includes(SENTINEL), `${line}: the sentinel reached the written line`).toBe(false);
      // The controls: what the line is FOR survives the cut.
      expect(written.startsWith(LEAD[line]), `${line}: keeps its code and class of fault`).toBe(true);
      expect(DIAGNOSTIC[cell.id][line].test(written), `${line}: keeps the dialect's own diagnostic`).toBe(true);
      expect(written.includes(STATEMENT_MARKER), `${line}: says a statement was cut`).toBe(true);
      if (extra.code !== undefined) {
        expect(written.includes(`(${extra.code})`), `${line}: keeps the dialect's error code`).toBe(true);
      }
      for (const name of extra.subject ?? []) {
        expect(written.includes(`'${name}'`), `${line}: still names '${name}'`).toBe(true);
      }
    }

    it('① the unresolvable WHERE column — on find and on count', async () => {
      for (const half of ['find', 'count'] as const) {
        const outcome = await driver.refuse('where', () =>
          half === 'find'
            ? driver.find(TABLE, { where: { [MISSING_COLUMN]: SENTINEL } })
            : driver.count(TABLE, { where: { [MISSING_COLUMN]: SENTINEL } }),
        );
        expect(outcome.err.code, `where/${half}: the envelope is unchanged`).toBe('INVALID_FILTER');
        expect(outcome.err.status, `where/${half}: the envelope is unchanged`).toBe(400);
        expectCut('where', outcome, { subject: [TABLE, MISSING_COLUMN] });
      }
    });

    it('② the read terminal', async () => {
      // Postgres coerces nothing: a string compared to an integer column is
      // refused with `22P02`, whose diagnostic inlines the value. SQLite and
      // MySQL coerce that comparison, so they are refused on a table that does
      // not exist instead, and carry the value in the statement knex prefixes.
      const outcome = await driver.refuse('read', () =>
        cell.id === 'pg'
          ? driver.find(TABLE, { where: { rank: SENTINEL } })
          : driver.find(MISSING, { where: { title: SENTINEL } }),
      );
      expect(outcome.err.code, 'read: the envelope is unchanged').toBe('DATABASE_ERROR');
      expect(outcome.err.status, 'read: the envelope is unchanged').toBe(500);
      expect(typeof outcome.handed.code, 'read: the dialect error has a code').toBe('string');
      expectCut('read', outcome, { code: String(outcome.handed.code) });
    });

    it('③ the raw-statement terminal — a bound value', async () => {
      const outcome = await driver.refuse('raw', () =>
        cell.id === 'pg'
          ? driver.execute('select cast(? as integer) as x', [SENTINEL])
          : driver.execute(`select ? as x from ${MISSING}`, [SENTINEL]),
      );
      expect(outcome.err.code, 'raw: the envelope is unchanged').toBe('DATABASE_ERROR');
      expect(outcome.err.status, 'raw: the envelope is unchanged').toBe(500);
      expect(typeof outcome.handed.code, 'raw: the dialect error has a code').toBe('string');
      expectCut('raw', outcome, { code: String(outcome.handed.code) });
    });

    it('③ the raw-statement terminal — a value spelled inline, which the sent statement itself carries', async () => {
      // The line used to write the statement it was sent beside the dialect's
      // text. A raw statement may spell a value inline, so that field carried
      // it on every dialect, Postgres included; it is no longer written.
      const outcome = await driver.refuse('raw', () => driver.execute(`select '${SENTINEL}' as x from ${MISSING}`));
      expect(outcome.handed.carriesSentinel, 'raw/inline: the dialect text handed to the line carried the sentinel')
        .toBe(true);
      expect(outcome.written.includes(SENTINEL), 'raw/inline: the sentinel reached the written line').toBe(false);
      expect(outcome.written.includes('statement: '), 'raw/inline: no separate statement field').toBe(false);
      expect(outcome.written.includes(STATEMENT_MARKER), 'raw/inline: says a statement was cut').toBe(true);
    });

    it('④ the unresolvable groupBy / aggregation column', async () => {
      const outcome = await driver.refuse('aggregate', () =>
        driver.aggregate(TABLE, {
          where: { title: SENTINEL },
          aggregations: [{ function: 'avg', field: MISSING_COLUMN, alias: 'os21385_avg' }],
        }),
      );
      expect(outcome.err.code, 'aggregate: the envelope is unchanged').toBe('INVALID_FIELD');
      expect(outcome.err.status, 'aggregate: the envelope is unchanged').toBe(400);
      expectCut('aggregate', outcome, { subject: [TABLE, MISSING_COLUMN] });
    });

    it('⑤ the unresolvable listed-distinct column', async () => {
      const outcome = await driver.refuse('distinct', () =>
        driver.distinct(TABLE, MISSING_COLUMN, { title: SENTINEL }),
      );
      expect(outcome.err.code, 'distinct: the envelope is unchanged').toBe('INVALID_FIELD');
      expect(outcome.err.status, 'distinct: the envelope is unchanged').toBe(400);
      expectCut('distinct', outcome, { subject: [TABLE, MISSING_COLUMN] });
    });

    it('CONTROL — a read that succeeds writes no refusal line at all', async () => {
      driver.warned.length = 0;
      const rows = await driver.find(TABLE, { where: { title: 'Design' } });
      expect(rows.map((r: any) => r.id)).toEqual(['r1']);
      expect(driver.warned.filter((l) => l.startsWith('[sql-driver]'))).toEqual([]);
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'refusal log-line redaction', declareCell);
}

describe('[#21385] the read terminal cuts once, for its demoted debug lines too', () => {
  // The read terminal computes the dialect text once and writes it on one of
  // three lines: the warn line pinned above, or one of two debug lines that
  // demote it inside a scope (a pre-DDL question, or a table whose DDL this
  // driver deferred). A server log leaves the data's trust boundary at any
  // level, so the cut sits where the text is computed and covers all three.
  // Pinned here on the deferred-DDL line, the one a public method reaches.
  it('a deferred table read with a bound value writes no sentinel to the debug line', async () => {
    const d = new RecordingDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    try {
      d.setDeferredDdl(true);
      await d.initObjects([{ name: 'os21385_deferred', fields: { title: { type: 'string' } } }] as any);
      let err: any;
      try {
        await d.find('os21385_deferred', { where: { title: SENTINEL } });
      } catch (e) {
        err = e;
      }
      expect(err?.code).toBe('DATABASE_ERROR');
      const handed = d.handed.filter((h) => h.line === 'read');
      expect(handed.length, 'the read terminal was reached once').toBe(1);
      expect(handed[0].carriesSentinel, 'the dialect text handed to it carried the sentinel').toBe(true);
      const demoted = d.debugged.filter((l) => l.includes("'os21385_deferred'"));
      expect(demoted.length, 'one debug line').toBe(1);
      expect(d.warned.filter((l) => l.includes("'os21385_deferred'")).length, 'no warn line').toBe(0);
      expect(demoted[0].includes(SENTINEL), 'the sentinel reached the debug line').toBe(false);
      expect(/no such table/.test(demoted[0]), "the debug line keeps the dialect's diagnostic").toBe(true);
      expect(demoted[0].includes(STATEMENT_MARKER), 'the debug line says a statement was cut').toBe(true);
    } finally {
      await d.disconnect();
    }
  });
});
