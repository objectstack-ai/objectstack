---
'@objectstack/lint': minor
---

fix(lint)!: a field group's `visibleWhen` is judged like a field's own `visibleWhen` — in `os validate` / `os build` and at the object save door, refused as `expression-invalid` at the group's key

`fieldGroups[].visibleWhen` gates the whole group, header included, and the form renderer fails it closed: a predicate that cannot evaluate hides the group on every form and record page. No pass of the expression rule read the slot, so a group predicate naming a field the object does not declare (`record.no_such_field == 'x'`) saved with a 200 and the section vanished, while the same text on a field's `visibleWhen` or an action's `visible` was refused 422 at the same door. The object walk now judges every field group's `visibleWhen` with the field `visibleWhen` slot's rules: it must parse, read fields as `record.FIELD` (never bare), name fields the object declares, call only registered functions, and read no root beyond `record`, `previous` and `parent`. The finding is located at `object 'NAME' · field group 'KEY' visibleWhen`, and the root refusal is worded for the group's fail-closed gate.

Clause-②: no (narrowing) — the object save door, `os validate` and `os build` refuse a field group `visibleWhen` they accepted before. Nothing is widened.

Metadata-protocol: narrowed (an object's `fieldGroups[].visibleWhen` may no longer carry a predicate the field `visibleWhen` slot refuses)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: ObjectFieldGroupSchema.visibleWhen keeps its shape and meaning, and the build and the door now give it the verdict a field visibleWhen already gets. A refused predicate never evaluated (the group was hidden on every form), so there is no rewrite that keeps what the author meant; the author fixes the predicate, and the refusal names the field or root. -->

**BREAKING** accept-set narrowing at the object save door (`PUT /api/v1/meta/object/:name`, draft promotion, package draft publish) and in `os validate` / `os build`.

- **Before.** A field group `visibleWhen` with an unknown field, a bare field reference, an unregistered function, a syntax error or a `current_user` read saved, and the group was hidden on every form and detail page with nothing said.
- **Now.** Each answers `422 INVALID_METADATA` at the door (and an `expression-invalid` error at build), located at the group's key.
- **Unchanged.** A group predicate over the object's declared fields (`record.stage == 'won'`, `previous.stage != record.stage`) saves as before, and a group with no `visibleWhen` is untouched. No example, template or platform object in this repository declares a group `visibleWhen`.

**The remedy.** Fix the predicate the refusal names: write `record.FIELD` against a field the object declares. To hide fields by role, declare field-level security on a permission set; to gate on record state, write the predicate against `record`.
