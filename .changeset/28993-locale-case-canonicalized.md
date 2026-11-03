---
'@objectstack/spec': minor
---

feat(spec)!: a locale tag written in another case is corrected to its BCP-47 case — a translation saved as `zh-cn` reaches `zh-CN` sessions — and a translation bundle with two keys that fold to one tag is refused

Clause-②: no (narrowing)
Metadata-protocol: narrowed

A translation saved with `locale: 'zh-cn'` answered 200, and a `zh-CN` session kept rendering the stock strings. Case was accepted as written on the premise that the resolvers fold it, but a resolver answers one locale for a request, exact match first, so the stock `zh-CN` bundle won and the `zh-cn` entry was never merged into it.

- **The parse corrects case.** `LocaleSchema` returns each tag in its BCP-47 case: the language subtag in lower case, a script in title case, a region in upper case, and every subtag after a singleton in lower case. `zh-cn` reads back as `zh-CN`, `zh-hans-cn` as `zh-Hans-CN`, `EN` as `en`. This reaches every reader of the schema: a translation item's `locale`, a `TranslationBundle` / `PlatformTranslationBundle` locale key, `i18n.defaultLocale` / `fallbackLocale` / `supportedLocales`, a seed dataset's `locale` scope and the seed loader's `locale`. A canonical tag is returned unchanged, and nothing that parsed before is refused, with the one exception below.
- **Stored rows are read back canonical.** The metadata save door stores the authored body, so a row saved as `zh-cn` stays `zh-cn` at rest. A new stored-row conversion, `translation-locale-tag-case-folded`, folds case right after `translation-locale-tag-canonicalized` rewrites `_` and padding, and the runtime-authored translation sync replays both before keying a row by its locale. A row saved as `zh-cn` is served to `zh-CN` sessions from the next sync on, with nothing to re-save. An artifact built by `@objectstack/spec` 18.2.0 or earlier is folded the same way.
- **Case only.** The fold never replaces a legacy or macrolanguage subtag the way `Intl.getCanonicalLocales` does: `iw` stays `iw`, `cmn-cn` becomes `cmn-CN`. That keeps a translation on the locale its author named, and gives the same answer in every runtime.
- **Upgrade path.** The ADR-0087 D3 semantic entry `translation-locale-case-canonicalized` carries both halves to `os migrate meta` and the upgrade guide. No key is added or removed, and the published JSON Schema of a locale is unchanged.
- **Exact matchers that read a folded locale against a row tagged as written.** The email-template floor warning compares `i18n.supportedLocales` with `emailTemplates[].locale`, and the messaging template ladder compares the default locale with `sys_notification_template.locale`. A row tagged `zh-cn` no longer matches a supported or default locale authored as `zh-cn`, which now reads `zh-CN`: re-tag the row in its canonical case.

<!-- adr-0087: registered translation-locale-case-canonicalized -->

**BREAKING** for an author whose one translation bundle spells a locale twice, in two cases.

- **Before.** `{ 'zh-cn': { messages: { save: '保存' } }, 'zh-CN': { messages: { cancel: '取消' } } }` parsed as a `TranslationBundle` (or `PlatformTranslationBundle`) with both keys kept, and the `zh-cn` strings never reached a `zh-CN` session.
- **Now.** Both keys fold to `zh-CN`, so keeping both would put two entries on one key and silently drop one set of strings. The parse refuses the bundle at the second key, naming both keys and the tag they fold to. Two separate bundles in `stack.translations`, one with `zh-cn` and one with `zh-CN`, are still accepted; the runtime merges them as one locale.
- **Fix.** FROM a bundle holding both spellings, `{ 'zh-cn': A, 'zh-CN': B }`, TO one canonical key holding both sets of strings, `{ 'zh-CN': A and B merged }`, merged by hand: where both set the same string, keep the one you mean. No bundle in this repository has such a pair. A stored row with such a pair and different strings under the two keys is left as stored by the conversion and reported as a TODO.
