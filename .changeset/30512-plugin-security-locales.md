---
'@objectstack/plugin-security': patch
---

i18n(plugin-security): the security objects, built-in permission sets and built-in positions ship in all eleven platform languages

Clause-②: no
Metadata-protocol: none

The security objects, the names and descriptions of the built-in permission sets and the names of the built-in positions now carry `zh-Hant`, `ar`, `fr`, `pt-BR`, `ru`, `de` and `ko` beside the existing `en`, `zh-CN`, `ja-JP` and `es-ES`, so an administrator in one of those languages reads the security screens in their own language instead of English. Each new locale is registered under its platform-table tag with its source-hash companion, the hand-authored permission-set and position tables carry an entry in every locale, and the package's extract command lists the tags, so the existing `check:i18n` bundle check covers them. Package 7 of #30512.
