---
'@objectstack/cli': patch
---

fix(cli): i18n coverage reports a blank inline-label entry the renderer shows as a gap

Clause-②: no
Metadata-protocol: none

An inline locale map with an empty entry that the renderer reaches for a locale no longer counts that locale as translated. `{ 'zh-CN': '成员', 'zh-TW': '' }` was reported covered for `zh-Hant` by the Simplified text, while the console shows the blank Traditional entry; it is now a `missing translation` finding, as an empty bundle value already is. Readers that never reach the blank entry are covered as before.
