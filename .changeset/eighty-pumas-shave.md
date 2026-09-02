---
'@objectstack/lint': patch
---

Walk object-nested `list` / `listViews.*` through the view completeness rules.

`validateFunctionalCompleteness` walked only the top-level `views[]` containers, so
a `timeline` / `gantt` / `map` / `tree` view authored on the object itself — the
ADR-0017 "Object has-many View" spelling that `objects[].list` and
`objects[].listViews.*` carry — never reached `checkViewCompleteness`. Both doors
register the same expanded view items and reach the same renderer, so `os validate`
and `os build` were silent on exactly the half of the stack the sibling rules
(`lint-view-refs`, `validate-list-view-field-refs`) already walk.

Both authorable object spellings (array-form and name-keyed map) are covered, and a
list view's own `data.object` retarget (ADR-0047) resolves the bound object the same
way it does on the top-level door — so `view/layout-without-binding` and
`view/tree-without-parent-field` now reach the nested door by construction rather
than by a second wiring step. Findings report as
`object "<name>" › listViews.<key>` / `objects[<i>].listViews.<key>.<block>`.
