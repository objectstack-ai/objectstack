/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4033 (source thread objectstack#5067) — the number cell renderer
 * used to build `new Intl.NumberFormat('en-US', …)` with grouping left at the
 * Intl default, so a four-digit YEAR stored as `Field.number({ scale: 0 })`
 * rendered as `2,026` in every locale and no field property could turn it off.
 *
 * Two independent pins live here:
 *
 *  1. **Ordinal grouping** — a declared `scale: 0` with no currency is an
 *     integer/ordinal surface, so grouping is suppressed. Interim default; a
 *     future spec-level presentation hint overrides it.
 *  2. **Locale** — grouping and decimal marks follow the ACTIVE display locale,
 *     never a hardcoded `en-US`.
 *
 * The controls are as load-bearing as the fixes: currency keeps grouping, a
 * non-zero `scale` keeps grouping, and an UNDECLARED scale keeps grouping
 * (`scale` is optional in the spec and absent means "decimals unknown", not
 * "integer" — see the renderer's own comment).
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { NumberCellRenderer, CurrencyCellRenderer } from '../index';

const renderNumber = (
  value: unknown,
  field: Record<string, unknown> = {},
  locale?: string,
) =>
  render(
    <LocalizationProvider value={{ locale }}>
      <NumberCellRenderer value={value as any} field={{ type: 'number', ...field } as any} />
    </LocalizationProvider>,
  );

const renderCurrency = (
  value: unknown,
  field: Record<string, unknown> = {},
  locale?: string,
) =>
  render(
    <LocalizationProvider value={{ locale }}>
      <CurrencyCellRenderer value={value as any} field={{ type: 'currency', ...field } as any} />
    </LocalizationProvider>,
  );

describe('NumberCellRenderer — ordinal grouping (objectui#4033)', () => {
  // The card's exact fixture: `year: Field.number({ scale: 0, min: 1900 })`.
  it.each(['en-US', 'de-DE', 'zh-CN', 'fr-FR'])(
    'renders a scale-0 year ungrouped in %s',
    (locale) => {
      renderNumber(2026, { scale: 0 }, locale);
      expect(screen.getByText('2026')).toBeInTheDocument();
    },
  );

  it('suppresses grouping for every scale-0 magnitude, not just four digits', () => {
    renderNumber(1234567, { scale: 0 }, 'en-US');
    expect(screen.getByText('1234567')).toBeInTheDocument();
  });

  it('CONTROL: a non-zero scale keeps grouping', () => {
    renderNumber(1234.5, { scale: 2 }, 'en-US');
    expect(screen.getByText('1,234.50')).toBeInTheDocument();
  });

  it('CONTROL: an UNDECLARED scale keeps grouping (absent ≠ integer)', () => {
    renderNumber(2026, {}, 'en-US');
    expect(screen.getByText('2,026')).toBeInTheDocument();
  });
});

describe('NumberCellRenderer — active display locale (objectui#4033)', () => {
  it('uses the active locale decimal + grouping marks (de-DE)', () => {
    renderNumber(1234.5, { scale: 1 }, 'de-DE');
    expect(screen.getByText('1.234,5')).toBeInTheDocument();
  });

  it('uses the active locale decimal + grouping marks (en-US)', () => {
    renderNumber(1234.5, { scale: 1 }, 'en-US');
    expect(screen.getByText('1,234.5')).toBeInTheDocument();
  });

  it('uses the active locale decimal + grouping marks (fr-FR)', () => {
    // fr-FR groups with U+202F (NARROW NO-BREAK SPACE) and uses "," for the
    // decimal mark — nothing an en-US formatter can produce.
    //
    // Asserted against raw `textContent`, NOT `getByText`: testing-library's
    // default normalizer collapses `\s+` (which includes U+202F) down to an
    // ASCII space, so a `getByText` assertion here can only ever prove "some
    // whitespace" and would pass on the wrong separator. The escape sequence is
    // written out rather than pasted — a raw U+202F in source renders as
    // nothing and is unfindable by grep.
    const { container } = renderNumber(1234.5, { scale: 1 }, 'fr-FR');
    expect(container.textContent).toBe('1 234,5');
  });

  it('does not take a malformed tenant locale down with it', () => {
    // `locale` arrives from a server response (ADR-0053); a junk tag must
    // degrade to the runtime default, never throw out of a grid cell.
    renderNumber(1234.5, { scale: 1 }, 'not a locale');
    expect(screen.getByText(/1.?234.5/)).toBeInTheDocument();
  });
});

describe('CurrencyCellRenderer — CONTROL, unaffected by the ordinal default', () => {
  it('keeps grouping and the currency symbol for a whole amount', () => {
    renderCurrency(5000000, { currency: 'USD' }, 'en-US');
    // The `.00` moved on purpose with objectui#11444, which retired the
    // whole-amount trimming (triage comment 5946462862); grouping, this
    // control's subject, is unchanged.
    expect(screen.getByText('$5,000,000.00')).toBeInTheDocument();
  });

  it('keeps grouping and the fractional part when the amount is not whole', () => {
    renderCurrency(1234.5, { currency: 'USD' }, 'en-US');
    // This control pinned the CURRENT behaviour when #4033 landed — `$1,234.5`,
    // NOT the `$1,234.50` that `formatCurrency`'s own doc comment promises
    // ("Salesforce convention: `$1,234.50` keeps cents"). That was a real
    // defect, deliberately filed rather than folded in (objectui#4332) and
    // pinned here so its fix would flip a watched test instead of silently
    // changing an unwatched surface. #4332 is now fixed, so the expectation
    // moves to the promised form; grouping — this control's actual subject —
    // is unchanged, which is still what #4033 needs it to prove.
    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
  });

  it('follows the active locale for currency too', () => {
    renderCurrency(5000000, { currency: 'EUR' }, 'de-DE');
    // de-DE: grouped with dots and a TRAILING symbol, vs en-US's leading one.
    // The `,00` moved on purpose with objectui#11444 (whole-amount trimming
    // retired, triage comment 5946462862).
    expect(screen.getByText(/^5\.000\.000,00\s*€$/)).toBeInTheDocument();
  });

  it('a currency field with NO resolved currency still groups (money, not an ordinal)', () => {
    renderCurrency(5000000, {}, 'en-US');
    // The `.00` moved on purpose with objectui#11444 (whole-amount trimming
    // retired, triage comment 5946462862); the separators are this control's.
    expect(screen.getByText('5,000,000.00')).toBeInTheDocument();
  });
});
