// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A currency's decimal places are the currency's — pinned from both keys that
 * ever claimed otherwise (ruling 5805782503, letter 乙: 「a currency's decimal
 * places are the currency's, not a setting」).
 *
 * #19992 — `currencyConfig.precision` is REMOVED (ADR-0049 enforce-or-remove).
 * It was declared, validated against ISO 4217 by the #7918 rule, and baked to
 * `2` into parse output by the #11423 `.overwrite()` — and read by nothing:
 * objectui's `CurrencyField` derives the width from the currency's ISO 4217
 * minor unit. The #7918 / #11423 blocks that used to open this file pinned a
 * rule over a key nobody honoured; they are replaced below by the retirement's
 * own pins (the refusal, its two alias spellings, the parse output, and the
 * ADR-0087 conversion at rest).
 *
 * #20011 — the FIELD-level `precision` key is "Total digits" (the `p` of a
 * DECIMAL(p, s) amount) and is never judged against the currency. Its block
 * below is unchanged except for the two cases that used to pin the
 * currencyConfig twin's check, which now pin the twin's refusal.
 *
 * Key-vs-value note: the retirement pins judge a KEY (refused whatever its
 * value), so they assert the `unrecognized_keys` envelope — code, path, the
 * offending key and the prescription. The #20011 block judges VALUES (a
 * total-digit count on each currency class), so it demands full `safeParse`
 * outcomes.
 */

import { describe, expect, it } from 'vitest';
import { CurrencyConfigSchema, Field, FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { CURRENCY_FRACTION_DIGITS } from './currency-fraction-digits';
import { applyConversionsToStoredItem } from '../conversions/stored';

/** The first issue, or undefined when the parse passed. */
function firstIssue(result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }) {
  return result.success ? undefined : result.error!.issues[0];
}

/** The prescription's first clause — the retirement statement itself. */
const RETIREMENT_LEAD =
  '`currencyConfig.precision` was removed in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove)';

describe('`currencyConfig.precision` is removed: refused with the prescription, whatever its value', () => {
  it('refuses the key with the full envelope — code, path, offending key, and the prescription\'s clauses', () => {
    const result = CurrencyConfigSchema.safeParse({
      precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD',
    });
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    const issue = issues[0] as { code: string; path: PropertyKey[]; keys?: string[]; message: string };
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual([]);
    expect(issue.keys).toEqual(['precision']);
    // The message IS the author's migration doc — its clauses are the contract.
    expect(issue.message).toContain(RETIREMENT_LEAD);
    expect(issue.message).toContain('no renderer or runtime ever read it');
    expect(issue.message).toContain(
      "a currency amount's decimal places are its currency's ISO 4217 minor unit (2 for USD, 0 for JPY, 3 for KWD)",
    );
    expect(issue.message).toContain('Do not move the number to the field-level `precision`');
    expect(issue.message).toContain('Delete the key.');
    expect(issue.message).toContain(
      'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
    );
  });

  it('refuses an AGREEING value exactly like a contradicting one — the verdict is on the key, not on the width', () => {
    // #7918 accepted USD + 2 and refused JPY + 2 (a `custom` issue naming both
    // digit counts). Both are now the same unknown-key refusal, and the
    // fraction-digit sentence is gone from every outcome.
    const cases: Array<Record<string, unknown>> = [
      { precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' },
      { precision: 2, currencyMode: 'fixed', defaultCurrency: 'JPY' },
      { precision: 3, currencyMode: 'fixed', defaultCurrency: 'KWD' },
      { precision: 8, currencyMode: 'fixed', defaultCurrency: 'BTC' },
      { precision: 2, currencyMode: 'dynamic', defaultCurrency: 'JPY' },
      { precision: 2 },
    ];
    for (const input of cases) {
      const result = CurrencyConfigSchema.safeParse(input);
      expect(result.success, JSON.stringify(input)).toBe(false);
      const issues = result.error!.issues;
      expect(issues, JSON.stringify(input)).toHaveLength(1);
      expect(issues[0]!.code).toBe('unrecognized_keys');
      expect(issues[0]!.message).toContain(RETIREMENT_LEAD);
      expect(issues[0]!.message).not.toContain('fraction digits;');
    }
  });

  it('the former alias spellings `decimals` / `scale` get the same answer — never a rename to the removed key', () => {
    // They were `aliases` pointing an author at `precision`. With the target
    // gone, each is answered with the reason instead, and nothing suggests a
    // key to move the number to.
    for (const key of ['decimals', 'scale'] as const) {
      const result = CurrencyConfigSchema.safeParse({ currencyMode: 'fixed', defaultCurrency: 'JPY', [key]: 2 });
      expect(result.success, key).toBe(false);
      const issues = result.error!.issues;
      expect(issues, key).toHaveLength(1);
      const issue = issues[0] as { code: string; path: PropertyKey[]; keys?: string[]; message: string };
      expect(issue.code).toBe('unrecognized_keys');
      expect(issue.path).toEqual([]);
      expect(issue.keys).toEqual([key]);
      expect(issue.message).toContain(
        `\`currencyConfig.${key}\` is not a currency configuration key, and nothing replaces it`,
      );
      expect(issue.message).toContain("ISO 4217 minor unit (2 for USD, 0 for JPY, 3 for KWD)");
      expect(issue.message).toContain('Delete the key.');
      expect(issue.message).not.toContain('Did you mean');
      // Never keys: no conversion strips them, so the message names no command.
      expect(issue.message).not.toContain('os migrate meta');
    }
  });

  it('the surviving aliases still suggest their surviving keys (the table lost two rows, not its job)', () => {
    const result = CurrencyConfigSchema.safeParse({ mode: 'fixed' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('Did you mean `mode` → `currencyMode`?');
  });

  it('parse output carries exactly the two currency keys — the baked `precision: 2` is gone, on every combination', () => {
    // Byte-exact. Before #19992 the `.overwrite()` wrote `"precision":2` in
    // front on every row except the #11423 guarded class (bare fixed JPY/KRW/
    // KWD), which is why stored rows carry it without anyone writing it.
    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, '{"currencyMode":"dynamic","defaultCurrency":"CNY"}'],
      [{ currencyMode: 'fixed', defaultCurrency: 'USD' }, '{"currencyMode":"fixed","defaultCurrency":"USD"}'],
      [{ currencyMode: 'fixed', defaultCurrency: 'JPY' }, '{"currencyMode":"fixed","defaultCurrency":"JPY"}'],
      [{ currencyMode: 'fixed', defaultCurrency: 'KWD' }, '{"currencyMode":"fixed","defaultCurrency":"KWD"}'],
      [{ defaultCurrency: 'JPY' }, '{"currencyMode":"dynamic","defaultCurrency":"JPY"}'],
    ];
    for (const [input, expected] of cases) {
      const once = CurrencyConfigSchema.parse(input);
      expect(JSON.stringify(once)).toBe(expected);
      // parse(parse(x)) stays idempotent — the property #11423 had to guard
      // by hand now holds by construction (nothing is materialized).
      expect(JSON.stringify(CurrencyConfigSchema.parse(JSON.parse(JSON.stringify(once))))).toBe(expected);
    }
  });

  it('crosses the object door, located at the field — and `tsc` refuses the literal at the Field.currency factory', () => {
    // The tsc channel: the key is off `CurrencyConfig`'s input type, so a
    // literal in a typed position does not compile (TS2353). This is the
    // instrument that found the three showcase objects that wrote the key.
    const amount = Field.currency({
      label: 'Amount',
      // @ts-expect-error — `precision` is not a CurrencyConfig key (#19992)
      currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' },
    });
    // The parse channel, for sources `tsc` never sees (JSON, YAML, stored
    // bodies through a write door): the closed shape refuses it, located.
    const result = ObjectSchema.safeParse({ name: 'invoice', label: 'Invoice', fields: { amount } });
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('unrecognized_keys');
    expect(issues[0]!.path).toEqual(['fields', 'amount', 'currencyConfig']);
    expect(issues[0]!.message).toContain(RETIREMENT_LEAD);
  });
});

describe('the removed `currencyConfig.precision` at rest: a stored row carrying the baked `precision: 2` is served canonical', () => {
  // The ADR-0087 conversion `currency-config-precision-removed` is retired from
  // the load path (authors are refused, above) and replayed by the stored-row
  // seam, which is what keeps rows written under the old `.overwrite()`
  // loadable. The registry's own fixture test proves the transform in
  // isolation; this pins the seam an operator's data actually goes through.
  const storedRow = {
    name: 'invoice',
    label: 'Invoice',
    fields: {
      amount: { label: 'Amount', type: 'currency', currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' } },
      tax: { label: 'Tax', type: 'currency', currencyConfig: { precision: 2, currencyMode: 'dynamic', defaultCurrency: 'CNY' } },
      qty: { label: 'Qty', type: 'number', precision: 10, scale: 0 },
    },
  };

  it('the row as stored is refused by today\'s object door — so the seam is load-bearing, not cosmetic', () => {
    const result = ObjectSchema.safeParse(storedRow);
    expect(result.success).toBe(false);
    expect(result.error!.issues.every((i) => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('applyConversionsToStoredItem strips the key from every currencyConfig, leaves the field-level precision, and the result parses', () => {
    const notices: string[] = [];
    const converted = applyConversionsToStoredItem('object', storedRow, {
      onNotice: (n) => notices.push(`${n.conversionId}@${n.path}`),
    });
    expect(converted.fields.amount.currencyConfig).toEqual({ currencyMode: 'fixed', defaultCurrency: 'USD' });
    expect(converted.fields.tax.currencyConfig).toEqual({ currencyMode: 'dynamic', defaultCurrency: 'CNY' });
    // The FIELD-level total-digit count is a different key and survives.
    expect(converted.fields.qty).toEqual({ label: 'Qty', type: 'number', precision: 10, scale: 0 });
    expect(notices.filter((n) => n.startsWith('currency-config-precision-removed@'))).toHaveLength(2);
    expect(ObjectSchema.safeParse(converted).success).toBe(true);
    // Copy-on-write: the stored input is not mutated.
    expect(storedRow.fields.amount.currencyConfig).toHaveProperty('precision', 2);
  });
});

describe('field-level `precision` is total digits, never judged against the currency (FieldSchema)', () => {
  // Ruling 5805782503 (letter 乙): a currency's decimal places are the
  // currency's, not a setting — and the key's own describe is "Total digits".
  // The #7918 check that compared this key with the fixed currency's fraction
  // digits refused `precision: 18` on a USD amount (a DECIMAL(18,2)) and
  // prescribed `precision: 2`; it is gone, and these pins hold it gone.
  const base = { name: 'amount', label: 'Amount', type: 'currency' as const };
  const fixed = (defaultCurrency: string) => ({ currencyMode: 'fixed' as const, defaultCurrency });

  it('accepts `precision: 18` on a fixed-USD field — a DECIMAL(18,2) amount — and keeps the authored 18', () => {
    const result = FieldSchema.safeParse({ ...base, precision: 18, currencyConfig: fixed('USD') });
    expect(result.success).toBe(true);
    // Carried through as authored: nothing rewrites the total-digit count to
    // the currency's fraction digits.
    expect(result.data!.precision).toBe(18);
  });

  it('still accepts `precision: 2` on a fixed-USD field', () => {
    const result = FieldSchema.safeParse({ ...base, precision: 2, currencyConfig: fixed('USD') });
    expect(result.success).toBe(true);
    expect(result.data!.precision).toBe(2);
  });

  it('flipped: `precision: 2` on a fixed-JPY field parses — a DECIMAL(2,0) amount — where the ISO 4217 width check used to refuse it', () => {
    const result = FieldSchema.safeParse({ ...base, precision: 2, currencyConfig: fixed('JPY') });
    expect(result.success).toBe(true);
    expect(result.data!.precision).toBe(2);
  });

  it('accepts a total-digit count on every fraction-digit class (0: JPY, 2: USD, 3: KWD)', () => {
    const cases: Array<[string, number]> = [
      ['JPY', 0], ['JPY', 12], ['USD', 2], ['USD', 18], ['KWD', 3], ['KWD', 2], ['KWD', 15],
    ];
    for (const [code, precision] of cases) {
      const result = FieldSchema.safeParse({ ...base, precision, currencyConfig: fixed(code) });
      expect(result.success, `${code} + precision ${precision}`).toBe(true);
      expect(result.data!.precision).toBe(precision);
    }
  });

  it('adds no currency-only total-digit coherence rule — a count below the fraction digits parses, as `precision` below `scale` does on a number', () => {
    // Measured parity, not an endorsement of the value: no numeric type
    // relates `precision` to its decimal places at parse, so a currency-only
    // rule would be the one such rule, on a key no face reads.
    expect(FieldSchema.safeParse({ ...base, precision: 1, currencyConfig: fixed('USD') }).success).toBe(true);
    expect(FieldSchema.safeParse({
      name: 'qty', label: 'Qty', type: 'number' as const, precision: 1, scale: 2,
    }).success).toBe(true);
  });

  it('unchanged outside fixed mode: no currencyConfig, and dynamic (authored or defaulted)', () => {
    expect(FieldSchema.safeParse({ ...base, precision: 2 }).success).toBe(true);
    expect(FieldSchema.safeParse({ ...base, precision: 18 }).success).toBe(true);
    expect(FieldSchema.safeParse({
      ...base, precision: 2,
      currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'JPY' },
    }).success).toBe(true);
    expect(FieldSchema.safeParse({
      ...base, precision: 18,
      currencyConfig: { defaultCurrency: 'JPY' },
    }).success).toBe(true);
  });

  it('non-currency fields keep `precision` as the number vocabulary (total digits) — untouched', () => {
    expect(FieldSchema.safeParse({
      name: 'total', label: 'Total', type: 'number' as const, precision: 2,
    }).success).toBe(true);
  });

  it('crosses the object door (ObjectSchema.create) and re-parses stably with the authored 18', () => {
    const obj = ObjectSchema.create({
      name: 'invoice', label: 'Invoice',
      fields: { amount: { label: 'Amount', type: 'currency', precision: 18, currencyConfig: fixed('USD') } },
    });
    const reparsed = ObjectSchema.safeParse(JSON.parse(JSON.stringify(obj)));
    expect(reparsed.success).toBe(true);
    expect(reparsed.data!.fields.amount.precision).toBe(18);
  });

  it('flipped: the currencyConfig twin no longer judges a width — it refuses the key itself, at the FieldSchema door', () => {
    // Was: a `custom` issue at ['currencyConfig', 'precision'] naming both
    // fraction-digit counts. The twin key is gone, so the refusal is the
    // closed shape's, located at the config object, carrying the prescription.
    const result = FieldSchema.safeParse({
      ...base,
      currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'JPY' },
    });
    expect(result.success).toBe(false);
    const issue = firstIssue(result)!;
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['currencyConfig']);
    expect(issue.message).toContain(RETIREMENT_LEAD);
    expect(issue.message).not.toContain('fraction digits;');
  });

  it('flipped: with both keys authored, only the removed twin is refused — the field-level key still raises nothing', () => {
    const result = FieldSchema.safeParse({
      ...base, precision: 2,
      currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'JPY' },
    });
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('unrecognized_keys');
    expect(issues[0].path).toEqual(['currencyConfig']);
    expect(issues[0].message).toContain(RETIREMENT_LEAD);
  });
});

describe('the CLDR digit table — kept for the `iso_4217_currency` value domain, which reads its key set', () => {
  it('carries the measured anchors — 0 digits for JPY, 2 for USD, 3 for KWD', () => {
    // 0: JPY/KRW/CLP/ISK/VND — 2: USD/EUR/CNY/GBP — 3: KWD/BHD/OMR/TND
    for (const c of ['JPY', 'KRW', 'CLP', 'ISK', 'VND']) expect(CURRENCY_FRACTION_DIGITS[c]).toBe(0);
    for (const c of ['USD', 'EUR', 'CNY', 'GBP']) expect(CURRENCY_FRACTION_DIGITS[c]).toBe(2);
    for (const c of ['KWD', 'BHD', 'OMR', 'TND']) expect(CURRENCY_FRACTION_DIGITS[c]).toBe(3);
  });

  it('has no entry for codes outside CLDR (crypto/custom)', () => {
    for (const c of ['BTC', 'ETH', 'ZZZ']) expect(Object.prototype.hasOwnProperty.call(CURRENCY_FRACTION_DIGITS, c)).toBe(false);
  });

  it('is a full CLDR snapshot, not a hand-typed subset', () => {
    // CLDR 48.0 currencyData carries 162 codes (see the module's provenance
    // block). A shrunk table silently narrows the value domain's member set.
    expect(Object.keys(CURRENCY_FRACTION_DIGITS).length).toBe(162);
  });
});

/*
 * ⭐ ON THE ABSENCE HALF — why this retirement has no tree-scoped TEXT pin, and
 * what stands in its place (the `dashboard-chart-structure-refusal.test.ts`
 * precedent). The retirement playbook's default is a tree-scoped absence pin;
 * a reader who finds none here must not conclude one was forgotten.
 *
 * A text sweep works when the retired key's NAME leaves the tree. `precision`
 * does not leave: it stays authorable as the FIELD-level total-digit count on
 * every numeric field, and appears thousands of times across this repository
 * as that key and as prose. What is retired is a key IN A POSITION —
 * `fields.<name>.currencyConfig.precision` — which a grep either matches
 * everywhere or, scoped down by hand, matches only the sites its author
 * already knew about: the file-scoped failure the tree-scoped rule exists to
 * prevent, wearing a tree-scoped costume.
 *
 * The instruments that DO cover the position, both repo-wide and both already
 * required in CI:
 *
 *  1. `tsc`. The key is off `CurrencyConfig`'s input type, so every object
 *     literal that writes it in a typed position fails to compile — the
 *     `@ts-expect-error` in the object-door case above holds that from this
 *     side, and the example's own `typecheck` refuses the key where the three
 *     `examples/app-showcase` objects used to write it (measured on this
 *     retirement by putting it back in one: TS2353 at that line).
 *  2. The parse door. `CurrencyConfigSchema` is a closed `strictObject`, so an
 *     authored key that reaches any parse — `objectstack validate`, the
 *     metadata-protocol publish gate, `defineStack` — is refused with the
 *     prescription, in JSON and YAML sources `tsc` never sees. Stored rows and
 *     built artifacts go through the conversion seam pinned above instead.
 */
