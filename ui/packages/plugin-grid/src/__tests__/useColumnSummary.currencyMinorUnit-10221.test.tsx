/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10221 — the grid summary footer's currency arm takes its fraction
 * digits the way the list cell does, and never from `scale`.
 *
 * Governing text: ruling 乙 on objectstack-ai/objectstack#19910 ("a currency's
 * decimal places are the currency's, not a setting") and ruling B on
 * objectstack-ai/objectstack#19629, which retires `scale` from the `currency`
 * field type and orders that the footer and the cell agree on a currency
 * column.
 *
 * The arm read `column.scale ?? 0`, so its width was a second opinion beside
 * the cell's: a USD column with no `scale` summed `1234.5` to `$1,235` under
 * cells reading `$1,234.50`, and a JPY column carrying a stale `scale: 4`
 * summed to `¥1,234.5000`.
 *
 * ── The claim that matters is AGREEMENT ─────────────────────────────────
 * The agreement table renders the REAL list cell (`CurrencyCellRenderer`) for
 * the same amount, under the same providers, in the same run, and requires the
 * footer to read exactly `Sum: <what the cell reads>`. It does not restate the
 * cell's rule, so it cannot drift from it.
 *
 * ⭐ A two-surface comparison is blind to a JOINT move — both faces could move
 * together to a wrong width. The absolute-byte rows name the ruled output and
 * cannot pass by accident.
 *
 * ── Directions on the base tree (predicted before the first run, then observed) ──
 *   agreement, fractional amount, no/0/4 `scale`, USD/KWD   RED   (width = scale ?? 0)
 *   agreement, JPY with no `scale` or `scale: 0`            GREEN (0 = JPY's width by accident)
 *   agreement, whole amount with no `scale` or `scale: 0`   GREEN (0 = the cell's whole width)
 *   agreement, whole amount with `scale: 4`                 RED
 *   agreement, no code resolved (fixtures carry `scale: 4`) RED
 *   absolute bytes                                          RED   (every row carries a moved case)
 *   the percent control                                     GREEN (untouched — A1)
 * Predicted: the absolute whole-amount row GREEN. Observed: RED — it also
 * asserts `scale: 2`, which the base tree padded to `$1,234.00`.
 * The GREEN-on-base agreement rows are overshoot detectors, not measurements
 * of the repair: they fail if the fix breaks what already agreed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, renderHook, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { CurrencyCellRenderer, formatPercent } from '@object-ui/fields';
import { useColumnSummary } from '../useColumnSummary';

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

/**
 * The footer label the hook produces for one `sum` column over `rows`. The
 * column names only its `field`; every other member of `def` is the FIELD's
 * definition, handed to the hook as `fieldMetadata`, as the cell below is
 * handed it. objectui#11588 retired the column-level read of `currency` and
 * `scale`, so a def spread onto the column would no longer reach the footer.
 */
function footer(def: Record<string, unknown>, rows: unknown[], tenant: Tenant): string {
  const { field, ...fieldDef } = def as { field: string } & Record<string, unknown>;
  const cols: any[] = [{ summary: 'sum', field }];
  const { result } = renderHook(() => useColumnSummary(cols, rows as any[], { [field]: fieldDef } as never), {
    wrapper: wrapper(tenant),
  });
  return result.current.summaries.get(field)?.label ?? '';
}

/** What the list cell renders for `value` on the same field, under the same providers. */
function cell(value: number, field: Record<string, unknown>, tenant: Tenant): string {
  const Wrapper = wrapper(tenant);
  const { container } = render(
    <Wrapper>
      <CurrencyCellRenderer value={value} field={field as any} />
    </Wrapper>,
  );
  return container.textContent ?? '';
}

const FRACTIONAL = { rows: [{ amount: 1000 }, { amount: 234.5 }], sum: 1234.5 };
const WHOLE = { rows: [{ amount: 1000 }, { amount: 234 }], sum: 1234 };

/** USD (2 minor digits), JPY (none) and KWD (three) — a literal 2 cannot pass all three. */
const CURRENCIES = ['USD', 'JPY', 'KWD'] as const;
/** No `scale`, and two stale ones either side of every currency's own width. */
const SCALES = [undefined, 0, 4] as const;

describe('the currency footer agrees with the list cell (objectui#10221)', () => {
  const rows = CURRENCIES.flatMap((code) =>
    SCALES.flatMap((scale) =>
      (['fractional', 'whole'] as const).map((kind) => [code, String(scale), kind, scale] as const),
    ),
  );

  it.each(rows)(
    'a %s column with scale %s, %s amount, reads what the cell reads',
    (code, _label, kind, scale) => {
      const amount = kind === 'fractional' ? FRACTIONAL : WHOLE;
      const field = { type: 'currency', currency: code, ...(scale === undefined ? {} : { scale }) };
      const tenant = { locale: 'en' };
      expect(footer({ field: 'amount', ...field }, amount.rows, tenant)).toBe(
        `Sum: ${cell(amount.sum, field, tenant)}`,
      );
    },
  );

  it.each(['USD', 'JPY'])(
    'a column naming no code agrees with the cell under the %s tenant default',
    (tenantCurrency) => {
      const field = { type: 'currency', scale: 4 };
      const tenant = { currency: tenantCurrency, locale: 'en' };
      expect(footer({ field: 'amount', ...field }, FRACTIONAL.rows, tenant)).toBe(
        `Sum: ${cell(FRACTIONAL.sum, field, tenant)}`,
      );
    },
  );

  it.each([
    ['fractional', FRACTIONAL],
    ['whole', WHOLE],
  ] as const)(
    'with no code resolved at all, a %s amount reads what the cell reads — a plain number',
    (_kind, amount) => {
      const field = { type: 'currency', scale: 4 };
      const tenant = { locale: 'en' };
      expect(footer({ field: 'amount', ...field }, amount.rows, tenant)).toBe(
        `Sum: ${cell(amount.sum, field, tenant)}`,
      );
    },
  );

  it('agrees in a tenant locale that moves both marks (de-DE)', () => {
    const field = { type: 'currency', currency: 'USD', scale: 0 };
    const tenant = { locale: 'de-DE' };
    expect(footer({ field: 'amount', ...field }, FRACTIONAL.rows, tenant)).toBe(
      `Sum: ${cell(FRACTIONAL.sum, field, tenant)}`,
    );
  });
});

describe('the ruled widths as absolute bytes — the guard against a joint move', () => {
  const en = { locale: 'en' };

  it('USD with no `scale` keeps its cents: `$1,234.50`, not `$1,235`', () => {
    expect(footer({ field: 'amount', type: 'currency', currency: 'USD' }, FRACTIONAL.rows, en)).toBe(
      'Sum: $1,234.50',
    );
  });

  it('USD with a stale `scale: 0` still keeps its cents', () => {
    expect(
      footer({ field: 'amount', type: 'currency', currency: 'USD', scale: 0 }, FRACTIONAL.rows, en),
    ).toBe('Sum: $1,234.50');
  });

  it('JPY with a stale `scale: 4` shows whole yen: `¥1,235`, not `¥1,234.5000`', () => {
    expect(
      footer({ field: 'amount', type: 'currency', currency: 'JPY', scale: 4 }, FRACTIONAL.rows, en),
    ).toBe('Sum: ¥1,235');
  });

  it('a whole USD total keeps its cents the way the cell does, whatever `scale` says (objectui#11444)', () => {
    // Moved on purpose from `Sum: $1,234` when objectui#11444 retired the
    // whole-amount trimming (triage comment 5946462862): the declared width,
    // the currency's minor-unit count, is the protocol's.
    expect(
      footer({ field: 'amount', type: 'currency', currency: 'USD', scale: 2 }, WHOLE.rows, en),
    ).toBe('Sum: $1,234.00');
    expect(footer({ field: 'amount', type: 'currency', currency: 'USD' }, WHOLE.rows, en)).toBe(
      'Sum: $1,234.00',
    );
  });

  it('with no code resolved, a fractional total is a plain number at two decimals', () => {
    expect(footer({ field: 'amount', type: 'currency', scale: 0 }, FRACTIONAL.rows, en)).toBe(
      'Sum: 1,234.50',
    );
  });
});

/**
 * Where the footer stops trusting a code. `Intl` refuses a currency only when
 * the code is not three ASCII letters (ECMA-402 `IsWellFormedCurrencyCode`), and
 * the footer keeps objectui#9294's tenant-locale fallback for exactly those.
 * Everything `Intl` accepts goes to the cell's formatter, and must read what the
 * cell reads.
 */
describe('the malformed-code boundary', () => {
  it.each(['usd', 'ZZZ'])('an accepted code (%s) reads what the cell reads', (code) => {
    const field = { type: 'currency', currency: code };
    const tenant = { locale: 'en' };
    expect(footer({ field: 'amount', ...field }, FRACTIONAL.rows, tenant)).toBe(
      `Sum: ${cell(FRACTIONAL.sum, field, tenant)}`,
    );
  });

  it.each(['US1', 'USDX', 'EU'])('a refused code (%s) keeps the tenant-locale fallback', (code) => {
    expect(
      footer({ field: 'amount', type: 'currency', currency: code }, FRACTIONAL.rows, { locale: 'de-DE' }),
    ).toBe(`Sum: ${FRACTIONAL.sum.toLocaleString('de-DE')}`);
  });

  it('a malformed TENANT locale tag does not send a valid code to the fallback', () => {
    // `en_US` (underscore) is a tag `Intl` refuses. The cell's formatter survives
    // it; the tenant-locale fallback would throw on it.
    const field = { type: 'currency', currency: 'USD' };
    const tenant = { locale: 'en_US' };
    expect(footer({ field: 'amount', ...field }, FRACTIONAL.rows, tenant)).toBe(
      `Sum: ${cell(FRACTIONAL.sum, field, tenant)}`,
    );
  });
});

/**
 * ⭐ The control — `scale` is retired from CURRENCY only (mechanism assumption
 * A1 of the dispatch). The percent arm beside this one still takes its width
 * from `scale`; if this case moved, the repair reached further than its ruling.
 */
describe('the percent arm still reads `scale` (control)', () => {
  it('a percent column with `scale: 2` keeps two decimals', () => {
    expect(
      footer({ field: 'rate', type: 'percent', scale: 2 }, [{ rate: 0.12345 }], { locale: 'en' }),
    ).toBe(`Sum: ${formatPercent(0.12345, 'fraction', 2, 'en')}`);
  });
});
