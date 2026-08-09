// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Rule parity between `resolveI18nLabel` and objectui's `pickLocalized`.
 *
 * The #6761 ruling's acceptance hinge is not the resolver's API shape but that
 * the two ends of the platform pick the SAME ENTRY out of the same inline
 * locale map. A comment claiming that is worth nothing: two resolvers that
 * drift apart render the same metadata differently on the two ends and NEITHER
 * SIDE ERRORS — the server-rendered column header and the client-rendered one
 * simply disagree, forever. So the parity is executed here, not asserted in
 * prose.
 *
 * ## How the expectations were derived
 *
 * `pickLocalizedReference` below is a VERBATIM copy of the reference
 * implementation, taken from
 *
 *   repo   objectstack-ai/objectui
 *   path   packages/i18n/src/pickLocalized.ts
 *   rev    origin/main 50fa3766ebb2ebf2ec78c5d13b1d627e6a91696f
 *   blob   9e5d92ae2efe9be62d4d010cb0a26e598211f3ec
 *   last touched by objectui#3278 (2026-08-03)
 *
 * Copied rather than imported because `@objectstack/spec` must not take a
 * workspace dependency on objectui — spec sits UNDER objectui in the dependency
 * order, and inverting that to buy a test fixture would be a far worse trade
 * than copying 20 lines. The copy is what makes each `pickLocalized` column
 * below a MEASUREMENT instead of the author's recollection: every vector is
 * asserted against the reference first (`the reference really answers this`),
 * and only then against `resolveI18nLabel`.
 *
 * ⛔ `pickLocalizedReference` is a test fixture. It is not exported from this
 * file, and nothing under `src/` may import it — the whole point of #6765 is
 * that the repo has ONE resolver, not a private copy per consumer (PD#12). If
 * you find yourself wanting to call it from production code, you want
 * `resolveI18nLabel`.
 *
 * ## Keeping it honest when objectui moves
 *
 * The copy is pinned to a revision, so it cannot silently follow objectui.
 * If `pickLocalized` changes there, this file goes stale rather than wrong:
 * re-read the source at the new revision, update the copy AND the pin above,
 * and let the vectors say whether the rule moved. A vector that flips is a
 * two-repo decision, not a number to re-record.
 */

import { describe, it, expect } from 'vitest';
import { resolveI18nLabel } from './i18n-label-resolver';
import type { I18nLabel } from './i18n.zod';

// ---------------------------------------------------------------------------
// The reference implementation — verbatim, see the header for provenance. Only
// the NAME differs, so that a reader of a failing assertion can tell at a glance
// which side is the copy.
function pickLocalizedReference(value: unknown, language: string | undefined | null): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const lang = (language || 'en').trim();
    const base = lang.split('-')[0];
    // Runtime language is often a bare base code ('zh') while metadata authors
    // write full BCP-47 tags ('zh-CN') — upgrade to any key sharing the base.
    const regional = Object.keys(o).find((k) => k.split('-')[0] === base && typeof o[k] === 'string');
    const pick =
      o[lang] ??
      o[base] ??
      (regional !== undefined ? o[regional] : undefined) ??
      o.default ??
      o.en ??
      Object.values(o).find((v) => typeof v === 'string');
    return pick == null ? '' : String(pick);
  }
  return String(value);
}
// ---------------------------------------------------------------------------

interface ParityVector {
  /** What this vector demonstrates — the limb of the rule it exercises. */
  readonly limb: string;
  readonly label: I18nLabel | undefined;
  readonly locale: string | undefined;
  /** The reference's answer. Asserted against the reference itself below. */
  readonly pick: string;
}

/**
 * One table, both ends. Every row is an input `I18nLabelSchema` accepts (or the
 * absence of one), so every row is inside the declared domain where parity is
 * total.
 */
const PARITY_VECTORS: readonly ParityVector[] = [
  // Form 1 — the plain string.
  { limb: '0 plain string passes through', label: 'Owner', locale: 'zh-CN', pick: 'Owner' },
  { limb: '0 an empty string is a label the author wrote', label: '', locale: 'zh-CN', pick: '' },

  // Limb 1 — exact tag.
  { limb: '1 exact tag', label: { en: 'Owner', 'zh-CN': '负责人' }, locale: 'zh-CN', pick: '负责人' },
  { limb: '1 exact tag (source language)', label: { en: 'Owner', 'zh-CN': '负责人' }, locale: 'en', pick: 'Owner' },
  {
    limb: '1 exact tag beats an earlier sibling sharing the base',
    label: { 'zh-TW': '擁有者', 'zh-CN': '负责人' },
    locale: 'zh-CN',
    pick: '负责人',
  },

  // Limb 2 — region request, base key (`zh-CN` → `zh`).
  { limb: '2 region → base', label: { en: 'Owner', zh: '负责人' }, locale: 'zh-CN', pick: '负责人' },
  { limb: '2 region → base, multi-subtag tag', label: { en: 'Owner', zh: '负责人' }, locale: 'zh-Hans-CN', pick: '负责人' },

  // Limb 3 — base request, region key (`zh` → `zh-CN`).
  { limb: '3 base → region', label: { en: 'Owner', 'zh-CN': '负责人' }, locale: 'zh', pick: '负责人' },
  { limb: '3 base → region (ja)', label: { en: 'Owner', 'ja-JP': '所有者' }, locale: 'ja', pick: '所有者' },
  { limb: '3 base key wins over the region upgrade', label: { zh: '基础', 'zh-CN': '区域' }, locale: 'zh', pick: '基础' },
  {
    limb: '3 first sibling in key order wins, not the "best" region',
    label: { 'zh-TW': '擁有者', 'zh-CN': '负责人' },
    locale: 'zh',
    pick: '擁有者',
  },
  {
    limb: '3 runs BEFORE default — a wrong-region hit beats the untagged entry',
    label: { default: 'Owner', 'fr-FR': 'Propriétaire' },
    locale: 'fr',
    pick: 'Propriétaire',
  },

  // Case sensitivity, both halves of the tag. See the module doc on the
  // resolver: this asymmetry is the reference's rule, pinned as-is.
  {
    limb: '3 the REGION subtag\'s case does not matter (only the base is compared)',
    label: { 'zh-CN': '负责人' },
    locale: 'zh-cn',
    pick: '负责人',
  },
  {
    limb: '5 the LANGUAGE subtag\'s case DOES — `ZH-CN` matches nothing and lands on `en`',
    label: { 'zh-CN': '负责人', en: 'Owner' },
    locale: 'ZH-CN',
    pick: 'Owner',
  },

  // Limb 4 / 5 / 6 — the named fallbacks, then any string at all.
  { limb: '4 default', label: { default: 'D', en: 'E' }, locale: 'fr', pick: 'D' },
  { limb: '5 en', label: { en: 'E', ja: 'J' }, locale: 'fr', pick: 'E' },
  { limb: '6 first string value', label: { ja: 'J' }, locale: 'fr', pick: 'J' },
  { limb: '6 first string value, in key order', label: { ja: 'J', ko: 'K' }, locale: 'fr', pick: 'J' },

  // Locale normalization — `(locale || 'en').trim()`, no case folding.
  { limb: 'norm undefined locale ⇒ en', label: { en: 'E', 'zh-CN': 'Z' }, locale: undefined, pick: 'E' },
  { limb: 'norm empty locale ⇒ en', label: { en: 'E', 'zh-CN': 'Z' }, locale: '', pick: 'E' },
  { limb: 'norm surrounding whitespace is trimmed', label: { en: 'E', 'zh-CN': 'Z' }, locale: '  zh-CN  ', pick: 'Z' },
  { limb: 'norm undefined locale still reaches limb 6', label: { 'zh-CN': 'Z' }, locale: undefined, pick: 'Z' },

  // An entry whose VALUE is empty is still a hit — the reference's `??` chain
  // does not skip `''`, and neither may this one.
  { limb: '1 an empty value is a hit, not a miss', label: { en: '', 'zh-CN': '负责人' }, locale: 'en', pick: '' },
  { limb: '5 an empty `en` is a hit, not a miss', label: { en: '' }, locale: 'fr', pick: '' },

  // The miss cases. The reference spells "nothing was picked" as `''`.
  { limb: 'miss empty map', label: {}, locale: 'zh-CN', pick: '' },
  { limb: 'miss absent label', label: undefined, locale: 'zh-CN', pick: '' },
];

describe('resolveI18nLabel — rule parity with objectui pickLocalized (#6765 / #6761 ruling B)', () => {
  describe('the vector table really is the reference\'s behaviour', () => {
    it.each(PARITY_VECTORS)('$limb', ({ label, locale, pick }) => {
      // Asserted against the copied reference FIRST. If this row is wrong, the
      // parity assertion below would be comparing `resolveI18nLabel` to the
      // author's recollection instead of to objectui.
      expect(pickLocalizedReference(label, locale)).toBe(pick);
    });
  });

  describe('resolveI18nLabel picks the same entry', () => {
    it.each(PARITY_VECTORS)('$limb', ({ label, locale, pick }) => {
      // The identity the two spellings of "nothing was picked" are bridged by.
      // `?? ''` is the ONLY difference between the two functions inside the
      // declared domain — everything else is the same limb, in the same order.
      expect(resolveI18nLabel(label, locale) ?? '').toBe(pick);
    });
  });

  it('every vector agrees limb for limb, in one pass', () => {
    const disagreements = PARITY_VECTORS.filter(
      (v) => (resolveI18nLabel(v.label, v.locale) ?? '') !== pickLocalizedReference(v.label, v.locale),
    ).map((v) => v.limb);
    expect(disagreements).toEqual([]);
  });
});

describe('resolveI18nLabel — the producer-facing return shape', () => {
  // Why this is not `''`: downstream enrichment in the producing direction is
  // guarded by `if (field.label == null)`, so a producer that wrote `''` would
  // not be writing "no label" — it would permanently displace the real label a
  // later stage still had (#5199 route A, judged harmful rather than
  // redundant; restated in #6761).
  it('answers `undefined` — not `\'\'` — when the label is absent', () => {
    expect(resolveI18nLabel(undefined, 'zh-CN')).toBeUndefined();
  });

  it('answers `undefined` when no limb matched', () => {
    expect(resolveI18nLabel({}, 'zh-CN')).toBeUndefined();
  });

  it('answers `\'\'` when the author really wrote an empty label', () => {
    // A hit is a hit. This is the case a `''` miss value would be
    // indistinguishable from, which is why the miss is `undefined`.
    expect(resolveI18nLabel('', 'zh-CN')).toBe('');
    expect(resolveI18nLabel({ en: '' }, 'en')).toBe('');
  });

  it('composes with `??` into the producer call shape #6761 needs', () => {
    // `dataset-compiler.ts:374/406` today: `typeof d.label === 'string' ? d.label : d.name`,
    // which publishes the MACHINE NAME as a display title for a map label.
    const dimension = { name: 'owner', label: { en: 'Owner', 'zh-CN': '负责人' } as I18nLabel };
    expect(resolveI18nLabel(dimension.label, 'zh-CN') ?? dimension.name).toBe('负责人');

    const unlabelled = { name: 'owner', label: undefined };
    expect(resolveI18nLabel(unlabelled.label, 'zh-CN') ?? unlabelled.name).toBe('owner');
  });
});

describe('resolveI18nLabel — the two deliberate departures from the reference', () => {
  // Both are documented on the resolver's module doc. They are pinned here with
  // BOTH answers so the divergence stays MEASURED: if a later change makes the
  // two agree again, these tests go red and say so, rather than quietly
  // becoming decoration.

  it('reads own properties only — a locale naming an Object.prototype member is a miss', () => {
    const label: I18nLabel = { en: 'Owner' };

    // The reference resolves `map['constructor']` up the prototype chain and
    // renders the function's source text as the label. Filed as objectui#3907.
    expect(pickLocalizedReference(label, 'constructor')).toContain('function Object');

    // Here it is simply not a key, so the chain continues to `en`. No BCP-47
    // tag is an `Object.prototype` member, so no in-contract input can tell the
    // two implementations apart — but on a server the locale can arrive in an
    // `Accept-Language` header, which is why this one is hardened.
    expect(resolveI18nLabel(label, 'constructor')).toBe('Owner');
    expect(resolveI18nLabel(label, 'toString')).toBe('Owner');
  });

  it('treats a non-string value as absent on EVERY limb, not just limbs 3 and 6', () => {
    // Off-spec: `InlineLocaleMapSchema` is `z.record(<tag>, z.string())`, so no
    // in-contract map can hold this. The cast is what makes that explicit.
    const offSpec = { 'zh-CN': { nested: 'x' }, en: 'Owner' } as unknown as I18nLabel;

    // The reference filters by `typeof === 'string'` on limbs 3 and 6 but not
    // on 1/2/4/5, so an exact-tag hit short-circuits and gets stringified.
    expect(pickLocalizedReference(offSpec, 'zh-CN')).toBe('[object Object]');

    // PD#12: the producer is wrong; the consumer must not coerce `[object
    // Object]` onto a screen. The filter is uniform, so the limb is a miss and
    // the chain continues.
    expect(resolveI18nLabel(offSpec, 'zh-CN')).toBe('Owner');
  });

  it('refuses an off-contract scalar rather than stringifying it', () => {
    // `pickLocalized` accepts `unknown` and stringifies numbers/booleans. This
    // resolver's parameter is the declared `I18nLabel`, so the shapes below are
    // type errors — the `@ts-expect-error` directives immediately after are the
    // real guard. This asserts the runtime half: no coerced `'42'` label.
    // @ts-expect-error a number is not an `I18nLabel` — off-spec input is refused, not coerced
    expect(resolveI18nLabel(42, 'en')).toBeUndefined();
    // @ts-expect-error a boolean is not an `I18nLabel`
    expect(resolveI18nLabel(true, 'en')).toBeUndefined();
  });
});

describe('resolveI18nLabel — the type signature refuses the calls that caused #6761', () => {
  // Reverse verification at the type level. `check:test-typecheck` compiles this
  // file (packages/spec/tsconfig.test.json), so each directive below is a REAL
  // check: delete the argument it guards and tsc goes red on the unused
  // `@ts-expect-error` instead of letting the call through.

  it('rejects a map whose values are not strings', () => {
    // @ts-expect-error `InlineLocaleMap` values are strings; a number is not a label
    const bad: I18nLabel = { en: 42 };
    expect(resolveI18nLabel(bad, 'en')).toBeUndefined();
  });

  it('rejects the call that forgets the locale', () => {
    // The defect #6761 records is a producer shipping ONE audience's language to
    // every audience. `locale` is positional rather than optional precisely so
    // that omitting it cannot compile.
    // @ts-expect-error `locale` is required positionally — a producer must decide it
    expect(resolveI18nLabel({ en: 'Owner' })).toBe('Owner');
  });

  it('accepts both authorized forms, and an absent label', () => {
    const plain: I18nLabel = 'All Active';
    const inline: I18nLabel = { en: 'All Active', 'zh-CN': '全部活跃' };
    expect(resolveI18nLabel(plain, 'zh-CN')).toBe('All Active');
    expect(resolveI18nLabel(inline, 'zh-CN')).toBe('全部活跃');
    expect(resolveI18nLabel(undefined, 'zh-CN')).toBeUndefined();
  });
});
