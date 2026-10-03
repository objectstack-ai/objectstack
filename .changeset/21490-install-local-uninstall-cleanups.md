---
'@objectstack/cloud-connection': patch
'@objectstack/metadata-protocol': minor
---

fix(cloud-connection): an install-local uninstall runs the protocol's registered uninstall cleanups, so the package's permission sets and their grants go with it

Clause-②: yes

`DELETE /api/v1/marketplace/install-local/:manifestId` removed the package's ledger entry and nothing else. After a restart the package's objects were gone, but its `managed_by: package` rows in `sys_permission_set`, and every grant of them, survived the uninstall. That broke ADR-0090's "No ghost grants" promise on this door.

The door now runs the uninstall cleanups that domain plugins register with the protocol (`registerUninstallCleanup`) once the ledger entry is gone. It uses the same registry and the same runner as the protocol's own uninstall, so `plugin-security`'s `security.package-permissions` cleanup removes the package's sets with their position and user bindings, and any cleanup registered later fires here too. The cleanups run with the package's manifest id and no organization, because an install-local package is installed for the whole runtime.

The response carries each outcome as `data.cleanups`, the way the protocol's uninstall reports them. A failed cleanup is reported there and named in the operator log with its remedy (install the package again, then uninstall it again). When the protocol cannot run the cleanups, the response says so as one failed `protocol.runUninstallCleanups` outcome. An uninstall that does not happen (a refused caller, an id this door never installed, a ledger write that fails) revokes nothing.

`@objectstack/metadata-protocol`: `ObjectStackProtocolImplementation` gains `runUninstallCleanups({ packageId, organizationId?, actor? })`, the one runner of the uninstall-cleanup registry. It runs every registered cleanup for the package and answers one `UninstallCleanupOutcome` per cleanup. It never throws: a failed cleanup is an outcome, and a thrown fault's driver text goes to the operator log, not into the outcome. `deletePackage` now calls it as its last step in place of its own loop, and its `cleanups` are unchanged. The only visible difference there is the log tag of a failed cleanup's warning, now `[protocol.runUninstallCleanups]` instead of `[protocol.deletePackage]`.

`@objectstack/cloud-connection` now declares its dependency on `@objectstack/metadata-protocol`, which it already received through `@objectstack/runtime`, for the cleanup outcome types.
