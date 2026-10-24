// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10422, the metric tile face: `ObjectMetricWidget` hands the
 * aggregated field's WHOLE def to `resolveFieldCurrency`, whose truth table is
 * pinned in `@object-ui/i18n` beside it.
 *
 * Under a USD tenant, a `dynamic` field, and an empty config as the spec parses
 * it, show exactly what the list cell shows for a field with no
 * `currencyConfig` (the tenant's `$`); a `fixed` field keeps its own code.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   dynamic shows the tenant currency         RED   (showed `€`)
 *   parsed-empty shows the tenant currency    RED   (showed `CN¥`)
 *   control: fixed JPY shows `¥`              GREEN (untouched)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { CurrencyConfigSchema } from '@objectstack/spec/data';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { CurrencyCellRenderer } from '@object-ui/fields';
import { ObjectMetricWidget } from '../ObjectMetricWidget';

afterEach(cleanup);

/** A USD tenant: a field that names no currency of its own reads `$`. */
const TENANT = { currency: 'USD', locale: 'en' };

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <LocalizationProvider value={TENANT}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/** What the list cell renders for `value` on `field`, under the same providers. */
function cellText(value: number, field: Record<string, unknown>): string {
  const { container, unmount } = render(
    <Providers>
      <CurrencyCellRenderer value={value} field={field as any} />
    </Providers>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

/**
 * Mount the tile over a one-field object whose `sum` aggregate returns `value`,
 * and read it settled: after both the schema lookup and the aggregate landed.
 */
async function mountTile(field: Record<string, unknown>, value: number) {
  const source = {
    getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { amount: field } })),
    aggregate: vi.fn(async () => [{ amount_sum: value }]),
  };
  render(
    <Providers>
      <ObjectMetricWidget
        objectName="deal"
        label="Revenue"
        aggregate={{ field: 'amount', function: 'sum' }}
        dataSource={source as any}
      />
    </Providers>,
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

const PLAIN = { type: 'currency' };

describe('the metric tile agrees with the resolver on currencyMode (objectui#10422)', () => {
  it('dynamic: shows what a field with no currencyConfig shows, the tenant $', async () => {
    const reference = cellText(3456, PLAIN);
    // The `.00` moved on purpose when objectui#11444 retired the whole-amount
    // trimming (triage comment 5946462862).
    expect(reference).toBe('$3,456.00');
    await mountTile({ type: 'currency', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } }, 3456);
    expect(tileShows(reference)).toBeInTheDocument();
    expect(screen.queryByText('€3,456')).toBeNull();
  });

  it('parsed-empty: an empty config, as the spec parses it, shows the tenant $, never CN¥', async () => {
    const reference = cellText(3456, PLAIN);
    await mountTile({ type: 'currency', currencyConfig: CurrencyConfigSchema.parse({}) }, 3456);
    expect(tileShows(reference)).toBeInTheDocument();
    expect(screen.queryByText('CN¥3,456')).toBeNull();
  });

  it('control: a fixed JPY field keeps its own ¥', async () => {
    await mountTile({ type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } }, 1234);
    expect(tileShows('¥1,234')).toBeInTheDocument();
  });
});
