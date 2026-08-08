// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deterministic paged reads for the in-memory driver (objectui#3106,
 * objectstack#4363) — the contract on `IDataDriver.find`, checked against the
 * shared cases in `@objectstack/spec/data`.
 *
 * This driver needed **no change** to satisfy either half, and that is worth a
 * suite rather than a shrug.
 *
 * - **Sorted pages.** It sorts with `Array#sort`, which ES2019 onward
 *   guarantees is stable, over a table array whose order does not move between
 *   two reads — so equal keys keep the same relative arrangement on page 2 that
 *   they had on page 1.
 * - **Unsorted pages.** With no `orderBy` it slices that same array directly,
 *   and the array is the storage: two reads with no write between them see the
 *   identical sequence. There is no plan to change its mind and no natural
 *   order to move, so the walk partitions the set without a sort being imposed.
 *   The contract asks for determinism, not for id order, and this driver
 *   supplies it from a different direction than SQL and MongoDB do.
 *
 * The guarantee is therefore load-bearing but implicit: it rests on `sort`
 * being stable, on `applySort` copying rather than reordering the table in
 * place, and on `find` slicing a copy rather than the live table. All are easy
 * to lose in a refactor that looks like a speed-up — a hand-rolled quicksort,
 * sorting the backing array directly, a "reuse the array" allocation saving —
 * and no other test in this package would fail. That is what this file is for:
 * it holds the property against the day the implementation changes, which is
 * the only day it could break.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
} from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';

describe('InMemoryDriver — paged reads are a partition of the result set (objectui#3106)', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    for (const row of PAGINATION_ROWS) {
      await driver.create('ticket', { ...row });
    }
  });

  for (const testCase of PAGINATION_CASES) {
    it(`visits every row exactly once — ${testCase.name}`, async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find('ticket', {
          orderBy: [...testCase.orderBy],
          limit: testCase.pageSize,
          offset,
        } as any);
        seen.push(...page.map((r: any) => String(r.id)));
      }

      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`page boundaries are invisible — ${testCase.name}`, async () => {
      const paged: any[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find('ticket', {
          orderBy: [...testCase.orderBy],
          limit: testCase.pageSize,
          offset,
        } as any);
        paged.push(...page);
      }

      const whole = await driver.find('ticket', { orderBy: [...testCase.orderBy] });
      expect(paged.map((r) => r.id)).toEqual(whole.map((r: any) => r.id));
    });
  }

  for (const testCase of PAGINATION_UNORDERED_CASES) {
    it(`visits every row exactly once with NO orderBy at all — ${testCase.name}`, async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find('ticket', { limit: testCase.pageSize, offset } as any);
        seen.push(...page.map((r: any) => String(r.id)));
      }

      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`page boundaries are invisible with NO orderBy — ${testCase.name}`, async () => {
      const paged: any[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find('ticket', { limit: testCase.pageSize, offset } as any);
        paged.push(...page);
      }

      // Concatenating the pages reproduces the unpaged read exactly. Note this
      // is insertion order, NOT id order: the contract asks for a partition,
      // and this driver's storage already provides one, so nothing is imposed.
      const whole = await driver.find('ticket', {} as any);
      expect(paged.map((r) => r.id)).toEqual(whole.map((r: any) => r.id));
      expect(paged.map((r) => r.id)).toEqual(PAGINATION_ROWS.map((r) => r.id));
    });
  }

  /**
   * `limit: 0` returns no records (#6485/#6577).
   *
   * This is the driver the card was filed about. `find()` sliced with
   * `if (query.limit)` — truthiness — so `limit: 0` dropped the slice and the
   * read that asked for nothing was answered with all twelve rows. Measured
   * before the fix on a three-row table: `{ limit: 0 }` -> 3, and
   * `{ limit: 0, offset: 1 }` -> 2, i.e. the OFFSET applied and the LIMIT did
   * not — which is why every paging suite here stayed green over it.
   *
   * The #5499 investment freeze was lifted for this door specifically
   * (maintainer ruling on #6577), and for nothing else in this package.
   */
  describe('`limit: 0` returns no records', () => {
    for (const testCase of PAGINATION_ZERO_LIMIT_CASES) {
      it(testCase.name, async () => {
        const rows = await driver.find('ticket', { ...testCase.query });
        expect(rows).toHaveLength(testCase.expectedRowCount);
      });
    }
  });
});
