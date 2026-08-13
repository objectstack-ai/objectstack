---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `GET /api/v1/meta/<type>` stops listing a skill twice after a runtime PUT (#7654)

`PUT /api/v1/meta/skill/<name>` returned 200 and then `GET /api/v1/meta/skill`
served the skill **twice** — the store-override row and the package row, side by
side, disagreeing about `active`. Nothing about the pair told a caller which one
was the effective document.

`getMetaItems` merges three layers, and two of them answered the identity
question differently:

- `mergePackageAwareOverlay` — the `sys_metadata` overlay merge — resolves per
  `(slot, package)` and treats a **package-less** row as *standing in for* each
  package's row of that name, which is exactly how
  `getMetaItem(name, packageId=P)` resolves.
- the MetadataService merge one layer below keyed a hand-rolled `Map` on
  `(package, name)` with **strict** equality, so a package-less row occupied a
  slot of its own instead of standing in for anything.

A runtime PUT carries no `?package=`, so the row it writes is
`package_id IS NULL`. For a type whose baseline arrives through the
MetadataService rather than the SchemaRegistry — `skill`, `agent`, `tool` reach
it through that service's own loaders — the registry listing is empty, so the
overlay merge had no base row to take provenance from and left the override body
with no `_packageId`. Its key then missed the package-bearing baseline row in
the merge below, the "already present, do not overwrite" guard never fired, and
both rows were served.

The MetadataService merge now runs **that same package-aware resolution** rather
than a second implementation of it: the runtime listing is the base layer and
the registry-plus-overlay result is the higher one, so the documented precedence
(a `sys_metadata` customization wins over the artifact baseline) is preserved
while the two steps can no longer disagree about what a package-less row means.

**Not a `skill` special case.** The same shape was measured duplicating for
`agent`, `tool` and `page`; the mechanism is the merge's attribution rule, not
the type, and the fix closes the mirrored attribution too (a package-less
baseline under a package-bearing higher row). Where a name is shipped by two
packages, both rows are still served — ADR-0048 resolution is unchanged — and a
package-less override now reaches both of their slots.

Also visible: the surviving row carries the `_packageId` of the package it
overrides, so provenance, the package filter and the disabled-package filter see
an override the way they already see a registry item.

Unaffected: i18n bundles (`email_template`) keep every locale — the slot, and so
the discriminator, is computed by the same function either way — and a type with
no `metadata` service installed takes the same path it always did.
