---
'@objectstack/runtime': patch
---

fix(runtime): `GET /api/v1/packages/:id/customizations` answers over HTTP

Clause-②: no
Metadata-protocol: none

The read of what this deployment changed on an installed base (its `.custom` pair's overrides, the members the pair adds to the base's objects, and the base's switched-off items) shipped with its route-ledger row and its domain handler, but the dispatcher plugin never mounted it. So on a host without `@objectstack/hono`'s catch-all, every request to it answered the transport's 404. The dispatcher plugin now mounts it beside the other `/packages/:id/...` reads, at the unscoped prefix and at `/environments/:environmentId/packages/:id/customizations`.
