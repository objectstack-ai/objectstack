---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): uninstall no longer orphans a package's env-wide `sys_metadata` rows (#7705)

`protocol.deletePackage` selected the rows to remove with a strict
`organization_id` equality:

```ts
const where = { package_id: request.packageId };
if (request.organizationId) where.organization_id = request.organizationId;
```

Against rows stored **env-wide** (`organization_id IS NULL`) that predicate
matches nothing, so an uninstall issued by a session with an active
organization removed only whichever rows happened to be org-scoped and left
every env-wide row behind — while reporting a nonzero `deletedCount` and
`success: true` over the survivors. The package's metadata stayed in
`sys_metadata` after its uninstall "succeeded", and a reinstall then collided
with the rows that were never removed.

Env-wide is where a package's metadata normally lands, which is why this was
the common case rather than a corner: the REST `PUT /meta/:type/:name` save
path does not thread the session's active organization, and AI-authored
metadata is written env-wide too. Measured on a real engine over SQLite, an
org-scoped uninstall of a package holding three env-wide rows and one
org-scoped row deleted **1 of 4** and reported success.

An org-scoped uninstall now matches its own organization **or** env-wide, the
same `$or [{organization_id: oid}, {organization_id: null}]` shape this package
already uses for the #3115 "orphaned draft" fix, and the same shape the SQL
driver's own implicit tenant wall uses (`field = :tenant OR field IS NULL`,
#2734).

Scoping is unchanged in both directions that must not widen: another
organization's rows for the same package are still out of scope for an
org-scoped uninstall, and another package's rows are never touched. An
uninstall issued with **no** organization is also unchanged — it stays
package-wide, because the direct-mount REST door passes no organization at all
and narrowing that branch to env-wide-only would orphan every org-scoped row
instead.
