---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection)!: install-local's cloud branch refuses a package whose namespace or security catalog name another package or a built-in holds (#31392)

Clause-②: no (narrowing) — `POST /api/v1/marketplace/install-local` with a cloud-fetched package (`packageId` + `versionId`) whose register the registry refuses because another installed package owns its namespace, or because another package or a built-in holds a position, permission set or capability name it ships, answers `422 PLUGIN_REGISTER_FAILED` where it answered `200` with `hotLoaded: false` and wrote the ledger entry. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is read differently: the narrowing is one runtime refusal at one door, for two registry refusals the inline branch of the same door already answers 422, and its remedy is the rename or uninstall the refusal names, so there is nothing for `objectstack migrate meta` to rewrite. A ledger entry an earlier build wrote this way is read as before at boot. -->

**BREAKING** for a cloud-branch install that relied on the lenient answer for a held namespace or a held security catalog name.

- **Before.** The cloud branch refused two of the registry's held-name refusals: a security catalog name the environment catalog holds (#25366) and a bare name another package holds (#31296). A package whose `manifest.namespace` another installed package owns (with no declared dependency on it), or that ships a position, permission set or capability name another package or a built-in holds, was refused by the registry and then ledgered anyway, answering `200` with `hotLoaded: false`, "loads at the next restart". It does not: both checks run again at every load with no seal, so the next boot refuses the registration again.
- **Now.** Both refusals are answered `422 PLUGIN_REGISTER_FAILED` with the registry's sentence naming both holders, as the inline branch answers them. Nothing is registered or written, and an installed earlier version stays registered and ledgered. The door recognises the registry's three held-name refusals by their own code and `name`, never by a list of types or holders.
- **Unchanged.** Any other register failure on the cloud branch keeps the lenient answer (`200`, `hotLoaded: false`, `hotLoadError`). Under `OS_METADATA_COLLISION=warn` the registry throws nothing for a held namespace, so the install proceeds as before. A namespace held by a writable base is still refused `409 RESOURCE_CONFLICT` before the register.

**The remedy.** Rename the item (or choose another namespace) in the incoming package, declare the holding app in its `manifest.dependencies` when it extends that app, rename the item in the holding package, or uninstall that package, then install again. A built-in name is never available to a package.
