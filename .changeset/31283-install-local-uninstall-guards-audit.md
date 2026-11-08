---
'@objectstack/cloud-connection': patch
'@objectstack/metadata-protocol': patch
---

fix(cloud-connection,metadata-protocol)!: install-local's uninstall door asks the uninstall verb's guards and writes its audit row (#31283)

Clause-②: yes (narrowing) — both arms. Narrowing: `DELETE /api/v1/marketplace/install-local/:manifestId` refuses, with the uninstall verb's guard refusal (today the runtime's `409 PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE`), an uninstall it answered `200` before: one that would withdraw a field an active validation rule of another enabled package reads. Widening: two new public members of `ObjectStackProtocolImplementation` (`@objectstack/metadata-protocol`), `runUninstallGuards` and `recordPackageUninstall`, and one new exported type, `PackageUninstallRecord`.
Metadata-protocol: none
Skills-docs: one move — `content/docs/deployment/marketplace-handbook.mdx` (Uninstalling) states the refusal and the audit row; no `skills/**` page teaches this door's uninstall.

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is read differently: the narrowing is one runtime refusal at one door, the refusal `DELETE /api/v1/packages/:id` already answers for the same package, and its remedy is the rule it names (switch the rule off or change it, or keep the package installed); the two protocol members are additions, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** for a caller of install-local's uninstall door that uninstalled a package another package's active validation rule depends on.

- **Before.** `DELETE /api/v1/marketplace/install-local/:manifestId` withdrew the package and ran the protocol's uninstall cleanups, but never went through the uninstall verb (`deletePackage`), so it skipped what the verb does before and after: the pre-uninstall guards (the runtime's dependent-rule refusal) and the package's own `package_uninstall` audit row. Uninstalling a package whose `objectExtensions` field an active rule of another package reads answered `200`; the field left the served object and the rule then failed closed on every write to it. No uninstall through this door was audited.
- **Now.** The door asks the verb's guards before anything moves, through the protocol's one runner of them (`runUninstallGuards`, which `deletePackage` asks too), and answers a refusal as the guard spelled it — code, status and message — with the ledger entry, the registration and the served fields as they were. A completed uninstall writes one `package_uninstall` row through the protocol's one writer of it (`recordPackageUninstall`, which `deletePackage` calls too), naming the package, the version removed and the operator.
- **Unchanged.** `deletePackage` asks the same guards and writes the same row as before. A runtime with no audit plugin writes no row; a protocol from a build without the two members is not asked, and the door behaves as before.

**The remedy.** Switch off or change the rule the refusal names, or keep the package installed.
