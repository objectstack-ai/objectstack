---
"@objectstack/lint": minor
---

feat(lint): resolve a list view's field references at validate/build (#14107)

Accept-set narrowing, `minor` under the family precedent (#14105, #14148).

A list view names fields in more than twenty places and **none of them was
resolved against the bound object** — not by `os validate`, and not by `os
build`, which is the publish gate. Measured on `@objectstack/cli` 17.2.0 from a
real app, each mutation applied on its own and confirmed on disk: a
`columns[].field`, a `filter[].field`, a `grouping.fields[].field`, a
`kanban.groupByField` and a `gantt.startDateField` naming a field that does not
exist all left `os validate` at `valid: true, warnings: []` and `os build` at
exit 0, `✓ Build complete`.

Each one fails silently at render, in the way ADR-0078 and the
`view/layout-without-binding` rule already treat as worth gating: a bad column
renders blanks, a bad filter key is sent to the engine and matches nothing (an
empty list indistinguishable from a true zero), a bad gantt start date leaves a
blank chart, a bad kanban group-by collapses every card into the uncolumned
bucket. The platform already shipped the *harder* half of this check —
`view/layout-without-binding` warns when a binding block is **absent**; a block
that is present but points at a field that does not exist reaches the identical
end state and got nothing.

The new rule `list-view-field-unknown` (`validateListViewFieldRefs`, a member of
the reference-integrity suite, so it runs on `validate` / `lint` / `compile` and
on `view` per-write publish snapshots) resolves every field-naming position on a
list view against the object graph:

- `columns[]` (bare-string and `{ field }` forms, plus `summary.field` and
  `prefix.field`), `filter[]` keys, `tabs[].filter[]` keys, `grouping.fields[]`,
  `rowColor.field`, `userFilters.fields[]`, `userFilters.tabs[].filter[]` keys,
  `filterableFields[]`, `hiddenFields[]`, `fieldOrder[]`;
- every field binding inside the `kanban`, `calendar`, `gantt`, `timeline`,
  `gallery`, `map` and `tree` blocks.

`sort[]` and `searchableFields[]` are deliberately untouched — they already have
owners (`sort-field-unknown` #9257, `searchable-field-unknown` #6674/#4830),
each with a runtime-admissibility verdict on top of existence.

Two severity tiers, the `validateFlowTemplatePaths` precedent: `error` where the
miss changes the data the view returns or collapses the layout it configures
(every position in the card's measured table), `warning` where the renderer
drops one decoration and renders the rest (optional colour/title/tooltip/cover
bindings, a stale `hiddenFields` or `fieldOrder` entry).

Resolution goes through the shared `object-graph.ts` seam (#14105/#14148) — no
second field-resolution implementation — and judges the **head segment** of a
dotted reference rather than walking relationship hops: a list view compiles no
joins, and all three query axes it reaches refuse a dotted path by name
(`assertProjectionFieldsExist` #7532 / `assertProjectionHasNoDottedPaths` #7589,
the #8371 dotted filter door, `assertSortFieldsExist` #6994). This is strictly
wider than "skip dotted paths": `ownr.name` is now reported, where a skip would
have passed it.

**Migration.** A list view refused by the new rule names a field the bound
object does not have: correct the spelling (the finding carries a "did you mean"
and the object's field list) or drop the entry. The three standard skips apply —
an object this stack does not define, an object with no readable field map
(ADR-0015 `external`), and registry-injected system columns — plus a fourth on
this surface: a list view whose `data.provider` is not `object`.
