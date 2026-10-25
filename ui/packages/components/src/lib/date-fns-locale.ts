/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

/**
 * The date-fns `Locale` for the DISPLAY locale: the one shared place the
 * date-fns and react-day-picker faces get their locale from (objectui#10722).
 *
 * `useDisplayLocale()` (`@object-ui/i18n`) is what every date renderer formats
 * with, and it returns a BCP-47 TAG. `Intl` takes the tag as it is. date-fns
 * `format` and react-day-picker's `DayPicker` do not: they take a date-fns
 * `Locale` OBJECT, and with none they answer in `enUS`. So the two date
 * pickers' labels and every `Calendar`'s caption and weekday heads read English
 * under every display locale and every UI language. This module turns the tag
 * into the object.
 *
 * ## The tag is resolved against date-fns's own locale codes
 *
 * Each date-fns locale carries a `code` that is itself a BCP-47 tag (`de`,
 * `de-AT`, `zh-TW`, `sr-Latn`). So there is no mapping table: the tag is tried
 * as given, then with the region and the script that CLDR's likely subtags give
 * it (`Intl.Locale.prototype.maximize`), then as its bare language:
 *
 *   - `de-CH` has no locale of its own, so it reads `de`;
 *   - `en` maximizes to `en-Latn-US`, so it reads `en-US`: the `enUS` every
 *     face read before, which is why an English session reads exactly as it did;
 *   - `zh` maximizes to `zh-Hans-CN`, so it reads `zh-CN`;
 *   - `zh-Hant` maximizes to `zh-Hant-TW`, so it reads `zh-TW`.
 *
 * A tag date-fns has no locale for, and a malformed one, read `enUS`.
 *
 * ## A caller's own tag goes through the same chain
 *
 * A face that formats its other dates with a tag of its own (`CalendarView`'s
 * authored `locale`) hands that tag to `Calendar` as `localeTag`, and it is
 * resolved here, by the same chain, in place of the display locale
 * (objectui#10747). So there is still one resolver, and no caller outside this
 * package needs date-fns to reach it.
 *
 * ## Every locale is loaded lazily, one literal specifier each
 *
 * ⛔ Never collapse the loaders into `import(`date-fns/locale/${code}`)`. A
 * bare specifier with a variable in it cannot be resolved by a bundler, and a
 * relative one would be answered by emitting every file the pattern matches.
 * Each literal specifier below is one chunk the consuming app's bundler can
 * split out and fetch only when a session asks for it: `@object-ui/components`
 * keeps `date-fns` external, so no locale body is in its own `dist`. This is
 * the shape of `@object-ui/i18n`'s `locales/registry.ts` loaders, for the same
 * reason.
 *
 * The table is the locale entries of date-fns's `exports` map as of date-fns
 * 4.4.0. `enUS` is the one static import: `format` already reaches it as its
 * default locale, so it costs nothing, and it is the answer while any other
 * locale loads. A locale date-fns adds later is not reached until it gets a
 * line here; until then its tag falls down the chain above. What checks the
 * lines is `__tests__/date-fns-locale-10722.test.ts`: each one must load a
 * locale whose `code` is its key.
 *
 * ## While a locale loads, the face reads enUS
 *
 * The first render of a session whose locale is not loaded yet reads `enUS`,
 * and the face re-renders once the locale arrives. After that the locale is
 * held for the page's lifetime, so every later mount reads it on its first
 * render. A load that FAILS (a chunk that did not download) is not remembered:
 * the face keeps reading `enUS`, and the next mount tries again.
 */

import * as React from "react"
import type { Locale } from "date-fns"
import { enUS } from "date-fns/locale/en-US"
import { useDisplayLocale } from "@object-ui/i18n"

/** The key of the locale every face falls back to, and reads while loading. */
const FALLBACK_KEY = "en-US"

/**
 * One loader per date-fns locale except `en-US`, keyed by the locale's `code`.
 * ⛔ Read the header before touching the spelling.
 */
const DATE_LOCALE_LOADERS: Readonly<Record<string, () => Promise<Locale>>> = Object.freeze({
  af: () => import("date-fns/locale/af").then((m) => m.af),
  ar: () => import("date-fns/locale/ar").then((m) => m.ar),
  "ar-DZ": () => import("date-fns/locale/ar-DZ").then((m) => m.arDZ),
  "ar-EG": () => import("date-fns/locale/ar-EG").then((m) => m.arEG),
  "ar-MA": () => import("date-fns/locale/ar-MA").then((m) => m.arMA),
  "ar-SA": () => import("date-fns/locale/ar-SA").then((m) => m.arSA),
  "ar-TN": () => import("date-fns/locale/ar-TN").then((m) => m.arTN),
  az: () => import("date-fns/locale/az").then((m) => m.az),
  be: () => import("date-fns/locale/be").then((m) => m.be),
  "be-tarask": () => import("date-fns/locale/be-tarask").then((m) => m.beTarask),
  bg: () => import("date-fns/locale/bg").then((m) => m.bg),
  bn: () => import("date-fns/locale/bn").then((m) => m.bn),
  bs: () => import("date-fns/locale/bs").then((m) => m.bs),
  ca: () => import("date-fns/locale/ca").then((m) => m.ca),
  ckb: () => import("date-fns/locale/ckb").then((m) => m.ckb),
  cs: () => import("date-fns/locale/cs").then((m) => m.cs),
  cy: () => import("date-fns/locale/cy").then((m) => m.cy),
  da: () => import("date-fns/locale/da").then((m) => m.da),
  de: () => import("date-fns/locale/de").then((m) => m.de),
  "de-AT": () => import("date-fns/locale/de-AT").then((m) => m.deAT),
  el: () => import("date-fns/locale/el").then((m) => m.el),
  "en-AU": () => import("date-fns/locale/en-AU").then((m) => m.enAU),
  "en-CA": () => import("date-fns/locale/en-CA").then((m) => m.enCA),
  "en-GB": () => import("date-fns/locale/en-GB").then((m) => m.enGB),
  "en-IE": () => import("date-fns/locale/en-IE").then((m) => m.enIE),
  "en-IN": () => import("date-fns/locale/en-IN").then((m) => m.enIN),
  "en-NZ": () => import("date-fns/locale/en-NZ").then((m) => m.enNZ),
  "en-ZA": () => import("date-fns/locale/en-ZA").then((m) => m.enZA),
  eo: () => import("date-fns/locale/eo").then((m) => m.eo),
  es: () => import("date-fns/locale/es").then((m) => m.es),
  et: () => import("date-fns/locale/et").then((m) => m.et),
  eu: () => import("date-fns/locale/eu").then((m) => m.eu),
  "fa-IR": () => import("date-fns/locale/fa-IR").then((m) => m.faIR),
  fi: () => import("date-fns/locale/fi").then((m) => m.fi),
  fr: () => import("date-fns/locale/fr").then((m) => m.fr),
  "fr-CA": () => import("date-fns/locale/fr-CA").then((m) => m.frCA),
  "fr-CH": () => import("date-fns/locale/fr-CH").then((m) => m.frCH),
  fy: () => import("date-fns/locale/fy").then((m) => m.fy),
  gd: () => import("date-fns/locale/gd").then((m) => m.gd),
  gl: () => import("date-fns/locale/gl").then((m) => m.gl),
  gu: () => import("date-fns/locale/gu").then((m) => m.gu),
  he: () => import("date-fns/locale/he").then((m) => m.he),
  hi: () => import("date-fns/locale/hi").then((m) => m.hi),
  hr: () => import("date-fns/locale/hr").then((m) => m.hr),
  ht: () => import("date-fns/locale/ht").then((m) => m.ht),
  hu: () => import("date-fns/locale/hu").then((m) => m.hu),
  hy: () => import("date-fns/locale/hy").then((m) => m.hy),
  id: () => import("date-fns/locale/id").then((m) => m.id),
  is: () => import("date-fns/locale/is").then((m) => m.is),
  it: () => import("date-fns/locale/it").then((m) => m.it),
  "it-CH": () => import("date-fns/locale/it-CH").then((m) => m.itCH),
  ja: () => import("date-fns/locale/ja").then((m) => m.ja),
  "ja-Hira": () => import("date-fns/locale/ja-Hira").then((m) => m.jaHira),
  ka: () => import("date-fns/locale/ka").then((m) => m.ka),
  kk: () => import("date-fns/locale/kk").then((m) => m.kk),
  km: () => import("date-fns/locale/km").then((m) => m.km),
  kn: () => import("date-fns/locale/kn").then((m) => m.kn),
  ko: () => import("date-fns/locale/ko").then((m) => m.ko),
  lb: () => import("date-fns/locale/lb").then((m) => m.lb),
  lt: () => import("date-fns/locale/lt").then((m) => m.lt),
  lv: () => import("date-fns/locale/lv").then((m) => m.lv),
  mk: () => import("date-fns/locale/mk").then((m) => m.mk),
  mn: () => import("date-fns/locale/mn").then((m) => m.mn),
  ms: () => import("date-fns/locale/ms").then((m) => m.ms),
  mt: () => import("date-fns/locale/mt").then((m) => m.mt),
  nb: () => import("date-fns/locale/nb").then((m) => m.nb),
  nl: () => import("date-fns/locale/nl").then((m) => m.nl),
  "nl-BE": () => import("date-fns/locale/nl-BE").then((m) => m.nlBE),
  nn: () => import("date-fns/locale/nn").then((m) => m.nn),
  oc: () => import("date-fns/locale/oc").then((m) => m.oc),
  pl: () => import("date-fns/locale/pl").then((m) => m.pl),
  pt: () => import("date-fns/locale/pt").then((m) => m.pt),
  "pt-BR": () => import("date-fns/locale/pt-BR").then((m) => m.ptBR),
  ro: () => import("date-fns/locale/ro").then((m) => m.ro),
  ru: () => import("date-fns/locale/ru").then((m) => m.ru),
  se: () => import("date-fns/locale/se").then((m) => m.se),
  sk: () => import("date-fns/locale/sk").then((m) => m.sk),
  sl: () => import("date-fns/locale/sl").then((m) => m.sl),
  sq: () => import("date-fns/locale/sq").then((m) => m.sq),
  sr: () => import("date-fns/locale/sr").then((m) => m.sr),
  "sr-Latn": () => import("date-fns/locale/sr-Latn").then((m) => m.srLatn),
  sv: () => import("date-fns/locale/sv").then((m) => m.sv),
  ta: () => import("date-fns/locale/ta").then((m) => m.ta),
  te: () => import("date-fns/locale/te").then((m) => m.te),
  th: () => import("date-fns/locale/th").then((m) => m.th),
  tr: () => import("date-fns/locale/tr").then((m) => m.tr),
  ug: () => import("date-fns/locale/ug").then((m) => m.ug),
  uk: () => import("date-fns/locale/uk").then((m) => m.uk),
  uz: () => import("date-fns/locale/uz").then((m) => m.uz),
  "uz-Cyrl": () => import("date-fns/locale/uz-Cyrl").then((m) => m.uzCyrl),
  vi: () => import("date-fns/locale/vi").then((m) => m.vi),
  "zh-CN": () => import("date-fns/locale/zh-CN").then((m) => m.zhCN),
  "zh-HK": () => import("date-fns/locale/zh-HK").then((m) => m.zhHK),
  "zh-TW": () => import("date-fns/locale/zh-TW").then((m) => m.zhTW),
})

/** Every locale code this module can answer with: the loaders' keys, and `en-US`. */
export const DATE_LOCALE_KEYS: readonly string[] = Object.freeze([
  FALLBACK_KEY,
  ...Object.keys(DATE_LOCALE_LOADERS),
])

/** Locales resolved so far, by key. `enUS` is here from module evaluation. */
const loaded = new Map<string, Locale>([[FALLBACK_KEY, enUS]])

/** In-flight loads, so N faces asking for one locale share one fetch. */
const inFlight = new Map<string, Promise<Locale>>()

/** The key each tag resolved to, so the chain runs once per tag. */
const keyByTag = new Map<string, string>()

function hasLocale(key: string): boolean {
  return key === FALLBACK_KEY || Object.prototype.hasOwnProperty.call(DATE_LOCALE_LOADERS, key)
}

/**
 * The date-fns locale code a BCP-47 tag reads, by the chain in the header:
 * the tag as given, its language with the region, then with the script, that
 * `maximize()` gives it, then its bare language, then `en-US`.
 */
export function dateLocaleKeyFor(tag: string): string {
  const known = keyByTag.get(tag)
  if (known !== undefined) return known

  let key = FALLBACK_KEY
  try {
    const locale = new Intl.Locale(tag)
    const { language, script, region } = locale.maximize()
    const candidates = [
      locale.baseName,
      region ? `${language}-${region}` : undefined,
      script ? `${language}-${script}` : undefined,
      language,
    ]
    key = candidates.find((candidate): candidate is string => !!candidate && hasLocale(candidate)) ?? FALLBACK_KEY
  } catch {
    // `Intl.Locale` throws a RangeError on a malformed tag: that tag reads enUS.
  }
  keyByTag.set(tag, key)
  return key
}

/** The locale for `key` if it has been loaded, without loading it. */
export function loadedDateLocale(key: string): Locale | undefined {
  return loaded.get(key)
}

/**
 * Load the locale for `key`. Memoised: a loaded locale is returned without a
 * second import, and concurrent callers share one promise. ⛔ A rejected load
 * is not memoised, so a chunk that failed to download can be fetched again.
 */
export function loadDateLocale(key: string): Promise<Locale> {
  const resident = loaded.get(key)
  if (resident) return Promise.resolve(resident)
  const existing = inFlight.get(key)
  if (existing) return existing
  const loader = Object.prototype.hasOwnProperty.call(DATE_LOCALE_LOADERS, key)
    ? DATE_LOCALE_LOADERS[key]
    : undefined
  if (!loader) return Promise.resolve(enUS)
  const pending = loader()
    .then((locale) => {
      loaded.set(key, locale)
      return locale
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, pending)
  return pending
}

/**
 * `Calendar`'s input that names its locale as a BCP-47 TAG (objectui#10747).
 *
 * Declared here, beside the resolver it feeds, so the patch that adds it to the
 * No-Touch `ui/calendar.tsx` stays a one-line reference.
 */
export interface CalendarLocaleTagProps {
  /**
   * The BCP-47 tag this calendar's caption, weekday heads and week start read,
   * in place of the session's display locale: the tag a host already formats
   * its own dates with, such as `CalendarView`'s `effectiveLocale`. It is
   * resolved by the chain in this module's header, so `de-CH` reads date-fns
   * `de`, and a tag date-fns has no locale for, or a malformed one, reads
   * `enUS`. Absent, the calendar reads the display locale. A date-fns `locale`
   * object passed to `Calendar` still wins over both.
   */
  localeTag?: string
}

/**
 * The date-fns `Locale` for `tag`, or for the session's display locale when no
 * tag is given (objectui#10747): an explicit tag wins. It reads `enUS` until
 * that locale has loaded, then re-renders its caller with it.
 */
export function useDisplayDateLocale(tag?: string): Locale {
  const displayLocale = useDisplayLocale()
  const key = dateLocaleKeyFor(tag ?? displayLocale)
  const [, rerender] = React.useReducer((count: number) => count + 1, 0)
  const resident = loaded.get(key)

  React.useEffect(() => {
    if (loaded.has(key)) return
    let live = true
    loadDateLocale(key).then(
      () => {
        if (live) rerender()
      },
      () => {
        // The face keeps its enUS reading; the next mount retries the load.
      },
    )
    return () => {
      live = false
    }
  }, [key])

  return resident ?? enUS
}
