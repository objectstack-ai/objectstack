/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9038 — the card's acceptance at runtime: a chart config authored
 * with an inline-locale-map `title` / `subtitle` / `description` draws those
 * headings **in the viewer's language, at two languages**, on the path a
 * dataset-bound surface actually takes.
 *
 * The seam half lives in `@object-ui/core`
 * (`chart-presentation.i18nLabel-9038.test.ts`) and pins that the authored
 * union survives the lowering. It cannot pin what a viewer sees. This file
 * pins that, and it is the half the defect made unreachable: before the fix
 * the lowering ERASED the map arm, so the key never reached a schema and the
 * chart drew no heading in any language — which is why no locale-comparison
 * check could ever have caught it.
 *
 * ## The schema is BUILT by the real lowering, not restated
 *
 * `chartConfigPresentation` is imported from `@object-ui/core` and its output
 * is spread onto the schema exactly as `DatasetWidget` spreads it. So what is
 * rendered here is the product of the two halves joined — the whitelist's
 * result feeding the renderer's resolver — rather than a hand-written schema
 * that merely resembles one. Restating the lowered shape would pass with the
 * lowering still broken.
 *
 * `ChartRenderer` is rendered rather than `AdvancedChartImpl`: it is what the
 * ComponentRegistry resolves `type: 'chart'` to, and it is the component that
 * holds the `useObjectTranslation` hook the resolver needs.
 *
 * ## The key-order control
 *
 * Every map below is written **`en` first**. The sibling defect objectui#8943
 * was a first-string-in-key-order pick, so a map written `zh-CN` first would be
 * satisfied by that defect as well; `en` first keeps the `zh-CN` cases able to
 * fail. The plain-string case is the live control that must not move.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0×0
// under the headless DOM, so nothing paints. Fix its size — the same double the
// sibling `ChartRenderer.localeHeading-8943.test.tsx` installs, for the same
// reason (recharts resolves inside THIS package alone).
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

// `ChartRenderer` renders its implementation behind
// `React.lazy(() => import('./AdvancedChartImpl'))`. Importing it here — with the
// SAME specifier, so the ESM cache satisfies the lazy factory — pays the recharts
// graph in the import phase, which no test timeout applies to (AGENTS.md §测试纪律).
import './AdvancedChartImpl';
import { chartConfigPresentation } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { ChartRenderer } from './ChartRenderer';

afterEach(cleanup);

/** ⚠️ `en` FIRST — see the key-order control above. */
const TITLE = { en: 'Pricing', 'zh-CN': '定价' };
const SUBTITLE = { en: 'By stage', 'zh-CN': '按阶段' };
const DESCRIPTION = { en: 'Bar chart of pricing by stage', 'zh-CN': '按阶段的价格柱状图' };

/** Stable config objects — `I18nProvider` rebuilds its instance when `config` changes identity. */
const ZH = { defaultLanguage: 'zh-CN', detectBrowserLanguage: false };
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

/** The dataset-derived half, which this card does not touch. */
const derived = {
  type: 'chart',
  chartType: 'bar' as const,
  data: [
    { status: 'open', total: 120 },
    { status: 'paid', total: 80 },
  ],
  xAxisKey: 'status',
  series: [{ dataKey: 'total', label: 'Total' }],
  isAnimationActive: false,
};

/**
 * Mount the authored config at one language, through the REAL lowering, and
 * wait for the plot rather than the lazy skeleton.
 */
async function renderAuthored(chartConfig: Record<string, unknown>, config: Record<string, unknown>) {
  const schema = { ...derived, ...chartConfigPresentation(chartConfig, null) };
  const { container } = render(
    <I18nProvider persistLanguage={false} config={config}>
      <ChartRenderer schema={schema as any} />
    </I18nProvider>,
  );
  await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeTruthy());
  return container;
}

describe('an authored locale-map chart heading reaches the DOM in the viewer language (objectui#9038)', () => {
  it('draws the zh-CN title, subtitle and accessible description to a zh-CN viewer', async () => {
    const container = await renderAuthored(
      { title: TITLE, subtitle: SUBTITLE, description: DESCRIPTION },
      ZH,
    );
    expect(screen.getByText('定价')).toBeTruthy();
    expect(screen.getByText('按阶段')).toBeTruthy();
    // `description` is the container's `role="img"` + `aria-label`, not a text node.
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      '按阶段的价格柱状图',
    );
    // The `en` entries — written FIRST in every map — must not be on screen.
    expect(screen.queryByText('Pricing')).toBeNull();
    expect(screen.queryByText('By stage')).toBeNull();
  });

  it('draws the en entries to an en viewer — the same maps, the other headings', async () => {
    const container = await renderAuthored(
      { title: TITLE, subtitle: SUBTITLE, description: DESCRIPTION },
      EN,
    );
    expect(screen.getByText('Pricing')).toBeTruthy();
    expect(screen.getByText('By stage')).toBeTruthy();
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Bar chart of pricing by stage',
    );
    expect(screen.queryByText('定价')).toBeNull();
  });

  it('a plain-string title is unchanged by either language — the live control', async () => {
    for (const config of [ZH, EN]) {
      await renderAuthored({ title: 'Quarterly revenue' }, config);
      expect(screen.getByText('Quarterly revenue')).toBeTruthy();
      cleanup();
    }
  });
});
