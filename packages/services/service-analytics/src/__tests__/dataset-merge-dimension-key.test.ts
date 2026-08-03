// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dimension key `mergeByDimensions` aligns rows on (#4821).
 *
 * Every multi-query dataset result is assembled through that merge: the primary
 * pass against each measure-scoped supplementary pass, and — since #4870 — the
 * current window against the shifted `compareTo` window, which fans out per
 * measure the same way. A key collision there does not fail: one group silently
 * absorbs another's measures and the grid keeps a plausible shape.
 *
 * ## What was actually wrong, which is not quite what #4821 reported
 *
 * The old key was `String(row[d] ?? '')` joined on a **raw U+0001 byte written
 * literally into the source**. A raw control byte renders as nothing, so the
 * issue was filed reading `join('')` and its headline repro (`['ab','c']` vs
 * `['a','bc']` both keying `"abc"`) never actually reproduced — the separator
 * was there, just invisible. What did bite:
 *
 *   - `?? ''` keyed a genuinely NULL dimension the same as an empty-string one,
 *     merging "unassigned" into "blank";
 *   - a one-character separator is only unambiguous while no dimension VALUE
 *     contains it, and dimension values are user data.
 *
 * So the suite below pins the tuple-distinctness property directly — it holds
 * for adjacent-value ambiguity, for a value carrying the old separator, and for
 * null vs. empty — rather than pinning the particular encoding that delivers it.
 *
 * ## The pin that guards the rejected direction
 *
 * `numeric 1 and string '1' still key the SAME` is a REGRESSION PIN, not an
 * incidental observation. The obvious "fix" (and #4821's own suggestion) is the
 * `JSON.stringify` key `cross-object-rebucket.ts` uses, which would render those
 * `1` and `"1"` and split them into two groups. That function re-buckets ONE
 * query's rows, where a column has one type; this merge ALIGNS SEPARATE
 * QUERIES, and drivers do return the same group differently typed across them
 * (`compareValues`: "numeric strings, which is how some drivers return SUM
 * results"). Adopting JSON here would trade a silent defect for a new one.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAnalyticsService, AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import { DatasetSchema } from '@objectstack/spec/ui';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor, mergeByDimensions } from '../dataset-executor.js';

/** The separator the old key joined on, referenced only as an escape sequence. */
const OLD_SEPARATOR = '\u0001';

const DIMS = ['region', 'segment'];

describe('mergeByDimensions — distinct dimension tuples never share a key (#4821)', () => {
  it('keeps the adjacent-value pair apart: {ab, c} is not {a, bc}', () => {
    const base = [
      { region: 'ab', segment: 'c', revenue: 10 },
      { region: 'a', segment: 'bc', revenue: 20 },
    ];
    const extra = [
      { region: 'ab', segment: 'c', won: 1 },
      { region: 'a', segment: 'bc', won: 2 },
    ];

    const rows = mergeByDimensions(base, extra, DIMS, ['won']);

    expect(rows).toHaveLength(2);
    // Each group keeps its OWN number. The failure mode is not an error: it is
    // `won: 2` landing on the {ab, c} row while {a, bc} is left without one.
    expect(rows.find((r) => r.region === 'ab')).toMatchObject({ segment: 'c', revenue: 10, won: 1 });
    expect(rows.find((r) => r.region === 'a')).toMatchObject({ segment: 'bc', revenue: 20, won: 2 });
  });

  it('cannot be forged by a value that CONTAINS the old separator', () => {
    // The property a single separator character can only assume: this pair is
    // indistinguishable once the tuple is joined on U+0001, and a text field
    // really can carry one (imported records, pasted payloads).
    const base = [
      { region: `a${OLD_SEPARATOR}b`, segment: 'c', revenue: 10 },
      { region: 'a', segment: `b${OLD_SEPARATOR}c`, revenue: 20 },
    ];
    // Addressed to the FIRST row on purpose. Under the old key both base rows
    // index to one entry — the LAST one wins — so this merge landed on the
    // second row instead: the measure of one group written onto another.
    const extra = [{ region: `a${OLD_SEPARATOR}b`, segment: 'c', won: 7 }];

    const rows = mergeByDimensions(base, extra, DIMS, ['won']);

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.region === `a${OLD_SEPARATOR}b`)?.won).toBe(7);
    expect(rows.find((r) => r.region === 'a')?.won).toBeUndefined();
  });

  it('keeps a NULL dimension apart from an empty-string one — "unassigned" is not "blank"', () => {
    const base = [
      { region: null, segment: 'ent', revenue: 10 },
      { region: '', segment: 'ent', revenue: 20 },
    ];
    const extra = [
      { region: null, segment: 'ent', won: 1 },
      { region: '', segment: 'ent', won: 2 },
    ];

    const rows = mergeByDimensions(base, extra, DIMS, ['won']);

    expect(rows).toHaveLength(2);
    // `?? ''` keyed both as the empty tuple: the unassigned row came back
    // without a `won` at all while the blank row absorbed both merges.
    expect(rows.find((r) => r.region === null)?.won).toBe(1);
    expect(rows.find((r) => r.region === '')?.won).toBe(2);
  });

  it('treats an ABSENT dimension column as the same "no value" as null', () => {
    // Deliberate, and the opposite call from null-vs-empty: drivers omit null
    // columns from row objects, so splitting here would re-create the
    // cross-query mismatch the key exists to absorb.
    const base = [{ region: null, segment: 'ent', revenue: 10 }];
    const extra = [{ segment: 'ent', won: 3 }];

    const rows = mergeByDimensions(base, extra, DIMS, ['won']);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ region: null, segment: 'ent', revenue: 10, won: 3 });
  });

  it('REGRESSION PIN — numeric 1 and string "1" still key the SAME (no JSON.stringify key)', () => {
    // The main query and a measure-scoped sub-query can type one group
    // differently; `String()` per segment is what keeps them one row. A
    // JSON-encoded key splits this into two rows, silently — which is why this
    // test exists and why it must not be "corrected".
    const base = [{ region: 1, segment: 2, revenue: 10 }];
    const extra = [{ region: '1', segment: '2', won: 5 }];

    const rows = mergeByDimensions(base, extra, DIMS, ['won']);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ region: 1, segment: 2, revenue: 10, won: 5 });
  });
});

// ── the same properties through the real executor ───────────────────────────

function fakeService(handler: (q: AnalyticsQuery) => AnalyticsResult): IAnalyticsService {
  return { query: vi.fn(async (q: AnalyticsQuery) => handler(q)), getMeta: async () => [] };
}

const matrix = DatasetSchema.parse({
  name: 'matrix', label: 'Matrix', object: 'opportunity',
  dimensions: [
    { name: 'region', field: 'region', type: 'string' },
    { name: 'segment', field: 'segment', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date' },
  ],
  measures: [
    { name: 'revenue', aggregate: 'sum', field: 'amount' },
    { name: 'won_count', aggregate: 'count', filter: { stage: 'closed_won' } },
  ],
});

/**
 * Four groups over `region × segment`, each with its own numbers:
 *   - the adjacent-value pair {ab, c} / {a, bc};
 *   - the unassigned/blank pair {null, ent} / {'', ent}.
 *
 * `won_count` carries a filter, so it arrives as a SEPARATE grouped query that
 * has to be merged back by dimension key — the seam under test. Every group
 * reports a distinct `won_count`, so any collision shows up as one row wearing
 * another's number rather than as a missing row.
 */
const GROUPS = [
  { region: 'ab', segment: 'c', revenue: 10, won_count: 1 },
  { region: 'a', segment: 'bc', revenue: 20, won_count: 2 },
  { region: null as string | null, segment: 'ent', revenue: 30, won_count: 3 },
  { region: '', segment: 'ent', revenue: 40, won_count: 4 },
];

const isShifted = (q: AnalyticsQuery) => JSON.stringify(q.timeDimensions ?? []).includes('2025-12');

/** Previous-window numbers are the current ones ×10, so a mix-up is legible. */
const matrixService = fakeService((q) => {
  const scale = isShifted(q) ? 10 : 1;
  const measure = q.measures[0];
  return {
    rows: GROUPS.map((g) => ({
      region: g.region,
      segment: g.segment,
      [measure]: (measure === 'revenue' ? g.revenue : g.won_count) * scale,
    })),
    fields: [],
  };
});

const runMatrix = (compareTo?: boolean) =>
  new DatasetExecutor(matrixService).execute(compileDataset(matrix), {
    dimensions: ['region', 'segment'],
    measures: ['revenue', 'won_count'],
    ...(compareTo
      ? {
          timeDimensions: [
            { dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] as [string, string] },
          ],
          compareTo: { kind: 'previousPeriod' as const, dimension: 'close_date' },
        }
      : {}),
  });

const find = (rows: Record<string, unknown>[], region: string | null) =>
  rows.find((r) => r.region === region && r.segment === (region === null || region === '' ? 'ent' : r.segment))!;

describe('executor — a measure-scoped sub-query merges onto the right row (#4821)', () => {
  it('gives every group its own won_count, unassigned and blank included', async () => {
    const rows = (await runMatrix()).rows;

    expect(rows).toHaveLength(4);
    expect(find(rows, 'ab')).toMatchObject({ segment: 'c', revenue: 10, won_count: 1 });
    expect(find(rows, 'a')).toMatchObject({ segment: 'bc', revenue: 20, won_count: 2 });
    expect(find(rows, null)).toMatchObject({ revenue: 30, won_count: 3 });
    expect(find(rows, '')).toMatchObject({ revenue: 40, won_count: 4 });
  });

  it('does not render the unassigned group as an empty group', async () => {
    const rows = (await runMatrix()).rows;
    // The blank row used to absorb both merges, leaving the unassigned row's
    // `won_count` ABSENT — which #4708 then fills with a confident 0. A count
    // of 3 reported as 0 is the shape of this defect after that fill.
    expect(find(rows, null).won_count).not.toBe(0);
    expect(find(rows, null).won_count).toBe(3);
  });
});

describe('executor — the compareTo merge lands on the right row too (#4870 seam, #4821)', () => {
  it('attaches each group its OWN __compare columns', async () => {
    const rows = (await runMatrix(true)).rows;

    expect(rows).toHaveLength(4);
    // Previous window = current ×10. A collision on this merge writes one
    // group's history into another's row — the `__compare` column is what the
    // reader subtracts, so a wrong one inverts the direction of the tile.
    expect(find(rows, 'ab')).toMatchObject({ revenue__compare: 100, won_count__compare: 10 });
    expect(find(rows, 'a')).toMatchObject({ revenue__compare: 200, won_count__compare: 20 });
    expect(find(rows, null)).toMatchObject({ revenue__compare: 300, won_count__compare: 30 });
    expect(find(rows, '')).toMatchObject({ revenue__compare: 400, won_count__compare: 40 });
  });

  it('does not append phantom rows for buckets that already exist', async () => {
    // `mergeByDimensions` APPENDS an unmatched extra row, so a key that fails
    // to match its own counterpart doubles the grid instead of merging it.
    const rows = (await runMatrix(true)).rows;
    const keys = rows.map((r) => `${String(r.region)}|${String(r.segment)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
