---
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

fix(objectql): a field a dependent package adds through `objectExtensions` is served translated on `/api/v1/meta/object`

`SchemaRegistry.getPackagedObjectBase` (the packaged base that `/meta` translates an object against, and that the save door's translated-echo restore reads) now also carries each field a CODE `extend` contributor adds under a name the owner does not declare, as that extender ships it. A later extender's declaration of the same name replaces an earlier one, as in the fold. Before this change such a field counted as authored after the fact. Every non-default-locale read (`GET /api/v1/meta/object`, `GET /api/v1/meta/object/:name`, the list read, the form routes) then served its `label`, help text and option labels in the source language, even when the extender's own translation pack carried them. These reads now serve the pack's translation for those fields. A Studio save of such a read stores the source text again. Default-locale reads are unchanged.

Unchanged: the object scalars, every field the owner declares (including one an extender redeclares), and an extender's `fieldPatches` all stay the owner's. A patched label or description still keeps its text in every language. Fields added by a tenant overlay or a stored (`_provenance: 'org'`) extension, the `.custom` pair's included, still count as authored after the fact. `@objectstack/spec` changes only in doc comments (`TranslateDocumentOptions.packagedBase` and `translateObject`).

Clause-②: no
Metadata-protocol: none
