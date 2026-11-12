---
'@objectstack/plugin-hono-server': patch
---

feat(plugin-hono-server): compress responses by default (brotli or gzip, 1 KB threshold)

Clause-②: no
Metadata-protocol: none

The built-in HTTP server, which `os dev` and `os start` run, now compresses responses. A body of 1 KB or more with a compressible content type (JSON, JavaScript, CSS, HTML and the like) goes out brotli- or gzip-encoded when the request's `Accept-Encoding` names one. This covers API JSON, the Console's JavaScript and CSS bundles and static files, whichever route serves them. Before this change every response was sent unencoded, so the Console's largest bundle crossed the wire at its full 2 MB.

These responses are never encoded: streams written through `res.write()` (SSE, the AI data stream, streamed exports), any `text/event-stream`, responses that set `Transfer-Encoding` or already carry a `Content-Encoding`, `206 Partial Content`, `HEAD`, and responses marked `Cache-Control: no-transform`. Every response the server could encode carries `Vary: Accept-Encoding`, and so do the `HEAD`, `206` and `304` answers for such a response. The `ETag` is passed through unchanged, so an `If-Match` save that pins the version it just read still matches.

Nothing to configure, and nothing to migrate. A reverse proxy in front of the server sees `Content-Encoding` and passes the body through. Code that calls the app in-process (`app.fetch`, `app.request`) gets an encoded body only if it forwards an `Accept-Encoding` header, and must then decode it like any HTTP client.
