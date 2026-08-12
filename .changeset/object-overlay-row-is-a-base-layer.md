---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata-protocol): an object's overlay row is a base layer, not its resolved schema (#8027)

**Behaviour change, and it is a payload gaining fields.** When a `sys_metadata`
overlay row exists for an object, `GET /meta/object/:name`, `GET /meta/object`
and the `effective` layer of `?layers=true` now serve that object's RESOLVED
schema — the overlay row as the base layer with its `objectExtensions`
contributors folded on (ADR-0029 D9.2) — where they previously served the stored
row verbatim. Any consumer of those routes sees the extension's fields appear on
customised objects. An object with no overlay row, and an object nothing
extends, are byte-identical (measured; see below).

**A second payload change, in the other direction:** on an in-process
(`bridged`) boot the by-name read and the `code` layer previously served every
extender-contributed `validation` and `index` TWICE. That duplication is
removed. It was a live regression introduced by #7556 (PR #8015) and is
explained under "the fold is not idempotent" below.

The defect: an overlay row for an object — an admin renaming the object's label
in Studio — was adopted as the resolved schema. `getMetaItem` took the stored row
as `item` and returned it; `getMetaItems` did the same through
`mergePackageAwareOverlay`, which picks a per-slot winner WHOLESALE rather than
merging fields; and `getMetaItemLayered`'s `effective` is `overlay ?? code`, so
it inherited the same body. D9.2 defines the resolution as `overlay ?? own` with
the `extend` contributors folded ON, which is exactly what
`SchemaRegistry.resolveObject` does for an overlay it knows about, and what
#7556 made the by-name read do for the MetadataService copy. The `sys_metadata`
path was the one adopter that never folded.

Measured with one `extend` contributor (three fields) and one env-wide overlay
row: `byName` and `listed` both served the object with NO extension fields,
while `layers.code` served them (#7556 folds it) and `layers.effective` did not
— so a single `?layers=true` response reported a `code` layer that has the
fields and an `effective` layer that does not, with an `overlay` layer showing a
customisation that explained none of the difference. The practical cost is the
#7556 shape again: an admin who customises a label silently removes three
extension-contributed fields from every writable form, while the data API keeps
accepting and persisting them.

**The fold is not idempotent, and that is the hazard this fix had to clear
rather than assume away.** `mergeObjectDefinitions` CONCATENATES `validations`
and `indexes` (`fields` is a key-keyed spread and the scalar props are
last-writer-wins, so those were always safe), so folding a body that has already
been through the fold duplicates both — and a duplicated index does not fail a
test, it fails a deployment. The precondition #7556 documented ("callers must
apply this only to a base that has not been through the fold") turned out to be
one no caller can honour, and two shipped call sites already violated it:

1. **The MetadataService body on an in-process boot.** ObjectQL's
   `bridgeObjectsToMetadataService` seeds that service from
   `registry.getAllObjects()` — bodies that are already resolved — so #7556's
   fold ran on a folded base and served every extender validation and index
   twice. Its own pin could not see this: it compares FIELD NAMES, and the field
   spread is idempotent.
2. **A stored overlay row.** The write path persists the request body verbatim
   (ADR-0005 §Validation), so the ordinary Studio GET → edit → PUT round-trip
   stores whatever the read served — and since #7556 that read is folded. The
   row is *defined* by D9.2 as the base layer, but nothing enforces it, and
   seeded / imported / migrated / pre-existing rows are unconstrained besides.

So `SchemaRegistry.foldObjectExtendersOnto` was made IDEMPOTENT instead of
documented harder: an entry the `extend` contributors are about to add, already
present in the base, is removed first and then re-added by the fold exactly
once. Extenders are still concatenated against each other — two contributors
declaring an identical rule still yield two, matching `resolveObject` — so
nothing the fold did on an unfolded base is narrowed, and such a base is
returned by reference, byte-identical.

Levels: `metadata-protocol` is `patch` — it restores the contract these routes
were already specified to answer, and it is the same reasoning #7556 used for
the same routes. `objectql` is `patch` — no new public API (`foldObjectExtendersOnto`
already exists since #7556); its documented contract moves from "not idempotent,
callers must guarantee an unfolded base" to "idempotent", which is a defect fix
rather than a capability, and no caller can be relying on duplicated validations.

Pinned against the REGISTRY'S RESOLVED SCHEMA, in
`packages/rest/src/meta-object-overlay-extension-fold.test.ts`, deliberately not
as agreement between the two routes: #7556's `byName === listed` pin is green
throughout this defect, because here both routes agree — on a body that has
already lost the fields. Its author said so explicitly rather than let the pin
imply coverage it did not have. Eight cases over real handlers / real protocol /
real registry: the overlay case on both routes and on `layers.effective`; `code`
and `effective` agreeing when the row customises nothing; `layers.overlay` still
reporting only what the tenant stored (an extension is not a tenant
customisation — the boundary #7556 drew); an already-folded row and a bridged
host holding the idempotency; the no-overlay and no-extension controls; and an
anti-vacuity case pinning that the fixtures ARE discriminated.

Byte-identity measured directly, by dumping all three surfaces for nine hosts
under this branch and under the pre-fix behaviour: 8 of 9 identical. The one that
differs is the extended object on a `bridged` host, where the pre-fix payload
carries `['owner_rule','ext_rule','ext_rule']` / `['owner_idx','ext_idx','ext_idx']`
and this branch carries each once — the #7556 regression, repaired.
