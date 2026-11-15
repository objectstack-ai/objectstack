---
'@objectstack/spec': patch
'@objectstack/metadata': patch
---

docs(metadata): `IMetadataService.unregisterPackage` and `MetadataManager.unregisterPackage` say that an uninstall UI must call `MetadataManager.unregisterPackageWithReport` and show each `kept` item, because the `void` answer cannot tell a complete uninstall from one that kept items (#32985)

Clause-②: no — documentation comments only; no answer moves.
Metadata-protocol: none
