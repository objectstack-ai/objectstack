---
"@objectstack/cli": patch
---

fix(cli): point the dev startup banner at the interactive API docs.

The ready banner's `API:` line pointed at `/` (the server root, not the API).
Replace it with an `API Docs:` link to `<apiBase>/docs` — the interactive
Scalar/OpenAPI explorer — which is the useful human entry point into the
running server's API. Adds an optional `apiBasePath` (default `/api/v1`).
