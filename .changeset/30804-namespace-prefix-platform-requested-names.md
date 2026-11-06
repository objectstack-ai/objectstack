---
'@objectstack/cli': patch
---

fix(cli): `os lint`'s `naming/namespace-prefix` no longer asks a package to rename the `guest_portal` permission set

Clause-②: no
Metadata-protocol: none

The public form doors' submit context requests the permission set named exactly `guest_portal`, and the result masker resolves a set registered under that name. A package that declares it is plugging into that door. Renaming it to `<namespace>_guest_portal`, which the warning used to suggest, would leave the masker with nothing to find. `os lint` now leaves that one name alone in `permissions`. The same spelling in any other collection, or any other permission set name, is still judged.
