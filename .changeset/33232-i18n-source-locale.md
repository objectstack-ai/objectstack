---
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(spec, cli): `i18n.sourceLocale` names the language the inline metadata text is written in, apart from the users' `defaultLocale`; `os lint`, `os i18n check` and `os i18n extract` read it as the source language

Clause-②: yes
Metadata-protocol: added
Skills-docs: follow-up owed — `skills/objectstack-i18n/SKILL.md` (the `i18n` key table and the `os i18n extract` flag list teach `defaultLocale` / `--default-locale` as the only locale knobs; it needs a `sourceLocale` row). `content/docs/ui/translations.mdx` and the `os lint` flag row in `content/docs/deployment/cli.mdx` are updated here.

`TranslationConfigSchema` (the stack's `i18n` block) gains an optional `sourceLocale`, validated by the same `LocaleSchema` as `defaultLocale` and, like it, not required to be one of `supportedLocales`. `defaultLocale` stays the language a user who has not chosen one gets; `sourceLocale` is the language a plain-string `label:` is written in. Absent, it is `defaultLocale`, so a stack that declares nothing reads exactly as before. Near-miss spellings `sourceLanguage`, `authoringLocale` and `authoringLanguage` are refused with `sourceLocale` as the suggestion.

An app authored in English that defaults its users to Chinese declares:

```ts
i18n: { defaultLocale: 'zh-CN', sourceLocale: 'en', supportedLocales: ['en', 'zh-CN', 'es-ES'] }
```

**`os lint` and `os i18n check`** count the inline text as the source locale's translation: they ask for no `en` bundle row that restates it, and they report each missing `zh-CN` and `es-ES` row. With `defaultLocale: 'zh-CN'` alone they read the English labels as Chinese: every key was reported missing in `en` (an error under `os lint --strict`) and no `zh-CN` gap was ever reported.

**`os i18n extract`** fills the source locale's bundle from the inline text and rewrites it from the source on every merge; every other locale, `defaultLocale` included, keeps its hand translations.

**`--default-locale`** on all three commands keeps working and still wins over the config for one run; its help text now says it overrides the source locale (`i18n.sourceLocale`, else `i18n.defaultLocale`, else `en`). The `defaultLocale` field of `os i18n check --json` keeps its name and carries the source locale that was used.

**Not yet read by the serving layer.** The runtime label resolvers still treat `defaultLocale` as the authored label's language when they decide whether a request walks the fallback chain. With `defaultLocale: 'zh-CN'` and no `fallbackLocale`, an `en` request walks to the `zh-CN` bundle before it reaches the English inline label. Declare `fallbackLocale: 'en'` to keep an `en` request on the authored text.
