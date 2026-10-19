---
'@objectstack/runtime': patch
---

fix(runtime): the `keys` and `actions` dispatcher domains answer their `405 METHOD_NOT_ALLOWED` with an `Allow: POST` header

Clause-②: no

RFC 9110 requires a `405` to carry an `Allow` header naming the methods the target resource supports. The `mcp`, `meta` and `ai` dispatcher domains already send one. The `keys` and `actions` domains answered their `405` without it, so a client could see that its verb was refused but not which verb the route takes.

Both domains serve one method, `POST`, on every path they claim, and their `405` now carries `Allow: POST`:

- **`/api/v1/keys`.** A signed-in `GET`, `PUT`, `PATCH` or `DELETE` is answered `405` with `Allow: POST`, on the standalone server (`os dev`, `os serve`) and on a host built with `@objectstack/hono`'s `createHonoApp`.
- **`/api/v1/actions/...`.** A signed-in non-`POST` request that reaches the `actions` domain is answered `405` with `Allow: POST`. That is every such request on a `createHonoApp` host. The standalone server mounts these paths for `POST` only, so its HTTP adapter answers other verbs itself, and that answer already carried `Allow: POST`.

The status, the body and its `error.code` are unchanged: `{ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', httpStatus: 405 } }`. Each domain still decides an anonymous caller before it looks at the method, so an anonymous `GET` (or any other verb the anonymous decision refuses) that reaches either domain is answered `401 UNAUTHENTICATED`, with no `Allow` header.
