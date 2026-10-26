/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7534 — `buildDatasetFieldHelpers().headerLabel` and
 * `buildChartSeries()` must resolve a BUILT-IN default measure's caption the
 * SAME way, or one dataset renders two names for one column: #7258 taught the
 * chart seam to read `builtinAggregate` (objectstack#14492), so a report chart
 * legend already said `计数` while the summary table under it, the KPI caption,
 * the pivot header and the dataset preview all still printed the server's
 * hard-coded English `Count`.
 *
 * The resolution order this pins (one order, both seams):
 *   1. `builtinAggregate` ∈ the closed vocabulary AND the caller resolved a
 *      locale label for it → that label;
 *   2. otherwise the wire `label` verbatim — objectui#4106, an author-declared
 *      measure named or labelled `Count` keeps its own words;
 *   3. otherwise the field `name`.
 * …and the existing object-field i18n convention still wraps the result, which
 * is the only thing about the old behaviour that had to stay untouched.
 *
 * The last two cases are the load-bearing ones: they say the argument is
 * OPTIONAL and costs nothing, which is what let the five call sites be wired
 * one at a time.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_AGGREGATES, type BuiltinAggregateLabels } from '../chart-series.js';
import { buildDatasetFieldHelpers, type DatasetResultField } from '../dataset-format.js';

/** What `builtinAggregateLabels(tt)` resolves under the zh pack. */
const ZH: BuiltinAggregateLabels = {
  count: '计数',
  count_distinct: '去重计数',
  sum: '求和',
  avg: '平均',
  min: '最小值',
  max: '最大值',
};

/** The server's built-in default measure: English `label` + the discriminator. */
const BUILTIN_COUNT = {
  name: 'count',
  type: 'number',
  label: 'Count',
  builtinAggregate: 'count',
} as unknown as DatasetResultField;

/** An author-declared measure — no discriminator, own label (objectui#4106). */
const AUTHORED = {
  name: 'task_count',
  type: 'number',
  label: 'Tasks',
} as unknown as DatasetResultField;

const FIELDS = [BUILTIN_COUNT, AUTHORED] as DatasetResultField[];

describe('headerLabel resolves a built-in default measure through the locale map (objectui#7534)', () => {
  it('a built-in count reads 计数, not the server`s Count', () => {
    const { headerLabel } = buildDatasetFieldHelpers(FIELDS, undefined, undefined, ZH);
    expect(headerLabel('count')).toBe('计数');
  });

  it('covers every member of the closed vocabulary', () => {
    for (const aggregate of BUILTIN_AGGREGATES) {
      const field = { name: aggregate, type: 'number', label: 'Whatever', builtinAggregate: aggregate } as unknown as DatasetResultField;
      const { headerLabel } = buildDatasetFieldHelpers([field], undefined, undefined, ZH);
      expect(headerLabel(aggregate), aggregate).toBe(ZH[aggregate]);
    }
  });

  it('an author-declared measure keeps its own label verbatim', () => {
    const { headerLabel } = buildDatasetFieldHelpers(FIELDS, undefined, undefined, ZH);
    expect(headerLabel('task_count')).toBe('Tasks');
  });

  it('a field literally NAMED count, with no discriminator, keeps its label', () => {
    // The ruling's structural half: never match on the name or the label text.
    const namedCount = { name: 'count', type: 'number', label: 'Headcount' } as unknown as DatasetResultField;
    const { headerLabel } = buildDatasetFieldHelpers([namedCount], undefined, undefined, ZH);
    expect(headerLabel('count')).toBe('Headcount');
  });

  it('an unrecognised discriminator costs nothing', () => {
    const median = { name: 'median_age', type: 'number', label: 'Median age', builtinAggregate: 'median' } as unknown as DatasetResultField;
    const { headerLabel } = buildDatasetFieldHelpers([median], undefined, undefined, ZH);
    expect(headerLabel('median_age')).toBe('Median age');
  });

  it('a discriminator the caller resolved no label for falls back to the wire label', () => {
    const { headerLabel } = buildDatasetFieldHelpers(FIELDS, undefined, undefined, { sum: '求和' });
    expect(headerLabel('count')).toBe('Count');
  });

  it('an EMPTY resolved label is treated as absent', () => {
    const { headerLabel } = buildDatasetFieldHelpers(FIELDS, undefined, undefined, { count: '' });
    expect(headerLabel('count')).toBe('Count');
  });
});

describe('the argument is optional and additive (objectui#7534)', () => {
  it('omitting it reproduces the previous output byte for byte', () => {
    const { headerLabel } = buildDatasetFieldHelpers(FIELDS, undefined);
    expect(headerLabel('count')).toBe('Count');
    expect(headerLabel('task_count')).toBe('Tasks');
    expect(headerLabel('missing')).toBe('missing');
  });

  it('the object-field i18n convention still wraps the resolved label', () => {
    const fieldLabel = (_o: string, _f: string, fb: string) => `i18n:${fb}`;
    const { headerLabel } = buildDatasetFieldHelpers(FIELDS, 'deal', fieldLabel, ZH);
    // The built-in label becomes the FALLBACK the convention receives — the
    // convention is not bypassed, it just no longer starts from `Count`.
    expect(headerLabel('count')).toBe('i18n:计数');
    expect(headerLabel('missing')).toBe('i18n:missing');
  });
});
