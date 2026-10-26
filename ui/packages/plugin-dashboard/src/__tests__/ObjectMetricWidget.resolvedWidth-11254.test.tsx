// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11254 — the metric tile reads a `percent` or `number` aggregate's
 * width through `resolveFieldScale`, the metric half of ruling A′
 * (objectstack-ai/objectstack#19628).
 *
 * The tile inferred a pattern from the aggregated field's TYPE alone: `'0,0%'`
 * for `percent`, `'0,0'` for `number`. So it read no width at all, declared or
 * resolved: a `number` declaring `scale: 2` whose average is 3.75 showed `4`,
 * and a `percent` declaring `scale: 2` showed whole percents beside a list
 * cell reading two decimals.
 *
 * ── What A′ asks of this tile ─────────────────────────────────────────────
 *  - A declared width, or the protocol's width for an absent one (`percent`
 *    has a row; `number` has none), is read through `resolveFieldScale`.
 *  - A `number` that declares nothing has no fixed width, and a COMPUTED
 *    result rounds to the widest decimal count among the values that entered
 *    it. The tile sees a server aggregate, not its inputs. A `min` / `max` IS
 *    one of those inputs, so its own decimal count is that reading, and the
 *    grid footer prints the same bytes over the same rows. `sum` / `avg` need
 *    the inputs' widths, which no response carries: they are not pinned here
 *    (the open question on objectui#11254).
 *
 * ── Two kinds of assertion ─────────────────────────────────────────────────
 * The agreement rows render the REAL list cell for the same value and field,
 * under the same providers, and require the settled tile to show exactly that
 * text. Values stay below 1000 so the KPI tile's grouping exception (the
 * `MEASURED EXCEPTION` note in `MetricWidget`'s formatter) cannot enter. The
 * absolute-byte rows guard against a joint move of tile and cell.
 *
 * ── Directions on the base tree (predicted before the first run) ──────────
 *   percent `scale: 2` / `scale: 1`, agreement and bytes        RED
 *   percent with no `scale`, and a malformed `scale: "2"`       GREEN (0 both)
 *   number `scale: 2` / `scale: 3`                              RED
 *   number `scale: 0`                                           GREEN (0 both)
 *   number with no `scale`, `min` / `max` with a fraction        RED
 *   number with no `scale`, whole `min`                          GREEN
 *   number with no `scale`, inverted `max`                       RED
 *   a malformed `scale: "0"` on a number, `min`                  RED
 *   `count` over a declared percent, authored `format`           GREEN (controls)
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

describe('a declared or protocol-resolved width reaches the tile (objectui#11254)', () => {
  it.each([
    ['percent, scale 2', { type: 'percent', scale: 2 }, 'avg', 0.1234, '12.34%'],
    ['percent, scale 1', { type: 'percent', scale: 1 }, 'sum', 0.5, '50.0%'],
    ['percent, no scale (the protocol row)', { type: 'percent' }, 'avg', 0.1234, '12%'],
    ['number, scale 2', { type: 'number', scale: 2 }, 'avg', 3.75, '3.75'],
    ['number, scale 3', { type: 'number', scale: 3 }, 'sum', 1.5, '1.500'],
    ['number, scale 0', { type: 'number', scale: 0 }, 'avg', 3.75, '4'],
  ] as const)('%s: the tile shows what the list cell shows', async (_name, field, fn, value, bytes) => {
    const expected = cellText(value, field);
    expect(expected).toBe(bytes);
    await mountTile(field, fn, value);
    expect(tileShows(expected)).toBeInTheDocument();
  });

  it('a malformed `scale: "2"` on a percent is no declaration: the protocol row decides', async () => {
    await mountTile({ type: 'percent', scale: '2' }, 'avg', 0.1234);
    expect(tileShows('12%')).toBeInTheDocument();
  });
});

describe('a number declaring no width: a min / max reads its own decimals (objectui#11254)', () => {
  it.each([
    ['min', 0.99, '0.99'],
    ['max', 2.125, '2.125'],
    ['min', 3, '3'],
  ] as const)('%s %s shows %s', async (fn, value, bytes) => {
    await mountTile({ type: 'number' }, fn, value);
    expect(tileShows(bytes)).toBeInTheDocument();
  });

  it('an inverted max takes the width of the value that entered, not of the binary residue', async () => {
    // `1 - 0.7` is 0.30000000000000004 in binary arithmetic. The values that
    // entered the subtraction are `1` and `0.7`, so the widest is one place.
    await mountTile({ type: 'number' }, 'max', 0.7, { invert: true });
    expect(tileShows('0.3')).toBeInTheDocument();
  });

  it('a malformed `scale: "0"` on a number is no declaration either', async () => {
    await mountTile({ type: 'number', scale: '0' }, 'min', 0.99);
    expect(tileShows('0.99')).toBeInTheDocument();
  });
});

describe('controls that must not move (objectui#11254)', () => {
  it('a count over a declared percent is a number of rows, not a percent', async () => {
    await mountTile({ type: 'percent', scale: 2 }, 'count', 3);
    expect(tileShows('3')).toBeInTheDocument();
  });

  it('an authored `format` still wins over the field width', async () => {
    await mountTile({ type: 'number', scale: 3 }, 'avg', 3.75, { format: '0,0.0' });
    expect(tileShows('3.8')).toBeInTheDocument();
  });
});
