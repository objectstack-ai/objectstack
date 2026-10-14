---
'@objectstack/spec': patch
---

The `PermissionSet.description` liveness row cites its real reader again: Studio's permission-set list renders the authored `description` as a column, read off `GET /api/v1/meta/permission`

Clause-②: no (the ledger row's evidence is rewritten and its status stays `live`: `PermissionSetSchema` accepts `description` exactly as before, and no state count moves)

- `liveness/permission.json`: the `description` row's evidence named two readers that are gone, the `sys_permission_set` row object and the permission-set projection. It now cites objectui's `permission` metadata resource, whose list declares a `description` column, and the generic metadata list page that renders it. It also cites the metadata door that serves the authored body to that page. `verifiedAt` moves to 2026-10-14, and the row is marked `evidenceScope: cross-repo`.
