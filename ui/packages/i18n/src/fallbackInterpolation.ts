/**
 * The ONE interpolator every provider-less translation path in this package
 * runs — extracted so there is exactly one of it (objectui#6219).
 *
 * ## Why this module exists at all
 *
 * Three things can render a translation in this repo, and each has its own
 * answer to "does a `{{hole}}` get filled?":
 *
 *   1. **i18next, with an `I18nProvider` mounted.** It interpolates. This is
 *      the reference behaviour every other path has to agree with.
 *   2. **`createSafeTranslation`'s `fallbackT`** (`useSafeTranslation.ts`).
 *      It interpolates — with the exact literal needle below.
 *   3. **react-i18next's not-ready `t`**, which is what a bare
 *      `useObjectTranslation()` yields when no i18next instance is initialised.
 *      Measured in `react-i18next@17.0.11/dist/es/useTranslation.js`:
 *      `notReadyT` returns `options.defaultValue` VERBATIM and does not
 *      interpolate at all.
 *
 * (3) was objectui#6219: 68 inline defaults across 24 files carried a
 * `{{hole}}` that reached the user as literal braces on any host that embeds an
 * ObjectUI component without `I18nProvider` — the configuration
 * `createSafeTranslation` exists for (objectui#3865), so a supported one.
 * `useObjectTranslation` now runs its not-ready result through this function,
 * which makes (3) agree with (2), and (2) already agrees with (1) for the one
 * spelling this repo is allowed to author.
 *
 * ## Why one shared function rather than a second copy
 *
 * The semantics below are pinned in three places at once —
 * `useSafeTranslation.test.tsx` (behaviour), `fallback-placeholder-spelling-3512.test.ts`
 * (the copy is held to what this can resolve) and
 * `scripts/check-i18n-call-site-keys.mjs` class 7 (the same rule over inline
 * defaults). A second interpolator with its own drift would have made all three
 * of those true of one path and quietly false of the other. There is one
 * function, so "the fallback resolves only `{{name}}`" is one fact.
 *
 * ## The exact spelling, and why only that one
 *
 * objectui#3512 measured that i18next additionally accepts `{{ name }}`,
 * `{{count, number}}`, `{{- name}}` and `$t(key)`, and the ruling was
 * deliberately NOT to teach the fallback three more dialects (a second
 * interpolator to keep in step with i18next forever) but to hold the copy to
 * the one spelling both paths agree on — enforced by the two gates named above.
 * This module keeps that ruling: it widens WHICH BINDINGS interpolate, never
 * WHICH SPELLINGS resolve.
 */

/**
 * The i18next option that names the string to use when the lookup misses.
 *
 * It is a LOOKUP CONTROL, not interpolation data (objectui#3865): it chooses
 * which string is rendered, so it must never also be spliced into a
 * `{{defaultValue}}` hole in the string it chose — or in any other.
 */
export const DEFAULT_VALUE_OPTION = 'defaultValue';

/**
 * Fill `{{name}}` holes in `value` from `options`, i18next-compatibly.
 *
 * Returns `value` untouched when there is nothing to fill from, so a caller can
 * hand it every result unconditionally.
 *
 * @param value - The string that was chosen for rendering.
 * @param options - The `t()` call's options object, or `undefined`.
 */
export function interpolateFallback(
  value: string,
  options?: Record<string, unknown>,
): string {
  if (!options) return value;
  let out = value;
  for (const [k, v] of Object.entries(options)) {
    // Reserved: see DEFAULT_VALUE_OPTION. Skipped whatever its type, so an
    // ignored non-string default cannot re-enter through this loop.
    //
    // This is the one deliberate divergence from i18next on this path, and it
    // is unreachable with today's strings: i18next passes the whole options
    // object to its interpolator, so it WOULD render
    // `'Fallback: {{defaultValue}}'` as `'Fallback: INLINE'` (measured on
    // 26.3.6) — but no value in this repo spells that hole (zero hits for
    // `{{defaultValue` across packages/apps/examples), and splicing a fallback
    // string into a hole named after itself has no sensible reading. The
    // alternative — letting a call site's fallback text leak into an unrelated
    // table value — is the worse of the two.
    if (k === DEFAULT_VALUE_OPTION) continue;
    // `split(needle).join(value)` — deliberately not `replace`, and not
    // `replaceAll` either (objectui#3418). This path must agree with i18next,
    // which serves the *provider* path; any divergence is a silent fork that
    // only shows up on provider-less hosts, where we are least likely to see
    // it:
    //   1. `replace` with a string needle substitutes only the FIRST
    //      occurrence. i18next substitutes every one, so a sentence that
    //      repeats a placeholder ("Selected {{count}} of {{count}} items" —
    //      natural in many locales, and often required by RTL / agglutinative
    //      word order) leaked literal braces to users.
    //   2. `replace` AND `replaceAll` both interpret `$&`, `` $` ``, `$'` and
    //      `$$` in the *replacement* string. i18next does not. Values here are
    //      runtime data — record labels, search terms — so this one is
    //      reachable today, unlike (1).
    // split/join is literal on both sides, which is exactly i18next's
    // behaviour, and needs no regex escaping of the placeholder name.
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
}

/**
 * The options object of a `t()` call, or `undefined` when the call passed none.
 *
 * i18next's `t` accepts both `t(key, options)` and `t(key, defaultValue,
 * options)`, so the options object is the LAST argument when it is an object at
 * all. A string second argument is a default value, not data — there is nothing
 * to interpolate from, which is why `t(key, 'Hi {{name}}')` keeps its braces on
 * both paths.
 *
 * Arrays are excluded deliberately: `t(key, [...])` is not an i18next options
 * shape, and `Object.entries` over one would mint `{{0}}`-style needles that no
 * copy in this repo spells.
 */
export function optionsOf(args: readonly unknown[]): Record<string, unknown> | undefined {
  if (args.length < 2) return undefined;
  const last = args[args.length - 1];
  if (typeof last !== 'object' || last === null || Array.isArray(last)) return undefined;
  return last as Record<string, unknown>;
}
