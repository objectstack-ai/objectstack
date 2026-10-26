/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8943 — every `I18nLabel` slot `normalizeChartSchema` resolves follows
 * the VIEWER's language, not the author's key order.
 *
 * ## What a green here has to be able to fail on
 *
 * The defect was `Object.values(v).find(isString)` — the first string in KEY
 * ORDER. A test that authors `{ 'zh-CN', en }` and expects `定价` for `zh` is
 * satisfied by that exact defect, because the expected entry happens to be
 * written first. So every language assertion below is paired with a KEY-ORDER
 * CONTROL: the same map with the keys written in the opposite order, asserted to
 * resolve to the SAME string. Under the old implementation the control is what
 * goes red; under a correct resolver the two spellings are indistinguishable,
 * which is the property being pinned.
 *
 * The plain-string arm is carried through as a second control — it must be
 * byte-for-byte untouched, because a locale-aware resolver that changed it would
 * be a behaviour change for every chart in the repo that writes a bare title.
 */
import { describe, it, expect } from 'vitest';
import { normalizeChartSchema } from './normalizeChartSchema';

/** The card's own example, `zh-CN` first. */
const ZH_FIRST = { 'zh-CN': '定价', en: 'Pricing' } as const;
/** Byte-identical content, opposite key order — the control. */
const EN_FIRST = { en: 'Pricing', 'zh-CN': '定价' } as const;

describe('normalizeChartSchema — the chart heading follows the viewer (objectui#8943)', () => {
  it('resolves the same map to two headings for two languages', () => {
    expect(normalizeChartSchema({ title: ZH_FIRST }, 'zh-CN').title).toBe('定价');
    expect(normalizeChartSchema({ title: ZH_FIRST }, 'en').title).toBe('Pricing');
  });

  it('KEY-ORDER CONTROL — reordering the literal changes no heading', () => {
    // Same two questions, same two answers, keys written the other way round.
    // This is the case a first-string-wins pick cannot satisfy.
    expect(normalizeChartSchema({ title: EN_FIRST }, 'zh-CN').title).toBe('定价');
    expect(normalizeChartSchema({ title: EN_FIRST }, 'en').title).toBe('Pricing');

    // Stated as the invariant itself: key order is not an input.
    for (const language of ['zh-CN', 'zh', 'en', 'en-GB', 'fr']) {
      expect(normalizeChartSchema({ title: ZH_FIRST }, language).title).toBe(
        normalizeChartSchema({ title: EN_FIRST }, language).title,
      );
    }
  });

  it('follows `pickLocalized` fallbacks — base tag, regional sibling, default, en', () => {
    // Base language reaches a region-qualified entry.
    expect(normalizeChartSchema({ title: ZH_FIRST }, 'zh').title).toBe('定价');
    // A language the map does not carry falls to `default`, then `en`.
    expect(
      normalizeChartSchema({ title: { 'zh-CN': '定价', default: 'Preise' } }, 'fr').title,
    ).toBe('Preise');
    expect(normalizeChartSchema({ title: ZH_FIRST }, 'fr').title).toBe('Pricing');
  });

  it('STRING-ARM CONTROL — a plain-string title is untouched by every language', () => {
    for (const language of ['zh-CN', 'en', 'fr', undefined]) {
      expect(normalizeChartSchema({ title: 'Pricing' }, language).title).toBe('Pricing');
    }
  });

  it('refuses what `I18nLabel` does not admit, exactly as before', () => {
    // The admission test did not widen: `pickLocalized` on its own would
    // stringify these, which would make the renderer a wider authoring surface
    // than the contract (AGENTS.md #0.1).
    expect(normalizeChartSchema({ title: 42 }, 'en').title).toBeUndefined();
    expect(normalizeChartSchema({ title: true }, 'en').title).toBeUndefined();
    expect(normalizeChartSchema({ title: ['Pricing'] }, 'en').title).toBeUndefined();
    expect(normalizeChartSchema({ title: '' }, 'en').title).toBeUndefined();
    expect(normalizeChartSchema({ title: {} }, 'en').title).toBeUndefined();
  });
});

describe('normalizeChartSchema — EVERY `label()` caller, not just the heading', () => {
  // The card's second acceptance: a silent partial fix is the failure mode.
  // One case per read site, each with its key-order control.

  it('subtitle', () => {
    expect(normalizeChartSchema({ subtitle: ZH_FIRST }, 'zh-CN').subtitle).toBe('定价');
    expect(normalizeChartSchema({ subtitle: EN_FIRST }, 'zh-CN').subtitle).toBe('定价');
    expect(normalizeChartSchema({ subtitle: EN_FIRST }, 'en').subtitle).toBe('Pricing');
  });

  it('description — the chart container’s accessible name', () => {
    expect(normalizeChartSchema({ description: ZH_FIRST }, 'zh-CN').description).toBe('定价');
    expect(normalizeChartSchema({ description: EN_FIRST }, 'zh-CN').description).toBe('定价');
    expect(normalizeChartSchema({ description: EN_FIRST }, 'en').description).toBe('Pricing');
  });

  it('axis titles — `normalizeAxis`, named by the card', () => {
    const schema = {
      xAxis: { field: 'status', title: EN_FIRST },
      yAxis: [{ field: 'total', title: EN_FIRST }],
    };
    expect(normalizeChartSchema(schema, 'zh-CN').xAxis?.title).toBe('定价');
    expect(normalizeChartSchema(schema, 'zh-CN').yAxes?.[0]?.title).toBe('定价');
    expect(normalizeChartSchema(schema, 'en').xAxis?.title).toBe('Pricing');
    expect(normalizeChartSchema(schema, 'en').yAxes?.[0]?.title).toBe('Pricing');
  });

  it('series labels — `normalizeSeries`', () => {
    const schema = { series: [{ name: 'total', label: EN_FIRST }] };
    expect(normalizeChartSchema(schema, 'zh-CN').series?.[0]?.label).toBe('定价');
    expect(normalizeChartSchema(schema, 'en').series?.[0]?.label).toBe('Pricing');
  });

  it('⚠️ EVERY series, not only the first — `Array#map` passes the INDEX', () => {
    // `rawSeries.map(normalizeSeries)` would hand `normalizeSeries` the array
    // index as its `language` argument: series 0 gets `0`, series 1 gets `1`.
    // `pickLocalized` reads a non-string language as absent and falls to `en`,
    // so the point-free spelling reds EXACTLY here and nowhere else — the first
    // entry would still be right.
    const schema = {
      series: [
        { name: 'a', label: EN_FIRST },
        { name: 'b', label: EN_FIRST },
        { name: 'c', label: EN_FIRST },
      ],
    };
    const out = normalizeChartSchema(schema, 'zh-CN');
    expect(out.series?.map((s) => s.label)).toEqual(['定价', '定价', '定价']);
  });

  it('an axis title promoted onto a synthesised series carries the resolved string', () => {
    // No `series` declared: the y-axes name the plotted columns and their
    // titles become series labels. The promotion must carry the RESOLVED label.
    const out = normalizeChartSchema({ yAxis: [{ field: 'total', title: EN_FIRST }] }, 'zh-CN');
    expect(out.series?.[0]).toMatchObject({ dataKey: 'total', label: '定价' });
  });
});

describe('normalizeChartSchema — the language parameter is optional and additive', () => {
  it('an existing caller that passes no language still resolves the union', () => {
    // The no-migration guarantee: every caller compiled before this change and
    // compiles after. What an omitted language MEANS is documented on the
    // parameter — `pickLocalized` reads it as `en`, deterministically, rather
    // than as "whatever key was written first".
    const out = normalizeChartSchema({ title: ZH_FIRST });
    expect(out.title).toBe('Pricing');
    expect(normalizeChartSchema({ title: EN_FIRST }).title).toBe('Pricing');
  });

  it('leaves every non-label key byte-for-byte alone', () => {
    const out = normalizeChartSchema({
      type: 'line',
      xAxis: { field: 'status' },
      yAxis: [{ field: 'total' }],
      series: [{ name: 'total', stack: 'deals', color: 'green' }],
      showLegend: false,
      height: 320,
    }, 'zh-CN');
    expect(out.chartType).toBe('line');
    expect(out.xAxisKey).toBe('status');
    expect(out.series).toEqual([{ dataKey: 'total', stack: 'deals', color: 'green' }]);
    expect(out.showLegend).toBe(false);
    expect(out.height).toBe(320);
  });
});
