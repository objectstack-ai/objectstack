/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every number and date a chart draws reads the DECLARED session locale, never
 * the machine's (objectui#9909).
 *
 * Six call sites in this package handed `Intl` nothing or an explicit
 * `undefined`: the x-axis ISO-date ticks (two spans), the compact y-axis ticks,
 * the single-value face, the spec `format` formatter (`formatterFor`) and the
 * tooltip value. They are pinned here per SURFACE, one row each.
 *
 * ## Why every surface is measured as a DIFFERENCE
 *
 * A literal expectation measures the runner: on a `de-DE` machine a broken
 * surface and a repaired one print the same bytes. Each surface renders the
 * same data twice — under a declared `de-DE` tenant locale and a declared `en`
 * one, the UI language `en` on both — and must read differently. The runtime
 * tripwire then checks the argument every locale-taking call received.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';
import { ChartContainer, ChartTooltipContent } from './ChartContainerImpl';

afterEach(() => cleanup());

function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

function textUnder(locale: string, node: React.ReactNode): string {
  render(session(locale, node));
  const text = document.body.textContent ?? '';
  cleanup();
  return text.replace(/\s+/g, ' ').trim();
}

/** Two dates 40 days apart: the ≤62-day branch, `month: 'short', day: 'numeric'`. */
const SHORT_SPAN = [
  { day: '2020-03-04', amount: 1_250_000 },
  { day: '2020-04-13', amount: 2_750_000 },
];
/** A year apart: the long-span branch, `month: 'short', year: 'numeric'`. */
const LONG_SPAN = [
  { day: '2020-03-04', amount: 1_250_000 },
  { day: '2021-05-09', amount: 2_750_000 },
];

interface Surface {
  name: string;
  node: React.ReactNode;
  de: RegExp;
  en: RegExp;
}

const SURFACES: Surface[] = [
  {
    name: 'x-axis ISO-date tick, short span',
    node: <AdvancedChartImpl chartType="bar" data={SHORT_SPAN} xAxisKey="day" series={[{ dataKey: 'amount' }]} />,
    de: /4\. März/,
    en: /Mar 4/,
  },
  {
    name: 'x-axis ISO-date tick, long span',
    node: <AdvancedChartImpl chartType="bar" data={LONG_SPAN} xAxisKey="day" series={[{ dataKey: 'amount' }]} />,
    de: /März 2020/,
    en: /Mar 2020/,
  },
  {
    name: 'compact y-axis tick',
    node: <AdvancedChartImpl chartType="bar" data={SHORT_SPAN} xAxisKey="day" series={[{ dataKey: 'amount' }]} />,
    de: /\d(,\d)? Mio\./,
    en: /\d(\.\d)?M/,
  },
  {
    name: 'single-value face',
    // `metric` is one of `SINGLE_VALUE_CHART_TYPES`; the prop's declared union
    // names only the drawn families, so the cast reaches the branch directly.
    node: <AdvancedChartImpl chartType={'metric' as never} data={[{ value: 1234567.5 }]} series={[{ dataKey: 'value' }]} />,
    de: /1\.234\.567,5/,
    en: /1,234,567\.5/,
  },
  {
    // The spec `ChartAxis.format` path: `formatterFor` builds the y-axis ticks.
    name: 'spec axis `format` formatter',
    node: (
      <AdvancedChartImpl
        chartType="bar"
        data={SHORT_SPAN}
        xAxisKey="day"
        series={[{ dataKey: 'amount' }]}
        yAxes={[{ field: 'amount', format: '0,0.00' } as never]}
      />
    ),
    de: /\d\.\d{3}\.\d{3},00/,
    en: /\d,\d{3},\d{3}\.00/,
  },
  {
    name: 'tooltip value',
    node: (
      <ChartContainer config={{ amount: { label: 'Amount' } }}>
        <ChartTooltipContent active payload={[{ value: 1234.5, name: 'amount', dataKey: 'amount', payload: {} }]} />
      </ChartContainer>
    ),
    de: /1\.234,5/,
    en: /1,234\.5/,
  },
];

describe('chart number and date faces follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', ({ node, de }) => {
    const text = textUnder('de-DE', node);
    expect(text, `got: ${text}`).toMatch(de);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', ({ node, en }) => {
    const text = textUnder('en', node);
    expect(text, `got: ${text}`).toMatch(en);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', ({ node }) => {
    expect(textUnder('de-DE', node)).not.toBe(textUnder('en', node));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', ({ node }) => {
    const calls = recordLocaleArguments(() => {
      render(session('de-DE', node));
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
