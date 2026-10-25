/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4466 — a NULL-keyed group must render as an explicit bucket, never
 * vanish.
 *
 * The single-dimension branch of `buildChartSeries` passed rows through
 * verbatim, so a row whose category VALUE is `null` reached recharts with a
 * null category and drew no mark. The sharpest measured case is the partial
 * one: `[{user_id: null, event_count: 51}, {user_id: 'Dev Admin',
 * event_count: 2}]` drew exactly ONE bar — the DOMINANT group (51 of 53
 * events) silently dropped, while the y-axis scale still accommodated it. The
 * chart was not merely empty, it understated its own data without saying so.
 *
 * This is the shipped first-boot state of the built-in System Overview board:
 * every seeded `sys_audit_log` row is written with `user_id = NULL`, so "Events
 * by User" groups to exactly one row and drew nothing at all.
 *
 * The division of labour with the framework#4033 guard is pinned here too,
 * because the fix could easily erase it: a row that does not carry the category
 * key AT ALL is NOT bucketed — that shape belongs to `hasNoCategoryKey`
 * (plugin-charts' `AdvancedChartImpl`), which explains itself instead of
 * drawing an empty axis. Key absent → that path; key present, value null →
 * this bucket.
 *
 * objectui#4497 extends the same doctrine to the MULTI-dimension pivot branch,
 * which #4466 deliberately left pinned as-is (that pin is updated below, in the
 * commit that changed it). The pivot's mechanism differs in exactly one way,
 * which is why it needed its own card: it buckets rows by a map KEY
 * (`String(xRaw ?? '')`) and writes a separate DISPLAY value into the emitted
 * row, so a null x was bucketed correctly and STILL reached recharts raw. The
 * key is untouched; only the display value is labelled. The drill half is
 * pinned at the bottom of this file, with the measurement behind it.
 *
 * objectui#4673 is the same defect one dimension over, and the last of the four:
 * the pivot's SECOND dimension kept the pre-#4466 answer (`gId !== ''`, drop
 * it) while still writing the dropped group's measure into the bucket. The
 * blocks at the bottom of this file are its own.
 *
 * objectui#4507 is the last of the family, and it is about the DIVISION rather
 * than the bucket: the pivot wrote the axis key onto every bucket it created,
 * so a first dimension grouped by but never PROJECTED reached the renderer with
 * the key present (value `undefined`) and `hasNoCategoryKey` could not fire for
 * a pivoted chart at all. The pin at the bottom of this file recorded that as a
 * measured limit; it is now lifted, and the case's own assertion — key-absent
 * rows are never relabelled `(None)` — is unchanged. `key in row` is the whole
 * signal, and `toEqual` cannot see it: `chart-series.unprojectedCategory.test.ts`.
 *
 * objectui#4508 then answers what #4497 filed instead of widening into: that
 * map KEY was the DISPLAY string, so it could not tell a null group from an
 * empty-string one, nor from a record whose stored value spells the bucket
 * label. The key is now the bucket's IDENTITY (`chartBucketId`, the encoder the
 * pivot TABLE already uses), and where two distinct buckets still paint the
 * same axis text the emitted row carries that identity under
 * `CHART_BUCKET_ID_KEY` for the click to hand back. The three cases #4497
 * pinned as limits are updated at the bottom of this file, in the commit that
 * changed them — as that pin's own note said they would have to be.
 */
import { describe, it, expect } from 'vitest';
import {
  buildChartSeries,
  findChartSeriesRow,
  chartBucketId,
  chartRowBucketId,
  CHART_BUCKET_ID_KEY,
  NULL_CATEGORY_LABEL,
  type ChartSegmentClickEvent,
} from './chart-series';
import { pivotBucketId, pivotDimensionValue } from './dataset-pivot';

/** The card's case 3, verbatim — the dominant group is the null-keyed one. */
const PARTIAL = [
  { user_id: null, event_count: 51 },
  { user_id: 'Dev Admin', event_count: 2 },
];

/** The card's case 1/2 — the organic first-boot seed state. */
const ALL_NULL = [{ user_id: null, event_count: 50 }];

describe('buildChartSeries — null-keyed category bucket (objectui#4466)', () => {
  it('labels the null group instead of dropping it (the partial case)', () => {
    const r = buildChartSeries(PARTIAL, ['user_id'], ['event_count']);

    expect(r.xAxisKey).toBe('user_id');
    // BOTH groups survive, and the null one keeps its 51 events.
    expect(r.data).toEqual([
      { user_id: NULL_CATEGORY_LABEL, event_count: 51 },
      { user_id: 'Dev Admin', event_count: 2 },
    ]);
  });

  it('labels the all-null result rather than drawing an axis with no marks', () => {
    const r = buildChartSeries(ALL_NULL, ['user_id'], ['event_count']);
    expect(r.data).toEqual([{ user_id: NULL_CATEGORY_LABEL, event_count: 50 }]);
  });

  it('buckets an undefined category value the same way', () => {
    const r = buildChartSeries([{ user_id: undefined, event_count: 7 }], ['user_id'], ['event_count']);
    expect(r.data).toEqual([{ user_id: NULL_CATEGORY_LABEL, event_count: 7 }]);
  });

  it('uses the caller-supplied (localized) label when one is given', () => {
    const r = buildChartSeries(ALL_NULL, ['user_id'], ['event_count'], null, {
      nullCategoryLabel: '(未指定)',
    });
    expect(r.data).toEqual([{ user_id: '(未指定)', event_count: 50 }]);
  });

  it('never mutates the caller rows — drill-through reads the raw null', () => {
    const rows = [{ user_id: null, event_count: 50 }];
    buildChartSeries(rows, ['user_id'], ['event_count']);
    expect(rows[0].user_id).toBeNull();
  });

  it('leaves a row that lacks the category key ENTIRELY to the #4033 guard', () => {
    // Adding the key here would erase `hasNoCategoryKey`'s whole signal: the
    // renderer would draw an "(None)" axis instead of naming the unprojected
    // dimension. Key absent is a different defect with a different answer.
    const unreadable = [{ count: 2 }, { count: 8 }];
    const r = buildChartSeries(unreadable, ['issued'], ['count']);
    expect(r.data).toBe(unreadable);
    expect(r.data.every((row) => !('issued' in row))).toBe(true);
  });
});

describe('buildChartSeries — must-not-change (objectui#4466)', () => {
  it('returns non-null rows BY IDENTITY, unchanged', () => {
    const rows = [
      { status: 'Backlog', est_hours: 5 },
      { status: 'Done', est_hours: 24 },
    ];
    const r = buildChartSeries(rows, ['status'], ['est_hours']);
    expect(r.data).toBe(rows);
    expect(r.data).toEqual(rows);
  });

  it('keeps an empty result set empty — the designed empty state is untouched', () => {
    const r = buildChartSeries([], ['user_id'], ['event_count']);
    expect(r.data).toEqual([]);
  });

  /**
   * THE DELIBERATE-PIN UPDATE (objectui#4497).
   *
   * This case used to read "leaves the multi-dimension pivot branch exactly as
   * it was" and asserted `{status: null, Low: 3}` — #4466's pivot behaviour
   * pinned AS-IS, not as correct, precisely so that changing it would have to
   * be a deliberate act with a card behind it. #4497 is that card: it ruled the
   * pivot inherits this branch's answer, so the pin moves here, in the same
   * commit as the fix.
   */
  it('buckets the pivot branch the SAME way, as of objectui#4497', () => {
    const rows = [
      { status: 'Backlog', priority: 'High', est_hours: 5 },
      { status: null, priority: 'Low', est_hours: 3 },
    ];
    const r = buildChartSeries(rows, ['status', 'priority'], ['est_hours']);
    expect(r.data).toEqual([
      { status: 'Backlog', High: 5 },
      { status: NULL_CATEGORY_LABEL, Low: 3 },
    ]);
  });
});

/**
 * objectui#4497 — the pivot branch, whose mechanism differs from the branch
 * above in one way that had to be measured before it could be changed: it
 * buckets by a map KEY (`String(xRaw ?? '')`) and writes a separate DISPLAY
 * value into the emitted row. The fix moves the display value only; the key is
 * untouched, so WHICH rows share a bar is byte-identical to before.
 */
describe('buildChartSeries — the pivot branch buckets null too (objectui#4497)', () => {
  it('labels the null first-dimension bucket instead of emitting a raw null', () => {
    const r = buildChartSeries(
      [
        { status: 'Backlog', priority: 'High', est_hours: 5 },
        { status: null, priority: 'Low', est_hours: 3 },
      ],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.xAxisKey).toBe('status');
    expect(r.series).toEqual([
      { dataKey: 'High', label: 'High' },
      { dataKey: 'Low', label: 'Low' },
    ]);
    // Pre-fix: `{status: null, Low: 3}` — a null category reaching recharts,
    // which draws no mark (the #4466 mechanism, one branch over).
    expect(r.data).toEqual([
      { status: 'Backlog', High: 5 },
      { status: NULL_CATEGORY_LABEL, Low: 3 },
    ]);
  });

  it('buckets an undefined first-dimension value the same way', () => {
    const r = buildChartSeries(
      [{ status: undefined, priority: 'Low', est_hours: 3 }],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.data).toEqual([{ status: NULL_CATEGORY_LABEL, Low: 3 }]);
  });

  it('uses the caller-supplied (localized) label, from the same option', () => {
    const r = buildChartSeries(
      [{ status: null, priority: 'Low', est_hours: 3 }],
      ['status', 'priority'],
      ['est_hours'],
      null,
      { nullCategoryLabel: '(未指定)' },
    );
    expect(r.data).toEqual([{ status: '(未指定)', Low: 3 }]);
  });

  it('keeps the null bucket MERGED with every other null row, as before', () => {
    // The bucket key is unchanged, so two null-x rows still share one bar and
    // contribute a column each — the label lands on the bucket, not per row.
    const r = buildChartSeries(
      [
        { status: null, priority: 'Low', est_hours: 3 },
        { status: null, priority: 'High', est_hours: 8 },
      ],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.data).toEqual([{ status: NULL_CATEGORY_LABEL, Low: 3, High: 8 }]);
  });

  it('never mutates the caller rows — drill-through reads the raw null', () => {
    const rows = [{ status: null, priority: 'Low', est_hours: 3 }];
    buildChartSeries(rows, ['status', 'priority'], ['est_hours']);
    expect(rows[0].status).toBeNull();
  });
});

describe('buildChartSeries — pivot must-not-change (objectui#4497)', () => {
  it('leaves non-null pivot groups byte-identical', () => {
    const rows = [
      { status: 'Backlog', priority: 'High', est_hours: 5 },
      { status: 'Backlog', priority: 'Low', est_hours: 3 },
      { status: 'Done', priority: 'High', est_hours: 24 },
    ];
    const r = buildChartSeries(rows, ['status', 'priority'], ['est_hours']);
    expect(r.data).toEqual([
      { status: 'Backlog', High: 5, Low: 3 },
      { status: 'Done', High: 24 },
    ]);
    expect(r.data.some((row) => row.status === NULL_CATEGORY_LABEL)).toBe(false);
  });

  it('does NOT relabel a genuine empty-string group — it is a value, not a null', () => {
    // `''` and null share the bucket KEY (pre-existing), but only null is
    // absent data. A stored empty string keeps its own (empty) display value.
    const r = buildChartSeries(
      [{ status: '', priority: 'High', est_hours: 5 }],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.data).toEqual([{ status: '', High: 5 }]);
  });

  it('keeps an empty pivot result empty — no phantom bucket row', () => {
    const r = buildChartSeries([], ['status', 'priority'], ['est_hours']);
    expect(r.data).toEqual([]);
    expect(r.series).toEqual([]);
  });

  it('does NOT bucket a row that lacks the category key ENTIRELY', () => {
    // Same division as the single-dimension branch: key absent is a different
    // defect (a dimension grouped by but never projected) and must not be
    // relabelled "(None)", which would say the records have no value.
    //
    // The LIMIT this case pinned is lifted by objectui#4507: the pivot used to
    // write `[xKey]` onto every bucket it created, so the shape reached the
    // renderer WITH the key and `hasNoCategoryKey` (framework#4033) could not
    // see it. It now reaches the renderer key-LESS, and the guard fires. What
    // this case asserts is unchanged: the row is not bucketed and never wears
    // the `(None)` label.
    //
    // Asserted with `in` / `toStrictEqual` on purpose. `toEqual` DROPS an
    // undefined-valued key, so the old expectation below read the same against
    // `{ status: undefined, Low: 3 }` and `{ Low: 3 }` — which is precisely how
    // the pivot's dead guard stayed invisible while this file pinned the rows
    // four cards in a row. See `chart-series.unprojectedCategory.test.ts`.
    const r = buildChartSeries(
      [{ priority: 'Low', est_hours: 3 }],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.data).toStrictEqual([{ Low: 3 }]);
    expect('status' in r.data[0]).toBe(false);
    expect(r.data[0].status).not.toBe(NULL_CATEGORY_LABEL);
  });
});

describe('findChartSeriesRow — the bucket label maps back to its null row (objectui#4466)', () => {
  it('matches the bucket label against the raw null category', () => {
    // Symmetry with buildChartSeries: without it, clicking the rendered
    // "(None)" bar resolves to index -1 and the drill silently no-ops.
    expect(findChartSeriesRow(PARTIAL, ['user_id'], ['event_count'], NULL_CATEGORY_LABEL)).toBe(0);
    expect(findChartSeriesRow(PARTIAL, ['user_id'], ['event_count'], 'Dev Admin')).toBe(1);
  });

  it('matches a caller-supplied bucket label the same way', () => {
    expect(
      findChartSeriesRow(ALL_NULL, ['user_id'], ['event_count'], '(未指定)', undefined, {
        nullCategoryLabel: '(未指定)',
      }),
    ).toBe(0);
  });

  /**
   * THE DELIBERATE-PIN UPDATE (objectui#4508).
   *
   * This case used to read "still resolves the empty-string category to a null
   * row (unchanged)" and asserted `0` — the pre-existing `String(r[xDim] ?? '')`
   * tolerance, justified on the grounds that the drill layer spells "no group
   * value" as `''` (`computeDrillFilter`). That justification does not survive
   * re-measurement: `computeDrillFilter` runs DOWNSTREAM of a resolved drill and
   * never produces this function's `category`, whose one production producer is
   * a chart click. What `''` IS, is the axis text a genuine empty-string group
   * paints — so the tolerance handed that group's bar the records of a null
   * group instead of its own. A wrong click, and #4508 rules it out.
   */
  it('no longer reads an empty-string category as a null row — that is a different group', () => {
    expect(findChartSeriesRow(ALL_NULL, ['user_id'], ['event_count'], '')).toBe(-1);
    // …and the empty-string group resolves to ITSELF, which is the point.
    const both = [{ user_id: null, event_count: 50 }, { user_id: '', event_count: 7 }];
    expect(findChartSeriesRow(both, ['user_id'], ['event_count'], '')).toBe(1);
    expect(findChartSeriesRow(both, ['user_id'], ['event_count'], NULL_CATEGORY_LABEL)).toBe(0);
  });
});

/**
 * objectui#4497's DRILL half — the newly-visible pivot bar keeps its click.
 *
 * The measurement the card asked for, pinned rather than described. The pivot's
 * emitted rows are AGGREGATED (`byX` collapses N raw rows into one bucket per
 * first-dimension value), so — unlike every table/pivot surface — they are NOT
 * index-aligned with `drillRawRows` and a caller cannot drill by the emitted
 * row's position. `DatasetWidget.handleChartDrill`, the one production caller,
 * therefore SEARCHES the raw rows through `findChartSeriesRow` and indexes
 * `drillRawRows` with what it returns.
 *
 * That is why the pivot's split between map key and emitted display value never
 * reached the drill, and why #4497 changed `buildChartSeries` alone: the raw
 * rows searched here still carry their null, and `xOf` (objectui#4466) already
 * reads a bucket label back to them in the MULTI-dimension arm as well as the
 * single-dimension one. These cases pin that the two halves agree — a
 * regression in either would be a dead click, which is what #4466 named.
 */
describe('findChartSeriesRow — the pivot bucket bar keeps its drill (objectui#4497)', () => {
  /** Raw dataset rows, the shape `drillRawRows` is index-aligned with. */
  const PIVOT_RAW = [
    { status: 'Backlog', priority: 'High', est_hours: 5 },
    { status: null, priority: 'Low', est_hours: 3 },
    { status: null, priority: 'High', est_hours: 8 },
  ];

  it('resolves the rendered bucket label to the RAW row, per series', () => {
    const idxLow = findChartSeriesRow(PIVOT_RAW, ['status', 'priority'], ['est_hours'], NULL_CATEGORY_LABEL, 'Low');
    const idxHigh = findChartSeriesRow(PIVOT_RAW, ['status', 'priority'], ['est_hours'], NULL_CATEGORY_LABEL, 'High');
    expect(idxLow).toBe(1);
    expect(idxHigh).toBe(2);
    // The index is into the RAW rows — the drill filter is built from
    // `drillRawRows[idx]`, which still carries the null the bar was drawn for.
    expect(PIVOT_RAW[idxLow]).toEqual({ status: null, priority: 'Low', est_hours: 3 });
    expect(PIVOT_RAW[idxHigh]).toEqual({ status: null, priority: 'High', est_hours: 8 });
  });

  it('is NOT the emitted row index — the pivot aggregates, so alignment cannot exist', () => {
    const emitted = buildChartSeries(PIVOT_RAW, ['status', 'priority'], ['est_hours']).data;
    // 3 raw rows → 2 bars. Any caller drilling by emitted position would read
    // the wrong record; this helper is what makes the click correct instead.
    expect(emitted).toHaveLength(2);
    expect(PIVOT_RAW).toHaveLength(3);
    expect(emitted[1]).toEqual({ status: NULL_CATEGORY_LABEL, Low: 3, High: 8 });
    expect(findChartSeriesRow(PIVOT_RAW, ['status', 'priority'], ['est_hours'], NULL_CATEGORY_LABEL, 'High')).toBe(2);
  });

  it('matches a caller-supplied localized bucket label the same way', () => {
    expect(
      findChartSeriesRow(PIVOT_RAW, ['status', 'priority'], ['est_hours'], '(未指定)', 'Low', {
        nullCategoryLabel: '(未指定)',
      }),
    ).toBe(1);
  });

  it('no longer reads an empty-string category back to a null row (objectui#4508)', () => {
    // The pin-update above, in the pivot arm: `''` is the empty-string group's
    // own axis text, and PIVOT_RAW has no such group.
    expect(findChartSeriesRow(PIVOT_RAW, ['status', 'priority'], ['est_hours'], '', 'Low')).toBe(-1);
  });

  it('leaves non-null pivot drills exactly as they were', () => {
    expect(findChartSeriesRow(PIVOT_RAW, ['status', 'priority'], ['est_hours'], 'Backlog', 'High')).toBe(0);
    expect(findChartSeriesRow(PIVOT_RAW, ['status', 'priority'], ['est_hours'], 'Backlog', 'Low')).toBe(-1);
  });
});

/**
 * objectui#4508 — THE PIN UPDATE THIS WHOLE BLOCK EXISTS FOR.
 *
 * The three cases below were pinned by objectui#4497 as "the measured limits of
 * the bucket label", explicitly AS LIMITS AND NOT AS CORRECT: the label served
 * as its own bucket key, so it conflated two pairs of genuinely different
 * groups, and #4497 filed that rather than widening its own card. #4508 is the
 * card, and the maintainer ruling on it (2026-08-14) is the sentinel-identity
 * direction — a bucket identity carried alongside the display label, written by
 * `buildChartSeries` and read back by `findChartSeriesRow`, aligned with the
 * distinct-bucket-id form `buildPivot` already uses on the table branch.
 *
 * So each case keeps its fixture and flips its expectation, in the commit that
 * changed the behaviour. What they now assert is the ruling's acceptance
 * condition: **each bar drills to the rows its own bar was drawn from** — no
 * dead click, no wrong click.
 */
describe('the bucket carries an identity distinct from its label (objectui#4508)', () => {
  it('null and empty-string are TWO buckets, and each drills to its own rows', () => {
    // Was: "DEAD, not wrong — an empty-string row sharing the null bucket has
    // no drill of its own". They shared a bucket because the key was
    // `String(xRaw ?? '')`, which spells both as `''`; `chartBucketId` spells
    // them `[null]` and `[""]`. Two groups, two bars, two live drills.
    const merged = [
      { status: null, priority: 'Low', n: 3 },
      { status: '', priority: 'High', n: 5 },
    ];
    expect(buildChartSeries(merged, ['status', 'priority'], ['n']).data).toEqual([
      { status: NULL_CATEGORY_LABEL, Low: 3 },
      { status: '', High: 5 },
    ]);
    // Distinct axis text, so neither bar needs to carry its identity.
    expect(buildChartSeries(merged, ['status', 'priority'], ['n']).data.some(
      (row) => CHART_BUCKET_ID_KEY in row,
    )).toBe(false);
    expect(findChartSeriesRow(merged, ['status', 'priority'], ['n'], NULL_CATEGORY_LABEL, 'Low')).toBe(0);
    // Was -1 — the dead click. It is the `''` bar's own row now.
    expect(findChartSeriesRow(merged, ['status', 'priority'], ['n'], '', 'High')).toBe(1);
  });

  it('and answers the same way in the other row order — the asymmetry is gone', () => {
    // Was: "the SAME two groups keep both drills when the empty-string row
    // comes first", pinned because the two orders did NOT behave alike (the
    // bucket took its label from whichever row created it). With the key no
    // longer the label, row order cannot decide what a bucket IS.
    const merged = [
      { status: '', priority: 'High', n: 5 },
      { status: null, priority: 'Low', n: 3 },
    ];
    expect(buildChartSeries(merged, ['status', 'priority'], ['n']).data).toEqual([
      { status: '', High: 5 },
      { status: NULL_CATEGORY_LABEL, Low: 3 },
    ]);
    expect(findChartSeriesRow(merged, ['status', 'priority'], ['n'], '', 'High')).toBe(0);
    expect(findChartSeriesRow(merged, ['status', 'priority'], ['n'], NULL_CATEGORY_LABEL, 'Low')).toBe(1);
    // The reader is no longer looser than the writer: `''` names the
    // empty-string group and the label names the null one, in either order.
    expect(findChartSeriesRow(merged, ['status', 'priority'], ['n'], '', 'Low')).toBe(-1);
  });

  it('a stored value spelling the label keeps its own bar AND its own drill', () => {
    // Was: "first match wins when a STORED value spells the bucket label
    // literally" — the WRONG click of the two collisions, since clicking the
    // null bucket's bar filtered on a record whose stored status is the literal
    // text `'(None)'`. Both bars still paint the same axis text (they are two
    // different groups that happen to read alike), so this is exactly the case
    // where the display string cannot name the bucket — and exactly where the
    // identity is written.
    const literal = [
      { status: NULL_CATEGORY_LABEL, priority: 'High', n: 1 },
      { status: null, priority: 'High', n: 2 },
    ];
    const emitted = buildChartSeries(literal, ['status', 'priority'], ['n']).data;
    expect(emitted).toEqual([
      { status: NULL_CATEGORY_LABEL, [CHART_BUCKET_ID_KEY]: '["(None)"]', High: 1 },
      { status: NULL_CATEGORY_LABEL, [CHART_BUCKET_ID_KEY]: '[null]', High: 2 },
    ]);
    // The identity a renderer reads off the clicked row, fed back as `bucketId`.
    const drill = (row: Record<string, unknown>) =>
      findChartSeriesRow(literal, ['status', 'priority'], ['n'], String(row.status), 'High', {
        bucketId: chartRowBucketId(row),
      });
    expect(drill(emitted[0])).toBe(0);
    // Was 0 — the wrong record. The null bucket's bar now resolves to the null row.
    expect(drill(emitted[1])).toBe(1);
  });

  it('resolves the same collision in the SINGLE-dimension branch', () => {
    // #4466 shipped this trade one branch over and the pivot inherited it, so
    // the fix has to answer in both. Here the rows are not aggregated, so the
    // two bars are the two raw rows.
    const literal = [
      { user_id: null, event_count: 51 },
      { user_id: NULL_CATEGORY_LABEL, event_count: 2 },
    ];
    const emitted = buildChartSeries(literal, ['user_id'], ['event_count']).data;
    expect(emitted).toEqual([
      { user_id: NULL_CATEGORY_LABEL, [CHART_BUCKET_ID_KEY]: '[null]', event_count: 51 },
      { user_id: NULL_CATEGORY_LABEL, [CHART_BUCKET_ID_KEY]: '["(None)"]', event_count: 2 },
    ]);
    const drill = (row: Record<string, unknown>) =>
      findChartSeriesRow(literal, ['user_id'], ['event_count'], String(row.user_id), undefined, {
        bucketId: chartRowBucketId(row),
      });
    expect(drill(emitted[0])).toBe(0);
    expect(drill(emitted[1])).toBe(1);
    // Without the identity the label alone still cannot separate them — which
    // is WHY it is written, and the honest statement of what the fallback is.
    expect(findChartSeriesRow(literal, ['user_id'], ['event_count'], NULL_CATEGORY_LABEL)).toBe(0);
  });

  it('collides on a LOCALIZED bucket label the same way, and resolves it', () => {
    // The collision is a property of the label, not of English: every one of the
    // ten locale packs has a `chart.nullCategory` string a record could store.
    const opts = { nullCategoryLabel: '(未指定)' };
    const literal = [
      { status: '(未指定)', priority: 'High', n: 1 },
      { status: null, priority: 'High', n: 2 },
    ];
    const emitted = buildChartSeries(literal, ['status', 'priority'], ['n'], null, opts).data;
    expect(emitted).toEqual([
      { status: '(未指定)', [CHART_BUCKET_ID_KEY]: '["(未指定)"]', High: 1 },
      { status: '(未指定)', [CHART_BUCKET_ID_KEY]: '[null]', High: 2 },
    ]);
    expect(
      findChartSeriesRow(literal, ['status', 'priority'], ['n'], '(未指定)', 'High', {
        ...opts,
        bucketId: chartRowBucketId(emitted[1]),
      }),
    ).toBe(1);
  });
});

/**
 * The identity's own contract (objectui#4508) — the properties every consumer
 * of `CHART_BUCKET_ID_KEY` relies on, stated where they can fail loudly.
 */
describe('chart bucket identity — the encoder and its carrier (objectui#4508)', () => {
  it('is the SAME encoding the pivot table keys its buckets with', () => {
    // Not a lookalike: the chart and the table answer the same question about
    // the same dataset rows, and answering it two ways is what #4508 filed.
    expect(chartBucketId(null)).toBe(pivotBucketId([pivotDimensionValue(null)]));
    expect(chartBucketId('Backlog')).toBe(pivotBucketId([pivotDimensionValue('Backlog')]));
  });

  it('separates every spelling a display label cannot', () => {
    const ids = [null, undefined, '', NULL_CATEGORY_LABEL, 'null', '[null]'].map(chartBucketId);
    // null and undefined are the same fact (absent); the other four are values.
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(ids).size).toBe(5);
  });

  it('is written ONLY where two distinct buckets paint the same axis text', () => {
    // An ordinary chart's rows are returned untouched — by identity, even —
    // so renderer-internal metadata never reaches an authoring surface.
    const rows = [
      { status: 'Backlog', est_hours: 5 },
      { status: 'Done', est_hours: 24 },
    ];
    const r = buildChartSeries(rows, ['status'], ['est_hours']);
    expect(r.data).toBe(rows);
    expect(r.data.some((row) => CHART_BUCKET_ID_KEY in row)).toBe(false);
  });

  it('counts DISTINCT buckets, not rows — a repeated category is not ambiguous', () => {
    const rows = [
      { status: 'Backlog', est_hours: 5 },
      { status: 'Backlog', est_hours: 7 },
    ];
    expect(buildChartSeries(rows, ['status'], ['est_hours']).data.some(
      (row) => CHART_BUCKET_ID_KEY in row,
    )).toBe(false);
  });

  it('survives the SPREAD COPY a pie sector click hands back', () => {
    // recharts builds a sector's `payload` as `{...row, ...cellProps}`, so the
    // identity has to be an ordinary enumerable property — a symbol or a
    // non-enumerable one would read as "no identity" with nothing red.
    const literal = [
      { status: NULL_CATEGORY_LABEL, n: 1 },
      { status: null, n: 2 },
    ];
    const emitted = buildChartSeries(literal, ['status'], ['n']).data;
    expect(chartRowBucketId({ ...emitted[1] })).toBe('[null]');
  });

  it('reads no identity off a row that carries none, or a non-row', () => {
    expect(chartRowBucketId({ status: 'Backlog' })).toBeUndefined();
    expect(chartRowBucketId(undefined)).toBeUndefined();
    expect(chartRowBucketId(null)).toBeUndefined();
    expect(chartRowBucketId({ [CHART_BUCKET_ID_KEY]: 7 })).toBeUndefined();
  });

  it('never mutates the caller rows, identity or not', () => {
    const rows = [
      { status: NULL_CATEGORY_LABEL, n: 1 },
      { status: null, n: 2 },
    ];
    buildChartSeries(rows, ['status'], ['n']);
    expect(rows[1].status).toBeNull();
    expect(rows.every((row) => !(CHART_BUCKET_ID_KEY in row))).toBe(true);
  });

  it('leaves an unsupplied bucketId to the display match — an unplumbed caller is unchanged', () => {
    // A host that forwards no identity (static SDUI chart data, a renderer not
    // wired to `categoryId`) keeps exactly the #4466 behaviour it had.
    expect(findChartSeriesRow(PARTIAL, ['user_id'], ['event_count'], NULL_CATEGORY_LABEL, undefined, {
      bucketId: undefined,
    })).toBe(0);
    expect(findChartSeriesRow(PARTIAL, ['user_id'], ['event_count'], NULL_CATEGORY_LABEL, undefined, {
      bucketId: '',
    })).toBe(0);
  });

  it('ignores the category text entirely once an identity is supplied', () => {
    // The identity is authoritative, which is the whole reason it exists: the
    // label a renderer paints can be shared, stale or localized differently.
    expect(
      findChartSeriesRow(PARTIAL, ['user_id'], ['event_count'], 'a label nothing painted', undefined, {
        bucketId: '[null]',
      }),
    ).toBe(0);
    expect(
      findChartSeriesRow(PARTIAL, ['user_id'], ['event_count'], NULL_CATEGORY_LABEL, undefined, {
        bucketId: '["Dev Admin"]',
      }),
    ).toBe(1);
    // An identity no row carries resolves to nothing rather than to the first row.
    expect(
      findChartSeriesRow(PARTIAL, ['user_id'], ['event_count'], NULL_CATEGORY_LABEL, undefined, {
        bucketId: '["nobody"]',
      }),
    ).toBe(-1);
  });
});

/**
 * objectui#4673 — the pivot's SECOND dimension, the last of the four cards.
 *
 * #4466 / #4497 / #4508 are all about the FIRST dimension's bucket. The series
 * axis kept the pre-#4466 answer the whole time: `String(row[groupKey] ?? '')`
 * behind a `gId !== ''` gate, so a null (or empty-string) group never joined
 * `seriesKeys` — while the very next line still wrote its measure into the
 * bucket under the `''` key. The number was in the emitted row and no series
 * bound to it, which is #4466's harm verbatim: the chart understated its own
 * data without saying so.
 *
 * The card's measured repro is the headline case below. The ruled direction
 * (delegated ruling on #4673, 2026-08-15) is that a KNOWN-EMPTY group draws,
 * exactly as on the first dimension, while an unprojected key still refuses —
 * "known to be empty" and "cannot know" are different facts and keep their
 * different answers on both dimensions.
 */
describe('buildChartSeries — a null SECOND-dimension group becomes a series (objectui#4673)', () => {
  it('binds the card’s 40-hour bar to a series instead of orphaning it', () => {
    // The card, verbatim. Pre-fix: `data: [{status:'Backlog', High:5, '':40}]`
    // with `series: [{dataKey:'High'}]` — the 40 present and on no mark.
    const r = buildChartSeries(
      [
        { status: 'Backlog', priority: 'High', est_hours: 5 },
        { status: 'Backlog', priority: null, est_hours: 40 },
      ],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.series).toEqual([
      { dataKey: 'High', label: 'High' },
      { dataKey: NULL_CATEGORY_LABEL, label: NULL_CATEGORY_LABEL },
    ]);
    expect(r.data).toEqual([{ status: 'Backlog', High: 5, [NULL_CATEGORY_LABEL]: 40 }]);
    // The property that was violated, stated as itself: every column holding a
    // measure is a column some series draws.
    const bound = new Set(r.series.map((s) => s.dataKey));
    const measureColumns = Object.keys(r.data[0]).filter((k) => k !== r.xAxisKey);
    expect(measureColumns.every((k) => bound.has(k))).toBe(true);
  });

  it('buckets an undefined second-dimension value the same way', () => {
    const r = buildChartSeries(
      [{ status: 'Backlog', priority: undefined, est_hours: 7 }],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.series).toEqual([{ dataKey: NULL_CATEGORY_LABEL, label: NULL_CATEGORY_LABEL }]);
    expect(r.data).toEqual([{ status: 'Backlog', [NULL_CATEGORY_LABEL]: 7 }]);
  });

  it('draws the all-null second dimension rather than an empty grouped chart', () => {
    const r = buildChartSeries(
      [
        { status: 'Backlog', priority: null, est_hours: 40 },
        { status: 'Done', priority: null, est_hours: 12 },
      ],
      ['status', 'priority'],
      ['est_hours'],
    );
    // Pre-fix: two bucket rows carrying 40 and 12 under `''`, and NO series at
    // all — the axis drawn, the numbers scaled for, nothing painted.
    expect(r.series).toHaveLength(1);
    expect(r.data).toEqual([
      { status: 'Backlog', [NULL_CATEGORY_LABEL]: 40 },
      { status: 'Done', [NULL_CATEGORY_LABEL]: 12 },
    ]);
  });

  it('takes the caller-supplied (localized) label, from the same one option', () => {
    const r = buildChartSeries(
      [{ status: 'Backlog', priority: null, est_hours: 40 }],
      ['status', 'priority'],
      ['est_hours'],
      null,
      { nullCategoryLabel: '(未指定)' },
    );
    expect(r.series).toEqual([{ dataKey: '(未指定)', label: '(未指定)' }]);
    expect(r.data).toEqual([{ status: 'Backlog', '(未指定)': 40 }]);
  });

  it('makes null and empty-string TWO series — objectui#4508’s collision 1, on this axis', () => {
    // The ruling routes the `''`-vs-null question to #4508's answer: they are
    // different groups. `chartBucketId` spells them `[null]` and `[""]`, and
    // each keys its own column, so both measures reach a mark of their own.
    const r = buildChartSeries(
      [
        { status: 'Backlog', priority: null, est_hours: 40 },
        { status: 'Backlog', priority: '', est_hours: 5 },
      ],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.series).toEqual([
      { dataKey: NULL_CATEGORY_LABEL, label: NULL_CATEGORY_LABEL },
      { dataKey: '', label: '' },
    ]);
    // Pre-fix BOTH wrote to `''` — the second silently overwrote the first, so
    // one group's number was not merely unbound, it was gone.
    expect(r.data).toEqual([{ status: 'Backlog', [NULL_CATEGORY_LABEL]: 40, '': 5 }]);
  });

  it('never mutates the caller rows — drill-through reads the raw null', () => {
    const rows = [{ status: 'Backlog', priority: null, est_hours: 40 }];
    buildChartSeries(rows, ['status', 'priority'], ['est_hours']);
    expect(rows[0].priority).toBeNull();
    expect(rows.every((row) => !(CHART_BUCKET_ID_KEY in row))).toBe(true);
  });

  it('gives a row that lacks the SECOND dimension key no series and no column', () => {
    // The other half of the doctrine, on the other dimension: "cannot know"
    // refuses (framework#4033). Bucketing it would say these records have no
    // priority, when what happened is that priority was never projected.
    //
    // Pre-fix this row's measure went into the bucket under `''`, which is now
    // the empty-string GROUP's column — so keeping the old write would hand an
    // unprojected row's number to a real group's bar.
    const r = buildChartSeries(
      [
        { status: 'Backlog', priority: '', est_hours: 5 },
        { status: 'Backlog', est_hours: 40 },
      ],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.series).toEqual([{ dataKey: '', label: '' }]);
    expect(r.data).toEqual([{ status: 'Backlog', '': 5 }]);
  });
});

describe('buildChartSeries — second-dimension must-not-change (objectui#4673)', () => {
  it('leaves an ordinary pivot’s series and rows byte-identical', () => {
    const rows = [
      { status: 'Backlog', priority: 'High', est_hours: 5 },
      { status: 'Backlog', priority: 'Low', est_hours: 3 },
      { status: 'Done', priority: 'High', est_hours: 24 },
    ];
    const r = buildChartSeries(rows, ['status', 'priority'], ['est_hours']);
    // Keys are display strings wherever a display string names the group — the
    // legend, the tooltip and the drill title all read the group's own text.
    expect(r.series).toEqual([
      { dataKey: 'High', label: 'High' },
      { dataKey: 'Low', label: 'Low' },
    ]);
    expect(r.data).toEqual([
      { status: 'Backlog', High: 5, Low: 3 },
      { status: 'Done', High: 24 },
    ]);
  });

  it('keeps an empty pivot result empty — no phantom null series', () => {
    const r = buildChartSeries([], ['status', 'priority'], ['est_hours']);
    expect(r.series).toEqual([]);
    expect(r.data).toEqual([]);
  });
});

/**
 * The card's binding constraint: a series key is a ROW KEY and a renderer
 * `dataKey`, so unlike an axis bucket's private map key it has to be unique
 * within the emitted row. These are the cases where the group's own display
 * string cannot be that key, and what it falls back to instead.
 */
describe('the second-dimension series key is collision-safe (objectui#4673)', () => {
  it('separates a stored value that literally spells the null label', () => {
    // objectui#4508's collision 2, on the series axis: two DIFFERENT groups
    // that read alike. The label cannot name either, so each keys by identity
    // — and the legend still paints the text both of them genuinely paint.
    const r = buildChartSeries(
      [
        { status: 'Backlog', priority: NULL_CATEGORY_LABEL, est_hours: 1 },
        { status: 'Backlog', priority: null, est_hours: 2 },
      ],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.series).toEqual([
      { dataKey: '["(None)"]', label: NULL_CATEGORY_LABEL },
      { dataKey: '[null]', label: NULL_CATEGORY_LABEL },
    ]);
    // Two columns, two numbers. One shared key would have dropped one of them.
    expect(r.data).toEqual([{ status: 'Backlog', '["(None)"]': 1, '[null]': 2 }]);
  });

  it('separates a stored value that spells an IDENTITY — the encoder is not a hiding place', () => {
    // The exclusion that makes the other two safe rather than merely likely: a
    // record whose stored group value is the literal text `[null]` is a real
    // value with a real bar, and it must not be able to take the null group's
    // column out from under it.
    const r = buildChartSeries(
      [
        { status: 'Backlog', priority: '[null]', est_hours: 1 },
        { status: 'Backlog', priority: null, est_hours: 2 },
      ],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.series).toEqual([
      { dataKey: '["[null]"]', label: '[null]' },
      { dataKey: NULL_CATEGORY_LABEL, label: NULL_CATEGORY_LABEL },
    ]);
    expect(r.data).toEqual([{ status: 'Backlog', '["[null]"]': 1, [NULL_CATEGORY_LABEL]: 2 }]);
  });

  it('never takes the x-axis column — that one holds the bucket’s own value', () => {
    // A group value equal to the FIRST dimension's NAME. Keyed by its display
    // string it would overwrite the axis value on its own bucket row, and the
    // bar would be drawn against a category that reads as a number.
    const r = buildChartSeries(
      [{ status: 'Backlog', priority: 'status', est_hours: 9 }],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.series).toEqual([{ dataKey: '["status"]', label: 'status' }]);
    expect(r.data).toEqual([{ status: 'Backlog', '["status"]': 9 }]);
  });

  it('never takes the identity-carrier column either', () => {
    // objectui#4508 writes `CHART_BUCKET_ID_KEY` onto an ambiguous bucket row
    // AFTER the series columns, so a series holding that key would be silently
    // overwritten by the identity — a lost measure and a phantom series.
    const r = buildChartSeries(
      [{ status: 'Backlog', priority: CHART_BUCKET_ID_KEY, est_hours: 9 }],
      ['status', 'priority'],
      ['est_hours'],
    );
    expect(r.series).toEqual([{ dataKey: '["__bucketId"]', label: CHART_BUCKET_ID_KEY }]);
    expect(r.data).toEqual([{ status: 'Backlog', '["__bucketId"]': 9 }]);
  });

  it('does not collide with the MEASURE name — the card’s other named hazard', () => {
    const r = buildChartSeries(
      [
        { status: 'Backlog', priority: 'est_hours', est_hours: 1 },
        { status: 'Backlog', priority: null, est_hours: 2 },
      ],
      ['status', 'priority'],
      ['est_hours'],
    );
    const keys = r.series.map((s) => s.dataKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.data).toEqual([{ status: 'Backlog', est_hours: 1, [NULL_CATEGORY_LABEL]: 2 }]);
  });

  it('assigns distinct keys across every spelling at once', () => {
    // The whole collision surface in one fixture, asserted as the property the
    // assignment claims: injective into the emitted row's key space.
    const r = buildChartSeries(
      [
        { status: 'S', priority: null, n: 1 },
        { status: 'S', priority: '', n: 2 },
        { status: 'S', priority: NULL_CATEGORY_LABEL, n: 3 },
        { status: 'S', priority: '[null]', n: 4 },
        { status: 'S', priority: 'status', n: 5 },
        { status: 'S', priority: 'High', n: 6 },
      ],
      ['status', 'priority'],
      ['n'],
    );
    const keys = r.series.map((s) => s.dataKey);
    expect(keys).toHaveLength(6);
    expect(new Set([...keys, 'status']).size).toBe(7);
    // Every group's measure survives to its own column.
    expect(Object.values(r.data[0]).filter((v) => typeof v === 'number').sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

/**
 * objectui#4673's DRILL half — the newly-drawn segment resolves to its own rows.
 *
 * `findChartSeriesRow` matched the series dimension as `String(r[gDim] ?? '')`,
 * which is the display-string matching objectui#4508 removed on the x-axis for
 * spelling a null group and an empty-string group alike. Extending the identity
 * answer rather than re-widening the tolerance is the card's premise C.
 */
describe('findChartSeriesRow — the null second-dimension segment keeps its drill (objectui#4673)', () => {
  /** Raw dataset rows, the shape `drillRawRows` is index-aligned with. */
  const RAW = [
    { status: 'Backlog', priority: 'High', est_hours: 5 },
    { status: 'Backlog', priority: null, est_hours: 40 },
    { status: 'Backlog', priority: '', est_hours: 7 },
  ];
  const find = (series: string | undefined, opts?: Record<string, unknown>) =>
    findChartSeriesRow(RAW, ['status', 'priority'], ['est_hours'], 'Backlog', series, opts);

  it('resolves the null group’s segment to the null row', () => {
    // Pre-fix this click could not happen (no series was ever drawn for it) and
    // could not have resolved if it had: the key was `''`, which the
    // empty-string group also answered to.
    expect(find(NULL_CATEGORY_LABEL)).toBe(1);
  });

  it('resolves the empty-string group to ITS row, not the null one', () => {
    expect(find('')).toBe(2);
  });

  it('leaves an ordinary series drill exactly as it was', () => {
    expect(find('High')).toBe(0);
    expect(find('Low')).toBe(-1);
  });

  it('answers a series key no group carries with -1, not with the first row', () => {
    // The reader is exactly as wide as the writer — no display-string fallback,
    // which is what would quietly hand one group's bar another group's records.
    expect(find('(None) ')).toBe(-1);
    expect(find('High ')).toBe(-1);
    // No series key at all, and no empty-string group to absorb it.
    const noEmpty = [{ status: 'Backlog', priority: 'High', est_hours: 5 }];
    expect(findChartSeriesRow(noEmpty, ['status', 'priority'], ['est_hours'], 'Backlog', undefined)).toBe(-1);
  });

  /**
   * MEASURED, and load-bearing for the empty-string group's drill.
   *
   * `String(seriesKey ?? '')` makes an ABSENT series key indistinguishable from
   * the empty-string group's key, and that coincidence is currently what keeps
   * that group's click alive end to end: `AdvancedChartImpl.handleCartesianClick`
   * forwards `ap?.dataKey ? String(ap.dataKey) : undefined`, and `''` is falsy —
   * so clicking the `''` bar sends `series: undefined`, which lands back on `''`
   * here and resolves to the right row.
   *
   * Pinned rather than relied on silently: the two halves agree today by
   * arithmetic, not by design, and `handleCartesianClick` is held by another
   * card (#4672) so this commit does not touch it. Filed separately.
   */
  it('reads an absent series key as the empty-string group when one exists', () => {
    expect(find(undefined)).toBe(2);
    expect(find('')).toBe(2);
  });

  it('matches a caller-supplied localized label the same way, from the same option', () => {
    const rows = [{ status: 'Backlog', priority: null, est_hours: 40 }];
    expect(
      findChartSeriesRow(rows, ['status', 'priority'], ['est_hours'], 'Backlog', '(未指定)', {
        nullCategoryLabel: '(未指定)',
      }),
    ).toBe(0);
    // The default label is not silently also accepted — the two helpers are
    // documented to take the SAME option, and a mismatch is a dead drill, not
    // a quietly wrong one.
    expect(
      findChartSeriesRow(rows, ['status', 'priority'], ['est_hours'], 'Backlog', NULL_CATEGORY_LABEL, {
        nullCategoryLabel: '(未指定)',
      }),
    ).toBe(-1);
  });

  it('resolves an identity-keyed series (the label collision) to each group’s own rows', () => {
    const literal = [
      { status: 'Backlog', priority: NULL_CATEGORY_LABEL, est_hours: 1 },
      { status: 'Backlog', priority: null, est_hours: 2 },
    ];
    const dims = ['status', 'priority'];
    const emitted = buildChartSeries(literal, dims, ['est_hours']);
    const at = (i: number) =>
      findChartSeriesRow(literal, dims, ['est_hours'], 'Backlog', emitted.series[i].dataKey);
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(1);
  });

  it('never matches a row that lacks the second dimension key', () => {
    // `chartBucketId(undefined)` is `[null]`, so without the presence guard an
    // unprojected row would answer the null group's click.
    const mixed = [{ status: 'Backlog', est_hours: 40 }, { status: 'Backlog', priority: null, est_hours: 2 }];
    expect(findChartSeriesRow(mixed, ['status', 'priority'], ['est_hours'], 'Backlog', NULL_CATEGORY_LABEL)).toBe(1);
  });

  it('still honours an x-axis bucket identity alongside the series identity', () => {
    // The two axes' answers compose: objectui#4508 on x, objectui#4673 on the
    // series, in the one lookup a click goes through.
    const both = [
      { status: NULL_CATEGORY_LABEL, priority: null, n: 1 },
      { status: null, priority: null, n: 2 },
    ];
    const emitted = buildChartSeries(both, ['status', 'priority'], ['n']);
    expect(
      findChartSeriesRow(both, ['status', 'priority'], ['n'], NULL_CATEGORY_LABEL, emitted.series[0].dataKey, {
        bucketId: chartRowBucketId(emitted.data[1]),
      }),
    ).toBe(1);
  });
});

/**
 * objectui#4682 — the click event carries the group's LABEL beside its key.
 *
 * `ChartSegmentClickEvent.series` is a `dataKey` {@link buildChartSeries}
 * assigned, and {@link findChartSeriesRow} resolves it back through that same
 * assignment. A consumer that TITLES itself from that key is reading an
 * internal id: for every ordinary group the key is the label, but the groups
 * whose label cannot name them key by identity, and the drawer then announced
 * `[null]` over a segment the user saw labelled `(None)`.
 *
 * `seriesLabel` is a second field rather than a change to the first, and this
 * block is why: the two strings answer different questions, and neither can do
 * the other's job. The label is not resolvable — it is precisely what the
 * colliding groups SHARE — and the key is not showable.
 */
describe('ChartSegmentClickEvent — the series key and its label (objectui#4682)', () => {
  const RAW = [
    { status: 'Backlog', priority: NULL_CATEGORY_LABEL, est_hours: 1 },
    { status: 'Backlog', priority: null, est_hours: 2 },
  ];
  const DIMS = ['status', 'priority'];
  const VALS = ['est_hours'];

  it('the LABEL cannot do the lookup’s job — which is why the key stays the key', () => {
    const { series } = buildChartSeries(RAW, DIMS, VALS);
    // One label over two groups: resolving by it is not merely lossy, it is
    // undefined — there is no row it names.
    expect(series.map((s) => s.label)).toEqual([NULL_CATEGORY_LABEL, NULL_CATEGORY_LABEL]);
    expect(findChartSeriesRow(RAW, DIMS, VALS, 'Backlog', NULL_CATEGORY_LABEL)).toBe(-1);
    // The keys resolve, each to its own row.
    expect(findChartSeriesRow(RAW, DIMS, VALS, 'Backlog', series[0].dataKey)).toBe(0);
    expect(findChartSeriesRow(RAW, DIMS, VALS, 'Backlog', series[1].dataKey)).toBe(1);
  });

  it('carries a label a consumer may show, alongside the key it must not', () => {
    const { series } = buildChartSeries(RAW, DIMS, VALS);
    // The shape a renderer composes: `series` for `findChartSeriesRow`,
    // `seriesLabel` for the title. Typed here so the field cannot be dropped
    // from the interface without this file going red.
    const ev: ChartSegmentClickEvent = {
      category: 'Backlog',
      series: series[1].dataKey,
      seriesLabel: series[1].label,
    };
    expect(ev.series).toBe('[null]');
    expect(ev.seriesLabel).toBe(NULL_CATEGORY_LABEL);
    expect(findChartSeriesRow(RAW, DIMS, VALS, ev.category, ev.series)).toBe(1);
    // The title's read, as the consumer performs it.
    expect(ev.seriesLabel ?? ev.series).toBe(NULL_CATEGORY_LABEL);
  });

  it('is OPTIONAL — an event without one still titles from the key', () => {
    // Renderers that resolve a series they have no label for (the scatter /
    // treemap / sankey mappers) omit it, and their titles must not lose the
    // series half.
    const ev: ChartSegmentClickEvent = { category: 'Backlog', series: 'High' };
    expect(ev.seriesLabel).toBeUndefined();
    expect(ev.seriesLabel ?? ev.series).toBe('High');
  });
});
