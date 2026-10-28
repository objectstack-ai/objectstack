---
'@objectstack/spec': patch
---

docs(spec): the `allowExport` doc comment no longer says the built-in admin permission sets grant export

Clause-②: no
Metadata-protocol: none

The comment on `allowExport` in `permission.zod.ts` said the built-in admin sets carry the export grant. They do not: `admin_full_access` and `organization_admin` hold the super-user bits but no `allowExport`, so an admin holding only those sets sees no Export control and the export route answers `403 EXPORT_NOT_PERMITTED`. The comment, and the "Permission sets" and "Permissions matrix" doc pages, now say so and name the way to grant export: bind the admin to an app or environment permission set that names each object with `allowRead: true, allowExport: true`. No behaviour changes; the shipped sets are untouched.
