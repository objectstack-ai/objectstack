---
'@objectstack/objectql': minor
'@objectstack/plugin-auth': minor
---

fix(objectql, plugin-auth)!: deleting an organization that still owns records is refused with 409 and a per-table count, before anything is deleted; an empty one is deleted whole, its teams and organization-admin grants with it; the engine never clears a tenant column

**The 18.0.0 defect this fixes.** `POST /api/v1/auth/organization/delete` ran better-auth's delete, which removes the organization's members, then its invitations, then the organization row, as three separate writes. The engine's delete cascade then applied the tenant column's `set_null` default to every row the organization still owned. On a database whose tenant column is NOT NULL (one that took the v18 organization-ownership ceremony), the delete answered 500 on `sys_team.organization_id` after the members and invitations were already gone, so the organization survived with no owner and nobody could delete it. On a database 18.0.0 created, where the column is still nullable, the delete answered 200 and left the organization's teams and records with `organization_id = NULL`, owned by nobody and visible to nobody. Every organization created through the door owns a default team, so on a NOT NULL database not even an empty organization could be deleted. Deployments that run `single` are not reached: their one organization keeps the last-administrator guard's 403, and they cannot create another.

**What happens now.**

- An organization that still owns records is refused with `409` and the standard `DELETE_RESTRICTED` code. The body names each table and its row count, `dependents: [{ object, count }]`, and never a row's values. The refusal runs before better-auth's handler, so nothing is written, the caller's active organization included. A caller the organization does not let delete it still gets better-auth's own `403`, with no count.
- An organization that owns nothing but its own auth structure is deleted whole: its members and invitations (better-auth), and its teams, their members and the organization-admin grants its owners and admins hold (plugin-auth, from `beforeDeleteOrganization`). Any other grant scoped to the organization counts as a record.
- The request runs as one engine transaction and rolls back on any error answer, so a delete either removes all of that or none of it. On a datasource whose driver has no transactions, the refusal above is the guarantee, because it runs before the first write.
- Under all of this, the engine itself refuses to delete a `sys_organization` row while any row still names it in its tenant column, whatever path reaches the delete: `409 DELETE_RESTRICTED` with the same `dependents` list. A tenant column is never set to NULL. Other lookups to `sys_organization`, such as a session's active organization, are cleared as before.
- `ObjectQL.organizationOwnedRowCounts(organizationId, { exclude })` answers, per object, how many rows name an organization in their tenant column. It is the question the refusal asks.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer the organization delete gives while the organization still owns records (409 instead of a 500 that left a partial delete, or a 200 that orphaned the rows to NULL), and the engine's answer to a `sys_organization` delete that rows still name in their tenant column. The remedy is an operator action on the organization's records, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed, one engine method is added (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the organization delete's accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** deleting an organization that still owned records answered `500` after deleting its members and invitations (tenant column NOT NULL), or `200` with its teams and records orphaned to `organization_id = NULL` (tenant column nullable, an 18.0.0-born database). A direct engine delete of such a `sys_organization` row did the same.
- **TO:** both answer `409 DELETE_RESTRICTED`, with `dependents: [{ object, count }]` naming every table that still holds rows. Nothing is deleted or changed.
- **Fix:** delete the organization's records, or move them to another organization, then delete the organization. The refusal names the tables to look at.
- **Already orphaned on 18.0.0?** Rows an earlier organization delete set to `organization_id = NULL` are not touched by this release. Organization-less rows are what the v18 organization-ownership ceremony (`os migrate organization-ownership`) attributes or reports.
