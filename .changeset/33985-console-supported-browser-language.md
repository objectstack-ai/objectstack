---
'@object-ui/console': patch
---

fix(console): a user with no personal language gets their browser's language when the app ships it, and the app's default language otherwise

Clause-②: no
Metadata-protocol: none

Since 18.5.0 the Console stated the app's declared default (discovery `locale.default`) as the `Accept-Language` of its language reads whenever the device held no explicit choice. Discovery always serves a default, so the browser's language was never asked: a zh-CN browser on an app with `i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] }` booted an English Console, where 18.3.0 booted Chinese.

For a signed-in user with no `sys_user.locale`, the Console's language is now the browser's language when the app lists it in discovery `locale.supported`, else the app's declared default, else `en` (maintainer ruling, letter B). The browser's language is its top tag (`navigator.language`), and "the app lists it" is answered by the platform's one locale ladder (`resolveLocaleAmong`), the same matcher the server's `Accept-Language` rung uses: `ja` matches `ja-JP`, `zh-TW` matches `zh-Hant`, `en-US` matches `en`, `es-MX` matches `es-ES`. The Console states the app's own spelling of that entry. A browser language the app does not ship still gets the app's default, as in 18.5.0. A stored `sys_user.locale` or a language picked on the device still wins over both. No server or protocol change.
