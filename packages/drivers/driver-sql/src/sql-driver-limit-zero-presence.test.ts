// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `limit: 0` is a request for no records, on **every** door this driver opens —
 * objectstack#6577.
 *
 * # The asymmetry this file closes
 *
 * `findRows()`, the door `find()` goes through, compiles `limit` on PRESENCE
 * (`query.limit !== undefined`), which is what the contract asks for and what
 * `limit: 0` — ruled in #6485 to mean "return no records" — depends on. Two
 * other doors in the same file compiled it on TRUTHINESS (`if (query.limit)`),
 * and `0` is falsy, so the clause was dropped and the read that asked for
 * nothing was answered with everything:
 *
 *   - `findWithWindowFunctions()` — the live window-function read door (#4286).
 *     It returns ROWS, so the divergence was user-visible data.
 *   - `analyzeQuery()` / `explain()` — returns a PLAN. Its statement is built
 *     from the same `DriverQuery` and is only worth reading if it is the
 *     statement `find()` would run; with the LIMIT silently dropped it
 *     explained a different one.
 *
 * Measured on `main` at `3172831` (post-#6706), three rows seeded, before any
 * line moved:
 *
 * ```
 * find      { limit: 0 } -> 0 rows   select * from `orders` order by `id` asc limit ?
 * window    { limit: 0 } -> 3 rows   (the whole table)
 * analyze   { limit: 0 } ->          select * from `orders`          <- no LIMIT at all
 * ```
 *
 * # Why each half asserts what it does
 *
 * The window-function half asserts ROWS: it is the half a user feels.
 *
 * The `analyzeQuery` half cannot assert rows — it returns a plan. So it asserts
 * its statement against the statement `find()` **actually sent**, read off
 * knex's `query` event during a real `find()` rather than recompiled here. That
 * distinction is load-bearing: a test that rebuilds the expected LIMIT itself
 * asserts only that knex works, and stays green on the day the two doors
 * diverge again — which is precisely the day this file exists for.
 *
 * # The controls are not padding
 *
 * Every zero case is stated beside the non-zero read it must NOT become. A
 * driver that answered `[]` to everything would satisfy the `limit: 0` rows and
 * fail the user completely; the property is "`limit` is honoured as written",
 * not "`limit: 0` is special-cased".
 *
 * # `offset` moved with `limit`, and the honest reason
 *
 * Both doors also spelled `if (query.offset)`, against `findRows`'s
 * `query.offset !== undefined`. That flip is **measured to change nothing**:
 * knex elides a zero offset on every dialect this driver speaks — compiled
 * `.offset(0)` is `select * from "orders"` on better-sqlite3, pg AND mysql2
 * alike — so no statement and no row set moves. It is made for internal
 * consistency, so the three doors read identically, and it is pinned below as
 * the no-op it is rather than sold as a fix. If knex ever stops eliding it, the
 * pin is what notices.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knexLib from 'knex';
import type { DriverOptions } from '@objectstack/spec/data';
import { SqlDriver } from './index.js';

const TABLE = 'os6577_zero_page';

/**
 * Records the SQL of every statement this driver sends, so a test can assert
 * what `find()` really emitted rather than what it ought to have.
 */
class InspectableSqlDriver extends SqlDriver {
  readonly statements: Array<{ sql: string; bindings: readonly unknown[] }> = [];

  captureStatements(): void {
    this.knex.on('query', (data: { sql?: string; bindings?: readonly unknown[] }) => {
      if (typeof data?.sql === 'string') {
        this.statements.push({ sql: data.sql, bindings: data.bindings ?? [] });
      }
    });
  }

  /** The one statement issued against {@link TABLE} while `run` executed. */
  async statementFor(run: () => Promise<unknown>): Promise<{ sql: string; bindings: readonly unknown[] }> {
    const before = this.statements.length;
    await run();
    const issued = this.statements.slice(before).filter((s) => s.sql.includes(TABLE));
    expect(issued).toHaveLength(1);
    return issued[0]!;
  }
}

/** `limit ?` / `limit 5` / `offset ?` — the pagination tail, whatever knex spelled. */
function paginationTail(sql: string): string {
  const m = sql.match(/\blimit\b.*$|\boffset\b.*$/i);
  return m ? m[0].toLowerCase() : '';
}

const READ: DriverOptions = { bypassTenantAudit: true };

describe('driver-sql — `limit: 0` returns no records on every door (#6577)', () => {
  let driver: InspectableSqlDriver;

  beforeAll(async () => {
    driver = new InspectableSqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    } as any);
    await driver.initObjects([
      {
        name: TABLE,
        fields: { customer: { type: 'string' }, amount: { type: 'number' }, status: { type: 'string' } },
      },
    ] as any);
    for (const row of [
      { customer: 'Alice', amount: 1200, status: 'completed' },
      { customer: 'Bob', amount: 300, status: 'pending' },
      { customer: 'Alice', amount: 50, status: 'completed' },
    ]) {
      await driver.create(TABLE, row as any, READ);
    }
    driver.captureStatements();
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const WINDOW = {
    windowFunctions: [
      { function: 'ROW_NUMBER', alias: 'rn', orderBy: [{ field: 'amount', order: 'desc' }] },
    ],
  };

  describe('findWithWindowFunctions — the row-returning door', () => {
    it('returns NO rows for `limit: 0`, where it used to return the whole table', async () => {
      const rows = await driver.findWithWindowFunctions(TABLE, { ...WINDOW, limit: 0 } as any, READ);
      expect(rows).toHaveLength(0);
    });

    it('still returns two rows for `limit: 2` — the clause is honoured, not special-cased', async () => {
      const rows = await driver.findWithWindowFunctions(TABLE, { ...WINDOW, limit: 2 } as any, READ);
      expect(rows).toHaveLength(2);
    });

    it('still returns every row when no `limit` is given at all', async () => {
      const rows = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any, READ);
      expect(rows).toHaveLength(3);
    });

    it('returns no rows for `limit: 0` even with an offset past the first page', async () => {
      const rows = await driver.findWithWindowFunctions(TABLE, { ...WINDOW, limit: 0, offset: 2 } as any, READ);
      expect(rows).toHaveLength(0);
    });

    it('agrees with `find()` on the same query — one driver, one answer', async () => {
      const viaWindow = await driver.findWithWindowFunctions(TABLE, { ...WINDOW, limit: 0 } as any, READ);
      const viaFind = await driver.find(TABLE, { limit: 0 }, READ);
      expect(viaWindow).toHaveLength(viaFind.length);
    });
  });

  describe('analyzeQuery — the plan door explains the statement `find()` runs', () => {
    it('carries the same LIMIT `find()` emitted for `limit: 0`', async () => {
      const emitted = await driver.statementFor(() => driver.find(TABLE, { limit: 0 }, READ));
      const analyzed = await driver.analyzeQuery(TABLE, { limit: 0 } as any, READ);

      // `find()` adds its own ORDER BY tie-breaker, so the whole statements are
      // not expected to match — the pagination tail is the part under test.
      expect(paginationTail(emitted.sql)).toBe('limit ?');
      expect(paginationTail(analyzed.sql)).toBe('limit ?');
      expect(emitted.bindings).toContain(0);
      expect(analyzed.bindings).toContain(0);
    });

    it('emitted a statement with NO limit at all before this fix — the regression sentinel', async () => {
      const analyzed = await driver.analyzeQuery(TABLE, { limit: 0 } as any, READ);
      expect(analyzed.sql.toLowerCase()).toContain('limit');
    });

    it('still carries the LIMIT for a non-zero `limit`', async () => {
      const analyzed = await driver.analyzeQuery(TABLE, { limit: 2 } as any, READ);
      expect(paginationTail(analyzed.sql)).toBe('limit ?');
      expect(analyzed.bindings).toContain(2);
    });

    it('emits no LIMIT when the caller gave none — presence, not a constant', async () => {
      const analyzed = await driver.analyzeQuery(TABLE, {} as any, READ);
      expect(analyzed.sql.toLowerCase()).not.toContain('limit');
    });

    it('returns a plan alongside the statement, unchanged by any of this', async () => {
      const analyzed = await driver.analyzeQuery(TABLE, { limit: 0 } as any, READ);
      expect(analyzed.plan).toBeDefined();
      expect(analyzed.error).toBeUndefined();
    });
  });

  /**
   * The measurement that keeps the `offset` half of this change honest. It is a
   * claim about knex, not about this driver, which is why it is compiled rather
   * than executed and why all three dialects are named.
   */
  describe('a zero offset is elided by knex on every dialect — so the offset flip is a no-op', () => {
    for (const client of ['better-sqlite3', 'pg', 'mysql2'] as const) {
      it(`${client}: \`.offset(0)\` compiles to no OFFSET clause`, async () => {
        const k = knexLib({ client, useNullAsDefault: true } as any);
        try {
          expect(k('orders').select('*').offset(0).toSQL().sql.toLowerCase()).not.toContain('offset');
          // ...while a zero LIMIT is emitted, which is why that half is a fix.
          expect(k('orders').select('*').limit(0).toSQL().sql.toLowerCase()).toContain('limit');
          // ...and a non-zero offset still reaches the statement.
          expect(k('orders').select('*').offset(3).toSQL().sql.toLowerCase()).toContain('offset');
        } finally {
          await k.destroy();
        }
      });
    }
  });
});
