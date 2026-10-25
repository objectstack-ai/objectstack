/**
 * Utility functions for ObjectStack Console
 */

/**
 * Resolves objectui's KEYED i18n label (`{ key, defaultValue?, params? }`) to a
 * plain string.
 *
 * When a `t` function is provided the key is resolved through the i18n
 * translation system; otherwise `defaultValue`, then the key itself. NOT the
 * spec's `resolveI18nLabel`, which resolves the INLINE per-locale map form —
 * see `packages/react/src/utils/i18n.ts` for why the names diverge
 * (objectui#4167).
 */
export function resolveKeyedI18nLabel(
  label: string | { key: string; defaultValue?: string; params?: Record<string, any> } | undefined,
  t?: (key: string, options?: any) => string,
): string | undefined {
  if (label === undefined || label === null) return undefined;
  if (typeof label === 'string') return label;
  if (t) {
    const result = t(label.key, { defaultValue: label.defaultValue, ...label.params });
    if (result && result !== label.key) return result;
  }
  return label.defaultValue || label.key;
}

/**
 * Capitalize the first letter of a string.
 * Preferred over CSS `capitalize` for i18n compatibility.
 */
export function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// `formatRecordTitle` / `getRecordDisplayName` (a pre-ADR-0079 divergent
// resolver pair, ~6 of which existed across surfaces) were removed here as
// dead code (objectui#6558) — zero console importers, and their presence
// re-armed the exact trap ADR-0079 closed: a same-named, same-signature
// resolver one import away that ignores `nameField`/`displayNameField` and
// ranks the legacy `titleFormat` template first. Console surfaces that need
// a record title use the unified `@object-ui/core#getRecordDisplayName`
// (and `formatTitleTemplate`), which the console already depends on.
