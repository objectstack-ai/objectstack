---
'@objectstack/runtime': minor
---

feat(runtime): `POST /api/v1/security/_activation/:type/:name` switches a position or a permission set on or off for the deployment (ADR-0126 §3 regime C, as ADR-0131 D6 amends it)

Clause-②: yes

The authorization resolver reads whether a position or a permission set is switched off from the activation ledger, `sys_metadata_activation` (types `position` and `permission`), and never from the catalog row's `active` column (ADR-0131 D3). Until now nothing wrote that ledger for these two types, so a deactivation switched nothing off. This route is the write half:

- **Route:** `POST /api/v1/security/_activation/:type/:name`, with `:type` either `position` or `permission`. It is also mounted under `/api/v1/environments/:environmentId` when project scoping is on, like the action door.
- **Body:** `{ enabled?: boolean }`. `enabled` defaults to `true`. Unknown keys and a non-boolean `enabled` are refused `400 VALIDATION_FAILED`, the same body reader `POST /actions/_activation/:object/:action` uses.
- **Effect:** one `sys_metadata_activation` row through the engine, carrying the definition's package. Re-enabling updates that row. Switching a position off stops every grant through it for every holder in the deployment. Switching a permission set off stops it granting by every path. No definition and no catalog row is written.
- **Authority:** the same as the flow and action activation doors. The caller needs `manage_metadata`. Under a `group` or `isolated` tenancy posture the caller must also be the platform operator (ADR-0126 §5). Refusals are `403 PERMISSION_DENIED`, and nothing is written.
- **Refusals:** a name that does not resolve in the security catalog is `404`. No catalog bound, or a catalog that cannot be read, is `503 SERVICE_UNAVAILABLE`. A composition without the ledger object is `501`. Switching `admin_full_access` off is refused `403 PERMISSION_DENIED` by the last-admin guard's ledger hook.

The route is not in the JS SDK. Its caller is the Setup console's Deactivate on the position and permission-set pages, which calls the platform API directly.
