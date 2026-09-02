---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

`view/layout-without-binding` now covers every view type that carries a binding block, and a new `view/tree-without-parent-field` rule catches the silently flat tree

`checkViewCompleteness`'s `VIEW_BINDING_BLOCKS` table named `kanban` / `calendar` / `gantt` only, while
`ListViewSchema.type` has six members with a type-specific binding block. The other three fell through
the same trapdoor the rule exists to close: objectui's ListView adapter falls back to literal field
names (`timeline` → `startDateField || 'created_at'`, `titleField || 'name'`; `map` →
`locationField || 'location'`; `tree` → `labelField || titleField || 'name'`), so a view authored
without its block rendered empty — `timeline` drops every row whose start date fails to parse —
while `os validate --json` reported `warnings: []` and `valid: true`. Measured both ways: deleting a
`timeline` block was silent, deleting the sibling `gantt` block warned as designed.

- The table now names all six. Each new entry carries a `fix` hint naming the keys that make the block
  a binding (`timeline`'s two schema-required keys; either coordinate form for `map`; `parentField` +
  `labelField` for `tree`). Severity stays `warning` (ADR-0078 §1 — the view degrades, it does not die).
- `map` is read for its coordinate binding, not merely for block presence: `ListMapConfigSchema` requires
  no key, so a `map` block declaring neither `locationField` nor the `latitudeField`/`longitudeField`
  pair is the same unbound view with braces and is warned about at `map.locationField`.
- **New rule `view/tree-without-parent-field`** (warning, path `tree.parentField`): a `type: 'tree'` view
  with no declared `parentField` on an object that carries neither a `tree` field nor a
  `lookup`/`master_detail` back to itself renders FLAT — every record at depth 0, a correct-looking table
  whose expand slot never opens. Every `TreeConfigSchema` key is optional, so `tree: {}` satisfies the
  block check and still renders flat; this rule mirrors objectui's `detectParentField` exactly, so a
  view the renderer resolves by auto-detection is never warned about.
- `checkViewCompleteness(view, boundObject?)` takes the bound object definition as an optional second
  argument (additive; one-argument callers are unchanged and the tree rule stays silent for them).
  `@objectstack/lint`'s `validate-functional-completeness` resolves the object by name from
  `stack.objects` — the list view's own `data.object` first, then the container's binding — and hands
  it over; no rule logic moved into lint.
- `gallery` is measured (`titleField || 'name'`) and deliberately not added: its schema has no binding key
  to demand. `page` stays deliberately absent (a `page` view refuses at parse via `checkListViewPageMount`).

Under `os validate --strict` the new warnings are failures, as every warning in this family is.
