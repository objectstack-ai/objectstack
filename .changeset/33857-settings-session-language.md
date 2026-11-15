---
'@object-ui/console': patch
---

fix(console): the Settings pages ask the server in the session's language

Clause-②: no
Metadata-protocol: none

The Settings pages' four calls (`GET /api/settings`, `GET /api/settings/:namespace`, the `PUT` save and an action's `POST`) now send the console's UI language as `Accept-Language`, read from `<html lang>` like every metadata and data call. The server writes the copy these calls return in that language (the Localization page's currency-lock banner, save refusals, action results), so on a console switched to a language other than the browser's that copy no longer arrives in the browser's language. With no UI language set, the header is left to the browser, as before.
