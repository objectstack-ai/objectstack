---
'@object-ui/console': patch
---

fix(console): after a language switch, date and number cells format in the new language, not until the next page load

Clause-②: no
Metadata-protocol: none

Switching the language from the avatar menu changes the UI language first and writes the signed-in user's `sys_user.locale` second. The switch remounts `LocalizationFetchProvider`, whose read of `GET /api/v1/auth/me/localization` could reach the server before that write committed and answer the previous language (or, for a user with no stored language yet, the browser's `Accept-Language`). `useDisplayLocale` ranks that answer above the UI language, so under 中文 a list grid's date cells kept reading `Oct 11` beside Chinese headers until a full page load, while a record page opened by URL read `2026年10月11日`.

The provider now reads again on every write to the signed-in user's own `sys_user` row that reaches the data-invalidation bus (the language switch's write and the profile page's). The re-read starts after the write has settled and opts out of joining a request still in flight from before it, so its answer is the one that lands. The single date formatter (`formatDate` through `useDisplayLocale`) is unchanged.
