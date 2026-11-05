---
'@objectstack/core': patch
'@objectstack/service-settings': patch
'@objectstack/plugin-auth': patch
---

fix(service-settings): an `OS_LOCALIZATION_LOCALE` naming a language the boot is still loading is no longer dropped, and Setup's default language accepts by the same locale matcher as the IdP locale claim (#30456)

Clause-②: yes (widening) — `@objectstack/core` exports `resolveOfferedLocale(requested, offered)`; `SettingsService` gains `holdOptionSourceVerdicts()` and `sealOptionSources()`. The save of `localization.locale` (`PUT /api/settings/localization`, `SettingsService.setMany`) and an `OS_LOCALIZATION_LOCALE` override now also accept a region or base of an offered language (`fr-FR` where `fr` is offered, `fr` where `fr-FR` is) and another case of an offered code (`zh-cn` for `zh-CN`); nothing accepted before is refused. The IdP locale claim (`resolveIdpLocale`) lands a script or region spelling on the offered code the platform locale table says it means (`zh-TW` on `zh-Hant`, not on a `zh-Hans` listed first).
Metadata-protocol: none

- **The boot window.** The deployment's locale list fills during the boot: the app's authored translations arrive at `kernel:ready`. A `kernel:ready` reader of `localization.locale` (auth's mail and SMS default language) could ask before the language an `OS_LOCALIZATION_LOCALE` override names was in the list; the override was then reported `IGNORED` and the reader kept the next layer's value, though the boot went on to offer that language. `SettingsServicePlugin` now holds the option verdict on a sourced key until `kernel:bootstrapped`: while held, an override the list does not admit yet is in force and not reported; at `kernel:bootstrapped` it is judged again, and one the list still does not admit is reported once, as before, and a settings change is emitted for `localization.locale` so a reader that applied it reads the key again. The other value checks (pattern, domain, bounds, format) are judged at once, as ever. A `SettingsService` constructed without the plugin judges at once, as it always has.
- **One matcher.** Setup's default language and the IdP locale claim now both ask `resolveOfferedLocale` (`@objectstack/core`): `resolveLocale`'s exact and case-insensitive steps, then the platform locale table's language (`zh-TW` is `zh-Hant`, `en-US` is `en`), then `resolveLocale`'s base-language and variant steps. A language one door takes, the other takes too.
- **Comment.** `AUTH_EMAIL_TEMPLATE_LOCALES` (plugin-auth) no longer claims to be the setting's options: since #30286 the setting offers the deployment's locale list, and the two ends agree through `normalizeAuthEmailLocale`'s pass-through and the email service's `en-US` fallback.
