---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection)!: install-local's cloud branch refuses every register the engine refuses, and keeps the lenient answer only for a fault (#31478)

Clause-②: no (narrowing) — `POST /api/v1/marketplace/install-local` with a cloud-fetched package (`packageId` + `versionId`) whose `manifest.register` throws a refusal declaring a 4xx status answers `422 PLUGIN_REGISTER_FAILED` where it answered `200` with `hotLoaded: false` and wrote the ledger entry. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is read differently: the narrowing is one runtime refusal at one door, for register refusals the inline branch of the same door already answers 422, and its remedy is the correction the engine's sentence names, so there is nothing for `objectstack migrate meta` to rewrite. A ledger entry an earlier build wrote this way is read as before at boot. -->

**BREAKING** for a cloud-branch install that relied on the lenient answer for a register the engine refuses.

- **Before.** The cloud branch refused only the registry's three held-name refusals (#25366, #31296, #31392). Every other register refusal was ledgered and answered `200` with `hotLoaded: false`, "loads at the next restart": a default record page another package holds, `isDefault: true` on a page that is not a record page, an object another package owns, an object name two packages of one artifact (or of one namespace shared through a declared dependency) define, a picklist no loaded package declares, a bound action whose object no loaded package registers. The next boot refused each again and loaded nothing.
- **Now.** Each is answered `422 PLUGIN_REGISTER_FAILED` with the engine's sentence, as the inline branch answers it. Nothing is ledgered, and an installed earlier version stays registered and ledgered. The door recognises a refusal by the status the throw declares (any 4xx), never by a list of classes or codes, so the held-name refusals are answered by the same rule.
- **Unchanged.** A register failure that declares no 4xx — an undeclared throw or a declared 5xx, the runtime's own fault — keeps the lenient answer (`200`, `hotLoaded: false`, `hotLoadError`) and loads at the next restart. A namespace held by a writable base is still refused `409 RESOURCE_CONFLICT` before the register.

**The remedy.** Make the correction the refusal names, then install again: rename or un-default the page, rename the object or `extend` the owner's, declare the picklist or the bound object (or install the package that brings it, and declare it in `manifest.dependencies`), or uninstall the holding package.
