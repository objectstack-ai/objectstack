---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): a marketplace install-local uninstall the registry would refuse is refused 409 before the ledger write, naming the pair or the extender, with nothing removed (#28511)

Clause-②: no (narrowing) — `DELETE /api/v1/marketplace/install-local/:manifestId` now refuses `409 RESOURCE_CONFLICT` the uninstall of a package whose paired customization package (`ID.custom`) is installed, or that owns an object another package extends (ADR-0029), an uninstall that answered 200 before; nothing is widened.
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches uninstalling through the install-local door, so every taught use stays true.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: an uninstall the running registry already refuses is now refused at the install-local door before its ledger write, with the registry's existing RESOURCE_CONFLICT / 409 refusal, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the install-local uninstall door (`@objectstack/cloud-connection`, ADR-0146 D3).

- **Before.** The door removed the ledger entry first and only then asked the registry to withdraw the package. A registry refusal (the base's `.custom` pair installed, or an extended object) was caught there and folded into a 200 with a failed `registry.uninstallPackage` entry in `cleanups`. The package stayed registered until the next restart, and the restart then dropped it from under its pair, stranding every customization the pair holds.
- **Now.** The door asks the registry the same question first, through `SchemaRegistry.assertPackageUninstallable` (the one predicate `uninstallPackage` asks, which mutates nothing). On a refusal it answers that refusal's own `409 RESOURCE_CONFLICT` and sentence, which names the pair and the extenders and opens with the way out. The ledger entry, the registration and the pair stay as they were, and no cleanup runs.
- **Unchanged.** An uninstall the registry would let go keeps the ledger-first order (the ledger entry is removed, then the package is withdrawn, then the cleanups run). An id this door never installed still answers 404. A host with no `objectql` registry, or a registry without the predicate, is not asked and behaves as before.

**The remedy.** Delete the pair (export it first to keep its customizations: `GET /api/v1/packages/PAIR/export`) or uninstall the extending packages, then uninstall the base again.
