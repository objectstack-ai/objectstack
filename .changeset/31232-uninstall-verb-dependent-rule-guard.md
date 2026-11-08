---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol,runtime)!: the in-process uninstall verb is refused while an active validation rule reads a field the package adds through `objectExtensions`

Clause-②: yes (narrowing) — `protocol.deletePackage` now refuses, with `409 PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE`, an uninstall it used to perform for an in-process caller: one whose package adds a field through `objectExtensions` that an active validation rule of another enabled package reads.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes shape: what moves is the uninstall verb's answer to a request that would leave a validation rule reading a withdrawn field. Nothing at rest records that answer, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the uninstall verb (`@objectstack/metadata-protocol`, `@objectstack/runtime`): `deletePackage` asks every registered pre-uninstall guard before it reads or moves anything, and the runtime registers the dependent-rule check the package doors ask as one.

- **Before.** An in-process caller of `protocol.deletePackage` (a host's own uninstall tool, install-local's pair-install undo, the unmanaged-import rollback) withdrew the package's `objectExtensions` fields with no check. Another enabled package's active validation rule that read one of those fields then failed closed, so every write to that rule's object answered `400 VALIDATION_FAILED`, and with the package gone there was nothing left to re-enable.
- **Now.** While such a rule exists, `deletePackage` throws before it reads or moves anything: an error with `code` `PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE`, `status` `409`, and the package doors' sentence in its uninstall form under the lead `Package 'ID' cannot be uninstalled` (`… which the uninstall would withdraw — PACKAGE · OBJECT · RULE (reads FIELD). Switch off or change that rule first, or keep the package installed.`), naming every such rule with the fields it reads. `DELETE /api/v1/packages/:id` answers the same refusal through the same function, so the door and the verb cannot drift. The stored rows, the running registry, the environment's disable record and the uninstall cleanups are untouched. An uninstall no rule depends on, and an uninstall of a package that is already disabled, proceed exactly as before.
- **The seam.** `ObjectStackProtocolImplementation#registerUninstallGuard(name, guard)` is the before-half of `registerUninstallCleanup`: a guard answers `undefined` to let the uninstall proceed, or `{ code, status, message }` to refuse it; guards are asked in registration order and the first refusal is thrown; a guard that throws refuses with its throw. The types `UninstallGuard` and `UninstallGuardRefusal` are exported from `@objectstack/metadata-protocol`. A protocol with no guard registered uninstalls exactly as before. `AppPlugin` registers the runtime's guard (`runtime.package-dependent-rules`) at start, beside the disable-record clear.
- **Who moves.** An in-process caller that uninstalls a package whose field another package's active rule reads. The pair-install undo and the unmanaged-import rollback report the refusal as residue in their own failure answer, as they report any refused uninstall.

**The remedy.** Switch off or change the rules the message names first (a packaged rule can be switched off through the tenant overlay), then uninstall.
