// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deterministic paged reads for the in-memory driver (objectui#3106) — the
 * contract on `IDataDriver.find`, checked against the shared cases in
 * `@objectstack/spec/data`.
 *
 * This driver needed **no change** to satisfy it, and that is worth a suite
 * rather than a shrug. It sorts with `Array#sort`, which ES2019 onward
 * guarantees is stable, over a table array whose order does not move between
 * two reads — so equal keys keep the same relative arrangement on page 2 that
 * they had on page 1, which is precisely what the contract asks for.
 *
 * The guarantee is therefore load-bearing but implicit: it rests on `sort`
 * being stable and on `applySort` copying rather than reordering the table in
 * place. Both are easy to lose in a refactor that looks like a speed-up — a
 * hand-rolled quicksort, or sorting the backing array directly — and neither
 * loss would fail any other test in this package. That is what this file is
 * for: it holds the property against the day the implementation changes, which
 * is the only day it could break.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PAGINATION_ALL_IDS, PAGINATION_CASES, PAGINATION_ROWS } from '@objectstack/spec/data';
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

      const whole = await driver.find('ticket', { orderBy: [...testCase.orderBy] } as any);
      expect(paged.map((r) => r.id)).toEqual(whole.map((r: any) => r.id));
    });
  }
});
