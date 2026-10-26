/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4361 — currency formatting overrode each currency's own ISO 4217
 * fraction-digit convention.
 *
 * `formatCurrency` picked its width from the VALUE's wholeness alone
 * (`isWhole ? 0 : 2`) and handed that literal `2` to `Intl`, which overrides
 * what `Intl` already knows about the currency being rendered. A yen amount
 * was printed with cents the currency does not have (`¥1,234.50`) and a dinar
 * amount with one digit fewer than it does have (`KWD 1.50`).
 *
 * The fix derives the currency's own digit count first
 * (`Intl.NumberFormat(undefined, { style: 'currency', currency })
 *    .resolvedOptions().maximumFractionDigits`)
 * and switches wholeness against THAT instead of the literal 2. Two halves,
 * both pinned here:
 *
 *  1. **A fractional amount takes the currency's own width** — the defect.
 *     JPY -> 0, USD/EUR/CNY -> 2, KWD/BHD -> 3.
 *  2. **A whole amount** — this half pinned the whole-amount trimming, the
 *     Salesforce convention objectui#4033 pinned and objectui#4332 / PR #4362
 *     re-pinned and this card extended (`KWD 1`, not `KWD 1.000`), until
 *     objectui#11444 retired it: triage ruled the declared width, the ISO 4217
 *     minor unit, the protocol's convention (comment 5946462862). A whole
 *     amount now takes the currency's width too (`KWD 1.000`, `$1,234.00`),
 *     as the read-only form always showed it. The rows below moved on purpose
 *     and stay as controls: a range `[0, width]` would trim them again, and
 *     the JPY row, whose width is 0, reads the same before and after.
 *
 * The USD cases are the acceptance evidence for "byte-identical to today":
 * the #4033 and #4332/#4362 pins pass UNCHANGED, and the ones repeated here
 * are the same assertions run against the new derivation.
 *
 * Every expected string below was MEASURED against node 22 with full ICU
 * (icu 78.2) rather than reasoned about; where ICU's spacing or symbol choice
 * is what varies (and not the digit count this card is about), the assertion
 * is a regex on the digits.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import {
  formatCurrency,
  formatCompactCurrency,
  CurrencyCellRenderer,
} from '../index';
import { currencyFractionDigits } from '../currency';

/**
 * ICU separates a currency CODE from the amount with U+00A0 (`KWD` + NBSP +
 * `1.500`), while a currency SYMBOL is written flush against it (`$1,234.50`).
 * Normalizing the NBSP keeps these pins about the DIGIT COUNT — which is what
 * this card is about — rather than about ICU's spacing choices, the same reason
 * objectui#4332's de-DE pin matched its separator loosely.
 *
 * Written as an escape rather than a pasted byte, per the repo's byte
 * discipline: a raw NBSP in source is invisible to every reader and unfindable
 * by grep in the spelling you would search for.
 */
const normalizeNbsp = (s: string) => s.replace(/\u00a0/g, ' ');

describe('the environment this card is measured in', () => {
  it('has full ICU — a small-ICU build would make every pin below meaningless', () => {
    // Written as an assertion rather than a comment: with a reduced ICU data
    // set the currency digit table is not present and JPY/KWD would resolve to
    // 2, so the fix would look correct while rendering the same wrong output.
    // If this one fails, nothing else in this file is evidence of anything.
    expect(currencyFractionDigits('JPY')).toBe(0);
    expect(currencyFractionDigits('KWD')).toBe(3);
    expect(currencyFractionDigits('USD')).toBe(2);
  });
});

describe('formatCurrency — a fractional amount takes the CURRENCY\'s width (objectui#4361)', () => {
  it('the card\'s two fixtures render as ISO 4217 says they should', () => {
    // Before: `¥1,234.50` — cents on a currency that has none.
    expect(formatCurrency(1234.5, 'JPY', 'en-US')).toBe('¥1,235');
    // Before: `KWD 1.50` — one digit short of the three a dinar has.
    expect(normalizeNbsp(formatCurrency(1.5, 'KWD', 'en-US'))).toBe('KWD 1.500');
  });

  it.each([
    // 0-digit currencies: the fraction is rounded away, not truncated.
    ['JPY', 1234.5, '¥1,235'],
    ['CLP', 1234.5, 'CLP 1,235'],
    ['ISK', 99.5, 'ISK 100'],
    // 3-digit currencies: the third digit is real and now survives.
    ['KWD', 1.5, 'KWD 1.500'],
    ['BHD', 2.5, 'BHD 2.500'],
    ['KWD', 1234.5678, 'KWD 1,234.568'],
    // 2-digit currencies: unchanged, by construction.
    ['USD', 1234.5, '$1,234.50'],
    ['EUR', 1234.5, '€1,234.50'],
  ])('%s %s renders %s', (currency, value, expected) => {
    expect(normalizeNbsp(formatCurrency(value as number, currency as string, 'en-US'))).toBe(
      expected as string,
    );
  });

  it('a 0-digit currency rounds the amount, it does not drop the digits', () => {
    // `1234.5` is not `1234`. Rounding is Intl's, and half-up here: the point
    // of the pin is that the value is not silently floored.
    expect(formatCurrency(1234.4, 'JPY', 'en-US')).toBe('¥1,234');
    expect(formatCurrency(1234.5, 'JPY', 'en-US')).toBe('¥1,235');
  });
});

describe('formatCurrency — CONTROL: a whole amount takes the currency\'s width too (objectui#11444)', () => {
  it.each([
    // Moved on purpose by objectui#11444 (triage comment 5946462862, which
    // retired the whole-amount trimming): each of these five read without its
    // fraction (`$1,234`, `$0`, `€5,000,000`, `KWD 1`, `BHD 250`) while the
    // trimming stood. The declared width is the currency's minor-unit count.
    ['USD', 1234, '$1,234.00'],
    ['USD', 0, '$0.00'],
    ['EUR', 5000000, '€5,000,000.00'],
    // 3-digit currencies: all three fils digits, whole or not.
    ['KWD', 1, 'KWD 1.000'],
    ['BHD', 250, 'BHD 250.000'],
    // 0-digit currency: the width is 0, so a whole yen amount reads the same
    // before and after the ruling. The control that the width is the
    // currency's, never "always two".
    ['JPY', 1234, '¥1,234'],
  ])('a whole %s amount keeps the currency\'s width: %s', (currency, value, expected) => {
    expect(normalizeNbsp(formatCurrency(value as number, currency as string, 'en-US'))).toBe(
      expected as string,
    );
  });

  it('a non-finite amount is not "whole" and still falls through unchanged', () => {
    expect(formatCurrency(Number.NaN, 'JPY', 'en-US')).toBe('¥NaN');
  });
});

describe('formatCurrency — CONTROL: the branches with no currency to derive from', () => {
  it('the no-currency branch keeps the literal 2 — there is nothing to derive', () => {
    // Deliberate: with no ISO code in hand there is no convention to follow,
    // so this branch keeps the historical width. Unchanged by this card. The
    // whole amount's `.00` moved on purpose with objectui#11444, which retired
    // the whole-amount trimming (triage comment 5946462862).
    expect(formatCurrency(1234.5, undefined, 'en-US')).toBe('1,234.50');
    expect(formatCurrency(5000000, undefined, 'en-US')).toBe('5,000,000.00');
  });

  it('the bad-currency fallback is byte-identical to before the fix', () => {
    // The probe throws `RangeError: Invalid currency code` for a non-ISO code
    // exactly as `Intl` does, so it must NOT be allowed to escape and change
    // this fallback's width. It falls back to 2 and `formatDisplayNumber`'s own
    // throw then produces the same string objectui#4332 pinned.
    expect(formatCurrency(1234.5, 'NOT_A_CODE', 'en-US')).toBe('NOT_A_CODE 1234.50');
  });

  it('an unknown but well-formed code resolves to 2 without throwing', () => {
    // `ZZZ` is not in the CLDR digit table; ICU answers 2 for anything it does
    // not know, which is the right default and needs no special-casing here.
    expect(currencyFractionDigits('ZZZ')).toBe(2);
    expect(normalizeNbsp(formatCurrency(1.5, 'ZZZ', 'en-US'))).toBe('ZZZ 1.50');
  });

  it('formatCompactCurrency is a different function and is untouched', () => {
    // Compact notation has its own `maximumFractionDigits: 1` policy; this card
    // does not reach it. `¥1.2K` for JPY is compact's answer, not ISO 4217's.
    expect(formatCompactCurrency(1234.5, 'USD', 'en-US')).toBe('$1.2K');
    expect(formatCompactCurrency(1234.5, 'JPY', 'en-US')).toBe('¥1.2K');
  });
});

describe('formatCurrency — the display-locale path (a 0-digit and a 3-digit currency)', () => {
  it('a 0-digit currency in its own locale', () => {
    // ja-JP spells the symbol with the FULLWIDTH yen sign, en-US with the
    // ordinary one; either is ICU's business. The digit count is this card's.
    expect(formatCurrency(1234.5, 'JPY', 'ja-JP')).toMatch(/^[¥￥]1,235$/);
  });

  it('a 3-digit currency in a comma-decimal locale', () => {
    // de-DE: dot grouping, comma decimal mark, trailing code. Matched loosely
    // on the separator so an ICU spacing change cannot fail the digits.
    expect(formatCurrency(1.5, 'KWD', 'de-DE')).toMatch(/^1,500\s*KWD$/);
    expect(formatCurrency(1234.5, 'JPY', 'de-DE')).toMatch(/^1\.235\s*¥$/);
  });

  it('CONTROL: a 2-digit currency in the same locales is unchanged (objectui#4033)', () => {
    expect(formatCurrency(1234.5, 'EUR', 'de-DE')).toMatch(/^1\.234,50\s*€$/);
    expect(formatCurrency(1234.5, 'CNY', 'zh-CN')).toBe('¥1,234.50');
  });
});

describe('CurrencyCellRenderer — the user-visible surface (objectui#4361)', () => {
  const renderCurrency = (value: unknown, field: Record<string, unknown>, locale?: string, tenantCurrency?: string) =>
    render(
      <LocalizationProvider value={{ locale, currency: tenantCurrency }}>
        <CurrencyCellRenderer value={value as any} field={{ type: 'currency', ...field } as any} />
      </LocalizationProvider>,
    );

  it('a JPY grid cell shows no cents', () => {
    renderCurrency(1234.5, { currency: 'JPY' }, 'en-US');
    expect(screen.getByText('¥1,235')).toBeInTheDocument();
  });

  it('a KWD grid cell shows all three fils digits', () => {
    renderCurrency(1.5, { currency: 'KWD' }, 'en-US');
    expect(screen.getByText('KWD 1.500')).toBeInTheDocument();
  });

  it('the TENANT default currency reaches the same derivation (ADR-0053)', () => {
    // `resolveFieldCurrency` falls through field -> currencyConfig -> tenant
    // default, and the card's reachability rests on that third step: a JPY
    // tenant with a currency field that declares nothing.
    renderCurrency(1234.5, {}, 'en-US', 'JPY');
    expect(screen.getByText('¥1,235')).toBeInTheDocument();
  });

  it('CONTROL: a USD grid cell is byte-identical to objectui#4332', () => {
    renderCurrency(1234.5, { currency: 'USD' }, 'en-US');
    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
  });
});
