/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4163 part 1 — the anti-drift pin for the inline per-locale label
 * rule, and the guard that makes objectui#4163's second dispatch ruling
 * ("the layout sites use the spec's OWN label resolver — do not hand-roll a
 * resolution that can drift from it") safe where it could not be followed
 * literally.
 *
 * ## Why two resolvers exist at all
 *
 * `@objectstack/spec` 17.0.0-rc.6 widened `I18nLabel` from `string` to
 * `string | Record<string, string>` and shipped `resolveI18nLabel(label,
 * locale)` as the producer's rule for reading one. #4163 resolves that
 * vocabulary at thirteen sites, and they do NOT all reach for the same
 * function:
 *
 *  - `@object-ui/layout` and `@object-ui/app-shell` call the spec's
 *    `resolveI18nLabel` directly;
 *  - `@object-ui/plugin-list`, `@object-ui/plugin-dashboard` and
 *    `@object-ui/plugin-designer` call objectui's `pickLocalized`, because
 *    those components sit inside objectui's i18n tree and already hold the live
 *    UI language — and `pickLocalized` answers `''` on a miss, which is what a
 *    text node wants, where the spec's answers `undefined`.
 *
 * That split is by DESTINATION, not by package — as of objectui#5134
 * `plugin-list` holds one of each. `ListView`'s nested `aria.ariaLabel` is an
 * ATTRIBUTE, not a text node: a miss there must omit the attribute rather than
 * name the region something, so that one read site calls the spec's
 * `resolveI18nLabel` and takes its `undefined` directly
 * (`ListView.ariaLabelInlineLocale.test.tsx`), while `TabBar`'s tab text keeps
 * `pickLocalized` and its `''`. Which makes the parity below load-bearing for
 * this package in particular: both spellings now render inside ONE component
 * tree, so a limb that diverged would show up as a tab and the region that
 * contains it disagreeing about the same authored map.
 *
 * Two functions over ONE vocabulary is exactly the drift the ruling names. The
 * harm is not a crash: it is the same authored map rendering one locale on the
 * runtime dashboard and a different one in the designer's preview of that same
 * dashboard, with every type and every other test still green. Nothing else in
 * either repo compares them, so this file is the comparison.
 *
 * ## What is asserted
 *
 * The six limbs of the rule, in order — exact tag, base language, a regional
 * key sharing the base, `default`, `en`, then any entry — plus the pass-through
 * and empty-map edges, each asserted on BOTH functions from one table. A limb
 * that changes on one side and not the other fails here rather than in a
 * screenshot.
 *
 * The ONE remaining difference is normalized explicitly rather than hidden:
 * the spec's resolver reports a miss as `undefined` (so a caller's `?? name`
 * fallback chain can proceed), `pickLocalized` reports it as `''` (so a text
 * node renders nothing). `specForRender` states that conversion in one place;
 * if the two ever disagree about anything else, the table row fails.
 *
 * ## The two RULE divergences are gone as of objectui#3907
 *
 * They are recorded here because this file is where the claim "one difference"
 * has to stay true. `resolveI18nLabel` shipped (objectstack#6765) with two
 * documented departures from `pickLocalized`, both narrowings: it read **own
 * properties only**, and it applied the `typeof === 'string'` filter on **every**
 * limb rather than only on limbs 3 and 6. Neither was reachable by an input
 * `I18nLabelSchema` accepts, so both were filed as an observation
 * (objectui#3907) instead of a defect.
 *
 * objectui#3907 landed the same two guards in `pickLocalized`, so the rule
 * divergence is now **zero** and the surviving difference is purely the
 * miss SPELLING above — a return-shape choice each side's callers need, not a
 * disagreement about which entry to pick. The convergence is asserted, not
 * asserted-in-prose: `CONVERGED` below carries the exact vectors that used to
 * tell the two implementations apart, and every one of them is now answered
 * identically. If either side regresses, those rows fail here.
 */

import { describe, it, expect } from 'vitest';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import { pickLocalized } from '@object-ui/i18n';

/**
 * The spec resolver's answer, in the spelling a render site needs.
 *
 * This `?? ''` is the whole of the permitted difference — see the header. It is
 * written here, once, so that every other disagreement is a failure.
 */
function specForRender(label: unknown, locale: string | undefined): string {
  return resolveI18nLabel(label as never, locale) ?? '';
}

/** `[what the author wrote, the viewer's locale, the string both must produce]` */
const TABLE: ReadonlyArray<readonly [unknown, string | undefined, string]> = [
  // Pass-through: a plain string is not a map and never becomes one.
  ['Pipeline', 'zh-CN', 'Pipeline'],
  ['Pipeline', undefined, 'Pipeline'],
  // An authored empty string is a label the author wrote, not a miss.
  ['', 'en', ''],

  // Limb 1 — the exact BCP-47 tag wins.
  [{ en: 'Sales', 'zh-CN': '销售' }, 'zh-CN', '销售'],
  [{ en: 'Sales', 'zh-CN': '销售' }, 'en', 'Sales'],
  // …including when the tag arrives padded, which both sides trim.
  [{ en: 'Sales', 'zh-CN': '销售' }, ' zh-CN ', '销售'],

  // Limb 2 — the base language, when the author wrote the bare code.
  [{ en: 'Sales', zh: '销售' }, 'zh-CN', '销售'],
  // …and it outranks limb 3, so a bare key beats a regional sibling.
  [{ zh: '基础', 'zh-CN': '区域' }, 'zh', '基础'],

  // Limb 3 — a regional key sharing the base, when neither exact nor base hit.
  [{ en: 'Sales', 'zh-CN': '销售' }, 'zh', '销售'],
  [{ en: 'Sales', 'zh-CN': '销售' }, 'zh-TW', '销售'],
  [{ 'pt-BR': 'Vendas' }, 'pt-PT', 'Vendas'],

  // Limb 4 — `default` outranks `en`.
  [{ default: 'Default', en: 'English' }, 'fr', 'Default'],

  // Limb 5 — `en`, the platform's source language.
  [{ en: 'Sales', ja: '営業' }, 'fr', 'Sales'],
  // …which is also what "no locale known" resolves to.
  [{ en: 'Sales', 'zh-CN': '销售' }, undefined, 'Sales'],

  // Limb 6 — any entry, rather than nothing, when the map names none of the above.
  [{ ja: '営業' }, 'fr', '営業'],

  // A map with no usable entry is a miss on both sides (see `specForRender`).
  [{}, 'en', ''],
];

/**
 * The vectors that used to separate the two implementations (objectui#3907).
 *
 * Every row here is OUT of the declared domain — no BCP-47 tag is an
 * `Object.prototype` member, and `InlineLocaleMapSchema` is
 * `z.record(<tag>, z.string())` so no in-contract map holds a non-string value.
 * That is exactly why they are worth pinning separately from `TABLE`: they are
 * the only inputs that could ever have told the two ends apart, so they are the
 * only rows whose agreement is evidence rather than restatement.
 *
 * Note the expected answers are NOT `''`. A prototype-named locale, or an
 * off-spec value, makes that LIMB miss — it does not abort the resolution. The
 * chain continues to the next limb, so these resolve by the ordinary rule.
 */
const CONVERGED: ReadonlyArray<readonly [unknown, string | undefined, string]> = [
  // Own properties only — the locale names an `Object.prototype` member, so the
  // limb misses and `en` (limb 5) answers. Before #3907 the objectui side
  // returned the member's source text, e.g. 'function Object() { [native code] }'.
  [{ en: 'Sales' }, 'constructor', 'Sales'],
  [{ en: 'Sales' }, 'toString', 'Sales'],
  [{ en: 'Sales' }, 'valueOf', 'Sales'],
  [{ en: 'Sales' }, 'hasOwnProperty', 'Sales'],
  [{ en: 'Sales' }, 'isPrototypeOf', 'Sales'],
  [{ en: 'Sales' }, 'propertyIsEnumerable', 'Sales'],
  [{ en: 'Sales' }, 'toLocaleString', 'Sales'],
  // …and with no `en`, the last-resort limb answers instead. Only a map with
  // nothing usable resolves to the miss.
  [{ ja: '営業' }, 'constructor', '営業'],
  [{}, 'constructor', ''],
  // An own key really named like a prototype member is still the author's key:
  // the guard is `hasOwnProperty`, not a denylist of names.
  [{ constructor: 'Ctor', en: 'Sales' }, 'constructor', 'Ctor'],

  // `string` values only, on every limb — an off-spec value is treated as
  // absent. Before #3907 the objectui side short-circuited on limbs 1/2/4/5 and
  // rendered '[object Object]'.
  [{ 'zh-CN': { nested: 'x' }, en: 'Sales' }, 'zh-CN', 'Sales'], // limb 1
  [{ zh: { nested: 'x' }, en: 'Sales' }, 'zh-CN', 'Sales'], // limb 2
  [{ default: { nested: 'x' }, ja: '営業' }, 'fr', '営業'], // limb 4
  [{ en: { nested: 'x' }, ja: '営業' }, 'fr', '営業'], // limb 5
  [{ en: 42, ja: '営業' }, 'fr', '営業'],
  [{ en: null, ja: '営業' }, 'fr', '営業'],
  // Nothing usable anywhere is a miss on both sides.
  [{ en: { nested: 'x' } }, 'fr', ''],
  // The boundary the value filter must not cross: `''` is a string, so the limb
  // HITS and the chain stops. A truthiness filter would pass every row above
  // and break this one.
  [{ en: '', 'zh-CN': '销售' }, 'en', ''],
];

describe('inline per-locale label resolution agrees across both resolvers (#4163)', () => {
  it.each(TABLE)(
    'resolves %j at locale %j to %j identically',
    (label, locale, expected) => {
      expect(pickLocalized(label, locale)).toBe(expected);
      expect(specForRender(label, locale)).toBe(expected);
    },
  );

  it('reports a miss in each side\'s own documented spelling', () => {
    // The permitted difference, pinned in BOTH directions so that neither side
    // "fixing" it to match the other passes silently: `app-shell`'s
    // `?? param.name` fallback chain depends on the spec's `undefined`, and the
    // plugin text nodes depend on `pickLocalized`'s `''`.
    expect(resolveI18nLabel({} as never, 'en')).toBeUndefined();
    expect(pickLocalized({}, 'en')).toBe('');
    expect(resolveI18nLabel(undefined, 'en')).toBeUndefined();
    expect(pickLocalized(undefined, 'en')).toBe('');
  });

  it.each(CONVERGED)(
    'agrees on %j at locale %j (the objectui#3907 convergence)',
    (label, locale, expected) => {
      expect(pickLocalized(label, locale)).toBe(expected);
      expect(specForRender(label, locale)).toBe(expected);
    },
  );

  it('has no rule divergence left — only the miss spelling differs (objectui#3907)', () => {
    // The whole claim of this file in one pass, over BOTH tables. Before #3907
    // the `CONVERGED` rows disagreed; the header's "one difference" is only
    // true while this stays empty.
    const disagreements = [...TABLE, ...CONVERGED]
      .filter(([label, locale]) => pickLocalized(label, locale) !== specForRender(label, locale))
      .map(([label, locale]) => `${JSON.stringify(label)} @ ${String(locale)}`);
    expect(disagreements).toEqual([]);
  });

  it('neither resolver ever hands a text node the stringified object', () => {
    // The harm #4163 exists for, stated once over the whole table rather than
    // per site — a resolver that started returning the map would satisfy no
    // assertion above but would also fail none of them for an untabled input.
    for (const [label, locale] of [...TABLE, ...CONVERGED]) {
      expect(pickLocalized(label, locale)).not.toBe('[object Object]');
      expect(specForRender(label, locale)).not.toBe('[object Object]');
    }
  });

  it('neither resolver ever hands a text node a function body', () => {
    // The other half of the same harm, and the one objectui#3907 fixed: a
    // locale that names an `Object.prototype` member used to render that
    // member's SOURCE TEXT as the label on the objectui side.
    for (const [label, locale] of [...TABLE, ...CONVERGED]) {
      expect(pickLocalized(label, locale)).not.toContain('native code');
      expect(specForRender(label, locale)).not.toContain('native code');
    }
  });
});
