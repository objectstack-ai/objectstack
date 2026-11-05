---
'@objectstack/spec': minor
'@objectstack/core': minor
---

fix(spec,core): the server locale resolvers read the platform locale table, so a `zh-TW` / `zh-HK` / `zh-MO` reader gets a registered `zh-Hant` bundle instead of Simplified Chinese

Clause-②: yes (widening)
Metadata-protocol: semantic

`resolveBundleLocale` (`@objectstack/spec/system`) and `resolveLocale` (`@objectstack/core`) now run one ladder, the new `resolveLocaleAmong(requested, available)` export of `@objectstack/spec/system`: exact, case-insensitive, then **the same platform locale table language**, then base language, then the first registered variant. The new step maps the requested code and each available key through `platformLocaleTagOf` (the table's read aliases) and picks the key spelled as the table tag, else the first key the table maps to that tag.

What changes for a reader: a request for `zh-TW`, `zh-HK` or `zh-MO` reaches a registered `zh-Hant` key, and `zh`, `zh-CN`, `zh-SG` or `zh-Hans` reaches `zh-CN` (or `zh-Hans`), whatever order the bundle registered them in. Before, the first registered `zh-*` key answered both, so a Traditional reader got the Simplified bundle (and with `zh-Hant` registered first, a Simplified reader got the Traditional one). A bare `zh` key now counts as Simplified for a `zh-TW` request, which the base-language step used to hand it. The step also applies to `ja` → `ja-JP`, `es` → `es-ES`, `en` → `en-US` and `pt` → `pt-BR`, which answer as before against today's alias-spelled bundles.

Unchanged: a code the table does not know (`es-MX`, `en-GB`, `pt-PT`) falls back through base language and variant expansion exactly as before, and a `zh-TW` request still reaches `zh-CN` when no Traditional key is registered. No call that matched before stops matching. Every caller of either function moves with it, among them the i18n REST door, built-in validation and operation messages, email template locale folding, hook, flow and approval copy, and plugin-auth's refusal copy.
