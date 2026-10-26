/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The spec→internal chart translation (objectui#2880 S1, framework#3729).
 *
 * Two invariants carry the whole design:
 *   1. an author writing the SPEC shape gets a working chart, and
 *   2. a caller already speaking the INTERNAL shape is byte-for-byte untouched
 *      (DashboardRenderer / ObjectView / the dataset path pass it explicitly).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeChartSchema,
  formatterFor,
  domainFor,
  ticksFor,
  effectiveChartFamily,
  comboBaseFamily,
} from './normalizeChartSchema';

describe('normalizeChartSchema — spec shape', () => {
  it('resolves the ChartConfig axis + series shape', () => {
    const out = normalizeChartSchema({
      type: 'line',
      xAxis: { field: 'status' },
      yAxis: [{ field: 'total' }],
      series: [{ name: 'total', label: 'Invoice value' }],
    });
    expect(out.chartType).toBe('line');
    expect(out.xAxisKey).toBe('status');
    expect(out.series).toEqual([{ dataKey: 'total', label: 'Invoice value' }]);
  });

  it('plots from yAxis alone when no series is declared', () => {
    const out = normalizeChartSchema({ xAxis: { field: 'status' }, yAxis: [{ field: 'total' }] });
    expect(out.series).toEqual([{ dataKey: 'total' }]);
  });

  it('accepts the report surface’s bare-string axes', () => {
    // ReportChartSchema narrows xAxis/yAxis from objects to plain strings.
    const out = normalizeChartSchema({ xAxis: 'status', yAxis: 'total' });
    expect(out.xAxisKey).toBe('status');
    expect(out.series).toEqual([{ dataKey: 'total' }]);
  });

  it('carries the axis presentation props through', () => {
    const out = normalizeChartSchema({
      yAxis: [{ field: 'total', format: '$0,0.00', min: 0, max: 100, logarithmic: true, title: 'Revenue' }],
    });
    expect(out.yAxes?.[0]).toMatchObject({
      field: 'total', format: '$0,0.00', min: 0, max: 100, logarithmic: true, title: 'Revenue',
    });
  });

  it('carries stack / yAxis / color on a series', () => {
    const out = normalizeChartSchema({
      series: [
        { name: 'won', stack: 'deals', color: 'green' },
        { name: 'rate', yAxis: 'right', type: 'line' },
      ],
    });
    expect(out.series?.[0]).toMatchObject({ dataKey: 'won', stack: 'deals', color: 'green' });
    expect(out.series?.[1]).toMatchObject({ dataKey: 'rate', yAxis: 'right', chartType: 'line' });
  });

  it('resolves an i18n label record to a string', () => {
    const out = normalizeChartSchema({ title: { 'zh-CN': '发票金额', en: 'Invoice value' } });
    expect(typeof out.title).toBe('string');
    expect(out.title).toBeTruthy();
  });

  it('passes chrome + annotations + interaction through', () => {
    const out = normalizeChartSchema({
      showLegend: false,
      showDataLabels: true,
      annotations: [{ type: 'line', axis: 'y', value: 100 }],
      interaction: { tooltips: false, brush: true },
    });
    expect(out.showLegend).toBe(false);
    expect(out.showDataLabels).toBe(true);
    expect(out.annotations).toHaveLength(1);
    expect(out.interaction).toEqual({ tooltips: false, brush: true });
  });
});

describe('normalizeChartSchema — internal shape wins', () => {
  it('keeps explicit internal props over the spec ones', () => {
    // The no-migration guarantee: DashboardRenderer/ObjectView/dataset callers
    // pass the internal shape and must be unaffected by this layer.
    const out = normalizeChartSchema({
      chartType: 'bar',
      xAxisKey: 'stage',
      series: [{ dataKey: 'amount' }],
      type: 'line',
      xAxis: { field: 'status' },
    });
    expect(out.chartType).toBe('bar');
    expect(out.xAxisKey).toBe('stage');
    expect(out.series).toEqual([{ dataKey: 'amount' }]);
  });

  it('returns nothing for a schema with no chart binding at all', () => {
    expect(normalizeChartSchema({ objectName: 'invoice' })).toEqual({});
    expect(normalizeChartSchema(null)).toEqual({});
  });
});

describe('normalizeChartSchema — the `type` collision', () => {
  it('does NOT read a component discriminator as a chart family', () => {
    // `object-chart` is the SDUI component type, not a chart family — reading
    // it as one would render a bar chart for every block on the page.
    expect(normalizeChartSchema({ type: 'object-chart' }).chartType).toBeUndefined();
  });

  it('reads `specType`, where the react-page wrapper parks an author `type`', () => {
    expect(normalizeChartSchema({ type: 'object-chart', specType: 'donut' }).chartType).toBe('donut');
  });

  it('hands a family this renderer draws no chart of to the dispatch as named (objectui#11520)', () => {
    // This used to answer `undefined` for `metric`, and `AdvancedChartImpl`
    // drew `undefined` as its `'bar'` default: a single-value chart drew a bar
    // with no note. The family now reaches the dispatch, which draws the number
    // card for it, the tabular notice for `table`, and names an off-spec value.
    expect(normalizeChartSchema({ type: 'object-chart', specType: 'metric' }).chartType).toBe('metric');
    expect(normalizeChartSchema({ type: 'object-chart', specType: 'pivot' }).chartType).toBe('pivot');
    expect(normalizeChartSchema({ type: 'object-chart', specType: 'sunburst' }).chartType).toBe('sunburst');
    // `chartType` still wins when a node writes both.
    expect(normalizeChartSchema({ type: 'object-chart', chartType: 'line', specType: 'gauge' }).chartType).toBe('line');
  });
});

/**
 * `combo` is renderer-local — it is not a spec `ChartTypeSchema` value (the
 * tripwire for that lives in `@object-ui/types`'s `spec-derived-unions.test.ts`,
 * which already reads the spec enum). The spec expresses a combo chart
 * per-series, via `ChartSeries.type`, and that override used to be parsed and
 * carried and then dropped: only the renderer's `chartType === 'combo'` branch
 * read it, so an author writing the protocol got the base family drawn instead.
 */
describe('effectiveChartFamily — a combo is derived from the series (#2945)', () => {
  const s = (chartType?: 'bar' | 'line' | 'area') => (chartType ? { chartType } : {});

  it('derives a combo when a series overrides the family', () => {
    // The case that rendered silently wrong: `margin` drew as a bar.
    expect(effectiveChartFamily('bar', [s(), s('line')])).toBe('combo');
  });

  it('leaves a chart whose series all agree alone', () => {
    expect(effectiveChartFamily('bar', [s(), s()])).toBe('bar');
    expect(effectiveChartFamily('bar', [s('bar'), s('bar')])).toBe('bar');
    // Agreeing with each other but not with the chart is still one family.
    expect(effectiveChartFamily('area', [s('area'), s('area')])).toBe('area');
  });

  it('reads the override against the chart\'s own family, not against `bar`', () => {
    // On an area chart, `area` series are the base — not an override.
    expect(effectiveChartFamily('area', [s(), s('area')])).toBe('area');
    expect(effectiveChartFamily('area', [s(), s('bar')])).toBe('combo');
  });

  it('treats `column` as the bar spelling it is', () => {
    expect(effectiveChartFamily('column', [s(), s('bar')])).toBe('column');
    expect(effectiveChartFamily('column', [s(), s('line')])).toBe('combo');
  });

  it('returns an explicit `combo` untouched', () => {
    // Internal-shape callers pass it directly (DatasetPreview's mixed-scale
    // branch), with series that may declare nothing at all.
    expect(effectiveChartFamily('combo', [s(), s()])).toBe('combo');
    expect(effectiveChartFamily('combo', undefined)).toBe('combo');
  });

  it('does not widen a family that has no per-series meaning', () => {
    // A `line` series inside a pie chart names nothing; switching the whole
    // chart to a cartesian combo would be a worse answer than ignoring it.
    for (const family of ['pie', 'donut', 'funnel', 'radar', 'scatter', 'treemap', 'sankey'] as const) {
      expect(effectiveChartFamily(family, [s(), s('line')])).toBe(family);
    }
    // Same for horizontal bars — the combo renderer plots vertically, so
    // deriving one would silently reorient the chart.
    expect(effectiveChartFamily('horizontal-bar', [s(), s('line')])).toBe('horizontal-bar');
  });

  it('needs two series to have a disagreement', () => {
    expect(effectiveChartFamily('bar', [s('line')])).toBe('bar');
    expect(effectiveChartFamily('bar', [])).toBe('bar');
    expect(effectiveChartFamily(undefined, [s(), s('line')])).toBeUndefined();
  });

  it('comboBaseFamily marks an authored combo by having no base', () => {
    // The renderer uses exactly this to tell derived from authored: a derived
    // combo defaults un-annotated series to the chart's family and binds them
    // to the left axis (the spec default), an authored one keeps the legacy
    // index/family guess.
    expect(comboBaseFamily('bar')).toBe('bar');
    expect(comboBaseFamily('column')).toBe('bar');
    expect(comboBaseFamily('line')).toBe('line');
    expect(comboBaseFamily('area')).toBe('area');
    expect(comboBaseFamily('combo')).toBeUndefined();
    expect(comboBaseFamily('pie')).toBeUndefined();
    expect(comboBaseFamily(undefined)).toBeUndefined();
  });
});

describe('formatterFor', () => {
  it('formats currency', () => {
    expect(formatterFor('$0,0.00', 'en')!(1234.5)).toMatch(/1,234\.50/);
  });

  it('formats percent', () => {
    expect(formatterFor('0.0%', 'en')!(0.256)).toMatch(/25\.6%/);
  });

  it('groups thousands', () => {
    expect(formatterFor('0,0', 'en')!(1234567)).toMatch(/1,234,567/);
  });

  it('returns undefined for an unrecognized format so the caller keeps its default', () => {
    expect(formatterFor(undefined, 'en')).toBeUndefined();
    expect(formatterFor('wat', 'en')).toBeUndefined();
  });

  it('passes non-numeric values through instead of printing NaN', () => {
    expect(formatterFor('$0,0.00', 'en')!('n/a')).toBe('n/a');
  });
});

describe('normalizeChartSchema — container-level props (#3752)', () => {
  it('carries description and height', () => {
    const out = normalizeChartSchema({ description: 'Invoice value by status', height: 320 });
    expect(out.description).toBe('Invoice value by status');
    expect(out.height).toBe(320);
  });

  it('ignores a non-positive height rather than collapsing the chart', () => {
    expect(normalizeChartSchema({ height: 0 }).height).toBeUndefined();
    expect(normalizeChartSchema({ height: -10 }).height).toBeUndefined();
  });

  it('carries stepSize on an axis', () => {
    expect(normalizeChartSchema({ yAxis: [{ field: 'total', stepSize: 25 }] }).yAxes?.[0].stepSize).toBe(25);
  });

  it('ignores a non-positive stepSize', () => {
    expect(normalizeChartSchema({ yAxis: [{ field: 'total', stepSize: 0 }] }).yAxes?.[0].stepSize).toBeUndefined();
  });
});

describe('ticksFor', () => {
  it('lays ticks over the data range at the declared step', () => {
    expect(ticksFor({ stepSize: 50 }, [10, 120])).toEqual([0, 50, 100, 150]);
  });

  it('honours an explicit domain over the data', () => {
    expect(ticksFor({ min: 100, max: 300, stepSize: 100 }, [10, 20])).toEqual([100, 200, 300]);
  });

  it('reaches an explicit max the step would otherwise overshoot', () => {
    expect(ticksFor({ min: 0, max: 25, stepSize: 10 }, [])).toEqual([0, 10, 20, 25]);
  });

  it('does not drift on a fractional step', () => {
    expect(ticksFor({ min: 0, max: 0.5, stepSize: 0.1 }, [])).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('returns undefined with no stepSize — Recharts keeps its automatic ticks', () => {
    expect(ticksFor({ min: 0, max: 100 }, [])).toBeUndefined();
    expect(ticksFor(undefined, [])).toBeUndefined();
  });

  it('refuses an absurd tick count instead of hanging the page', () => {
    // 100_000 / 0.5 ticks is a wrong config, not a chart.
    expect(ticksFor({ stepSize: 0.5 }, [0, 100_000])).toBeUndefined();
  });

  it('returns undefined when there is nothing to measure', () => {
    expect(ticksFor({ stepSize: 10 }, [])).toBeUndefined();
  });
});

describe('domainFor', () => {
  it('pins both ends', () => {
    expect(domainFor({ min: 0, max: 100 })).toEqual([0, 100]);
  });

  it('leaves the unspecified end automatic', () => {
    expect(domainFor({ min: 0 })).toEqual([0, 'auto']);
    expect(domainFor({ max: 100 })).toEqual(['auto', 100]);
  });

  it('returns undefined when neither end is set', () => {
    expect(domainFor({})).toBeUndefined();
    expect(domainFor(undefined)).toBeUndefined();
  });
});

/**
 * `categories` is an ALTERNATIVE SERIES LIST, not axis labels (objectui#6896).
 *
 * `@object-ui/types` declared this key as "X-axis labels/categories" while this
 * normalizer read it as a fallback series list, so an author following the
 * documentation got a different chart from the documented one. The maintainer
 * ruled prose follows machine (2026-08-31): the declaration was corrected to
 * this reading, and these are the pins that make the reading a contract instead
 * of an accident. If any of these change, `ChartSchema.categories`' docblock and
 * its zod `.describe()` are the other half of the edit.
 */
describe('normalizeChartSchema — `categories` is a series list (objectui#6896)', () => {
  it('reads each category as a COLUMN NAME when `series` is absent', () => {
    const out = normalizeChartSchema({
      type: 'bar',
      xAxisKey: 'month',
      categories: ['revenue', 'expenses'],
    });
    // Bare strings go through `normalizeSeries`' shorthand branch as `{ dataKey }`.
    expect(out.series).toEqual([{ dataKey: 'revenue' }, { dataKey: 'expenses' }]);
  });

  it('does NOT put categories on the category axis — that is `xAxisKey`/`xAxis`', () => {
    const out = normalizeChartSchema({
      type: 'bar',
      xAxisKey: 'month',
      categories: ['Jan', 'Feb', 'Mar'],
    });
    // The axis is untouched by `categories`; the month names became series.
    expect(out.xAxisKey).toBe('month');
    expect(out.series).toEqual([{ dataKey: 'Jan' }, { dataKey: 'Feb' }, { dataKey: 'Mar' }]);
  });

  it('leaves the axis unset when `categories` is the only axis-ish key present', () => {
    // The shape an author following the OLD docblock would have written: month
    // names in `categories`, expecting an x-axis. They get series bindings and
    // no axis at all — the divergence objectui#6896 recorded, pinned so the
    // corrected prose cannot drift back.
    const out = normalizeChartSchema({ type: 'bar', categories: ['Jan', 'Feb'] });
    expect(out.xAxisKey).toBeUndefined();
    expect(out.series).toEqual([{ dataKey: 'Jan' }, { dataKey: 'Feb' }]);
  });

  it('IGNORES `categories` entirely when `series` is present', () => {
    const out = normalizeChartSchema({
      type: 'bar',
      categories: ['Jan', 'Feb', 'Mar'],
      series: [{ name: 'revenue' }],
    });
    expect(out.series).toEqual([{ dataKey: 'revenue' }]);
  });

  it('drops a series\' retired inline `data` — the read objectui#6896 retired', () => {
    // The tombstone lives in `@object-ui/types`; this is the renderer-side fact
    // that made it a tombstone rather than a missing feature. `data` reaches
    // `normalizeSeries` and comes out nowhere.
    const out = normalizeChartSchema({
      type: 'bar',
      series: [{ name: 'revenue', data: [1, 2, 3] }],
    });
    expect(out.series).toEqual([{ dataKey: 'revenue' }]);
    expect(out.series?.[0]).not.toHaveProperty('data');
  });
});
