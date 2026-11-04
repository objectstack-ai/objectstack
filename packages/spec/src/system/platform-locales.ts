// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// Ruling F of #29349, phase 1 of #29428 (card #30001): the table itself.

/**
 * The platform locale table: the one list of languages the platform
 * supports. Every language on it is complete on every surface (the Console
 * UI, platform metadata, the built-in emails), and there are no tiers.
 *
 * Adding or removing a language is a change to this table followed by one
 * backfill of every surface. A change that adds a translatable string adds it
 * for every language here in the same pull request.
 *
 * Order is authored: it is the order a language menu lists them in.
 *
 * Stored values written before the table existed (`zh-CN`, `ja-JP`, `es-ES`,
 * `en-US` and the like) keep resolving through
 * {@link PLATFORM_LOCALE_READ_ALIASES}; new writes use the table's tags.
 */
const ROWS = [
  { tag: 'en', label: 'English', rtl: false },
  { tag: 'zh-Hans', label: '简体中文', rtl: false },
  { tag: 'zh-Hant', label: '繁體中文', rtl: false },
  { tag: 'es', label: 'Español', rtl: false },
  { tag: 'ar', label: 'العربية', rtl: true },
  { tag: 'fr', label: 'Français', rtl: false },
  { tag: 'pt-BR', label: 'Português (Brasil)', rtl: false },
  { tag: 'ru', label: 'Русский', rtl: false },
  { tag: 'de', label: 'Deutsch', rtl: false },
  { tag: 'ja', label: '日本語', rtl: false },
  { tag: 'ko', label: '한국어', rtl: false },
] as const;

/** A tag on the platform locale table (`en`, `zh-Hans`, `pt-BR`, …). */
export type PlatformLocaleTag = (typeof ROWS)[number]['tag'];

/** One row of {@link PLATFORM_LOCALES}. */
export interface PlatformLocale {
  /** The BCP 47 tag, in its canonical case. */
  readonly tag: PlatformLocaleTag;
  /** The language's own name for itself, as a language menu shows it. */
  readonly label: string;
  /** Whether the language is written right to left. */
  readonly rtl: boolean;
}

/** The platform locale table, in menu order. Frozen, rows included. */
export const PLATFORM_LOCALES: readonly PlatformLocale[] = Object.freeze(
  ROWS.map((row): PlatformLocale => Object.freeze({ ...row })),
);

/** The table's tags, in table order. Frozen. */
export const PLATFORM_LOCALE_TAGS: readonly PlatformLocaleTag[] = Object.freeze(
  PLATFORM_LOCALES.map((row) => row.tag),
);

/**
 * Read aliases: a code that stored values already carry, mapped to the table
 * tag it means. Reads only: a new write uses the table tag itself.
 *
 * The list is closed. A code it does not name is not guessed at, so there is
 * no region fallback here (`pt-PT` is not `pt-BR`, `zh-Hans-CN` is not listed).
 * Frozen.
 */
export const PLATFORM_LOCALE_READ_ALIASES: Readonly<Record<string, PlatformLocaleTag>> = Object.freeze({
  zh: 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-SG': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'zh-HK': 'zh-Hant',
  'zh-MO': 'zh-Hant',
  'ja-JP': 'ja',
  'es-ES': 'es',
  pt: 'pt-BR',
  'en-US': 'en',
});

// Case-folded index over the table tags and the aliases. A Map, so a code
// such as `constructor` never reads an Object.prototype member.
const TAG_BY_FOLDED_CODE: ReadonlyMap<string, PlatformLocaleTag> = new Map<string, PlatformLocaleTag>([
  ...PLATFORM_LOCALE_TAGS.map((tag): [string, PlatformLocaleTag] => [tag.toLowerCase(), tag]),
  ...Object.entries(PLATFORM_LOCALE_READ_ALIASES).map(
    ([code, tag]): [string, PlatformLocaleTag] => [code.toLowerCase(), tag],
  ),
]);

/**
 * The table tag a stored locale code means, or `undefined`.
 *
 * A table tag answers itself and a read alias answers its target. Any other
 * code answers `undefined`: no region fallback is guessed.
 *
 * The match ignores case, because BCP 47 tags are case-insensitive
 * (RFC 5646 §2.1.1) and stored values are not all in canonical case: a user
 * locale saved as `zh-cn` means `zh-CN`. The same rule the bundle resolver
 * (`resolveBundleLocale`) applies. Nothing else is corrected: an underscore
 * (`zh_CN`), surrounding whitespace or a language name answers `undefined`.
 */
export function platformLocaleTagOf(code: unknown): PlatformLocaleTag | undefined {
  if (typeof code !== 'string') return undefined;
  return TAG_BY_FOLDED_CODE.get(code.toLowerCase());
}
