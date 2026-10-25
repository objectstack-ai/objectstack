/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13404 — three readability defects in two magnitude families.
 *
 *   1. A sankey drew its nodes as bare bars with no names, and every link in
 *      one `muted-foreground` grey, so a flow could not be read or followed
 *      without hovering each mark.
 *   2. A funnel labelled each stage at `position="right"`, i.e. past the right
 *      edge of its trapezoid. The widest stage's edge IS the plot's edge, so
 *      the labels drew outside the surface and were clipped.
 *   3. The sankey's omitted-rows footnote was JSX text, so a zh-CN session read
 *      it in English.
 *
 * Assertions read the SVG Recharts drew (text, `x`, `text-anchor`, `stroke`,
 * `fill`), as the other `AdvancedChartImpl.*` tests do. The ResponsiveContainer
 * is replaced with a fixed-size pass-through so the plot has a box under jsdom.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

const WIDTH = 480;
const HEIGHT = 320;

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: WIDTH, height: HEIGHT }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

const SERIES = [{ dataKey: 'amount', label: 'Amount' }];

const FLOW = [
  { stage: 'New business', amount: 40 },
  { stage: 'Expansion', amount: 25 },
  { stage: 'Renewal', amount: 12 },
];

const renderChart = (chartType: string, data: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  render(
    <AdvancedChartImpl
      chartType={chartType as any}
      xAxisKey="stage"
      series={SERIES as any}
      data={data as any}
      isAnimationActive={false}
      {...extra}
    />,
  );

const num = (el: Element | null | undefined, attr: string) => Number(el?.getAttribute(attr));

// ---------------------------------------------------------------------------
// 1. Sankey — node names and link colours
// ---------------------------------------------------------------------------

describe('objectui#13404 — a sankey names its nodes', () => {
  it('draws every node\'s name as SVG text: the root (the series label) and each category', () => {
    const { container } = renderChart('sankey', FLOW);
    const names = [...container.querySelectorAll('.recharts-sankey-nodes text')].map((t) => t.textContent);
    expect(names).toEqual(['Amount', 'New business', 'Expansion', 'Renewal']);
  });

  it('puts the root\'s name to the right of its node and a last-column name to the LEFT, so none runs off the surface', () => {
    const { container } = renderChart('sankey', FLOW);
    const groups = [...container.querySelectorAll('.recharts-sankey-nodes g')].filter((g) =>
      g.querySelector(':scope > rect.recharts-sankey-node'),
    );
    expect(groups).toHaveLength(4);
    const [root, ...categories] = groups;

    const rootRect = root.querySelector('rect')!;
    const rootText = root.querySelector('text')!;
    expect(rootText.getAttribute('text-anchor')).toBe('start');
    expect(num(rootText, 'x')).toBeGreaterThan(num(rootRect, 'x') + num(rootRect, 'width'));

    for (const g of categories) {
      const rect = g.querySelector('rect')!;
      const text = g.querySelector('text')!;
      // The category nodes sit in the last column, flush with the right edge.
      expect(num(rect, 'x') + num(rect, 'width')).toBeGreaterThan(WIDTH * 0.9);
      expect(text.getAttribute('text-anchor'), `${text.textContent} ends at its node`).toBe('end');
      expect(num(text, 'x')).toBeLessThan(num(rect, 'x'));
      expect(num(text, 'x')).toBeGreaterThan(0);
      expect(num(text, 'x')).toBeLessThanOrEqual(WIDTH);
    }
  });

  it('strokes each link in the palette colour of the node it flows into, so two flows carry two colours', () => {
    // The card asks for "the source node's colour". In this arm every link
    // leaves the SAME root, so a source colour is one colour for all of them,
    // which is the defect again. Two links with different SOURCES cannot be
    // built here, so this pins the reading that separates flows: each link
    // shares the colour of the category it ends in.
    const { container } = renderChart('sankey', FLOW);
    const strokes = [...container.querySelectorAll('path.recharts-sankey-link')].map((p) => p.getAttribute('stroke'));
    const fills = [...container.querySelectorAll('rect.recharts-sankey-node')].map((r) => r.getAttribute('fill'));

    expect(strokes).toHaveLength(3);
    expect(new Set(strokes).size, 'every flow has its own colour').toBe(3);
    // Links are drawn in row order and nodes are root-first, so link i ends in node i + 1.
    expect(strokes).toEqual(fills.slice(1));
    // The theme's chart series, the palette every other arm draws from.
    expect(strokes).toEqual(['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))']);
    // The root is the total, not a category: it keeps a neutral colour no link takes.
    expect(fills[0]).toBe('hsl(var(--muted-foreground))');
    expect(strokes).not.toContain(fills[0]);
  });

  it('honours a caller palette (`colors`) for nodes and links alike', () => {
    const { container } = renderChart('sankey', FLOW, { colors: ['#111111', '#222222'] });
    const strokes = [...container.querySelectorAll('path.recharts-sankey-link')].map((p) => p.getAttribute('stroke'));
    expect(strokes).toEqual(['#111111', '#222222', '#111111']);
  });
});

// ---------------------------------------------------------------------------
// 2. Funnel — every stage's label is inside the plot
// ---------------------------------------------------------------------------

describe('objectui#13404 — a funnel labels every stage inside the plot', () => {
  // A steep funnel: the last stage is a sliver, which is the case a centred
  // label has to survive.
  const PIPELINE = [
    { stage: 'Qualification', amount: 200 },
    { stage: 'Needs Analysis', amount: 120 },
    { stage: 'Proposal', amount: 60 },
    { stage: 'Closed Won', amount: 8 },
  ];

  const stageLabels = (container: HTMLElement) => [...container.querySelectorAll('.recharts-label-list text')];

  it('draws one label per stage, every one centred on the funnel\'s axis', () => {
    const { container } = renderChart('funnel', PIPELINE);
    const labels = stageLabels(container);
    expect(labels.map((t) => t.textContent)).toEqual(PIPELINE.map((r) => r.stage));

    const xs = labels.map((t) => num(t, 'x'));
    for (const [i, t] of labels.entries()) {
      // In bounds, with room on both sides — not hanging off the right edge.
      expect(xs[i], `${t.textContent} is anchored inside the plot`).toBeGreaterThan(WIDTH * 0.25);
      expect(xs[i], `${t.textContent} is anchored inside the plot`).toBeLessThan(WIDTH * 0.75);
      expect(t.getAttribute('text-anchor'), `${t.textContent} is centred`).toBe('middle');
    }
    // One axis: the narrowest stage is centred exactly where the widest is.
    for (const x of xs) expect(x).toBeCloseTo(xs[0], 5);
  });

  it('keeps the narrowest stage\'s name legible where it is wider than its segment: foreground ink in a background halo', () => {
    const { container } = renderChart('funnel', PIPELINE);
    const narrowest = stageLabels(container).at(-1)!;
    expect(narrowest.textContent).toBe('Closed Won');
    expect(narrowest.getAttribute('fill')).toBe('hsl(var(--foreground))');
    expect(narrowest.getAttribute('stroke')).toBe('hsl(var(--background))');
    expect(narrowest.getAttribute('paint-order')).toBe('stroke');
    expect(num(narrowest, 'stroke-width')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Sankey footnote — from the locale packs
// ---------------------------------------------------------------------------

describe('objectui#13404 — the sankey footnote is translated', () => {
  const THINNED = [
    { stage: 'New business', amount: 40 },
    { stage: 'Refunds', amount: -25 },
    { stage: 'Chargebacks', amount: -12 },
  ];
  const ONE_DROPPED = THINNED.slice(0, 2);

  const EN_PLURAL = 'Showing 1 of 3 rows — 2 rows have no amount above zero, which a flow cannot draw.';
  const EN_SINGULAR = 'Showing 1 of 2 rows — 1 row has no amount above zero, which a flow cannot draw.';

  const noteOf = (c: HTMLElement) => c.querySelector('[data-chart-note="omitted-rows"]');

  const withLocale = (lang: string, data: Array<Record<string, unknown>>) =>
    render(
      <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false, resources: {} }}>
        <AdvancedChartImpl
          chartType="sankey"
          xAxisKey="stage"
          series={SERIES as any}
          data={data as any}
          isAnimationActive={false}
        />
      </I18nProvider>,
    );

  it('en without a provider reads exactly as it did, in the plural and the singular', () => {
    const { container: plural } = renderChart('sankey', THINNED);
    expect(noteOf(plural)?.textContent).toBe(EN_PLURAL);
    cleanup();
    const { container: singular } = renderChart('sankey', ONE_DROPPED);
    expect(noteOf(singular)?.textContent).toBe(EN_SINGULAR);
    // The measure key is still a code chip, not plain text.
    expect([...noteOf(singular)!.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['amount']);
  });

  it('en under a provider reads the same: the inline defaults and the en pack agree', () => {
    // ⛔ This is the equality that holds the defaults map in `AdvancedChartImpl`
    // and the `en` pack together, row by row.
    const { container: plural } = withLocale('en', THINNED);
    expect(noteOf(plural)?.textContent).toBe(EN_PLURAL);
    cleanup();
    const { container: singular } = withLocale('en', ONE_DROPPED);
    expect(noteOf(singular)?.textContent).toBe(EN_SINGULAR);
  });

  it('zh reads the zh pack, with the counts filled in and the key drawn as a chip', () => {
    const { container } = withLocale('zh', THINNED);
    const note = noteOf(container)!;
    const expected = builtInLocales.zh.chart.sankeyOmittedRows_other
      .replace('{{shown}}', '1')
      .replace('{{total}}', '3')
      .replace('{{count}}', '2')
      .replace('{{field}}', 'amount');
    expect(note.textContent).toBe(expected);
    expect(note.textContent).not.toContain('Showing');
    expect([...note.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['amount']);
  });

  it('every pack carries the family, translated, with every placeholder', () => {
    const en = builtInLocales.en.chart.sankeyOmittedRows;
    for (const [lang, pack] of Object.entries(builtInLocales)) {
      const value = (pack as typeof builtInLocales.en).chart.sankeyOmittedRows as string;
      expect(typeof value, `${lang} defines chart.sankeyOmittedRows`).toBe('string');
      for (const hole of ['{{shown}}', '{{total}}', '{{count}}', '{{field}}']) {
        expect(value, `${lang} keeps ${hole}`).toContain(hole);
      }
      if (lang !== 'en') expect(value, `${lang} is translated`).not.toBe(en);
    }
  });
});

// ---------------------------------------------------------------------------
// CONTROL — the other families are untouched
// ---------------------------------------------------------------------------

describe('objectui#13404 — CONTROL: the other chart families draw as before', () => {
  it('a bar chart\'s data labels keep their own placement and carry no halo', () => {
    const { container } = renderChart('bar', FLOW, { showDataLabels: true });
    const labels = [...container.querySelectorAll('.recharts-label-list text')];
    expect(labels.map((t) => t.textContent)).toEqual(['40', '25', '12']);
    for (const t of labels) expect(t.getAttribute('paint-order')).toBeNull();
  });

  it('a treemap still paints its leaf names in white, and draws no sankey labels', () => {
    const { container } = renderChart('treemap', FLOW);
    const leafNames = [...container.querySelectorAll('text')].filter((t) => t.textContent === 'New business');
    expect(leafNames).toHaveLength(1);
    expect(leafNames[0].getAttribute('fill')).toBe('#fff');
    expect(container.querySelector('.recharts-sankey-node-label')).toBeNull();
  });

  it('a pie draws no stage labels from the funnel branch', () => {
    const { container } = renderChart('pie', FLOW);
    expect(container.querySelector('.recharts-sector')).not.toBeNull();
    expect(container.querySelectorAll('text[paint-order="stroke"]')).toHaveLength(0);
  });
});
