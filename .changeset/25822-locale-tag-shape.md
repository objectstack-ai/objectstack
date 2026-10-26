---
'@objectstack/spec': minor
---

feat(spec)!: a locale must be a BCP-47 tag — `zh_CN`, a padded value or a language name is refused

`LocaleSchema` was a bare string, so a translator or AI author who wrote `zh_CN`, `'zh-CN '` or `not a locale!!` got a green save (`PUT /api/v1/meta/translation/:name` answered 200 with `_diagnostics.valid: true`). The strings were stored under a locale no session ever asks for. The resolvers fold case and nothing else, so those strings never rendered, with no diagnostic.

`LocaleSchema` now accepts a tag-shaped value only: a 2–8 letter language subtag, then hyphen-separated 1–8 letter-or-digit subtags (`en`, `zh-CN`, `zh-Hans-CN`, `es-419`). It is the same shape a user's own `locale` column accepts. Case is not judged (`zh-cn` still parses, and resolves). The check applies everywhere the schema is used:

- a `translation` item's `locale` (the metadata save door and `defineTranslation`);
- a translation bundle's locale keys (`defineTranslationBundle`, `stack.translations`, the platform bundle);
- `i18n.defaultLocale`, `i18n.fallbackLocale` and `i18n.supportedLocales`;
- a seed dataset's `locale` scope and the seed loader's `locale`.

Stored rows and older built artifacts: the ADR-0087 D2 conversion `translation-locale-tag-canonicalized` rewrites the two spellings that have one tag they can have meant: `_` as the separator (`zh_CN` → `zh-CN`) and surrounding whitespace. A stored `translation` row is rewritten when it is rehydrated, so its strings start rendering for the locale they were written for. Any other value is left as stored and reported as a TODO by `os migrate meta --stored`. So is a bundle key that would land on a tag the entry already holds with different strings. The conversion is retired from the load path, so a source that still writes a non-tag locale is refused, not rewritten. The D3 entry `translation-locale-non-tag-refused` carries the judgment for `os migrate meta`.

Clause-②: no (narrowing) — `LocaleSchema` refuses values it used to accept. Nothing is widened.

Metadata-protocol: narrowed (a locale that is not a BCP-47 tag is refused on translation items, bundle keys, the i18n configuration and seed datasets)

<!-- adr-0087: registered translation-locale-non-tag-refused, translation-locale-tag-canonicalized -->

**BREAKING** for an author who wrote a non-tag locale.

- **Before.** `defineTranslation({ name: 'zh_cn', locale: 'zh_CN', … })` parsed, and its strings never rendered.
- **Now.** The value is refused at `locale` (or at the bundle key) with a message naming the tag shape.
- **Fix.** Write the tag: `zh_CN` → `zh-CN`, drop surrounding whitespace, and replace a language name with its tag. `os migrate meta --from 17 --write` applies the first two to your sources.
