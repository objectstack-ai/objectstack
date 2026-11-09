---
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/metadata-protocol': minor
---

feat(spec): a lookup or master-detail field's related-list title is translatable

Clause-②: yes
Metadata-protocol: added

A related list the record page derives from a lookup or master-detail field is titled by the field's `relatedListTitle`, or by the child object's label when it has none. That title had no translation slot, so a zh-CN reader saw it in the authoring language, and `os i18n check` could not see the gap. A lookup from an object back to itself was the plainest case: with no title of its own, a contract's record page listed its renewals under 「合同」, the same word as the contract beside it.

- `FieldTranslationSchema` declares `relatedListTitle`: `objects.<child>.fields.<field>.relatedListTitle`, on the child object whose field declares the title. `translateObject` overlays it on the served child object (`GET /meta/object`, and the app bundle's object members), which is what the console derives the related list's title from, on the side card and on the body table alike.
- It follows the packaged-base rule (ADR-0029 D9.2a): a title an org re-authored on top of the packaged declaration keeps its text. An authored `relatedListTitle` with no entry keeps its authored text; the child object's label is never substituted for it.
- `os i18n extract` scaffolds the key and `os i18n check` counts it under the field bucket. A field without a `relatedListTitle` is recorded without being demanded.
- The object save door puts a served (translated) `relatedListTitle` back to its source text, as it does for the field's other translated slots.
