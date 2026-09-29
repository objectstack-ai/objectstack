---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
---

Clause-②: no

Two live structured object keys are authorable in the metadata form: `fieldGroups` and `indexes`. Each was **declared** by `ObjectSchema`, graded `live` by the liveness ledger, and offered by **no** form in `METADATA_FORM_REGISTRY`, so an author's only door was the Source tab. Each is now a `type: 'repeater'` row on the object form whose sub-rows are declared by hand rather than derived from the schema:

- `fieldGroups` (Basics, beside `highlightFields`) — six sub-rows, one per canonical group key: `key` and `label` (required text), `icon` (text), `description` (textarea), `collapse` (a `none` / `expanded` / `collapsed` select) and `visibleWhen` (`type: 'code'`, `language: 'expression'`, the `fields` grid's predicate rows). The three `[DEPRECATED → collapse]` aliases (`defaultExpanded`, `collapsible`, `collapsed`) are **not** offered; the metadata-form reconciliation ledger records a nested `omit` row for each. The parse still accepts them and derives `collapse` from one only when `collapse` is absent, so a stored entry keeps its meaning, and a `collapse` set in the form outranks any alias it carries.
- `indexes` (Advanced, beside `datasource`) — three sub-rows over the keys the SQL driver reads: `name` (text), `fields` (`widget: 'string-tags'`, required) and `unique`, a select offering **only** `global` and `organization`. The deprecated bare `unique: true` is never offered: a schema-derived control would take the union's first arm and render a switch that writes it. An edit merges into the stored entry, so an index that already carries `true` or `false` keeps it until the author picks a scope, and the select can write only the two values the parse accepts. `type` and `partial` are tombstones and have no row.

The help text states what the runtime does with each value. `indexes[].fields` is free text, and the schema parse, so a draft save, does not judge its names; `os validate`, `os build`, `os lint` and the publish door refuse a name that is not a field of the object (`object-field-ref-unknown`, #20479, in the same release). A name that is not a stored column, a `formula` field say, makes the SQL driver skip the whole index at sync with an error in the server log, and the help text says exactly that; `os migrate plan` reports the skipped index too (#20432, in the same release). A field group has no field-name list: a field joins a group through its own `group` key.

The two row schemas also carry a JSON Schema `title` on every property, as every repeater row schema must: `IndexSchema` on `name`, `fields` and `unique`, and `ObjectFieldGroupSchema` on its nine keys, the three deprecated aliases included. A property panel that reads the served schema's titles therefore shows a named column instead of a raw key. Each title is a `.meta({ title })` call and nothing more.

⛔ **No schema accept set moves and no export changes.** `METADATA_FORM_REGISTRY` is declared as an opaque `Readonly<Record<string, FormView>>`, so row contents were never part of the declared surface. What changes is the **form payload** `getMetaTypes()` serves (its rows, and the titles above in its JSON Schema) and the translation keys `os i18n extract` walks, hence the regenerated `platform-objects` metadata-form bundles. Their 22 new leaves are authored in `zh-CN`, `ja-JP` and `es-ES` rather than left as extractor fills.

⛔ **The gate that would notice a missing row is NOT landed here.** The reconciliation gate's top-level `zodOnly` direction stays unwired; this change lands offers and three nested ledger rows only.
