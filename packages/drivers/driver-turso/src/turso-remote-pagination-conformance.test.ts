// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deterministic paged reads for TursoDriver's REMOTE transport (objectui#3106,
 * #4363, #5590) — the shared `@objectstack/spec/data` cases, on rows.
 *
 * The local twin of this suite passes by INHERITANCE: `TursoDriver extends
 * SqlDriver`, so `orderKeysFor()` appends the `id` tie-breaker to every paged
 * read. Remote mode inherits nothing — `RemoteTransport.buildSelectSQL`
 * assembles its own ORDER BY / LIMIT / OFFSET — which makes it a second
 * implementation of this contract inside ONE driver, selected by URL alone.
 * That is exactly the shape #4363 wrote these cases for.
 *
 * ## What this suite measured, stated plainly
 *
 * Both case-sets pass here, and they do NOT pass for the reason the local
 * twin's do. `buildSelectSQL` maps the caller's `orderBy` entries verbatim and
 * appends no unique column, so:
 *
 * - a sorted paged read goes out as `ORDER BY status LIMIT ? OFFSET ?`, and
 *   the ties come back in storage order rather than id order;
 * - an unsorted paged read goes out with no ORDER BY at all.
 *
 * The property holds on this fixture because the stub is `better-sqlite3` over
 * a twelve-row in-memory table: one plan, one arrangement, every time. On a
 * real endpoint the arrangement of equal keys across two statements is not
 * promised — the case-set's own module doc says so, and names the unsorted
 * read as the same defect at full strength rather than as an exemption. The
 * `driver-memory` carve-out ("storage order steady between reads") is about a
 * JS array, not a SQL plan.
 *
 * So the honest reading of a green run here is: **the transport currently
 * satisfies the cases without implementing the mechanism the contract asks
 * for.** That gap is filed as #5653, and the two `records the measured
 * mechanism` tests below pin it — they assert the tie arrangement IS storage
 * order, so the day #5653 lands they go red and get updated with it, instead
 * of the divergence sitting here undocumented under a green suite. Fixing the
 * transport is deliberately not this file's job (#5590's boundary: write the
 * suite, do not grade your own paper).
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

    it(`page boundaries are invisible with NO orderBy — ${testCase.name}`, async () => {
      const paged = await walk(testCase.pageSize);
      const whole: Array<Record<string, unknown>> = await driver.find('ticket', {});
      expect(paged).toEqual(whole.map((r) => String(r.id)));
    });
  }

  it('leaves an UNPAGED unordered read alone — no sort is imposed on a caller who asked for none', async () => {
    const rows: Array<Record<string, unknown>> = await driver.find('ticket', {});
    expect(rows.map((r) => String(r.id))).toEqual(PAGINATION_ROWS.map((r) => r.id));
  });

  /**
   * The two pins. See the module doc: the cases above pass, but not by the
   * mechanism the contract names, and a green suite that leaves that unsaid is
   * how "covered" quietly stops meaning anything. Both assert the CURRENT
   * behaviour and are expected to go red — and be rewritten — the day #5653
   * gives this transport the tie-breaker local mode already has.
   */
  it('records the measured mechanism: a sorted paged read appends NO tie-breaker (#5653)', async () => {
    const seen = await walk(5, [{ field: 'status', order: 'asc' }]);
    // What the caller's key alone produces: the `status` groups in order, and
    // INSIDE each group the rows in storage (insertion) order. With the `id`
    // tie-breaker local mode appends, the `done` group would instead read
    // r02,r03,r09,r10 — id order.
    const groupedByStatusThenInsertion = PAGINATION_ROWS.map((row, index) => ({ row, index }))
      .sort((x, y) => x.row.status.localeCompare(y.row.status) || x.index - y.index)
      .map(({ row }) => row.id);
    expect(seen).toEqual(groupedByStatusThenInsertion);
  });

  it('records the measured mechanism: an unsorted paged read is served in storage order, not id order (#5653)', async () => {
    const seen = await walk(5);
    expect(seen).toEqual(PAGINATION_ROWS.map((r) => r.id));
    expect(seen).not.toEqual([...PAGINATION_ALL_IDS].sort());
  });
});
