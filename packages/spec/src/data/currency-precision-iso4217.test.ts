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
import { ObjectSchema } from './object.zod';
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
    // The default 2 "contradicts" JPY's 0 digits — but it was never authored,
    // so the rule must not fire. This is the assertion that proves the
    // pre-default anchoring; with a property-level `.default(2)` it goes red
    // (measured in this card's reverse verification). Since #11423 the default
    // is also no longer MATERIALIZED on this combination (the schema would
    // refuse it as authored — see the idempotency block below), so the parsed
    // output omits `precision` rather than carrying 2.
    const result = CurrencyConfigSchema.safeParse({
      currencyMode: 'fixed', defaultCurrency: 'JPY',
    });
    expect(result.success).toBe(true);
    expect(result.data!.precision).toBeUndefined();
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
    // order, same materialized default, byte for byte. The one #11423 flip is
    // deliberately NOT in this battery: a bare fixed-JPY config now omits
    // `precision` (the schema would refuse the materialized 2 as authored —
    // pinned in the idempotency block below); every combination here either
    // authored its precision or cannot be refused, so byte-identity holds.
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' },
        '{"precision":2,"currencyMode":"fixed","defaultCurrency":"USD"}'],
      [{ precision: 0, currencyMode: 'fixed', defaultCurrency: 'JPY' },
        '{"precision":0,"currencyMode":"fixed","defaultCurrency":"JPY"}'],
      [{ precision: 3, currencyMode: 'fixed', defaultCurrency: 'KWD' },
        '{"precision":3,"currencyMode":"fixed","defaultCurrency":"KWD"}'],
      [{ currencyMode: 'fixed', defaultCurrency: 'USD' },
        '{"precision":2,"currencyMode":"fixed","defaultCurrency":"USD"}'],
      [{ currencyMode: 'fixed', defaultCurrency: 'JPY' },
        '{"currencyMode":"fixed","defaultCurrency":"JPY"}'],
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

// [#11423] (maintainer ruling routed from #9689, 2026-08-24, idempotent
// materialization): the `.overwrite()` never materializes a default the schema
// itself would refuse as authored. Baking `precision: 2` onto a bare fixed
// zero-/three-digit-currency config (JPY/KRW/KWD class) made parse output
// self-rejecting on re-parse — `parse(parse(x))` threw for accepted x, and the
// re-parse chain is the mainline authoring path (`ObjectSchema.create()`
// returns parse output; `objectstack build`'s defineStack parses it again).
// Same one-conditional shape as the #9689 master_detail guard in field.zod.ts.
describe('#11423 — the materialized precision default is never one the schema itself refuses', () => {
  it('a bare fixed-JPY config parses green and OMITS precision — parse(parse(x)) is idempotent', () => {
    // The card's measured break: parse #1 baked `precision: 2`, parse #2
    // rejected it at `currencyConfig.precision` ("currency JPY has 0 fraction
    // digits; `precision: 2` contradicts it"). Absent is the honest spelling.
    const once = CurrencyConfigSchema.parse({ currencyMode: 'fixed', defaultCurrency: 'JPY' });
    expect(once.precision).toBeUndefined();
    expect('precision' in once).toBe(false);
    const again = CurrencyConfigSchema.safeParse(JSON.parse(JSON.stringify(once)));
    expect(again.success).toBe(true);
    expect(JSON.stringify(again.data)).toBe(JSON.stringify(once));
  });

  it('parse is IDEMPOTENT through the mainline create() → defineStack chain (the chain that carried the defect)', () => {
    const field = FieldSchema.parse({
      name: 'amount', label: 'Amount', type: 'currency',
      currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' },
    });
    expect(FieldSchema.safeParse(JSON.parse(JSON.stringify(field))).success).toBe(true);
    const obj = ObjectSchema.create({
      name: 'invoice', label: 'Invoice',
      fields: { amount: { label: 'Amount', type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } } },
    });
    expect(ObjectSchema.safeParse(obj).success).toBe(true);
  });

  it('an AUTHORED contradictory precision is still rejected with the named message (the guard narrows materialization, not the rule)', () => {
    const result = CurrencyConfigSchema.safeParse({
      precision: 2, currencyMode: 'fixed', defaultCurrency: 'JPY',
    });
    expect(result.success).toBe(false);
    const issue = firstIssue(result)!;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['precision']);
    expect(issue.message).toContain('currency JPY has 0 fraction digits');
    expect(issue.message).toContain('`precision: 2` contradicts it');
  });

  it('a bare fixed-USD config still materializes precision 2 byte-identically (the default keeps baking where it is legal — #7918 relocation intact)', () => {
    expect(JSON.stringify(CurrencyConfigSchema.parse({ currencyMode: 'fixed', defaultCurrency: 'USD' })))
      .toBe('{"precision":2,"currencyMode":"fixed","defaultCurrency":"USD"}');
  });

  it('the whole refused class skips materialization — 0-digit (KRW) and 3-digit (KWD) fixed currencies omit precision and re-parse green', () => {
    for (const code of ['KRW', 'KWD']) {
      const once = CurrencyConfigSchema.parse({ currencyMode: 'fixed', defaultCurrency: code });
      expect('precision' in once).toBe(false);
      expect(CurrencyConfigSchema.safeParse(JSON.parse(JSON.stringify(once))).success).toBe(true);
    }
  });

  it('combinations the superRefine cannot refuse keep materializing — dynamic mode and unknown fixed codes', () => {
    // dynamic + JPY: no single currency to check against, baked 2 re-parses
    // green (the superRefine only judges `fixed`); unknown fixed code: the
    // digit table fails OPEN, so 2 is never refused.
    expect(CurrencyConfigSchema.parse({ defaultCurrency: 'JPY' }).precision).toBe(2);
    expect(CurrencyConfigSchema.parse({ currencyMode: 'fixed', defaultCurrency: 'BTC' }).precision).toBe(2);
    for (const input of [{ defaultCurrency: 'JPY' }, { currencyMode: 'fixed', defaultCurrency: 'BTC' }]) {
      const once = CurrencyConfigSchema.parse(input);
      expect(CurrencyConfigSchema.safeParse(JSON.parse(JSON.stringify(once))).success).toBe(true);
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
