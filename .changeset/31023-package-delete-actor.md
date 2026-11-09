---
'@objectstack/runtime': patch
---

fix(runtime): `DELETE /api/v1/packages/:id` credits its deletes to the signed-in user, and the uninstall verb clears the package's disable record for every caller

Clause-②: no
Metadata-protocol: none

The package `DELETE` door now hands `deletePackage` the request's authenticated user, as the other package write doors already do (ADR-0146 D1), so each metadata row the uninstall removes is credited to that user: the audit log row's user and the history tombstone's `recorded_by`. A caller with no user id (a system context) still sends no actor, and its deletes stay unattributed.

A deleted package's per-environment disable record is now cleared by the uninstall verb itself, through a runtime uninstall cleanup (`runtime.package-state`) that `AppPlugin` registers on the protocol. Before, only the HTTP door cleared it, so an in-process `deletePackage` (a host's uninstall tool, install-local's `DELETE` and pair-install undo, the unmanaged-import rollback) left the id listed and the next boot brought a reinstalled package back disabled. The clear writes the key the boot reads, in the host's package-state store when one is registered and the file under `OS_HOME` otherwise; a store that refuses shows as that cleanup's failed outcome in the uninstall's `cleanups`. On a kernel that registers no such cleanup, the door still clears the record itself.
