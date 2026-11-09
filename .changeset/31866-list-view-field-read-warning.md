---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a list view column naming a field its object lacks reads with a `_diagnostics` warning, as a form view's unknown field does

Clause-②: no
Metadata-protocol: none

- **Now.** The `/meta` view read (single item, with or without a package, and the layered `?layers=true` read) runs the lint's `list-view-field-unknown` rule on the body it serves and puts each finding in `_diagnostics.warnings` as `{ path, message }`, in the rule's own words. Every list-view shape is judged: a list `ViewItem`'s `config`, the flattened list overlay, and a view container's `list` and `listViews`. A plugin's code-registered list view, which never passes a write door, used to read `valid: true` with nothing else while its list opened on a refused query (`400 INVALID_FIELD`), so nothing named the column.
- **Unchanged.** `valid` stays the schema's answer. An active save and a publish still refuse such a column (`422 INVALID_METADATA`), and the draft read still reports it once, as that refusal: a warning the publish verdict repeats at the same path is dropped. A finding at a path the ADR-0047 reference check already reports as an error is not repeated. Form-view warnings are unchanged.
