---
'@objectstack/metadata-protocol': minor
---

feat(metadata-protocol)!: managed content is sealed — `OS_METADATA_WRITABLE` no longer opens a write onto, or a removal of, an item a managed package ships (ADR-0131 D6)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the change narrows what an operator environment variable opens at the runtime doors; no spec key, stored metadata shape or export a manifest names changes, every stored row loads and serves unchanged, and objectstack migrate meta has nothing to rewrite -->

**BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.

ADR-0131 D6: no door edits a managed definition. The operator hatch `OS_METADATA_WRITABLE` (and its legacy spelling `OBJECTSTACK_METADATA_WRITABLE`) used to open one: an item a managed package ships, of a type whose registry entry allows no environment overlay, could be overlaid and its overlay row removed once the type was named in the variable. Measured on the CRM example with `OS_METADATA_WRITABLE=flow,object,permission,position`, a shipped flow, an object field and a position each took an overlay row, `PUT /api/v1/automation/:name` re-registered the shipped flow, and `DELETE /api/v1/meta/object/crm_lead?dropStorage=true` took the managed object off the data plane.

**What changes.** With the hatch open or shut, the metadata doors now answer the same thing for an item a managed package ships: `403 NOT_OVERRIDABLE` on a write, and on a removal of a type whose overlay does not merge at read. The protocol's two package doors (`PUT` / `DELETE /api/v1/meta/:type/:name`, and the `/automation` definition doors that ask them), the repository's write path (draft promotion, restore, revert) and the read envelope (`editable` / `deletable`) all read one predicate: the item is artifact-backed and its type's registry entry opens no overlay channel.

- The refusal's first sentence names the managed package ("… is provided by a managed package and is sealed …"). A type with an ADR-0126 regime row (`flow`, `action`, `permission`) still names its sanctioned route, the clone or the switch. Every other type now reads the seal, says the hatch does not open a managed item, and keeps the source remedy; it no longer prescribes setting `OS_METADATA_WRITABLE`, which would no longer help.
- A write naming a read-only package (`?package=`) still answers `403 ITEM_LOCKED`, now without a hatch-dependent remedy. `SysMetadataRepository.readOnlyBaseOverrideError` takes `(type, packageId)`; its third `hatchOpen` parameter is gone, because nothing it chose survives the seal.

**What does not change.**

- The environment overlay of a `view`, `dashboard`, `report`, `translation` or `email_template` a package ships, which the registry allows.
- Everything about items no managed package ships: the hatch still opens their runtime creation for a type that allows none, and their organization-scoped write.
- Disabling a managed flow or action (`POST /api/v1/automation/:name/toggle`, `POST /api/v1/actions/_activation/:object/:action`), operator-gated under a wall as before, and cloning a flow under a new name, which records no linkage.
- Removing a stored overlay row of a type whose loader merges it at read (`permission`, `position`, `page`, `app`, `dataset`, `book`, `tool`, `skill`): that removal restores the package's definition and stays allowed.
- Every overlay row a deployment already holds keeps loading and serving as before.

**For an operator who set the hatch to customize a managed item.** Customize it through its type's route: an environment overlay for the five presentational types, the switch or a clone under a new name for a flow, the clone for a permission set, an extension package for an object. An overlay row the hatch wrote earlier onto a flow, action, hook, object or another type whose overlay does not merge at read keeps serving, and can no longer be edited or removed through the metadata API, with the hatch set or not.
