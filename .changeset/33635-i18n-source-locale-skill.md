---
'@objectstack/skills': patch
---

docs(skills): `objectstack-i18n` teaches `i18n.sourceLocale`

Clause-②: no
Metadata-protocol: none

The `objectstack-i18n` skill now teaches the optional `i18n.sourceLocale` key: the language the inline `label:` text is written in, which `os lint`, `os i18n check` and `os i18n extract` read (`i18n.sourceLocale`, else `i18n.defaultLocale`, else `en`; `--default-locale` overrides it for one run). `defaultLocale` is described as what it is, the locale a user who has not chosen one gets, so an app authored in English for Chinese users declares `defaultLocale: 'zh-CN', sourceLocale: 'en'`. The skill also states the current serving behaviour: label serving still reads inline text as `defaultLocale` text, so that stack declares `fallbackLocale: 'en'` to keep an `en` request on the authored labels. The coverage and extract sections say "source locale" where they said "default locale", and a new eval case grades the configuration.
