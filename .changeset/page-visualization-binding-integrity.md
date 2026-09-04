---
"@objectstack/lint": minor
---

feat(lint): resolve an interface page's whitelisted visualizations at validate/build (#14073)

Accept-set narrowing, `minor` under the family precedent (#14107, #14105, #14148).

An interface `list` page whitelists renderers with
`interfaceConfig.appearance.allowedVisualizations`, and `InterfacePageConfigSchema`
is a closed shape with **no per-visualization binding key at all** — no
`calendar:`, no `kanban:`, no `map:`. So #13817's parse-time refinement, which
demands a `calendar:` block on a list VIEW that whitelists `calendar`, was
correctly not extended to this door: a requirement the page surface cannot
satisfy would be unauthorable.

That left the page door with no check of any kind. Measured on objectui
`f0f774b0` (after objectui#7029 removed the invented `due_date` default), the
renderer derives each binding from the source object's fields
(`InterfaceListPage.tsx`, `view.<viz> ?? deriveFromObject(objectDef)`), and when
nothing derives there are exactly two outcomes, neither of which reaches the
author:

- the entry LEADS the whitelist — it becomes the page's forced view type, is
  force-pushed into the switcher's resolvable set, and every visitor lands on
  the renderer's "Calendar configuration required" refusal screen;
- the entry is anywhere else — it is filtered out of the switcher **silently**,
  while the switcher chrome still appears (it is shown on whitelist length).

The new rule `page/visualization-without-binding`
(`validatePageVisualizationBindings`, a member of the reference-integrity suite,
so it runs on `validate` / `lint` / `compile`) asks the renderer's own question
at authoring time. For every `list` page, each whitelisted visualization must be
either derivable from the source object's declared fields — using the SAME
predicates the renderer applies, the field TYPE first and then the NAME regex
fallback (kanban: select-like type or status-like name; calendar and timeline: a
date-typed non-hidden non-system field, else a date-like name; gallery:
image-typed, no name leg; gantt: two distinct date fields; map: location-typed or
a geo-like name) — or bound by the block of the list view the page references
through `sourceView` (a `calendar:` block also binds a `timeline`, which is what
`resolveTimelineDateBinding` accepts). `grid` always passes.

Severity tracks what the visitor sees: **`error`** when the unbound entry is
`allowedVisualizations[0]`, **`warning`** otherwise. Every message names
`sourceView` as the remedy, because on this door it is the one schema-legal
channel for a per-visualization binding — exactly how the shipped showcase map
page binds its `locationField`.

Deliberately NOT stricter than the renderer: mirroring both predicates rather
than the type half alone means a page whose only date is a text field called
`due_date` still passes, because it still renders. The mirrored table is exported
(`OBJECTUI_DERIVATION_PREDICATES`) and pinned verbatim by a fixture test, and the
seven shipped `showcase_task` interface pages are pinned as a live regression
corpus — the two halves catch drift on either side of a mirror no build edge
connects. `chart` and `tree` get no verdict: the renderer derives no binding for
them on this seam, so the rule says nothing rather than guessing.

**Migration.** A page reported by the new rule whitelists a visualization that
renders nothing: point the page at a list view that declares the block
(`interfaceConfig.sourceView`), give the source object a field the derivation can
find, or drop the entry from `appearance.allowedVisualizations`. Four skips keep
it quiet where it cannot know: a page that is not `type: 'list'`, an object this
stack does not define, an object with no readable field map (ADR-0015
`external`), and a `sourceView` naming a view this stack does not declare (the
runtime hydrates stored view bodies over the network).

No `packages/spec` change — the page surface stays closed, which is what ADR-0047
§7 open question 3 asks for.
