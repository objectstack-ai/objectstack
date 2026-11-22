// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The authoring box of a translatable label — a report's name, a dashboard
 * widget's title — read and written in the CURRENT language.
 *
 * The editors edit the authored buffer, which the server does not translate:
 * a plain-string label is the package's default-language literal, and its
 * other languages live in the translation bundle the server applies where it
 * serves the document (`translateReport`, `translateDashboard`). So a box that
 * shows the buffer shows a zh-CN admin the English source, while the page
 * beside it reads in Chinese.
 *
 * A {@link ServedLabelPair} carries the two readings of one label: as the
 * published layer authors it and as the server serves it in this session's
 * language. The rules:
 *
 *  - SHOW the served text while the buffer still holds the authored value the
 *    server translated (the same comparison `servedDashboardText.ts` makes);
 *    otherwise show the buffer in the session language.
 *  - WRITE an edit to the session language only. When the box was showing a
 *    translation of a plain-string label, the label becomes the inline locale
 *    map `{ default: SOURCE, LANG: EDIT }`: the source text stays byte-identical
 *    for every other language. A map label, or a box that showed the source
 *    itself, writes through `setLocalized` as before.
 *
 * Whether the stored entry is what the page then serves is the server's call,
 * and it is not always yes (`translateReport`, `translateDashboard`; pinned in
 * `packages/spec/src/system/i18n-report.test.ts`):
 *
 *  - an item installed from a package (one with a packaged base): the entry
 *    beats the base's translation, and a translation the paired `.custom`
 *    package ships for that language still answers ahead of it;
 *  - an item with no packaged base: the bundle answers ahead of the entry, so
 *    where the bundle has a translation for this language the box shows that
 *    translation again after save. The panel does not say so yet — an owed
 *    follow-up (L2 7078881267 S2), not a rule.
 *
 * ⛔ The served text is never written back as the source: an untouched box
 * commits nothing, and an edit lands in its own language's entry.
 */

import type { I18nLabel } from '@objectstack/spec/ui';
import { pickLocalized, setLocalized, clearLocalized, useObjectTranslation } from '@object-ui/i18n';
import { sameLabel } from '../../studio-design/servedNavText.js';
import { designerLocaleOf, type SupportedLocale } from '../i18n.js';

/**
 * The language a label box reads and writes in: the session's own tag
 * (`ja-JP`, `zh-CN`), the one the served text beside the panel is in. The
 * designer locale only names the chrome's catalogue (`en-US` for a ja-JP
 * session), so it is the answer only where the session's tag does not map
 * onto it — a host with no i18n instance, which hands a locale in directly.
 */
export function useLabelLanguage(locale: SupportedLocale | string | undefined): string {
  const { language } = useObjectTranslation();
  const designer = locale ?? 'en-US';
  return language && designerLocaleOf(language) === designer ? language : designer;
}

/** One label as the published layer authors it, and as the server serves it now. */
export interface ServedLabelPair {
  authored: I18nLabel | undefined;
  served: I18nLabel | undefined;
}

function asLabel(value: unknown): I18nLabel | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as I18nLabel;
  return undefined;
}

/**
 * The served text the box should show for `current`, or `undefined` when the
 * buffer's own text is what it shows: no pair, an edited buffer, or a served
 * text that is the source itself.
 */
function servedTranslation(
  current: unknown,
  pair: ServedLabelPair | null | undefined,
  language: string,
): string | undefined {
  if (!pair || pair.served === undefined) return undefined;
  if (!sameLabel(asLabel(current), pair.authored)) return undefined;
  const served = pickLocalized(pair.served, language);
  if (!served) return undefined;
  return served === pickLocalized(current, language) ? undefined : served;
}

/** The text a label's authoring box shows in `language`. */
export function shownLabel(
  current: unknown,
  pair: ServedLabelPair | null | undefined,
  language: string,
): string {
  return servedTranslation(current, pair, language) ?? pickLocalized(current, language);
}

/**
 * The label an edit typed into that box stores. `next === ''` is the clear:
 * it removes this language's entry where one exists, and otherwise leaves the
 * label as it is (a translation borrowed from the bundle has no entry to
 * clear). `emptyAs` is how the caller's key spells "nothing left" — `''` for a
 * required label, `undefined` for an optional one.
 */
export function writtenLabel(
  current: unknown,
  pair: ServedLabelPair | null | undefined,
  language: string,
  next: string,
  emptyAs: '' | undefined,
): I18nLabel | undefined {
  const translated = servedTranslation(current, pair, language) !== undefined;
  if (next === '') {
    if (translated) return asLabel(current);
    return (clearLocalized(current, language) as I18nLabel | undefined) ?? emptyAs;
  }
  if (translated && typeof current === 'string') {
    return setLocalized({ default: current }, language, next) as I18nLabel;
  }
  return setLocalized(current, language, next) as I18nLabel;
}
