// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deterministic paged reads for TursoDriver's REMOTE transport (objectui#3106,
 * #4363, #5590) — the shared `@objectstack/spec/data` cases, on rows.
 *
 * The local twin of this suite passes by INHERITANCE: `TursoDriver extends
 * SqlDriver`, so `orderKeysFor()` appends the `id` tie-breaker to every paged
 * read. Remote mode does not inherit the SQL — `RemoteTransport.buildSelectSQL`
 * assembles its own ORDER BY / LIMIT / OFFSET — so what has to be proved here
 * is that it does not also carry a second implementation of the *rule*, chosen
 * by nothing but the URL. That is exactly the shape #4363 wrote these cases
 * for.
 *
 * ## What this suite measured before #5653, and what it measures now
 *
 * When #5590 first wrote this file both case-sets passed, and they did NOT
 * pass for the reason the local twin's did. `buildSelectSQL` mapped the
 * caller's `orderBy` entries verbatim and appended no unique column, so:
 *
 * - a sorted paged read went out as `ORDER BY status LIMIT ? OFFSET ?`, and
 *   the ties came back in storage order rather than id order;
 * - an unsorted paged read went out with no ORDER BY at all.
 *
 * The property held on this fixture because the stub is `better-sqlite3` over
 * a twelve-row in-memory table: one plan, one arrangement, every time. On a
 * real endpoint the arrangement of equal keys across two statements is not
 * promised — the case-set's own module doc says so, and names the unsorted
 * read as the same defect at full strength rather than as an exemption. The
 * `driver-memory` carve-out ("storage order steady between reads") is about a
 * JS array, not a SQL plan. So a green run then read as: **the transport
 * satisfied the cases without implementing the mechanism the contract asks
 * for** — and the two `records the measured mechanism` tests below pinned that
 * gap rather than let it sit undocumented under a green suite.
 *
 * #5653 closed it, and those two pins were flipped with it — they now assert
 * the concrete sequences the mechanism produces (ties in id order; an unsorted
 * page walk in id order), each against the storage-order arrangement it
 * replaced, so restoring the old behaviour turns them red rather than leaving
 * them passing for a vacuous reason. The fix is NOT a second rule inside
 * `buildSelectSQL`: `TursoDriver.toRemoteReadQuery` resolves the whole ORDER BY
 * through the same inherited `SqlDriver.orderKeysFor` local mode calls, and the
 * transport renders what it is handed. The clause that comes out of that is
 * pinned separately, statement by statement, in
 * `remote-pagination-tiebreaker.test.ts` — rows on a twelve-row table cannot
 * tell a real tie-breaker from a lucky plan, which is the whole reason this
 * file needed pins in the first place.
 *
 * ## Why a SQLite-backed client stub
 *
 * Same instrument, same reason as the remote temporal and filter-logic suites:
 * these are row-order assertions, and a lost ORDER BY leaves the SQL perfectly
 * valid — so a SQL-string assertion sails past it. libsql IS SQLite, so the
 * stub gives the transport real ordering semantics with no network and no
 * credentials.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
} from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const TICKET_OBJECT = {
  name: 'ticket',
  fields: {
    status: { type: 'string' },
    rank: { type: 'integer' },
    name: { type: 'string' },
  },
};

describe('TursoDriver remote — paged reads are a partition of the result set', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({ url: 'libsql://conformance.turso.io', client: stub as never });
    await driver.connect();
    // The mode this suite is about — the one that assembles its own paging.
    expect(driver.transportMode).toBe('remote');
    await driver.syncSchema(TICKET_OBJECT.name, TICKET_OBJECT);
    for (const row of PAGINATION_ROWS) {
      await driver.create('ticket', { ...row });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  /** Walk the whole table page by page, collecting the ids in visit order. */
  const walk = async (
    pageSize: number,
    orderBy?: ReadonlyArray<{ field: string; order: 'asc' | 'desc' }>,
  ): Promise<string[]> => {
    const seen: string[] = [];
    for (let offset = 0; offset < PAGINATION_ROWS.length; offset += pageSize) {
      const page: Array<Record<string, unknown>> = await driver.find('ticket', {
        ...(orderBy ? { orderBy: [...orderBy] } : {}),
        limit: pageSize,
        offset,
      });
      seen.push(...page.map((r) => String(r.id)));
    }
    return seen;
  };

  /**
   * Read below the transport first: a walk that visits nothing because the
   * seed never landed would satisfy every set comparison in this file for the
   * wrong reason.
   */
  it('the fixture really is all twelve rows, as stored', () => {
    const rows = stub.raw.prepare('select id from ticket').all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual([...PAGINATION_ALL_IDS].sort());
  });

  for (const testCase of PAGINATION_CASES) {
    it(`visits every row exactly once — ${testCase.name}`, async () => {
      const seen = await walk(testCase.pageSize, testCase.orderBy);
      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`page boundaries are invisible — ${testCase.name}`, async () => {
      const paged = await walk(testCase.pageSize, testCase.orderBy);
      const whole: Array<Record<string, unknown>> = await driver.find('ticket', {
        orderBy: [...testCase.orderBy],
      });
      expect(paged).toEqual(whole.map((r) => String(r.id)));
    });
  }

  for (const testCase of PAGINATION_UNORDERED_CASES) {
    it(`visits every row exactly once with NO orderBy at all — ${testCase.name}`, async () => {
      const seen = await walk(testCase.pageSize);
      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`walks an unsorted read in id order — ${testCase.name}`, async () => {
      // The local twin's assertion, now that remote answers the same way. Its
      // predecessor here compared the page walk against the UNPAGED unordered
      // read and passed because neither was ordered; after #5653 the two
      // legitimately differ — the walk is a partition ordered by `id`, while
      // the unpaged read keeps #4363's carve-out and is handed back in whatever
      // order the plan chose. Comparing them would now pin the carve-out's
      // absence, so the honest replacement is the property the walk itself must
      // have. The fixture's ids are shuffled relative to insertion order, so
      // this distinguishes "the tie-breaking ORDER BY reached the endpoint"
      // from "SQLite happened to hand back rowid order".
      expect(await walk(testCase.pageSize)).toEqual([...PAGINATION_ALL_IDS].sort());
    });
  }

  it('leaves an UNPAGED unordered read alone — no sort is imposed on a caller who asked for none', async () => {
    const rows: Array<Record<string, unknown>> = await driver.find('ticket', {});
    expect(rows.map((r) => String(r.id))).toEqual(PAGINATION_ROWS.map((r) => r.id));
  });

  /**
   * The two pins, flipped by #5653. See the module doc: the cases above pass,
   * and until #5653 they did not pass by the mechanism the contract names —
   * a green suite that leaves that unsaid is how "covered" quietly stops
   * meaning anything. Each now asserts the concrete sequence the mechanism
   * produces AND the storage-order arrangement it replaced, so a regression
   * that took the tie-breaker back out turns them red on the positive
   * assertion instead of leaving them green on an empty one.
   */
  it('a sorted paged read breaks its ties by id, not by storage order (#5653)', async () => {
    const seen = await walk(5, [{ field: 'status', order: 'asc' }]);
    // The `status` groups in order, and INSIDE each group the rows in id
    // order — `done` reads r02,r03,r09,r10, where the caller's key alone left
    // it r03,r09,r02,r10 (insertion order).
    const groupedByStatusThenId = [...PAGINATION_ROWS]
      .sort((x, y) => x.status.localeCompare(y.status) || x.id.localeCompare(y.id))
      .map((row) => row.id);
    expect(seen).toEqual(groupedByStatusThenId);
    const groupedByStatusThenInsertion = PAGINATION_ROWS.map((row, index) => ({ row, index }))
      .sort((x, y) => x.row.status.localeCompare(y.row.status) || x.index - y.index)
      .map(({ row }) => row.id);
    expect(seen).not.toEqual(groupedByStatusThenInsertion);
  });

  it('an unsorted paged read is served in id order, not storage order (#5653)', async () => {
    const seen = await walk(5);
    expect(seen).toEqual([...PAGINATION_ALL_IDS].sort());
    expect(seen).not.toEqual(PAGINATION_ROWS.map((r) => r.id));
  });

  /**
   * `limit: 0` means "return no records" (#6485/#6577). This transport does not
   * go through knex at all — `remote-transport.ts` assembles its own
   * `LIMIT`/`OFFSET` — so its agreement with the local half is a separate fact
   * needing its own measurement, not an inheritance. It reads `!== undefined`
   * today; this is what stops that from silently becoming `if (query.limit)`.
   */
  describe('`limit: 0` returns no records', () => {
    for (const testCase of PAGINATION_ZERO_LIMIT_CASES) {
      it(testCase.name, async () => {
        const rows: Array<Record<string, unknown>> = await driver.find('ticket', { ...testCase.query });
        expect(rows).toHaveLength(testCase.expectedRowCount);
      });
    }
  });

  /**
   * The SELECT this transport puts on the wire for `query`, read off a
   * recording client rather than recompiled here — the same instrument
   * `remote-pagination-tiebreaker.test.ts` uses, and for the same reason: a
   * test that rebuilds the expected statement asserts only that the builder
   * works, and stays green on the day `find()` stops calling it.
   */
  async function statementFor(query: Record<string, unknown>): Promise<{ sql: string; args: unknown[] }> {
    const sent: Array<{ sql: string; args: unknown[] }> = [];
    const recorder = makeLibsqlSqliteStub();
    const client = {
      execute: async (stmt: { sql: string; args?: unknown[] }) => {
        sent.push({ sql: stmt.sql, args: stmt.args ?? [] });
        return recorder.execute(stmt);
      },
      batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => {
        for (const s of stmts) sent.push({ sql: s.sql, args: s.args ?? [] });
        return Promise.all(stmts.map((s) => recorder.execute(s)));
      },
      close: () => recorder.close(),
    };
    const recording = new TursoDriver({ url: 'libsql://recorder.turso.io', client: client as never });
    await recording.connect();
    await recording.syncSchema(TICKET_OBJECT.name, TICKET_OBJECT);
    sent.length = 0; // drop the DDL round-trip; only the read is under test
    await recording.find('ticket', query);
    await recording.disconnect();
    recorder.close();
    const reads = sent.filter((s) => /^\s*SELECT/i.test(s.sql));
    expect(reads).toHaveLength(1);
    return reads[0]!;
  }

  /**
   * An OFFSET with no LIMIT — the defect the case-set's bare-offset control
   * surfaced here, and a separate bug from the `limit: 0` one it was added for.
   *
   * SQLite's grammar is `LIMIT expr [OFFSET expr]`, so an OFFSET cannot stand
   * alone. This compiler emitted the two clauses independently and the server
   * answered `near "OFFSET": syntax error` — for every offset value, not a
   * boundary case, and only on THIS transport: the local half goes through knex,
   * which synthesises the `LIMIT -1` no-limit sentinel.
   *
   * Kept as its own block rather than left to the shared control because the
   * control asserts a row COUNT, and a count assertion reports this as "expected
   * 12, got a thrown error" — which reads as a pagination fault rather than as
   * a statement that never parsed.
   */
  describe('an offset with no limit still assembles a legal statement', () => {
    for (const offset of [0, 1, 5]) {
      it(`offset ${offset} alone does not throw a syntax error`, async () => {
        const rows: Array<Record<string, unknown>> = await driver.find('ticket', { offset });
        expect(rows).toHaveLength(PAGINATION_ROWS.length - offset);
      });
    }

    it('sends what knex builds for the local transport — `LIMIT ? OFFSET ?` bound `[-1, 3]`', async () => {
      const sent = await statementFor({ offset: 3 });
      expect(sent.sql.toUpperCase()).toContain('LIMIT ? OFFSET ?');
      expect(sent.args).toEqual([-1, 3]);
    });

    it("still sends the caller's own limit when one was given — the sentinel is not a default", async () => {
      const sent = await statementFor({ limit: 0, offset: 3 });
      expect(sent.args).toEqual([0, 3]);
    });

    it('adds no LIMIT at all when neither was given — the sentinel is not unconditional', async () => {
      const sent = await statementFor({});
      expect(sent.sql.toUpperCase()).not.toContain('LIMIT');
      expect(sent.args).toEqual([]);
    });
  });
});
