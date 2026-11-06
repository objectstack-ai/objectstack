---
'@objectstack/metadata-protocol': minor
'@objectstack/cli': minor
'@objectstack/cloud-connection': minor
---

fix(metadata-protocol,cli,cloud-connection)!: an object extension that re-declares an owner's field in `fields` beyond its display properties is refused at the save and publish doors, at `os validate` and at the install door, with a prescription naming `fieldPatches` (ADR-0146 D10) (#30610)

Clause-②: no (narrowing) — the `object_extension` save, publish and restore doors, `os validate` and `POST /api/v1/marketplace/install-local` refuse an `objectExtensions[].fields` entry naming a field the extended object's owner declares when it changes anything outside the display-property whitelist, a body they accepted before. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: no move — `skills/**` and `content/docs/**` already teach `fieldPatches` as the way to change a base field's display, and no page teaches taking an owner field over through `fields`; the prescription ships in the refusal text.

<!-- adr-0087: not-required (no-migration-prescription) A refused shape with no mechanical rewrite: which keys of a re-declared field were meant as display and which as a takeover is a judgement about the field, and no first-party artifact (examples, HotCRM) writes the shape. A stored row that already re-declares an owner field keeps registering with the registry's warning, and is judged when it is next saved or published. -->

**BREAKING** accept-set narrowing at the metadata save and publish doors (`PUT /api/v1/meta/object_extension/NAME`, draft and live, the per-item and package publish, and the restore doors), at `os validate`, and at the marketplace install door.

- **Before.** An extension written into `fields` with the name of a field the extended object's owner declares replaced the owner's field whole when the registry folded the object: a module package could turn the owner's `amount: number` into `text`, drop its `required`, or make it `readonly`, and every reader judged the field on the extension's definition. Only the registry's warning named it.
- **Now.** Such an entry is refused when it changes anything outside the display-property whitelist (`label`, `description`, `inlineHelpText`, `placeholder`, an option's `label`): `400 VALIDATION_ERROR` at the save and publish doors (located in `issues[]` at `fields.FIELD`), `422 VALIDATION_ERROR` at the install door (every entry in `details.refusals`), and exit 1 with the entry on `errors` at `os validate`. Each refusal names the keys the entry changes and prescribes `fieldPatches`. Both bodies are read through the field schema first, so a default the parse stamps is no change; options are compared by stored value, so a relabel or reorder is no change.
- **Unchanged.** A re-declaration that changes only display properties is admitted. An extension of an object its own package owns is not judged, nor is an added field. `os validate` judges an owner declared by another package of the same artifact; a target outside the artifact is judged at install, against the installed owner. The registry's warning on a re-declared field stays. `os build` does not yet run the check.

**The remedy.** Move a display change of an owner's field into the extension's `fieldPatches` (the field name as its key, the whitelisted properties as its body), and add a behaviour of your own as a new field under a new name.
