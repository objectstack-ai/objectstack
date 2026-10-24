# @object-ui/i18n

Internationalization for Object UI — 10 built-in locales, RTL support, and date/currency formatting.

## Features

- 🌍 **10 Built-in Locales** - English, Chinese, Japanese, Korean, German, French, Spanish, Portuguese, Russian, Arabic
- 🔄 **RTL Support** - Automatic right-to-left layout for Arabic and other RTL languages
- 📅 **Date Formatting** - Locale-aware date, datetime, and relative time formatting
- 💰 **Currency & Number Formatting** - Locale-aware currency and number formatting
- 🎣 **React Hooks** - `useObjectTranslation` for translations, language switching, and direction
- 🏗️ **I18nProvider** - Context provider for internationalized applications
- 🪶 **Lazy catalogues** - only the active locale's catalogue is fetched; the other nine are separate chunks
- 🔌 **Extensible** - Add custom locales and translation keys
- 🎯 **Type-Safe** - Full TypeScript support with exported types

## Installation

```bash
npm install @object-ui/i18n
```

**Peer Dependencies:**
- `react` ^18.0.0 || ^19.0.0

## Quick Start

```tsx
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';

function App() {
  return (
    <I18nProvider config={{ defaultLanguage: 'en' }}>
      <MyComponent />
    </I18nProvider>
  );
}

function MyComponent() {
  const { t, language, changeLanguage, direction } = useObjectTranslation();

  return (
    <div dir={direction}>
      <h1>{t('common.save')}</h1>
      <button onClick={() => changeLanguage('zh')}>Chinese</button>
      <button onClick={() => changeLanguage('ar')}>العربية</button>
    </div>
  );
}
```

## API

### I18nProvider

Wraps your application with i18n context:

```tsx
import type { ReactNode } from 'react';
import { I18nProvider } from '@object-ui/i18n';

// Your app supplies the tree being wrapped.
declare const App: () => ReactNode;

<I18nProvider config={{ defaultLanguage: 'en', fallbackLanguage: 'en' }}>
  <App />
</I18nProvider>;
```

#### Language persistence

The active language is a **user preference**, so it survives a reload: every
language change is written to `localStorage` under `objectui-locale`
(`LOCALE_STORAGE_KEY`), and the provider boots the next session in that
language.

Precedence at bootstrap: **stored choice → browser language → `defaultLanguage`**.
An explicit choice outranks browser detection — otherwise a user who picked 中文
on a `ja` browser would be handed `ja` back on every reload. A stored value the
app no longer offers (not a built-in pack, not in `config.resources`) is ignored
*and purged*, so a stale entry can never lock the UI to a locale with no
translations. A region-tagged choice such as `zh-CN` is served by its base
language's built-in pack (`zh`), so it is kept, and kept as written: the
provider's `language`, `<html lang>` and the stored value all stay `zh-CN`.

```tsx
import type { ReactNode } from 'react';
import { I18nProvider } from '@object-ui/i18n';

declare const Preview: () => ReactNode;

// Fixed-language surfaces (previews, demos, screenshot harnesses) opt out —
// they neither restore nor write the preference.
<I18nProvider config={{ defaultLanguage: 'en' }} persistLanguage={false}>
  <Preview />
</I18nProvider>;
```

Bringing your own `instance`? Then its bootstrap language is yours to choose —
read the preference with `readStoredLanguage()` and pass it to `createI18n`.
Switching through such an instance is still persisted.

### useObjectTranslation

Hook for translations and language management:

```tsx
import { useObjectTranslation } from '@object-ui/i18n';

function LanguageBar() {
  const { t, language, changeLanguage, direction } = useObjectTranslation();

  return (
    <div dir={direction}>
      {t('common.save')} — {language}
      <button onClick={() => changeLanguage('zh')}>中文</button>
    </div>
  );
}
```

#### Count labels are i18next count families

A label a word must agree with — `3 replies`, `Approve 3 requests?` — is one
i18next count family: pass the number as `count` and let i18next pick the slot
`Intl.PluralRules` selects for the language. Every pack spells out each
category its language has (`en` `_one`/`_other`; `ru` adds `_few`/`_many`; `ar`
has all six), plus a count-invariant base key for a call made without a count.

```tsx
import { useObjectTranslation } from '@object-ui/i18n';

function ReplyCount({ replies }: { replies: readonly string[] }) {
  const { t } = useObjectTranslation();

  // "1 reply", "3 replies"; Russian «3 ответа», «5 ответов»
  return <span>{t('detail.replyCount', { count: replies.length })}</span>;
}
```

Pass `count` as a **number** — i18next selects a slot for nothing else — and
never choose the key yourself (`count === 1 ? 'xOne' : 'x'`): two keys give a
language two forms, and Russian needs three, Arabic five. A
`createSafeTranslation` defaults table answers the same way on a provider-less
host: it reads a family's `_one` / `_other` row for a numeric `count`, then the
base row. `count-families-11445.test.ts` holds every `{{count}}` value in the
ten packs to this rule.

### createI18n

Factory for creating an i18n instance outside React:

```tsx
import { createI18n } from '@object-ui/i18n';

const i18n = createI18n({ defaultLanguage: 'de' });
i18n.t('common.cancel'); // "Abbrechen"
```

### TranslateFn — typing a `t` you are handed

A helper that receives `t` from its caller, rather than calling a hook itself,
types that parameter with `TranslateFn`: i18next's `t` narrowed to
`(key: string, options?: Record<string, unknown>) => string`. This package is
the one authority for that type — import it rather than declaring a local
copy:

```ts
import type { TranslateFn } from '@object-ui/i18n';

export function saveLabel(t: TranslateFn): string {
  return t('common.save');
}
```

### Formatting Utilities

Locale-aware formatting functions:

Each formatter takes the value first and an **options object** second; the
locale is a field on that object (`DateFormatOptions`, `CurrencyFormatOptions`,
`NumberFormatOptions`), never a positional argument. `formatRelativeTime` is the
one exception: it takes the locale directly, and derives the unit from how far
the date is from now.

```tsx
import { formatDate, formatCurrency, formatNumber, formatRelativeTime } from '@object-ui/i18n';

formatDate(new Date(2025, 0, 1), { locale: 'en' });              // "Jan 1, 2025"
formatCurrency(99.99, { currency: 'USD', locale: 'en' });        // "$99.99"
formatNumber(1234567, { locale: 'de' });                         // "1.234.567"
formatRelativeTime(Date.now() - 3 * 86_400_000, 'en');           // "3 days ago"
```

A date-only string such as `'2026-09-01'` names a calendar day: every date
helper reads it as that day in every viewer's time zone (`formatDateTime` shows
its midnight, and `formatRelativeTime` counts to the start of it). A string
with a time part is an instant, read in the viewer's zone. `formatDateSpec`
applies its `timeZone` to an instant only. These helpers do not read the
display zone below; the field cells and measures format through
`@object-ui/core`'s date faces, which do.

### Regional defaults (`LocalizationProvider`)

`LocalizationProvider` carries the workspace's resolved regional defaults to
every renderer below it, and `useLocalization()` reads them (`{}` outside a
provider). The console fills it from `GET /api/v1/auth/me/localization`.

```tsx
import type { ReactNode } from 'react';
import { LocalizationProvider, useLocalization } from '@object-ui/i18n';

export function Regional({ children }: { children: ReactNode }) {
  return (
    <LocalizationProvider value={{ currency: 'EUR', locale: 'de-DE', timezone: 'Europe/Berlin' }}>
      {children}
    </LocalizationProvider>
  );
}

export function ZoneLabel() {
  const { timezone } = useLocalization();
  return <span>{timezone ?? 'viewer zone'}</span>;
}
```

- `currency` (ISO 4217) is the default a currency field without its own code
  renders in.
- `locale` (BCP-47) outranks the UI language for number and date formatting;
  read the effective tag with `useDisplayLocale()`.
- `timezone` (IANA) is the zone instants render in. The provider hands it to
  `setDisplayTimeZone` in `@object-ui/core`, so every date and datetime face
  takes it without any renderer passing a zone, and `useLocalization().timezone`
  reads back the zone those faces use (`undefined` for a name the runtime does
  not know). Without one, instants render in the viewer's zone. There is one
  display zone per page, and unmounting the provider clears it.

#### The first day of the week

`firstDayOfWeek(locale)` answers the first day of the week for a BCP-47 tag,
numbered as `Date.prototype.getDay` numbers weekdays (0 is Sunday), which is
also what react-day-picker's `weekStartsOn` takes. It reads the engine's
`Intl.Locale` week info, and CLDR's region table where the engine has none, so
a week grid or a "this week" bound starts where the user's locale says rather
than on a fixed day. There is no separate week-start setting: the tag is the
one the caller already formats its dates with, such as `useDisplayLocale()`.

```tsx
import { firstDayOfWeek, useDisplayLocale } from '@object-ui/i18n';

firstDayOfWeek('en-US'); // 0, Sunday
firstDayOfWeek('en-GB'); // 1, Monday
firstDayOfWeek('zh-CN'); // 1, Monday

function WeekHeader() {
  const weekStart = firstDayOfWeek(useDisplayLocale());
  // ...lay the week out from `weekStart`
}
```

A tag `Intl` refuses (`en_US`) throws the same `RangeError` that formatting a
date with it would.

### Built-in locales — one is resident, nine are fetched on demand

The package entry re-exports **`en` only**. It is `fallbackLng`, it is the
source of the `TranslationKeys` type, and it is the synchronous dictionary the
app-shell splash renders from before i18n is usable, so it has to be there
without awaiting anything. The other nine catalogues are separate chunks your
bundler emits once each and the browser fetches only when that locale is
actually used — roughly 400 KB gzipped that a page load no longer pays
(objectui#7479).

```tsx
import {
  en,                        // resident
  BUILT_IN_LANGUAGE_CODES,   // all ten codes, no catalogue payload
  isBuiltInLanguage,
  loadBuiltInLocale,         // fetch one: Promise<catalogue | null>
  getLoadedBuiltInLocales,   // synchronous snapshot of what is resident
} from '@object-ui/i18n';

BUILT_IN_LANGUAGE_CODES;            // ['en','zh','ja','ko','de','fr','es','pt','ru','ar']
await loadBuiltInLocale('zh');      // the zh catalogue, fetched once and memoised
await loadBuiltInLocale('zh-CN');   // the same zh catalogue — a region tag is served by its base
await loadBuiltInLocale('tlh');     // null — not a code this package ships
isBuiltInLanguage('zh-CN');         // true
isBuiltInLanguage('xx-YY');         // false — no catalogue for the tag or its base
```

A code is looked up **exact tag first, then its base language**: `zh-CN` is
served by the `zh` catalogue, while a catalogue keyed by a full tag would win
over its base. `isBuiltInLanguage` and `isBuiltInLocaleLoaded` answer by the same
rule as `loadBuiltInLocale`, and a catalogue is memoised under its own code, so
`zh` and `zh-CN` share one fetch.

`I18nProvider` does this for you: it fetches the catalogue for whatever language
it boots into, and `changeLanguage()` awaits the new catalogue before switching,
so a switcher needs no extra wiring.

#### Resolving before the first render

Without a resolve, a provider booting into `zh` paints once through the `en`
fallback — correct strings, never a raw key — and re-renders in Chinese when the
catalogue lands. If your app already awaits something before mounting, spend
that await here instead and the first paint is already right:

```tsx
import { I18nProvider, preloadBootstrapLocale, resolveBootstrapLanguage } from '@object-ui/i18n';
import { createRoot } from 'react-dom/client';
import type { FC } from 'react';

declare const App: FC;
declare const container: HTMLElement;
declare const loadLanguage: (lang: string) => Promise<Record<string, unknown>>;

// Pass the SAME options you will pass to <I18nProvider>, or the two will
// disagree about which language this boot is in.
await preloadBootstrapLocale({ hasLoader: true });
createRoot(container).render(
  <I18nProvider loadLanguage={loadLanguage}>
    <App />
  </I18nProvider>,
);

resolveBootstrapLanguage({ hasLoader: true }); // 'zh' — the same answer, no fetch
```

`preloadBootstrapLocale` never rejects: a catalogue that will not download must
not take the boot down, and the provider retries on mount.
`apps/console/src/main.tsx` is the worked example.

#### When you really do want all ten

The parity suites do, and so does an app that ships every language resident. The
door is a separate specifier, so the cost is visible at the import site:

```tsx
import { builtInLocales, zh, ru } from '@object-ui/i18n/locales';
```

⚠️ That module statically imports every catalogue. Never reach for it on a
page-load path — that is exactly the eager payload the split removed.

### RTL Helpers

```tsx
import { isRTL, RTL_LANGUAGES } from '@object-ui/i18n';

isRTL('ar'); // true
isRTL('en'); // false
```

### Localized value helpers — reading and editing an `I18nLabel`

Server-driven metadata types a label as a plain string **or** an inline
per-locale map (`{ en: 'Pricing', 'zh-CN': '定价' }`). An authoring surface that
shows one locale in one text input has to answer three separate questions, so
there are three functions and each answers exactly one:

```tsx
import { pickLocalized, setLocalized, clearLocalized } from '@object-ui/i18n';

const stored = { en: 'Pricing', 'zh-CN': '定价' };

pickLocalized(stored, 'en-US');          // 'Pricing'   — which entry to DISPLAY
setLocalized(stored, 'en-US', 'Plans');  // { en: 'Plans', 'zh-CN': '定价' }
clearLocalized(stored, 'en-US');         // { 'zh-CN': '定价' }
```

⛔ Never write the input's string back as the whole value — that replaces the
map and every locale the author was not looking at is gone, silently, on the
first keystroke. `setLocalized` replaces **one** entry (adding it when the
active locale has none) and `clearLocalized` removes **one** entry (returning
`undefined` once nothing localized is left). Both choose that entry with the
same limbs, and deliberately stop short of `pickLocalized`'s display-only
fallbacks, so an author editing in `fr` while shown the `en` string can neither
overwrite nor delete English.

## Scope — the `engine.*` carve-out (metadata-admin / Studio)

Not every user-facing string in this repository resolves through these packs.
The metadata-admin (Studio) surface — the metadata directory, the inspectors,
package management, the flow designer and their refusal messages — resolves its
`engine.*` keys through a module-local **two-locale** table in
[`packages/app-shell/src/views/metadata-admin/i18n.ts`](../app-shell/src/views/metadata-admin/i18n.ts):
a plain `Record` lookup over `en-US` and `zh-CN`, not an i18next namespace.
Roughly 1,300 keys per locale live there, and **no `engine.*` key exists in any
of the ten packs.**

That is design, not drift — the file's header records it as "Phase 3f". The
server holds the primary path: the engine consumes `label` from the
`/meta/types` response, sourced from the platform's metadata-type registry. The
module-local table is a **fallback** for deployments with no translation bundles
configured, and the interim source of truth for Chinese until the platform's
`setup.translation.ts` ships zh-CN coverage. Copying the namespace into the
packs would duplicate strings whose primary source is a server response.

Two consequences follow, and both are accepted rather than outstanding work:

- **Only `en` and `zh` are covered.** On an `ar` / `de` / `es` / `fr` / `ja` /
  `ko` / `pt` / `ru` console, `engine.*` strings render English. That is the
  price of the carve-out, not a backfill someone forgot.
- **The i18n gates cannot see this namespace, by construction.** Key parity
  ([`src/__tests__/all-locales-key-parity.test.ts`](./src/__tests__/all-locales-key-parity.test.ts))
  compares pack against pack, and `engine.*` is in no pack — so it is not an
  *exception* to that test, it is outside its subject. The call-site gate
  ([`scripts/check-i18n-call-site-keys.mjs`](../../scripts/check-i18n-call-site-keys.mjs))
  skips these call sites **by declaration**: the module is registered in its
  `EXCLUDED_TRANSLATORS` list with a reason, and an imported `t` from any
  unregistered module is a hard error there — so a second local table cannot
  appear silently, and this carve-out cannot quietly widen.

**When to revisit.** Migrating the namespace into the packs is mechanical but
wide (~1,300 keys × 8 further locales) and argues against the server-driven
design above, so it is not worth doing speculatively. The condition to reopen it
is concrete: a stated demand for an admin console in a language other than `en`
or `zh` — not a general wish for broader locale coverage, which the packs
already serve on every other surface. See objectui#4662 for the measurement and
the ruling.

## Links

- 📦 [npm package](https://www.npmjs.com/package/@object-ui/i18n)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
