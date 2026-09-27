// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19810] The draft-preview matcher answers operators it cannot evaluate.
 *
 * ## The enumeration, read at `origin/main` (`c1dfa5241b`) before any edit
 *
 * `preview-evaluator.ts`'s `matchOp` switch carried exactly TEN cases —
 * `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$between`, `$in`, `$nin`,
 * `$contains` — and then, at `:109`:
 *
 * ```
 * default: return true; // unknown operator — permissive (preview, reads only)
 * ```
 *
 * So every OTHER operator matched EVERY row. Against the declared vocabulary
 * (`FILTER_OPERATORS`, plus the staged `$like` / `$ilike`) the silent set was
 * `$notContains`, `$startsWith`, `$endsWith`, `$icontains`, `$null`,
 * `$exists`, `$like`, `$ilike` — and any typo besides. A drafted chart with
 * `name $icontains 'acme'` charted the whole dataset; the published chart,
 * which runs the real filter doors, applied the filter. Same shape the file's
 * own `$between` case records for itself (#4081) and `lowerPreviewDateRange`
 * closed for the date-range vocabulary (#16322).
 *
 * ## What this file pins, in the two directions the repair has
 *
 * 1. **Fail-closed.** An operator with no arm is REFUSED — `INVALID_FILTER` /
 *    400, the envelope this package's `where` door already speaks — and the
 *    row it does not match is NOT answered. Refused rather than merely
 *    excluded: an excluded row makes the preview silently DIFFERENT from
 *    publish, which is the failure #16322 abolished on this same evaluator;
 *    a refusal makes the divergence visible to the author who can fix it.
 * 2. **Unchanged.** The ten operators the face DOES evaluate answer exactly
 *    what they answered before, in both directions (a matching row matches, a
 *    non-matching row does not). A fail-closed default that starts rejecting
 *    rows which used to match correctly is the mirror-image defect.
 *
 * The refusal is pinned by its `code` + `status` (ADR-0112), not by prose: a
 * bare `toThrow()` would be satisfied by any uncoded error, including the
 * `TypeError` a malformed filter raises on its own.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { FILTER_OPERATORS } from '@objectstack/spec/data';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { evaluateAnalyticsQueryOverRows, matchesWhere } from '../preview-evaluator.js';

// ── fixture ─────────────────────────────────────────────────────────────────

const ROWS: Record<string, unknown>[] = [
  { id: '1', name: 'Acme Corp', amount: 1200, spent_on: '2026-05-03' },
  // ⭐ the row `name $icontains 'acme'` does NOT match. Before the repair the
  //    preview answered it anyway; the published chart never did.
  { id: '2', name: 'Globex', amount: 800, spent_on: '2026-05-12' },
];

const DATASET = DatasetSchema.parse({
  name: 'expense_ds',
  label: 'Expense',
  object: 'expense',
  dimensions: [{ name: 'name', field: 'name', type: 'string', label: 'Name' }],
  measures: [{ name: 'count', aggregate: 'count' }],
});

const CUBE: Cube = new AnalyticsService().registerDataset(DATASET).cube;

/** The dimension values the preview ANSWERS — empty when it refuses. */
function namesAnswered(where: Record<string, unknown>, rows = ROWS): string[] {
  try {
    const result = evaluateAnalyticsQueryOverRows(
      { cube: 'expense_ds', measures: ['count'], dimensions: ['name'], where },
      CUBE,
      rows,
    );
    return result.rows.map((r) => String(r.name));
  } catch {
    return [];
  }
}

/** The error a preview refuses with, or `undefined` if it answered. */
function refusalFor(where: Record<string, unknown>, rows = ROWS): (Error & { code?: string; status?: number }) | undefined {
  try {
    evaluateAnalyticsQueryOverRows(
      { cube: 'expense_ds', measures: ['count'], dimensions: ['name'], where },
      CUBE,
      rows,
    );
    return undefined;
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
}

// ── direction 1 — an operator with no arm must not answer every row ─────────

describe('[#19810] an operator the draft preview cannot evaluate', () => {
  it('does NOT answer the row that `name $icontains "acme"` excludes', () => {
    // ⛔ Before the repair this read `['Acme Corp', 'Globex']`: the `default`
    //    arm answered true for both rows, so the drafted chart counted Globex
    //    into a filter that excludes it.
    expect(namesAnswered({ name: { $icontains: 'acme' } })).not.toContain('Globex');
  });

  it('refuses it in the ADR-0112 `INVALID_FILTER` / 400 envelope', () => {
    const err = refusalFor({ name: { $icontains: 'acme' } });
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    // The operator and the face's own vocabulary are both in the message, so
    // the author can see which spelling to reach for.
    expect(err?.message).toContain('$icontains');
    expect(err?.message).toContain('$contains');
  });

  it('refuses over an EMPTY seed draft too — the walk is not a function of the data', () => {
    // The state a draft is authored in. A per-row refusal never fires here, so
    // the preview would answer `count: 0` for a filter it cannot evaluate.
    const err = refusalFor({ name: { $icontains: 'acme' } }, []);
    expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
  });

  it('refuses inside `$or`, `$and` and `$not` arms', () => {
    for (const where of [
      { $or: [{ name: { $startsWith: 'Ac' } }, { amount: { $eq: -1 } }] },
      { $and: [{ name: { $endsWith: 'Corp' } }] },
      { $not: { name: { $notContains: 'zzz' } } },
    ]) {
      expect(refusalFor(where)).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    }
  });

  it('refuses a constraint key that names an Object.prototype member', () => {
    // A table keyed by a plain object literal would resolve `toString` to the
    // inherited function and CALL it as a predicate; a `Map` cannot.
    expect(refusalFor({ name: { toString: 'Acme' } })).toMatchObject({
      code: 'INVALID_FILTER',
      status: 400,
    });
  });

  /**
   * The declared vocabulary, minus the ten arms this face carries. Derived
   * from `FILTER_OPERATORS` rather than hand-listed, so an operator added to
   * the protocol without an arm here lands in this table by itself instead of
   * going silent.
   */
  const EVALUATED = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$between', '$in', '$nin', '$contains'];
  const UNEVALUATED = [...FILTER_OPERATORS, '$like', '$ilike'].filter((op) => !EVALUATED.includes(op));

  it('has a non-empty unevaluated set — otherwise the table below asserts nothing', () => {
    expect(UNEVALUATED).toEqual(
      expect.arrayContaining(['$notContains', '$startsWith', '$endsWith', '$icontains', '$null', '$exists', '$like', '$ilike']),
    );
  });

  it.each(UNEVALUATED)('%s is refused, never answered for every row', (op) => {
    const where = { name: { [op]: 'acme' } } as Record<string, unknown>;
    expect(refusalFor(where)).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    expect(namesAnswered(where)).toEqual([]);
  });
});

// ── direction 2 — the ten arms are untouched ────────────────────────────────

describe('[#19810] the operators the draft preview DOES evaluate are unchanged', () => {
  const ROW = { name: 'Acme Corp', amount: 800, spent_on: '2026-05-12' };

  // [matches, does not match] for each arm — both directions, because a
  // fail-closed default that starts REJECTING correct matches is the
  // mirror-image defect of the one this card fixes.
  const MATRIX: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ['$eq', { amount: { $eq: 800 } }, { amount: { $eq: 1200 } }],
    ['$ne', { amount: { $ne: 1200 } }, { amount: { $ne: 800 } }],
    ['$gt', { amount: { $gt: 700 } }, { amount: { $gt: 800 } }],
    ['$gte', { amount: { $gte: 800 } }, { amount: { $gte: 801 } }],
    ['$lt', { amount: { $lt: 900 } }, { amount: { $lt: 800 } }],
    ['$lte', { amount: { $lte: 800 } }, { amount: { $lte: 799 } }],
    ['$lte (bare-day, #3777)', { spent_on: { $lte: '2026-05-12' } }, { spent_on: { $lte: '2026-05-11' } }],
    ['$between', { amount: { $between: [700, 900] } }, { amount: { $between: [900, 1000] } }],
    ['$in', { name: { $in: ['Acme Corp', 'Globex'] } }, { name: { $in: ['Globex'] } }],
    ['$nin', { name: { $nin: ['Globex'] } }, { name: { $nin: ['Acme Corp'] } }],
    ['$contains', { name: { $contains: 'cme' } }, { name: { $contains: 'zzz' } }],
    ['implicit equality', { name: 'Acme Corp' }, { name: 'Globex' }],
    ['$and', { $and: [{ amount: { $gt: 700 } }] }, { $and: [{ amount: { $gt: 900 } }] }],
    ['$or', { $or: [{ amount: { $gt: 900 } }, { name: { $contains: 'cme' } }] }, { $or: [{ amount: { $gt: 900 } }] }],
    ['$not', { $not: { amount: { $eq: 1200 } } }, { $not: { amount: { $eq: 800 } } }],
  ];

  it.each(MATRIX)('%s still answers both directions', (_label, hit, miss) => {
    expect(matchesWhere(ROW, hit)).toBe(true);
    expect(matchesWhere(ROW, miss)).toBe(false);
  });

  it('an absent `where` still matches every row', () => {
    expect(matchesWhere(ROW, undefined)).toBe(true);
    expect(namesAnswered({})).toEqual(expect.arrayContaining(['Acme Corp', 'Globex']));
  });
});

// ── the refusal reaches the request path ────────────────────────────────────

describe('[#19810] the refusal propagates through queryDataset({ previewDrafts })', () => {
  it('refuses the drafted selection instead of charting every seed row', async () => {
    const service = new AnalyticsService({ draftRowsResolver: vi.fn(async () => ROWS) });
    await expect(
      service.queryDataset(
        DATASET,
        { dimensions: ['name'], measures: ['count'], runtimeFilter: { name: { $icontains: 'acme' } } },
        undefined,
        { previewDrafts: true },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FILTER', status: 400 });
  });
});
