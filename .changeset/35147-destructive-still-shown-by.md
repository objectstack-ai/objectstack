---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
---

feat(metadata-protocol): a refused field removal or type change names the views, forms and dashboard cards that still show the field

Clause-②: yes (widening: the DESTRUCTIVE_CHANGE answer gains stillShownBy; a new exported operator-fit table)
Metadata-protocol: added
Skills-docs: none — no skill in `skills/**` teaches the `409 DESTRUCTIVE_CHANGE` save refusal or its `issues[]`. The finding's own message now names the items, so a client relaying it says them without being taught.

The `409 DESTRUCTIVE_CHANGE` refusal of an `object` save said what data the change loses. It now also says what breaks on screen. Each `field_removed` finding carries `stillShownBy`: the views, forms, datasets, dashboards, pages, flows, reports and objects that still reference the field, at the positions that name it (`columns[1]`, `sections[0].fields[1]`, `widgets[3]` through a dataset). Each `field_type_change` finding carries the list-view filter rules whose operator the new type no longer fits, for example a `contains` filter on a field changed to `number`. The finding's message names the same items, so a door that relays only the message says it too. The save edits none of them.

- The answer rides the refusal's `issues[]`, which every door already relays verbatim: the REST `PUT /api/v1/meta/...` doors (`issues`), the runtime dispatcher (`details.issues`) and the MCP draft door (`issues`). No door changed.
- It is computed from the environment's served metadata, one listing per type, only when a finding needs it. No record and no draft is read. A listing that cannot be read leaves `stillShownBy` absent ("not computed"); `[]` means "computed, shown nowhere".
- A removal is judged by the checks `os validate` runs (`@objectstack/lint`'s reference-integrity suite, form-layout check and widget-binding check), with the field and without it. A position those checks do not read is not seen. The spec describe on `DestructiveChangeIssueSchema.stillShownBy` states exactly what is and is not seen.
- `@objectstack/spec/data` exports `filterOperatorFieldTypeFit(operator, field)` and its table `FILTER_OPERATOR_FIELD_TYPE_FIT`: the one place that judges which filter operator fits which field type. An operator is unfit only where a declared-type door refuses it. Today that is the text-operator door (a text operator over a type that can never store a string, `INVALID_FILTER` 400), referenced rather than re-listed. `dollarFilterOperatorOf(op)` lowers any operator spelling to its `$` form.
- `@objectstack/spec/api` declares the answer's shape: `DestructiveChangeIssueSchema` and `FieldStillShownBySchema`.
