---
'@object-ui/console': patch
---

fix(console): the language seed's `me/localization` leaves at parse time, beside discovery

Clause-②: no
Metadata-protocol: none

On a device's first visit the console's language seed asked `GET /api/v1/auth/me/localization` from the bundle, so the request waited for the whole eager module graph to download and evaluate, about half a second after navigation on a local server and longer on a hosted one. It needs nothing from the bundle except discovery's `locale.supported`, which `index.html` already asks for during parse. A new parse-time script now asks the seed's question the moment that discovery answers, under the seed's own gates (no stored language choice, no cached seed), and leaves the pending response for the seed. The seed takes it once, and only when it is exactly the request it would send itself, `Accept-Language` included, so the page still sends one `me/localization` and the language it picks is unchanged. The seed's 500 ms race and its fallback, the in-flight sharing with the localization provider and the hand-off of the settled answer are unchanged. A failed parse-time discovery sends nothing early, and the seed asks as before.
