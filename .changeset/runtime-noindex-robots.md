---
'@objectstack/plugin-hono-server': patch
'@objectstack/hono': patch
'@objectstack/cli': patch
---

fix: a deployed runtime tells search engines not to index its API and Console

Clause-②: yes (widening) — every answer under `/api/` and `/_console/` gains an `X-Robots-Tag: noindex, nofollow` header (the public form page `/_console/f/<slug>` excepted), Console documents gain a `<meta name="robots" content="noindex, nofollow">` tag, and `GET /robots.txt`, which answered 404 on a Console-serving runtime that defines none, now answers a default file. Nothing that was served before is refused.
Metadata-protocol: none

Search engines were crawling runtime surfaces of deployed ObjectStack instances: Console sign-in pages, the anonymous `GET /api/v1/runtime/config` door, auth routes. They are app and API surfaces, not content, and every self-hosted deployment had the same exposure.

- **API.** `HonoHttpServer` (`@objectstack/plugin-hono-server`) adds `X-Robots-Tag: noindex, nofollow` to every answer under `/api` — data, metadata, auth, error envelopes and the unmatched-request 404. A route that sets its own `X-Robots-Tag` keeps it. `createHonoApp` (`@objectstack/hono`) installs the same lane, exported as `installApiNoindex`, so both HTTP doors answer the same headers.
- **Console.** The Console static plugin (`os serve`, `os start`, `os dev`) adds the same header to every answer under `/_console/` and writes the robots meta tag into each Console document, except on the public form page `/_console/f/<slug>`, which stays indexable. A Console build that already ships a robots meta tag keeps its own.
- **robots.txt.** With the Console mounted, `GET /robots.txt` answers a default that disallows `/api/` and `/_console/` and allows the public form surface (`/forms/`, `/_console/f/`, `/_console/assets/` and the anonymous form door `/api/v1/forms/`). It answers only when nothing else serves the path, so an app's own `robots.txt` route, static mount or fallback wins whichever registered first.
