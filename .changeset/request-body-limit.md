---
'@objectstack/plugin-hono-server': patch
'@objectstack/hono': patch
'@objectstack/service-storage': patch
---

fix(plugin-hono-server, hono)!: a request body over the server's limit is answered 413 PAYLOAD_TOO_LARGE and is not read past the limit

Clause-②: yes (narrowing) — a JSON, form or other body over 10 MiB that both HTTP doors read today is answered `413 PAYLOAD_TOO_LARGE`, unread past the limit, unless an operator raises the limit. The published surface also widens: `HonoPluginOptions.maxRequestBodyBytes`, `createHonoApp`'s `maxRequestBodyBytes` option, `HonoHttpServer.setMaxRequestBodyBytes()` / `getMaxRequestBodyBytes()`, the `OS_HTTP_MAX_BODY_BYTES` environment variable, and the `body-limit` exports of `@objectstack/plugin-hono-server`.
Metadata-protocol: none
Skills-docs: follow-up owed — content/docs/api/error-catalog.mdx (the `VALIDATION_ERROR` callout) and content/docs/protocol/kernel/error-handling.mdx (the 413 row) list the causes of `413 PAYLOAD_TOO_LARGE` and do not yet name a request body over the server's limit, nor `maxRequestBodyBytes` / `OS_HTTP_MAX_BODY_BYTES`; no file under `skills/**` teaches a request-body limit.

<!-- adr-0087: not-required (no-migration-prescription) no metadata an author writes changes and no stored row is rewritten: the limit bounds what the HTTP doors read from a request, and an operator raises it with an option or an environment variable -->

**BREAKING** for a client that sends a JSON, form or other request body over 10 MiB to a data, API or auth route: that request is now answered `413 PAYLOAD_TOO_LARGE` instead of being read.

- **Who moves.** The operator of a deployment whose clients send bodies that large. Raise the limit: `maxRequestBodyBytes` (in bytes) on `HonoServerPlugin` or `createHonoApp`, `HonoHttpServer.setMaxRequestBodyBytes()` on an embedded adapter, or the `OS_HTTP_MAX_BODY_BYTES` environment variable. Or send the content as a file through a storage upload door, which keeps its own limit.
- **File uploads** through the storage doors (the presigned raw PUT, the chunk PUT and the upload link, one file or several) see no change: they stay bounded by `max_upload_mb`.

Both HTTP doors, the self-hosted server (`@objectstack/plugin-hono-server`) and `createHonoApp` (`@objectstack/hono`), now hold one request-body limit, 10 MiB by default. A request that declares a `Content-Length` over the limit is not read at all. A body with no declared length is counted while it is read, and reading stops once it passes the limit. In both cases the request is answered `413` with the registered code `PAYLOAD_TOO_LARGE`. A body of exactly the limit is read as before. The limit covers every reader of the body, not only the doors' own JSON and form parsing: routes mounted on the raw Hono app, and requests the doors forward whole to the auth service or to a domain, read through it as well. A route that never reads the body still reads nothing.

To change the limit, set `maxRequestBodyBytes` (in bytes) on `HonoServerPlugin`, call `HonoHttpServer.setMaxRequestBodyBytes()` on an embedded adapter, or pass `maxRequestBodyBytes` to `createHonoApp`. Without an option, the `OS_HTTP_MAX_BODY_BYTES` environment variable sets it. A value that is not a positive whole number of bytes fails the boot instead of serving with no limit or the wrong one.

Upload doors keep their own limit. The storage byte doors (the presigned raw PUT, the chunk PUT and the upload-link PUT) read the raw bytes through `IHttpRequest.rawBody()`, which still serves the whole body, so a file is bounded by the storage `max_upload_mb` setting exactly as before, even when that is larger than the request-body limit.

The upload link's several-file form is bounded by that door's own form limit (each file within `max_upload_mb`, times the files the link takes, plus the form's framing), not by the request-body limit. A route that is refused `req.body` for size and then reads `rawBody()` takes the read over under its own bound, and its own answer stands.
