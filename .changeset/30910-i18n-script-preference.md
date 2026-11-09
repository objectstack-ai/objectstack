---
'@object-ui/i18n': patch
---

fix(i18n): a Traditional Chinese session reads and edits the Traditional entry of an inline label map

Clause-②: no
Metadata-protocol: none

`pickLocalized`, `setLocalized` and `clearLocalized` now prefer an entry of the session's own script where the platform locale table splits a language by script. In a `zh-Hant` (or `zh-TW`, `zh-HK`) session, a label written as `{ en: 'Customer', 'zh-CN': '客户', 'zh-TW': '客戶' }` shows `客戶` and an edit replaces the `zh-TW` entry; before, both took the first `zh-*` key in authoring order, so a Traditional session showed the Simplified text and an edit overwrote it. A `zh-Hans`, `zh-CN` or bare `zh` session prefers the Simplified entry the same way.

Which tag a key means comes from `platformLocaleTagOf` in `@objectstack/spec/system`, and the preference applies only to a language the table names more than once (`zh` today). A map without an entry of the session's script, and every other language, resolve exactly as before. What an author can write is unchanged.
