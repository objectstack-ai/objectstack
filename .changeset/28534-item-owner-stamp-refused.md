---
"@objectstack/objectql": patch
---

Clause-②: no
Metadata-protocol: none

fix(objectql): a collection item never names its own owning package

`registerApp` (a manifest and its nested plugins) and the `manifest` service's ADR-0130 residual registration now
refuse a collection item whose body already carries a `_packageId` other than the package registering it, with
`VALIDATION_ERROR` / 400 at `_packageId`, the envelope of the permission-set owner refusal beside it; seed datasets
are judged the same way. The registration stamps `_packageId` only while it is unset, so a body could wear another
package's id — an installed connector naming the host's own package, or an id nobody holds — and every reader of an
item's owner (the connector materializer deciding whose directory a file ref resolves against among them) read the
body's claim about itself. A stamp equal to the registering package (an item re-registered under its own package)
and an absent stamp register as before; `null` and `''` are refused. Fix by removing `_packageId` from the item: the
package an item belongs to is the one that registers it.

The `manifest` service also records which door registered each multi-package artifact's residual owner
(`ObjectQL.recordResidualOwner` / `residualOwnerSource`: `'code'` for the boot, `'marketplace'` for an install), the
only record of that id's origin, since the residual has no package row.
