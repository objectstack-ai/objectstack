---
'@object-ui/console': patch
---

fix(console): a user with no personal language gets the app's declared default language, not the browser's

Clause-②: no
Metadata-protocol: none

The Console's language for a signed-in user is now their own `sys_user.locale`, else the app's declared `i18n.defaultLocale` (served as discovery `locale.default`), else the browser language, else `en`. Before, a user with no personal language got the browser's language even when the app declared another default, while the server already wrote to that user in the app's default. `<html lang>` follows the resolved language.

Discovery always serves a default: an app with no `i18n` block is served `en`. So a user with no personal language in such an app now gets English whatever the browser says, the language the server already writes to them in; picking a language from the language menu sets `sys_user.locale` and outranks it. The browser language decides only when discovery serves no default.

A device that already has a cached language from an earlier visit shows it for one more page load, then follows the app's default; the switch is never made mid-session. A language picked on the device or set on the user's profile is unchanged. No server change.
