/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10132, half 2 — the card's acceptance at runtime: a chart whose
 * `xAxis.title` / `yAxis[].title` is an inline locale map draws the axis title
 * **in the viewer's language, at two languages**.
 *
 * ## The surface: the tier that still authors its own axes
 *
 * `ChartAxisSchema.title` is the spec's `I18nLabel`, so a locale map there is
 * authored surface. Since `@objectstack/spec` 17.5.0 a dashboard widget's
 * `chartConfig` carries no axes (objectui#11315), so the react `ObjectChart`
 * tier is where an author still writes them. It hands its authored `xAxis` /
 * `yAxis` to `ChartRenderer`, whose `normalizeChartSchema` resolves an axis
 * title through `pickLocalized` against the language `ChartRenderer` reads
 * from `useObjectTranslation` (objectui#8943).
 *
 * This file used to build its schema through `@object-ui/core`'s
 * `mergeAuthoredPresentation`, the dashboard widget's lowering. That lowering
 * lost its one caller with objectui#11315 and was removed by objectui#11372,
 * which re-homed this pin here. So it renders a real `ObjectChart` with inline
 * rows: no `ChartRenderer` mock and no restated schema between the authored
 * node and the DOM.
 *
 * ## Why the two-language pair IS the lit control here
 *
 * The defect did not erase the title — it painted the FIRST string in key
 * order, so one language always looked right. A single-language assertion is
 * therefore green against the defect for whichever language the author typed
 * first. Each map below is written **`en` first** and both languages are
 * asserted in the same file: the `zh-CN` case can only pass if the viewer's
 * language decided the limb.
 *
 * ## Why the assertions read the axis titles, not the whole chart
 *
 * With no `series` authored, `normalizeChartSchema` promotes a y-axis title
 * onto the series it synthesises, so the title would also reach the DOM as a
 * legend entry. The series below carries a plain label of its own, and every
 * title assertion reads the axis titles recharts drew (`text.recharts-label`;
 * recharts 3 draws them in a z-index layer, outside the `.recharts-xAxis` /
 * `.recharts-yAxis` groups).
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import type { ObjectChartSchema } from '@object-ui/types';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0×0
// under the headless DOM, so nothing paints. Fix its size — the same double the
// sibling `ObjectChart` render tests install, for the same reason.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

// `ChartRenderer` renders its implementation behind
// `React.lazy(() => import('./AdvancedChartImpl'))`. Importing it here — with the
// SAME specifier, so the ESM cache satisfies the lazy factory — pays the recharts
// graph in the import phase, which no test timeout applies to (AGENTS.md §测试纪律).
import './AdvancedChartImpl';
import { I18nProvider } from '@object-ui/i18n';
import { ObjectChart } from './ObjectChart';

afterEach(cleanup);

/** ⚠️ `en` FIRST — see the key-order control above. */
const X_TITLE = { en: 'Stage', 'zh-CN': '阶段' };
const Y_TITLE = { en: 'Revenue', 'zh-CN': '收入' };

/** Stable config objects — `I18nProvider` rebuilds its instance when `config` changes identity. */
const ZH = { defaultLanguage: 'zh-CN', detectBrowserLanguage: false };
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

const DATA = [
  { status: 'open', total: 120 },
  { status: 'paid', total: 80 },
];

/** The axis titles recharts drew, once the plot (not the lazy skeleton) is up. */
async function axisTitles(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeTruthy());
  const titles = Array.from(container.querySelectorAll('text.recharts-label'), (t) => t.textContent ?? '');
  return { titles: titles.sort(), all: container.textContent ?? '' };
}

/** Mount an `ObjectChart` authoring its own axes, at one language. */
async function renderAuthored(
  axes: Pick<Record<string, unknown>, 'xAxis' | 'yAxis'>,
  config: typeof ZH,
) {
  const schema = {
    type: 'object-chart',
    chartType: 'bar',
    isAnimationActive: false,
    data: DATA,
    series: [{ name: 'total', label: 'Total' }],
    ...axes,
  } as unknown as ObjectChartSchema;
  const { container } = render(
    <I18nProvider persistLanguage={false} config={config as never}>
      <ObjectChart schema={schema} />
    </I18nProvider>,
  );
  return axisTitles(container);
}

const AUTHORED = {
  xAxis: { field: 'status', title: X_TITLE },
  yAxis: [{ field: 'total', title: Y_TITLE }],
};

describe('an ObjectChart locale-map axis title reaches the DOM in the viewer language (objectui#10132)', () => {
  it('draws the zh-CN axis titles to a zh-CN viewer', async () => {
    const drawn = await renderAuthored(AUTHORED, ZH);
    expect(drawn.titles).toEqual(['收入', '阶段'].sort());
    // The `en` entries — written FIRST in every map — must not be on screen.
    expect(drawn.all).not.toContain('Stage');
    expect(drawn.all).not.toContain('Revenue');
  });

  it('draws the en entries to an en viewer — the same maps, the other titles', async () => {
    const drawn = await renderAuthored(AUTHORED, EN);
    expect(drawn.titles).toEqual(['Revenue', 'Stage']);
    expect(drawn.all).not.toContain('阶段');
    expect(drawn.all).not.toContain('收入');
  });

  it('a plain-string axis title is unchanged by either language — the live control', async () => {
    for (const config of [ZH, EN]) {
      const drawn = await renderAuthored(
        { xAxis: { field: 'status', title: 'Stage' }, yAxis: [{ field: 'total', title: 'Revenue' }] },
        config,
      );
      expect(drawn.titles).toEqual(['Revenue', 'Stage']);
      cleanup();
    }
  });

  it('an axis with no title draws none, in either language — the absence control', async () => {
    // The neighbouring failure mode objectui#9038 measured on the chrome keys:
    // a path that ERASES the map arm instead of resolving it draws nothing at
    // all. This case fixes what "nothing" looks like so that outcome cannot be
    // mistaken for a pass.
    const drawn = await renderAuthored({ xAxis: { field: 'status' }, yAxis: [{ field: 'total' }] }, ZH);
    expect(drawn.titles).toEqual([]);
    expect(drawn.all).not.toContain('阶段');
    expect(drawn.all).not.toContain('Stage');
    expect(drawn.all).not.toContain('收入');
    expect(drawn.all).not.toContain('Revenue');
  });
});
