// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7918 (maintainer ruling 2026-08-12, Option A) — publish-time rejection of a
 * declared currency `precision` that contradicts the currency's ISO 4217 /
 * CLDR fraction digits, when the currency is statically known
 * (`currencyConfig.currencyMode: 'fixed'`).
 *
 * The rule is deliberately partial: `dynamic` currencyMode has no single
 * currency to check against and is out of reach BY DESIGN; codes outside CLDR
 * `currencyData` (crypto/custom) fail OPEN. The rule fires ONLY on an AUTHORED
 * `precision` — the materialized `.default(2)` on an untouched fixed-JPY
 * config must never fire (the permanently-noisy shape the ruling forbids),
 * which is what the pre-default anchoring inside `CurrencyConfigSchema` (its
 * `.superRefine` before the `.overwrite` that materializes the default)
 * exists to deliver.
 *
 * Key-vs-value note: these are VALUE verdicts (a declared width judged against
 * the currency), so the assertions demand full `safeParse` outcomes — not mere
 * key reachability.
 */

import { describe, expect, it } from 'vitest';
import { CurrencyConfigSchema, FieldSchema } from './field.zod';
import {
  CURRENCY_FRACTION_DIGITS,
  currencyFractionDigits,
  currencyPrecisionContradiction,
} from './currency-fraction-digits';

/** The one custom-issue the rule emits, or undefined when the parse passed. */
function firstIssue(result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }) {
  return result.success ? undefined : result.error!.issues[0];
}

describe('#7918 — currencyConfig-level anchor (pre-default, inside CurrencyConfigSchema)', () => {
  it('rejects an authored precision contradicting a 0-digit currency (JPY + 2)', () => {
    const result = CurrencyConfigSchema.safeParse({
      precision: 2, currencyMode: 'fixed', defaultCurrency: 'JPY',
    });
    expect(result.success).toBe(false);
    const issue = firstIssue(result)!;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['precision']);
    // The ruling's message shape: both numbers, named.
    expect(issue.message).toContain('currency JPY has 0 fraction digits');
    expect(issue.message).toContain('`precision: 2` contradicts it');
  });

  it('rejects an authored precision contradicting a 3-digit currency (KWD + 2)', () => {
    const result = CurrencyConfigSchema.safeParse({
      precision: 2, currencyMode: 'fixed', defaultCurrency: 'KWD',
    });
    expect(result.success).toBe(false);
    expect(firstIssue(result)!.message).toContain('currency KWD has 3 fraction digits');
    expect(firstIssue(result)!.message).toContain('`precision: 2` contradicts it');
  });

  it('THE noisy-shape guard: an untouched fixed-JPY config (defaulted precision) parses clean', () => {
    // The baked default 2 "contradicts" JPY's 0 digits — but it was never
    // authored, so the rule must not fire. This is the assertion that proves
    // the pre-default anchoring; with a property-level `.default(2)` it goes
    // red (measured in this card's reverse verification).
    const result = CurrencyConfigSchema.safeParse({
      currencyMode: 'fixed', defaultCurrency: 'JPY',
    });
    expect(result.success).toBe(true);
    expect(result.data!.precision).toBe(2);
  });

  it('dynamic currencyMode is out of reach by design (JPY + 2 + dynamic passes)', () => {
    const result = CurrencyConfigSchema.safeParse({
      precision: 2, currencyMode: 'dynamic', defaultCurrency: 'JPY',
    });
    expect(result.success).toBe(true);
  });

  it('defaulted currencyMode (dynamic) is equally out of reach', () => {
    expect(CurrencyConfigSchema.safeParse({ precision: 2, defaultCurrency: 'JPY' }).success).toBe(true);
  });

  it('unknown codes fail open (fixed BTC + 8 passes — the open-set contract)', () => {
    const result = CurrencyConfigSchema.safeParse({
      precision: 8, currencyMode: 'fixed', defaultCurrency: 'BTC',
    });
    expect(result.success).toBe(true);
    expect(result.data!.precision).toBe(8);
  });

  it('authored precision in fixed mode is judged against the DEFAULTED currency too (CNY + 0)', () => {
    // `currencyMode: 'fixed'` with no code pins the schema default CNY as the
    // field's one currency; an authored `precision: 0` contradicts its 2.
    // The precision was authored, so this is not the noisy shape.
    const result = CurrencyConfigSchema.safeParse({ currencyMode: 'fixed', precision: 0 });
    expect(result.success).toBe(false);
    expect(firstIssue(result)!.message).toContain('currency CNY has 2 fraction digits');
    expect(firstIssue(result)!.message).toContain('`precision: 0` contradicts it');
  });

  it('a lowercased code cannot dodge the check (Intl-style case folding)', () => {
    const result = CurrencyConfigSchema.safeParse({
      precision: 2, currencyMode: 'fixed', defaultCurrency: 'jpy',
    });
    expect(result.success).toBe(false);
    expect(firstIssue(result)!.message).toContain('currency JPY has 0 fraction digits');
  });

  it('agreeing combos parse byte-identically to the `.default(2)` era', () => {
    // Measured on origin/main (37b82ed5b) before this change — same shape
    // order, same materialized default, byte for byte.
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' },
        '{"precision":2,"currencyMode":"fixed","defaultCurrency":"USD"}'],
      [{ precision: 0, currencyMode: 'fixed', defaultCurrency: 'JPY' },
        '{"precision":0,"currencyMode":"fixed","defaultCurrency":"JPY"}'],
      [{ precision: 3, currencyMode: 'fixed', defaultCurrency: 'KWD' },
        '{"precision":3,"currencyMode":"fixed","defaultCurrency":"KWD"}'],
      [{ currencyMode: 'fixed', defaultCurrency: 'JPY' },
        '{"precision":2,"currencyMode":"fixed","defaultCurrency":"JPY"}'],
      [{}, '{"precision":2,"currencyMode":"dynamic","defaultCurrency":"CNY"}'],
    ];
    for (const [input, expected] of cases) {
      expect(JSON.stringify(CurrencyConfigSchema.parse(input))).toBe(expected);
    }
  });

  it('the `decimals`/`scale` alias spellings funnel into the canonical key (strict rejection + suggestion)', () => {
    // `strictObject` aliases are rejection-with-suggestion, not renames: an
    // alias spelling cannot silently carry a contradicting width past the
    // check — the author is pointed at `precision`, where the check waits.
    for (const alias of ['decimals', 'scale'] as const) {
      const result = CurrencyConfigSchema.safeParse({
        currencyMode: 'fixed', defaultCurrency: 'JPY', [alias]: 2,
      });
      expect(result.success).toBe(false);
      const messages = result.error!.issues.map((i) => i.message).join('\n');
      expect(messages).toContain(alias);
      expect(messages).toContain('precision');
    }
  });
});

describe('#7918 — field-level anchor (FieldSchema.superRefine; the key has no default)', () => {
  const base = { name: 'amount', label: 'Amount', type: 'currency' as const };

  it('rejects an authored field-level precision contradicting the fixed currency (JPY + 2)', () => {
    const result = FieldSchema.safeParse({
      ...base, precision: 2,
      currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' },
    });
    expect(result.success).toBe(false);
    const issue = firstIssue(result)!;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['precision']);
    expect(issue.message).toContain('currency JPY has 0 fraction digits');
    expect(issue.message).toContain('`precision: 2` contradicts it');
  });

  it('accepts a field-level precision agreeing with the fixed currency (JPY + 0, KWD + 3)', () => {
    expect(FieldSchema.safeParse({
      ...base, precision: 0,
      currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' },
    }).success).toBe(true);
    expect(FieldSchema.safeParse({
      ...base, precision: 3,
      currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'KWD' },
    }).success).toBe(true);
  });

  it('no currencyConfig ⇒ no statically-known currency ⇒ no verdict', () => {
    expect(FieldSchema.safeParse({ ...base, precision: 2 }).success).toBe(true);
  });

  it('dynamic (authored or defaulted) currencyMode ⇒ no verdict', () => {
    expect(FieldSchema.safeParse({
      ...base, precision: 2,
      currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'JPY' },
    }).success).toBe(true);
    expect(FieldSchema.safeParse({
      ...base, precision: 2,
      currencyConfig: { defaultCurrency: 'JPY' },
    }).success).toBe(true);
  });

  it('non-currency fields keep `precision` as the number vocabulary (total digits) — untouched', () => {
    expect(FieldSchema.safeParse({
      name: 'total', label: 'Total', type: 'number' as const, precision: 2,
    }).success).toBe(true);
  });

  it('the currencyConfig-level check reaches through the FieldSchema door (path is prefixed)', () => {
    const result = FieldSchema.safeParse({
      ...base,
      currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'JPY' },
    });
    expect(result.success).toBe(false);
    const issue = firstIssue(result)!;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['currencyConfig', 'precision']);
    expect(issue.message).toContain('currency JPY has 0 fraction digits');
  });

  it('both anchors fire independently when both keys contradict', () => {
    const result = FieldSchema.safeParse({
      ...base, precision: 2,
      currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'JPY' },
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('precision');
    expect(paths).toContain('currencyConfig.precision');
  });
});

describe('#7918 — the digit table itself', () => {
  it("carries the card's measured anchors", () => {
    // 0: JPY/KRW/CLP/ISK/VND — 2: USD/EUR/CNY/GBP — 3: KWD/BHD/OMR/TND
    for (const c of ['JPY', 'KRW', 'CLP', 'ISK', 'VND']) expect(currencyFractionDigits(c)).toBe(0);
    for (const c of ['USD', 'EUR', 'CNY', 'GBP']) expect(currencyFractionDigits(c)).toBe(2);
    for (const c of ['KWD', 'BHD', 'OMR', 'TND']) expect(currencyFractionDigits(c)).toBe(3);
  });

  it('answers undefined for codes outside CLDR (the fail-open contract)', () => {
    for (const c of ['BTC', 'ETH', 'ZZZ']) expect(currencyFractionDigits(c)).toBeUndefined();
  });

  it('is a full CLDR snapshot, not a hand-typed subset', () => {
    // CLDR 48.0 currencyData carries 162 codes (see the module's provenance
    // block). A shrunk table silently widens the fail-open surface.
    expect(Object.keys(CURRENCY_FRACTION_DIGITS).length).toBe(162);
  });

  it('the shared verdict names both numbers and stays silent on agreement/unknown', () => {
    expect(currencyPrecisionContradiction('JPY', 2)).toContain('currency JPY has 0 fraction digits');
    expect(currencyPrecisionContradiction('JPY', 0)).toBeUndefined();
    expect(currencyPrecisionContradiction('BTC', 8)).toBeUndefined();
  });
});
