---
"@objectstack/service-i18n": minor
---

feat(service-i18n): `FileI18nAdapter.getFallbackLocale()` reports the `fallbackLocale` the adapter was constructed with (#14882)

Implements the new optional `II18nService.getFallbackLocale()`. `I18nServicePlugin`
already receives `fallbackLocale || defaultLocale || 'en'` from the stack's `i18n`
config on both boot paths (`os serve`, the dev plugin); this makes that declaration
readable, so the REST metadata reads pass the document translators the same fallback
locale `t()` itself consults. Returns `undefined` when no `fallbackLocale` was given.
