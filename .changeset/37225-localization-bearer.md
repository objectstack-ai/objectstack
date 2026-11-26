---
'@object-ui/console': patch
---

fix(console): the boot read of the signed-in user's language, currency and time zone sends the stored sign-in token, so a session held by its token alone boots in the user's own language and formats

Clause-②: no
Metadata-protocol: none

`GET /api/v1/auth/me/localization` was read with the session cookie only, on all three of its legs: the request `index.html` sends during parse, the language seed before the app mounts, and the regional-defaults provider. A session held by its sign-in (bearer) token alone was answered as signed out, so the console booted in the browser's language and formatted numbers, currencies and dates without the user's own settings. All three now state the stored token, read from the same storage the other console requests read it from, and they still share one request: the three send the same request, and its identity includes the token. With no token stored the request is exactly as before. Nothing changes in what the server accepts.
