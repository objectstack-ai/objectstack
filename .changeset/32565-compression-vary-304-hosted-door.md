---
'@objectstack/plugin-hono-server': patch
'@objectstack/hono': patch
---

docs(plugin-hono-server, hono): say which `304` answers carry `Vary: Accept-Encoding`, and that the hosted door leaves compression to the platform or CDN (#32565, #32536)

Clause-②: no
Metadata-protocol: none

No runtime behaviour changes; the READMEs both packages ship now say what the server does.

- `@objectstack/plugin-hono-server`: the README said every `304` for a compressible response carries `Vary: Accept-Encoding`. The server decides from the answer it sends, not from the `200` the `304` stands for, so a `304` carries that `Vary` only when it carries a compressible `Content-Type` of its own. A dispatcher answer written with `res.json()` does; a bare `304` with only `ETag` and `Cache-Control` (the Console's static files answer one) does not. A cache refreshing a stored answer from a `304` keeps the stored `Vary`, so no cached answer is wrong. A new test pins both shapes.
- `@objectstack/hono`: `createHonoApp`, the hosted door for edge runtimes, does not compress responses and sends no `Vary: Accept-Encoding`. Compression there is the job of the platform or CDN in front of the app, as ruled on #32155 (ruling Y′). The README now says so, and asks operators to check that their host compresses and keeps the `ETag` unchanged.
