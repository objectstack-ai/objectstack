// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4436] The uncompilable-filter refusal must carry an ADR-0112 wire identity.
 *
 * #4209/#4029/#3948 settled the POSTURE — a filter the driver cannot compile is
 * refused instead of silently matching every row. What was still missing is the
 * refusal's IDENTITY on the wire.
 *
 * The driver threw a bare `Error`, so it carried no `code` and no `status`.
 * `@objectstack/rest`'s `mapDataError` therefore fell all the way through to its
 * default branch — `{ status: 400, body: { error: raw } }` — and served a body
 * whose only key was `error`:
 *
 * ```
 * GET /api/v1/data/showcase_task?filter={"title":{"$bogusop":"x"}}
 * → 400 {"error":"[sql-driver] Unsupported filter operator \"$bogusop\" …"}
 * ```
 *
 * Two contract breaks in one body: no `error.code` at all, on a route whose
 * sibling rejections all speak the catalogued vocabulary (`INVALID_FIELD`,
 * `INVALID_FILTER`, `RECORD_NOT_FOUND`); and the driver-internal `[sql-driver]`
 * prefix on the wire, which is precisely what the #3867 sanitiser exists to
 * stop.
 *
 * These tests pin BOTH halves at the throw site, because that is where the fix
 * lives (PD #12 — the producer declares its own refusal; the REST layer is not
 * patched to guess).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import type { FilterCondition } from '@objectstack/spec/data';

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

async function refusalOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this filter, but it resolved');
}

describe('[#4436] SqlDriver filter refusals carry INVALID_FILTER and leak no driver prefix', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          amount: { type: 'number', name: 'amount' },
        },
      } as any,
    ]);
    await driver.create('deal', { id: '1', stage: 'won', amount: 10 });
  });

  const find = (where: unknown) =>
    driver.find('deal', { fields: ['id'], where: where as FilterCondition });

  // The issue's own repro, at the layer that produces the envelope.
  it('the $-object unsupported-operator branch — the exact shape #4436 reported', async () => {
    const err = await refusalOf(() => find({ stage: { $bogusop: 'x' } }));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('[sql-driver]');
    // The actionable half survives the sanitisation — a caller must still be
    // able to see WHICH operator on WHICH field, and what is accepted instead.
    expect(err.message).toContain('$bogusop');
    expect(err.message).toContain('stage');
    expect(err.message).toContain('$startsWith');
  });

  // Every filter-COMPILATION refusal in this driver answers the same way. They
  // are one condition — "this filter cannot run" — and ADR-0112's rule is one
  // condition, one wire code, however the caller reached it.
  const cases: Array<[string, unknown, string]> = [
    ['legacy triple, unsupported operator', [['stage', 'sounds_like', 'won']], 'sounds_like'],
    ['bare comparison triple', ['close_date', 'before', '2024-01-01'], 'close_date'],
    // [#5158] The message names the ARRAY, not the offending element's typeof:
    // the driver no longer walks a filter array, so it has no element to
    // describe. `42` is the caller's own value, echoed back.
    ['filter element of the wrong type', [42], '42'],
    ['null filter element', [null], 'null'],
    ['legacy `between` with a bad operand', [['amount', 'between', 5]], 'between'],
    ['$between with a bad operand', { amount: { $between: 5 } }, '$between'],
  ];

  for (const [name, where, needle] of cases) {
    it(`${name} → 400 INVALID_FILTER, no prefix`, async () => {
      const err = await refusalOf(() => find(where));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).not.toContain('[sql-driver]');
      expect(err.message).toContain(needle);
    });
  }

  it('a compilable filter is unaffected', async () => {
    const rows = await find({ stage: 'won' });
    expect(rows.map((r: any) => r.id)).toEqual(['1']);
  });
});
