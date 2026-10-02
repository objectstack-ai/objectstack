---
'@objectstack/plugin-security': patch
---

`PermissionDeniedError` declares its 403 as `status` as well as `statusCode`, so a permission refusal answers 403 at every door (#21405).

Clause-②: no

The class declared `statusCode` alone, unlike every other error class in `errors.ts`, and a door that reads `status` alone derived no status from it. On a showcase boot, a plain member's `POST /api/v1/share-links` on a record they cannot read answered `500` with code `PERMISSION_DENIED` through `plugin-sharing`'s route door, while the runtime dispatcher's `/share-links` domain answered the same refusal with `403`. Both doors now answer `403 PERMISSION_DENIED`. The code, the message and `statusCode` are unchanged.
