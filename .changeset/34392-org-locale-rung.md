---
'@objectstack/plugin-hono-server': patch
'@object-ui/console': patch
---

fix(console,plugin-hono-server): the organization's Localization language decides the Console language for a user with no personal language

Clause-②: no
Metadata-protocol: none

An administrator who set the organization's language (Setup → Localization, or the first-run checklist's "Default language and country") never changed the Console language of a member with no `sys_user.locale`. The Console stated a language on every `GET /api/v1/auth/me/localization` read (the browser's language when the app ships it, else the app's declared default), so the server's request rung always answered and its deployment-default rung, the only one that reads the organization's setting, never did. That rung also answered the settings manifest's built-in `en-US` placeholder over the app's declared `i18n.defaultLocale`.

`/auth/me/localization` now resolves `locale` in the order the maintainer ruled for a user with no personal language: the user's own `sys_user.locale`; else the request's `Accept-Language` top tag when the app lists that language (`i18n.getLocales()`, what discovery serves as `locale.supported`), answered in the app's own spelling (`en-US` → `en`, `ja` → `ja-JP`); else the organization's `localization.locale` when somebody set it (not the manifest's `en-US` placeholder); else the app's declared `i18n.defaultLocale`; else the settings cascade's answer, as before. `resolveSignedInUserLocale` answers the same. A host with no `i18n` service has no list to match against, so the request's language answers as before; a host with no `settings` service keeps the cascade's answer for the deployment default.

The Console now states a language only when the app lists the browser's language. Otherwise the browser's own header goes out and the server's deployment default decides. A stored `sys_user.locale` or a language picked on the device still wins. No response key or discovery key is added.
