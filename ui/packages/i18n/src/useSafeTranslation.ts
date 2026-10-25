/**
 * Safe translation hook with fallback to default strings.
 *
 * When no I18nProvider is available (e.g., in tests or standalone usage),
 * this hook falls back to the provided default translations instead of
 * returning raw i18n keys — and, for a key the `defaults` map does not carry,
 * to the call site's own inline `t(key, { defaultValue })` (objectui#3865).
 * The lookup order is i18next's, so a provider-less host and a provider-mounted
 * one render the same string: `defaults[key_<category>]` for a numeric `count`
 * (objectui#11445), then `defaults[key]` (the pack value's stand-in here)
 * -> `defaultValue` -> the key.
 *
 * @param defaults - Fallback English translations keyed by i18n key
 * @param testKey - A key to test if i18n is properly configured (must be in defaults)
 */
import { useObjectTranslation } from './provider.js';
import { DEFAULT_VALUE_OPTION, interpolateFallback } from './fallbackInterpolation.js';

/**
 * The plural rules the defaults tables are written in. Every table is English
 * (the `en` pack's stand-in), so English selects the slot.
 */
const DEFAULTS_PLURAL_RULES = new Intl.PluralRules('en');

/**
 * The `defaults` row a count family answers from, the way i18next walks a pack
 * (objectui#11445): `key_<category>` first, then the base `key`.
 *
 * i18next plural-selects only for a NUMERIC `count` (`needsPluralHandling` in
 * i18next 26 is `count !== undefined && !isString(count)`), so a string count
 * reads the base row on both paths. `_zero` is not looked up: no English row
 * spells one, because `en` selects no `zero` category.
 */
function defaultsRowFor(
  defaults: Record<string, string>,
  key: string,
  options: Record<string, unknown> | undefined,
): string | undefined {
  const count = options?.count;
  if (typeof count === 'number' && Number.isFinite(count)) {
    const slot = defaults[`${key}_${DEFAULTS_PLURAL_RULES.select(count)}`];
    if (slot) return slot;
  }
  return defaults[key];
}

export function createSafeTranslation(
  defaults: Record<string, string>,
  testKey: string,
) {
  // Factory-level fallback: one stable reference per defaults map, so
  // downstream useMemo/useCallback deps don't invalidate every render in
  // the no-translations case.
  const fallbackT = (key: string, options?: Record<string, unknown>) => {
    // Lookup order: defaults table -> inline `defaultValue` -> the key itself
    // (objectui#3865). The table is the pack value's stand-in on this path, so
    // it takes the pack's position in i18next's own order — verified against a
    // real i18next 26.3.6 instance configured the way `createI18n` configures
    // it: `t('anchor', { defaultValue: 'INLINE' })` is the pack's `'Anchor
    // value'`, `t('missing', { defaultValue: 'INLINE' })` is `'INLINE'`, and
    // `t('missing')` is `'missing'`.
    //
    // Before this, the inline default was DEAD on both paths for every
    // component behind this factory: the provider path never reaches it
    // (the pack value always wins), and this path did not read it at all —
    // it rendered the raw key and then treated `defaultValue` as one more
    // interpolation variable. A census over all 26 `createSafeTranslation`
    // hooks measured 27 keys whose table lacks them, 21 of those carrying an
    // inline default that used to be dropped (objectui#3865; the fact is
    // recorded on objectui#3810, whose option C rests on it).
    //
    // Non-strings are ignored rather than coerced — this function returns a
    // `string`, and i18next itself declines a `null` default. `||` (not `??`)
    // keeps the whole chain consistent with the pre-existing `defaults[key] ||`
    // step: an empty string at any position falls through to the next.
    //
    // A count family's suffixed rows are reached here too (objectui#11445):
    // `t('detail.replyCount', { count: 3 })` reads `detail.replyCount_other`
    // before the base row, exactly as i18next reads the `en` pack. Before that
    // card a family's `_one` / `_other` rows were unreachable on this path, so
    // the code-selected `xxxCountOne` pairs were the only way a provider-less
    // host rendered "1 reply" — the card retired those pairs.
    const inlineDefault = options?.[DEFAULT_VALUE_OPTION];
    let value =
      defaultsRowFor(defaults, key, options) ||
      (typeof inlineDefault === 'string' ? inlineDefault : '') ||
      key;
    // The interpolation itself lives in `fallbackInterpolation.ts` — ONE
    // function, shared with `useObjectTranslation`'s not-ready path
    // (objectui#6219). Both provider-less renderers therefore fill exactly
    // the `{{name}}` spelling objectui#3512 holds the copy to, and the
    // reserved-name rule for `defaultValue` (objectui#3865) is stated once.
    // The behaviour pinned by `useSafeTranslation.test.tsx` is unchanged.
    value = interpolateFallback(value, options);
    return value;
  };

  return function useSafeTranslation() {
    // No try/catch around the hook: useObjectTranslation is provider-safe
    // (optional context read + react-i18next global-instance fallback), and
    // wrapping a hook call in try/catch violates rules-of-hooks — a throw
    // after the hook ran would desync hook order on the next render (same
    // fix as objectui#2595/#2596; this factory closure just escaped the
    // static lint). The testKey probe below carries the actual
    // "translations not configured" fallback.
    const result = useObjectTranslation();
    const testValue = result.t(testKey);
    // `language` is surfaced so consumers that localize dates/numbers
    // alongside their copy (data-table, gantt) don't have to call
    // `useObjectTranslation` a second time just to read it. With no provider
    // it is whatever react-i18next reports, which callers may treat as
    // "follow the runtime default".
    if (testValue === testKey) {
      return { t: fallbackT, language: result.language };
    }
    return { t: result.t, language: result.language };
  };
}

/**
 * Per-call graceful translate hook for plugin renderers.
 *
 * Returns `t(keyOrKeys, fallback)`: tries each i18n key in order and returns the
 * first real translation; when no `I18nProvider` is mounted (tests / standalone)
 * or every key is missing, returns the English `fallback` — never a raw key.
 *
 * Unlike {@link createSafeTranslation} (a factory keyed by a defaults map), this
 * takes the English default at each call site, which suits one-off labels like
 * "Total". The key-array form supports a migration fallback chain, e.g.
 * `tt(['common.total', 'dashboard.total'], 'Total')`.
 */
export function useSafeTranslate(): (keyOrKeys: string | string[], fallback: string) => string {
  // Unconditional hook call (rules-of-hooks) — the hook is provider-safe,
  // and a missing translation surfaces as `t(key) === key` per key below,
  // never as a throw. Same fix as createSafeTranslation above.
  const { t } = useObjectTranslation();
  return (keyOrKeys, fallback) => {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    for (const key of keys) {
      const v = t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  };
}
