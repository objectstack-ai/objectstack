/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8943 — the card's acceptance, at runtime: **the same locale map, two
 * languages, two headings.**
 *
 * The unit half lives in `normalizeChartSchema.localeLabel-8943.test.ts` and
 * pins the RESOLVER. This file pins the other half, which no unit test can
 * reach: that the viewer's language actually ARRIVES at the resolver on the path
 * the ComponentRegistry takes. `normalizeChartSchema` is pure and cannot call a
 * hook — the reason the defect existed at all — so the language has to be read
 * by a component and handed down. A green unit suite over a `ChartRenderer` that
 * forgot to pass it would be a correct resolver painting the wrong heading.
 *
 * Every language assertion carries the KEY-ORDER CONTROL from the unit file: the
 * defect was a first-string-in-key-order pick, so `{ 'zh-CN', en }` rendering
 * `定价` for a `zh-CN` viewer is satisfied by the defect itself. The map below
 * is therefore written **`en` first**, the order under which the old code showed
 * a Chinese console the English heading.
 *
 * `ChartRenderer` is rendered rather than `AdvancedChartImpl`: it is what the
 * registry resolves `type: 'chart'` to, and it is the component that holds the
 * hook.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0×0
// under the headless DOM, so nothing paints. Fix its size — same double the
// sibling `ChartRenderer.dashboardChartConfig.test.tsx` installs, for the same
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
import { I18nProvider } from '@object-ui/i18n';
import { ChartRenderer } from './ChartRenderer';

afterEach(cleanup);

/**
 * ⚠️ `en` FIRST. Under the pre-fix `Object.values(v).find(isString)` this map
 * resolves to `Pricing` for every viewer, in every language — which is the whole
 * defect, and what the `zh-CN` case below is able to fail on.
 */
const TITLE = { en: 'Pricing', 'zh-CN': '定价' };

/** Stable config objects — `I18nProvider` rebuilds its instance when `config` changes identity. */
const ZH = { defaultLanguage: 'zh-CN', detectBrowserLanguage: false };
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

const schema = {
  type: 'chart',
  chartType: 'bar' as const,
  data: [
    { status: 'open', total: 120 },
    { status: 'paid', total: 80 },
  ],
  xAxisKey: 'status',
  series: [{ dataKey: 'total', label: 'Total' }],
  isAnimationActive: false,
  title: TITLE,
};

/** Mount at one language and wait for the real plot, not the lazy skeleton. */
async function headingAt(config: Record<string, unknown>) {
  const { container } = render(
    <I18nProvider persistLanguage={false} config={config}>
      <ChartRenderer schema={schema} />
    </I18nProvider>,
  );
  await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeTruthy());
  return container;
}

describe('ChartRenderer — the chart heading follows the viewer (objectui#8943)', () => {
  it('renders the zh-CN entry to a zh-CN viewer', async () => {
    await headingAt(ZH);
    expect(screen.getByText('定价')).toBeTruthy();
    // The `en` entry — written FIRST in the map — must not be on screen.
    expect(screen.queryByText('Pricing')).toBeNull();
  });

  it('renders the en entry to an en viewer — the same map, the other heading', async () => {
    await headingAt(EN);
    expect(screen.getByText('Pricing')).toBeTruthy();
    expect(screen.queryByText('定价')).toBeNull();
  });

  it('a plain-string title is untouched by either language', async () => {
    // The string arm of `I18nLabel` is the control that must NOT move.
    for (const config of [ZH, EN]) {
      const { container } = render(
        <I18nProvider persistLanguage={false} config={config}>
          <ChartRenderer schema={{ ...schema, title: 'Quarterly revenue' }} />
        </I18nProvider>,
      );
      await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeTruthy());
      expect(screen.getByText('Quarterly revenue')).toBeTruthy();
      cleanup();
    }
  });
});
