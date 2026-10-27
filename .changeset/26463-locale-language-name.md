---
'@objectstack/spec': minor
'@objectstack/platform-objects': minor
'@objectstack/service-messaging': minor
---

feat(spec)!: a single-word language name (`Chinese`, `English`, `Japanese`) is refused as a locale

The 18.x locale shape refused `zh_CN`, a padded value and a multi-word name such as `Chinese (Simplified)`, but its 2–8 letter language subtag still admitted any single word of that length. An author who wrote `locale: 'Chinese'` got a green save, and the strings were stored under a locale no session ever asks for, so they never rendered. The refusal text already said a language name is refused.

The language subtag is now 2–3 letters, the ISO 639 codes every tag in use starts with (BCP-47 reserves 4 letters and registers no 5–8 letter language). Everything else in the shape is unchanged: hyphen-separated 1–8 letter-or-digit subtags (`en`, `zh-CN`, `zh-Hans-CN`, `es-419`, `yue-HK`), and case is not judged. The one shape moves in all three places that hold it:

- `LocaleSchema` (`@objectstack/spec/system`): a `translation` item's `locale`, translation bundle keys, `i18n.defaultLocale` / `fallbackLocale` / `supportedLocales`, a seed dataset's `locale` scope and the seed loader's `locale`.
- `SYS_USER_LOCALE_TAG_PATTERN` (`@objectstack/platform-objects/identity`): the `locale_bcp47_shape` rule on a user's own `sys_user.locale` column.
- `LOCALE_TAG_SHAPE` (`@objectstack/service-messaging`): the read side that picks a recipient's notification locale, byte-identical to the column rule.

Clause-②: no (narrowing) — the locale shape refuses values it used to accept. Nothing is widened.

Metadata-protocol: narrowed (a locale whose language subtag is 4–8 letters, in practice a language name, is refused on translation items, bundle keys, the i18n configuration, seed datasets and a user's `locale` column)

<!-- adr-0087: already-registered translation-locale-non-tag-refused -->

**BREAKING** for an author or user who wrote a language name as a locale.

- **Before.** `defineTranslation({ name: 'qa_x', locale: 'Chinese', … })` parsed and its strings never rendered; `PATCH` of a user's `locale` to `Japanese` was stored, and that user's notifications fell to the delivery ladder's floor.
- **Now.** The value is refused at `locale` (or at the bundle key) with a message naming the tag shape, and the user's write is refused by the column's `locale_bcp47_shape` rule.
- **Fix.** Write the tag, not the name: `Chinese` → `zh-CN`, `English` → `en`, `Japanese` → `ja-JP`. A language name has no single tag it can have meant, so `os migrate meta --stored` lists a stored row as a TODO (D3 entry `translation-locale-non-tag-refused`) and you rewrite it by hand.
