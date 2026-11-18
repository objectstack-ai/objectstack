// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35061 — the one character a row shows in the rail's narrow form:
 * the first character of its name (a whole grapheme, so an emoji or an accented
 * letter stays one), upper-cased in the display locale. Empty for a blank name.
 * Pure + exported for tests.
 */
export function railAbbreviation(name: string | undefined, locale: string): string {
  const text = name?.trim() ?? '';
  if (!text) return '';
  // Typed here as `romanizeHan.ts` types it: the package's `lib` predates `Intl.Segmenter`.
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenterCtor }).Segmenter;
  const first = Segmenter
    ? new Segmenter(locale, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]().next().value?.segment
    : undefined;
  return (first ?? Array.from(text)[0] ?? '').toLocaleUpperCase(locale);
}

type GraphemeSegmenterCtor = new (
  locale: string,
  options: { granularity: 'grapheme' },
) => { segment: (input: string) => Iterable<{ segment: string }> };
