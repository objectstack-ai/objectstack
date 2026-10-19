---
'@objectstack/objectql': minor
---

fix(objectql)!: an `objectExtensions` entry no longer adds platform system columns to the object it extends, so an extension of `sys_organization` or `sys_user` no longer hides the record from its own organisation

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served field set of an extended object whose own declaration withholds injected columns: no stored metadata changes shape, no spec key, export or error code is added or removed, and an author has nothing to rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); the change is the registry's runtime planning, not a declaration or a type (not runtime-interface-only or type-surface-only); and nothing exported is removed (not runtime-export-retired). -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The registry ran the injected-system-columns plan on every contributor, an extension body included. An extension body carries none of the keys the plan reads (`managedBy`, `systemFields`, `tenancy`, `ownership`), so it was planned as an ordinary object, and the merge added `organization_id`, `created_by` and `updated_by` (and on a non-`sys_` target, `owner_id` and `owning_business_unit_id`) to a target whose own declaration withholds them. On a multi-tenant deployment an extension of `sys_organization` or `sys_user` (`managedBy: 'better-auth'`) therefore created an `organization_id` column that is NULL on every row, and the tenant wall then answered a member's list of their organisation and of the users with `[]`, and their own records `404 RECORD_NOT_FOUND` by id. The injected definition also replaced a column the target declares itself.

Now only a base layer (the owner, or a tenant overlay) is planned. The extended object's system columns are its base layer's, in whichever order the two packages register.

- **Served less now:** an extended object whose declaration withholds a system column no longer reports or stores it. This covers `managedBy: 'better-auth'`, `systemFields: false`, `tenancy.enabled: false` and an `ownership` other than `user`. For example, `sys_sso_provider` (which plugin-auth extends with `oidc_client_secret`) no longer carries `created_by` or `updated_by`, and its `organization_id` is again the `text` column the object declares instead of the platform's read-only lookup.
- **Unchanged:** the extension's own fields, labels, validations and indexes merge exactly as before. An audit field an extension declares (`created_at`, `created_by`, `updated_at`, `updated_by`) is still forced read-only wherever the target carries the audit family. An extended ordinary object carries the same system columns, which come from its owner. No existing column is dropped from a database: a column an earlier release created stays in the table, and the registry no longer declares it.

What changes for you: nothing to rewrite. If code read `organization_id`, `created_by` or `updated_by` on an extended `sys_*` identity object, it read a NULL column that the object never declared. Read the owner's own columns instead.
