// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The options of `localization.locale` (Setup's 默认语言): the languages the
 * deployment supports, not a list written into the manifest.
 *
 * The manifest used to declare four (`en-US`, `zh-CN`, `ja-JP`, `es-ES`), and
 * that table was the enforcement boundary. The user's language menu offers
 * something else: what `GET /api/v1/i18n/locales` reports, which is the i18n
 * service's `getLocales()` (the app's declared `i18n.supportedLocales`, else
 * every locale a bundle or an authored translation item has loaded). So a
 * deployment with a French pack, or a Vietnamese translation item, offered
 * French or Vietnamese to each user and refused it as the organization's
 * default. This source makes both answers one: the options and the accepted
 * values are what `getLocales()` reports at the moment they are asked, so a
 * translation item added at runtime is offered here too.
 *
 * What it answers, for the i18n service's codes:
 *
 *  - **Options.** One per code, in the service's order, each named in its own
 *    language: the platform locale table's name for the language the code
 *    means (`PLATFORM_LOCALES`, through its read aliases, so `zh-CN` is
 *    简体中文), else `Intl.DisplayNames` in the code itself (`vi-VN` is
 *    "Tiếng Việt (Việt Nam)"), else the code. The language menu names them
 *    the same way.
 *  - **Accepted values.** Each code, and a second spelling of one: whatever
 *    `resolveOfferedLocale` (`@objectstack/core`) matches to an offered code,
 *    the one matcher the IdP locale claim uses too. That is another case
 *    (`zh-cn` for `zh-CN`), a code that means the same table language (`en-US`
 *    where `en` is offered, `zh-CN` where `zh-Hans` is), and a region or base
 *    of an offered language (`fr-FR` where `fr` is, `fr` where `fr-FR` is).
 *    The first two are the spellings this setting has stored all along, and
 *    its manifest default is `en-US`; the read aliases exist so that such
 *    values stay valid.
 *  - **A stored value in effect.** Offered under its own spelling when it is a
 *    second spelling of an offered code, so the page shows it selected; and,
 *    when the deployment no longer offers it, offered as itself, named as no
 *    longer offered, so the page shows what is in effect rather than a blank.
 *    It is not accepted again: only a write that changes the key is judged, so
 *    the stored value keeps reading and keeps working until someone picks
 *    another language.
 *
 * No i18n service in the composition, or one that reports no locale: the
 * source answers nothing and the manifest's declared four stand.
 */

import { resolveLocale, resolveOfferedLocale } from '@objectstack/core';
import { PLATFORM_LOCALES, platformLocaleTagOf } from '@objectstack/spec/system';
import type { SettingsOptionSource, SettingsServedOption } from './settings-service.types.js';

/** The i18n service surface this source reads: the locale list the language menu reads. */
export interface LocaleListService {
  getLocales(): readonly string[];
}

const TABLE_LABEL = new Map<string, string>(PLATFORM_LOCALES.map((row) => [row.tag, row.label]));

/**
 * A locale's name in its own language: the platform locale table's name for
 * the language the code means, else `Intl.DisplayNames` in the code itself,
 * capitalized as the table's names are, else the code. Every failure answers
 * the code, which is still an honest, selectable name: `Intl.DisplayNames`
 * may be absent, throws `RangeError` on a malformed tag, and names no language
 * its ICU data does not have.
 */
export function localeSelfName(code: string): string {
  const tag = platformLocaleTagOf(code);
  const fromTable = tag ? TABLE_LABEL.get(tag) : undefined;
  if (fromTable) return fromTable;
  try {
    // `fallback: 'none'`: a language the ICU data does not name answers
    // `undefined`, not a made-up name built from the subtags (`Xx (YY)`).
    const name = new Intl.DisplayNames([code], { type: 'language', fallback: 'none' }).of(code);
    if (!name || name === code) return code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

/** "no longer offered", in the reader's language. */
export const NOT_OFFERED_COPY: Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES', string> = {
  en: 'no longer offered',
  'zh-CN': '已不再提供',
  'ja-JP': '現在は提供されていません',
  'es-ES': 'ya no disponible',
};

const COPY_LOCALES = Object.keys(NOT_OFFERED_COPY);

/** The "no longer offered" words for a reader's locale: exact, then by language, else English. */
export function notOfferedCopy(locale: string | undefined): string {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return NOT_OFFERED_COPY[(picked ?? 'en') as keyof typeof NOT_OFFERED_COPY];
}

/** The locale codes the i18n service reports, de-duplicated, in its order. */
function offeredCodes(i18n: LocaleListService | undefined): string[] {
  const reported = i18n && typeof i18n.getLocales === 'function' ? i18n.getLocales() : undefined;
  if (!Array.isArray(reported)) return [];
  const seen = new Set<string>();
  for (const code of reported) {
    if (typeof code === 'string' && code.trim()) seen.add(code.trim());
  }
  return [...seen];
}

/**
 * The option source of `localization.locale`. `i18n` is asked at each use
 * (the i18n service registers after this plugin's `init`); it answers
 * `undefined` when the composition carries none.
 */
export function localizationLocaleOptionSource(
  i18n: () => LocaleListService | undefined,
): SettingsOptionSource {
  return ({ current, locale } = {}) => {
    const codes = offeredCodes(i18n());
    if (codes.length === 0) return undefined;

    const admits = (value: string): boolean => resolveOfferedLocale(value, codes) !== undefined;

    const options: SettingsServedOption[] = codes.map((code) => ({ value: code, label: localeSelfName(code) }));

    if (typeof current === 'string' && current.trim() && !codes.includes(current)) {
      const matched = resolveOfferedLocale(current, codes);
      const sameLanguage = matched === undefined ? -1 : codes.indexOf(matched);
      if (sameLanguage !== -1) {
        // Stored as a second spelling (`en-US` where `en` is offered): offer
        // that language under the stored spelling, so the page shows it chosen.
        options[sameLanguage] = { value: current, label: options[sameLanguage].label };
      } else {
        options.push({ value: current, label: `${localeSelfName(current)} (${notOfferedCopy(locale)})` });
      }
    }

    return { options, admits };
  };
}

/** The settings service surface {@link registerLocalizationLocaleOptions} needs. */
export interface LocaleOptionsHost {
  registerOptionSource(namespace: string, key: string, source: SettingsOptionSource): void;
}

/**
 * Serve `localization.locale`'s options from the i18n service. Called before
 * the manifest registers, so the manifest's registration-time audit of
 * `OS_LOCALIZATION_LOCALE` leaves the key to be judged when it is read.
 */
export function registerLocalizationLocaleOptions(
  host: LocaleOptionsHost,
  i18n: () => LocaleListService | undefined,
): void {
  host.registerOptionSource('localization', 'locale', localizationLocaleOptionSource(i18n));
}
