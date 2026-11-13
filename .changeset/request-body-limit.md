---
'@objectstack/plugin-hono-server': patch
'@objectstack/hono': patch
---

fix(plugin-hono-server, hono): a request body over the server's limit is answered 413 PAYLOAD_TOO_LARGE and is not read past the limit

Clause-②: no
Metadata-protocol: none

Both HTTP doors, the self-hosted server (`@objectstack/plugin-hono-server`) and `createHonoApp` (`@objectstack/hono`), now hold one request-body limit, 10 MiB by default. A request that declares a `Content-Length` over the limit is not read at all. A body with no declared length is counted while it is read, and reading stops once it passes the limit. In both cases the request is answered `413` with the registered code `PAYLOAD_TOO_LARGE`. A body of exactly the limit is read as before. The limit covers every reader of the body, not only the doors' own JSON and form parsing: routes mounted on the raw Hono app, and requests the doors forward whole to the auth service or to a domain, read through it as well. A route that never reads the body still reads nothing.

To change the limit, set `maxRequestBodyBytes` (in bytes) on `HonoServerPlugin`, call `HonoHttpServer.setMaxRequestBodyBytes()` on an embedded adapter, or pass `maxRequestBodyBytes` to `createHonoApp`. Without an option, the `OS_HTTP_MAX_BODY_BYTES` environment variable sets it. A value that is not a positive whole number of bytes fails the boot instead of serving with no limit or the wrong one.

Upload doors keep their own limit. The storage byte doors (the presigned raw PUT, the chunk PUT and the upload-link PUT) read the raw bytes through `IHttpRequest.rawBody()`, which still serves the whole body, so a file is bounded by the storage `max_upload_mb` setting exactly as before, even when that is larger than the request-body limit.
