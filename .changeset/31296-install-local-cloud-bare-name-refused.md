---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection)!: install-local's cloud branch refuses a package declaring a bare name another package holds (#31296)

Clause-②: no (narrowing) — `POST /api/v1/marketplace/install-local` with a cloud-fetched package (`packageId` + `versionId`) whose register the registry refuses for a bare-name clash answers `422 PLUGIN_REGISTER_FAILED` where it answered `200` with `hotLoaded: false` and wrote the ledger entry. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is read differently: the narrowing is one runtime refusal at one door, for one registry refusal the inline branch of the same door already answers 422, and its remedy is the rename the refusal names, so there is nothing for `objectstack migrate meta` to rewrite. A ledger entry an earlier build wrote this way keeps loading at boot, beside the cold boot's warning. -->

**BREAKING** for a cloud-branch install that relied on the lenient answer for a bare-name clash.

- **Before.** The cloud branch refused only the security catalog's environment-held refusal (#25366). A package declaring an item of a bare-name type (a flow, a webhook, a connector, an email template, a dataset, a mapping, a picklist, an API, an object-less action) under a name another installed package or the platform holds was refused by the registry and then ledgered anyway, answering `200` with `hotLoaded: false`. At the next restart the entry loaded before the cold boot sealed the holders, so the boot admitted the clash with one warning, and every consumer resolving the name was served one of the two packages' items by registration order.
- **Now.** That refusal is answered `422 PLUGIN_REGISTER_FAILED` with the registry's sentence naming both holders and the rename, as the inline branch answers it. Nothing is registered or written, and an installed earlier version stays registered and ledgered. The door recognises the registry's refusal by its own brand, never by a list of types, so a type the rule covers later is refused the same way.
- **Unchanged.** Any other register failure on the cloud branch keeps the lenient answer (`200`, `hotLoaded: false`, `hotLoadError`). An environment-held security catalog name is still refused `422`.

**The remedy.** Rename the item in the incoming package (the refusal names the namespaced rename), rename it in the package that holds it, or uninstall that package, then install again.
