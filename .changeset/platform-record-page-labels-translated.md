---
"@objectstack/platform-objects": minor
---

The three platform record pages carry a translated label in every shipped locale.

`sys_user_detail`, `sys_organization_detail` and `sys_position_detail` each declare a page-level `label` — `User`, `Organization`, `Position` — and those three strings rendered in English in every locale, including `zh-CN`, `ja-JP` and `es-ES`. They are the only keys on those pages the extractor reaches: all three author `regions: []`, so the shared walk (which roots at `regions[].components[]`) finds nothing else, and their other 45 authored copy sites are inline locale maps under `slots.*` that already carry all four locales.

`SetupAppTranslations` now declares a `pages.*` entry for each of the three in all four locale files, so `translatePage` overlays the page label the same way it already does for the plugin-carried Setup pages. Their recorded source hashes are added alongside (`<locale>.source-hashes.ts`), so a later edit to one of the English literals marks the translations stale instead of serving a translation of a string that no longer exists.

Nothing about the pages' shape changed: `label` is still the only key the extractor offers them, and the inline maps under `slots.*` are untouched.
