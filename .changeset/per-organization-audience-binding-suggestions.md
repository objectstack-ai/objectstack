---
"@objectstack/plugin-security": patch
---

Reconcile audience-binding suggestions per organization (ADR-0090 D5/D9)

`sys_audience_binding_suggestion` rows are per-tenant by construction — a
package suggests, and a TENANT admin confirms — but the reconciler read and
wrote through a module-level `{ isSystem: true }` context carrying no tenant.
On a shared-runtime multi-organization installation that produced ONE
organization-less row that every tenant read: the first admin to confirm or
dismiss answered for all of them, while the binding their confirm created
existed only in their own organization, so every other tenant's users never
received the package's default permission set and the surface reported the
suggestion resolved.

- every read and write in the module now carries `{ isSystem: true, tenantId }`
  — the anchor lookup, the "is it already bound?" lookup, and the
  list/confirm/dismiss paths, not just the writes;
- `reconcileAudienceBindingSuggestions` is the new entry point the runtime
  calls: one pass per organization under a `group`/`isolated` posture, and the
  publishing organization alone on the package-door publish path;
- pre-existing organization-less rows are reaped before the passes and
  regenerated per organization. Without that, ADR-0120 D3's platform bucket
  keeps showing the old row to every tenant and the per-organization passes
  create nothing at all. No permission binding is touched by the reap.

A `single`-posture deployment is unchanged: exactly one organization-less pass,
and no reap.
