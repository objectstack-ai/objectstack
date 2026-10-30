---
'@object-ui/console': patch
---

fix(console): a language picked on the sign-in page reaches date and number formatting

Clause-②: no
Metadata-protocol: none

A user with no stored `sys_user.locale` who picked 中文 on the sign-in page saw every list grid's date cells as `Nov 18` beside Chinese headers, on every page load. `<html lang>` already followed the pick, but `LocalizationFetchProvider` reads `GET /api/v1/auth/me/localization` through `sharedGetJson`'s bare `fetch`, so that one read never carried the `<html lang>` `Accept-Language` every other console API call carries; the server answered its `Accept-Language` rung in the browser's language, and `useDisplayLocale` formats with that answer.

When the device holds an explicit language choice, the read now states that language as its `Accept-Language`, and reads again when the choice changes. The server's rung order is unchanged (a stored `sys_user.locale` still answers first), and so is `useDisplayLocale`'s precedence. With no choice on the device the browser's header still goes out, so a first visit's language seed and this read keep sharing one request.
