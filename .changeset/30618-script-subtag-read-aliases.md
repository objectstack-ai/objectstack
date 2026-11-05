---
'@objectstack/spec': minor
---

fix(spec/system): the platform locale table reads the script-subtag Chinese spellings, so a `zh-Hant-TW` / `zh-Hant-HK` reader gets a registered `zh-Hant` bundle instead of Simplified Chinese

Clause-②: yes (widening)
Metadata-protocol: semantic

`PLATFORM_LOCALE_READ_ALIASES` (`@objectstack/spec/system`) gains five rows, one for the script-subtag spelling of each regional Chinese alias: `zh-Hans-CN` and `zh-Hans-SG` read as `zh-Hans`; `zh-Hant-TW`, `zh-Hant-HK` and `zh-Hant-MO` read as `zh-Hant`. `platformLocaleTagOf` answers them (case-insensitively, as for every row), and `PlatformLocaleReadAlias` gains the five literal keys.

What changes for a reader: browsers and operating systems send these spellings. `resolveBundleLocale` and `resolveLocaleAmong` (and so `resolveLocale` and `resolveOfferedLocale` in `@objectstack/core`) now map them through the table before the base-language step, so over a bundle that holds both scripts a `zh-Hant-TW`, `zh-Hant-HK` or `zh-Hant-MO` request reaches the `zh-Hant` key and a `zh-Hans-CN` or `zh-Hans-SG` request reaches the Simplified key (`zh-CN`, `zh-Hans` or a bare `zh`), whatever order the keys were registered in. Before, the first registered `zh-*` key answered them, and over `{ zh, zh-Hant }` a `zh-Hant-TW` request got the bare `zh` (Simplified) key. Setup's default-language options (`localization.locale`) name the five codes from the table (`zh-Hant-TW` is 繁體中文, `zh-Hans-CN` is 简体中文) where they used the runtime's display name (中文（繁體，台灣）), and a stored `zh-Hant-TW` default now shows selected on the 繁體中文 option: where the deployment listed `zh-CN` before `zh-Hant`, it used to take the place of the 简体中文 option. The values Setup accepts are unchanged.

Unchanged: the list stays closed. Only these five spellings are added; a script-subtag spelling without a row (`zh-Hant-US`) and every other code the table does not name (`pt-PT`, `en-GB`, `es-419`) answer `undefined` and fall back through base language and variant expansion exactly as before. With no registered key of the requested script, a script-subtag request still reaches the other script's key, as before. No call that matched before stops matching.
