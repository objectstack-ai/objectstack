---
'@objectstack/spec': patch
---

feat(spec/system): export the platform locale table `PLATFORM_LOCALES` and its read aliases

Clause-②: yes (widening)
Metadata-protocol: none

- **`PLATFORM_LOCALES`** (from `@objectstack/spec/system`): the one list of languages the platform supports, as frozen rows `{ tag, label, rtl }` in menu order: `en`, `zh-Hans`, `zh-Hant`, `es`, `ar` (right to left), `fr`, `pt-BR`, `ru`, `de`, `ja`, `ko`, each labelled with its own native name. `PLATFORM_LOCALE_TAGS` is the tag list and `PlatformLocaleTag` the literal union of the tags.
- **`PLATFORM_LOCALE_READ_ALIASES`** and **`platformLocaleTagOf(code)`**: the codes stored values already carry, mapped to the table tag they mean (`zh`, `zh-CN`, `zh-SG` to `zh-Hans`; `zh-TW`, `zh-HK`, `zh-MO` to `zh-Hant`; `ja-JP` to `ja`; `es-ES` to `es`; `pt` to `pt-BR`; `en-US` to `en`). A table tag answers itself and the match ignores case (`zh-cn` reads as `zh-Hans`). Any other code answers `undefined`; no region fallback is guessed.
- Nothing reads the table yet and no schema refuses a tag that is not on it: every locale value that parsed before still parses. The protocol page `i18n-standard` gains the table, the read aliases and the rule (same-PR follow; a language is added or removed by changing the table and backfilling once).
