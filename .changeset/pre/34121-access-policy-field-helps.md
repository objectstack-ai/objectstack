---
'@objectstack/service-settings': patch
---

fix(settings): Setup → Access policy explains its five fields in the admin's language

Clause-②: no
Metadata-protocol: none

On Setup → Access policy, the help under Allowed IP ranges, Idle timeout, Absolute session lifetime, Max concurrent sessions per user and Require multi-factor authentication showed the English manifest description in every translated locale, because no locale bundle carried a `help` for those keys. All ten translated locales (zh-CN, zh-Hant, ja-JP, ko, de, es-ES, fr, pt-BR, ru, ar) now carry `settings.access_policy.keys.KEY.help` for each of the five, translated from the English description. The settings translation coverage test no longer exempts them: its shrink-only owed-help list is empty, so every described settings field is held to a translated help in every locale. No keys, labels or option values change.
