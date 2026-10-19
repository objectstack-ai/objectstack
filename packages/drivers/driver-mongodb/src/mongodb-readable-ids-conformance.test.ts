// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3, plan row E4] `driver-mongodb` REFUSES the `ReadableIds` leaf,
 * and the conformance table records it as refusing: D3's envelope
 * (`INTERNAL_ERROR` / 500) on every case that holds a composed leaf and on the
 * uncomposed case, and the row answer on the one case that holds none (the
 * engine's `$in: []` denial). It refuses until a card measures a pipeline form
 * of the tenant-walled semi-join (ADR-0139 open item O3).
 *
 * Server-free, at `translateFilter` — the translation every door (`find`,
 * `findOne`, `count`, `updateMany`, `deleteMany`) and the aggregation pipeline
 * hand their `where` to, before any I/O. This fleet cannot fetch a mongod
 * binary (see `test-mongod.ts`), and a refusal raised before the collection is
 * asked needs none.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  READABLE_IDS_CASES,
  READABLE_IDS_REFUSAL,
  ReadableIds,
  lowerFilterCondition,
} from '@objectstack/spec/data';
import { translateFilter } from './mongodb-filter.js';
import { buildAggregationPipeline } from './mongodb-aggregation.js';

const seamed = (where: unknown): any => lowerFilterCondition(where, { isDatetimeColumn: () => false });

/** The refusal `translateFilter` raised for `where`, or a failure naming what it returned instead. */
function refusalOf(where: unknown): unknown {
  try {
    const out = translateFilter(where);
    return { notRefused: out };
  } catch (err) {
    return err;
  }
}

/**
 * The rows a translated filter of the one shape the non-leaf case produces —
 * a single `{ k: { $in: [] } }` — admits: none. Any other shape is not modelled
 * here and fails the case rather than being approximated.
 */
function rowsAdmittedByEmptyIn(filter: Record<string, unknown>): string[] {
  const entries = Object.entries(filter);
  expect(entries).toHaveLength(1);
  const [, spec] = entries[0];
  expect(spec).toEqual({ $in: [] });
  return [];
}

describe('[ADR-0139 D3] driver-mongodb — ReadableIds conformance (refusing driver)', () => {
  for (const c of READABLE_IDS_CASES) {
    if (c.verdict === 'refuses-uncomposed' || c.holdsComposedLeaf) {
      it(`${c.name} — refused with D3's envelope`, () => {
        expect(refusalOf(seamed(c.where())), c.note).toMatchObject(READABLE_IDS_REFUSAL);
      });
    } else {
      it(c.name, () => {
        expect(rowsAdmittedByEmptyIn(translateFilter(seamed(c.where())) as Record<string, unknown>), c.note).toEqual(
          c.expected,
        );
      });
    }
  }

  it('the aggregation pipeline refuses the leaf in its $match the same way', () => {
    const where = { record_id: { $in: ReadableIds.compose(ReadableIds.of('rid_parent'), undefined) } };
    let caught: unknown;
    try {
      buildAggregationPipeline({ where, aggregations: [{ function: 'count', alias: 'n' }] } as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject(READABLE_IDS_REFUSAL);
  });

  it('the refusal is never INVALID_FILTER, and it is logged at error once per process', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let i = 0; i < 2; i++) {
        const err = refusalOf({ record_id: { $in: ReadableIds.of('rid_parent') } }) as { code?: string };
        expect(err.code).toBe('INTERNAL_ERROR');
      }
      // The cases above already refused in this worker, so the one line was written there.
      expect(error.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      error.mockRestore();
    }
  });
});
