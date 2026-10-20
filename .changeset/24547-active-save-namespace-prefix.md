---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: the direct metadata save and the per-item publish refuse an object whose name lacks its package's namespace prefix, as the package draft publish already does

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the direct (publish-mode) metadata save door and at the per-item publish door of an object name that the package draft publish pre-flight, `os validate` and `os build` already refuse under ADR-0129 D2: no authorable key, spelling, export, error code or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose name lacks its package's prefix keeps loading and serving; the repair is a new object under the prefixed name, which moves its table and so is the author's decision, not something a ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these doors (not already-registered); and the change is a door verdict, not a declaration or an export (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing on the metadata save and publish doors), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0129 D2: a package declares its prefix once (`manifest.namespace`), and every object it defines is named `${namespace}_${shortName}`. The package draft publish (`POST /api/v1/packages/:id/publish-drafts`) refused an object draft without that prefix with `NAMESPACE_PREFIX`. Two other doors made that very same name `active` under the very same package: a direct save, and the publish of the single draft. That left an object whose own package could never publish a draft of it again, and three doors giving opposite verdicts on one name.

- FROM: an object made `active` under a package that declares a namespace was accepted with `200` when its name lacked the `${namespace}_` prefix. Two doors did this:
  - a publish-mode save: `PUT /api/v1/meta/object/:name?package=:id` (and `saveMetaItem` in publish mode), including a save naming no package that the door writes into such a package because the object's stored rows are bound to it;
  - the promotion of a single draft: `POST /api/v1/meta/object/:name/publish?package=:id` (and `publishMetaItem`), including a publish naming no package whose draft the door promotes into such a package.
- TO: both doors answer `422`, code `NAMESPACE_PREFIX`. The sentence is the one the draft publish gives for the same name, for example "Object 'v1_report' is missing the package namespace prefix. Rename it to 'rollup_v1_report' (namespace = 'rollup')."
  - The save writes nothing.
  - The publish promotes nothing, and the draft stays a draft.
- Fix: name the object `${namespace}_${shortName}` (here `rollup_v1_report`), as `os validate`, `os build` and the draft publish already require. A package's namespace is the one it declares, or the one derived from its id when it was installed without one (`com.v1.rollup` is `rollup`).

**Unchanged.**

- A package that declares no namespace, and a save or publish bound to no package, are not judged.
- A draft save (`mode=draft`) stores as before. The door that promotes the draft judges it, now with one sentence on all three doors.
- `sys_*` names are exempt, as everywhere the rule runs.
- Stored rows are not migrated and not refused on read. The next direct save or single-draft publish of a stored object whose name lacks its package's prefix is refused.
