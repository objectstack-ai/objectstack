---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/runtime': minor
'@objectstack/service-i18n': minor
'@objectstack/rest': minor
'@objectstack/objectql': minor
'@objectstack/plugin-email': minor
'@objectstack/service-analytics': minor
'@objectstack/service-storage': minor
---

feat(i18n): the serving layer reads `i18n.sourceLocale` as the authored label's language

Clause-②: yes (widening) — `II18nService` (`@objectstack/spec/contracts`) gains an optional `getSourceLocale()` / `setSourceLocale(locale)` pair, shaped like the fallback pair; `FileI18nAdapter` and the kernel's in-memory fallback implement both.
Metadata-protocol: semantic

An app authored in one language that defaults its users to another now serves its inline labels to a request in the authored language. Take `defaultLocale: 'zh-CN'`, `sourceLocale: 'en'`, English inline labels, a `zh-CN` bundle and no `fallbackLocale`:

- Before: an `en` request was not treated as the authored language, walked the fallback chain (`zh-CN`) ahead of the inline text and was served the Chinese bundle row, unless the stack also declared `fallbackLocale: 'en'`.
- Now: an `en` request answers the English inline label; a `zh-CN` request answers the `zh-CN` row; any other locale walks the declared fallback chain exactly as before.

`AppPlugin` threads the declared `i18n.sourceLocale` into the i18n service, and every metadata-document translation (the REST metadata reads, a formula's `label()`, an email template's `option` hole, analytics select-option labels and the upload-link page) passes `getSourceLocale()`, else `getDefaultLocale()`, as `ResolveOptions.defaultLocale`. A stack that declares no `sourceLocale` is served exactly as before. A `fallbackLocale: 'en'` added only to work around this can stay; it is no longer needed for the `en` request.

Writing your own i18n provider: implement `setSourceLocale` to receive the declaration and `getSourceLocale` to report it, answering `undefined` when nothing was declared — never `defaultLocale`; the serving layer does that collapse itself.
