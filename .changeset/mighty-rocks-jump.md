---
"@objectstack/runtime": patch
---

**`DELETE` / `PATCH` / `POST` on the dispatcher's `/metadata/:type/:name` are refused with `405` instead of being answered as reads.**

The `parts.length >= 2` block carried exactly one method-sensitive branch — the `PUT` save — and the read that followed it had no method guard, so every other verb fell into it and was served the ordinary metadata read. `DELETE` was the sharpest case: a caller asking to delete a metadata item received `200` plus the item document, which is indistinguishable from a successful destructive call, while nothing was deleted and `protocol.deleteMetaItem` was never invoked. No status, header or field separated any of those answers from a real `GET`.

The block now answers `405 METHOD_NOT_ALLOWED` with an `Allow: GET, HEAD, PUT` header naming what it serves, aligning it with every other route in the same file (which already guard their verb). `GET`, `HEAD` and `PUT` are unchanged, and a request that passes no method still defaults to the read.

Note this narrows an accepted surface: a client that was relying on `DELETE`/`PATCH`/`POST` returning the document now gets a `405`. It never performed the operation the verb named — use `GET` to read, or `packages/rest`'s `DELETE /api/v1/meta/:type/:name` for a real metadata delete.
