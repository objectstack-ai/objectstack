---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-email': patch
'@objectstack/service-settings': patch
'@objectstack/service-sms': patch
---

fix(settings): settings refusals, live statements and action answers are written in every platform language, and `zh-TW` reads Traditional Chinese

Clause-②: no
Metadata-protocol: none

- **Every module-local settings copy table carries the eleven platform languages** (the platform locale table: English, Simplified and Traditional Chinese, Spanish, Arabic, French, Brazilian Portuguese, Russian, German, Japanese, Korean). Before, they carried four (Setup → Email's live statement two), so a caller in any other language read English. Covered: the allowed-IP-ranges save refusal, the sign-in method floor refusals, the `auth.mfa_required` refusal and the organization MFA refusal and save notice (`@objectstack/plugin-auth`); Setup → Email's live-transport statement and "Send test email" answers (`@objectstack/plugin-email`); the default-currency lock and the "no longer offered" locale option (`@objectstack/service-settings`).
- **`zh-TW`, `zh-HK` and `zh-MO` callers read Traditional Chinese.** Each table looks the caller's code up with core's `resolveLocale`, which reads it through the platform locale table's read aliases; a code naming no language on the table is answered in English, as before.
- **"Send test SMS" (`sms/test`, `@objectstack/service-sms`) answers in the caller's language** (`Accept-Language`, else `?locale`), like the mail and storage connection tests. It read no locale before and answered English in every console language. A provider's own error text still passes through verbatim.
- **The two answers `SettingsService.runAction` writes itself** (the built-in `reset` result and the refusal for an action with no registered handler) are written in the caller's language. With no locale, or one off the platform table, every sentence is the English one callers read before.
