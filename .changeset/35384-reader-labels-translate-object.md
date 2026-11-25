---
'@objectstack/objectql': patch
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-audit': patch
---

fix(objectql,approvals,audit): an authored rule message, an approval's object label and an activity summary's labels read as `/meta` serves them in a declared `i18n.sourceLocale`

Clause-②: no
Metadata-protocol: none

In a deployment whose `i18n.sourceLocale` differs from its `i18n.defaultLocale` (an app authored in English that defaults its users to Chinese, say), three readers still looked metadata text up through `II18nService.t()`, which falls back to the `defaultLocale` row when the reader's locale holds no entry. An `en` reader was shown the Chinese text where `GET /meta` and every other refusal label showed the English one as authored:

- objectql: the author-written message of a validation rule (`objects.<object>._validations.<rule>.message`) in a `400 VALIDATION_FAILED` refusal;
- plugin-approvals: the object label on the approvals inbox, the request page, the generic data door's request rows and the approval refusals that name an object;
- plugin-audit: the object, field and select-option labels inside an activity summary composed in the reader's language.

Each now resolves through `translateObject` (`@objectstack/spec/system`) over every locale the i18n service holds, with the resolve options the metadata route builds: the reader's locale, the declared fallback chain and the authored language (the declared `sourceLocale`, else `defaultLocale`). A reader in the authored language reads the text as written; every other reader reads the same row as before. `t()` keeps carrying the catalog sentences.

An i18n service that cannot hand its translations over (no `getLocales()` / `getTranslations()`) no longer has these labels and rule messages translated through `t()`: the authored text stands. Every service the platform ships implements both.
