---
'@objectstack/runtime': patch
---

fix(comments): unreact, resolve and own-comment delete answer on an `objectstack serve` / `objectstack dev` multi-tenant host instead of `404 ENDPOINT_NOT_FOUND`

Clause-②: no
Metadata-protocol: none

On a multi-tenant host composed the way the framework CLI composes one (`HonoServerPlugin` + `DispatcherPlugin`, a `kernel-resolver`, and no `createHonoApp` catch-all), the three comment doors, `DELETE /api/v1/comments/reactions/:id`, `PUT /api/v1/comments/:id/resolution` and `DELETE /api/v1/comments/:id`, never reached the dispatcher's `/comments` domain: `AuditPlugin` runs on the per-environment kernel, which owns no `http.server`, and `DispatcherPlugin`'s fallback seam handed on only domain-decided and app-endpoint paths. So the transport answered its own `404 ENDPOINT_NOT_FOUND`.

`DispatcherPlugin`'s fallback now hands exactly those three method and path shapes (bare or environment-scoped) to `dispatch()` on a multi-tenant host, with the transport's request rebuilt as a Web `Request` carrying its original body, and writes the door's `Response` back unchanged. Any other shape still writes nothing, so the transport's own miss stands; a single-kernel host keeps today's answers; and the fallback runs only after every mounted route missed, so a kernel that mounts the doors itself is never reached here.
