---
'@objectstack/lint': minor
'@objectstack/core': patch
'@objectstack/spec': patch
---

fix(lint,core)!: a lookup `dependsOn` entry whose filter key names a formula of the referenced object is refused at authoring; an import lookup none of whose scoped reads answered is never reported as out of scope

Clause-②: yes (narrowing) — a lookup, master_detail or user field whose `dependsOn` filter key names a field of the referenced object computed on read (a `formula`) publishes today and is now refused at `error` by `object-field-ref-unknown`
Metadata-protocol: narrowed — a `dependsOn` filter key naming a field of the referenced object computed on read is refused at authoring
Skills-docs: none — no published skill page teaches a `dependsOn` filter key on a formula

<!-- adr-0087: registered lookup-depends-on-param-computed-field-refused -->

**BREAKING** for the publish of an object with such a `dependsOn` entry: it was accepted before and is refused now, by `objectstack validate` / `lint` / `compile` / `build` and by the runtime publish gate, with the field and the fix named in the finding. The schema is unchanged, and stored objects are not rewritten or refused at boot; the refusal comes at the next publish.

**Why.** The record picker filters its candidates, and the importer scopes a lookup cell, by the entry's filter key on the referenced object (`param` in `{ field, param }`, else the bare name or `field`). The engine refuses every filter on a field computed on read, so such an entry published clean, then every picker query it scoped was refused and every import of the column failed its lookup. The finding names the referenced field and why it cannot be filtered on, for example `fields.task.dependsOn[0].param "project_label" is a formula field of "oos_task", computed on read: no record-picker query or import lookup can filter on it.`

## FROM → TO

- `dependsOn: [{ field: 'project', param: 'project_label' }]`, where `project_label` is a formula of the referenced object → `dependsOn: [{ field: 'project', param: 'project' }]`, naming the stored field of the referenced object that holds the same value; or drop the entry.
- `dependsOn: ['region']`, where `region` is a formula on the referenced object → `dependsOn: [{ field: 'region', param: 'region_code' }]` with `region_code` a stored field of the referenced object.

A formula on the OWNING object stays a legal gate (`dependsOn[i].field`): the form reads it from the record being edited.

**`@objectstack/core`, the importer.** A scoped lookup none of whose reads answered (every read refused, for example because the row's master cell is a value the scoping field's type cannot take) is no longer asked again without the scope. It keeps `reference_not_found` and the plain `no record matches` sentence, and never answers `reference_out_of_scope`, which it could before when the value matched a record outside the scope. `RefMatch` gains the optional member `scopeUnanswered`, which a resolver sets for such a lookup.

Measured first-party exposure: none. Every `dependsOn` in `examples/` and in the packaged objects names a stored field on the referenced side, or sits on a field type with no picker.

`@objectstack/spec` adds only the upgrade-guide entry `lookup-depends-on-param-computed-field-refused`.
