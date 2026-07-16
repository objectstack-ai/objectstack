---
'@objectstack/plugin-hono-server': patch
'@objectstack/hono': patch
---

CORS default `allowHeaders` now includes `If-Match`. The REST record update
accepts the OCC token as an `If-Match` header (objectui's record-level inline
edit sends it on every save), but the preflight allow-list omitted it — so on
any split-origin deployment (console dev server against a backend on another
origin) the browser failed the preflight and every inline-edit save died with
"Failed to fetch". Found live while dogfooding objectui#2572; same
split-origin failure class as the #2548 Bearer fixes. Explicit user-supplied
`allowHeaders` still win unchanged.
