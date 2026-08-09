// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deterministic paged reads for TursoDriver in LOCAL mode (objectui#3106,
 * #4363, #5590) — the contract on `IDataDriver.find`, run against the shared
 * `@objectstack/spec/data` cases like every other driver.
 *
 * `TursoDriver extends SqlDriver`, so the tie-breaking ORDER BY is *built* by
 * inherited code and nothing here re-implements it. What this pins is that it
 * still reaches the engine on this driver: every read method is an `override`
 * that branches on `this.isRemote` before delegating to `super.find`, so the
 * inherited clause travels through one more layer here than it does in the
 * base package. A router that mangled or bypassed the query — or a future
 * override that rebuilt the paged read itself — would produce exactly the
 * failure the contract rules out (full pages, real rows, one served twice and
 * one never served), and it would fail in no other suite in the repo.
 *
 * The REMOTE transport keeps its own file
 * (`turso-remote-pagination-conformance.test.ts`): it does not go through knex
 * at all and assembles its own ORDER BY / LIMIT / OFFSET, so the same contract
 * has to be re-measured against a second SQL assembler. Since #5653 it is only
 * the assembler that is second — `TursoDriver.toRemoteReadQuery` resolves the
 * remote sort keys through this very same `orderKeysFor`, so the rule has one
 * implementation and the URL no longer decides which guarantee a paged read
 * gets.
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

const TICKET_OBJECT = {
  name: 'ticket',
  fields: {
    status: { type: 'string' },
    rank: { type: 'integer' },
    name: { type: 'string' },
  },
};

describe('TursoDriver — paged reads are a partition of the result set (local mode)', () => {
  let driver: TursoDriver;

  beforeAll(async () => {
    driver = new TursoDriver({ url: ':memory:' });
    expect(driver.transportMode).toBe('local');
    await driver.initObjects([TICKET_OBJECT]);
    for (const row of PAGINATION_ROWS) {
      await driver.create('ticket', { ...row }, { bypassTenantAudit: true });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  /** Walk the whole table page by page, collecting the ids in visit order. */
  const walk = async (
    pageSize: number,
    orderBy?: ReadonlyArray<{ field: string; order: 'asc' | 'desc' }>,
  ): Promise<string[]> => {
    const seen: string[] = [];
    for (let offset = 0; offset < PAGINATION_ROWS.length; offset += pageSize) {
      const page: Array<Record<string, unknown>> = await driver.find(
        'ticket',
        { ...(orderBy ? { orderBy: [...orderBy] } : {}), limit: pageSize, offset },
        { bypassTenantAudit: true },
      );
      seen.push(...page.map((r) => String(r.id)));
    }
    return seen;
  };

  it('the fixture really is all twelve rows', async () => {
    const rows: Array<Record<string, unknown>> = await driver.find(
      'ticket',
      {},
      { bypassTenantAudit: true },
    );
    expect(rows.map((r) => String(r.id)).sort()).toEqual([...PAGINATION_ALL_IDS].sort());
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
      const whole: Array<Record<string, unknown>> = await driver.find(
        'ticket',
        { orderBy: [...testCase.orderBy] },
        { bypassTenantAudit: true },
      );
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
      // The fixture's ids are shuffled relative to insertion order, so this
      // distinguishes "the inherited tie-breaking ORDER BY reached the engine"
      // from "SQLite happened to hand back rowid order".
      expect(await walk(testCase.pageSize)).toEqual([...PAGINATION_ALL_IDS].sort());
    });
  }

  it('leaves an UNPAGED unordered read alone — no sort is imposed on a caller who asked for none', async () => {
    const rows: Array<Record<string, unknown>> = await driver.find(
      'ticket',
      {},
      { bypassTenantAudit: true },
    );
    expect(rows.map((r) => String(r.id))).toEqual(PAGINATION_ROWS.map((r) => r.id));
  });

  /**
   * `limit: 0` means "return no records" (#6485/#6577). The LOCAL transport
   * inherits `SqlDriver.findRows()`, which compiles `limit` on presence; the
   * REMOTE transport compiles its own LIMIT/OFFSET and is pinned by the twin of
   * this block in `turso-remote-pagination-conformance.test.ts`. Both are
   * asserted because this driver is dual-transport, and a contract only one
   * half keeps is a contract this package does not keep.
   */
  describe('`limit: 0` returns no records', () => {
    for (const testCase of PAGINATION_ZERO_LIMIT_CASES) {
      it(testCase.name, async () => {
        const rows: Array<Record<string, unknown>> = await driver.find(
          'ticket',
          { ...testCase.query },
          { bypassTenantAudit: true },
        );
        expect(rows).toHaveLength(testCase.expectedRowCount);
      });
    }
  });
});
