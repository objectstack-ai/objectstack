// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10221 — the metric tile's currency face takes its fraction digits
 * the way the list cell does, and never from `scale`.
 *
 * Governing text: ruling 乙 on objectstack-ai/objectstack#19910 ("a currency's
 * decimal places are the currency's, not a setting"), which widened this card
 * to `ObjectMetricWidget`, and ruling B on objectstack-ai/objectstack#19629,
 * which retires `scale` from the `currency` field type.
 *
 * The tile built a numeral pattern out of `valueFieldDef.scale ?? 0`, so a USD
 * field with no `scale` showed `$1,235` for `1234.5` beside list cells reading
 * `$1,234.50`, and a JPY field carrying a stale `scale: 4` showed
 * `¥1,234.5000`.
 *
 * ── The claim that matters is AGREEMENT ─────────────────────────────────
 * Each case renders the REAL list cell (`CurrencyCellRenderer`) for the same
 * amount and field, under the same providers, and requires the settled tile to
 * show exactly that text. The grid footer is held to the same cell in
 * `plugin-grid`'s `useColumnSummary.currencyMinorUnit-10221` suite, so the
 * three faces agree through one reference rather than pairwise.
 *
 * The absolute-byte rows guard against a joint move of tile and cell.
 *
 * ── Directions on the base tree (predicted before the first run, then observed) ──
 *   agreement, fractional amount, USD/KWD any `scale`         RED
 *   agreement, JPY with `scale: 4`                            RED
 *   agreement, JPY with no `scale`                            GREEN (0 = JPY's width by accident)
 *   agreement, whole amount with `scale: 4`                   RED
 *   agreement, whole amount with no `scale`                   GREEN (0 = the cell's whole width)
 *   no code resolved, fractional                              RED
 *   no code resolved, whole                                   RED
 *   an authored `format` still wins (control)                 GREEN (untouched)
 * Predicted: "no code resolved, whole" GREEN. Observed: RED — its fixture
 * carries a stale `scale: 4`, which the base tree padded to `1,234.0000`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { CurrencyCellRenderer } from '@object-ui/fields';
import { ObjectMetricWidget } from '../ObjectMetricWidget';

afterEach(cleanup);

interface Tenant {
  currency?: string;
  locale?: string;
}

function wrapper(tenant: Tenant) {
  return ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <LocalizationProvider value={tenant}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/** What the list cell renders for `value` on `field`, under the same providers. */
function cellText(value: number, field: Record<string, unknown>, tenant: Tenant): string {
  const Wrapper = wrapper(tenant);
  const { container, unmount } = render(
    <Wrapper>
      <CurrencyCellRenderer value={value} field={field as any} />
    </Wrapper>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

/**
 * Mount the tile over a one-field object whose `sum` aggregate returns `value`,
 * and wait until BOTH the schema lookup and the aggregate have landed — so the
 * tile is read in its settled state, never in the pre-schema frame where it
 * formats a bare number.
 */
async function mountTile(
  field: Record<string, unknown>,
  value: number,
  tenant: Tenant,
  extra: Record<string, unknown> = {},
) {
  const source = {
    getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { amount: field } })),
    aggregate: vi.fn(async () => [{ amount_sum: value }]),
  };
  const Wrapper = wrapper(tenant);
  render(
    <Wrapper>
      <ObjectMetricWidget
        objectName="deal"
        label="Revenue"
        aggregate={{ field: 'amount', function: 'sum' }}
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

/**
 * The tile shows exactly `text`, byte for byte. The default text normalizer
 * collapses the no-break space `Intl` puts between a code and an amount
 * (`KWD 1,234.500`, `1.234,50 $`) in the DOM text but not in a string
 * matcher, so an identity normalizer is the exact comparison.
 */
function tileShows(text: string): HTMLElement {
  return screen.getByText(text, { normalizer: (s) => s });
}

const CURRENCIES = ['USD', 'JPY', 'KWD'] as const;
const SCALES = [undefined, 0, 4] as const;
const AMOUNTS = [
  ['fractional', 1234.5],
  ['whole', 1234],
] as const;

describe('the currency tile agrees with the list cell (objectui#10221)', () => {
  const rows = CURRENCIES.flatMap((code) =>
    SCALES.flatMap((scale) =>
      AMOUNTS.map(([kind, value]) => [code, String(scale), kind, scale, value] as const),
    ),
  );

  it.each(rows)(
    'a %s field with scale %s, %s amount, shows what the cell shows',
    async (code, _label, _kind, scale, value) => {
      const field = { type: 'currency', currency: code, ...(scale === undefined ? {} : { scale }) };
      const tenant = { locale: 'en' };
      const expected = cellText(value, field, tenant);
      await mountTile(field, value, tenant);
      expect(tileShows(expected)).toBeInTheDocument();
    },
  );

  it.each(['USD', 'JPY'])(
    'a field naming no code agrees with the cell under the %s tenant default',
    async (tenantCurrency) => {
      const field = { type: 'currency', scale: 4 };
      const tenant = { currency: tenantCurrency, locale: 'en' };
      const expected = cellText(1234.5, field, tenant);
      await mountTile(field, 1234.5, tenant);
      expect(tileShows(expected)).toBeInTheDocument();
    },
  );

  it.each(AMOUNTS)(
    'with no code resolved at all, a %s amount shows what the cell shows — a plain number',
    async (_kind, value) => {
      const field = { type: 'currency', scale: 4 };
      const tenant = { locale: 'en' };
      const expected = cellText(value, field, tenant);
      await mountTile(field, value, tenant);
      expect(tileShows(expected)).toBeInTheDocument();
    },
  );

  it('agrees in a tenant locale that moves both marks (de-DE)', async () => {
    const field = { type: 'currency', currency: 'USD', scale: 0 };
    const tenant = { locale: 'de-DE' };
    const expected = cellText(1234.5, field, tenant);
    await mountTile(field, 1234.5, tenant);
    expect(tileShows(expected)).toBeInTheDocument();
  });

  it('agrees when the aggregate arrives as a numeric string', async () => {
    const field = { type: 'currency', currency: 'JPY', scale: 4 };
    const tenant = { locale: 'en' };
    const expected = cellText(1234.5, field, tenant);
    await mountTile(field, '1234.5' as unknown as number, tenant);
    expect(tileShows(expected)).toBeInTheDocument();
  });
});

describe('the ruled widths as absolute bytes — the guard against a joint move', () => {
  const en = { locale: 'en' };

  it('USD with no `scale` keeps its cents: `$1,234.50`, not `$1,235`', async () => {
    await mountTile({ type: 'currency', currency: 'USD' }, 1234.5, en);
    expect(tileShows('$1,234.50')).toBeInTheDocument();
  });

  it('JPY with a stale `scale: 4` shows whole yen: `¥1,235`, not `¥1,234.5000`', async () => {
    await mountTile({ type: 'currency', currency: 'JPY', scale: 4 }, 1234.5, en);
    expect(tileShows('¥1,235')).toBeInTheDocument();
  });

  it('a whole USD amount keeps its cents, whatever `scale` says (objectui#11444)', async () => {
    // Moved on purpose from `$1,234` when objectui#11444 retired the
    // whole-amount trimming (triage comment 5946462862): the declared width,
    // the currency's minor-unit count, is the protocol's.
    await mountTile({ type: 'currency', currency: 'USD', scale: 2 }, 1234, en);
    expect(tileShows('$1,234.00')).toBeInTheDocument();
  });

  it('with no code resolved, a fractional amount is a plain number at two decimals', async () => {
    await mountTile({ type: 'currency', scale: 0 }, 1234.5, en);
    expect(tileShows('1,234.50')).toBeInTheDocument();
  });
});

/**
 * ⭐ The control — an authored `format` is the dashboard author's declaration
 * and still wins over anything inferred from the field; the currency face only
 * replaces the INFERRED pattern. If this case moved, the repair reached past
 * the field-derived path it was ruled for.
 */
describe('an authored `format` still wins (control)', () => {
  it('`format: "0,0.00"` on a JPY field keeps the two decimals the author asked for', async () => {
    await mountTile({ type: 'currency', currency: 'JPY' }, 1234.5, { locale: 'en' }, { format: '0,0.00' });
    expect(tileShows('¥1,234.50')).toBeInTheDocument();
  });
});
