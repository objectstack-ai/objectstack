---
'@objectstack/spec': minor
---

spec(i18n): a locale tag written in another case is corrected to its BCP-47 case — a translation saved as `zh-cn` reaches `zh-CN` sessions

Clause-②: yes (widening)
Metadata-protocol: semantic

A translation saved with `locale: 'zh-cn'` answered 200, and a `zh-CN` session kept rendering the stock strings. Case was accepted as written on the premise that the resolvers fold it, but a resolver answers one locale for a request, exact match first, so the stock `zh-CN` bundle won and the `zh-cn` entry was never merged into it.

- **The parse corrects case.** `LocaleSchema` returns each tag in its BCP-47 case: the language subtag in lower case, a script in title case, a region in upper case, and every subtag after a singleton in lower case. `zh-cn` reads back as `zh-CN`, `zh-hans-cn` as `zh-Hans-CN`, `EN` as `en`. This reaches every reader of the schema: a translation item's `locale`, a `TranslationBundle` / `PlatformTranslationBundle` locale key, `i18n.defaultLocale` / `fallbackLocale` / `supportedLocales`, a seed dataset's `locale` scope and the seed loader's `locale`. A canonical tag is returned unchanged, and nothing that parsed before is refused, with the one exception below.
- **Stored rows are read back canonical.** The metadata save door stores the authored body, so a row saved as `zh-cn` stays `zh-cn` at rest. The stored-row conversion `translation-locale-tag-canonicalized` now folds case as well as `_` and padding, and the runtime-authored translation sync replays it before keying a row by its locale. A row saved as `zh-cn` is served to `zh-CN` sessions from the next sync on, with nothing to re-save. Built artifacts inside the conversion's window are folded the same way.
- **Case only.** The fold never replaces a legacy or macrolanguage subtag the way `Intl.getCanonicalLocales` does: `iw` stays `iw`, `cmn-cn` becomes `cmn-CN`. That keeps a translation on the locale its author named, and gives the same answer in every runtime.
- **A bundle with two keys that fold to one tag is refused.** `{ 'zh-cn': …, 'zh-CN': … }` used to parse, keeping both keys. Folding them would put both entries on one key and silently drop one set of strings, so the parse refuses the bundle and names both keys. Merge them by hand under the canonical key. Two separate bundles in `stack.translations`, one with `zh-cn` and one with `zh-CN`, are still accepted; the runtime merges them as one locale.
- **Upgrade path.** The ADR-0087 D3 semantic entry `translation-locale-case-canonicalized` carries the change to `os migrate meta` and the upgrade guide. No key is added or removed, and the published JSON Schema of a locale is unchanged.
