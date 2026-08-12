---
"@objectstack/objectql": patch
---

fix(objectql): uninstalling a package now removes the non-object metadata it shipped (#7221)

"Unregister all metadata from a package" reached only `objectContributors`, so
every non-object item a package shipped — its `page`, `view`, `flow`, `app`,
`api` … — stayed registered and fully resolvable after the package was gone.
Not a stale-cache nuisance: an uninstall that leaves the package's UI and API
metadata installed.

A package writes into two stores. `SchemaRegistry.unregisterObjectsByPackage`
walks the contributor list; everything else lives in the generic `metadata` map
under the composite `${packageId}:${name}` key `registerItem` builds, and no
verb removed those. Measured on the real registry: after
`uninstallPackage('crm')` the package record was gone while
`getItem('page', 'home')` kept serving the uninstalled package's page and
`metadata.get('flow')` still held `crm:onboard`, for the life of the process.
The same call through `MetadataFacade.unregisterPackage` additionally left the
generic-map half of the package's objects behind as a genuine orphan.

`SchemaRegistry.unregisterItemsByPackage(packageId)` is the missing verb, and it
sits on the registry rather than privately on the facade because **both** callers
were measured to have the gap — `uninstallPackage` is registry-direct and shares
it exactly. A private copy in the facade would have been a second expression of
the same package-ownership rule, and would have left every registry-direct
uninstall still half-done. Membership is the exact inverse of the construction in
`registerItem`, so a discriminated type's whole i18n bundle leaves with the
package that shipped it, and a scoped package id (`@acme/crm`) is handled by the
same relation.

**Tenant overlays are deliberately kept.** A bare-key entry is the ADR-0005
runtime/DB overlay slot — a tenant's own customization, carrying no package
provenance and with no separate contributor list holding a durable copy. An
uninstall that deleted it would take tenant-authored data along with the package
it merely overlaid, so the sweep is scoped to composite keys only. The
consequence — an overlay that now layers over nothing — is made **loud** rather
than silently deleted or silently kept, the same house pattern as ADR-0029
D9.5's orphan-overlay violation: the verb warns naming every orphan it left and
returns them as `orphanedOverlays` for a caller that wants to act. What nothing
yet does with that report is filed separately as #7951.

This is deliberately **not** the object-side D9.7 rule ("an overlay layer leaves
with the base it layers over"), which is safe only because an object overlay
layer is a runtime projection of a `sys_metadata` row the removal does not touch.

Ordering: in both callers the item sweep runs after the object verb, because that
one can refuse (ADR-0029 extenders) — a refused uninstall removes nothing at all.

Unaffected: another package's same-named items (including a package id that is a
string prefix of another), runtime-authored items with no package, and the
persisted `sys_metadata` rows — a distinct mechanism this change does not reach
into.
