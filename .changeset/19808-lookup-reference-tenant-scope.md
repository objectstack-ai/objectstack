---
"@objectstack/objectql": patch
---

fix(objectql): a lookup can no longer point at a record in another organization

When a user in one organization saved a `lookup` (or any other reference field) whose id named a record that exists only in a **different** organization, the write was accepted and the cross-organization link was stored. An id that exists nowhere was refused. So a caller could tell "this id belongs to another organization" apart from "this id does not exist", without being able to read that record.

The reference check now looks only where the caller's organization can see. A record in another organization is treated exactly like a record that does not exist: the write is refused with the existing `VALIDATION_FAILED` error, and the field error code is `reference_not_found`. This applies on create, on update by id and on bulk update. The two cases now give the same response.

What does not change:

- References inside the caller's own organization resolve as before.
- References to platform-global objects (`tenancy: { enabled: false }`) and to federated (`external`) objects still resolve from any organization. The engine already sends no tenant to the driver for those objects.
- The check still ignores row-level security. A user can still link to a record they are not allowed to read, as long as it is in their organization (or in their membership set under the `group` tenancy posture). Whether they may create that link at all is still decided by the permission layer.
- System-context writes (seed replay, package install, provisioning) are still not checked.
- The dangling-reference audit (`inspectDanglingReferences`) still checks existence across all organizations.

One case to check if your deployment uses it: an object made global only by the deployment's `platformGlobalObjects` setting (not by its own `tenancy: { enabled: false }`) is still scoped by organization when the database is read. So a reference to a record of that object that another organization created is now refused. This matches what the caller already gets when reading that object directly. Records with no organization still resolve.
