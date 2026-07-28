---
"@objectstack/plugin-security": patch
"@objectstack/plugin-approvals": patch
"@objectstack/metadata-core": patch
---

fix(security,approvals,metadata-core): restore batch routes on the eight objects the #3391 P1 companion fix missed (#3026)

The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`: a batch
request is admitted only when the object grants the `bulk` **primitive** and the
batched child operation is itself allowed. Before that, the `*Many` routes
checked only the child verb, so a boilerplate CRUD-five whitelist
(`['get','list','create','update','delete']`) batched fine.

The companion fix — adding the `bulk` primitive wherever an explicit whitelist
survived — was applied only inside `platform-objects`. Eight objects carrying
the same boilerplate live in other packages and kept the gap, so `/batch`,
`createMany`, `updateMany` and `deleteMany` answered `405
OBJECT_API_METHOD_NOT_ALLOWED` on objects whose single-record create/update/
delete were wide open. `data-objectstack` rethrows that 405 without falling back
to per-row writes, which surfaced as a hard error on multi-select delete in the
Setup grids.

Objects reclaimed (whitelist now `['get','list','create','update','delete','bulk']`):
`sys_capability`, `sys_permission_set`, `sys_position`,
`sys_position_permission_set`, `sys_user_permission_set`, `sys_user_position`
(plugin-security); `sys_approval_delegation` (plugin-approvals);
`sys_view_definition` (metadata-core).

No new authority is granted: `bulk` only permits batching verbs each object
already exposes one record at a time, and every batched row still passes the
same row- and field-level permission checks. The whitelists stay explicit rather
than being deleted — seven of the eight are `managedBy`, and
`reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
`apiMethods`, so dropping the line would silently disable the managed-write
backstop.
