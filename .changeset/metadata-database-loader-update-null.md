---
'@objectstack/metadata': patch
---

`DatabaseLoader`'s private driver-path update helper is typed with the `null` arm `IDataDriver.update()` now declares; both of its callers discard the result. No runtime behaviour changes.
