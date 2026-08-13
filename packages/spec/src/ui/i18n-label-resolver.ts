// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `I18nLabel` → `string` — the one shared resolver for the **inline locale
 * map**, and the backend's first (#6761, maintainer ruling 2026-08-08, option
 * **B**).
 *
 * ## What this is for
 *
 * `I18nLabelSchema` (see `./i18n.zod`) authorizes two forms of a display label:
 * a plain string, and an inline locale map `{ en: 'Owner', 'zh-CN': '负责人' }`.
 * Until now only ONE end of the platform knew what the second form *means*:
 * objectui's `pickLocalized`. Every backend producer that had to put a label on
 * the wire tested `typeof label === 'string'` and dropped anything else — so a
 * dataset that declared its dimension label the way the schema authorizes shipped
 * `fields[]` entries with **no label at all**, or with the machine name published
 * as a display title (`dataset-compiler.ts:374/406`). Measurements in #6761.
 *
 * The rule that resolves a map therefore had to live somewhere **shared**, not
 * inside whichever service needed it first: a private twin in `service-analytics`
 * is what the next producer would have copied (Prime Directive #12). This module
 * is that shared seat. The consumption half — `AnalyticsService.queryDataset`'s
 * two enrichment sites and `dataset-compiler.ts:374/406` — is #6761 and is
 * deliberately NOT implemented here.
 *
 * ## Rule parity with objectui's `pickLocalized` is the contract
 *
 * The ruling's acceptance hinge is not this function's shape but that it picks
 * **the same entry** objectui would, for the same map and the same locale. Two
 * resolvers that disagree render the same metadata differently on the two ends
 * with neither side erroring — the server-rendered column header and the
 * client-rendered one simply differ.
 *
 * The reference is objectui `packages/i18n/src/pickLocalized.ts` (read at
 * `origin/main` `d8d0d66`, blob `30fcb0a8`, last touched by objectui PR #4359 /
 * objectui#3907). Its rule, mirrored here limb for limb:
 *
 * | # | limb | note |
 * |---|---|---|
 * | 0 | plain string ⇒ itself | pass-through, `''` included |
 * | — | `locale` normalization | `(locale \|\| 'en').trim()`; **no** case folding |
 * | 1 | exact tag — `map[locale]` | `zh-CN` matches the key `zh-CN` |
 * | 2 | base language — `map[base]` | `zh-CN` → `zh` |
 * | 3 | first region-qualified sibling sharing the base | `zh` → `zh-CN`; **key insertion order** decides |
 * | 4 | `map.default` | the untagged entry `InlineLocaleMapSchema` admits |
 * | 5 | `map.en` | the platform's source language |
 * | 6 | first string value | insertion order again |
 *
 * Miss (no limb hits) ⇒ **nothing was picked**. See the return-shape note below —
 * this is the one place where this function deliberately does not spell the
 * outcome the way `pickLocalized` does, and the parity test pins the exact
 * relationship between the two spellings.
 *
 * ### Case sensitivity is asymmetric, and that is the reference's rule
 *
 * Every comparison above is case-**sensitive**: `pickLocalized` folds neither
 * the locale nor the keys. The observable effect is asymmetric between the two
 * halves of a tag, and both halves are worth knowing before you rely on either:
 *
 *  * the **region** subtag's case does not matter, because limb 3 compares only
 *    the language subtag — `{ 'zh-CN': '负责人' }` answers `zh-cn` (base `zh`
 *    on both sides) via limb 3;
 *  * the **language** subtag's case does — `ZH-CN` has base `ZH`, which equals
 *    no key of that map on limbs 1, 2 or 3, so the request falls through to
 *    `default` / `en` / any-string and can land in the wrong language entirely.
 *
 * BCP-47 says subtags are case-insensitive, so a stricter reading would fold
 * case — but parity with the reference is the ruled acceptance, and a resolver
 * that folded case would answer differently from the renderer for exactly the
 * inputs where it "improved". The asymmetry is pinned as-is, with vectors, in
 * `i18n-label-resolver.test.ts`; changing it is a two-repo decision, not a
 * detail to fix in passing.
 *
 * ## Rule departures — converged as of objectui#3907, zero remain
 *
 * This module shipped (objectstack#6765) with two deliberate narrowings of the
 * reference's limb rule, both stated rather than silent. objectui#3907 (landed
 * in objectui PR #4359) closed both upstream, so the two ends now agree limb
 * for limb on every map input:
 *
 * 1. **Own properties only.** Before objectui#3907, `pickLocalized` read
 *    `map[locale]` with a bare bracket access, so a locale that happened to
 *    name an `Object.prototype` member (`constructor`, `toString`) resolved to
 *    that member and rendered as its source text. In a browser the locale
 *    comes from the app's own language state; on a server it can come from an
 *    `Accept-Language` header, so this module read own properties only from
 *    the start. No language tag is an `Object.prototype` key, so no
 *    in-contract input could ever tell the two apart — objectui#3907 landed
 *    the same guard upstream regardless, closing the gap for out-of-contract
 *    input too.
 * 2. **Only `string` values are eligible, on every limb.** Before
 *    objectui#3907, `pickLocalized` applied a `typeof === 'string'` filter on
 *    limbs 3 and 6 but not on 1, 2, 4, 5, where a non-string value
 *    short-circuited the chain and was stringified (`[object Object]`).
 *    `InlineLocaleMapSchema` declares `z.record(<tag>, z.string())`, so no
 *    value that reaches either resolver in-contract is anything but a string,
 *    and the inconsistency was unobservable inside the declared domain — but
 *    Prime Directive #12 says the producer is wrong and the consumer must not
 *    coerce a rendered `[object Object]` onto a screen, and objectui#3907
 *    applies the filter uniformly upstream now too.
 *
 * A guard makes its limb **miss**; it does not abort the resolution — an
 * unusable entry falls through to the next limb exactly as an absent one does,
 * on both sides. `pickLocalized({ en: 'Pricing' }, 'constructor')` is now
 * `'Pricing'` (the chain falls through to the `en` limb), not `''` — `''` (or
 * this module's `undefined`) only when NO limb hits at all, e.g. an empty map.
 *
 * ## What still differs
 *
 * Two differences survive the sync, both stated rather than silent because
 * parity, not taste, is what this module is for — everything else a caller
 * can observe with an `I18nLabel` that `I18nLabelSchema` accepts is identical
 * between the two ends:
 *
 * * **The miss spelling.** `pickLocalized` answers a miss as `''`, because its
 *   caller is a renderer writing into a text node. This module answers
 *   `undefined` — see the return-shape note below. The two spellings are
 *   bridged by one `?? ''`, pinned as an identity in the parity test.
 * * **The top-level scalar pass-through.** `pickLocalized` accepts `unknown`
 *   and stringifies a bare number or boolean (`pickLocalized(42, 'en')` is
 *   `'42'`). This module's parameter is the declared `I18nLabel`
 *   (`string | Record<string, string>`), so a number or boolean is a type
 *   error at the call site, not a value to coerce at runtime —
 *   `resolveI18nLabel(42, 'en')` is `undefined`, refused rather than
 *   stringified (Prime Directive #12). This is a departure in the VALUE
 *   parameter, not a limb of the map rule above, and objectui#3907 / PR
 *   objectui#4359 did not touch it — it is not expected to converge.
 *
 * ## Relation to the other resolver in this package
 *
 * `system/i18n-resolver.ts` resolves form **1** — a plain-string label plus a
 * translation *bundle*, addressed by convention
 * (`objects.<object>._views.<view>.label`). This module resolves form **2**, the
 * map the author inlined. They compose in that order at objectui's own call
 * sites (`translateLabel(pickLocalized(label, language), language)` —
 * `packages/components/src/renderers/layout/containers.tsx:530-532`): resolve
 * the inline map first, then look the resulting string up in the bundle.
 */

import type { I18nLabel } from './i18n.zod';

/**
 * The locale `pickLocalized` assumes when the caller has none — and the last
 * named key it tries before falling back to "any string in the map".
 *
 * Not exported: it is an implementation detail of the parity, not a knob. A
 * caller that wants a different default passes it as `locale`.
 */
const DEFAULT_LOCALE = 'en';

/**
 * Read one entry of an inline locale map, honouring both departures documented
 * on the module: own properties only, and `string` values only.
 *
 * Returns `undefined` for "this limb did not hit", which is what makes the
 * limbs chain in the same order `pickLocalized`'s `??` chain does.
 */
function readEntry(map: Record<string, unknown>, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(map, key)) return undefined;
  const value = map[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolve a display label to the string to show for `locale`.
 *
 * Accepts either authorized form of {@link I18nLabel}: a plain string (returned
 * unchanged, `''` included — an author who wrote an empty label wrote a label)
 * or an inline locale map, resolved by the six-limb rule documented on this
 * module and shared verbatim with objectui's `pickLocalized`.
 *
 * ## The return shape, and why it is not `pickLocalized`'s
 *
 * `pickLocalized` returns `''` when nothing matches, because its caller is a
 * renderer writing into a text node. This function returns **`undefined`**,
 * because its callers are *producers* filling a `label?: string` field on the
 * wire, and downstream enrichment in that direction is guarded by
 * `if (field.label == null)`. A producer that wrote `''` would therefore not be
 * writing "no label" — it would be permanently displacing the real label some
 * later stage still had (#5199 route A, judged harmful rather than redundant;
 * restated in #6761).
 *
 * So `undefined` here means exactly what `''` means there — *nothing was
 * picked* — in the spelling each side's callers need. The bridge is one `??`,
 * and the parity test pins it as an identity:
 *
 * ```ts
 * resolveI18nLabel(label, locale) ?? '' // ≡ pickLocalized(label, locale)
 * ```
 *
 * There is deliberately no `fallback` parameter: `?? fallback` at the call site
 * is the same expression, and it keeps the decision about the miss case visible
 * in the file where writing the wrong thing does the damage.
 *
 * @param label - The label to resolve. `undefined` (an absent label) resolves
 *   to `undefined` — absence is not a miss to be papered over.
 * @param locale - BCP-47 language tag of the audience, e.g. `zh-CN`. Required
 *   positionally but nullish-tolerant: `undefined` means "no locale known" and
 *   resolves as `en`, matching the reference. It is positional rather than
 *   optional so that a producer cannot silently ship one audience's language to
 *   every audience by forgetting an argument — the defect #6761 records.
 * @returns The string to display, or `undefined` when the label is absent or no
 *   limb matched. Pair with `?? someDefault` when the caller needs a string.
 *
 * @example
 * ```typescript
 * resolveI18nLabel('Owner', 'zh-CN');                         // 'Owner'
 * resolveI18nLabel({ en: 'Owner', 'zh-CN': '负责人' }, 'zh-CN'); // '负责人'
 * resolveI18nLabel({ en: 'Owner', 'zh-CN': '负责人' }, 'zh');    // '负责人' (base → region)
 * resolveI18nLabel({ 'ja-JP': '所有者' }, 'fr');                // '所有者' (last resort)
 * resolveI18nLabel(undefined, 'zh-CN') ?? dimension.name;      // producer shape
 * ```
 *
 * @see `system/i18n-resolver.ts` — the bundle-addressed resolver for form 1.
 */
export function resolveI18nLabel(
  label: I18nLabel | undefined,
  locale: string | undefined,
): string | undefined {
  // Absent label. Distinct from a miss only in provenance; both answer `undefined`.
  if (label == null) return undefined;

  // Form 1 — a plain string is already the answer, `''` included (parity: the
  // reference returns it unchanged too).
  if (typeof label === 'string') return label;

  // Anything that is not a map is off-contract for `I18nLabelSchema`. Prime
  // Directive #12: refuse it rather than stringify it into a visible label.
  if (typeof label !== 'object') return undefined;

  const map = label as Record<string, unknown>;

  // Locale normalization, verbatim from the reference: a nullish/empty locale
  // becomes `en`, surrounding whitespace is trimmed, and case is NOT folded.
  const tag = (locale || DEFAULT_LOCALE).trim();
  const base = tag.split('-')[0];

  // 1 — exact tag.
  const exact = readEntry(map, tag);
  if (exact !== undefined) return exact;

  // 2 — base language (`zh-CN` → `zh`).
  const baseHit = readEntry(map, base);
  if (baseHit !== undefined) return baseHit;

  // 3 — first region-qualified sibling sharing the base (`zh` → `zh-CN`), in
  // key insertion order. Limbs 1 and 2 already ran, so this only fires when
  // neither the exact tag nor the bare base is a key.
  for (const key of Object.keys(map)) {
    if (key.split('-')[0] !== base) continue;
    const regional = readEntry(map, key);
    if (regional !== undefined) return regional;
  }

  // 4 — the untagged `default` entry.
  const untagged = readEntry(map, 'default');
  if (untagged !== undefined) return untagged;

  // 5 — the platform's source language.
  const english = readEntry(map, DEFAULT_LOCALE);
  if (english !== undefined) return english;

  // 6 — last resort: any string in the map, in key insertion order. A label in
  // the wrong language still beats a column with no header.
  for (const key of Object.keys(map)) {
    const any = readEntry(map, key);
    if (any !== undefined) return any;
  }

  // Miss. `undefined`, never `''` — see the return-shape note above.
  return undefined;
}
