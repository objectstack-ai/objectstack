---
'@objectstack/objectql': minor
'@objectstack/cloud-connection': minor
'@objectstack/spec': minor
---

fix(objectql,cloud-connection)!: an object extension's `fieldPatches` reaches the owner's own fields only, at the registry fold and at the install door alike; the install door refuses a bad patch with 422

Clause-②: no (narrowing) — the marketplace install door now refuses a package whose `fieldPatches` names a field only another installed extension adds, which it admitted before, and the registry fold no longer applies such a patch. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is removed: the published `ObjectExtensionSchema.fieldPatches` sentence already says a patch changes the display of the target object's own fields, and the fold and the install door now read it that way too. No package in this repository patches a field an extension adds, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at `POST /api/v1/marketplace/install-local` (`@objectstack/cloud-connection`) and in the object fold every read serves (`@objectstack/objectql`).

- **Before.** A patch of a field another extension adds got three answers. The fold applied it only when the adding extension had a lower `priority` than the patching one; the install door judged the fully resolved object, so it admitted it; `os validate` judged the stack's declared objects, so it refused it. A patch of a field the same extension adds in `fields` was applied by the fold and refused by both doors.
- **Now.** A field patch reaches the fields the object's owner declares, and nothing else. The fold skips a patch of any other field, whatever the priorities, and names it once in the log, as it names a patch of a missing field. The install door judges a patch against the owner's declaration (new `SchemaRegistry#getFieldPatchTarget`), not the resolved object, so it refuses such a patch; `os validate` already did. The fold judges and patches the record spelling of `fields` only, the spelling the merge reads: a body with array-spelled `fields` handed to `foldObjectExtendersOnto` is not patched, and the patch is named.
- **Status.** The install door's field-patch refusal answers `422 VALIDATION_ERROR` (was 400), the status every other body refusal at that door answers. The code, the message and `details.refusals` are unchanged.
- **Guidance.** `ObjectExtensionSchema`'s `actions` refusal now says the merge also applies `fieldPatches` (`@objectstack/spec`, prose only).
- **Who sees it.** A package that patches a field another extension (or its own `fields`) adds. Measured in this repository: none in `examples/**` or `packages/*/src`.

**The remedy.** Set that field's text where the field is declared: in the `fields` entry of the extension that adds it.
