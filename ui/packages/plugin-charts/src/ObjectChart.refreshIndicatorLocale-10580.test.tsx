/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10580 — the bar `ObjectChart` draws over its rows while it re-reads
 * them is named in the active locale.
 *
 * `RefreshIndicator` used to default its accessible name to the English
 * literal "Refreshing", and this chart passed none, so a screen reader
 * announced English in every locale. The chart now names the bar from the
 * pack (`chart.refreshing`), and the component has no default left to fall to.
 *
 * The re-read is driven the way `ObjectChart.invalidationRefetch-10035.test.tsx`
 * drives it: a write reported on the data-invalidation bus. The second
 * aggregate is held open by hand, so the bar is read while the query really is
 * in flight. `ChartRenderer` is stubbed because the chart's own drawing is not
 * what this file is about.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, act, screen } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('./ChartRenderer', () => ({
  ChartRenderer: ({ schema }: any) => (
    <div data-testid="chart-renderer" data-rows={Array.isArray(schema?.data) ? schema.data.length : -1} />
  ),
}));

import { ObjectChart } from './ObjectChart';

// Module constants: `I18nProvider` rebuilds its i18next instance whenever the
// `config` object changes identity, so an inline literal would re-boot it on
// every render.
const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false };
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

const SCHEMA: any = {
  type: 'object-chart',
  chartType: 'bar',
  objectName: 'crm_opportunity',
  aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
  xAxisKey: 'stage',
  series: [{ dataKey: 'amount', label: 'Amount' }],
};

/** The first aggregate answers at once; every later one stays in flight. */
function makeSource() {
  let calls = 0;
  const aggregate = vi.fn(() => {
    calls += 1;
    if (calls === 1) return Promise.resolve([{ stage: 's1', amount: 1 }]);
    return new Promise<never>(() => {});
  });
  return { aggregate };
}

beforeEach(() => {
  // The provider persists the last language; keep one case from leaking into the next.
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const indicator = () => screen.queryByTestId('refresh-indicator');

async function readBarNameDuringReRead(config: typeof ZH) {
  const ds = makeSource();
  render(
    <I18nProvider config={config}>
      <ObjectChart schema={SCHEMA} dataSource={ds} />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('chart-renderer').dataset.rows).toBe('1'));
  expect(indicator(), 'no bar while nothing is in flight').toBeNull();

  await act(async () => {
    notifyDataChanged({ objectName: 'crm_opportunity' });
  });
  await waitFor(() => expect(ds.aggregate).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(indicator()).not.toBeNull());
}

describe('ObjectChart names its refresh bar in the active locale (objectui#10580)', () => {
  it('zh: the bar is named by the zh pack, not by an English literal', async () => {
    await readBarNameDuringReRead(ZH);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: '刷新中…' })).toBeTruthy());
    expect(indicator()!.getAttribute('aria-label')).not.toMatch(/Refreshing/);
  });

  it('en control: the bar is named by the en pack value', async () => {
    await readBarNameDuringReRead(EN);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Refreshing…' })).toBeTruthy());
  });
});
