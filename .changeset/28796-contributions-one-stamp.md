---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime): the customizations read's `contributions` attributes a field and a flow by the same stamp rule

Clause-②: no
Metadata-protocol: none

`GET /packages/:id/customizations` now applies one rule to both kinds of contribution. A field from another package's object extension and a flow that package ships are listed only when their package stamp is a code package's: not the package-less `sys_metadata` sentinel, not a tenant-authored body, and not the base or its `.custom` pair. Before this, flows were judged that way and fields only by the package id. Nothing in an installed composition reads differently, so who is listed and the shape of the answer do not change.

The `GetPackageCustomizationsResponseSchema` docblock now names exactly what `contributions` lists, and where the pair's items are instead: its overrides in `overrides`, its extension members in `extensions`, and no other pair flow in any list.
