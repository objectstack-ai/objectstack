---
'@objectstack/spec': patch
---

fix(spec): `resolveI18nLabel` prefers an inline label entry of the locale's own script

Clause-②: no
Metadata-protocol: none

Where the platform locale table splits a language by script (`zh-Hans`, `zh-Hant`), `resolveI18nLabel` now reads an entry of the requested locale's script before an entry of the other one: `zh-Hant`, `zh-TW` or `zh-HK` over `{ 'zh-CN': '客户', 'zh-TW': '客戶' }` answers `客戶` in any authoring order, and `zh`, `zh-CN` or `zh-Hans` answers `客户`. It used to take the first `zh-*` key. The script a key means is read from `platformLocaleTagOf`. A map without an entry of the locale's script, and every language the table names once, resolve exactly as before. This keeps the resolver limb for limb with objectui's `pickLocalized`, which takes the same change. The `InlineLocaleMapSchema` keys an author can write are unchanged.
