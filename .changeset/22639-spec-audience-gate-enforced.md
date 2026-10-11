---
"@objectstack/spec": patch
---

docs(spec): a list view's and a dashboard's `requiredPermissions` is enforced — the describe and the liveness ledger say so (#22639)

Clause-②: no

- The shared description of `ListViewSchema.requiredPermissions` and `DashboardSchema.requiredPermissions` drops its "not enforced yet" clause and says what the server does: a user who does not hold every capability is not listed the item and is refused it by name, a view container's list views are pruned the same way, and so are an object's own list views for a user who may not edit the object.
- The liveness ledger rows (`liveness/view.json` `list.requiredPermissions`, `liveness/dashboard.json` `requiredPermissions`) are `live`, citing the `/meta` read gate, and no longer carry `authorWarn`, so `os lint` / `os validate` stop warning `liveness-planned-property` when a view or a dashboard sets the key.
- The schemas themselves do not change: same shape, same accept set.
