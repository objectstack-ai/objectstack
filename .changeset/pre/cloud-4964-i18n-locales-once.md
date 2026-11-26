---
'@object-ui/console': patch
---

fix(console): a signed-in open asks `GET /api/v1/i18n/locales` once, not twice

Clause-②: no
Metadata-protocol: none

The console has two readers of the locale list: the globe menu's locale codes (`loadLocales`) and the language load, which reads the server's declared fallback chain beside the active language's bundle (objectstack#36809). Each sent its own request, so every signed-in page open asked the server the same question twice. Both now share one answer per page load (`localesRead.ts`), and a language switch reuses it too. A failed read is not kept, so the next reader asks again, as before.
