// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11475 — the object metric tile over a `percent` field renders at
 * the FIELD's storage (the spec's `percentScaleOf`: a fraction unless the field
 * declares a `max` above 1), and a plain `metric` tile's `%` pattern states a
 * fraction, numeral's own reading.
 *
 * `MetricWidget` holds no field, only a value and a pattern. Once the shared
 * scaling stopped guessing the storage from the value, a whole-stored field
 * (`max: 100`, as every shipped percent field declares) averaging `50` would
 * have read `5000%` on the tile, because the pattern says "fraction". So the
 * aggregate tile renders its percent itself, the way it already renders a
 * currency: through the list cell's `formatPercent`, at the storage the cell
 * reads. Each case below is asserted against the list cell in the same run.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { NumberCellRenderer, PercentCellRenderer } from '@object-ui/fields';
import { ObjectMetricWidget } from '../ObjectMetricWidget';

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <LocalizationProvider value={{ locale: 'en' }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/** What the list cell renders for `value` on `field`, under the same providers. */
function cellText(value: number, field: Record<string, unknown>): string {
  const Cell = field.type === 'percent' ? PercentCellRenderer : NumberCellRenderer;
  const { container, unmount } = render(
    <Wrapper>
      <Cell value={value} field={field as any} />
    </Wrapper>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

/**
 * Mount the tile over a one-field object whose `fn` aggregate answers `value`,
 * and wait until BOTH the schema lookup and the aggregate have landed, so the
 * tile is read settled, never in the pre-schema frame.
 */
async function mountTile(
  field: Record<string, unknown>,
  fn: string,
  value: number,
  extra: Record<string, unknown> = {},
) {
  const source = {
    getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { metric: field } })),
    aggregate: vi.fn(async () =>
      fn === 'count' ? [{ count: value }] : [{ [`metric_${fn}`]: value }],
    ),
  };
  render(
    <Wrapper>
      <ObjectMetricWidget
        objectName="deal"
        label="Tile"
        aggregate={{ field: 'metric', function: fn }}
        dataSource={source as any}
        {...(extra as any)}
      />
    </Wrapper>,
  );
  await waitFor(() => {
    expect(source.getObjectSchema).toHaveBeenCalled();
    expect(source.aggregate).toHaveBeenCalled();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(screen.queryByTestId('metric-loading')).toBeNull());
}

/** The tile shows exactly `text`, byte for byte. */
function tileShows(text: string): HTMLElement {
  return screen.getByText(text, { normalizer: (s) => s });
}

describe("an object metric tile over a percent field reads the field's storage (objectui#11475)", () => {
  it.each([
    ['whole-stored (max 100), avg 50', { type: 'percent', min: 0, max: 100 }, 'avg', 50, '50%'],
    ['whole-stored (max 100), sum 0.5 at scale 1', { type: 'percent', max: 100, scale: 1 }, 'sum', 0.5, '0.5%'],
    ['fraction-stored, sum 1', { type: 'percent' }, 'sum', 1, '100%'],
    ['fraction-stored, avg 0.25 (the control)', { type: 'percent' }, 'avg', 0.25, '25%'],
  ] as const)('%s: the tile shows what the list cell shows', async (_name, field, fn, value, bytes) => {
    const expected = cellText(value, field);
    expect(expected).toBe(bytes);
    await mountTile(field, fn, value);
    expect(tileShows(expected)).toBeInTheDocument();
  });

  it('an authored `%` pattern keeps its decimals and still reads the field storage', async () => {
    await mountTile({ type: 'percent', max: 100 }, 'avg', 50, { format: '0.0%' });
    expect(tileShows('50.0%')).toBeInTheDocument();
  });

  it('a count over a percent field is a plain cardinality, not a percent', async () => {
    await mountTile({ type: 'percent', max: 100 }, 'count', 3);
    expect(tileShows('3')).toBeInTheDocument();
  });
});
