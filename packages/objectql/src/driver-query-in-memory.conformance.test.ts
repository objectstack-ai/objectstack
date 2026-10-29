// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27277] `applyDriverQueryInMemory` answers the spec's driver conformance
 * tables — the standard every built-in driver is held to — because it is what
 * answers a query for a plugin driver on an external datasource
 * (`external-driver-floor.ts`). The tables are the oracle, not any one driver.
 *
 * - `FILTER_LOGIC_CASES`: keys, operators, combinators, the null family.
 * - `FILTER_TEXT_CASES`: the text family, its comparand literalness, and every
 *   rejection row in the ADR-0112 envelope.
 * - `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` /
 *   `PAGINATION_ZERO_LIMIT_CASES`: a paged read is a partition; `limit` by
 *   presence.
 * - `TEMPORAL_CASES`: the `where` lowered as the engine hands it to a driver
 *   (`lowerFilterCondition`, tokens resolved against `TEMPORAL_NOW`), over rows
 *   in both writer forms, with the declared field classes.
 */

import { describe, it, expect } from 'vitest';
import {
  FILTER_LOGIC_CASES,
  FILTER_LOGIC_ROWS,
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  lowerFilterCondition,
  type FilterTextCase,
  type FilterTextRejectionCase,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';
import { declaredFieldClasses } from './having-filter.js';

const idsOf = (rows: Record<string, unknown>[]) => rows.map((row) => row.id as string);
const sortedIds = (rows: Record<string, unknown>[]) => idsOf(rows).sort();

describe('[#27277] applyDriverQueryInMemory — FILTER_LOGIC_CASES', () => {
  const rows = FILTER_LOGIC_ROWS.map((row) => ({ ...row }));
  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, () => {
      expect(sortedIds(applyDriverQueryInMemory(rows, { where: c.filter })), c.note).toEqual([...c.expected]);
    });
  }
});

describe('[#27277] applyDriverQueryInMemory — FILTER_TEXT_CASES', () => {
  const rows = FILTER_TEXT_ROWS.map((row) => ({ ...row }));
  const isRejection = (c: FilterTextCase): c is FilterTextRejectionCase => c.expectRejection === true;

  for (const c of FILTER_TEXT_CASES) {
    if (isRejection(c)) {
      it(`${c.name} — refused in the ADR-0112 envelope`, () => {
        let err: (Error & { code?: string; status?: number }) | undefined;
        try {
          applyDriverQueryInMemory(rows, { where: c.filter });
        } catch (e) {
          err = e as Error & { code?: string; status?: number };
        }
        expect(err, c.note ?? 'expected a refusal').toBeInstanceOf(Error);
        expect(err!.code).toBe(c.code);
        expect(err!.status).toBe(400);
        for (const mention of c.mustMention) expect(err!.message).toContain(mention);
      });
    } else {
      it(c.name, () => {
        expect(sortedIds(applyDriverQueryInMemory(rows, { where: c.filter })), c.note).toEqual([...c.expected]);
      });
    }
  }
});

describe('[#27277] applyDriverQueryInMemory — PAGINATION cases', () => {
  // Seeded in the table's order; the helper sorts, so arrival order is not a
  // sort the walk could lean on.
  const rows = PAGINATION_ROWS.map((row) => ({ ...row }));

  const walk = (query: { orderBy?: ReadonlyArray<{ field: string; order: 'asc' | 'desc' }> }, pageSize: number) => {
    const visited: string[] = [];
    for (let offset = 0; offset < rows.length; offset += pageSize) {
      visited.push(...idsOf(applyDriverQueryInMemory(rows, { ...query, limit: pageSize, offset })));
    }
    return visited;
  };

  for (const c of PAGINATION_CASES) {
    it(`${c.name}: every row exactly once, in the requested order`, () => {
      const visited = walk({ orderBy: c.orderBy }, c.pageSize);
      expect([...visited].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
      // The walk agrees with one unpaged read's order on every requested key.
      const whole = applyDriverQueryInMemory(rows, { orderBy: c.orderBy });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const keys = (id: string) => c.orderBy.map(({ field }) => (byId.get(id) as Record<string, unknown>)[field]);
      expect(visited.map(keys)).toEqual(idsOf(whole).map(keys));
    });
  }

  for (const c of PAGINATION_UNORDERED_CASES) {
    it(`unordered — ${c.name}: every row exactly once`, () => {
      const visited = walk({}, c.pageSize);
      expect(visited).toHaveLength(PAGINATION_ALL_IDS.length);
      expect([...visited].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });
  }

  for (const c of PAGINATION_ZERO_LIMIT_CASES) {
    it(`zero limit — ${c.name}`, () => {
      expect(applyDriverQueryInMemory(rows, c.query)).toHaveLength(c.expectedRowCount);
    });
  }
});

describe('[#27277] applyDriverQueryInMemory — TEMPORAL_CASES', () => {
  const FIELDS = { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'text' } };
  const fieldClasses = declaredFieldClasses(FIELDS);
  const lowered = <T,>(filter: T): T =>
    lowerFilterCondition(filter, { isDatetimeColumn: (column) => column === 'at' });
  const resolved = <T,>(filter: T): T => resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

  // A remote answers in whatever form it stores: the wire form on some rows,
  // a native `Date` on others (the table's writer axis).
  const rows = TEMPORAL_ROWS.map((r) => ({
    id: r.id,
    at: r.writerForm === 'native' ? new Date(r.at) : r.at,
    on: r.on,
    why: r.why,
  }));

  for (const c of TEMPORAL_CASES) {
    it(c.name, () => {
      const got = sortedIds(applyDriverQueryInMemory(rows, { where: lowered(c.filter) }, { fieldClasses }));
      expect(got, c.note).toEqual([...c.expected].sort());
    });
    if (c.tokenFilter) {
      it(`${c.name} — via relative tokens`, () => {
        const got = sortedIds(applyDriverQueryInMemory(rows, { where: lowered(resolved(c.tokenFilter)) }, { fieldClasses }));
        expect(got, c.note).toEqual([...c.expected].sort());
      });
    }
  }
});
