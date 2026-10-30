---
'@objectstack/objectql': patch
---

fix(objectql): a refused `state_machine` move is named by the states' option labels, not their raw values

Clause-②: no
Metadata-protocol: none

The built-in `invalid_transition` sentence filled its `{{from}}` / `{{to}}` from the raw option values, so a user refused a status change read `Invalid transition for Status: presented → draft`. It now reads `Invalid transition for Status: Presented → Draft` — each state named the way the form's dropdown shows it, in the caller's locale:

- the field's own option translation (`objects.<object>.fields.<field>.options.<value>`), then, for a picklist-bound field, the shared list's (`picklists.<name>.options.<value>`), then the option's declared `label`, then the raw value for an option with no label;
- asked through the same translation hook the field label resolves through, so a `zh-CN` caller reads `状态不允许从 已提交 变更为 草稿`.

What a client acts on is unchanged: `code` stays `invalid_transition` and `constraint: { from, to }` keeps the raw option values. An author-written rule `message` is handed over exactly as before — it gains no `{{from}}` / `{{to}}` holes. The `invalid_initial_state` sentence is unchanged.
