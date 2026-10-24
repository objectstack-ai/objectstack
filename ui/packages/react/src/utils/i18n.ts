import type { KeyedI18nLabel } from '@object-ui/types';

/**
 * Resolves objectui's KEYED i18n label to a plain string.
 *
 * The keyed form is `{ key, defaultValue?, params? }` — a reference INTO a
 * translation bundle. This package has no `t()`, so it resolves the reference
 * as far as it can without one: `defaultValue`, else the key itself. (The
 * app-shell twin of this function takes a `t` and resolves the key properly.)
 *
 * ## Why this is not called `resolveI18nLabel` (objectui#4167)
 *
 * `@objectstack/spec` 17.0.0-rc.6 publishes a function of that exact name from
 * `@objectstack/spec/ui`, over a DIFFERENT vocabulary: the INLINE LOCALE MAP
 * (`{ en: 'Owner', 'zh-CN': '负责人' }`), resolved against a BCP-47 locale
 * (`resolveI18nLabel(label, locale)`). Two resolvers, one name, and neither
 * accepts the other's shape — which objectstack#4115 calls a planted premise
 * rather than a naming nit, because the next agent reads the name and builds
 * on it.
 *
 * rc.6 is also what made the clash dangerous rather than merely untidy. It
 * widened the spec's `I18nLabel` from `string` to
 * `string | Record< string, string >`, so the SAME authored value can now reach
 * either function — and each answers wrongly for the other's input, silently:
 *
 *   this one, given `{ en: 'Owner' }`      → `undefined` (no `key`, no
 *                                            `defaultValue`) → renders empty;
 *   the spec's, given `{ key: 'nav.home' }` → treats `key`/`defaultValue`/
 *                                            `params` as locale tags and picks
 *                                            one of them as the display text.
 *
 * Neither is a type error at the call site that matters, and both look like a
 * working render until someone reads the output. PR #4169 met this head-on and
 * aliased the spec's import as `resolveInlineI18nLabel` in five files, with
 * hand-written comments explaining the clash at two of them — a review
 * convention, which is exactly what objectstack#4115 exists to replace with a
 * rule. `Keyed` is the counterpart of that `Inline`: the name now says which
 * vocabulary it resolves, at every call site, with no comment required.
 *
 * The keyed shape itself is now named too — `KeyedI18nLabel` in
 * `@object-ui/types` (#4581) — so `BaseSchema.ariaLabel`, this parameter and
 * the layout twin all state one type instead of three copies of one object
 * literal. The `Inline`/`Keyed` split above is the naming half of #4167; the
 * named shape is the declaration half.
 */
export function resolveKeyedI18nLabel(label: string | KeyedI18nLabel | undefined): string | undefined {
  if (label === undefined || label === null) return undefined;
  if (typeof label === 'string') return label;
  return label.defaultValue || label.key;
}
