---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: an unmanaged install renamed into a `targetNamespace` refuses a stray-object package and a declared namespace its object names do not carry, instead of copying them under a second prefix

Clause-②: no (narrowing)
Metadata-protocol: none
Ruling-ref: #36166 comment 7146137652

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer the unmanaged install gives one request: a package body renamed into a `targetNamespace` whose object names contradict its namespace, declared or derived. No stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller of the unmanaged install (`importUnmanagedPackage`, and `POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'`) that sends a `targetNamespace`. Two more package bodies are refused before the base exists, `400 INVALID_REQUEST` with one `details.refused` entry per object, and nothing is installed:

- **A package that declares no `namespace`, with a stray object.** The refusal for object names sharing one first word other than the namespace derived from the id now applies to every group of two or more such names, not only when every object shares it. `demoasset_asset`, `demoasset_site` and `site` used to copy into `trialdemoasset` as `trialdemoasset_demoasset_asset`, `trialdemoasset_demoasset_site` and `trialdemoasset_site`; now `demoasset_asset` and `demoasset_site` are refused, each entry naming the derived namespace and the shared prefix. Two objects sharing a short first word are refused with a stray as without one (`purchase_order`, `purchase_item` beside `vendor`). One object carrying the derived prefix still clears it.
- **A package that declares a `namespace` its object names do not carry.** Each object the package's own prefix rule refuses (the rule `defineStack` and the save door already hold every authored package to) is refused, naming the declared namespace. `namespace: 'other'` with `demoasset_asset` used to copy as `trialdemoasset_demoasset_asset`, and a package declaring `crm` with an object named `ticket` copied it as `trialdemoasset_ticket`; both are refused now. Without a `targetNamespace` the save door already refused both (`422 NAMESPACE_PREFIX`).

Unchanged: a single object with no namespace declared keeps the rename, foreign prefix or not (`demoasset_asset` alone copies as `trialdemoasset_demoasset_asset`), because one name cannot tell a two-word short name from a foreign prefix. So do object names that share no first word (`purchase_order` beside `asset_owner`), and a declared namespace the names carry.

The fix is in the package: declare `namespace` on it and name every object under that namespace, then install again.
